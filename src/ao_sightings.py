"""
Hent brukerens EGNE publiserte funn fra Artsobservasjoner.

Dette er motstykket til `ao_import_httpx.review_queue_rows()`, som bare ser
gjennomgangskøen — altså funn som ennå ikke er publisert. Her leses funn som
allerede ER publisert, slik at appen kan vise «hva har jeg egentlig sendt», lenke
rett til funnet, vise AOs egne innvendinger, og se hvilke funn som mangler bilde.

Kjeden er fire steg, bekreftet mot ekte AO 25.10.2026 (`docs/ao-mine-funn-api.md`):

    GET  /ViewSighting/SearchSighting      → søkeskjemaet (~143 felt + CSRF)
    POST /ViewSighting/ViewSightingAsTable → 302, URL-en inneholder storedSearchCriterias
    GET  (redirect-målet)                  → HTML-en inneholder TotalPageCount
    POST /ViewSighting/BindSightingsGrid   → ren JSON, én rad per funn

Skjemaet har mange felt, men i motsetning til redigeringsskjemaet
(`docs/ao-rediger-api.md`) er dette **rent lesende**. Et felt vi reproduserer feil
gir i verste fall et dårlig søk — det kan aldri skade data hos AO. Derfor er
round-trip-strategien forsvarlig her, selv om den bevisst ble avvist for redigering.
"""

import logging
import re
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlencode

import httpx

logger = logging.getLogger('fugleobs')


class AoSessionExpired(Exception):
    """AO-sesjonen er utløpt — brukeren må logge inn på nytt."""

    def __init__(self, melding='Sesjonen mot Artsobservasjoner er utløpt. Logg inn på nytt.'):
        super().__init__(melding)


AO_BASE = 'https://www.artsobservasjoner.no'

_SEARCH_FORM_ID = 'ViewSightingForm'

# Søkekriteriene vi overstyrer. Resten av skjemaet sendes tilbake slik det kom.
_CRIT = 'SearchViewModel.StoredSearchCriterias.SearchCriterias.'
_FIELD_DAYS = _CRIT + 'LastNumberOfDays'
_FIELD_MY_REPORTED = _CRIT + 'MyReportedSightings'
_FIELD_MY_OBSERVED = _CRIT + 'MyObservedSightings'

# Merk: `FromDate`/`ToDate` finnes IKKE som skjemafelt i AOs rå HTML — de lages av
# datovelger-widgeten i nettleseren, og dukker derfor bare opp i en DOM der JS har
# kjørt. Vi sender dem ikke, og det er riktig: utelatt dato-periode er det samme som
# tom, og `LastNumberOfDays` er uansett kriteriet vi styrer vinduet med.

MAX_DAYS = 60
MAX_ROWS = 200
DEFAULT_DAYS = 14
DEFAULT_LIMIT = 100

# Rader per kall mot AOs grid. 50 er det AOs eget UI bruker.
_PAGE_SIZE = 50

_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
}


def _cookies(login_token, auth_cookie):
    return {
        'AcceptCookies': '1',
        'logintoken': login_token,
        '.ASPXAUTHNO': auth_cookie,
    }


class _FormParser(HTMLParser):
    """
    Plukk ut alle felt som nettleseren ville sendt fra ett bestemt skjema.

    Etterligner nettleserens egen `FormData`-oppførsel, for det er den som er
    verifisert å gi et gyldig søk:
      - avhukede checkboxer/radioer sendes, uavhukede sendes ikke
      - knapper (submit/button/image/reset) sendes ikke
      - `<select>` sender den valgte opsjonen, ellers den første (som i en nettleser)
      - felt uten `name` sendes ikke

    Dubletter beholdes bevisst i rekkefølge. ASP.NET rendrer checkboxer som et
    `true`/`false`-par, og det er meningsbærende — se `docs/ao-rediger-api.md`.
    """

    def __init__(self, form_id):
        super().__init__(convert_charrefs=True)
        self._form_id = form_id
        self._in_form = False
        self._select_name = None
        self._select_options = []
        self._select_chosen = None
        self._textarea_name = None
        self._textarea_value = []
        self.fields = []

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
            self.fields.append((name, a.get('value', '')))

        elif tag == 'select':
            self._select_name = a.get('name')
            self._select_options = []
            self._select_chosen = None

        elif tag == 'option' and self._select_name:
            value = a.get('value', '')
            self._select_options.append(value)
            if 'selected' in a:
                self._select_chosen = value

        elif tag == 'textarea':
            self._textarea_name = a.get('name')
            self._textarea_value = []

    def handle_data(self, data):
        if self._textarea_name is not None:
            self._textarea_value.append(data)

    def handle_endtag(self, tag):
        if tag == 'form':
            self._in_form = False

        elif tag == 'select' and self._select_name:
            # Ingen opsjon markert valgt? Nettleseren sender den første.
            chosen = self._select_chosen
            if chosen is None and self._select_options:
                chosen = self._select_options[0]
            if chosen is not None:
                self.fields.append((self._select_name, chosen))
            self._select_name = None
            self._select_options = []
            self._select_chosen = None

        elif tag == 'textarea' and self._textarea_name is not None:
            self.fields.append((self._textarea_name, ''.join(self._textarea_value)))
            self._textarea_name = None
            self._textarea_value = []


