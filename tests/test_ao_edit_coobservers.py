"""Observatørvalg testes med mocker, aldri med skriving til ekte AO-funn."""

from unittest.mock import Mock

import pytest

from src import ao_observers
from src import ao_edit
from tests.fixtures import ao_edit_form


@pytest.fixture
def setup_ao(monkeypatch):
    rad = {'SightingId': 42, 'ReporterUserAlias': 'meg', 'UniversalDate': '2026-11-18', 'SiteId': 10,
           'Observers': '<span data-useralias="meg" class="iscurrentuser">Meg</span>'
                        '<span data-useralias="annen">En annen</span>'}
    hent = Mock(return_value=rad)
    monkeypatch.setattr(ao_observers, 'fetch_raw_row', hent)
    klient = Mock()
    klient.__enter__ = Mock(return_value=klient)
    klient.__exit__ = Mock(return_value=None)
    klient.get.return_value = Mock(status_code=200, text='<a href="/LogOff">Ut</a>' + ao_edit_form.lag_skjema())
    monkeypatch.setattr(ao_edit, 'ny_klient', Mock(return_value=klient))
    return rad, hent, klient


def test_setup_leser_nytt_skjema_uten_edit_eller_skriving(setup_ao):
    _, _, klient = setup_ao
    svar = ao_observers.observer_setup('L', 'A', 42, {'date': '2026-11-18', 'siteId': 10})
    assert svar['ok'] is True
    assert svar['selfAlias'] == 'meg'
    assert svar['coobservers'] == [{'alias': 'meg', 'name': 'Meg'}, {'alias': 'annen', 'name': 'En annen'}]
    klient.get.assert_called_once_with('https://www.artsobservasjoner.no/SubmitSighting/Report',
                                     follow_redirects=True, timeout=25)
    klient.post.assert_not_called()
    assert set(svar) == {'ok', 'selfAlias', 'coobservers', 'observerFields'}


@pytest.mark.parametrize('id_verdi', [None, '', 0, -1, True, 1.2, 'abc'])
def test_setup_avviser_ugyldige_ider(setup_ao, id_verdi):
    _, hent, klient = setup_ao
    assert ao_observers.observer_setup('L', 'A', id_verdi)['ok'] is False
    hent.assert_not_called()
    klient.get.assert_not_called()


def test_setup_krever_innlogging(setup_ao):
    _, hent, _ = setup_ao
    assert ao_observers.observer_setup('', 'A', 42)['needsLogin'] is True
    hent.assert_not_called()


@pytest.mark.parametrize('rapportor', ['annen', ''])
def test_setup_krever_egen_rapportor(setup_ao, rapportor):
    rad, _, klient = setup_ao
    rad['ReporterUserAlias'] = rapportor
    assert ao_observers.observer_setup('L', 'A', 42)['ok'] is False
    klient.get.assert_not_called()


def test_setup_avviser_flyttet_funn(setup_ao):
    _, _, klient = setup_ao
    assert ao_observers.observer_setup('L', 'A', 42, {'date': '2026-11-17', 'siteId': 10})['ok'] is False
    klient.get.assert_not_called()


def test_setup_ukjent_observatorstruktur_gir_ingen_falsk_suksess(setup_ao):
    _, _, klient = setup_ao
    klient.get.return_value.text = '<a href="/LogOff">Ut</a><form id="report"><input name="annet"></form>'
    assert ao_observers.observer_setup('L', 'A', 42)['ok'] is False


def test_setup_utlopt_sesjon(setup_ao):
    _, _, klient = setup_ao
    klient.get.return_value.text = 'Logg inn'
    assert ao_observers.observer_setup('L', 'A', 42)['needsLogin'] is True


@pytest.mark.parametrize('verdi', [None, 'alias', [None], [''], ['  '], [True], ['a\nb'], ['a' * 201], ['a'] * 11])
def test_aliaser_maa_vaere_en_kort_liste_med_gyldige_strenger(verdi):
    with pytest.raises(ValueError):
        ao_observers.valider_aliaser(verdi)


def test_aliaser_dedupliseres_uten_aa_gjette_visningsnavn():
    assert ao_observers.valider_aliaser(['Anne', 'anne', ' per ']) == ['Anne', 'per']
    assert ao_observers.valider_aliaser([]) == []


def test_aliasoppslag_krever_eksakt_alias_ikke_likt_navn():
    klient = Mock()
    klient.post.return_value.status_code = 200
    klient.post.return_value.json.return_value = [
        {'Id': 1, 'UserAlias': 'riktig', 'PresentationName': 'Anne Hansen'},
        {'Id': 2, 'UserAlias': 'en-annen', 'PresentationName': 'Anne Hansen'},
    ]
    assert ao_observers.slaa_opp_alias(klient, 'RIKTIG')['id'] == 1
    with pytest.raises(ValueError):
        ao_observers.slaa_opp_alias(klient, 'Anne Hansen')


@pytest.mark.parametrize('brukere', [[], {}, [{'Id': 0, 'UserAlias': 'meg'}],
                                    [{'Id': True, 'UserAlias': 'meg'}],
                                    [{'Id': 1, 'UserAlias': 'meg'}, {'Id': 2, 'UserAlias': 'meg'}]])
def test_ukjent_eller_tvetydig_alias_avvises(brukere):
    klient = Mock()
    klient.post.return_value.status_code = 200
    klient.post.return_value.json.return_value = brukere
    with pytest.raises(ValueError):
        ao_observers.slaa_opp_alias(klient, 'meg')
