"""
API handlers for fugleobservasjoner.

Håndterer eksterne API-kall til Artsobservasjoner og Nominatim.
"""

import json
import logging
import math
import re
import os
import threading
import time
from html import unescape
from urllib.parse import urlencode

import httpx

logger = logging.getLogger('fugleobs')

from src.utils import mask_token


# Import for å hente CSRF tokens
from src.ao_import_httpx import fetch_csrf_tokens


def fetch_ao_autocomplete(term: str, login_token: str = None, auth_cookie: str = None, user_id: str = None) -> dict:
    """
    Hent autocomplete-forslag for lokaliteter fra AO.

    Args:
        term: Søketekst (minimum 2-3 tegn)
        login_token: Optional logintoken cookie (for å inkludere private lokaliteter)
        auth_cookie: Optional .ASPXAUTHNO cookie (for å inkludere private lokaliteter)
        user_id: Optional bruker-ID (for auto-relogin)

    Returns:
        Dict med 'results' (liste) og 'refreshed_auth_cookie' (str eller None)
    """
    if not term or len(term) < 2:
        return {'results': [], 'refreshed_auth_cookie': None}

    refreshed_auth_cookie = None

    # STEG 1: Prøv auto-relogin FØRST (treffer .aspx-side, trygt ved utløpt session)
    # VIKTIG: Etter 8+ timer er .ASPXAUTHNO utløpt. Å sende utløpt cookie direkte
    # til et beskyttet API-endepunkt kan ødelegge/invalidere logintoken.
    # auto_relogin treffer /User/MyPages (.aspx) som trigger trygg fornyelse.
    if user_id and auth_cookie and login_token:
        new_cookie = auto_relogin_if_needed(user_id, auth_cookie, login_token)
        if new_cookie:
            auth_cookie = new_cookie
            refreshed_auth_cookie = new_cookie
            logger.debug('[AO-AUTOCOMPLETE] Auto-relogin vellykket via .aspx')

    # STEG 2: Sliding expiration som fallback
    if not refreshed_auth_cookie and user_id and auth_cookie and login_token:
        refreshed = refresh_ao_cookie_if_needed(auth_cookie, user_id, login_token)
        if refreshed:
            auth_cookie = refreshed
            refreshed_auth_cookie = refreshed
            logger.debug('[AO-AUTOCOMPLETE] Sliding expiration vellykket')

    base_url = os.getenv('AO_URL', 'https://www.artsobservasjoner.no')
    params = {
        'speciesGroupId': '8',  # Fugler
        'term': term,
        'searchSitesAlsoByExternalId': 'False'
    }

    url = f'{base_url}/Map/FindSitesByNameForAutocomplete?{urlencode(params)}'

    headers = {
        'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner-Autocomplete/1.0)',
        'Accept': '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': f'{base_url}/SubmitSighting/Report'
    }

    # Legg til cookies hvis tilgjengelig (for private lokaliteter)
    if login_token and auth_cookie:
        headers['Cookie'] = f'logintoken={login_token}; .ASPXAUTHNO={auth_cookie}; AcceptCookies=1'

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(url, headers=headers, follow_redirects=True)
            response.raise_for_status()

            logger.debug(f'[AO-AUTOCOMPLETE] Status: {response.status_code}, Content-Type: {response.headers.get("content-type")}')

            # Sjekk om responsen er JSON
            content_type = response.headers.get('content-type', '')
            if 'application/json' not in content_type:
                logger.warning(f'[AO-AUTOCOMPLETE] Ikke-JSON respons. Første 500 tegn: {response.text[:500]}')
                return {'results': [], 'refreshed_auth_cookie': refreshed_auth_cookie}

            results = response.json()
            return {'results': results, 'refreshed_auth_cookie': refreshed_auth_cookie}
    except Exception as e:
        logger.error(f'[AO-AUTOCOMPLETE] Feil ved henting: {e}')
        return {'results': [], 'refreshed_auth_cookie': refreshed_auth_cookie}



# Cache for auth cookies (logintoken -> (auth_cookie, timestamp))
_auth_cache = {}
_AUTH_CACHE_TTL = 300  # 5 minutter

# Cache for credentials (for auto-relogin)
_credentials_cache = {}  # user_id -> (username, password)

# Sliding expiration cache for AO auth cookie (bruker-id -> (cookie, last_refresh_ts))
_ao_cookie_refresh_cache = {}
_AO_COOKIE_REFRESH_INTERVAL = 300  # 5 minutter (balanse mellom overhead og token-friskhet)

# Lock for trådsikker tilgang til alle cacher (ThreadingHTTPServer)
_cache_lock = threading.Lock()

