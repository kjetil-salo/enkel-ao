"""
Tester for henting av brukerens egne publiserte funn fra Artsobservasjoner.

Dekker tre ting hver for seg: at vi klarer å reprodusere AOs søkeskjema slik en
nettleser ville sendt det, at normaliseringen gjør AOs grid-markup om til rene
verdier, og at ingen feil fra AO kan boble opp til kalleren.
"""

import json
import os
import sys
import threading
from http.server import HTTPServer
from unittest.mock import Mock

import pytest
import requests

REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

from src.ao_sightings import (
    MAX_DAYS,
    AoSessionExpired,
    _has_image,
    _override,
    fetch_my_sightings,
    normalize_row,
    parse_search_form,
)
from server import Handler


def start_server(port):
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def _mock_client(responses):
    """
    Lag en mocket httpx.Client der `get` og `post` leverer svarene i rekkefølge.

    `responses` er en dict med nøklene 'get' og 'post', hver en liste av Mock-svar.
    """
    client = Mock()
    client.__enter__ = Mock(return_value=client)
    client.__exit__ = Mock(return_value=None)
    client.get = Mock(side_effect=list(responses.get('get', [])))
    client.post = Mock(side_effect=list(responses.get('post', [])))
    return client


def _resp(status=200, text='', url='', payload=None):
    r = Mock()
    r.status_code = status
    r.text = text
    r.url = url
    r.json = Mock(return_value=payload if payload is not None else {})
    return r


# ============================================================================
# Skjema-parsing — skal matche nettleserens FormData-oppførsel
# ============================================================================

# AOs faktiske prefiks. Fixturen må bruke det ekte navnet på feltene vi overstyrer,
# ellers tester vi ikke den koden som faktisk kjører (jf. fail-closed i _override).
KRIT = 'SearchViewModel.StoredSearchCriterias.SearchCriterias.'

SKJEMA = f"""
<html><body>
  <a href="/LogOff">Logg ut</a>
  <input name="utenfor" value="skal-ikke-med" />
  <form id="ViewSightingForm" action="/ViewSighting/ViewSightingAsTable" method="post">
    <input type="hidden" name="__RequestVerificationToken" value="TOKEN" />
    <input type="hidden" name="{KRIT}MyReportedSightings" value="false" />
    <input type="checkbox" name="{KRIT}MyReportedSightings" value="true" />
    <input type="hidden" name="{KRIT}MyObservedSightings" value="false" />
    <input type="checkbox" name="{KRIT}MyObservedSightings" value="true" checked="checked" />
    <input type="text" name="{KRIT}LastNumberOfDays" value="31" />
    <input type="submit" name="Shared_Search" value="Søk" />
    <input value="navnløs" />
    <select name="Krit.Fylke">
      <option value="">Alle</option>
      <option value="46" selected="selected">Vestland</option>
    </select>
    <select name="Krit.Sortering">
      <option value="dato">Dato</option>
      <option value="art">Art</option>
    </select>
    <textarea name="Krit.Fritekst">hei</textarea>
  </form>
</body></html>
"""


def test_parse_search_form_etterligner_nettleseren():
    felt = parse_search_form(SKJEMA)
    navn = [n for n, _ in felt]

    # Felt utenfor skjemaet, knapper og navnløse felt sendes ikke
    assert 'utenfor' not in navn
    assert 'Shared_Search' not in navn
    assert len(navn) == len(felt)

    # Uavhuket checkbox sendes ikke — kun den skjulte «false»-partneren
    assert felt.count((KRIT + 'MyReportedSightings', 'false')) == 1
    assert (KRIT + 'MyReportedSightings', 'true') not in felt

    # Avhuket checkbox sendes, og paret beholdes slik ASP.NET rendrer det
    assert (KRIT + 'MyObservedSightings', 'false') in felt
    assert (KRIT + 'MyObservedSightings', 'true') in felt

    assert ('__RequestVerificationToken', 'TOKEN') in felt
    assert (KRIT + 'LastNumberOfDays', '31') in felt


