"""
Bygg en Save-body for AOs redigeringsskjema, bit-identisk med nettleserens.

Dette er grunnmuren under en endringsside i appen, og den eneste delen som
faktisk er farlig: et felt vi reproduserer feil blir tomt i den nasjonale
artsdatabasen, uten feilmelding.

## Hvorfor dette ikke er et vanlig skjema-round-trip

`ao_sightings.parse_search_form()` kan sende søkeskjemaet tilbake nesten slik det
kom. Det går ikke her, av tre grunner som alle er målt (26.10.2026, se
`docs/ao-rediger-maling-2026-10-26.md`):

1. **AOs JavaScript deaktiverer 23 felt** etter at siden er lastet. `disabled`
   finnes IKKE i rå HTML — der er alle 211 feltene aktive. Sender vi dem, sender vi
   verdier nettleseren utelater, blant dem `Unit` og `DiscoveryMethod`.
2. **Rå HTML inneholder ubrukelige verdier som JS retter opp.** `Taxon` har en rå
   .NET-typestreng (`Artportalen.ObjectModel...Taxon`) i sin andre forekomst, datoene
   har `00:00:00`-suffiks, `selectedSiteName` er `"false"`, og `SelectedSite.Id` er tom.
3. **`<select>` rendres uten `selected`.** Nettleseren ville ellers valgt den FØRSTE
   opsjonen, og for `Activity` er det `value="0"` (tom) — altså ville en naiv
   round-trip SLETTET aktiviteten fra funnet.

Punkt 3 er grunnen til at `ao_sightings._FormParser` ikke kan gjenbrukes: dens
«ingen selected? send første» er riktig for søk og ødeleggende her.

## Beviset

`bygg_save_body()` er verifisert ved å rekonstruere bodyen fra rå HTML og
sammenligne den, felt for felt og verdi for verdi, mot nettleserens egen
`FormData` på det samme åpne skjemaet: **149 av 149 entries identiske, null avvik**
(alt bortsett fra `__RequestVerificationToken` og `SelectedTempSightings`, som er
nye per økt). Sammenligningen ble gjort uten å sende noe til AO.
"""

import logging
import re
from html.parser import HTMLParser

logger = logging.getLogger('fugleobs')

AO_BASE = 'https://www.artsobservasjoner.no'

EDIT_FORM_ID = 'report'

_S = 'SightingViewModel.TemporarySighting.Sighting.'
_V = 'SightingViewModel.'

# Artsgruppe: 8 = fugler. Appen rapporterer bare fugler, så dette er konstant her.
FUGLER_GRUPPE_ID = '8'


class AoEditError(Exception):
    """Skjemaet fra AO er ikke det vi forventet — avbryt framfor å gjette."""


# ---------------------------------------------------------------------------
# De 23 feltene AOs JavaScript deaktiverer
# ---------------------------------------------------------------------------
# Målt i den rendrede DOM-en; `disabled` finnes ikke i rå HTML. To grupper:
#
#   a) artsgruppe-spesifikke felt AO skjuler for fugler
#   b) hele «opprett ny lokalitet»-widgetens koordinatdel — funnet bruker en
#      eksisterende lokalitet, så den er irrelevant
#
# Dette er en MÅLT liste, ikke en utledet regel. Det finnes ingen strukturell regel
# i rå HTML som skiller dem ut: 15 av dem har til og med en verdi (`CoordEast=0`,
# `CoordinateSystem=13`). Hypotesen «select uten selected, eller input uten value»
# ble testet og motbevist på 26 av 32 felt.
UTELAT_FELT = frozenset({
    # a) artsgruppe-spesifikt
    _S + 'Unit',
    _S + 'DiscoveryMethod',
    _S + 'Length',
    _S + 'Weight',
    _S + 'QuantityOfSubstrate',
    _S + 'SightingSpeciesCollectionItem.SpeciesCollector',
    # b) ny-lokalitet-widgeten
    _V + 'ProjectForNewSite',
    _V + 'ProjectForNewSite_Name',
    _V + 'ExternalId',
    _V + 'NewSite.Site.AccuracyDisplay',
    _V + 'NewSite.Site.Parent',
    _V + 'NewSite.NewSiteCoordinate.CoordinateSystem',
    _V + 'NewSite.NewSiteCoordinate.CoordinateSystem_csgroup',
    _V + 'NewSite.NewSiteCoordinate.CoordinateSystem_cszone',
    _V + 'NewSite.NewSiteCoordinate.CoordinateSystem_csnotation',
    _V + 'NewSite.NewSiteCoordinate.CoordinateSystem_selectedNotation',
    _V + 'NewSite.NewSiteCoordinate.CoordEast',
    _V + 'NewSite.NewSiteCoordinate.CoordNorth',
    _V + 'NewSite.NewSiteCoordinate.Longitude',
    _V + 'NewSite.NewSiteCoordinate.Latitude',
    _V + 'NewSite.NewSiteCoordinate.MgrsNotation',
    # sendes aldri av nettleseren
    'Shared_SaveChanges',
})

