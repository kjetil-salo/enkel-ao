"""Fjerning som medobservatør testes bare mot mocker, aldri ekte AO-funn."""

import threading
import time
from unittest.mock import Mock

import httpx
import pytest

from src import ao_coobserver
from src.ao_sightings import AoSessionExpired
from src.ao_sightings import normalize_row


def side(*aliaser, innlogget=True):
    return ('<a href="/LogOff">Logg ut</a>' if innlogget else '') + (
        '<span id="coobservers">'
        + ''.join(f'<span data-useralias="{alias}">{alias}</span>' for alias in aliaser)
        + '</span>')


def svar(html='', status=200, headers=None):
    return Mock(text=html, status_code=status, headers=headers or {})


@pytest.fixture(autouse=True)
def tom_sperreliste():
    ao_coobserver._UAVKLARTE.clear()
    yield
    ao_coobserver._UAVKLARTE.clear()


@pytest.fixture
def ao(monkeypatch):
    rad = {'SightingId': 42, 'ReporterUserAlias': 'sekretaer',
           'Observers': "<span data-useralias='meg' class='iscurrentuser'>Meg</span>"}
    hent = Mock(return_value=rad)
    monkeypatch.setattr(ao_coobserver, 'fetch_raw_row', hent)
    klient = Mock()
    klient.__enter__ = Mock(return_value=klient)
    klient.__exit__ = Mock(return_value=None)
    klient.get.side_effect = [svar(side('sekretaer', 'meg')), svar(side('sekretaer'))]
    klient.post.return_value = svar()
    monkeypatch.setattr(ao_coobserver.httpx, 'Client', Mock(return_value=klient))
    return klient, rad, hent


def test_fjerner_kun_gjeldende_bruker_og_leser_tilbake(ao):
    klient, _, hent = ao
    assert ao_coobserver.fjern_meg('L', 'A', 42) == {'ok': True, 'verified': True}
    hent.assert_called_once_with('L', 'A', 42)
    klient.post.assert_called_once_with(
        'https://www.artsobservasjoner.no/ViewSighting/ToggleObserver/42',
        json={'sightingId': 42},
        headers={'X-Requested-With': 'XMLHttpRequest',
                 'Referer': 'https://www.artsobservasjoner.no/Sighting/42'})
    assert klient.get.call_count == 2


@pytest.mark.parametrize('verdi', [None, '', 0, -1, 'abc', True, 4.2])
def test_ugyldig_id_sender_ingen_ao_kall(ao, verdi):
    klient, _, hent = ao
    assert ao_coobserver.fjern_meg('L', 'A', verdi)['ok'] is False
    hent.assert_not_called()
    klient.post.assert_not_called()


def test_manglende_innlogging(ao):
    klient, _, hent = ao
    assert ao_coobserver.fjern_meg('', 'A', 42)['needsLogin'] is True
    hent.assert_not_called()
    klient.post.assert_not_called()


@pytest.mark.parametrize('rapportert_av', ['meg', 'MEG', ''])
def test_rapportor_eller_ukjent_rolle_avvises(ao, rapportert_av):
    klient, rad, _ = ao
    rad['ReporterUserAlias'] = rapportert_av
    assert ao_coobserver.fjern_meg('L', 'A', 42)['ok'] is False
    klient.post.assert_not_called()


def test_ukjent_identitet_avvises(ao):
    klient, rad, _ = ao
    rad['Observers'] = '<span data-useralias="meg">Meg</span>'
    assert ao_coobserver.fjern_meg('L', 'A', 42)['ok'] is False
    klient.post.assert_not_called()


def test_allerede_fjernet_legges_aldri_til_igjen(ao):
    klient, _, _ = ao
    klient.get.side_effect = [svar(side('sekretaer'))]
    assert ao_coobserver.fjern_meg('L', 'A', 42) == {
        'ok': True, 'verified': True, 'alreadyRemoved': True}
    klient.post.assert_not_called()


@pytest.mark.parametrize('html', [side(), '<div>Endret markup</div>',
                                '<span id="coobservers"><span data-useralias="meg">Meg</span>'])
def test_ukjent_observatorliste_er_ikke_tom_liste(ao, html):
    klient, _, _ = ao
    klient.get.side_effect = [svar('<a href="/LogOff">Ut</a>' + html)]
    assert ao_coobserver.fjern_meg('L', 'A', 42)['ok'] is False
    klient.post.assert_not_called()


def test_utlopt_sesjon_for_mutasjon(ao):
    klient, _, hent = ao
    hent.side_effect = AoSessionExpired()
    assert ao_coobserver.fjern_meg('L', 'A', 42)['needsLogin'] is True
    klient.post.assert_not_called()


def test_anonym_funnside_for_mutasjon(ao):
    klient, _, _ = ao
    klient.get.side_effect = [svar(side('meg', 'sekretaer', innlogget=False))]
    assert ao_coobserver.fjern_meg('L', 'A', 42)['needsLogin'] is True
    klient.post.assert_not_called()


@pytest.mark.parametrize('feil', [httpx.ReadTimeout('ukjent utfall'), httpx.ConnectError('nede')])
def test_nettverksfeil_under_mutasjon_gir_usikkert_utfall_uten_retry(ao, feil):
    klient, _, _ = ao
    klient.post.side_effect = feil
    resultat = ao_coobserver.fjern_meg('L', 'A', 42)
    assert resultat['ok'] is False
    assert resultat['uncertain'] is True
    assert 'needsLogin' not in resultat
    assert klient.post.call_count == 1


