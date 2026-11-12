"""
API handlers for fugleobservasjoner.

Håndterer eksterne API-kall til Artsobservasjoner og Nominatim.
"""

import hashlib
import hmac
import json
import logging
import math
import re
import os
import threading
import time
from datetime import datetime, timezone
from html import unescape
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger('fugleobs')

from src.utils import mask_token


# Import for å hente CSRF tokens
from src.ao_import_httpx import fetch_csrf_tokens


def fetch_ao_autocomplete(term: str, login_token: str = None, auth_cookie: str = None, user_id: str = None, location_db=None, lat: float = None, lon: float = None, username: str = None, client_ip: str = None) -> dict:
    """
    Hent autocomplete-forslag for lokaliteter.

    Søker først i lokal DB (hvis tilgjengelig), deretter i AO (hvis innlogget).
    Uten innlogging returneres kun lokale resultater.

    Args:
        term: Søketekst (minimum 2-3 tegn)
        login_token: Optional logintoken cookie (for å inkludere private lokaliteter)
        auth_cookie: Optional .ASPXAUTHNO cookie (for å inkludere private lokaliteter)
        user_id: Optional bruker-ID (for auto-relogin)
        location_db: Optional LocationDB-instans for lokalt søk

    Returns:
        Dict med 'results' (liste) og 'refreshed_auth_cookie' (str eller None)
    """
    if not term or len(term) < 2:
        return {'results': [], 'refreshed_auth_cookie': None}

    # Søk i lokal DB først (alltid tilgjengelig, ingen innlogging nødvendig)
    local_results = []
    if location_db:
        try:
            local_sites = location_db.search_by_name(term, limit=20, lat=lat, lon=lon)
            # Konverter til AO autocomplete-format
            local_results = []
            for site in local_sites:
                parts = [p for p in [site.get('municipality'), site.get('county')] if p]
                entry = {
                    'id': site['id'],
                    'value': site['name'],
                    'presentationvalue': site['name'],
                    'subvalue': ', '.join(parts),
                    '_source': 'local_db',
                    'isSuper': site.get('isSuper', False),
                    'isPrivate': site.get('isPrivate', False),
                }
                if '_distance' in site:
                    entry['_distance'] = site['_distance']
                local_results.append(entry)
            logger.debug(f'[AO-AUTOCOMPLETE] Lokal DB: {len(local_results)} treff for "{term}"')
        except Exception as e:
            logger.warning(f'[AO-AUTOCOMPLETE] Lokal DB-søk feilet: {e}')

    refreshed_auth_cookie = None
    is_logged_in = bool(login_token and (auth_cookie or user_id))

    # Prøv AO bare hvis innlogget
    if not is_logged_in:
        if local_results:
            return {'results': local_results, 'refreshed_auth_cookie': None}
        return {'results': [], 'refreshed_auth_cookie': None, 'not_logged_in': True}

    # Sørg for gyldig auth (sliding expiration → logintoken → credentials)
    if user_id and login_token:
        auth_cookie, refreshed_auth_cookie = _ensure_auth(auth_cookie, user_id, login_token, username=username, client_ip=client_ip)

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

            # Sjekk om vi ble redirectet til innloggingssiden
            if '/LogOn' in str(response.url):
                logger.warning(f'[AO-AUTOCOMPLETE] Auth utløpt — redirectet til innloggingsside for term={term}')
                # Returner lokale resultater selv om AO-auth feilet
                if local_results:
                    return {'results': local_results, 'refreshed_auth_cookie': refreshed_auth_cookie, 'auth_expired': True}
                return {'results': [], 'refreshed_auth_cookie': refreshed_auth_cookie, 'auth_expired': True}

            # Sjekk om responsen er JSON
            content_type = response.headers.get('content-type', '')
            if 'application/json' not in content_type:
                logger.warning(f'[AO-AUTOCOMPLETE] Ikke-JSON respons. Første 500 tegn: {response.text[:500]}')
                return {'results': local_results, 'refreshed_auth_cookie': refreshed_auth_cookie}

            ao_results = response.json()

            # Merge: AO-resultater først, deretter lokale som ikke finnes i AO
            ao_ids = {r.get('id') for r in ao_results if r.get('id') is not None}
            merged = ao_results + [r for r in local_results if r['id'] not in ao_ids]

            return {'results': merged, 'refreshed_auth_cookie': refreshed_auth_cookie}
    except Exception as e:
        logger.error(f'[AO-AUTOCOMPLETE] Feil ved henting: {e}')
        # Ved AO-feil, returner lokale resultater
        return {'results': local_results, 'refreshed_auth_cookie': refreshed_auth_cookie}



# Sliding expiration cache for AO auth cookie (bruker-id -> (cookie, last_refresh_ts))
_ao_cookie_refresh_cache = {}
_AO_COOKIE_REFRESH_INTERVAL = 300  # 5 minutter (balanse mellom overhead og token-friskhet)

# Lock for trådsikker tilgang til alle cacher (ThreadingHTTPServer)
_cache_lock = threading.Lock()

# Filbasert credentials-lagring (overlever server-restart)
_CREDENTIALS_PATH = os.environ.get('CREDENTIALS_PATH', '/data/credentials.json')


# Hvor mange logintokener én bruker kan ha passordfallback på samtidig.
#
# IKKE «én per enhet», selv om det var tanken: `handleDirectSend` i
# public/js/export-operations.js logger inn på nytt ved HVER sending til AO, og
# AO gir et nytt logintoken hver gang. Ti sendinger fra mobilen presset derfor
# PC-ens token ut av lista, og PC-en mistet fallbacken sin uten noe synlig
# varsel. Taket er hevet til 25 for å gi den slitasjen mye mer slingringsrom
# (25 avtrykk er ~1,6 kB per bruker).
#
# Bites det likevel: riktig fiks er å kaste ut det SIST BRUKTE tokenet, ikke det
# eldst lagrede — da beholder en enhet som faktisk er i bruk plassen sin. Det
# krever en skriving ved hvert oppslag, og er ikke gjort nå.
_MAX_TOKENS_PER_USER = 25


def _token_hash(login_token: str) -> str:
    return hashlib.sha256(login_token.encode('utf-8')).hexdigest()


