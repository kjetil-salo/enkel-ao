"""Tidsrom testes bare mot mockede AO-svar."""

from unittest.mock import Mock

import pytest

from src import ao_edit
from tests.fixtures.ao_edit_form import lag_skjema, S


FUNN = ao_edit.funn_fra_rad({
    'TaxonId': 4397, 'UniversalDate': '2026-11-18', 'SiteId': 123,
    'SiteName': 'Teststed', 'ActivityName': 'Stasjonær', 'Quantity': '3',
    'ReporterUserAlias': 'meg',
})


def body(endringer, html=None, funn=None):
    return ao_edit.bygg_save_body(html or lag_skjema(dato='18.11.2026 00:00:00'), funn or FUNN, endringer)


def verdier(liste, navn):
    return [v for n, v in liste if n == navn]


def test_tidsrom_endrer_kun_de_to_tidsfeltene():
    opprinnelig = body({})
    ny = body({'time_from': '09:15', 'time_to': '11:30'})
    assert verdier(ny, S + 'StartTime') == ['09:15']
    assert verdier(ny, S + 'EndTime') == ['11:30']
    assert verdier(ny, S + 'StartDate') == ['18.11.2026']
    assert verdier(ny, S + 'EndDate') == ['18.11.2026']
    tidsfelt = {S + 'StartTime', S + 'EndTime'}
    assert [(n, v) for n, v in ny if n not in tidsfelt] == [
        (n, v) for n, v in opprinnelig if n not in tidsfelt]


@pytest.mark.parametrize('fra,til', [
    ('00:00', '00:00'), ('23:59', '23:59'), ('00:00', '23:59'),
])
def test_gyldige_tidsgrenser(fra, til):
    assert verdier(body({'time_from': fra, 'time_to': til}), S + 'StartTime') == [fra]


@pytest.mark.parametrize('endringer', [
    {'time_from': '09:00'}, {'time_to': '10:00'},
    {'time_from': '9:00', 'time_to': '10:00'},
    {'time_from': '24:00', 'time_to': '24:01'},
    {'time_from': '09:60', 'time_to': '10:00'},
    {'time_from': '10:00', 'time_to': '09:59'},
    {'time_from': '', 'time_to': ''}, {'time_from': None, 'time_to': '10:00'},
    {'time_from': 900, 'time_to': 1000}, {'time_from': '09:00\n', 'time_to': '10:00'},
    {'coobserver_aliases': None}, {'coobserver_aliases': 'alias'},
    {'coobserver_aliases': ['']}, {'coobserver_aliases': [1]},
    {'coobserver_aliases': ['a'] * 11}, {'coobserver_aliases': ['a\nb']},
])
def test_ugyldige_endringer_avvises_foer_aapning(monkeypatch, endringer):
    aapne = Mock()
    publiser = Mock()
    monkeypatch.setattr(ao_edit, 'aapne_for_redigering', aapne)
    monkeypatch.setattr(ao_edit, 'publiser_tilbake', publiser)
    with pytest.raises(ao_edit.AoEditError):
        ao_edit.rediger_atomisk(Mock(), 1, FUNN, endringer)
    aapne.assert_not_called()
    publiser.assert_not_called()
    with pytest.raises(ao_edit.AoEditError):
        body(endringer)


def test_manglende_tidsfelt_i_ao_skjema_avvises():
    html = lag_skjema().replace(f'name="{S}EndTime"', 'name="ukjentSluttid"')
    with pytest.raises(ao_edit.AoEditError, match='tidsfeltene'):
        body({'time_from': '09:00', 'time_to': '10:00'}, html=html)


def test_funn_over_flere_dager_kan_ikke_faa_sluttdato_endret_stille():
    html = lag_skjema(dato='18.11.2026 00:00:00').replace(
        f'name="{S}EndDate" type="text" value="18.11.2026 00:00:00"',
        f'name="{S}EndDate" type="text" value="19.11.2026 00:00:00"')
    with pytest.raises(ao_edit.AoEditError, match='samme start- og sluttdato'):
        body({'time_from': '09:00', 'time_to': '10:00'}, html=html)


@pytest.mark.parametrize('tid', [
    'kl. 09:15-11:30', '<span>kl. 09:15–11:30</span>', '09:15 - 11:30',
])
def test_bekrefter_tidsrom_fra_ao(tid):
    res = ao_edit.bekreft(None, 1, FUNN, {'time_from': '09:15', 'time_to': '11:30'},
                         hent_rad=lambda _: {'UniversalDate': '2026-11-18', 'FormattedTime': tid})
    assert res['bekreftet'] is True


def test_et_tidspunkt_bekrefter_likt_start_og_slutt():
    res = ao_edit.bekreft(None, 1, FUNN, {'time_from': '09:15', 'time_to': '09:15'},
                         hent_rad=lambda _: {'UniversalDate': '2026-11-18', 'FormattedTime': 'kl. 09:15'})
    assert res['bekreftet'] is True


@pytest.mark.parametrize('rad', [
    {'UniversalDate': '2026-11-18', 'FormattedTime': '09:15-11:00'},
    {'UniversalDate': '2026-11-19', 'FormattedTime': '09:15-11:30'},
    {'UniversalDate': '2026-11-18'},
])
def test_avvik_eller_manglende_ao_tid_er_ikke_bekreftet(rad):
    res = ao_edit.bekreft(None, 1, FUNN, {'time_from': '09:15', 'time_to': '11:30'},
                         hent_rad=lambda _: rad)
    assert res['bekreftet'] is False

def test_medobservatorer_avvises_eksplisitt_uten_verifisert_skriveflyt():
    with pytest.raises(ao_edit.AoEditError, match='foreløpig gjøres hos Artsobservasjoner'):
        body({'coobserver_aliases': []})