# `SiteViewModel.*` er en DUBLETT av ny-lokalitet-widgeten. Nettleseren sender ingen
# av dem — alle er deaktivert av JS.
UTELAT_PREFIKS = ('SiteViewModel.',)

# ---------------------------------------------------------------------------
# De 7 nedtrekkslistene uten `selected` som JS likevel fyller ut
# ---------------------------------------------------------------------------
# `0` betyr «ikke angitt» hos AO. `Activity` står IKKE her — den må komme fra
# funnets egne data, ellers ville vi nullet ut aktiviteten.
SELECT_DEFAULTS = {
    _S + 'Stage': '0',
    _S + 'Gender': '0',
    _S + 'DeterminationMethod': '0',
    _S + 'SightingSpeciesCollectionItem.SpeciesCollection': '-1',
    _V + 'FavoriteSite': '',
    _V + 'UserMapExtent': '-1',
}

# Finnes IKKE i rå HTML. JS lager sju radioknapper for kartlagsvelgeren, og den
# første er avhuket. Rent kosmetisk for kartet, men nettleseren sender den.
EKSTRA_FELT = (('base', 'on'),)

_DATO_RE = re.compile(r'^(\d{2}\.\d{2}\.\d{4})')

# Felt som MÅ finnes i skjemaet. Mangler ett, er skjemaet ikke det vi tror — da er
# det tryggere å kaste enn å poste en body som stille tømmer et felt hos AO.
PAAKREVDE_FELT = (
    '__RequestVerificationToken',
    _V + 'SelectedTempSightings',
    _S + 'Taxon',
    _S + 'Quantity',
    _S + 'Activity',
    _S + 'StartDate',
    _V + 'SelectedSite.Id',
    _V + 'Observers[0].User',
)


class _EditFormParser(HTMLParser):
    """
    Les redigeringsskjemaet slik det kom fra serveren, UTEN å etterligne nettleseren.

    Forskjellen fra `ao_sightings._FormParser` er bevisst: her skilles «select uten
    selected» fra «select med selected», i stedet for å falle tilbake til første
    opsjon. Fallbacken ville satt `Activity=0` og slettet aktiviteten.

    Alle options samles også opp, slik at kalleren kan slå opp et aktivitetsnavn
    og få AOs egen ID — uten en hardkodet tabell som ville råtnet.
    """

    def __init__(self, form_id=EDIT_FORM_ID):
        super().__init__(convert_charrefs=True)
        self._form_id = form_id
        self._in_form = False
        self._select_name = None
        self._select_chosen = None
        self._select_options = None
        self._option_value = None
        self._option_text = None
        self._textarea_name = None
        self._textarea_value = None
        # (navn, verdi, slag) der slag er 'felt' | 'select' | 'select-uvalgt'
        self.felt = []
        # navn -> [(verdi, tekst)]
        self.options = {}

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)

        if tag == 'form':
            self._in_form = a.get('id') == self._form_id
            return
        if not self._in_form:
            return

        if tag == 'input':
            name = a.get('name')
            if not name:
                return
            itype = (a.get('type') or 'text').lower()
            if itype in ('submit', 'button', 'image', 'reset', 'file'):
                return
            if itype in ('checkbox', 'radio') and 'checked' not in a:
                return
            self.felt.append((name, a.get('value', ''), 'felt'))

        elif tag == 'select':
            self._select_name = a.get('name')
            self._select_chosen = None
            self._select_options = []

        elif tag == 'option' and self._select_name is not None:
            self._option_value = a.get('value', '')
            self._option_text = []
            if 'selected' in a:
                self._select_chosen = self._option_value

        elif tag == 'textarea':
            self._textarea_name = a.get('name')
            self._textarea_value = []

    def handle_data(self, data):
        if self._option_text is not None:
            self._option_text.append(data)
        elif self._textarea_value is not None:
            self._textarea_value.append(data)

    def handle_endtag(self, tag):
        if tag == 'form':
            self._in_form = False

        elif tag == 'option' and self._option_value is not None:
            if self._select_options is not None:
                self._select_options.append(
                    (self._option_value, ''.join(self._option_text or []).strip()))
            self._option_value = None
            self._option_text = None

        elif tag == 'select' and self._select_name is not None:
            name = self._select_name
            if self._select_options:
                self.options.setdefault(name, []).extend(self._select_options)
            # Ingen fallback til første opsjon — se klassedokumentasjonen.
            if self._select_chosen is not None:
                self.felt.append((name, self._select_chosen, 'select'))
            else:
                self.felt.append((name, None, 'select-uvalgt'))
            self._select_name = None
            self._select_chosen = None
            self._select_options = None

        elif tag == 'textarea' and self._textarea_name is not None:
            self.felt.append((self._textarea_name, ''.join(self._textarea_value or []), 'felt'))
            self._textarea_name = None
            self._textarea_value = None