def _load_credentials(username: str, login_token: str = None) -> tuple:
    """Last credentials fra disk. Returnerer (username, password) eller None.

    Passordet utleveres KUN til en klient som viser fram et logintoken den selv
    fikk fra en innlogging med dette passordet (lagret som SHA-256 i
    `tokens`). Uten den bindingen kunne hvem som helst som kjente et
    brukernavn, få serveren til å logge inn med det lagrede passordet og sende
    den ferske sesjonscookien tilbake — en AO-sesjon for en annen bruker.
    Den som allerede har brukerens logintoken, får ikke noe nytt av dette:
    tokenet gir sesjon gjennom husk-meg-revival uansett.

    Nøkkelen er brukernavn (case-insensitive), IKKE AOs "user_id" fra
    logintoken-prefikset — det tallet er IKKE stabilt per konto, se
    docs/ao-token-autentisering.md.
    """
    if not username or not login_token:
        return None
    try:
        with open(_CREDENTIALS_PATH, 'r') as f:
            data = json.load(f)
        entry = data.get(username.lower())
        if not entry:
            return None
        oppgitt = _token_hash(login_token)
        if any(hmac.compare_digest(oppgitt, t) for t in entry.get('tokens') or []):
            return (entry['username'], entry['password'])
    except (FileNotFoundError, json.JSONDecodeError, KeyError, TypeError):
        pass
    return None


def _save_credentials(username: str, password: str, login_token: str):
    """Lagre credentials til disk (trådsikkert), nøkkel = brukernavn (lowercased).

    `login_token` er tokenet klienten får tilbake fra denne innloggingen. Bare
    en klient som har det, kan senere bruke passordfallbacket (se
    `_load_credentials`).
    """
    try:
        os.makedirs(os.path.dirname(_CREDENTIALS_PATH), exist_ok=True)
        with _cache_lock:
            try:
                with open(_CREDENTIALS_PATH, 'r') as f:
                    data = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                data = {}
            tidligere = data.get(username.lower()) or {}
            tokens = [t for t in (tidligere.get('tokens') or []) if isinstance(t, str)]
            ny = _token_hash(login_token)
            if tokens and tokens[-1] == ny and tidligere.get('password') == password:
                return  # samme token og passord som sist — ingenting å skrive
            tokens = [t for t in tokens if t != ny] + [ny]
            data[username.lower()] = {
                'username': username,
                'password': password,
                'tokens': tokens[-_MAX_TOKENS_PER_USER:],
            }
            with open(_CREDENTIALS_PATH, 'w') as f:
                json.dump(data, f)
    except Exception as e:
        logger.warning(f'[CREDENTIALS] Kunne ikke lagre credentials: {e}')


def _migrate_credentials_file():
    """Fjern rader uten tokenbinding fra credentials.json.

    Rader lagret før bindingen ble innført (inkludert det enda eldre
    user_id-formatet) kan aldri brukes igjen av `_load_credentials`, så
    passordene i dem er bare en risiko på disk. Brukeren får en ny rad med
    binding ved neste innlogging. Kjøres ved import, idempotent.
    """
    try:
        with _cache_lock:
            try:
                with open(_CREDENTIALS_PATH, 'r') as f:
                    data = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                return
            beholdt = {
                k: v for k, v in data.items()
                if isinstance(v, dict) and v.get('tokens') and not k.isdigit()
            }
            if len(beholdt) == len(data):
                return
            with open(_CREDENTIALS_PATH, 'w') as f:
                json.dump(beholdt, f)
            logger.info(
                f'[CREDENTIALS] Fjernet {len(data) - len(beholdt)} rader uten tokenbinding, '
                f'{len(beholdt)} beholdt'
            )
    except Exception as e:
        logger.warning(f'[CREDENTIALS] Migrering feilet: {e}')


_migrate_credentials_file()

def _sliding_expiration(auth_cookie: str, user_id: str, login_token: str = None) -> str:
    """Forleng AO-session via sliding expiration (rate-limited).

    Treffer /User/MyPages med eksisterende cookie for å trigge fornyelse.
    Rate-limited til maks 1 gang per 5 minutter per bruker.

    Returns:
        Ny auth-cookie hvis AO fornyet, ellers None.
    """
    now = time.time()
    cache_key = f'{user_id}:{auth_cookie[:16]}'
    with _cache_lock:
        last_entry = _ao_cookie_refresh_cache.get(cache_key)
    if last_entry and now - last_entry[1] < _AO_COOKIE_REFRESH_INTERVAL:
        return None

    try:
        cookies = {'.ASPXAUTHNO': auth_cookie, 'AcceptCookies': '1'}
        if login_token:
            cookies['logintoken'] = login_token
            cookies['logintoken_ssl'] = '1'

        with httpx.Client(cookies=cookies) as client:
            response = client.get(
                'https://www.artsobservasjoner.no/User/MyPages',
                headers={'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)'},
                timeout=10,
                follow_redirects=True
            )

            # Finn ny .ASPXAUTHNO fra cookie jar
            new_auth = None
            for cookie in client.cookies.jar:
                if cookie.name == '.ASPXAUTHNO' and cookie.value != auth_cookie:
                    new_auth = cookie.value
                    break

            # Oppdater rate-limit uansett (unngå spam mot AO)
            with _cache_lock:
                _ao_cookie_refresh_cache[cache_key] = (new_auth or auth_cookie, now)

            # VIKTIG: Sjekk /LogOn-redirect FØR new_auth tolkes. Ved utløpt cookie
            # setter AO en logout/anonym .ASPXAUTHNO (forskjellig verdi) som ellers
            # feilaktig ville blitt returnert som en «fornyelse» og hoppet over relogin.
            if '/LogOn' in str(response.url):
                logger.debug('[SLIDING] Cookie utløpt (redirect til /LogOn)')
                return None

            if new_auth:
                logger.info(f'[SLIDING] Fikk ny auth-cookie: {mask_token(new_auth)}')
                return new_auth

            logger.info('[SLIDING] Cookie fortsatt gyldig, ingen fornyelse nødvendig')
            return None
    except Exception as e:
        logger.error(f'[SLIDING] Feil: {e}')
        return None


