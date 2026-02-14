"""
API handlers for fugleobservasjoner.

Håndterer eksterne API-kall til Artsobservasjoner og Nominatim.
"""

import json
import math
import re
import os
import subprocess
import time
from html import unescape
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# Import for å hente CSRF tokens
from src.ao_import_httpx import fetch_csrf_tokens



# Cache for auth cookies (logintoken -> (auth_cookie, timestamp))
_auth_cache = {}
_AUTH_CACHE_TTL = 300  # 5 minutter

# Cache for credentials (for auto-relogin)
_credentials_cache = {}  # user_id -> (username, password)

# Sliding expiration cache for AO auth cookie (bruker-id -> (cookie, last_refresh_ts))
_ao_cookie_refresh_cache = {}
_AO_COOKIE_REFRESH_INTERVAL = 600  # 10 minutter

def refresh_ao_cookie_if_needed(auth_cookie: str, user_id: str, logintoken: str = None) -> str:
    """
    Sørger for at .ASPXAUTHNO holdes i live ved å treffe en AO-side hvis det er >10 min siden sist.
    Returnerer evt. ny auth-cookie hvis sliding expiration trigges, ellers None.
    """
    global _ao_cookie_refresh_cache
    now = time.time()
    cache_key = f'{user_id}:{auth_cookie[:16]}'
    last_entry = _ao_cookie_refresh_cache.get(cache_key)
    if last_entry and now - last_entry[1] < _AO_COOKIE_REFRESH_INTERVAL:
        print(f'[AO-COOKIE-REFRESH] Skipper refresh: sist oppdatert for {int(now - last_entry[1])} sekunder siden.', flush=True)
        return None
    # Treff AO-side for sliding expiration
    probe_url = 'https://www.artsobservasjoner.no/Observations'
    print(f'[AO-COOKIE-REFRESH] Prober AO-side for sliding expiration: {probe_url}', flush=True)
    try:
        # Bygg cookie-header med både .ASPXAUTHNO og logintoken hvis tilgjengelig
        cookie_header = f'.ASPXAUTHNO={auth_cookie}'
        if logintoken:
            cookie_header += f'; logintoken={logintoken}; logintoken_ssl=1'
        result = subprocess.run([
            'curl', '-i', '-s',
            probe_url,
            '-H', f'Cookie: {cookie_header}',
            '-H', 'User-Agent: Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)'
        ], capture_output=True, text=True, timeout=10)
        found_set_cookie = False
        for line in result.stdout.split('\n'):
            if 'set-cookie' in line.lower():
                print(f'[AO-COOKIE-REFRESH] Set-Cookie header funnet: {line.strip()}', flush=True)
            if '.ASPXAUTHNO=' in line and 'set-cookie' in line.lower():
                found_set_cookie = True
                match = re.search(r'\.ASPXAUTHNO=([^;\s]+)', line, re.IGNORECASE)
                if match:
                    refreshed = match.group(1)
                    _ao_cookie_refresh_cache[cache_key] = (refreshed, now)
                    print(f'\n######################### TOKEN FORNYET #########################', flush=True)
                    print(f'[AO-COOKIE-REFRESH] Sliding expiration: fikk ny auth-cookie: {refreshed[:20]}...', flush=True)
                    print(f'###############################################################\n', flush=True)
                    return refreshed
        if not found_set_cookie:
            print(f'[AO-COOKIE-REFRESH] Ingen Set-Cookie header med .ASPXAUTHNO funnet i responsen.', flush=True)
        # Ingen ny cookie, men oppdater timestamp for sliding expiration
        _ao_cookie_refresh_cache[cache_key] = (auth_cookie, now)
        print(f'[AO-COOKIE-REFRESH] Sliding expiration: ingen ny cookie, men refresh-tid oppdatert', flush=True)
        return None
    except Exception as e:
        print(f'[AO-COOKIE-REFRESH] Feil ved sliding expiration refresh: {e}', flush=True)
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
    if logintoken in _auth_cache:
        cached_auth, cached_ts = _auth_cache[logintoken]
        if time.time() - cached_ts < _AUTH_CACHE_TTL:
            user_id = logintoken.split(':')[0]
            print(f'[AUTH] Bruker cached auth cookie for user {user_id}', flush=True)
            return (cached_auth, user_id)
    
    # userId er første del av logintoken (før kolon)
    user_id = logintoken.split(':')[0]
    
    print(f'[AUTH] Henter fersk .ASPXAUTHNO for user {user_id}...', flush=True)
    
    # Send request til /LogOn med kun logintoken - følg redirects
    result = subprocess.run([
        'curl', '-i', '-s', '-L',
        'https://www.artsobservasjoner.no/LogOn',
        '-H', f'Cookie: logintoken={logintoken}; logintoken_ssl=1',
        '-H', 'User-Agent: Fugleobservasjoner/1.0 (https://enkel-ao.fly.dev)'
    ], capture_output=True, text=True, timeout=15)
    
    # Parse Set-Cookie for .ASPXAUTHNO
    auth_cookie = None
    for line in result.stdout.split('\n'):
        if '.ASPXAUTHNO=' in line.lower() and 'set-cookie' in line.lower():
            match = re.search(r'\.ASPXAUTHNO=([^;\s]+)', line, re.IGNORECASE)
            if match:
                auth_cookie = f'.ASPXAUTHNO={match.group(1)}'
                break
    
    if not auth_cookie:
        # Prøv å finne feilen
        if 'LogOn' in result.stdout and 'UserName' in result.stdout:
            raise ValueError('logintoken er utløpt - vennligst logg inn på nytt')
        raise ValueError('Kunne ikke hente .ASPXAUTHNO fra logintoken')
    
    # Lagre i cache
    _auth_cache[logintoken] = (auth_cookie, time.time())
    
    print(f'[AUTH] Hentet fersk auth cookie for user {user_id}', flush=True)
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
    print(f'[AO-LOGIN] Starter innlogging for bruker: {username}', flush=True)

    # Steg 1: Hent login-siden for CSRF-token
    result = subprocess.run([
        'curl', '-s', '-c', '/tmp/ao_login_cookies.txt', '-D', '/tmp/ao_login_headers.txt',
        'https://www.artsobservasjoner.no/LogOn',
        '-H', 'User-Agent: Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)'
    ], capture_output=True, text=True, timeout=15)

    login_html = result.stdout

    # Ekstraher __RequestVerificationToken fra HTML-form
    token_match = re.search(
        r'name="__RequestVerificationToken"[^>]*value="([^"]*)"',
        login_html
    )
    if not token_match:
        raise ValueError('Kunne ikke hente CSRF-token fra login-side')

    form_token = token_match.group(1)

    # Les cookie-token fra headers
    with open('/tmp/ao_login_headers.txt', 'r') as f:
        headers_content = f.read()

    cookie_token_match = re.search(
        r'__RequestVerificationToken=([^;\s\r\n]+)',
        headers_content
    )
    cookie_token = cookie_token_match.group(1) if cookie_token_match else ''

    print(f'[AO-LOGIN] Hentet CSRF-tokens, sender innlogging...', flush=True)

    # Steg 2: POST login med credentials
    post_data = (
        f'__RequestVerificationToken={form_token}'
        f'&AuthenticationViewModel.UserName={username}'
        f'&AuthenticationViewModel.Password={password}'
        f'&AuthenticationViewModel.RememberMe=true'
    )

    result = subprocess.run([
        'curl', '-s', '-D', '/tmp/ao_auth_headers.txt',
        '-X', 'POST', 'https://www.artsobservasjoner.no/LogOn',
        '-H', 'Content-Type: application/x-www-form-urlencoded',
        '-H', f'Cookie: __RequestVerificationToken={cookie_token}',
        '-H', 'User-Agent: Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)',
        '-d', post_data
    ], capture_output=True, text=True, timeout=15)

    # Les response headers
    with open('/tmp/ao_auth_headers.txt', 'r') as f:
        auth_headers = f.read()

    # Sjekk for redirect til MyPages (vellykket login)
    if 'Location: ' not in auth_headers and 'location: ' not in auth_headers.lower():
        # Ingen redirect - sjekk om det er feilmelding
        if 'Feil brukernavn' in result.stdout or 'Feil passord' in result.stdout:
            raise ValueError('Feil brukernavn eller passord')
        raise ValueError('Innlogging feilet - ingen redirect mottatt')

    # Parse cookies fra response
    auth_cookie = None
    login_token = None
    user_id = None

    for line in auth_headers.split('\n'):
        line_lower = line.lower()
        if '.aspxauthno=' in line_lower and 'set-cookie' in line_lower:
            match = re.search(r'\.ASPXAUTHNO=([^;\s]+)', line, re.IGNORECASE)
            if match:
                auth_cookie = match.group(1)
        elif 'logintoken=' in line_lower and 'set-cookie' in line_lower:
            match = re.search(r'logintoken=([^;\s]+)', line, re.IGNORECASE)
            if match:
                login_token = match.group(1)
                # Ekstraher userId fra logintoken (før kolon)
                if ':' in login_token:
                    user_id = login_token.split(':')[0]

    if not auth_cookie:
        raise ValueError('Innlogging feilet - ingen auth cookie mottatt')

    if not login_token:
        raise ValueError('Innlogging feilet - ingen logintoken mottatt (husk å krysse av "Husk meg")')

    # Lagre credentials for auto-relogin
    if user_id:
        _credentials_cache[user_id] = (username, password)
        print(f'[AO-LOGIN] Lagret credentials for auto-relogin (user_id={user_id})', flush=True)

    print(f'[AO-LOGIN] Innlogging vellykket! user_id={user_id}, auth_cookie={auth_cookie[:20]}...', flush=True)

    return {
        'authCookie': auth_cookie,
        'loginToken': login_token,
        'userId': user_id
    }