def parse_edit_form(html):
    """Parse redigeringsskjemaet. Returnerer (felt, options)."""
    parser = _EditFormParser()
    parser.feed(html)
    if not parser.felt:
        raise AoEditError(
            'Fant ikke redigeringsskjemaet (#report) i svaret fra AO. Vanligste årsak: '
            'funnet ligger allerede i gjennomgangskøen, og da svarer AO med et kort '
            '6-felts skjema uten #report.')
    return parser.felt, parser.options


def finn_option_id(options, felt, navn):
    """
    Slå opp AOs egen ID for en opsjon ut fra visningsteksten.

    Brukes til `Activity`, som ikke har `selected` i rå HTML. Valglista kommer fra
    samme HTML vi alt parser, så oppslaget følger AO automatisk hvis de legger til
    eller endrer aktiviteter — i motsetning til en hardkodet tabell.
    """
    if not navn:
        return None
    mål = navn.strip().casefold()
    for verdi, tekst in options.get(felt, ()):
        if tekst.casefold() == mål:
            return verdi
    return None


def _normaliser_dato(verdi):
    """`25.10.2026 00:00:00` → `25.10.2026`. Nettleserens datovelger gjør det samme."""
    if not verdi:
        return verdi
    treff = _DATO_RE.match(verdi.strip())
    return treff.group(1) if treff else verdi