def login_to_ao(username: str, password: str, bind_token: bool = True, *, diskret: bool = False) -> dict:
    """
    Logger inn på Artsobservasjoner med brukernavn/passord.

    `bind_token=False` brukes når SERVEREN logger inn på brukerens vegne
    (`_full_relogin`). Tokenet AO gir da, ser klienten aldri — å binde det ville
    bare presset brukerens egne, gyldige avtrykk nærmere taket uten at noen kan
    bruke det nye.

    `diskret=True` utelater brukernavn og sesjonsdata fra overføringsloggen.

    Returnerer dict med:
    - authCookie: .ASPXAUTHNO cookie-verdi
    - loginToken: logintoken for "husk meg" (varer 1 år)
    - userId: bruker-ID

    Raises:
        ValueError: Ved ugyldig brukernavn/passord eller andre feil
    """
    if not diskret:
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

        # Parse cookies fra response (sjekk både auth_response og client jar)
        auth_cookie = auth_response.cookies.get('.ASPXAUTHNO') or client.cookies.get('.ASPXAUTHNO')
        login_token = auth_response.cookies.get('logintoken') or client.cookies.get('logintoken')
        user_id = None
        if login_token and ':' in login_token:
            user_id = login_token.split(':')[0]

        # Sjekk om innloggingen lyktes (auth-cookie mottatt og gyldig redirect)
        location = auth_response.headers.get('location', '')
        is_redirect_to_logon = bool(location and '/logon' in location.lower())

        if not auth_cookie or is_redirect_to_logon or auth_response.status_code not in (302, 303):
            # Innlogging feilet - forsøk å hente presis feilmelding fra valideringsoppsummeringen i HTML
            val_match = re.search(
                r'class="validation-summary-errors"[^>]*>.*?<ul>(.*?)</ul>',
                auth_response.text,
                re.DOTALL
            )
            feil_tekst = None
            if val_match:
                li_matches = re.findall(r'<li>(.*?)</li>', val_match.group(1), re.DOTALL)
                if li_matches:
                    feil_tekst = re.sub(r'<[^>]+>', '', li_matches[0]).strip()

            if feil_tekst:
                raise ValueError(feil_tekst)

            lower_text = auth_response.text.lower()
            if any(term in lower_text for term in [
                'feil epost', 'feil brukernavn', 'feil passord',
                'innlogging mislyktes', 'ugyldig brukernavn', 'ugyldig passord'
            ]):
                raise ValueError('Feil epost, brukernavn eller passord')

            if is_redirect_to_logon:
                raise ValueError('Feil epost, brukernavn eller passord')

            raise ValueError('Innlogging feilet - kontroller brukernavn og passord')

        if not login_token:
            raise ValueError('Innlogging feilet - ingen logintoken mottatt (husk å krysse av "Husk meg")')

        # Lagre credentials for auto-relogin (persistert til disk, nøkkel = brukernavn —
        # IKKE user_id, som er ustabilt per AO-konto, se _load_credentials-docstring)
        if bind_token:
            _save_credentials(username, password, login_token)
            if not diskret:
                logger.debug(f'[AO-LOGIN] Lagret credentials for auto-relogin (bruker={username})')

        if not diskret:
            logger.info(f'[AO-LOGIN] Innlogging vellykket! user_id={user_id}, auth_cookie={mask_token(auth_cookie)}')

        return {
            'authCookie': auth_cookie,
            'loginToken': login_token,
            'userId': user_id
        }


def _refresh_with_logintoken(login_token: str, user_id: str) -> str:
    """Gjenoppretter .ASPXAUTHNO via logintoken (AO sin "husk meg"-auto-login).

    VIKTIG — mekanisme (revidert 2026-09-16, se docs/ao-token-autentisering.md):
    - Må treffe `/LogOn?ReturnUrl=<beskyttet-side>` — IKKE bar forside «/». Husk-meg-logikken
      trigges av redirecten til selve innloggingssiden med en ReturnUrl, ikke av et vilkårlig
      GET mot en anonym side. (Tidligere antatt at beskyttede sider «kortslo» revival — det var
      feil konklusjon; poenget er å FØLGE redirect-kjeden helt, ikke unngå den.)
      Bevist empirisk i ekte nettlesersesjon (Chrome, 2026-09-16): en beskyttet side redirectet
      til nettopp `/LogOn?ReturnUrl=...`, og sesjonen ble gjenopprettet stille der — ingen
      innloggingsskjema vist, ingen passord sendt.
    - `logintoken_ssl=1` er PÅKREVD.
    - Ingen .ASPXAUTHNO må sendes: en gammel/død cookie kortslutter auto-login.

    logintoken har ~1 års levetid, så dette gir langvarig sesjon uten passord.
    Cookies settes på CLIENT-nivå for å videresendes ved redirects.

    Returns:
        Ny .ASPXAUTHNO hvis vellykket, ellers None.
    """
    if not login_token:
        return None

    logger.debug(f'[LOGINTOKEN-REFRESH] Prøver husk-meg-revival med logintoken: {mask_token(login_token)}')

    try:
        # Kun logintoken + logintoken_ssl, INGEN .ASPXAUTHNO (den ville blokkert revival)
        with httpx.Client(cookies={
            'logintoken': login_token,
            'logintoken_ssl': '1',
            'AcceptCookies': '1'
        }) as client:
            response = client.get(
                'https://www.artsobservasjoner.no/LogOn?ReturnUrl=%2fUser%2fMyPages',
                headers={'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)'},
                timeout=10,
                follow_redirects=True
            )

            # Revival mislyktes hvis vi fortsatt står på login-siden (ingen redirect skjedde)
            if '/LogOn' in str(response.url):
                logger.warning(
                    f'[LOGINTOKEN-REFRESH] AO nektet revival for user_id={user_id} '
                    f'— ble værende på {response.url} (status={response.status_code})'
                )
                return None

            for cookie in client.cookies.jar:
                if cookie.name == '.ASPXAUTHNO' and cookie.value:
                    logger.info(f'[LOGINTOKEN-REFRESH] Session gjenopprettet via husk-meg: {mask_token(cookie.value)}')
                    return cookie.value

            # Ingen auth-cookie: AO redirectet oss videre, men satte den ikke.
            # Cookie-navnene viser om AO ignorerte token eller ga noe uventet.
            cookie_names = ', '.join(sorted(c.name for c in client.cookies.jar)) or 'ingen'
            logger.warning(
                f'[LOGINTOKEN-REFRESH] Ingen .ASPXAUTHNO mottatt for user_id={user_id} '
                f'(status={response.status_code}, sluttside={response.url}, cookies: {cookie_names})'
            )
        return None
    except Exception as e:
        logger.error(f'[LOGINTOKEN-REFRESH] Feil: {e}')
        return None


