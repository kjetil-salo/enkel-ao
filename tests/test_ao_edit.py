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

def test_taxon_sendes_bare_EN_gang():
    """
    AO rendrer to elementer med navnet `Taxon`: artsvelgerens synlige felt og
    serverens skjulte verdi. Sender vi begge, binder ASP.NET «4397,4397» til én
    int og svarer «Feltet er obligatorisk [Taxon]» — HTTP 200, ingenting lagret.

    Nettleserens FormData inneholder riktignok to, men AOs eget JS gjør noe mer
    ved submit. Én verdi er det som faktisk gir 302 og lagring hos AO
    (verifisert 27.10.2026).
    """
    assert _verdier(_body(), S + 'Taxon') == ['4397']


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
    """Etterbestemmelse: gransanger → løvsanger."""
    body = _body(endringer={'taxon_id': '4330'})
    assert _verdier(body, S + 'Taxon') == ['4330']


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


def _uten_felt(navn):
    """Fjern ethvert element som bærer `navn`, uavhengig av attributt-rekkefølge."""
    import re as _re
    html = ao_edit_form.lag_skjema()
    mønster = _re.compile(
        r'<(input|select|textarea)\b[^>]*["\s]' + _re.escape(navn) + r'"[^>]*'
        r'(/>|>.*?</\1>)', _re.DOTALL | _re.IGNORECASE)
    ut = mønster.sub('', html)
    assert ut != html, f'fikk ikke fjernet {navn} fra fixturen'
    return ut


def test_manglende_paakrevd_felt_kaster():
    with pytest.raises(AoEditError, match='mangler felt'):
        _body(html=_uten_felt(S + 'Quantity'))


def test_feilmelding_navngir_hvilket_felt_som_mangler():
    with pytest.raises(AoEditError, match='Observers'):
        _body(html=_uten_felt(V + 'Observers[0].User'))


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
    assert _verdier(body, S + 'Taxon') == ['4397']
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


# ---------------------------------------------------------------------------
# Bekreftelse: AOs eget svar på om endringen tok
# ---------------------------------------------------------------------------

def _rad(**over):
    rad = {
        'TaxonId': 4397, 'Quantity': '3', 'ActivityName': 'Stasjonær',
        'UniversalDate': '2026-10-25', 'FormattedTime': 'kl. 15:52',
        'SiteId': 362858, 'StageName': '', 'GenderName': '', 'UnitName': '',
        'DiscoveryMethodName': '', 'PublicComment': None, 'PrivateComment': None,
    }
    rad.update(over)
    return rad


def test_bekreft_godtar_uendret_funn_ved_no_op():
    res = ao_edit.bekreft(None, 42030658, FUNN, {}, hent_rad=lambda _: _rad())
    assert res['bekreftet'] is True
    assert res['avvik'] == []


def test_bekreft_ser_at_antall_faktisk_ble_endret():
    res = ao_edit.bekreft(None, 1, FUNN, {'quantity': '7'},
                          hent_rad=lambda _: _rad(Quantity='7'))
    assert res['bekreftet'] is True


def test_bekreft_fanger_at_antall_IKKE_ble_endret():
    """Uten dette ville brukeren fått «endringen er sendt» på en endring AO forkastet."""
    res = ao_edit.bekreft(None, 1, FUNN, {'quantity': '7'},
                          hent_rad=lambda _: _rad(Quantity='3'))
    assert res['bekreftet'] is False
    assert 'Antall' in res['avvik'][0]


def test_bekreft_sammenligner_antall_som_tall_ikke_streng():
    """AO svarer '7' og klienten kan sende 7 — ulik type, samme verdi."""
    res = ao_edit.bekreft(None, 1, FUNN, {'quantity': 7},
                          hent_rad=lambda _: _rad(Quantity='7'))
    assert res['bekreftet'] is True


def test_bekreft_fanger_feil_art():
    res = ao_edit.bekreft(None, 1, FUNN, {'taxon_id': '4330'},
                          hent_rad=lambda _: _rad(TaxonId=4397))
    assert res['bekreftet'] is False
    assert 'Art' in res['avvik'][0]