def bygg_save_body(html, funn, endringer=None):
    """
    Bygg feltlista for `POST /ReviewSighting/Save`, bit-identisk med nettleserens.

    `funn` er funnets egne data, i praksis fra `BindSightingsGrid`:
        taxon_id, dato (DD.MM.YYYY), site_id, site_name, activity_navn
        og eventuelt activity_id hvis den alt er kjent.

    `endringer` overstyrer felt brukeren faktisk rørte, f.eks.
        {'quantity': '4', 'activity_id': '25', 'taxon_id': '4330'}

    **Denne funksjonen gjør ingen nettverkskall, og det er en egenskap som må
    bevares.** Alt funnet trenger skal være hentet FØR `aapne_skjema()` kalles.
    Grunnen er at skjemaåpningen gjør funnet upublisert: et kall som feiler etter
    det punktet etterlater funnet usynlig for andre. Første kjøring av
    no-op-porten (27.10.2026) feilet nettopp slik, fordi et lokalitetsnavn ble
    hentet midt i den kritiske seksjonen.

    Returnerer en liste av (navn, verdi) i dokumentrekkefølge. Dubletter beholdes —
    ASP.NET-checkboxer er `true`/`false`-par, og `Taxon` sendes bevisst TO ganger.
    """
    endringer = endringer or {}
    felt, options = parse_edit_form(html)

    finnes = {n for n, _, _ in felt}
    mangler = [n for n in PAAKREVDE_FELT if n not in finnes]
    if mangler:
        raise AoEditError(
            'Redigeringsskjemaet fra AO mangler felt: ' + ', '.join(sorted(mangler)))

    taxon_id = str(endringer.get('taxon_id') or funn['taxon_id'])
    quantity = endringer.get('quantity')
    dato = _normaliser_dato(funn['dato'])
    site_id = str(funn['site_id'])
    gruppe_id = str(funn.get('gruppe_id') or FUGLER_GRUPPE_ID)

    # Aktivitet: eksplisitt endring > kjent ID > oppslag på navn i AOs egen valgliste.
    aktivitet = endringer.get('activity_id') or funn.get('activity_id')
    if not aktivitet:
        aktivitet = finn_option_id(options, _S + 'Activity', funn.get('activity_navn'))
    if not aktivitet:
        # Å gjette her ville satt `Activity=0` og slettet aktiviteten fra funnet.
        raise AoEditError(
            'Fant ingen aktivitets-ID for '
            f'{funn.get("activity_navn")!r} i AOs valgliste — avbryter framfor å '
            'sende et tomt aktivitetsfelt.')

    # Felt der rå HTML har en ubrukelig verdi. Verdien er en LISTE fordi `Taxon`
    # sendes to ganger. Rekkefølgen bevares fra skjemaet.
    overstyr = {
        _S + 'Taxon': [taxon_id, taxon_id],
        _S + 'StartDate': [dato],
        _S + 'EndDate': [dato],
        _V + 'SelectedSite.Id': [site_id],
        'selectedSite': [''],
        'selectedSiteName': [funn['site_name']],
        'selectedSiteSpeciesGroupId': [gruppe_id],
        'selectedSiteIsFavorite': ['true'],
        'currentSpeciesGroupId': [gruppe_id],
        'coordinatesystem': ['UTM(WGS 84)'],
        _V + 'NewSite.Site.Name': [''],
        _V + 'NewSite.Site.Comment': [''],
        _V + 'NewSite.Site.ParentId': [''],
        _V + 'NewSite.NewSiteCoordinate.Geometry': [''],
        _V + 'NewSite.NewSiteCoordinate.Accuracy': ['0', '0'],
        _V + 'NewSite.NewSiteCoordinate.CoordinateSystemNotation.Id': ['1'],
    }
    if quantity is not None:
        overstyr[_S + 'Quantity'] = [str(quantity)]

    select_verdier = dict(SELECT_DEFAULTS)
    select_verdier[_S + 'Activity'] = str(aktivitet)

    ut = []
    brukt = set()
    for navn, verdi, slag in felt:
        if navn.startswith(UTELAT_PREFIKS) or navn in UTELAT_FELT:
            continue

        if navn in overstyr:
            # Alle forekomster erstattes av lista, én gang.
            if navn not in brukt:
                brukt.add(navn)
                ut.extend((navn, v) for v in overstyr[navn])
            continue

        if slag == 'select-uvalgt':
            if navn in select_verdier:
                ut.append((navn, select_verdier[navn]))
            # Ellers: utelat. Nettleseren sender den ikke.
            continue

        ut.append((navn, verdi))

    ut.extend(EKSTRA_FELT)
    return ut


# ---------------------------------------------------------------------------
# Nettverk: åpne skjema, lagre, publisere tilbake
# ---------------------------------------------------------------------------
# Alt under skriver til AO. Les merknaden om den upubliserte tilstanden i
# `aapne_skjema()` før du endrer noe her.

import httpx  # noqa: E402  (holdt nede her: resten av modulen er rent parsende)
from urllib.parse import urlencode  # noqa: E402

_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
}


# Samme klasse som `ao_sightings` bruker, ikke en ny med samme navn. To separate
# klasser ville sett identiske ut i koden, men `except ao_edit.AoSessionExpired`
# ville stille latt `ao_sightings`-varianten passere — og brukeren fått en tom
# feilmelding i stedet for «logg inn på nytt». Oppdaget nettopp slik, 27.10.2026.
from src.ao_sightings import AoSessionExpired  # noqa: F401,E402


