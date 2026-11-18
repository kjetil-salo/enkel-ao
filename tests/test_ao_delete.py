"""Sletting og rapportørvern testes uten å endre ekte observasjoner."""

from unittest.mock import Mock

import httpx
import pytest

from src import ao_delete
from src.ao_sightings import AoSessionExpired


EGEN_RAD = {
    'SightingId': 42, 'ReporterUserAlias': 'meg', 'SiteId': 7,
    'UniversalDate': '2026-11-18',
    'Observers': '<span data-useralias="meg" class="iscurrentuser">Meg</span>',
}
GRUPPE = {'date': '2026-11-18', 'siteId': 7}


def svar(tekst='', status=200, url='https://www.artsobservasjoner.no/Sighting/42', headers=None):
    return Mock(text=tekst, status_code=status, url=httpx.URL(url), headers=headers or {})


def slettet():
    return svar('<h2>Siden finnes ikke</h2>', 404,
                'https://www.artsobservasjoner.no/Error/PageNotFound/')


def egen_side():
    return svar('<a href="/LogOff">Logg ut</a><a id="delete_sightings">Slett</a>')


@pytest.fixture
def ao(monkeypatch):
    rad = dict(EGEN_RAD)
    hent = Mock(return_value=rad)
    monkeypatch.setattr(ao_delete, 'fetch_raw_row', hent)
    klient = Mock()
    klient.__enter__ = Mock(return_value=klient)
    klient.__exit__ = Mock(return_value=None)
    klient.get.side_effect = [egen_side(), slettet()]
    klient.post.return_value = svar()
    monkeypatch.setattr(ao_delete.httpx, 'Client', Mock(return_value=klient))
    return klient, rad, hent


def test_sletter_bare_egen_rad_og_krever_direkte_bekreftelse(ao):
    klient, _, hent = ao
    assert ao_delete.slett_funn('L', 'A', 42) == {'ok': True, 'verified': True}
    hent.assert_called_once_with('L', 'A', 42)
    klient.post.assert_called_once_with(
        'https://www.artsobservasjoner.no/ReviewSighting/DeleteSighting',
        json={'sightingId': 42, 'isTemporary': False},
        headers={'X-Requested-With': 'XMLHttpRequest',
                 'Referer': 'https://www.artsobservasjoner.no/Sighting/42'})
    assert klient.get.call_count == 2


@pytest.mark.parametrize('id_', [None, '', 0, -1, 4.2, True, 'abc', '../../1'])
def test_ugyldig_id_gir_ingen_ao_kall(ao, id_):
    klient, _, hent = ao
    assert ao_delete.slett_funn('L', 'A', id_)['ok'] is False
    hent.assert_not_called()
    klient.post.assert_not_called()


def test_manglende_sesjon_gir_ingen_ao_kall(ao):
    klient, _, hent = ao
    assert ao_delete.slett_funn('', 'A', 42)['needsLogin'] is True
    hent.assert_not_called()
    klient.post.assert_not_called()


@pytest.mark.parametrize('alias,rapportor,forventet', [
    ('meg', 'meg', True), ('MEG', 'meg', True), ('meg', 'sekretaer', False),
    (None, 'meg', False), ('meg', '', False),
])
def test_rapportor_krever_positiv_identitet(alias, rapportor, forventet):
    rad = {'ReporterUserAlias': rapportor, 'Observers': (
        f'<span data-useralias="{alias}" class="iscurrentuser">Meg</span>' if alias else '')}
    assert ao_delete.er_rapportor(rad) is forventet


@pytest.mark.parametrize('rapportor,observator', [('sekretaer', 'meg'), ('meg', ''), ('', 'meg')])
def test_medobservator_og_ukjent_rolle_kan_ikke_slette(ao, rapportor, observator):
    klient, rad, _ = ao
    rad['ReporterUserAlias'] = rapportor
    if not observator:
        rad['Observers'] = ''
    assert ao_delete.slett_funn('L', 'A', 42)['ok'] is False
    klient.post.assert_not_called()
    klient.get.assert_not_called()


@pytest.mark.parametrize('html', [
    '<script>var x = "id=delete_sightings";</script>',
    '<a id="delete_sightings" disabled>Slett</a>',
    '<button id="delete_sightings" aria-disabled="true">Slett</button>',
    '<div id="delete_sightings">Ukjent markup</div>',
])
def test_maa_ha_ekte_tillatt_slettehandling(ao, html):
    klient, _, _ = ao
    klient.get.side_effect = [svar('<a href="/LogOff">Ut</a>' + html)]
    resultat = ao_delete.slett_funn('L', 'A', 42)
    assert resultat['ok'] is False
    assert 'uncertain' not in resultat
    klient.post.assert_not_called()


def test_allerede_slettet_sender_ikke_nytt_post(ao):
    klient, _, _ = ao
    klient.get.side_effect = [slettet()]
    assert ao_delete.slett_funn('L', 'A', 42) == {
        'ok': True, 'verified': True, 'alreadyDeleted': True}
    klient.post.assert_not_called()


@pytest.mark.parametrize('etter', [
    svar('Fortsatt et funn'), svar('Nettverksfeil', 404),
    svar('<h2>Siden finnes ikke</h2>', 404, 'https://annen.example/Error/PageNotFound/'),
    svar('Ukjent feilside', 404, 'https://www.artsobservasjoner.no/Error/PageNotFound/'),
    svar('Utløpt sesjon', 403),
])
def test_generisk_200_404_eller_sesjonsfeil_er_ikke_bekreftet_sletting(ao, etter):
    klient, _, _ = ao
    klient.get.side_effect = [egen_side(), etter]
    resultat = ao_delete.slett_funn('L', 'A', 42)
    assert resultat['ok'] is False
    assert resultat['uncertain'] is True
    assert 'needsLogin' not in resultat
    klient.post.assert_called_once()