def refresh_ao_cookie_if_needed(auth_cookie: str, user_id: str, logintoken: str = None) -> str:
    """
    Sørger for at .ASPXAUTHNO holdes i live ved å treffe en AO-side hvis det er >10 min siden sist.
    Returnerer evt. ny auth-cookie hvis sliding expiration trigges, ellers None.
    """
    now = time.time()
    cache_key = f'{user_id}:{auth_cookie[:16]}'
    with _cache_lock:
        last_entry = _ao_cookie_refresh_cache.get(cache_key)
    if last_entry and now - last_entry[1] < _AO_COOKIE_REFRESH_INTERVAL:
        logger.debug(f'[AO-COOKIE-REFRESH] Skipper refresh: sist oppdatert for {int(now - last_entry[1])} sekunder siden.')
        return None
    # Treff AO-side for sliding expiration
    probe_url = 'https://www.artsobservasjoner.no/User/MyPages'
    logger.debug(f'[AO-COOKIE-REFRESH] Prober AO-side for sliding expiration: {probe_url}')
    try:
        # Bygg cookies med både .ASPXAUTHNO og logintoken hvis tilgjengelig
        cookies = {'.ASPXAUTHNO': auth_cookie}
        if logintoken:
            cookies['logintoken'] = logintoken
            cookies['logintoken_ssl'] = '1'

        with httpx.Client() as client:
            response = client.get(
                probe_url,
                headers={'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)'},
                cookies=cookies,
                timeout=10,
                follow_redirects=True
            )
            response.raise_for_status()

            found_set_cookie = False
            if '.ASPXAUTHNO' in response.cookies:
                found_set_cookie = True
                refreshed = response.cookies['.ASPXAUTHNO']
                with _cache_lock:
                    _ao_cookie_refresh_cache[cache_key] = (refreshed, now)
                logger.info(f'[AO-COOKIE-REFRESH] Sliding expiration: fikk ny auth-cookie: {mask_token(refreshed)}')
                return refreshed

            if not found_set_cookie:
                logger.debug('[AO-COOKIE-REFRESH] Ingen Set-Cookie header med .ASPXAUTHNO funnet i responsen.')
            # Ingen ny cookie, men oppdater timestamp for sliding expiration
            with _cache_lock:
                _ao_cookie_refresh_cache[cache_key] = (auth_cookie, now)
            logger.debug('[AO-COOKIE-REFRESH] Sliding expiration: ingen ny cookie, men refresh-tid oppdatert')
            return None
    except Exception as e:
        logger.error(f'[AO-COOKIE-REFRESH] Feil ved sliding expiration refresh: {e}')
        return None


def get_fresh_auth_cookie(logintoken: str) -> tuple:
    """
    Hent fersk .ASPXAUTHNO og userId fra logintoken.

    Bruker AOs automatiske re-autentisering: når man sender kun logintoken
    til en beskyttet side, returnerer AO en ny .ASPXAUTHNO i Set-Cookie.

    Args:
        logintoken: Komplett logintoken, f.eks. "290628:abc123..."

    Returns:
        tuple: (auth_cookie, user_id) - f.eks. ('.ASPXAUTHNO=abc...', '290628')

    Raises:
        ValueError: Hvis logintoken er ugyldig eller utløpt
    """
    if not logintoken or ':' not in logintoken:
        raise ValueError('Ugyldig logintoken format (forventet userId:hash)')

    # Sjekk cache først
    with _cache_lock:
        cached = _auth_cache.get(logintoken)
    if cached:
        cached_auth, cached_ts = cached
        if time.time() - cached_ts < _AUTH_CACHE_TTL:
            user_id = logintoken.split(':')[0]
            logger.debug(f'[AUTH] Bruker cached auth cookie for user {user_id}')
            return (cached_auth, user_id)

    # userId er første del av logintoken (før kolon)
    user_id = logintoken.split(':')[0]

    logger.debug(f'[AUTH] Henter fersk .ASPXAUTHNO for user {user_id}...')

    # Send request til /LogOn med kun logintoken - følg redirects
    with httpx.Client() as client:
        response = client.get(
            'https://www.artsobservasjoner.no/LogOn',
            headers={'User-Agent': 'Fugleobservasjoner/1.0 (https://enkel-ao.fly.dev)'},
            cookies={'logintoken': logintoken, 'logintoken_ssl': '1'},
            timeout=15,
            follow_redirects=True
        )
        response.raise_for_status()

        # Parse Set-Cookie for .ASPXAUTHNO
        auth_cookie = None
        if '.ASPXAUTHNO' in response.cookies:
            auth_cookie = f'.ASPXAUTHNO={response.cookies[".ASPXAUTHNO"]}'

        if not auth_cookie:
            # Prøv å finne feilen
            if 'LogOn' in response.text and 'UserName' in response.text:
                raise ValueError('logintoken er utløpt - vennligst logg inn på nytt')
            raise ValueError('Kunne ikke hente .ASPXAUTHNO fra logintoken')

        # Lagre i cache
        with _cache_lock:
            _auth_cache[logintoken] = (auth_cookie, time.time())

        logger.debug(f'[AUTH] Hentet fersk auth cookie for user {user_id}')
        return (auth_cookie, user_id)