def _full_relogin(user_id: str, login_token: str = None, username: str = None, client_ip: str = None) -> str:
    """Fornyer session. Prøver logintoken først, deretter credentials fra disk.

    `username` (brukerens AO-innloggingsnavn, sendt av klienten som `X-AO-Username`)
    er nøkkelen credentials slås opp på — IKKE `user_id`. `user_id` (AOs
    logintoken-prefiks) er kun til logging/statistikk her, siden det viste seg
    IKKE å være stabilt per konto (se _load_credentials-docstring).

    `client_ip` logges på relogin-linjene. Det tydeligste tegnet på et forsøk på
    å misbruke passord-fallbacket er ÉN IP som relogger inn mange forskjellige
    brukernavn — uten IP-en i loggen er det mønsteret usynlig (se
    docs/ao-token-autentisering.md korreksjon 4).

    Returns:
        Ny .ASPXAUTHNO hvis vellykket, ellers None.
    """
    # Denne funksjonen kalles KUN når sliding expiration feilet (cookie utløpt).
    logger.info(f'[AUTH-RELOGIN-REQUIRED] Sliding expiration feilet for user_id={user_id} (ip={client_ip}), må logge inn på nytt')

    # Steg 1: Prøv logintoken-refresh (ingen credentials nødvendig)
    if login_token:
        new_cookie = _refresh_with_logintoken(login_token, user_id)
        if new_cookie:
            logger.info(f'[AUTH-RELOGIN-RESULT] Logintoken-refresh vellykket for user_id={user_id} (ip={client_ip})')
            return new_cookie
    else:
        # Uten token er revival umulig — skiller «AO nektet» fra «token kom aldri fram»
        logger.warning(f'[LOGINTOKEN-REFRESH] Hoppet over for user_id={user_id} (ip={client_ip}) — klienten sendte ingen logintoken')

    # Steg 2: Full relogin med lagrede credentials (fra disk, nøkkel = brukernavn,
    # utlevert kun mot et logintoken fra en innlogging med samme passord)
    if not username:
        logger.warning(f'[AUTH-RELOGIN-RESULT] Intet brukernavn oppgitt for user_id={user_id} (ip={client_ip}) — kan ikke slå opp lagrede credentials')
        return None

    creds = _load_credentials(username, login_token)
    if not creds:
        logger.warning(f'[AUTH-RELOGIN-RESULT] Ingen lagrede credentials for bruker={username} bundet til dette logintokenet (user_id={user_id}, ip={client_ip}) — bruker må logge inn manuelt')
        return None

    saved_username, password = creds
    try:
        result = login_to_ao(saved_username, password, bind_token=False)
        logger.info(f'[AUTH-RELOGIN-RESULT] Credentials-relogin vellykket for bruker={saved_username} (user_id={user_id}, ip={client_ip})')
        return result['authCookie']
    except Exception as e:
        logger.warning(f'[AUTH-RELOGIN-RESULT] Credentials-relogin feilet for bruker={username} (user_id={user_id}, ip={client_ip}): {e}')
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


def handle_ao_private_sites(auth_cookie: str, ao_base_url: str = 'https://www.artsobservasjoner.no', login_token: str = None, user_id: str = None, username: str = None, client_ip: str = None) -> tuple:
    """
    Hent alle brukerens private lokasjoner via BindUserSitesGrid.

    Returnerer tuple: (sites, refreshed_auth_cookie, auth_failed)
    hvor sites er liste med dicts: { id, name, lat, lon, acc },
    refreshed_auth_cookie er ny .ASPXAUTHNO hvis sesjonen ble fornyet (ellers None),
    og auth_failed sier om den tomme lista skyldes en død sesjon.
    Koordinater er konvertert fra EPSG:3857 til WGS84.

    **`auth_failed` finnes fordi en tom liste ellers er tvetydig**: den betyr
    enten «brukeren har ingen private lokaliteter» eller «sesjonen er død».
    Klienten cacher svaret i 24 timer, så uten skillet låste en død sesjon
    brukeren ut av sine EGNE lokaliteter i et helt døgn — også etter at hun
    hadde logget inn på nytt (feltfunn på staging 09.11.2026). Samme regel som
    bbox-cachen i api.js har hatt hele tiden: degraderte svar caches aldri.
    Samme form som søsterfunksjonen handle_ao_sites_search.

    BindUserSitesGrid er et Kendo-grid-endepunkt som krever X-Requested-With: XMLHttpRequest.

    Med user_id + login_token sikres gyldig sesjon (sliding → logintoken-revival →
    credentials) FØR kallet, slik at en utløpt .ASPXAUTHNO ikke gir tom liste.
    """
    # Sørg for gyldig auth (sliding expiration → logintoken → credentials)
    refreshed_auth_cookie = None
    if user_id and login_token:
        auth_cookie, refreshed_auth_cookie = _ensure_auth(auth_cookie, user_id, login_token, username=username, client_ip=client_ip)

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
        resp_url = str(getattr(response, 'url', '') or '')
        if '/LogOn' in resp_url:
            logger.warning('[AO-PRIVATE-SITES] Ble sendt til /LogOn — sesjon er utløpt')
            return [], refreshed_auth_cookie, True
        try:
            data = response.json()
        except ValueError:
            logger.warning('[AO-PRIVATE-SITES] Fikk ikke-JSON svar fra AO — sesjon er trolig utløpt')
            return [], refreshed_auth_cookie, True

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
    return sites, refreshed_auth_cookie, False


def _wgs84_to_mercator(lat, lon):
    """Konverter WGS84 (lat, lon) til Web Mercator (EPSG:3857)."""
    x = lon * 20037508.34 / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) / (math.pi / 180)
    y = y * 20037508.34 / 180
    return x, y