def test_bekreft_fanger_feil_aktivitet():
    res = ao_edit.bekreft(None, 1, FUNN, {'activity_navn': 'Næringssøkende'},
                          hent_rad=lambda _: _rad(ActivityName='Stasjonær'))
    assert res['bekreftet'] is False
    assert 'Aktivitet' in res['avvik'][0]


def test_bekreft_aktivitet_er_ufolsom_for_store_bokstaver():
    res = ao_edit.bekreft(None, 1, FUNN, {'activity_navn': 'stasjonær'},
                          hent_rad=lambda _: _rad(ActivityName='Stasjonær'))
    assert res['bekreftet'] is True


def test_bekreft_uten_hent_rad_gir_vet_ikke_ikke_feil():
    """`None` betyr «vet ikke». Å returnere False ville meldt feil på noe som gikk bra."""
    res = ao_edit.bekreft(None, 1, FUNN, {'quantity': '7'})
    assert res['bekreftet'] is None
    assert res['avvik'] == []


def test_bekreft_nettverksfeil_gir_vet_ikke():
    def feiler(_):
        raise RuntimeError('AO svarte ikke')
    res = ao_edit.bekreft(None, 1, FUNN, {'quantity': '7'}, hent_rad=feiler)
    assert res['bekreftet'] is None


def test_bekreft_funn_borte_er_et_ekte_avvik():
    res = ao_edit.bekreft(None, 1, FUNN, {'quantity': '7'}, hent_rad=lambda _: None)
    assert res['bekreftet'] is False
    assert res['avvik']


def test_bekreft_rapporterer_feltene_vi_utelater():
    """
    `StageName`/`GenderName`/`UnitName`/`DiscoveryMethodName` er nettopp dem vi
    utelater fra bodyen. Blir de tømt av en AO-endring, må det kunne ses.
    """
    res = ao_edit.bekreft(None, 1, FUNN, {}, hent_rad=lambda _: _rad(UnitName='Individer'))
    assert res['ao']['UnitName'] == 'Individer'
    assert 'DiscoveryMethodName' in res['ao']


def test_bekreft_flere_avvik_samtidig():
    res = ao_edit.bekreft(None, 1, FUNN,
                          {'quantity': '7', 'taxon_id': '4330'},
                          hent_rad=lambda _: _rad())
    assert res['bekreftet'] is False
    assert len(res['avvik']) == 2


# ---------------------------------------------------------------------------
# Aktivitetslista til klienten
# ---------------------------------------------------------------------------

def test_aktivitetsliste_dropper_ikke_angitt():
    """
    `value="0"` med tom tekst er AOs «ikke angitt». Den må ikke bli et valgbart
    alternativ i appen — å velge den ville slettet aktiviteten.
    """
    _, options = ao_edit.parse_edit_form(ao_edit_form.lag_skjema())
    liste = [{'id': v, 'navn': t}
             for v, t in options[S + 'Activity'] if v and v != '0' and t]
    assert all(x['id'] != '0' for x in liste)
    assert {'id': '23', 'navn': 'Stasjonær'} in liste


# ---------------------------------------------------------------------------
# funn_fra_rad: oversettelsen fra AOs grid til skjemaets format
# ---------------------------------------------------------------------------

def test_funn_fra_rad_konverterer_dato_til_skjemaformat():
    """AO leverer ISO i grid-et, men skjemaet vil ha DD.MM.YYYY."""
    f = ao_edit.funn_fra_rad({'UniversalDate': '2026-10-25'})
    assert f['dato'] == '25.10.2026'


def test_funn_fra_rad_stripper_markup_fra_lokalitetsnavn():
    """`SiteName` kommer pakket i grid-markup."""
    f = ao_edit.funn_fra_rad({'SiteName': "<div class=''>Hylkje</div>"})
    assert f['site_name'] == 'Hylkje'