def login_to_ao(username: str, password: str) -> dict:
    """
    Logger inn på Artsobservasjoner med brukernavn/passord.

    Returnerer dict med:
    - authCookie: .ASPXAUTHNO cookie-verdi
    - loginToken: logintoken for "husk meg" (varer 1 år)
    - userId: bruker-ID

    Raises:
        ValueError: Ved ugyldig brukernavn/passord eller andre feil
    """
    logger.info(f'[AO-LOGIN] Starter innlogging for bruker: {username}')

    # Steg 1: Hent login-siden for CSRF-token
    with httpx.Client() as client:
        response = client.get(
            'https://www.artsobservasjoner.no/LogOn',
            headers={'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)'},
            timeout=15,
            follow_redirects=True
        )
        response.raise_for_status()
        login_html = response.text

        # Ekstraher __RequestVerificationToken fra HTML-form
        token_match = re.search(
            r'name="__RequestVerificationToken"[^>]*value="([^"]*)"',
            login_html
        )
        if not token_match:
            raise ValueError('Kunne ikke hente CSRF-token fra login-side')

        form_token = token_match.group(1)

        # Hent cookie-token fra response cookies
        cookie_token = response.cookies.get('__RequestVerificationToken', '')

        logger.debug('[AO-LOGIN] Hentet CSRF-tokens, sender innlogging...')

        # Steg 2: POST login med credentials
        post_data = {
            '__RequestVerificationToken': form_token,
            'AuthenticationViewModel.UserName': username,
            'AuthenticationViewModel.Password': password,
            'AuthenticationViewModel.RememberMe': 'true'
        }

        auth_response = client.post(
            'https://www.artsobservasjoner.no/LogOn',
            headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)'
            },
            cookies={'__RequestVerificationToken': cookie_token},
            data=post_data,
            timeout=15,
            follow_redirects=False  # Ikke følg redirect automatisk, vi må sjekke det
        )

        # Sjekk for redirect til MyPages (vellykket login)
        if auth_response.status_code not in (302, 303):
            # Ingen redirect - sjekk om det er feilmelding
            if 'Feil brukernavn' in auth_response.text or 'Feil passord' in auth_response.text:
                raise ValueError('Feil brukernavn eller passord')
            raise ValueError('Innlogging feilet - ingen redirect mottatt')

        # Parse cookies fra response
        auth_cookie = None
        login_token = None
        user_id = None

        if '.ASPXAUTHNO' in auth_response.cookies:
            auth_cookie = auth_response.cookies['.ASPXAUTHNO']

        if 'logintoken' in auth_response.cookies:
            login_token = auth_response.cookies['logintoken']
            # Ekstraher userId fra logintoken (før kolon)
            if ':' in login_token:
                user_id = login_token.split(':')[0]

        if not auth_cookie:
            raise ValueError('Innlogging feilet - ingen auth cookie mottatt')

        if not login_token:
            raise ValueError('Innlogging feilet - ingen logintoken mottatt (husk å krysse av "Husk meg")')

        # Lagre credentials for auto-relogin
        if user_id:
            with _cache_lock:
                _credentials_cache[user_id] = (username, password)
            logger.debug(f'[AO-LOGIN] Lagret credentials for auto-relogin (user_id={user_id})')

        logger.info(f'[AO-LOGIN] Innlogging vellykket! user_id={user_id}, auth_cookie={mask_token(auth_cookie)}')

        return {
            'authCookie': auth_cookie,
            'loginToken': login_token,
            'userId': user_id
        }


def refresh_with_logintoken(login_token: str, user_id: str) -> str:
    """
    Fornyer .ASPXAUTHNO ved å bruke logintoken via MyPages.
    AO redirecter automatisk til /LogOn hvis session er utløpt.

    Pattern:
      GET /MyPages (med logintoken) → follow_redirects=True
        ├─ 200: session OK, ingen refresh nødvendig
        └─ 302→/LogOn: logintoken sendes videre → ny .ASPXAUTHNO

    Dette er bedre enn auto-relogin fordi det IKKE sender brukernavn/passord.

    Args:
        login_token: LoginToken cookie (format: "userId:hash")
        user_id: Bruker-ID

    Returns:
        Ny .ASPXAUTHNO cookie hvis vellykket, ellers None
    """
    if not login_token:
        logger.debug('[LOGINTOKEN-REFRESH] Ingen logintoken tilgjengelig')
        return None

    logger.debug(f'[LOGINTOKEN-REFRESH] Prøver å fornye session med logintoken: {mask_token(login_token)} (user_id={user_id})')

    try:
        # VIKTIG: Sett cookies på CLIENT-nivå, ikke request-nivå!
        # Per-request cookies sendes kun med første request og videresendes IKKE ved redirects.
        # Client-level cookies sendes med ALLE requests i redirect-kjeden.
        login_cookies = {
            'logintoken': login_token,
            'logintoken_ssl': '1',
            'AcceptCookies': '1'
        }
        with httpx.Client(cookies=login_cookies) as client:
            response = client.get(
                'https://www.artsobservasjoner.no/User/MyPages',
                headers={'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)'},
                timeout=10,
                follow_redirects=True  # Følg redirect til /LogOn automatisk
            )

            # Finn ny .ASPXAUTHNO fra cookie jar (unngå dict() som krasjer ved duplikater)
            cookie_names = [c.name for c in client.cookies.jar]
            new_auth = None
            for cookie in client.cookies.jar:
                if cookie.name == '.ASPXAUTHNO':
                    new_auth = cookie.value
                    break

            logger.debug(f'[LOGINTOKEN-REFRESH] Response: status={response.status_code}, url={response.url}, cookies={cookie_names}')

            if new_auth:
                if '/LogOn' in str(response.url):
                    logger.info('[LOGINTOKEN-REFRESH] Session fornyet via /LogOn redirect (UTEN credentials)')
                else:
                    logger.debug('[LOGINTOKEN-REFRESH] Session fortsatt gyldig, fikk bekreftet .ASPXAUTHNO')
                return new_auth
            else:
                logger.warning('[LOGINTOKEN-REFRESH] Ingen .ASPXAUTHNO mottatt (logintoken ugyldig?)')
                return None

    except Exception as e:
        logger.error(f'[LOGINTOKEN-REFRESH] Feil: {e}')
        return None