def _compute_bbox(lat, lon, size_m):
    """Beregn geografisk bounding box i WGS84.

    Boksen strekker seg size_m meter i hver kardinalretning slik at den
    omsluttes den haversine-sirkelen search_nearby() bruker (radius=size_m).
    """
    half_m = max(size_m, 1.0)
    meters_per_deg_lat = 111_320.0
    meters_per_deg_lon = meters_per_deg_lat * math.cos(math.radians(lat)) or 1.0

    d_lat = half_m / meters_per_deg_lat
    d_lon = half_m / meters_per_deg_lon

    return {
        'min_x': lon - d_lon, 'max_x': lon + d_lon,
        'min_y': lat - d_lat, 'max_y': lat + d_lat,
    }


def _ensure_auth(ao_auth, ao_user_id, login_token, username=None, client_ip=None):
    """Sørg for at auth-cookie er gyldig.

    Strategi (én HTTP-request i normaltilfelle):
    1. Sliding expiration — forleng eksisterende session (rate-limited)
    2. Hvis cookie utløpt — full relogin (logintoken → credentials, sistnevnte
       slått opp på `username`, se _load_credentials-docstring)

    Returns:
        tuple: (ao_auth, refreshed_auth_cookie_or_None)
    """
    if not ao_user_id:
        return ao_auth, None

    refreshed = None

    # Steg 1: Sliding expiration (forlenger gyldig session)
    if ao_auth:
        new_cookie = _sliding_expiration(ao_auth, ao_user_id, login_token)
        if new_cookie:
            return new_cookie, new_cookie

    # Steg 2: Hvis ingen auth eller sliding feilet, prøv full relogin
    if not ao_auth or _is_cookie_expired(ao_auth, ao_user_id, login_token):
        new_cookie = _full_relogin(ao_user_id, login_token, username=username, client_ip=client_ip)
        if new_cookie:
            return new_cookie, new_cookie

    return ao_auth, refreshed


def _is_cookie_expired(auth_cookie, user_id, login_token):
    """Sjekk om auth-cookie er utløpt ved å probe MyPages."""
    try:
        cookies = {'.ASPXAUTHNO': auth_cookie, 'AcceptCookies': '1'}
        if login_token:
            cookies['logintoken'] = login_token
            cookies['logintoken_ssl'] = '1'

        with httpx.Client(cookies=cookies) as client:
            response = client.get(
                'https://www.artsobservasjoner.no/User/MyPages',
                headers={'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)'},
                timeout=10,
                follow_redirects=True
            )
            # Redirect til /LogOn = utløpt
            return '/LogOn' in str(response.url)
    except Exception:
        return True  # Anta utløpt ved feil


def _fetch_private_site_ids(lat, lon, size_m, ao_login, ao_auth, ao_user_id, refreshed_auth_cookie):
    """Hent brukerens private site-IDer via GetSitesGeoJson.

    Returns:
        tuple: (my_site_ids: set, refreshed_auth_cookie, auth_failed: bool)
    """
    my_site_ids = set()
    auth_failed = False

    if not (ao_login and ao_auth and ao_user_id):
        return my_site_ids, refreshed_auth_cookie, auth_failed

    try:
        # Normaliser AO_AUTH_COOKIE verdi
        auth_val = ao_auth
        if auth_val.startswith('.ASPXAUTHNO='):
            auth_val = auth_val.split('=', 1)[1]

        # Hent CSRF token fra AO
        csrf_cookie_token = None
        try:
            _, csrf_cookie_token, refreshed = fetch_csrf_tokens(ao_login, auth_val)
            logger.debug(f'GetSitesGeoJson: Hentet CSRF token: {mask_token(csrf_cookie_token)}')
            if refreshed:
                auth_val = refreshed
                refreshed_auth_cookie = refreshed
        except Exception as csrf_err:
            logger.debug(f'GetSitesGeoJson: Kunne ikke hente CSRF token: {csrf_err}')

        # Konverter til Web Mercator bbox
        # Mercator-skalaen ved lat φ er 1/cos(φ) — uten korreksjon dekker bbox bare ~cos(φ) × ønsket radius
        center_x, center_y = _wgs84_to_mercator(lat, lon)
        mercator_scale = 1.0 / math.cos(math.radians(lat))
        half_size = max(size_m, 100) * mercator_scale
        bbox_str = f'{int(center_x - half_size)},{int(center_y - half_size)},{int(center_x + half_size)},{int(center_y + half_size)}'

        cookies_dict = {'AcceptCookies': '1', '.ASPXAUTHNO': auth_val, 'logintoken': ao_login}
        if csrf_cookie_token:
            cookies_dict['__RequestVerificationToken'] = csrf_cookie_token

        post_data = {
            'zoomLevel': 16, 'bbox': bbox_str, 'userId': int(ao_user_id),
            'coordSyst': 0, 'speciesGroupId': '0', 'taxonId': None
        }

        logger.debug(f'GetSitesGeoJson POST bbox: {bbox_str}')

        geojson_data = None
        with httpx.Client() as client:
            response = client.post(
                'https://www.artsobservasjoner.no/Map/GetSitesGeoJson',
                headers={
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
                    'Accept': '*/*',
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Origin': 'https://www.artsobservasjoner.no',
                    'Referer': 'https://www.artsobservasjoner.no/SubmitSighting/Report'
                },
                cookies=cookies_dict, json=post_data, timeout=15, follow_redirects=True
            )
            response.raise_for_status()

            if not refreshed_auth_cookie and '.ASPXAUTHNO' in response.cookies:
                refreshed_auth_cookie = response.cookies['.ASPXAUTHNO']

            body = response.text
            if body.strip().startswith('<!DOCTYPE') or body.strip().startswith('<html'):
                logger.warning('GetSitesGeoJson: Fikk HTML i stedet for JSON - auth ugyldig')
                auth_failed = True
            else:
                geojson_data = response.json() if body else None

        # Ekstraher private site-IDer fra GeoJSON
        if isinstance(geojson_data, dict):
            for layer_key in ('points', 'polygons'):
                layer = geojson_data.get(layer_key, {})
                if isinstance(layer, dict):
                    for feature in layer.get('features', []):
                        props = feature.get('properties', {})
                        site_id = props.get('siteId') or props.get('id') or feature.get('id')
                        if props.get('isPrivate') and site_id is not None:
                            my_site_ids.add(int(site_id))

        logger.debug(f'GetSitesGeoJson: fant {len(my_site_ids)} private site-IDs')
    except Exception as geojs_err:
        logger.warning(f'GetSitesGeoJson feilet: {geojs_err}')

    return my_site_ids, refreshed_auth_cookie, auth_failed