def test_parse_search_form_select_og_textarea():
    felt = dict(parse_search_form(SKJEMA))
    # Eksplisitt valgt opsjon
    assert felt['Krit.Fylke'] == '46'
    # Ingen opsjon markert valgt → nettleseren sender den første
    assert felt['Krit.Sortering'] == 'dato'
    assert felt['Krit.Fritekst'] == 'hei'


def test_parse_search_form_uten_skjema_gir_tom_liste():
    assert parse_search_form('<html><body><p>ingenting her</p></body></html>') == []


def test_override_erstatter_alle_forekomster_med_en():
    felt = [('a', '1'), ('b', 'false'), ('b', 'true'), ('c', '3')]
    ut = _override(felt, {'b': 'true'})

    assert [n for n, _ in ut].count('b') == 1
    assert ('b', 'true') in ut
    # Felt vi ikke rørte står igjen, i opprinnelig rekkefølge
    assert ut[:2] == [('a', '1'), ('c', '3')]


def test_override_krever_bare_de_pakrevde_feltene():
    """
    Hvilke kriterie-seksjoner AO rendrer er en lagret visningsinnstilling, så et felt
    kan mangle i HTML-en selv om ASP.NET binder det fint når vi poster det. Derfor
    legges valgfrie overstyringer til uansett — men et felt vi VET alltid er der
    (`LastNumberOfDays`) skal stoppe oss hvis det plutselig forsvinner.
    """
    ut = _override([('a', '1')], {'Krit.MyReportedSightings': 'true'})
    assert ('Krit.MyReportedSightings', 'true') in ut

    with pytest.raises(KeyError):
        _override([('a', '1')], {'Krit.Dager': '7'}, required=['Krit.Dager'])


# ============================================================================
# Normalisering av AOs grid-rader
# ============================================================================

AO_RAD = {
    'SightingId': 42022329,
    'TaxonId': 4173,
    'TaxonName': "<span data-taxonid='4173'>spettmeis</span>",
    'ScientificTaxonName': '<i>Sitta europaea</i>',
    'Quantity': '1',
    'ActivityName': 'Næringssøkende',
    'UniversalDate': '2026-10-24',
    'FormattedTime': 'kl. 12:54-12:56',
    'SiteName': 'Hatten',
    'SiteId': 1523333,
    'MediaLinkHtml': "<a href='/Sighting/42022329#SightingDetailImages'><span class='ikon'></span></a>",
    'ValidationStatusLabel': 'Ikke validert (funnet er ikke kvalitetssikret)',
    'TriggeredValidationRulesText': '',
    'PublicComment': None,
}


def test_normalize_row_renser_markup():
    n = normalize_row(AO_RAD)

    assert n['sightingId'] == 42022329
    assert n['taxonName'] == 'spettmeis'
    assert n['scientificName'] == 'Sitta europaea'
    assert n['time'] == '12:54-12:56'
    assert n['date'] == '2026-10-24'
    assert n['siteName'] == 'Hatten'
    assert n['url'] == 'https://www.artsobservasjoner.no/Sighting/42022329'
    assert n['publicComment'] == ''


def test_normalize_row_hasimage_folger_medialink():
    assert normalize_row(AO_RAD)['hasImage'] is True
    assert normalize_row({**AO_RAD, 'MediaLinkHtml': ''})['hasImage'] is False
    assert normalize_row({**AO_RAD, 'MediaLinkHtml': None})['hasImage'] is False


def test_hasimage_krever_galleri_ankeret_ikke_bare_markup():
    """
    `MediaLinkHtml` dekker også lyd, og AO kan rendre et tomt wrapper-element. Ville
    vi bare sjekket at feltet er ikke-tomt, ville hvert eneste funn sett ut som om
    det hadde bilde — og «Legg til bilde» aldri dukket opp.
    """
    assert _has_image("<a href='/Sighting/1#SightingDetailImages'><span></span></a>") is True
    assert _has_image("<span class='media-wrapper'></span>") is False
    assert _has_image("<a href='/Sighting/1#SightingDetailSounds'>lyd</a>") is False
    assert _has_image('') is False