def parse_search_form(html):
    """Returner søkeskjemaets felt som liste av (navn, verdi), i dokumentrekkefølge."""
    parser = _FormParser(_SEARCH_FORM_ID)
    parser.feed(html)
    return parser.fields


def _override(fields, endringer, required=()):
    """
    Bytt ut verdien for navngitte felt, og la resten stå urørt.

    Alle eksisterende forekomster av et overstyrt navn fjernes og erstattes av
    nøyaktig én — samme semantikk som `URLSearchParams.set()`, som er den
    varianten som faktisk er verifisert å gi riktig filtrert søk hos AO.

    Felt i `required` MÅ finnes i skjemaet, ellers kastes `KeyError`. Øvrige felt
    legges til selv om AO ikke rendret dem: hvilke kriterie-seksjoner som vises er
    en lagret visningsinnstilling hos AO, og et felt kan mangle i HTML-en selv om
    ASP.NET gladelig binder det når vi poster det. Bekreftet 25.10.2026, der
    `MyReportedSightings` manglet serverside men fantes i nettleseren.
    """
    finnes = {n for n, _ in fields}
    mangler = [n for n in required if n not in finnes]
    if mangler:
        raise KeyError(f'Søkeskjemaet fra AO mangler felt: {", ".join(sorted(mangler))}')

    ut = [(n, v) for (n, v) in fields if n not in endringer]
    ut.extend(endringer.items())
    return ut


# Utloggingslenka finnes kun på en innlogget side. AO svarer HTTP 200 med den
# ANONYME utgaven når sesjonen er utløpt — ingen redirect, ingen feilkode — så dette
# er eneste måten å skille «utløpt» fra «ingen funn». Bekreftet 25.10.2026: innlogget
# side inneholder LogOff, uinnlogget ikke.
def _looks_logged_in(html):
    return 'LogOff' in html


_ALIAS_RE = re.compile(
    r'''data-useralias=["']([^"']+)["'][^>]*class=["'][^"']*iscurrentuser''')


def _current_user_alias(rows):
    """
    Finn brukerens eget AO-alias ved å lese hvem AO selv markerer som «meg».

    Hver rad lister observatørene sine med `data-useralias`, og den innloggede får
    i tillegg `class='iscurrentuser'`. Det gir oss aliaset uten å spørre om det noe
    sted — og uten å stole på at et bestemt skjemafelt heter det vi tror.
    """
    for row in rows:
        treff = _ALIAS_RE.search(str(row.get('Observers') or ''))
        if treff:
            return treff.group(1)
    return None


def _er_jeg_med(row, alias):
    """
    Er brukeren involvert i dette funnet — som observatør eller som rapportør?

    AO markerer den innloggede observatøren med `class='iscurrentuser'` i
    `Observers`. Det er et sterkere signal enn aliaset, fordi det kommer fra AO
    selv og ikke krever at vi gjetter hvem «jeg» er.
    """
    if 'iscurrentuser' in str(row.get('Observers') or ''):
        return True
    return bool(alias) and str(row.get('ReporterUserAlias') or '') == alias


def _only_mine(rows):
    """
    Siste skanse mot å vise funn brukeren ikke er med på.

    Vi ber AO filtrere serverside (`MyObservedSightings`), men den filtreringen
    hviler på at feltnavnet fortsatt stemmer. Denne sjekken hviler bare på data i
    svaret, og fanger derfor opp at AO har endret skjemaet.

    Klarer vi ikke å fastslå aliaset, slipper vi radene gjennom. Det er forsvarlig
    fordi AOs eget filter er obligatorisk (`_FIELD_MY_OBSERVED` ligger i `required`),
    så søket avbrytes hvis feltet mangler. Denne sjekken er et ekstra lag, ikke
    eneste forsvar.
    """
    alias = _current_user_alias(rows)
    return [r for r in rows if _er_jeg_med(r, alias)]