_PUBLIC_SITES_MAX = 1000          # AOs tak per ByBoundingBox-kall
_PUBLIC_SITES_MAX_SPLIT_DEPTH = 3  # opptil 4^3 = 64 delkall i verste fall


def _site_raw_id(item):
    if not isinstance(item, dict):
        return None
    return item.get('id') or item.get('Id') or item.get('siteId')


def _fetch_public_sites(bbox, ao_mobile_base_url, _depth=0):
    """Hent offentlige lokasjoner via ByBoundingBox API.

    AO returnerer maks 1000 lokasjoner per kall og kutter resten stille. Når taket nås
    deles boksen i fire og hver del hentes for seg (dedupliseres på id), slik at tette
    områder ikke mister lokaliteter — viktig ved nedlasting av hele offline-rektangler.

    Returns:
        list: Rå site-dicts fra API-et
    """
    raw = _fetch_public_sites_once(bbox, ao_mobile_base_url)
    if len(raw) < _PUBLIC_SITES_MAX or _depth >= _PUBLIC_SITES_MAX_SPLIT_DEPTH:
        return raw

    mid_x = (bbox['min_x'] + bbox['max_x']) / 2.0
    mid_y = (bbox['min_y'] + bbox['max_y']) / 2.0
    quadrants = [
        {'min_x': bbox['min_x'], 'max_x': mid_x, 'min_y': bbox['min_y'], 'max_y': mid_y},
        {'min_x': mid_x, 'max_x': bbox['max_x'], 'min_y': bbox['min_y'], 'max_y': mid_y},
        {'min_x': bbox['min_x'], 'max_x': mid_x, 'min_y': mid_y, 'max_y': bbox['max_y']},
        {'min_x': mid_x, 'max_x': bbox['max_x'], 'min_y': mid_y, 'max_y': bbox['max_y']},
    ]
    merged = {}
    extra = []
    for quad in quadrants:
        try:
            part = _fetch_public_sites(quad, ao_mobile_base_url, _depth + 1)
        except Exception as e:
            logger.warning(f'AO-sites: delkall feilet ({e}), bruker det som er hentet')
            continue
        for item in part:
            sid = _site_raw_id(item)
            if sid is None:
                extra.append(item)
            else:
                merged[sid] = item
    # Behold det første kallet som reserve dersom alle delkall feilet
    for item in raw:
        sid = _site_raw_id(item)
        if sid is not None:
            merged.setdefault(sid, item)
    return list(merged.values()) + extra


def _fetch_public_sites_once(bbox, ao_mobile_base_url):
    """Ett enkelt ByBoundingBox-kall (maks 1000 lokasjoner)."""
    query_params = {
        'maxSites': str(_PUBLIC_SITES_MAX),
        'minX': f'{bbox["min_x"]:.6f}', 'minY': f'{bbox["min_y"]:.6f}',
        'maxX': f'{bbox["max_x"]:.6f}', 'maxY': f'{bbox["max_y"]:.6f}',
        'includePublicSites': 'true',
    }

    ao_sites_url = ao_mobile_base_url + '/core/Sites/ByBoundingBox?' + urlencode(query_params)

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
        data = resp.json()

    if isinstance(data, list):
        return data
    elif isinstance(data, dict):
        return data.get('sites') or data.get('Sites') or []
    return []


def _normalize_site(item, my_site_ids):
    """Normaliser et rå site-dict til internt format med superlokasjon-deteksjon."""
    name = item.get('name') or item.get('Name') or item.get('siteName') or item.get('SiteName')
    site_id = item.get('id') or item.get('Id') or item.get('siteId')
    lat_val = item.get('lat') or item.get('latitude') or item.get('Lat')
    lon_val = item.get('lon') or item.get('longitude') or item.get('Lon')

    site = {'raw': item}
    if name:
        site['name'] = name
    if site_id is not None:
        site['id'] = site_id
        try:
            if int(site_id) in my_site_ids:
                site['isMine'] = True
        except (ValueError, TypeError):
            pass
    if lat_val is not None:
        site['lat'] = lat_val
    if lon_val is not None:
        site['lon'] = lon_val

    # Kommune/fylke fra AO — brukes til å skille lokaliteter med samme navn
    municipality = item.get('municipalityName') or item.get('MunicipalityName')
    county = item.get('countyName') or item.get('CountyName')
    if municipality:
        site['municipality'] = municipality
    if county:
        site['county'] = county

    # Detekter superlokasjon-status
    try:
        for k in ('isSuper', 'isSuperSite', 'IsSuper', 'IsSuperSite', 'is_super'):
            if k in item:
                v = item.get(k)
                if v is True or v == 'true' or v == 'True' or v == '1':
                    site['isSuper'] = True
                elif v is False or v == 'false' or v == 'False' or v == '0':
                    site['isSuper'] = False
                break

        if 'isSuper' not in site:
            t = item.get('siteType') or item.get('type') or item.get('SiteType')
            if isinstance(t, str) and ('super' in t.lower() or 'superlok' in t.lower()):
                site['isSuper'] = True

        for pk in ('parentId', 'parentSiteId', 'ParentId', 'parent'):
            if pk in item and item.get(pk) is not None:
                site['parentId'] = item.get(pk)
                if 'isSuper' not in site:
                    site['isSuper'] = False
                break
    except Exception:
        pass

    return site


def _resolve_super_sites(sites):
    """Utled superlokasjoner fra parent-referanser mellom sites."""
    try:
        # Normaliser til string for å unngå int/string-mismatch fra AO-APIet
        id_map = {str(s.get('id')): s for s in sites if s.get('id') is not None}
        for s in sites:
            raw = s.get('raw') or {}
            for pk in ('parentSiteId', 'ParentSiteId', 'parentId', 'parent', 'ParentId', 'parentSite'):
                if pk in raw and raw.get(pk) is not None:
                    pid = str(raw.get(pk))
                    s['parentId'] = raw.get(pk)
                    s['isSuper'] = False
                    if pid in id_map:
                        id_map[pid]['isSuper'] = True
                    break
    except Exception:
        pass