def test_normalize_row_tar_med_aos_egen_innvending():
    rad = {**AO_RAD, 'TriggeredValidationRulesText': 'Angi et tidspunkt som ikke er passert'}
    assert normalize_row(rad)['triggeredRules'] == 'Angi et tidspunkt som ikke er passert'


def test_normalize_row_uten_tidspunkt():
    assert normalize_row({**AO_RAD, 'FormattedTime': ''})['time'] == ''


def test_normalize_row_er_hviteliste():
    """Nye felt hos AO skal ikke lekke ut i vårt API ved et uhell."""
    n = normalize_row({**AO_RAD, 'NyttFeltHosAo': 'hemmelig', 'AdminMenuItems': '<a>slett</a>'})

    assert 'NyttFeltHosAo' not in n
    assert 'AdminMenuItems' not in n


# ============================================================================
# fetch_my_sightings — normal vei, paginering og degradering
# ============================================================================

RESULTATSIDE = 'TotalPageCount=13'
RESULTAT_URL = ('https://www.artsobservasjoner.no/ViewSighting/'
                'ViewSightingAsTable?storedSearchCriterias=17088787')


def _oppsett_som_virker(sider=None):
    """
    `sider` er en liste av radlister — én per grid-kall. Utelatt gir én side med ett funn.
    """
    if sider is None:
        sider = [[AO_RAD]]
    poster = [_resp(200, RESULTATSIDE, url=RESULTAT_URL)]
    for rader in sider:
        poster.append(_resp(200, payload={'data': rader, 'total': sum(len(x) for x in sider)}))
    return {'get': [_resp(200, SKJEMA)], 'post': poster}


def test_utlopt_sesjon_oppdages_som_akkurat_det(monkeypatch):
    """
    AO svarer HTTP 200 med den ANONYME søkesiden når sesjonen er utløpt — ingen
    redirect, ingen feilkode. Eneste forskjellen er at «Mine observasjoner»-kriteriene
    ikke rendres. Bekreftet mot ekte AO 25.10.2026: den innloggede siden har
    MyReportedSightings to ganger, den uinnloggede null.

    Uten denne sjekken ser en utløpt sesjon ut som «du har ingen funn» — og brukeren
    har ingen anelse om at hun bare måtte logge inn igjen. Utloggingslenka er markøren:
    den finnes kun på en innlogget side.
    """
    anonym = SKJEMA.replace('<a href="/LogOff">Logg ut</a>', '<a href="/LogOn">Logg inn</a>')
    client = _mock_client({'get': [_resp(200, anonym)], 'post': []})
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    res = fetch_my_sightings('UTLOPT', 'UTLOPT')

    assert res['sightings'] == []
    assert res['needsLogin'] is True


def test_uten_tokens_sier_needslogin(monkeypatch):
    monkeypatch.setattr('httpx.Client',
                        lambda **kw: pytest.fail('Skal ikke kontakte AO uten innlogging'))

    assert fetch_my_sightings(None, None)['needsLogin'] is True


def test_overstyrer_ikke_fromdate_og_todate(monkeypatch):
    """
    `FromDate`/`ToDate` finnes ikke som skjemafelt i AOs rå HTML — de lages av
    datovelgeren i nettleseren. Å overstyre dem ville truffet fail-closed-sjekken i
    `_override` og gitt tom liste for alle, også med gyldig innlogging.
    """
    client = _mock_client(_oppsett_som_virker())
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    res = fetch_my_sightings('LOGIN', 'AUTH')

    assert len(res['sightings']) == 1
    body = client.post.call_args_list[0].kwargs['content']
    assert 'FromDate' not in body
    assert 'ToDate' not in body


