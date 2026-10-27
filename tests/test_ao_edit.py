"""
Tester for `src/ao_edit.py` — rekonstruksjon av AOs Save-body.

Vekten ligger på fellene som ble målt mot ekte AO 26.10.2026, ikke på at koden
«kjører». Hver test navngir hvilken feil den fanger, fordi konsekvensen av en
regresjon her er stille datatap i den nasjonale artsdatabasen.
"""

import pytest

from src import ao_edit
from src.ao_edit import AoEditError
from tests.fixtures import ao_edit_form

S = ao_edit._S
V = ao_edit._V

FUNN = {
    'taxon_id': '4397',
    'dato': '25.10.2026',
    'site_id': '362858',
    'site_name': 'Hylkje',
    'activity_navn': 'Stasjonær',
}


def _body(html=None, funn=None, endringer=None):
    return ao_edit.bygg_save_body(
        html if html is not None else ao_edit_form.lag_skjema(),
        funn or FUNN,
        endringer,
    )


def _verdier(body, navn):
    return [v for (n, v) in body if n == navn]


def _en(body, navn):
    verdier = _verdier(body, navn)
    assert len(verdier) == 1, f'{navn} forekom {len(verdier)} ganger: {verdier}'
    return verdier[0]


# ---------------------------------------------------------------------------
# Aktivitet — den farligste enkeltfella
# ---------------------------------------------------------------------------

def test_aktivitet_slaas_opp_fra_aos_egen_valgliste():
    """«Stasjonær» → 23, hentet fra options i samme HTML. Ingen hardkodet tabell."""
    assert _en(_body(), S + 'Activity') == '23'


def test_aktivitet_blir_aldri_null_fra_forste_opsjon():
    """
    Regresjonsvakt: `_FormParser` i ao_sightings faller tilbake til FØRSTE opsjon
    når ingen er `selected`. For Activity er den `value="0"` (tom), så gjenbruk av
    den parseren ville SLETTET aktiviteten fra funnet.
    """
    assert _en(_body(), S + 'Activity') != '0'


def test_ukjent_aktivitetsnavn_kaster_framfor_aa_gjette():
    """Å gjette her ville sendt et tomt aktivitetsfelt til AO."""
    funn = {**FUNN, 'activity_navn': 'Finnes ikke i AO'}
    with pytest.raises(AoEditError, match='aktivitets-ID'):
        _body(funn=funn)


def test_aktivitet_kan_overstyres_av_bruker():
    body = _body(endringer={'activity_id': '25'})
    assert _en(body, S + 'Activity') == '25'


def test_oppslag_er_ufolsomt_for_store_bokstaver():
    funn = {**FUNN, 'activity_navn': 'stasjonær'}
    assert _en(_body(funn=funn), S + 'Activity') == '23'


# ---------------------------------------------------------------------------
# Rå HTML lyver — verdiene som må overstyres
# ---------------------------------------------------------------------------

def test_taxon_sendes_to_ganger_med_samme_id():
    """
    AO rendrer `Taxon` to ganger, der ANDRE forekomst er en rå .NET-typestreng.
    Nettleseren sender ID-en begge gangene.
    """
    assert _verdier(_body(), S + 'Taxon') == ['4397', '4397']


def test_dotnet_typestreng_lekker_aldri_ut():
    body = _body()
    assert not any('Artportalen.ObjectModel' in str(v) for (_, v) in body)


def test_dato_normaliseres_uten_klokkeslett():
    """Rå HTML har `25.10.2026 00:00:00`; nettleseren sender `25.10.2026`."""
    body = _body()
    assert _en(body, S + 'StartDate') == '25.10.2026'
    assert _en(body, S + 'EndDate') == '25.10.2026'


def test_dato_uten_suffiks_staar_urort():
    funn = {**FUNN, 'dato': '01.01.2026'}
    assert _en(_body(funn=funn), S + 'StartDate') == '01.01.2026'