def auto_relogin_if_needed(user_id: str, auth_cookie: str, login_token: str = None) -> str:
    """
    Sjekker om auth_cookie er utløpt og fornyer session.

    Strategi:
    1. Test cookie med logintoken → AO fornyer automatisk hvis logintoken gyldig
    2. Fallback til logintoken-refresh hvis test feiler
    3. Siste utvei: full relogin med brukernavn/passord

    Args:
        user_id: Bruker-ID
        auth_cookie: Nåværende .ASPXAUTHNO cookie
        login_token: Optional logintoken for auto-refresh

    Returns:
        Ny auth_cookie hvis relogin var nødvendig, ellers None
    """
    # Test om nåværende cookie fungerer (med logintoken hvis tilgjengelig)
    try:
        cookies = {'.ASPXAUTHNO': auth_cookie}
        if login_token:
            cookies['logintoken'] = login_token
            cookies['logintoken_ssl'] = '1'

        # VIKTIG: Cookies på CLIENT-nivå for å videresendes ved redirects
        with httpx.Client(cookies=cookies) as client:
            response = client.get(
                'https://www.artsobservasjoner.no/User/MyPages',
                headers={'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)'},
                timeout=10,
                follow_redirects=True  # Følg redirects for å fange logintoken-refresh
            )
            # Finn ny .ASPXAUTHNO fra cookie jar (unngå dict() som krasjer ved duplikater)
            new_auth = None
            for cookie in client.cookies.jar:
                if cookie.name == '.ASPXAUTHNO' and cookie.value != auth_cookie:
                    new_auth = cookie.value
                    break
            # Hvis vi får 200 og ny cookie, har AO fornyet den automatisk
            if response.status_code == 200:
                if new_auth:
                    logger.info(f'[AUTO-RELOGIN] Cookie fornyet automatisk via logintoken (user_id={user_id})')
                    return new_auth
                # Sjekk om vi IKKE ble redirectet til login (cookie fortsatt gyldig)
                if '/LogOn' not in str(response.url):
                    return None
    except Exception as e:
        logger.error(f'[AUTO-RELOGIN] Feil ved cookie-test: {e}')

    logger.info(f'[AUTO-RELOGIN] Cookie utløpt for user_id={user_id}')

    # STEG 1: Prøv logintoken-refresh (INGEN credentials)
    if login_token:
        new_cookie = refresh_with_logintoken(login_token, user_id)
        if new_cookie:
            return new_cookie
        logger.warning('[AUTO-RELOGIN] Logintoken-refresh feilet, prøver full relogin...')

    # STEG 2: Fallback til full relogin med credentials
    with _cache_lock:
        creds = _credentials_cache.get(user_id)
    if not creds:
        logger.warning(f'[AUTO-RELOGIN] Ingen lagrede credentials for user_id={user_id}')
        return None

    username, password = creds
    try:
        result = login_to_ao(username, password)
        logger.info('[AUTO-RELOGIN] Vellykket (full relogin med credentials)')
        return result['authCookie']
    except Exception as e:
        logger.error(f'[AUTO-RELOGIN] Feilet: {e}')
        return None