def _cookies(login_token, auth_cookie):
    return {
        'AcceptCookies': '1',
        'logintoken': login_token,
        '.ASPXAUTHNO': auth_cookie,
    }


def ny_klient(login_token, auth_cookie):
    """
    Lag en httpx-klient med cookies på KLIENTEN, ikke per request.

    Samme felle som i `ao_sightings` og `ao_import_httpx.fetch_csrf_tokens`: AO
    svarer 302 på flere av disse kallene, og httpx bygger Cookie-headeren på nytt
    fra klientens jar ved redirect. Cookies satt per request forsvinner da, og vi
    får en uinnlogget side uten feilmelding.
    """
    return httpx.Client(cookies=_cookies(login_token, auth_cookie), timeout=30)


def aapne_skjema(client, sighting_id):
    """
    Åpne redigeringsskjemaet og returner rå HTML.

    ⚠️ **Dette gjør funnet UPUBLISERT med én gang.** AO sier det selv på siden:
    funnet blir usynlig for alle andre så snart denne siden åpnes, og det må
    publiseres på nytt — også om ingenting endres. `publiser()` MÅ derfor kalles
    etterpå, også på feilstier.

    ⚠️ **Du har ett forsøk per funn.** Ligger funnet alt i gjennomgangskøen, svarer
    AO med et kort 34 KB-skjema uten `#report`, og `parse_edit_form()` kaster.
    Bekreft at køen er tom før du kaller denne.
    """
    resp = client.get(f'{AO_BASE}/Edit/{sighting_id}',
                      headers=_HEADERS, follow_redirects=True)
    if resp.status_code != 200:
        raise AoEditError(f'/Edit/{sighting_id} svarte HTTP {resp.status_code}')
    if 'LogOff' not in resp.text:
        raise AoSessionExpired()
    return resp.text