def test_nytt_forsok_etter_timeout_sender_aldri_en_toggle_til(ao):
    klient, _, _ = ao
    klient.get.side_effect = lambda *args, **kwargs: svar(side('sekretaer', 'meg'))
    klient.post.side_effect = httpx.ReadTimeout('AO kan fortsatt arbeide')
    assert ao_coobserver.fjern_meg('L1', 'A', 42)['uncertain'] is True
    assert ao_coobserver.fjern_meg('L2', 'A', 42)['uncertain'] is True
    assert klient.post.call_count == 1


def test_bekreftet_fravaer_rydder_sperre_uten_ny_mutasjon(ao):
    klient, _, _ = ao
    klient.get.side_effect = [svar(side('sekretaer', 'meg')), svar(side('sekretaer'))]
    klient.post.side_effect = httpx.ReadTimeout('manglende kvittering')
    assert ao_coobserver.fjern_meg('L', 'A', 42)['uncertain'] is True
    assert ('meg', 42) in ao_coobserver._UAVKLARTE
    assert ao_coobserver.fjern_meg('L', 'A', 42) == {
        'ok': True, 'verified': True, 'alreadyRemoved': True}
    assert ('meg', 42) not in ao_coobserver._UAVKLARTE
    assert klient.post.call_count == 1


def test_full_sperreliste_avviser_ny_mutasjon_uten_a_kaste_ut_uavklarte(ao, monkeypatch):
    klient, _, _ = ao
    monkeypatch.setattr(ao_coobserver, '_MAKS_UAVKLARTE', 1)
    ao_coobserver._UAVKLARTE.add(('annen', 1))
    assert ao_coobserver.fjern_meg('L', 'A', 42)['ok'] is False
    assert ao_coobserver._UAVKLARTE == {('annen', 1)}
    klient.post.assert_not_called()


def test_full_sperreliste_tillater_kontroll_av_bekreftet_fravaer(ao, monkeypatch):
    klient, _, _ = ao
    monkeypatch.setattr(ao_coobserver, '_MAKS_UAVKLARTE', 1)
    ao_coobserver._UAVKLARTE.add(('meg', 42))
    klient.get.side_effect = [svar(side('sekretaer'))]
    assert ao_coobserver.fjern_meg('L', 'A', 42)['verified'] is True
    assert not ao_coobserver._UAVKLARTE
    klient.post.assert_not_called()


@pytest.mark.parametrize('etter', [svar(side('meg', 'sekretaer')), svar(status=503),
                                  svar(side('sekretaer', innlogget=False)), svar('ukjent')])
def test_manglende_bekreftelse_er_aldri_suksess(ao, etter):
    klient, _, _ = ao
    klient.get.side_effect = [svar(side('meg', 'sekretaer')), etter]
    resultat = ao_coobserver.fjern_meg('L', 'A', 42)
    assert resultat['ok'] is False
    assert resultat['uncertain'] is True
    assert 'needsLogin' not in resultat
    assert klient.post.call_count == 1


def test_to_klienter_med_ulike_tokens_kan_ikke_toggle_tilbake(ao):
    klient, _, hent = ao
    med = {'meg': True}
    klient.get.side_effect = lambda *args, **kwargs: svar(
        side('sekretaer', 'meg') if med['meg'] else side('sekretaer'))

    def toggle(*args, **kwargs):
        time.sleep(.02)
        med['meg'] = not med['meg']
        return svar()

    klient.post.side_effect = toggle
    resultater = []
    traader = [threading.Thread(target=lambda token=token: resultater.append(
        ao_coobserver.fjern_meg(token, 'A', 42))) for token in ('L1', 'L2')]
    for traad in traader:
        traad.start()
    for traad in traader:
        traad.join(timeout=3)
    assert len(resultater) == 2
    assert all(r['ok'] for r in resultater)
    assert med['meg'] is False
    assert klient.post.call_count == 1
    assert hent.call_count == 2


def test_http_handler_bruker_kun_tokens_og_id(monkeypatch):
    from server import Handler
    handler = Handler.__new__(Handler)
    handler._read_json_body = Mock(return_value={
        'loginToken': 'L', 'authCookie': 'A', 'sightingId': 42,
        'alias': 'noen-andre', 'isReporter': False})
    handler._send_json = Mock()
    fjern = Mock(return_value={'ok': True, 'verified': True})
    monkeypatch.setattr('server.fjern_meg', fjern)
    handler._handle_ao_remove_me_post()
    fjern.assert_called_once_with('L', 'A', 42)
    handler._send_json.assert_called_once_with({'ok': True, 'verified': True}, status=200)


def test_http_handler_degraderer_ved_feil(monkeypatch):
    from server import Handler
    handler = Handler.__new__(Handler)
    handler._read_json_body = Mock(side_effect=ValueError('ugyldig JSON'))
    handler._send_json = Mock()
    handler._handle_ao_remove_me_post()
    args, kwargs = handler._send_json.call_args
    assert args[0]['ok'] is False
    assert kwargs['status'] == 200


@pytest.mark.parametrize('alias,rapportor,observator,forventet', [
    ('meg', 'sekretaer', 'meg', True),
    ('meg', 'meg', 'meg', False),
    ('meg', 'MEG', 'meg', False),
    (None, 'sekretaer', 'meg', False),
    ('meg', '', 'meg', False),
    ('meg', 'sekretaer', 'annen', False),
])
def test_fjern_knapp_krever_bekreftet_medobservatorrolle(alias, rapportor, observator, forventet):
    rad = {'SightingId': 42, 'ReporterUserAlias': rapportor,
           'Observers': f"<span data-useralias='{observator}' class='iscurrentuser'>Meg</span>"}
    assert normalize_row(rad, alias)['canRemoveSelf'] is forventet