def test_posttimeout_gjentas_aldri_automatisk(ao):
    klient, _, _ = ao
    klient.post.side_effect = httpx.ReadTimeout('venter')
    resultat = ao_delete.slett_funn('L', 'A', 42)
    assert resultat['ok'] is False
    assert resultat['uncertain'] is True
    klient.post.assert_called_once()


def test_sesjon_utlopt_for_sletting(ao):
    klient, _, hent = ao
    hent.side_effect = AoSessionExpired()
    assert ao_delete.slett_funn('L', 'A', 42)['needsLogin'] is True
    klient.post.assert_not_called()


@pytest.mark.parametrize('gruppe', [
    {'date': '2026-11-17', 'siteId': 7}, {'date': '2026-11-18', 'siteId': 8},
    {}, 'ugyldig', {'date': '2026-11-18', 'siteId': True},
])
def test_flyttet_funn_eller_ugyldig_gruppe_slettes_ikke(ao, gruppe):
    klient, _, _ = ao
    assert ao_delete.slett_funn('L', 'A', 42, expected_group=gruppe)['ok'] is False
    klient.post.assert_not_called()
    klient.get.assert_not_called()


def test_matchende_gruppe_tillater_sletting(ao):
    assert ao_delete.slett_funn('L', 'A', 42, expected_group=GRUPPE)['verified'] is True


def test_flyttet_funn_melder_ikke_brukeren_av(monkeypatch):
    from src import ao_coobserver
    rad = {**EGEN_RAD, 'ReporterUserAlias': 'sekretaer'}
    monkeypatch.setattr(ao_coobserver, 'fetch_raw_row', lambda *args: rad)
    klient = Mock()
    monkeypatch.setattr(ao_coobserver.httpx, 'Client', klient)
    resultat = ao_coobserver.fjern_meg('L', 'A', 42, expected_group={**GRUPPE, 'siteId': 8})
    assert resultat['ok'] is False
    klient.assert_not_called()


def handler_for(monkeypatch, rad=EGEN_RAD, **data):
    import server
    handler = server.Handler.__new__(server.Handler)
    handler._read_json_body = Mock(return_value={
        'loginToken': 'L', 'authCookie': 'A', 'sightingId': 42,
        'endringer': {'quantity': '13'}, **data})
    handler._send_json = Mock()
    monkeypatch.setattr(server, 'fetch_raw_row', Mock(return_value=rad))
    return handler


def test_http_slett_bruker_kun_tokens_id_og_gruppe(monkeypatch):
    handler = handler_for(monkeypatch, expectedGroup=GRUPPE, isReporter=True, alias='annen')
    slett = Mock(return_value={'ok': True, 'verified': True})
    monkeypatch.setattr('server.slett_funn', slett)
    handler._handle_ao_delete_sighting_post()
    slett.assert_called_once_with('L', 'A', 42, expected_group=GRUPPE)
    handler._send_json.assert_called_once_with({'ok': True, 'verified': True}, status=200)


def test_http_slett_feil_gir_200(monkeypatch):
    handler = handler_for(monkeypatch)
    handler._read_json_body.side_effect = ValueError('JSON')
    handler._handle_ao_delete_sighting_post()
    assert handler._send_json.call_args.args[0]['ok'] is False
    assert handler._send_json.call_args.kwargs['status'] == 200


@pytest.mark.parametrize('rad', [
    {**EGEN_RAD, 'ReporterUserAlias': 'sekretaer'},
    {**EGEN_RAD, 'Observers': ''},
])
def test_http_lagring_avviser_medobservator_og_ukjent_identitet_for_aapning(monkeypatch, rad):
    handler = handler_for(monkeypatch, rad)
    aapne = Mock()
    monkeypatch.setattr('server.ao_edit.ny_klient', aapne)
    handler._handle_ao_sighting_save_post()
    assert handler._send_json.call_args.args[0]['ok'] is False
    aapne.assert_not_called()


def test_http_lagring_avviser_flyttet_funn_for_aapning(monkeypatch):
    handler = handler_for(monkeypatch, expectedGroup={**GRUPPE, 'siteId': 8})
    aapne = Mock()
    monkeypatch.setattr('server.ao_edit.ny_klient', aapne)
    handler._handle_ao_sighting_save_post()
    assert handler._send_json.call_args.args[0]['ok'] is False
    assert 'ikke lenger' in handler._send_json.call_args.args[0]['error']
    aapne.assert_not_called()


def test_http_lagring_egen_matchende_gruppe_gaar_videre(monkeypatch):
    handler = handler_for(monkeypatch, expectedGroup=GRUPPE)
    klient = Mock()
    klient.__enter__ = Mock(return_value=klient)
    klient.__exit__ = Mock(return_value=None)
    monkeypatch.setattr('server.ao_edit.ny_klient', Mock(return_value=klient))
    monkeypatch.setattr('server.ao_edit.ko_rader', lambda *args: [])
    lagre = Mock(return_value={'ok': True, 'bekreftet': True})
    monkeypatch.setattr('server.ao_edit.rediger_atomisk', lagre)
    handler._handle_ao_sighting_save_post()
    lagre.assert_called_once()
    assert handler._send_json.call_args.args[0]['ok'] is True