def test_funn_fra_rad_taaler_manglende_felt():
    f = ao_edit.funn_fra_rad({})
    assert f['dato'] == ''
    assert f['site_name'] == ''


def test_funn_fra_rad_taaler_rar_dato():
    f = ao_edit.funn_fra_rad({'UniversalDate': 'ikke en dato'})
    assert isinstance(f['dato'], str)


def test_funn_fra_rad_kan_mates_rett_inn_i_bygg_save_body():
    """Oversettelsen og byggingen må passe sammen — ellers er den til ingen nytte."""
    rad = {'TaxonId': 4397, 'Quantity': '3', 'ActivityName': 'Stasjonær',
           'UniversalDate': '2026-10-25', 'SiteId': 362858,
           'SiteName': "<div class=''>Hylkje</div>"}
    body = ao_edit.bygg_save_body(ao_edit_form.lag_skjema(), ao_edit.funn_fra_rad(rad))
    assert _en(body, S + 'Activity') == '23'
    assert _en(body, 'selectedSiteName') == 'Hylkje'
    assert _en(body, S + 'StartDate') == '25.10.2026'


# ---------------------------------------------------------------------------
# Sesjonsfeil
# ---------------------------------------------------------------------------

def test_ao_edit_og_ao_sightings_deler_sesjonsunntak():
    """
    Regresjonsvakt. To klasser med samme navn i hver sin modul ser identiske ut i
    koden, men `except ao_edit.AoSessionExpired` ville stille latt
    `ao_sightings`-varianten passere — og brukeren fått en tom feilmelding i
    stedet for «logg inn på nytt». Det skjedde 27.10.2026.
    """
    from src import ao_sightings
    assert ao_edit.AoSessionExpired is ao_sightings.AoSessionExpired


def test_sesjonsunntak_har_lesbar_tekst():
    """`str(exc)` havner i API-svaret. Tom streng er ubrukelig for brukeren."""
    assert 'utløpt' in str(ao_edit.AoSessionExpired()).lower()


# ---------------------------------------------------------------------------
# Dupliserte name-attributter (AOs faktiske HTML)
# ---------------------------------------------------------------------------

DOBBEL_HTML = """<html><body><form id="report">
<input Name="SightingViewModel.TemporarySighting.Sighting.Quantity"
       name="TemporarySighting.Sighting.Quantity" type="text" value="3"/>
<select Name="SightingViewModel.TemporarySighting.Sighting.Activity"
        name="TemporarySighting.Sighting.Activity">
<option value="0"></option><option value="23">Stasjonær</option></select>
</form></body></html>"""


def test_forste_name_attributt_vinner():
    """
    AO rendrer hvert felt med BÅDE `Name="SightingViewModel.X"` og `name="X"`.
    Python lowercaser attributtnavn, så `dict(attrs)` lar den siste vinne og
    mister prefikset — og hele skjemaet postes under navn ASP.NET ikke binder.
    Nettleseren tar den første. Traff i praksis 27.10.2026.
    """
    felt, options = ao_edit.parse_edit_form(DOBBEL_HTML)
    navn = [n for n, _, _ in felt]
    assert S + 'Quantity' in navn
    assert 'TemporarySighting.Sighting.Quantity' not in navn
    assert S + 'Activity' in options


def test_options_leses_ut_tross_dobbelt_navn():
    _, options = ao_edit.parse_edit_form(DOBBEL_HTML)
    assert ('23', 'Stasjonær') in options[S + 'Activity']


def test_csrf_cookie_settes_naar_den_er_oppgitt():
    """
    Antiforgery krever at form-token og cookie-token er et par fra samme request.
    Skjemaet hentes i ett HTTP-kall og postes i et annet; uten at cookien bæres
    over svarer AO HTTP 500 uten forklaring. Traff i praksis 27.10.2026.
    """
    c = ao_edit._cookies('t', 'a', 'csrf-verdi')
    assert c['__RequestVerificationToken'] == 'csrf-verdi'