def lagre(client, body):
    """
    Post feltlista til `/ReviewSighting/Save`.

    Svarer 302 til `/ReviewSighting` ved suksess. Funnet ligger da i
    gjennomgangskøen og må publiseres.
    """
    resp = client.post(
        f'{AO_BASE}/ReviewSighting/Save',
        content=urlencode(body, encoding='utf-8'),
        headers={**_HEADERS,
                 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'},
        follow_redirects=False,
    )
    if resp.status_code not in (200, 302):
        raise AoEditError(f'/ReviewSighting/Save svarte HTTP {resp.status_code}')
    return resp


def ko_rader(client):
    """Les gjennomgangskøen som JSON. Returnerer lista av rader."""
    resp = client.post(
        f'{AO_BASE}/ReviewSighting/BindReviewSightingsGrid',
        content='page=1&size=200',
        headers={**_HEADERS,
                 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                 'X-Requested-With': 'XMLHttpRequest'},
    )
    # 302 her er AOs måte å si «ikke innlogget» på — den sender oss til /LogOn.
    # Uten dette skillet ville brukeren fått «Kø-grid svarte HTTP 302» i stedet for
    # «logg inn på nytt», og ingen mulighet til å forstå hva som var galt.
    if resp.status_code in (301, 302, 401, 403):
        raise AoSessionExpired()
    if resp.status_code != 200:
        raise AoEditError(f'Kø-grid svarte HTTP {resp.status_code}')
    data = resp.json().get('data')
    return data if isinstance(data, list) else []


def temp_id_for(client, sighting_id):
    """Finn funnets `TemporarySightingId` i køen, eller None hvis det ikke ligger der."""
    for rad in ko_rader(client):
        if rad.get('SightingId') == int(sighting_id):
            return rad.get('TemporarySightingId')
    return None


def publiser(client, temp_sighting_ids):
    """
    Publiser NØYAKTIG de oppgitte funnene — aldri hele køen.

    Scoped `Publish` framfor `PublishAll`, slik at en redigering ikke drar med
    andre ventende funn brukeren ikke har sett på. Samme skille som
    `ao_import_httpx` gjør, se `docs/ao-publish-selective-capture.md`.

    CSRF må hentes fra `#PublishForm` på `/ReviewSighting` — `/PublishSighting`
    finnes ikke som GET (404).
    """
    if not temp_sighting_ids:
        raise AoEditError('publiser() krever minst én TemporarySightingId')

    side = client.get(f'{AO_BASE}/ReviewSighting', headers=_HEADERS,
                      follow_redirects=True)
    treff = re.search(
        r'id="PublishForm".*?name="__RequestVerificationToken"[^>]*value="([^"]+)"',
        side.text, re.DOTALL)
    if not treff:
        treff = re.search(
            r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', side.text)
    if not treff:
        raise AoEditError('Fant ikke CSRF-token for publisering på /ReviewSighting')

    ids = ','.join(str(x) for x in temp_sighting_ids)
    body = [
        ('__RequestVerificationToken', treff.group(1)),
        ('ReviewSightingViewModel.PublicationName', ''),
        ('ReviewSightingViewModel.PublicationComment', ''),
        ('ReviewSightingViewModel.SightingsToPublishIds', ids),
    ]
    resp = client.post(
        f'{AO_BASE}/PublishSighting/Publish',
        content=urlencode(body, encoding='utf-8'),
        headers={**_HEADERS,
                 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'},
        follow_redirects=True,
    )
    if resp.status_code != 200:
        raise AoEditError(f'Publisering svarte HTTP {resp.status_code}')
    return resp


def publiser_tilbake(client, sighting_id):
    """
    Nødutgang: ligger funnet i køen, publiser det. Ellers gjør ingenting.

    Kalles på ALLE feilstier etter `aapne_skjema()`. Uten dette blir et funn
    liggende usynlig for andre, og plukkes opp av neste `PublishAll` fra appen
    som en tilfeldig bieffekt.
    """
    temp_id = temp_id_for(client, sighting_id)
    if temp_id is None:
        return False
    publiser(client, [temp_id])
    return True


# ---------------------------------------------------------------------------
# Orkestrering: de tre operasjonene endringssiden trenger
# ---------------------------------------------------------------------------

# Feltene vi leser tilbake fra AO for å bekrefte at en endring faktisk tok.
# Flere enn brukeren kan endre, med vilje: `StageName`/`GenderName`/`UnitName`/
# `DiscoveryMethodName` er nettopp de feltene vi UTELATER fra bodyen, og hvis en
# AO-endring en dag gjør at de likevel tømmes, er det her det vises.
BEKREFT_FELT = (
    'TaxonId', 'Quantity', 'ActivityName', 'UniversalDate', 'FormattedTime',
    'SiteId', 'StageName', 'GenderName', 'UnitName',
    'DiscoveryMethodName', 'PublicComment', 'PrivateComment',
)


def _tall(verdi):
    try:
        return int(str(verdi).strip())
    except (TypeError, ValueError):
        return None


def aapne_for_redigering(client, sighting_id, funn):
    """
    Åpne skjemaet og returner det brukeren skal få se, pluss AOs aktivitetsliste.

    ⚠️ Funnet er UPUBLISERT når denne returnerer. Kalleren MÅ enten lagre eller
    kalle `avbryt()`. Se `aapne_skjema()`.

    `funn` er funnets egne data fra `BindSightingsGrid` — hentet FØR dette kallet.
    """
    html = aapne_skjema(client, sighting_id)
    felt, options = parse_edit_form(html)

    verdier = {}
    for navn, verdi, slag in felt:
        if slag != 'select-uvalgt' and navn not in verdier:
            verdier[navn] = verdi

    aktivitet_id = funn.get('activity_id') or finn_option_id(
        options, _S + 'Activity', funn.get('activity_navn'))

    return {
        'html': html,
        'quantity': verdier.get(_S + 'Quantity'),
        'taxonId': str(funn['taxon_id']),
        'activityId': aktivitet_id,
        'activityOptions': [
            {'id': v, 'navn': t}
            for v, t in options.get(_S + 'Activity', ())
            # value="0" er AOs «ikke angitt» og har tom tekst — ikke et reelt valg
            if v and v != '0' and t
        ],
    }


def avbryt(client, sighting_id):
    """
    Angre en åpnet redigering: publiser funnet tilbake uendret.

    Dette er IKKE `/ReviewSighting/CancelEdit`. AOs egen «Avbryt» publiserer ikke
    funnet tilbake (observert 25.10.2026), så den ville etterlatt funnet usynlig.
    """
    return publiser_tilbake(client, sighting_id)


def lagre_og_publiser(client, sighting_id, html, funn, endringer, hent_rad=None):
    """
    Skriv endringen, publiser scoped, og les resultatet tilbake fra AO.

    Returnerer `{'ok', 'bekreftet', 'ao', 'avvik'}`. `bekreftet` er AOs eget svar
    på om endringen tok — ikke vår antakelse om at den gjorde det.

    Ved enhver feil publiseres funnet tilbake før unntaket slipper videre, slik at
    det aldri blir liggende usynlig for andre.
    """
    try:
        body = bygg_save_body(html, funn, endringer)
        lagre(client, body)

        temp_id = temp_id_for(client, sighting_id)
        if temp_id is None:
            raise AoEditError(
                'Funnet ligger ikke i gjennomgangskøen etter lagring. '
                'Endringen kan ha blitt avvist av AO.')
        publiser(client, [temp_id])
    except Exception:
        try:
            publiser_tilbake(client, sighting_id)
        except Exception as exc:
            logger.error(
                f'[AO-EDIT] KRITISK: klarte ikke publisere funn {sighting_id} '
                f'tilbake etter feil: {exc}')
        raise

    return {'ok': True,
            **bekreft(client, sighting_id, funn, endringer, hent_rad=hent_rad)}


def bekreft(client, sighting_id, funn, endringer, hent_rad=None):
    """
    Les funnet tilbake fra AO og sjekk at endringen faktisk tok.

    `hent_rad(sighting_id)` injiseres av kalleren (server.py bruker
    `ao_sightings`-flyten). Uten den hoppes bekreftelsen over, og `bekreftet`
    blir `None` — «vet ikke», som er noe annet enn `False`.
    """
    if hent_rad is None:
        return {'bekreftet': None, 'ao': None, 'avvik': []}

    try:
        rad = hent_rad(sighting_id)
    except Exception as exc:
        logger.warning(f'[AO-EDIT] Kunne ikke lese tilbake funn {sighting_id}: {exc}')
        return {'bekreftet': None, 'ao': None, 'avvik': []}

    if not rad:
        return {'bekreftet': False, 'ao': None,
                'avvik': ['Fant ikke funnet hos AO etter lagring']}

    ao = {f: rad.get(f) for f in BEKREFT_FELT}
    avvik = []

    if 'quantity' in endringer:
        ventet, fikk = _tall(endringer['quantity']), _tall(rad.get('Quantity'))
        if ventet != fikk:
            avvik.append(f'Antall: ba om {ventet}, AO har {fikk}')

    if 'taxon_id' in endringer:
        ventet, fikk = _tall(endringer['taxon_id']), _tall(rad.get('TaxonId'))
        if ventet != fikk:
            avvik.append(f'Art: ba om taxonId {ventet}, AO har {fikk}')

    if 'activity_navn' in endringer:
        ventet = str(endringer['activity_navn']).strip().casefold()
        fikk = str(rad.get('ActivityName') or '').strip().casefold()
        if ventet != fikk:
            avvik.append(
                f'Aktivitet: ba om {endringer["activity_navn"]!r}, '
                f'AO har {rad.get("ActivityName")!r}')

    return {'bekreftet': not avvik, 'ao': ao, 'avvik': avvik}


def funn_fra_rad(rad):
    """
    Oversett en rå grid-rad fra AO til `funn`-dicten `bygg_save_body()` vil ha.

    Én kilde til denne oversettelsen, slik at server.py og verktøyet ikke driver
    fra hverandre. Dato konverteres fra AOs ISO-felt til skjemaets DD.MM.YYYY.
    """
    iso = str(rad.get('UniversalDate') or '')[:10]
    if len(iso) == 10 and iso.count('-') == 2:
        år, md, dg = iso.split('-')
        dato = f'{dg}.{md}.{år}'
    else:
        dato = iso

    navn = str(rad.get('SiteName') or '')
    navn = re.sub(r'<[^>]*>', '', navn).strip()

    return {
        'taxon_id': str(rad.get('TaxonId') or ''),
        'dato': dato,
        'site_id': str(rad.get('SiteId') or ''),
        'site_name': navn,
        'activity_navn': rad.get('ActivityName'),
    }