_TAG_RE = re.compile(r'<[^>]*>')


def _strip_html(value):
    """AOs grid pakker flere felt i markup for rendering — vi vil ha ren tekst."""
    if value is None:
        return ''
    return unescape(_TAG_RE.sub('', str(value))).strip()


def _clean_time(value):
    """«kl. 12:54-12:56» → «12:54-12:56». Tom streng hvis tidspunkt mangler."""
    text = _strip_html(value)
    return re.sub(r'^kl\.\s*', '', text).strip()


# AOs grid lenker til bildegalleriet på funnsiden med nøyaktig dette ankeret —
# bekreftet mot ekte data 25.10.2026. Rader uten media har tom `MediaLinkHtml`.
_IMAGE_ANCHOR = 'SightingDetailImages'


def _has_image(media_link_html):
    """
    Har funnet et bilde?

    Vi ser etter selve galleri-ankeret, ikke bare om feltet er ikke-tomt. To grunner:
    `MediaLinkHtml` dekker også lydopptak, og et tomt wrapper-element fra AO ville
    ellers fått hvert eneste funn til å se ut som om det hadde bilde.

    Endrer AO markupen, feiler dette mot «ingen bilde» — da dukker «Legg til bilde»
    opp på et funn som allerede har ett, og brukeren ser det med en gang. Motsatt vei
    ville knappen stille forsvunnet, og funksjonen vært ubrukelig uten at noen skjønte
    hvorfor.
    """
    return _IMAGE_ANCHOR in str(media_link_html or '')


def normalize_row(row, alias=None):
    """
    Gjør én rad fra AOs grid om til det frontend trenger — og ikke mer.

    Hviteliste, ikke svarteliste: AO returnerer ~70 felt per rad, de fleste
    rene renderingsdetaljer. Vi plukker ut det som faktisk brukes, slik at nye
    felt hos AO ikke lekker ut i vårt API ved et uhell.
    """
    try:
        sighting_id = int(row.get('SightingId'))
    except (TypeError, ValueError):
        sighting_id = None

    return {
        'sightingId': sighting_id,
        'taxonId': row.get('TaxonId'),
        'taxonName': _strip_html(row.get('TaxonName')),
        'scientificName': _strip_html(row.get('ScientificTaxonName')),
        'quantity': _strip_html(row.get('Quantity')),
        'activity': _strip_html(row.get('ActivityName')),
        'date': _strip_html(row.get('UniversalDate')),
        'time': _clean_time(row.get('FormattedTime')),
        'siteName': _strip_html(row.get('SiteName')),
        'siteId': row.get('SiteId'),
        'hasImage': _has_image(row.get('MediaLinkHtml')),
        'validationStatus': _strip_html(row.get('ValidationStatusLabel')),
        'triggeredRules': _strip_html(row.get('TriggeredValidationRulesText')),
        'publicComment': _strip_html(row.get('PublicComment')),
        'reporter': _strip_html(row.get('ReporterUserAlias')),
        # Kun rapportøren kan endre funnet — AO skjuler selv «Endre»-knappen for
        # andre. Bilder kan derimot alle involverte legge til.
        'isReporter': bool(alias) and str(row.get('ReporterUserAlias') or '') == alias,
        'url': f'{AO_BASE}/Sighting/{sighting_id}' if sighting_id else '',
    }