def test_lokalitetsnavn_overstyres_ikke_false():
    """
    `selectedSiteName` har verdien `"false"` i rå HTML — ikke tom. Et round-trip
    som stoler på value-attributtet sender lokalitetsnavnet `false` til AO.
    """
    assert _en(_body(), 'selectedSiteName') == 'Hylkje'


def test_site_id_settes_selv_naar_raa_html_er_tom():
    assert _en(_body(), V + 'SelectedSite.Id') == '362858'


def test_artsgruppe_settes_paa_begge_feltene():
    body = _body()
    assert _en(body, 'selectedSiteSpeciesGroupId') == '8'
    assert _en(body, 'currentSpeciesGroupId') == '8'


def test_koordinatsystem_settes():
    assert _en(_body(), 'coordinatesystem') == 'UTM(WGS 84)'


# ---------------------------------------------------------------------------
# Feltene AOs JavaScript deaktiverer
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('felt', [
    S + 'Unit',
    S + 'DiscoveryMethod',
    S + 'Length',
    S + 'Weight',
    S + 'QuantityOfSubstrate',
    V + 'ExternalId',
    V + 'NewSite.NewSiteCoordinate.CoordEast',
    V + 'NewSite.NewSiteCoordinate.CoordinateSystem',
    'Shared_SaveChanges',
])
def test_deaktiverte_felt_sendes_ikke(felt):
    """
    JS setter `disabled` på disse etter sidelast. `disabled` finnes ikke i rå HTML,
    så de må utelates fra en målt liste. `Unit` er den farligste: den ville endret
    enheten på funnet.
    """
    assert _verdier(_body(), felt) == []


def test_siteviewmodel_dublettwidget_sendes_aldri():
    body = _body()
    assert not any(n.startswith('SiteViewModel.') for (n, _) in body)


# ---------------------------------------------------------------------------
# Select-defaults
# ---------------------------------------------------------------------------

def test_stage_og_gender_settes_til_ikke_angitt():
    body = _body()
    assert _en(body, S + 'Stage') == '0'
    assert _en(body, S + 'Gender') == '0'


def test_ovrige_select_defaults():
    body = _body()
    assert _en(body, S + 'SightingSpeciesCollectionItem.SpeciesCollection') == '-1'
    assert _en(body, V + 'FavoriteSite') == ''
    assert _en(body, V + 'UserMapExtent') == '-1'


# ---------------------------------------------------------------------------
# Nettleserens FormData-semantikk
# ---------------------------------------------------------------------------

def test_checkbox_par_reproduseres():
    """ASP.NET sender avhukede checkboxer som true/false-par. Må ikke dedupliseres."""
    assert _verdier(_body(), V + 'Observers[0].IsSelected') == ['true', 'false']


def test_uavhuket_checkbox_sendes_ikke():
    assert _verdier(_body(), 'DontClearOnSave') == []


def test_knapper_sendes_ikke():
    body = _body()
    assert _verdier(body, 'enKnapp') == []
    assert _verdier(body, 'Shared_SaveChanges') == []


def test_base_legges_til_selv_om_den_mangler_i_raa_html():
    """
    `base` finnes ikke i rå HTML i det hele tatt — JS lager sju radioknapper for
    kartlagsvelgeren. Nettleseren sender den første.
    """
    assert _en(_body(), 'base') == 'on'


def test_textarea_blir_med_som_tom_streng():
    assert _en(_body(), S + 'PublicComment.Comment') == ''


# ---------------------------------------------------------------------------
# Brukerens endringer
# ---------------------------------------------------------------------------

def test_antall_overstyres():
    assert _en(_body(endringer={'quantity': '7'}), S + 'Quantity') == '7'


def test_antall_uendret_naar_ikke_oppgitt():
    assert _en(_body(), S + 'Quantity') == '3'


def test_art_overstyres():
    """Etterbestemmelse: gransanger → løvsanger. Begge forekomster må endres."""
    body = _body(endringer={'taxon_id': '4330'})
    assert _verdier(body, S + 'Taxon') == ['4330', '4330']