def _mark_env_owned_sites(sites):
    """Merk bruker-eide lokasjoner fra MY_AO_SITE_IDS miljøvariabel."""
    try:
        my_ids_raw = os.getenv('MY_AO_SITE_IDS', '')
        if my_ids_raw:
            my_ids = {int(x.strip()) for x in my_ids_raw.split(',') if x.strip()}
            for s in sites:
                sid = s.get('id')
                if sid is not None and int(sid) in my_ids:
                    s['isMine'] = True
    except Exception:
        pass


def handle_ao_sites_search(lat=None, lon=None, size_m=600.0, ao_mobile_base_url='https://mobil.artsobservasjoner.no', user_id=None, login_token=None, auth_cookie=None, location_db=None, username=None, north=None, south=None, east=None, west=None, client_ip=None):
    """Håndter søk etter AO-lokaliteter.

    Hvis location_db er satt, søkes det parallelt i lokal DB og AO.
    Resultater merges med AO som prioritet, og AO-resultater lagres i lokal DB.

    Returns:
        tuple: (sites_list, refreshed_auth_cookie_or_None, auth_failed_bool)
    """
    explicit_bbox = None
    if north is not None and south is not None and east is not None and west is not None and str(north) != '' and str(south) != '' and str(east) != '' and str(west) != '':
        try:
            n_val = float(north)
            s_val = float(south)
            e_val = float(east)
            w_val = float(west)
            explicit_bbox = {
                'min_x': min(w_val, e_val),
                'max_x': max(w_val, e_val),
                'min_y': min(s_val, n_val),
                'max_y': max(s_val, n_val),
            }
        except ValueError:
            raise ValueError('Ugyldig bounding box (north/south/east/west)')

    try:
        if explicit_bbox and (lat is None or str(lat) == '' or lon is None or str(lon) == ''):
            lat = (explicit_bbox['min_y'] + explicit_bbox['max_y']) / 2.0
            lon = (explicit_bbox['min_x'] + explicit_bbox['max_x']) / 2.0
        else:
            lat = float(lat)
            lon = float(lon)

        if explicit_bbox:
            lat_span_m = (explicit_bbox['max_y'] - explicit_bbox['min_y']) * 111_320.0
            lon_span_m = (explicit_bbox['max_x'] - explicit_bbox['min_x']) * 111_320.0 * max(0.05, math.cos(math.radians(lat)))
            size_m = max(lat_span_m, lon_span_m) / 2.0
        else:
            size_m = float(size_m) if size_m else 600.0
    except (ValueError, TypeError):
        raise ValueError('Ugyldig lat/lon/size')

    ao_user_id = user_id or (login_token.split(':')[0] if login_token and ':' in login_token else None)
    ao_auth = auth_cookie or os.getenv('AO_AUTH_COOKIE')

    # Sørg for gyldig auth
    ao_auth, refreshed_auth_cookie = _ensure_auth(ao_auth, ao_user_id, login_token, username=username, client_ip=client_ip)

    # Beregn bounding box
    bbox = explicit_bbox if explicit_bbox else _compute_bbox(lat, lon, size_m)
    logger.debug(f'AO-sites: lat={lat:.6f}, lon={lon:.6f}, size_m={size_m:.1f}')

    ao_login = login_token or os.getenv('AO_LOGIN_TOKEN')

    # Hent private site-IDer via GeoJSON
    my_site_ids, refreshed_auth_cookie, auth_failed = _fetch_private_site_ids(
        lat, lon, size_m, ao_login, ao_auth, ao_user_id, refreshed_auth_cookie
    )

    # Hent lokale lokasjoner parallelt hvis lokal DB er tilgjengelig
    local_sites = []
    if location_db:
        try:
            if explicit_bbox and hasattr(location_db, 'search_in_bbox'):
                local_sites = location_db.search_in_bbox(
                    explicit_bbox['min_y'],
                    explicit_bbox['max_y'],
                    explicit_bbox['min_x'],
                    explicit_bbox['max_x'],
                )
            else:
                local_sites = location_db.search_nearby(lat, lon, radius_m=int(size_m))
            logger.debug(f'Lokal DB: {len(local_sites)} treff')
        except Exception as e:
            logger.warning(f'Lokal DB-søk feilet: {e}')

    # Hent offentlige sites via ByBoundingBox
    try:
        raw_sites = _fetch_public_sites(bbox, ao_mobile_base_url)

        # Normaliser alle sites
        sites = [_normalize_site(item, my_site_ids) for item in raw_sites if isinstance(item, dict)]

        # Utled superlokasjoner fra parent-referanser
        _resolve_super_sites(sites)

        logger.info(f'AO-sites: {len(sites)} lokaliteter')
        if sites[:3]:
            logger.info(f'AO-sites eksempel: {[s.get("name") for s in sites[:3]]}')

        # Merk bruker-eide fra miljøvariabel
        _mark_env_owned_sites(sites)

        # Merge lokale sites som ikke finnes i AO-resultater
        if local_sites:
            ao_id_map = {s.get('id'): s for s in sites if s.get('id') is not None}
            for local_site in local_sites:
                local_id = local_site.get('id')
                if local_id not in ao_id_map:
                    sites.append(local_site)
                elif local_site.get('isSuper') and not ao_id_map[local_id].get('isSuper'):
                    # AO-APIet mangler isSuper — hent fra lokal DB som har fullstendig data
                    ao_id_map[local_id]['isSuper'] = True
            # AO-APIet returnerer parentSiteId=null — bruk lokal DB sin parent_id til å utlede
            # super-status OG til å gi selve underlokasjonen en parentId (kartet tegner en linje
            # til superlokasjonen ut fra dette feltet, se renderSites() i map.js)
            for local_site in local_sites:
                local_id = local_site.get('id')
                pid = local_site.get('parentId')
                if pid is None:
                    continue
                if local_id in ao_id_map and ao_id_map[local_id].get('parentId') is None:
                    ao_id_map[local_id]['parentId'] = pid
                if pid in ao_id_map and not ao_id_map[pid].get('isSuper'):
                    ao_id_map[pid]['isSuper'] = True
            logger.debug(f'Merget {len(sites)} totalt (AO + lokal DB)')

        # Sorter brukerens egne først
        sites.sort(key=lambda s: (0 if s.get('isMine') else 1))

        return sites, refreshed_auth_cookie, auth_failed
    except Exception as e:
        logger.error(f'Feil ved henting av AO-lokaliteter: {repr(e)}')
        # Hvis AO feiler men vi har lokale resultater, returner dem
        if local_sites:
            logger.info(f'AO feilet, returnerer {len(local_sites)} lokale resultater')
            return local_sites, refreshed_auth_cookie, auth_failed
        raise