def test_fetch_my_sightings_normal_vei(monkeypatch):
    client = _mock_client(_oppsett_som_virker())
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    res = fetch_my_sightings('LOGIN', 'AUTH', days=7)

    assert len(res['sightings']) == 1
    assert res['sightings'][0]['taxonName'] == 'spettmeis'
    assert res['truncated'] is False

    # Søket må be AO filtrere på egne rapporter — ellers får vi med funn der noen
    # andre er rapportør, som vi verken kan redigere eller legge bilde på.
    body = client.post.call_args_list[0].kwargs['content']
    assert 'MyReportedSightings=true' in body
    assert 'MyObservedSightings=false' in body
    assert 'LastNumberOfDays=7' in body

    # Grid-kallet må ha med TotalPageCount — uten den svarer AO HTTP 500
    grid_url = client.post.call_args_list[1].args[0]
    assert 'TotalPageCount=13' in grid_url
    assert 'StoredSearchCriterias=17088787' in grid_url


def test_cookies_settes_pa_klienten_ikke_pa_hver_request(monkeypatch):
    """
    httpx bygger Cookie-headeren på nytt fra klientens egen jar ved redirect, og
    dropper det som bare lå på requesten. Søket svarer med en 302, så cookies per
    request ville gitt en uinnlogget resultatside — uten TotalPageCount, og dermed
    en permanent tom liste. Samme felle som i `ao_import_httpx.fetch_csrf_tokens`.
    """
    sett = {}

    def fake_client(**kw):
        sett.update(kw)
        return _mock_client(_oppsett_som_virker())

    monkeypatch.setattr('httpx.Client', fake_client)
    fetch_my_sightings('LOGIN', 'AUTH')

    assert sett['cookies']['logintoken'] == 'LOGIN'
    assert sett['cookies']['.ASPXAUTHNO'] == 'AUTH'


def test_fetch_my_sightings_uten_tokens_gjor_ingen_kall(monkeypatch):
    def eksploder(**kw):
        raise AssertionError('Skal ikke kontakte AO uten innlogging')
    monkeypatch.setattr('httpx.Client', eksploder)

    assert fetch_my_sightings(None, None)['sightings'] == []
    assert fetch_my_sightings('LOGIN', '')['sightings'] == []


def test_fetch_my_sightings_klamrer_antall_dager(monkeypatch):
    client = _mock_client(_oppsett_som_virker())
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    fetch_my_sightings('LOGIN', 'AUTH', days=9999)

    body = client.post.call_args_list[0].kwargs['content']
    assert f'LastNumberOfDays={MAX_DAYS}' in body


def test_fetch_my_sightings_talder_ugyldig_days(monkeypatch):
    """Kontrakten er «tom liste ved feil» — også når kalleren sender søppel."""
    client = _mock_client(_oppsett_som_virker())
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    assert fetch_my_sightings('LOGIN', 'AUTH', days='abc')['sightings'] == []


def test_fetch_my_sightings_henter_flere_sider(monkeypatch):
    """En aktiv uke gir lett mer enn én side — da skal resten hentes, ikke kuttes."""
    side1 = [{**AO_RAD, 'SightingId': 1000 + i} for i in range(50)]
    side2 = [{**AO_RAD, 'SightingId': 2000 + i} for i in range(3)]
    client = _mock_client(_oppsett_som_virker([side1, side2]))
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    res = fetch_my_sightings('LOGIN', 'AUTH')

    assert len(res['sightings']) == 53
    assert res['truncated'] is False
    # Side 2 må faktisk ha blitt bedt om
    assert 'page=2' in client.post.call_args_list[2].kwargs['content']


def test_fetch_my_sightings_sier_fra_nar_lista_er_avkortet(monkeypatch):
    sider = [[{**AO_RAD, 'SightingId': 1000 + i} for i in range(50)]]
    oppsett = _oppsett_som_virker(sider)
    oppsett['post'][1] = _resp(200, payload={'data': sider[0], 'total': 339})
    client = _mock_client(oppsett)
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    res = fetch_my_sightings('LOGIN', 'AUTH', limit=50)

    assert len(res['sightings']) == 50
    assert res['total'] == 339
    assert res['truncated'] is True


def test_fetch_my_sightings_skjema_nede_gir_tom_liste(monkeypatch):
    client = _mock_client({'get': [_resp(503, 'nede')], 'post': []})
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    assert fetch_my_sightings('LOGIN', 'AUTH')['sightings'] == []