def _create_stored_search(client, days):
    """
    Kjør søket og returner (storedSearchCriterias, totalPageCount).

    Returnerer (None, None) hvis AO ikke svarte som forventet. `client` må allerede
    bære innloggings-cookiene — se merknaden i `fetch_my_sightings`.
    """
    # follow_redirects: en utløpt sesjon kan gi BÅDE en 302 til /LogOn og en 200 med
    # den anonyme siden — observert begge deler i praksis. Ved å følge videreføringen
    # havner vi uansett på en side `_looks_logged_in` kan dømme, i stedet for at den
    # ene varianten blir en navnløs «HTTP 302»-feil og brukeren får «ingen funn».
    resp = client.get(f'{AO_BASE}/ViewSighting/SearchSighting',
                      headers=_HEADERS, timeout=15, follow_redirects=True)
    if resp.status_code != 200:
        logger.warning(f'[AO-FUNN] Søkeskjemaet svarte HTTP {resp.status_code}')
        return None, None

    # Innlogging sjekkes FØRST. Er sesjonen utløpt, kan den anonyme siden mangle
    # skjemaet helt — og da ville en «fant ikke skjemaet»-retur stjålet needsLogin-
    # signalet, og brukeren fått «du har ingen funn» i stedet for «logg inn igjen».
    if not _looks_logged_in(resp.text):
        logger.warning('[AO-FUNN] Fikk den uinnloggede søkesiden fra AO — sesjonen er utløpt')
        raise AoSessionExpired()

    fields = parse_search_form(resp.text)
    if not fields:
        logger.warning('[AO-FUNN] Fant ikke søkeskjemaet i HTML-en fra AO')
        return None, None

    # Alt brukeren er observatør på — også funn andre har rapportert der hun står som
    # medobservatør. AO tillater nemlig bildeopplasting på dem (verifisert 25.10.2026:
    # opplastingsskjemaet rendres, og `EditableImagesForSightingId` svarer), selv om
    # den ikke tillater å endre dem. Skillet håndteres per rad med `isReporter`.
    #
    # `MyReportedSightings` slås av: den ville snevret inn til kun egne rapporter.
    fields = _override(fields, {
        _FIELD_DAYS: str(days),
        _FIELD_MY_OBSERVED: 'true',
        _FIELD_MY_REPORTED: 'false',
    }, required=[_FIELD_DAYS, _FIELD_MY_OBSERVED])

    post = client.post(
        f'{AO_BASE}/ViewSighting/ViewSightingAsTable',
        content=urlencode(fields, encoding='utf-8'),
        headers={**_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'},
        timeout=20,
        follow_redirects=True,
    )
    if post.status_code != 200:
        logger.warning(f'[AO-FUNN] Søket svarte HTTP {post.status_code}')
        return None, None

    stored = re.search(r'storedSearchCriterias=(\d+)', str(post.url), re.IGNORECASE)
    if not stored:
        stored = re.search(r'StoredSearchCriterias=(\d+)', post.text, re.IGNORECASE)
    if not stored:
        logger.warning('[AO-FUNN] Fant ingen storedSearchCriterias i svaret fra AO')
        return None, None

    # TotalPageCount MÅ være med videre — uten den svarer grid-endepunktet HTTP 500.
    # Finner vi den ikke, er resultatsiden ikke den vi tror (typisk en innloggingsside),
    # og da er det bedre å si fra enn å gjette på en verdi som garantert feiler.
    total = re.search(r'TotalPageCount=(\d+)', post.text, re.IGNORECASE)
    if not total:
        logger.warning('[AO-FUNN] Fant ingen TotalPageCount i resultatsiden fra AO')
        return None, None

    return stored.group(1), total.group(1)


def _fetch_grid_page(client, stored_id, total_pages, page, size):
    """Hent én side med rader fra AOs funn-grid. Returnerer (rader, total) eller (None, None)."""
    url = (f'{AO_BASE}/ViewSighting/BindSightingsGrid'
           f'?TotalPageCount={total_pages}&StoredSearchCriterias={stored_id}&size={size}')
    grid = client.post(
        url,
        content=f'page={page}&size={size}',
        headers={
            **_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': '*/*',
        },
        timeout=20,
    )
    if grid.status_code != 200:
        logger.warning(f'[AO-FUNN] Grid svarte HTTP {grid.status_code}')
        return None, None

    payload = grid.json()
    rows = payload.get('data')
    if not isinstance(rows, list):
        return None, None
    return rows, payload.get('total')


def fetch_my_sightings(login_token, auth_cookie, days=DEFAULT_DAYS, limit=DEFAULT_LIMIT):
    """
    Hent brukerens egne publiserte funn fra de siste `days` dagene.

    Returnerer `{'sightings': [...], 'total': N|None, 'truncated': bool}`, eventuelt
    med `needsLogin: True`. Ved enhver feil returneres en tom liste — prosjektets
    ekstern-API-konvensjon: en degradert respons er alltid bedre enn en feil som
    velter kallerens flyt.

    `total` er AOs eget treffantall, og `truncated` sier om vi stoppet før alt var
    hentet. Uten det ville en aktiv uke stille blitt kuttet ved `limit` uten at
    brukeren hadde noen måte å se at det manglet funn.

    `needsLogin` skiller «sesjonen er utløpt» fra «du har ingen funn». De to ser
    ellers helt like ut for brukeren, og bare den ene kan hun gjøre noe med.
    """
    if not login_token or not auth_cookie:
        return {'sightings': [], 'total': 0, 'truncated': False, 'needsLogin': True}

    try:
        days = max(1, min(int(days or DEFAULT_DAYS), MAX_DAYS))
        limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_ROWS))

        # VIKTIG: cookies på CLIENT-nivå. httpx bygger Cookie-headeren på nytt fra
        # klientens egen jar ved redirect, og dropper det som bare lå på requesten —
        # søket svarer med en 302, så per-request-cookies ville gitt oss en
        # uinnlogget resultatside uten TotalPageCount. Samme felle er allerede
        # dokumentert i `ao_import_httpx.fetch_csrf_tokens`.
        with httpx.Client(cookies=_cookies(login_token, auth_cookie)) as client:
            stored_id, total_pages = _create_stored_search(client, days)
            if not stored_id:
                return {'sightings': [], 'total': 0, 'truncated': False}

            funn = []
            total = None
            sett = 0
            page = 1
            side_storrelse = min(limit, _PAGE_SIZE)

            while len(funn) < limit:
                rows, total_fra_ao = _fetch_grid_page(
                    client, stored_id, total_pages, page, side_storrelse)
                if rows is None:
                    # Første side feilet: vi har ingenting. Senere side feilet: behold
                    # det vi har, og si fra at lista er ufullstendig.
                    if page == 1:
                        return {'sightings': [], 'total': 0, 'truncated': False}
                    return {'sightings': funn, 'total': total, 'truncated': True}

                if total_fra_ao is not None:
                    total = total_fra_ao
                sett += len(rows)

                gyldige = [r for r in rows if isinstance(r, dict) and r.get('SightingId')]
                alias = _current_user_alias(gyldige)
                egne = _only_mine(gyldige)
                # En rad uten brukbar numerisk ID kan vi verken lenke til eller laste
                # opp bilde på — da er den bare støy i lista.
                funn.extend(n for n in (normalize_row(r, alias) for r in egne) if n['sightingId'])

                # Færre rader enn vi ba om betyr at vi har nådd slutten. AO kan også
                # kutte `size` selv, og da er dette eneste pålitelige stoppsignalet.
                if len(rows) < side_storrelse:
                    break
                page += 1

            avkortet = len(funn) > limit or (total is not None and sett < total)
            return {'sightings': funn[:limit], 'total': total, 'truncated': bool(avkortet)}

    except AoSessionExpired:
        # Ikke en feil å skjule: brukeren kan gjøre noe med den, og uten beskjed
        # ville en utløpt sesjon bare sett ut som «du har ingen funn».
        return {'sightings': [], 'total': 0, 'truncated': False, 'needsLogin': True}
    except Exception as e:
        logger.warning(f'[AO-FUNN] Kunne ikke hente egne funn fra AO: {e}')
        return {'sightings': [], 'total': 0, 'truncated': False}


def fetch_raw_row(login_token, auth_cookie, sighting_id, days=MAX_DAYS):
    """
    Hent AOs UBEARBEIDEDE grid-rad for ett bestemt funn, eller None.

    Skiller seg fra `fetch_my_sightings()` ved at raden IKKE normaliseres. Det er
    poenget: `normalize_row()` kaster bort nettopp de feltene som ville avslørt et
    datatap ved redigering — `StageName`, `GenderName`, `UnitName`,
    `DiscoveryMethodName`. Brukes av `ao_edit.bekreft()` til å lese en endring
    tilbake fra AO, og av `tools/ao_noop_roundtrip.py`.

    Kaster `AoSessionExpired` hvis sesjonen er utløpt — kalleren skal kunne skille
    «fant ikke funnet» fra «du er ikke logget inn».
    """
    sighting_id = int(sighting_id)
    with httpx.Client(cookies=_cookies(login_token, auth_cookie), timeout=30) as client:
        stored, total_pages = _create_stored_search(client, days)
        if not stored:
            return None

        page = 1
        while page <= 20:
            rows, _ = _fetch_grid_page(client, stored, total_pages, page, _PAGE_SIZE)
            if not rows:
                return None
            for row in rows:
                if row.get('SightingId') == sighting_id:
                    return row
            if len(rows) < _PAGE_SIZE:
                return None
            page += 1
    return None