_OSLO_TZ = ZoneInfo('Europe/Oslo')


def _oslo_midnight_utc_iso(date_str: str) -> str:
    """Konverter en dato (YYYY-MM-DD) til UTC ISO-streng for norsk lokal midnatt.

    Matcher formatet AO sin egen Report-side sender til ValidateTaxonAndArea
    (verifisert ved nettverksinstrumentering: 12.09.2026 sommertid ble sendt
    som "2026-09-11T22:00:00.000Z").
    """
    y, m, d = (int(p) for p in date_str.split('-'))
    local_midnight = datetime(y, m, d, tzinfo=_OSLO_TZ)
    return local_midnight.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def fetch_site_areas(site_id, auth_cookie: str, login_token: str = None) -> str:
    """Hent AOs interne Areas-ID-er (fylke/kommune) for en lokalitet.

    Kaller AO sitt eget /SubmitSighting/GetSite — samme kall AOs
    rapporteringsskjema gjør når en lokalitet velges (verifisert ved
    nettverksinstrumentering). Krever innlogget sesjon.

    Returns:
        Kommaseparert streng med area-ID-er, eller None ved feil/manglende data.
    """
    cookies = {'.ASPXAUTHNO': auth_cookie, 'AcceptCookies': '1'}
    if login_token:
        cookies['logintoken'] = login_token

    try:
        with httpx.Client(cookies=cookies) as client:
            response = client.post(
                'https://www.artsobservasjoner.no/SubmitSighting/GetSite',
                headers={
                    'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)',
                    'Accept': 'application/json, text/plain, */*',
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': 'https://www.artsobservasjoner.no/SubmitSighting/Report',
                },
                json={'SiteId': int(site_id)},
                timeout=10,
            )
            response.raise_for_status()
            data = response.json()
        areas = data.get('Areas')
        # Forventet format er en kommaseparert streng (verifisert ved
        # nettverksinstrumentering) — behandle alt annet som «ingen data»
        # i stedet for å la det lekke inn i check_taxon_rarity() sin split().
        return areas if isinstance(areas, str) and areas else None
    except Exception as e:
        logger.warning(f'[AO-RARITY] Kunne ikke hente Areas for site {site_id}: {e}')
        return None


def check_taxon_rarity(taxon_id, areas_csv: str, date_str: str, auth_cookie: str, login_token: str = None) -> dict:
    """Sjekk AO sin sanntids sjeldenhetsvurdering for art x lokalitet x dato.

    Kaller AO sitt eget /SubmitSighting/ValidateTaxonAndArea — samme
    validering AOs rapporteringsskjema kjører før publisering. Krever
    innlogget sesjon.

    Returns:
        Dict med 'warning' og 'information' (hver {Header, Body} eller None),
        eller None ved feil.
    """
    areas = [a.strip() for a in areas_csv.split(',') if a.strip()]
    if not areas:
        return None

    cookies = {'.ASPXAUTHNO': auth_cookie, 'AcceptCookies': '1'}
    if login_token:
        cookies['logintoken'] = login_token

    try:
        from_to = _oslo_midnight_utc_iso(date_str)
        with httpx.Client(cookies=cookies) as client:
            response = client.post(
                'https://www.artsobservasjoner.no/SubmitSighting/ValidateTaxonAndArea',
                headers={
                    'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner/1.0)',
                    'Accept': 'application/json, text/plain, */*',
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': 'https://www.artsobservasjoner.no/SubmitSighting/Report',
                },
                json={
                    'Taxon': str(taxon_id),
                    'Areas': areas,
                    'fromDate': from_to,
                    'toDate': from_to,
                },
                timeout=10,
            )
            response.raise_for_status()
            data = response.json()
        return {'warning': data.get('Warning'), 'information': data.get('Information')}
    except Exception as e:
        logger.warning(f'[AO-RARITY] ValidateTaxonAndArea feilet for taxon={taxon_id}: {e}')
        return None


def get_ao_rarity(taxon_id, site_id, date_str: str, user_id: str = None, login_token: str = None,
                   auth_cookie: str = None, location_db=None, username: str = None, client_ip: str = None) -> tuple:
    """Sjekk om en art er uvanlig på en gitt lokalitet/dato (AO sin sjeldenhetsvarsling).

    Henter Areas-ID-er for lokaliteten (cachet i location_db med lang TTL —
    administrative grenseendringer er sjeldne), deretter AOs sanntidsvurdering.

    Stille no-op ved uinnlogget bruker eller manglende data — aldri en feil
    brukeren merker, jf. «External API Error Handling»-konvensjonen.

    Returns:
        tuple: (result_dict_eller_None, refreshed_auth_cookie_eller_None)
    """
    is_logged_in = bool(login_token and (auth_cookie or user_id))
    if not is_logged_in or not taxon_id or not site_id or not date_str:
        return None, None

    auth_cookie, refreshed_auth_cookie = _ensure_auth(auth_cookie, user_id, login_token, username=username, client_ip=client_ip)
    if not auth_cookie:
        return None, refreshed_auth_cookie

    areas_csv = None
    if location_db:
        try:
            areas_csv = location_db.get_cached_areas(site_id)
        except Exception as e:
            logger.warning(f'[AO-RARITY] Cache-oppslag feilet for site {site_id}: {e}')

    if not areas_csv:
        areas_csv = fetch_site_areas(site_id, auth_cookie, login_token)
        if areas_csv and location_db:
            try:
                location_db.set_areas(site_id, areas_csv)
            except Exception as e:
                logger.warning(f'[AO-RARITY] Kunne ikke cache Areas for site {site_id}: {e}')

    if not areas_csv:
        return None, refreshed_auth_cookie

    result = check_taxon_rarity(taxon_id, areas_csv, date_str, auth_cookie, login_token)
    if result is not None:
        result['areas'] = areas_csv
    return result, refreshed_auth_cookie
