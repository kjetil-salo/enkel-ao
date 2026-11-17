import json
import os
import sys

import httpx
import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

from src import ao3_import


@pytest.mark.parametrize('utfall', ['publisert', 'feil_sted', 'avbrutt', 'uten_kvittering',
                                    'med_bilde', 'mangler_observatør', 'mangler_bruker_id'])
def test_ao3_publiserer_bare_verifiserte_utkast(monkeypatch, utfall):
    opprettet = []
    publisert = []

    def svar(request):
        url = request.url.path
        if url == '/bff/login':
            return httpx.Response(302, headers={'Location': ao3_import.AO3_LOGIN + '/Account/Login'})
        if url == '/Account/Login' and request.method == 'GET':
            return httpx.Response(200, text='<form method="post"><input name="username" type="email">'
                                            '<input name="password" type="password"></form>')
        if url == '/Account/Login' and request.method == 'POST':
            assert request.url.host == 'login.artsobservasjoner.no'
            return httpx.Response(303, headers={'Location': ao3_import.AO3 + '/contribute/submit-sightings'})
        if url == '/contribute/submit-sightings':
            return httpx.Response(200)
        if url == '/bff/user':
            krav = [{'type': 'user_account_id', 'value': '4'}]
            if utfall != 'mangler_bruker_id':
                krav.append({'type': 'user_id', 'value': '17'})
            return httpx.Response(200, json=krav)
        if url == '/core/Sightings':
            if opprettet and utfall == 'avbrutt':
                raise httpx.ReadTimeout('Avbrutt', request=request)
            felt = json.loads(request.content)
            assert felt['startDate'] == '2026-11-13T23:00:00.000Z'
            assert felt['activityId'] == 23
            assert felt['observerIds'] == [17]
            assert 'stageId' not in felt and 'genderId' not in felt
            opprettet.append(felt)
            return httpx.Response(201, json={'id': 100 + len(opprettet)})
        if url == '/core/Sightings/Publish':
            publisert.extend(json.loads(request.content))
            return httpx.Response(200)
        nr = int(url.rsplit('/', 1)[-1])
        return httpx.Response(200, json={
            'id': nr,
            'site': {'id': 349566 if utfall != 'feil_sted' else 2},
            'taxon': {'id': 4372},
            'quantity': 1,
            'observers': [] if utfall == 'mangler_observatør' else [{'id': 17}],
            'sightingStateType': 'Published' if nr in publisert and utfall != 'uten_kvittering' else 'Unpublished',
        })

    opprinnelig_klient = httpx.Client
    monkeypatch.setattr(ao3_import.httpx, 'Client',
                        lambda **kwargs: opprinnelig_klient(transport=httpx.MockTransport(svar), **kwargs))
    monkeypatch.setattr(ao3_import, '_ao3_art', lambda _: {'vernacularName': {'name': 'kjøttmeis'}, 'speciesGroupId': 8})
    monkeypatch.setattr(ao3_import, '_verdilister', lambda: ({'stasjonær': 23}, {'': 0}, {'': 0}))
    funn = {'species': {'taxonId': 4372, 'taxonName': 'Kjøttmeis'}, 'activity': 'Stasjonær',
            'placeId': 349566, 'count': 1, 'timestamp': '2026-11-14T08:00:00',
            'coObservers': [''] * 10}
    if utfall == 'med_bilde':
        funn['photo'] = 'data:image/jpeg;base64,YQ=='
    resultat = ao3_import.send_via_ao3('test@example.org', 'testpassord', [funn, dict(funn)])

    if utfall == 'publisert':
        assert resultat == {'success': True, 'published': True, 'count': 2, 'via': 'ao3'}
        assert publisert == [101, 102]
    elif utfall in ('med_bilde', 'mangler_bruker_id'):
        assert resultat['code'] == 'ao3_manual'
        assert opprettet == publisert == []
    else:
        assert resultat['code'] == 'ao3_unconfirmed'
        assert publisert == ([101, 102] if utfall == 'uten_kvittering' else [])


def test_prepare_avviser_ukjent_antall_i_stedet_for_a_krasje(monkeypatch):
    # count=None (ukjent antall, se docs/ukjent-antall-og-uoppgitt-aktivitet.md)
    # skal gi den uttrykte _KanIkkeSende-grenen for antall<1, ALDRI en ufanget
    # TypeError fra int(None) — regresjonsvern for ao3_import.py sin _prepare().
    monkeypatch.setattr(ao3_import, '_ao3_art', lambda _: {'vernacularName': {'name': 'kjøttmeis'}, 'speciesGroupId': 8})
    monkeypatch.setattr(ao3_import, '_verdilister', lambda: ({'stasjonær': 23}, {'': 0}, {'': 0}))
    funn = {'species': {'taxonId': 4372, 'taxonName': 'Kjøttmeis'}, 'activity': '',
            'placeId': 349566, 'count': None, 'timestamp': '2026-11-14T08:00:00'}

    with pytest.raises(ao3_import._KanIkkeSende, match='antall'):
        ao3_import._prepare(funn)


def test_prepare_tillater_tom_aktivitet(monkeypatch):
    # Et tomt aktivitetsfelt («Ikke oppgitt») skal ikke sette activityId i det
    # hele tatt — ikke kaste på et manglende oppslag i aktivitetslista.
    monkeypatch.setattr(ao3_import, '_ao3_art', lambda _: {'vernacularName': {'name': 'kjøttmeis'}, 'speciesGroupId': 8})
    monkeypatch.setattr(ao3_import, '_verdilister', lambda: ({'stasjonær': 23}, {'': 0}, {'': 0}))
    funn = {'species': {'taxonId': 4372, 'taxonName': 'Kjøttmeis'}, 'activity': '',
            'placeId': 349566, 'count': 1, 'timestamp': '2026-11-14T08:00:00'}

    felter = ao3_import._prepare(funn)
    assert 'activityId' not in felter


def test_private_ao3_lokaliteter_hentes_paginert_fra_innlogget_konto():
    def svar(request):
        assert request.url.path == '/core/Sites/ByUser'
        side = int(request.url.params['pageNumber'])
        return httpx.Response(200, json={'totalPages': 2, 'data': [
            {'id': side, 'name': f'Min lokalitet {side}', 'latitude': 60.0, 'longitude': 5.0,
             'isPrivate': True, 'accuracy': 25, 'municipalityName': 'Bergen'},
            {'id': 10, 'name': 'Offentlig lokalitet', 'isPrivate': False},
        ]})

    with httpx.Client(transport=httpx.MockTransport(svar)) as klient:
        assert ao3_import._private_lokaliteter(klient) == [
            {'id': side, 'name': f'Min lokalitet {side}', 'lat': 60.0, 'lon': 5.0,
             'acc': 25, 'municipality': 'Bergen'}
            for side in (1, 2)
        ]