def test_fetch_my_sightings_uten_stored_id_gir_tom_liste(monkeypatch):
    client = _mock_client({
        'get': [_resp(200, SKJEMA)],
        'post': [_resp(200, 'ingen id her',
                       url='https://www.artsobservasjoner.no/ViewSighting/SearchSighting')],
    })
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    assert fetch_my_sightings('LOGIN', 'AUTH')['sightings'] == []


def test_fetch_my_sightings_uten_totalpagecount_gir_tom_liste(monkeypatch):
    """
    Mangler TotalPageCount, er resultatsiden ikke den vi tror (typisk en
    innloggingsside). Å gjette «0» ville gitt HTTP 500 fra grid-et uansett —
    bedre å si fra i loggen om hva som faktisk mangler.
    """
    client = _mock_client({
        'get': [_resp(200, SKJEMA)],
        'post': [_resp(200, 'ingen sidetall her', url=RESULTAT_URL)],
    })
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    assert fetch_my_sightings('LOGIN', 'AUTH')['sightings'] == []


def test_fetch_my_sightings_grid_feiler_gir_tom_liste(monkeypatch):
    oppsett = _oppsett_som_virker()
    oppsett['post'][1] = _resp(500, 'serverfeil')
    client = _mock_client(oppsett)
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    assert fetch_my_sightings('LOGIN', 'AUTH')['sightings'] == []


def test_feil_pa_senere_side_beholder_det_vi_har(monkeypatch):
    side1 = [{**AO_RAD, 'SightingId': 1000 + i} for i in range(50)]
    oppsett = _oppsett_som_virker([side1, []])
    oppsett['post'][2] = _resp(500, 'serverfeil')
    client = _mock_client(oppsett)
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    res = fetch_my_sightings('LOGIN', 'AUTH')

    assert len(res['sightings']) == 50
    assert res['truncated'] is True


def test_fetch_my_sightings_svelger_uventet_unntak(monkeypatch):
    def eksploder(**kw):
        raise RuntimeError('nettverket forsvant')
    monkeypatch.setattr('httpx.Client', eksploder)

    assert fetch_my_sightings('LOGIN', 'AUTH')['sightings'] == []


def test_fetch_my_sightings_hopper_over_rader_uten_id(monkeypatch):
    client = _mock_client(_oppsett_som_virker([[AO_RAD, {'TaxonName': 'uten id'}, None]]))
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    assert len(fetch_my_sightings('LOGIN', 'AUTH')['sightings']) == 1


# ============================================================================
# Endepunktet
# ============================================================================

def test_endepunkt_uten_tokens_svarer_tomt_og_200():
    port = 8771
    server = start_server(port)
    try:
        r = requests.post(f'http://localhost:{port}/api/ao-my-sightings',
                          json={}, timeout=5)
        assert r.status_code == 200
        assert r.json()['sightings'] == []
    finally:
        server.shutdown()


def test_endepunkt_talder_ugyldig_days(monkeypatch):
    sett = {}
    monkeypatch.setattr('server.fetch_my_sightings',
                        lambda lt, ac, days=None: sett.update(days=days) or
                        {'sightings': [], 'total': 0, 'truncated': False})
    port = 8776
    server = start_server(port)
    try:
        r = requests.post(f'http://localhost:{port}/api/ao-my-sightings',
                          json={'loginToken': 'L', 'authCookie': 'A', 'days': 'abc'}, timeout=5)
        assert r.status_code == 200
        assert sett['days'] == 14
    finally:
        server.shutdown()


def test_endepunkt_degraderer_ved_ao_feil(monkeypatch):
    monkeypatch.setattr('server.fetch_my_sightings',
                        lambda *a, **kw: (_ for _ in ()).throw(RuntimeError('AO nede')))
    port = 8772
    server = start_server(port)
    try:
        r = requests.post(f'http://localhost:{port}/api/ao-my-sightings',
                          json={'loginToken': 'L', 'authCookie': 'A'}, timeout=5)
        assert r.status_code == 200
        assert r.json()['sightings'] == []
    finally:
        server.shutdown()