def test_antall_null_respekteres_ikke_som_fravaerende():
    """`quantity='0'` er en verdi, ikke «ikke oppgitt» — falsy-feller."""
    assert _en(_body(endringer={'quantity': '0'}), S + 'Quantity') == '0'


# ---------------------------------------------------------------------------
# Fail-closed
# ---------------------------------------------------------------------------

def test_kort_skjema_gir_tydelig_feil():
    """
    Åpner man samme funn to ganger, svarer AO med et 34 KB-skjema uten #report.
    Det må gi en forklarende feil, ikke en tom body som tømmer funnet.
    """
    with pytest.raises(AoEditError, match='gjennomgangskøen'):
        _body(html=ao_edit_form.KORT_SKJEMA)


def test_manglende_paakrevd_felt_kaster():
    html = ao_edit_form.lag_skjema().replace(
        f'<input name="{S}Quantity" type="text" value="3"/>', '')
    with pytest.raises(AoEditError, match='mangler felt'):
        _body(html=html)


def test_feilmelding_navngir_hvilket_felt_som_mangler():
    html = ao_edit_form.lag_skjema().replace(
        f'<input name="{V}Observers[0].User" type="hidden" value="15969"/>', '')
    with pytest.raises(AoEditError, match='Observers'):
        _body(html=html)


# ---------------------------------------------------------------------------
# Helheten
# ---------------------------------------------------------------------------

def test_csrf_og_tempsighting_baeres_videre():
    body = _body()
    assert _en(body, '__RequestVerificationToken') == 'TESTTOKEN-ikke-ekte'
    assert _en(body, V + 'SelectedTempSightings') == '30826136'


def test_no_op_endrer_ingen_funndata():
    """
    Uten `endringer` skal de feltene som bærer funnets innhold være identiske med
    funnets faktiske verdier. Dette er no-op-round-trippets kjerne.
    """
    body = _body()
    assert _en(body, S + 'Quantity') == '3'
    assert _en(body, S + 'Activity') == '23'
    assert _verdier(body, S + 'Taxon') == ['4397', '4397']
    assert _en(body, S + 'StartDate') == '25.10.2026'
    assert _en(body, S + 'StartTime') == '15:52'
    assert _en(body, V + 'SelectedSite.Id') == '362858'
    assert _en(body, V + 'Observers[0].User') == '15969'


def test_ingen_verdi_er_none():
    """En `None` ville blitt strengen «None» i url-encoding og havnet hos AO."""
    body = _body()
    assert [n for (n, v) in body if v is None] == []


def test_options_leses_ut_med_tekst():
    _, options = ao_edit.parse_edit_form(ao_edit_form.lag_skjema())
    assert ('23', 'Stasjonær') in options[S + 'Activity']


def test_finn_option_id_paa_tomt_navn():
    _, options = ao_edit.parse_edit_form(ao_edit_form.lag_skjema())
    assert ao_edit.finn_option_id(options, S + 'Activity', None) is None
    assert ao_edit.finn_option_id(options, S + 'Activity', '') is None


def test_bygg_save_body_gjoer_ingen_nettverkskall(monkeypatch):
    """
    Vakt for en egenskap som må bevares: all funndata skal være hentet FØR
    skjemaet åpnes, fordi åpningen gjør funnet upublisert. Et nettverkskall inne
    i byggingen kan feile og etterlate funnet usynlig for andre — det skjedde i
    første kjøring av no-op-porten 27.10.2026.
    """
    def eksploder(*a, **kw):
        raise AssertionError('bygg_save_body() forsøkte et nettverkskall')

    monkeypatch.setattr(ao_edit.httpx, 'Client', eksploder)
    monkeypatch.setattr(ao_edit.httpx, 'get', eksploder, raising=False)
    monkeypatch.setattr(ao_edit.httpx, 'post', eksploder, raising=False)

    body = _body()
    assert len(body) > 0