def auto_relogin_if_needed(user_id: str, auth_cookie: str) -> str:
    """
    Sjekker om auth_cookie er utløpt og logger automatisk inn på nytt.

    Args:
        user_id: Bruker-ID
        auth_cookie: Nåværende .ASPXAUTHNO cookie

    Returns:
        Ny auth_cookie hvis relogin var nødvendig, ellers None
    """
    # Sjekk om vi har lagrede credentials
    if user_id not in _credentials_cache:
        print(f'[AUTO-RELOGIN] Ingen lagrede credentials for user_id={user_id}', flush=True)
        return None

    # Test om nåværende cookie fungerer
    probe_result = subprocess.run([
        'curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
        'https://www.artsobservasjoner.no/User/MyPages',
        '-H', f'Cookie: .ASPXAUTHNO={auth_cookie}',
        '-H', 'User-Agent: Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)'
    ], capture_output=True, text=True, timeout=10)

    # Hvis vi får 200, er cookien fortsatt gyldig
    if probe_result.stdout.strip() == '200':
        return None

    print(f'[AUTO-RELOGIN] Cookie utløpt for user_id={user_id}, logger inn på nytt...', flush=True)

    # Hent credentials og logg inn på nytt
    username, password = _credentials_cache[user_id]
    try:
        result = login_to_ao(username, password)
        print(f'[AUTO-RELOGIN] Vellykket! Ny auth_cookie hentet.', flush=True)
        return result['authCookie']
    except Exception as e:
        print(f'[AUTO-RELOGIN] Feilet: {e}', flush=True)
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

    req = Request(
        ao_url,
        headers={
            'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner-Python/0.1)',
            'Accept': 'text/html, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'https://www.artsobservasjoner.no/SubmitSighting/Report',
        },
    )

    try:
        with urlopen(req, timeout=10) as resp:
            html_bytes = resp.read()
        html = html_bytes.decode('utf-8', errors='ignore')

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
        print('Feil ved henting fra Artsobservasjoner:', e)
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

    req = Request(
        nominatim_url,
        headers={
            'User-Agent': 'Fugleobservasjoner/0.1 (hobbyprosjekt)',
            'Accept': 'application/json',
        },
    )

    try:
        with urlopen(req, timeout=10) as resp:
            body = resp.read().decode('utf-8', errors='ignore')
        
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
        print('Feil ved reverse geokoding:', e)
        raise