def handle_species_search(search_term, dont_include_sub='true', ao_base_url='https://www.artsobservasjoner.no'):
    """Håndter søk etter arter via Artsobservasjoner.no."""
    if not search_term.strip():
        return []

    # Bygg URL til Artsobservasjoner
    query_params = {
        'search': search_term,
        'returnformat': 'html',
        'onlyReportable': 'true',
        'dontIncludeSubSpecies': dont_include_sub,
        'speciesGroup': '8',
        'language': '4',
    }
    ao_url = ao_base_url + '/Taxon/PickerSearch?' + urlencode(query_params)

    try:
        with httpx.Client() as client:
            resp = client.get(
                ao_url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner-Python/0.1)',
                    'Accept': 'text/html, */*; q=0.01',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': 'https://www.artsobservasjoner.no/SubmitSighting/Report',
                },
                timeout=10,
            )
            resp.raise_for_status()
            html = resp.text

        # Finn alle <span class="itemjson">...</span>
        items = re.findall(r'<span class="itemjson">(.*?)</span>', html)
        results = []

        for item in items:
            try:
                data = json.loads(item)
                taxon_name_raw = data.get('taxonname')
                taxon_name = unescape(taxon_name_raw) if taxon_name_raw else None
                scientific_raw = data.get('scientificname')
                scientific_html = unescape(scientific_raw) if scientific_raw else None
                
                results.append({
                    'taxonId': data.get('taxonid'),
                    'taxonName': taxon_name,
                    'scientificNameHtml': scientific_html,
                    'speciesGroupId': data.get('speciesgroupid'),
                    'protectionLevelId': data.get('protectionlevelid'),
                    'leaf': (data.get('leaf') == 'true'),
                })
            except Exception:
                # Ignorer rader vi ikke klarer å parse
                continue

        return results
    except Exception as e:
        logger.error(f'Feil ved henting fra Artsobservasjoner: {e}')
        raise


def handle_reverse_geocoding(lat, lon, nominatim_base_url):
    """Håndter reverse geokoding via Nominatim."""
    # Valider koordinater
    try:
        float(lat)
        float(lon)
    except ValueError:
        raise ValueError('Ugyldig lat/lon')

    nominatim_url = f'{nominatim_base_url}?format=jsonv2&lat={lat}&lon={lon}&zoom=14&addressdetails=1'

    try:
        with httpx.Client() as client:
            resp = client.get(
                nominatim_url,
                headers={
                    'User-Agent': 'Fugleobservasjoner/0.1 (hobbyprosjekt)',
                    'Accept': 'application/json',
                },
                timeout=10,
            )
            resp.raise_for_status()
            body = resp.text

        if not body.strip():
            return None

        data = json.loads(body)
        address = data.get('address', {}) or {}
        
        # Finn kort stedsnavn
        name = (
            address.get('locality') or
            address.get('village') or
            address.get('town') or
            address.get('city') or
            address.get('hamlet') or
            address.get('municipality') or
            address.get('county') or
            data.get('name') or
            data.get('display_name')
        )
        
        return name
    except Exception as e:
        logger.error(f'Feil ved reverse geokoding: {e}')
        raise


def _epsg3857_to_wgs84(x, y):
    """Konverter Web Mercator (EPSG:3857) til WGS84 (lat, lon)."""
    R = 6378137.0
    lon = math.degrees(x / R)
    lat = math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2)
    return round(lat, 6), round(lon, 6)