def test_csrf_cookie_utelates_naar_den_mangler():
    """En tom cookie er verre enn ingen — den ville overstyrt en AO satte selv."""
    assert '__RequestVerificationToken' not in ao_edit._cookies('t', 'a')
    assert '__RequestVerificationToken' not in ao_edit._cookies('t', 'a', None)
    assert '__RequestVerificationToken' not in ao_edit._cookies('t', 'a', '')


# ---------------------------------------------------------------------------
# Save-svaret: 302 er suksess, 200 er en avvisning
# ---------------------------------------------------------------------------

class _FalskRespons:
    def __init__(self, status, text=''):
        self.status_code = status
        self.text = text


class _FalskKlient:
    def __init__(self, respons):
        self._respons = respons
        self.kalt = False

    def post(self, *a, **kw):
        self.kalt = True
        return self._respons


def test_lagre_godtar_302_som_suksess():
    k = _FalskKlient(_FalskRespons(302))
    assert ao_edit.lagre(k, [('a', 'b')]).status_code == 302


def test_lagre_avviser_200_som_valideringsfeil():
    """
    ASP.NET MVC svarer 200 når modellbinding eller validering feilet — skjemaet
    re-rendres og INGENTING er lagret. Å godta 200 skjulte en avvist endring
    fullstendig: Save «gikk bra», men funnet var uendret. 27.10.2026.
    """
    html = ('<div class="validation-summary-errors"><ul>'
            '<li>Antall må være større enn 0</li></ul></div>')
    k = _FalskKlient(_FalskRespons(200, html))
    with pytest.raises(AoEditError, match='Antall må være større enn 0'):
        ao_edit.lagre(k, [('a', 'b')])


def test_lagre_sier_fra_selv_uten_lesbar_feilmelding():
    k = _FalskKlient(_FalskRespons(200, '<html>ingen feilmelding her</html>'))
    with pytest.raises(AoEditError, match='uten at noe ble lagret'):
        ao_edit.lagre(k, [('a', 'b')])


def test_lagre_rapporterer_andre_statuskoder():
    k = _FalskKlient(_FalskRespons(500))
    with pytest.raises(AoEditError, match='HTTP 500'):
        ao_edit.lagre(k, [('a', 'b')])


def test_valideringsfeil_plukker_feltfeil():
    html = '<span class="field-validation-error">Oppgi et tall mellom 1 og 100.</span>'
    assert 'tall mellom 1 og 100' in ao_edit._valideringsfeil(html)


def test_valideringsfeil_dedupliserer():
    html = ('<span class="field-validation-error">Samme feil</span>'
            '<span class="field-validation-error">Samme feil</span>')
    assert ao_edit._valideringsfeil(html) == 'Samme feil'


def test_valideringsfeil_avkoder_entiteter():
    html = '<span class="field-validation-error">Antall m&#229; v&aelig;re satt</span>'
    assert 'må være satt' in ao_edit._valideringsfeil(html)


def test_valideringsfeil_paa_ren_html_er_tom():
    assert ao_edit._valideringsfeil('<html><body>ok</body></html>') == ''


def test_valideringsfeil_navngir_feltet():
    """
    «Feltet er obligatorisk» uten feltnavn er ubrukelig — bodyen har 149 felt.
    `data-valmsg-for` sier hvilket, og prefikset kortes ned så meldingen er lesbar.
    """
    html = ('<span class="field-validation-error" '
            'data-valmsg-for="SightingViewModel.TemporarySighting.Sighting.Unit">'
            'Feltet er obligatorisk</span>')
    assert ao_edit._valideringsfeil(html) == 'Feltet er obligatorisk [Unit]'


def test_valideringsfeil_finner_feltet_uansett_attributtrekkefolge():
    """En valgfri gruppe i samme regex matchet alltid tomt. Derfor to steg."""
    html = ('<span data-valmsg-for="SightingViewModel.SelectedSite.Id" '
            'class="field-validation-error">Feltet er obligatorisk</span>')
    assert '[SelectedSite.Id]' in ao_edit._valideringsfeil(html)