def handle_ao_sites_search(lat, lon, size_m=600.0, ao_mobile_base_url='https://mobil.artsobservasjoner.no', user_id=None, login_token=None, auth_cookie=None):
    """Håndter søk etter AO-lokaliteter.
    
    Returns:
        tuple: (sites_list, refreshed_auth_cookie_or_None)
    """
    # Valider input
    try:
        lat = float(lat)
        lon = float(lon)
        size_m = float(size_m) if size_m else 600.0
    except ValueError:
        raise ValueError('Ugyldig lat/lon/size')
        
    # Variabel for å holde styr på refreshed tokens
    refreshed_auth_cookie = None
    # Sliding expiration: prøv å holde auth_cookie i live hvis mulig
    ao_user_id = user_id or (login_token.split(':')[0] if login_token and ':' in login_token else None)
    ao_auth = auth_cookie or os.getenv('AO_AUTH_COOKIE')
    if ao_auth and ao_user_id:
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

    print(
        f'[DEBUG] AO-sites forespørsel: lat={lat:.6f}, lon={lon:.6f}, size_m={size_m:.1f}, '
        f'minX={min_x:.6f}, minY={min_y:.6f}, maxX={max_x:.6f}, maxY={max_y:.6f}',
        flush=True
    )
    print(f'[DEBUG] AO-tokens mottatt: user_id={bool(user_id)}, login_token={bool(login_token)}, auth_cookie={bool(auth_cookie)}', flush=True)

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
            print(f'[DEBUG] Hentet fersk auth cookie automatisk for user {ao_user_id}', flush=True)
        except ValueError as e:
            print(f'[DEBUG] Kunne ikke hente auth cookie: {e}', flush=True)
            ao_auth = None

    print(f'[DEBUG] AO-tokens final: user_id={ao_user_id}, login_token={ao_login[:20] if ao_login else None}..., auth_cookie={ao_auth[:30] if ao_auth else None}...', flush=True)
    
    if ao_login and ao_auth and ao_user_id:
        try:
            # Normaliser AO_AUTH_COOKIE verdi
            auth_val = ao_auth
            if auth_val.startswith('.ASPXAUTHNO='):
                auth_val = auth_val.split('=', 1)[1]

            # Hent CSRF token fra AO (samme strategi som ao_import)
            try:
                _, csrf_cookie_token, refreshed = fetch_csrf_tokens(ao_login, auth_val)
                print(f'[DEBUG] GetSitesGeoJson: Hentet CSRF token: {csrf_cookie_token[:30] if csrf_cookie_token else None}...', flush=True)
                # Bruk eventuell refreshed auth cookie
                if refreshed:
                    auth_val = refreshed
                    refreshed_auth_cookie = refreshed
                    print(f'[DEBUG] GetSitesGeoJson: Bruker refreshed auth cookie', flush=True)
            except Exception as csrf_err:
                print(f'[DEBUG] GetSitesGeoJson: Kunne ikke hente CSRF token: {csrf_err}', flush=True)
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

            # Cookie-streng - inkluder CSRF token hvis vi har den
            cookies = f'AcceptCookies=1; .ASPXAUTHNO={auth_val}; logintoken={ao_login}'
            if csrf_cookie_token:
                cookies += f'; __RequestVerificationToken={csrf_cookie_token}'
            
            geojson_url = 'https://www.artsobservasjoner.no/Map/GetSitesGeoJson'
            post_data = json.dumps({
                'zoomLevel': 16,
                'bbox': bbox_str,
                'userId': int(ao_user_id),
                'coordSyst': 0,
                'speciesGroupId': '0',  # Alle artsgrupper, ikke bare fugler
                'taxonId': None
            })

            print(f'[DEBUG] GetSitesGeoJson POST to {geojson_url}', flush=True)
            print(f'[DEBUG] GetSitesGeoJson bbox: {bbox_str}', flush=True)
            
            # Bruk curl subprocess (urllib gir tom respons, curl fungerer)
            # Legg til -i for å få response headers med
            import subprocess
            curl_result = subprocess.run([
                'curl', '--compressed', '-s', '-i',  # -i gir response headers
                geojson_url,
                '-X', 'POST',
                '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
                '-H', 'Accept: */*',
                '-H', 'Content-Type: application/json; charset=UTF-8',
                '-H', 'X-Requested-With: XMLHttpRequest',
                '-H', 'Origin: https://www.artsobservasjoner.no',
                '-H', 'Referer: https://www.artsobservasjoner.no/SubmitSighting/Report',
                '-H', f'Cookie: {cookies}',
                '-d', post_data
            ], capture_output=True, text=True, timeout=15)
            
            full_response = curl_result.stdout
            # Split headers fra body (dobbel newline skiller)
            if '\r\n\r\n' in full_response:
                headers_part, body = full_response.split('\r\n\r\n', 1)
            elif '\n\n' in full_response:
                headers_part, body = full_response.split('\n\n', 1)
            else:
                headers_part, body = '', full_response
            
            # Parse Set-Cookie header for refreshed auth token
            if not refreshed_auth_cookie and 'Set-Cookie:' in headers_part:
                try:
                    import re
                    # Finn .ASPXAUTHNO cookie value
                    cookie_match = re.search(r'Set-Cookie:.*\.ASPXAUTHNO=([^;\r\n]+)', headers_part, re.IGNORECASE)
                    if cookie_match:
                        refreshed_auth_cookie = cookie_match.group(1)
                        print(f'[DEBUG] GetSitesGeoJson: Fant refreshed auth cookie', flush=True)
                except Exception as cookie_err:
                    print(f'[DEBUG] GetSitesGeoJson: Feil ved parsing av Set-Cookie: {cookie_err}', flush=True)
            
            print(f'[DEBUG] GetSitesGeoJson body length: {len(body)}, first 500: {repr(body[:500])}', flush=True)
            geojson_data = json.loads(body) if body else None
            print(f'[DEBUG] GetSitesGeoJson parsed keys: {list(geojson_data.keys()) if isinstance(geojson_data, dict) else type(geojson_data)}', flush=True)

            # GetSitesGeoJson returnerer { points: { features: [...] }, polygons: {...} }
            # Brukerens egne sites har isPrivate=true
            if isinstance(geojson_data, dict):
                # Sjekk points.features
                points = geojson_data.get('points', {})
                if isinstance(points, dict):
                    for feature in points.get('features', []):
                        props = feature.get('properties', {})
                        if props.get('isPrivate'):
                            site_id = props.get('siteId') or props.get('id') or feature.get('id')
                            if site_id is not None:
                                my_site_ids.add(int(site_id))
                # Sjekk også polygons.features
                polygons = geojson_data.get('polygons', {})
                if isinstance(polygons, dict):
                    for feature in polygons.get('features', []):
                        props = feature.get('properties', {})
                        if props.get('isPrivate'):
                            site_id = props.get('siteId') or props.get('id') or feature.get('id')
                            if site_id is not None:
                                my_site_ids.add(int(site_id))
            
            print(f'GetSitesGeoJson: fant {len(my_site_ids)} private site-IDs')
        except Exception as geojs_err:
            # Logging feil ved henting av brukerens egne lokasjoner - ikke kritisk
            print(f'Feil i GetSitesGeoJson: {geojs_err}')
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

    req = Request(
        ao_sites_url,
        headers={
            'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner-Python/0.1)',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Encoding': 'identity',
            'X-CSRF': '1',
            'Referer': 'https://mobil.artsobservasjoner.no/contribute/submit-sightings',
        },
    )

    try:
        with urlopen(req, timeout=10) as resp:
            # Sjekk etter refreshed auth cookie også her
            if not refreshed_auth_cookie:  # Kun hvis ikke allerede satt
                try:
                    set_cookie_header = resp.headers.get('Set-Cookie', '')
                    if set_cookie_header and '.ASPXAUTHNO=' in set_cookie_header:
                        import re
                        match = re.search(r'\.ASPXAUTHNO=([^;]+)', set_cookie_header)
                        if match:
                            refreshed_auth_cookie = match.group(1)
                            print(f'Fikk refreshed auth cookie fra ByBoundingBox')
                except Exception as cookie_err:
                    print(f'Feil ved parsing av Set-Cookie: {cookie_err}')
            
            body = resp.read().decode('utf-8', errors='ignore')
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
            print(f'[AO-SITES] Lokasjoner med isMine=True:')
            for s in mine_sites:
                print(f'  - Navn: {s.get("name")}, ID: {s.get("id")}, Lat: {s.get("lat")}, Lon: {s.get("lon")}')
        else:
            print('[AO-SITES] Ingen lokasjoner med isMine=True i sites-array.')

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

        print(f'AO-sites svar: {len(sites)} lokaliteter returnert')
        if sites[:3]:
            print('AO-sites eksempelsteder:', [s.get('name') for s in sites[:3]])

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

        return sites, refreshed_auth_cookie
    except Exception as e:
        print('Feil ved henting av AO-lokaliteter:', repr(e))
        raise