def handle_ao_private_sites(auth_cookie: str, ao_base_url: str = 'https://www.artsobservasjoner.no', login_token: str = None) -> list:
    """
    Hent alle brukerens private lokasjoner via BindUserSitesGrid.

    Returnerer liste med dicts: { id, name, lat, lon, acc }
    Koordinater er konvertert fra EPSG:3857 til WGS84.

    BindUserSitesGrid er et Kendo-grid-endepunkt som krever X-Requested-With: XMLHttpRequest.
    """
    url_grid = f'{ao_base_url}/Site/BindUserSitesGrid?UserSitesGrid-size=500'
    seed_cookies = {'.ASPXAUTHNO': auth_cookie, 'AcceptCookies': '1'}
    if login_token:
        seed_cookies['logintoken'] = login_token

    headers = {
        'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)',
        'Accept': 'application/json',
    }

    with httpx.Client(cookies=seed_cookies, follow_redirects=True) as client:
        response = client.post(
            url_grid,
            headers={
                **headers,
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
            },
            content=b'page=1&size=500',
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()

    sites = []
    for item in data.get('data', []):
        site_id = item.get('SiteId')
        name = item.get('Name')
        x = item.get('SiteXCoord')
        y = item.get('SiteYCoord')
        acc = item.get('Accuracy')
        if not (site_id and name and x and y):
            continue
        lat, lon = _epsg3857_to_wgs84(x, y)
        sites.append({'id': site_id, 'name': name, 'lat': lat, 'lon': lon, 'acc': acc})

    logger.info(f'[AO-PRIVATE-SITES] Hentet {len(sites)} private lokasjoner')
    return sites


def handle_ao_sites_search(lat, lon, size_m=600.0, ao_mobile_base_url='https://mobil.artsobservasjoner.no', user_id=None, login_token=None, auth_cookie=None):
    """Håndter søk etter AO-lokaliteter.

    Returns:
        tuple: (sites_list, refreshed_auth_cookie_or_None, auth_failed_bool)
    """
    # Valider input
    try:
        lat = float(lat)
        lon = float(lon)
        size_m = float(size_m) if size_m else 600.0
    except ValueError:
        raise ValueError('Ugyldig lat/lon/size')
        
    # Variabel for å holde styr på refreshed tokens og auth-status
    refreshed_auth_cookie = None
    auth_failed = False  # True hvis GetSitesGeoJson feiler pga ugyldig auth
    ao_user_id = user_id or (login_token.split(':')[0] if login_token and ':' in login_token else None)
    ao_auth = auth_cookie or os.getenv('AO_AUTH_COOKIE')

    # STEG 1: Prøv auto-relogin hvis token er utløpt
    if ao_auth and ao_user_id:
        new_cookie = auto_relogin_if_needed(ao_user_id, ao_auth, login_token)
        if new_cookie:
            ao_auth = new_cookie
            refreshed_auth_cookie = new_cookie
            logger.info('[AO-SITES] Auto-relogin vellykket, bruker ny auth_cookie')

    # STEG 2: Sliding expiration - prøv å holde auth_cookie i live hvis mulig
    if ao_auth and ao_user_id and not refreshed_auth_cookie:
        refreshed = refresh_ao_cookie_if_needed(ao_auth, ao_user_id, login_token)
        if refreshed:
            ao_auth = refreshed
            refreshed_auth_cookie = refreshed

    # Beregn geografisk boks
    half_m = max(size_m, 1.0) / 2.0
    meters_per_deg_lat = 111_320.0
    meters_per_deg_lon = meters_per_deg_lat * math.cos(math.radians(lat)) or 1.0

    d_lat = half_m / meters_per_deg_lat
    d_lon = half_m / meters_per_deg_lon

    min_y = lat - d_lat
    max_y = lat + d_lat
    min_x = lon - d_lon
    max_x = lon + d_lon

    logger.debug(
        f'AO-sites forespørsel: lat={lat:.6f}, lon={lon:.6f}, size_m={size_m:.1f}, '
        f'minX={min_x:.6f}, minY={min_y:.6f}, maxX={max_x:.6f}, maxY={max_y:.6f}'
    )
    logger.debug(f'AO-tokens: user_id={bool(user_id)}, login_token={bool(login_token)}, auth_cookie={bool(auth_cookie)}')

    # Samler raw sites her
    raw_sites = []
    my_site_ids = set()  # Holder styr på ALLE brukerens site-IDer (ikke bare i bbox)

    # --- KALL 1: Hent brukerens lokasjoner via GetSitesGeoJson ---
    # Bruker samme bbox for å finne brukerens egne sites i området
    ao_login = login_token or os.getenv('AO_LOGIN_TOKEN')
    # (ao_auth og ao_user_id er allerede satt over)
    # NY: Hvis vi har loginToken men mangler auth_cookie, hent den automatisk
    if ao_login and not ao_auth:
        try:
            fresh_auth, extracted_user_id = get_fresh_auth_cookie(ao_login)
            ao_auth = fresh_auth
            if not ao_user_id:
                ao_user_id = extracted_user_id
            logger.debug(f'Hentet fersk auth cookie automatisk for user {ao_user_id}')
        except ValueError as e:
            logger.debug(f'Kunne ikke hente auth cookie: {e}')
            ao_auth = None

    logger.debug(f'AO-tokens final: user_id={ao_user_id}, login_token={mask_token(ao_login)}, auth_cookie={mask_token(ao_auth)}')

    if ao_login and ao_auth and ao_user_id:
        try:
            # Normaliser AO_AUTH_COOKIE verdi
            auth_val = ao_auth
            if auth_val.startswith('.ASPXAUTHNO='):
                auth_val = auth_val.split('=', 1)[1]

            # Hent CSRF token fra AO (samme strategi som ao_import)
            try:
                _, csrf_cookie_token, refreshed = fetch_csrf_tokens(ao_login, auth_val)
                logger.debug(f'GetSitesGeoJson: Hentet CSRF token: {mask_token(csrf_cookie_token)}')
                # Bruk eventuell refreshed auth cookie
                if refreshed:
                    auth_val = refreshed
                    refreshed_auth_cookie = refreshed
                    logger.debug('GetSitesGeoJson: Bruker refreshed auth cookie')
            except Exception as csrf_err:
                logger.debug(f'GetSitesGeoJson: Kunne ikke hente CSRF token: {csrf_err}')
                csrf_cookie_token = None

            # Fallback: Hvis AO svarer med auth-feil, prøv sliding expiration refresh én gang
            # (NB: AO returnerer ikke alltid tydelig feilkode, så dette må evt. utvides)
            # Kan utvides med ekstra logikk hvis behov

            # Konverter lat/lon til Web Mercator (EPSG:3857) for bbox
            def lat_lon_to_mercator(lat, lon):
                x = lon * 20037508.34 / 180
                y = math.log(math.tan((90 + lat) * math.pi / 360)) / (math.pi / 180)
                y = y * 20037508.34 / 180
                return x, y

            center_x, center_y = lat_lon_to_mercator(lat, lon)
            # Bbox rundt sentrum - bruk samme radius som søket (size_m)
            # size_m er i meter, og Web Mercator er også i meter, så vi kan bruke det direkte
            half_size = max(size_m / 2, 100)  # Minimum 100m, ellers halve søkeradiusen
            bbox_str = f'{int(center_x - half_size)},{int(center_y - half_size)},{int(center_x + half_size)},{int(center_y + half_size)}'

            # Cookie dict - inkluder CSRF token hvis vi har den
            cookies_dict = {
                'AcceptCookies': '1',
                '.ASPXAUTHNO': auth_val,
                'logintoken': ao_login
            }
            if csrf_cookie_token:
                cookies_dict['__RequestVerificationToken'] = csrf_cookie_token

            geojson_url = 'https://www.artsobservasjoner.no/Map/GetSitesGeoJson'
            post_data = {
                'zoomLevel': 16,
                'bbox': bbox_str,
                'userId': int(ao_user_id),
                'coordSyst': 0,
                'speciesGroupId': '0',  # Alle artsgrupper, ikke bare fugler
                'taxonId': None
            }

            logger.debug(f'GetSitesGeoJson POST to {geojson_url}, bbox: {bbox_str}')

            geojson_data = None
            # Bruk httpx for POST-kall
            with httpx.Client() as client:
                response = client.post(
                    geojson_url,
                    headers={
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
                        'Accept': '*/*',
                        'Content-Type': 'application/json; charset=UTF-8',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Origin': 'https://www.artsobservasjoner.no',
                        'Referer': 'https://www.artsobservasjoner.no/SubmitSighting/Report'
                    },
                    cookies=cookies_dict,
                    json=post_data,
                    timeout=15,
                    follow_redirects=True
                )
                response.raise_for_status()

                # Parse Set-Cookie header for refreshed auth token
                if not refreshed_auth_cookie and '.ASPXAUTHNO' in response.cookies:
                    refreshed_auth_cookie = response.cookies['.ASPXAUTHNO']
                    logger.debug('GetSitesGeoJson: Fant refreshed auth cookie')

                body = response.text
                logger.debug(f'GetSitesGeoJson body length: {len(body)}, first 500: {repr(body[:500])}')

                # Sjekk om vi fikk HTML i stedet for JSON (auth-feil)
                if body.strip().startswith('<!DOCTYPE') or body.strip().startswith('<html'):
                    logger.warning('GetSitesGeoJson: Fikk HTML i stedet for JSON - auth ugyldig, skipper private sites')
                    auth_failed = True  # Marker at auth feilet
                    geojson_data = None
                else:
                    geojson_data = response.json() if body else None
            logger.debug(f'GetSitesGeoJson parsed keys: {list(geojson_data.keys()) if isinstance(geojson_data, dict) else type(geojson_data)}')

            # GetSitesGeoJson returnerer { points: { features: [...] }, polygons: {...} }
            # Brukerens egne sites har isPrivate=true
            if isinstance(geojson_data, dict):
                # Sjekk points.features
                points = geojson_data.get('points', {})
                if isinstance(points, dict):
                    for feature in points.get('features', []):
                        props = feature.get('properties', {})
                        site_id = props.get('siteId') or props.get('id') or feature.get('id')

                        if props.get('isPrivate') and site_id is not None:
                            my_site_ids.add(int(site_id))

                # Sjekk også polygons.features
                polygons = geojson_data.get('polygons', {})
                if isinstance(polygons, dict):
                    for feature in polygons.get('features', []):
                        props = feature.get('properties', {})
                        site_id = props.get('siteId') or props.get('id') or feature.get('id')

                        if props.get('isPrivate') and site_id is not None:
                            my_site_ids.add(int(site_id))

            logger.debug(f'GetSitesGeoJson: fant {len(my_site_ids)} private site-IDs')
        except Exception as geojs_err:
            logger.warning(f'GetSitesGeoJson feilet: {geojs_err}')
            # Hvis auth er ugyldig, fortsett med kun offentlige sites
            pass

    # --- KALL 2: Hent offentlige lokasjoner (ByBoundingBox) ---
    query_params = {
        'maxSites': '1000',
        'minX': f'{min_x:.6f}',
        'minY': f'{min_y:.6f}',
        'maxX': f'{max_x:.6f}',
        'maxY': f'{max_y:.6f}',
        'includePublicSites': 'true',
    }

    ao_sites_url = (
        ao_mobile_base_url + '/core/Sites/ByBoundingBox?' +
        urlencode(query_params)
    )

    try:
        with httpx.Client() as client:
            resp = client.get(
                ao_sites_url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner-Python/0.1)',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Encoding': 'identity',
                    'X-CSRF': '1',
                    'Referer': 'https://mobil.artsobservasjoner.no/contribute/submit-sightings',
                },
                timeout=10,
            )
            resp.raise_for_status()

            # Sjekk etter refreshed auth cookie også her
            if not refreshed_auth_cookie and '.ASPXAUTHNO' in resp.cookies:
                refreshed_auth_cookie = resp.cookies['.ASPXAUTHNO']
                logger.debug('Fikk refreshed auth cookie fra ByBoundingBox')

            body = resp.text
        data = json.loads(body)

        # Normaliser datastruktur fra ByBoundingBox
        if isinstance(data, list):
            public_sites = data
        elif isinstance(data, dict):
            public_sites = data.get('sites') or data.get('Sites') or []
        else:
            public_sites = []

        # Legg til alle sites fra ByBoundingBox
        for item in public_sites or []:
            if not isinstance(item, dict):
                continue
            raw_sites.append(item)

        # Prosesser steder
        sites = []
        for item in raw_sites or []:
            if not isinstance(item, dict):
                continue

            name = (
                item.get('name') or
                item.get('Name') or
                item.get('siteName') or
                item.get('SiteName')
            )
            site_id = item.get('id') or item.get('Id') or item.get('siteId')
            lat_val = item.get('lat') or item.get('latitude') or item.get('Lat')
            lon_val = item.get('lon') or item.get('longitude') or item.get('Lon')

            site = {'raw': item}
            if name:
                site['name'] = name
            if site_id is not None:
                site['id'] = site_id
                # Sjekk om dette er en av mine lokasjoner (basert på GetMySites)
                try:
                    if int(site_id) in my_site_ids:
                        site['isMine'] = True
                except (ValueError, TypeError):
                    pass

            if lat_val is not None:
                site['lat'] = lat_val
            if lon_val is not None:
                site['lon'] = lon_val

            # Oppdag om dette er en "superlokasjon" eller har en parent-id.
            try:
                # Sjekk eksplisitte flagg (bool eller strings)
                for k in ('isSuper', 'isSuperSite', 'IsSuper', 'IsSuperSite', 'is_super'):
                    if k in item:
                        v = item.get(k)
                        if v is True or v == 'true' or v == 'True' or v == '1':
                            site['isSuper'] = True
                        elif v is False or v == 'false' or v == 'False' or v == '0':
                            site['isSuper'] = False
                        break

                # Sjekk om typen inneholder ordet 'super' eller 'superlokalitet'
                if 'isSuper' not in site:
                    t = item.get('siteType') or item.get('type') or item.get('SiteType')
                    if isinstance(t, str) and ('super' in t.lower() or 'superlok' in t.lower()):
                        site['isSuper'] = True

                # Parent-id kan indikere at dette er en underlokalitet (ikke super)
                for pk in ('parentId', 'parentSiteId', 'ParentId', 'parent'):
                    if pk in item and item.get(pk) is not None:
                        site['parentId'] = item.get(pk)
                        # Hvis parent finnes og isSuper ikke eksplisitt satt,
                        # merk isSuper som False (dette er en barn-lokalitet)
                        if 'isSuper' not in site:
                            site['isSuper'] = False
                        break
            except Exception:
                # Ikke la parsing av ekstra felt knekke hele kall
                pass
            sites.append(site)

        # Logging: vis alle site-IDs som har isMine=True
        mine_sites = [s for s in sites if s.get('isMine')]
        if mine_sites:
            logger.debug(f'[AO-SITES] Lokasjoner med isMine=True: {len(mine_sites)}')
            for s in mine_sites:
                logger.debug(f'  - Navn: {s.get("name")}, ID: {s.get("id")}')
        else:
            logger.debug('[AO-SITES] Ingen lokasjoner med isMine=True i sites-array.')

        # Etter at vi har samlet alle sites, utled om noen er "superlokasjoner"
        # ved å se etter parent-referanser. Hvis et item A har parentSiteId = B,
        # så er B en superlokasjon (forelder) og A er en underlokalitet.
        try:
            id_map = {s.get('id'): s for s in sites if s.get('id') is not None}
            for s in sites:
                raw = s.get('raw') or {}
                # Sjekk flere varianter av parent-felt
                parent_keys = ('parentSiteId', 'parentId', 'parent', 'ParentId', 'parentSite')
                for pk in parent_keys:
                    if pk in raw and raw.get(pk) is not None:
                        pid = raw.get(pk)
                        s['parentId'] = pid
                        # Barn-lokalitet
                        s['isSuper'] = False
                        # Marker parent som super hvis vi har den i resultatsettet
                        if pid in id_map:
                            id_map[pid]['isSuper'] = True
                        break
        except Exception:
            pass

        logger.info(f'AO-sites: {len(sites)} lokaliteter')
        if sites[:3]:
            logger.info(f'AO-sites eksempel: {[s.get("name") for s in sites[:3]]}')

        # Merk bruker-eide lokasjoner hvis de er angitt i miljøvariabel
        # MY_AO_SITE_IDS kan være en kommaseparert liste med site-id'er som eies av brukeren.
        try:
            my_ids_raw = os.getenv('MY_AO_SITE_IDS', '')
            if my_ids_raw:
                my_ids = set([int(x.strip()) for x in my_ids_raw.split(',') if x.strip()])
                for s in sites:
                    sid = s.get('id')
                    if sid is not None and int(sid) in my_ids:
                        s['isMine'] = True
        except Exception:
            # Ikke la parsing av denne configen knekke kall
            pass

        # Sorter slik at `isMine` (brukerens egne) kommer først, deretter resten uendret
        try:
            sites.sort(key=lambda s: (0 if s.get('isMine') else 1))
        except Exception:
            pass

        return sites, refreshed_auth_cookie, auth_failed
    except Exception as e:
        logger.error(f'Feil ved henting av AO-lokaliteter: {repr(e)}')
        raise