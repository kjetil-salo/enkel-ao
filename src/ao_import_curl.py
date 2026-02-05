"""
AO Direct Import - Bruker curl i stedet for urllib.
"""

import json
import os
import re
import subprocess
import sys
from urllib.parse import quote_plus


def observations_to_csv(observations):
    """Samme som i ao_import.py"""
    from src.ao_import import observations_to_csv as orig
    return orig(observations)


def fetch_csrf_tokens(login_token, auth_cookie):
    """
    Hent BEGGE CSRF tokens:
    - cookie_token: Fra Set-Cookie header
    - form_token: Fra hidden input i HTML
    
    Returnerer også eventuell fornyet .ASPXAUTHNO fra Set-Cookie header.
    ASP.NET MVC krever at disse er forskjellige men matcher kryptografisk.
    
    Returns:
        tuple: (form_token, cookie_token, refreshed_auth_cookie or None)
    """
    # Bruk curl med -c for å fange cookies og -D for headers
    result = subprocess.run(
        [
            'curl', '-s',
            '-D', '/tmp/ao_headers.txt',
            '-c', '/tmp/ao_cookies.txt',
            'https://www.artsobservasjoner.no/ImportSighting',
            '-H', f'Cookie: logintoken={login_token}; .ASPXAUTHNO={auth_cookie}; AcceptCookies=1',
            '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0'
        ],
        capture_output=True,
        text=True,
        timeout=15
    )

    html = result.stdout
    
    # Sjekk Set-Cookie header for fornyet .ASPXAUTHNO
    refreshed_auth = None
    try:
        with open('/tmp/ao_headers.txt', 'r') as f:
            for line in f:
                if 'Set-Cookie:' in line and '.ASPXAUTHNO=' in line:
                    match = re.search(r'\.ASPXAUTHNO=([^;]+)', line)
                    if match:
                        refreshed_auth = match.group(1)
                        print(f'[AO-CURL] Fornyet .ASPXAUTHNO: {refreshed_auth[:20]}...', file=sys.stderr)
    except Exception as e:
        print(f'[AO-CURL] Kunne ikke lese headers-fil: {e}', file=sys.stderr)

    # Hent form-token fra HTML
    match = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', html)
    if not match:
        raise ValueError('Kunne ikke finne form CSRF token i HTML')
    form_token = match.group(1)

    # Hent cookie-token fra cookies-fil
    # Netscape cookie format: domain, flag, path, secure, expiry, name, value
    # HttpOnly cookies har prefix #HttpOnly_ på domain
    cookie_token = None
    try:
        with open('/tmp/ao_cookies.txt', 'r') as f:
            for line in f:
                if '__RequestVerificationToken' in line and not line.startswith('#'):
                    # Vanlig linje
                    parts = line.strip().split('\t')
                    if len(parts) >= 7:
                        cookie_token = parts[6]
                        break
                elif line.startswith('#HttpOnly_') and '__RequestVerificationToken' in line:
                    # HttpOnly cookie - fjern prefix og parse
                    clean_line = line.replace('#HttpOnly_', '')
                    parts = clean_line.strip().split('\t')
                    if len(parts) >= 7:
                        cookie_token = parts[6]
                        break
    except Exception as e:
        print(f'[AO-CURL] Feil ved lesing av cookies: {e}', file=sys.stderr)

    if not cookie_token:
        raise ValueError('Kunne ikke finne cookie CSRF token')

    print(f'[AO-CURL] Form token: {form_token[:30]}...', file=sys.stderr)
    print(f'[AO-CURL] Cookie token: {cookie_token[:30]}...', file=sys.stderr)

    return form_token, cookie_token, refreshed_auth


def post_with_curl(observations, login_token=None, auth_cookie=None, area_id=''):
    """
    Post til AO med curl - med korrekt CSRF token-håndtering.
    
    Returnerer dict med:
    - success: bool
    - message: str
    - count: int
    - published: bool
    - refreshedAuthCookie: str eller None (fornyet .ASPXAUTHNO hvis AO sendte ny)
    """
    # Bruk tokens fra parameter, eller fall tilbake til miljøvariabler
    login_token = login_token or os.getenv('AO_LOGIN_TOKEN')
    auth_cookie = auth_cookie or os.getenv('AO_AUTH_COOKIE')

    if not login_token or not auth_cookie:
        raise ValueError('Mangler loginToken eller authCookie')

    # Hent BEGGE CSRF tokens + eventuell fornyet auth cookie
    form_token, cookie_token, refreshed_auth = fetch_csrf_tokens(login_token, auth_cookie)

    csv_data = observations_to_csv(observations)
    print(f'[AO-CURL] CSV length: {len(csv_data)}', file=sys.stderr)
    print(f'[AO-CURL] CSV preview: {csv_data[:100]}...', file=sys.stderr)

    # URL-encode
    encoded_csv = quote_plus(csv_data, safe='', encoding='utf-8')
    encoded_form_token = quote_plus(form_token, safe='', encoding='utf-8')

    post_data = (
        f'__RequestVerificationToken={encoded_form_token}&'
        f'ImportSightingViewModel.Observations={encoded_csv}&'
        f'ImportSightingViewModel.Area={area_id}&'
        f'ImportSightingViewModel.OwnAndFavoriteSites=true&'
        f'OwnAndFavoriteSites=false&'
        f'ImportSightingViewModel.ProjectToAdd=&'
        f'ImportSightingViewModel.ProjectToAdd_Name=&'
        f'Shared_Import=Importer'
    )

    # Bruk COOKIE token i Cookie header (ikke form token!)
    cookies = (
        f'AcceptCookies=1; monthlistpagesize=150; '
        f'logintoken={login_token}; logintoken_ssl=1; '
        f'.ASPXAUTHNO={auth_cookie}; '
        f'__RequestVerificationToken={cookie_token}; '
        f'ReleaseNumber=2.13.12; '
        f'SpeciesGroup=8'
    )

    result = subprocess.run(
        [
            'curl', '-s', '-w', '\n%{http_code}',
            'https://www.artsobservasjoner.no/ImportSighting/ParseObservations',
            '--compressed',
            '-X', 'POST',
            '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
            '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            '-H', 'Accept-Language: nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
            '-H', 'Origin: https://www.artsobservasjoner.no',
            '-H', 'Cookie: ' + cookies,
            '-H', 'Content-Type: application/x-www-form-urlencoded',
            '-H', 'Referer: https://www.artsobservasjoner.no/ImportSighting',
            '-H', 'Upgrade-Insecure-Requests: 1',
            '-H', 'Sec-Fetch-Dest: document',
            '-H', 'Sec-Fetch-Mode: navigate',
            '-H', 'Sec-Fetch-Site: same-origin',
            '-H', 'Sec-Fetch-User: ?1',
            '--data-raw', post_data,
        ],
        capture_output=True,
        text=True,
        timeout=30
    )

    lines = result.stdout.strip().split('\n')
    status = lines[-1]
    html = '\n'.join(lines[:-1])

    print(f'[AO-CURL] HTTP Status: {status}', file=sys.stderr)

    if result.stderr:
        print(f'[AO-CURL] stderr: {result.stderr}', file=sys.stderr)

    if status.startswith('5') or status.startswith('4'):
        # Lagre response for debugging
        with open('/tmp/ao_curl_response.html', 'w') as f:
            f.write(html)
        print(f'[AO-CURL] Response saved to /tmp/ao_curl_response.html', file=sys.stderr)
        raise ValueError(f'HTTP {status}')

    # Lagre suksess-response
    with open('/tmp/ao_curl_response.html', 'w') as f:
        f.write(html)

    # Steg 2: Vent på at AO prosesserer importen (asynkron)
    import time
    print(f'[AO-CURL] Venter 3 sekunder på at AO prosesserer importen...', file=sys.stderr)
    time.sleep(3)

    # Steg 3: Publiser observasjonene
    print(f'[AO-CURL] Starter publisering...', file=sys.stderr)
    try:
        publish_result = publish_all(login_token, auth_cookie)
        print(f'[AO-CURL] Publisering: {publish_result}', file=sys.stderr)
    except Exception as e:
        print(f'[AO-CURL] Publisering feilet: {e}', file=sys.stderr)
        return {
            'success': True,
            'message': f'{len(observations)} observasjoner importert (men publisering feilet: {e})',
            'count': len(observations),
            'published': False,
            'refreshedAuthCookie': refreshed_auth
        }

    return {
        'success': True,
        'message': f'{len(observations)} observasjoner importert og publisert',
        'count': len(observations),
        'published': True,
        'refreshedAuthCookie': refreshed_auth
    }


def publish_all(login_token, auth_cookie):
    """Publiser alle importerte observasjoner."""
    # Hent CSRF tokens fra ReviewSighting-siden
    result = subprocess.run(
        [
            'curl', '-s',
            '-D', '/tmp/ao_review_headers.txt',
            '-c', '/tmp/ao_review_cookies.txt',
            'https://www.artsobservasjoner.no/ReviewSighting',
            '-H', f'Cookie: logintoken={login_token}; .ASPXAUTHNO={auth_cookie}; AcceptCookies=1',
            '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0'
        ],
        capture_output=True,
        text=True,
        timeout=15
    )

    html = result.stdout

    # Hent form-token fra HTML
    match = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', html)
    if not match:
        raise ValueError('Kunne ikke finne form CSRF token for publisering')
    form_token = match.group(1)

    # Hent cookie-token
    cookie_token = None
    try:
        with open('/tmp/ao_review_cookies.txt', 'r') as f:
            for line in f:
                if '__RequestVerificationToken' in line and not line.startswith('#'):
                    parts = line.strip().split('\t')
                    if len(parts) >= 7:
                        cookie_token = parts[6]
                        break
                elif line.startswith('#HttpOnly_') and '__RequestVerificationToken' in line:
                    clean_line = line.replace('#HttpOnly_', '')
                    parts = clean_line.strip().split('\t')
                    if len(parts) >= 7:
                        cookie_token = parts[6]
                        break
    except Exception as e:
        print(f'[AO-CURL] Feil ved lesing av review cookies: {e}', file=sys.stderr)

    if not cookie_token:
        raise ValueError('Kunne ikke finne cookie CSRF token for publisering')

    print(f'[AO-CURL] Publish form token: {form_token[:30]}...', file=sys.stderr)
    print(f'[AO-CURL] Publish cookie token: {cookie_token[:30]}...', file=sys.stderr)

    # URL-encode form token
    encoded_form_token = quote_plus(form_token, safe='', encoding='utf-8')

    post_data = (
        f'__RequestVerificationToken={encoded_form_token}&'
        f'ReviewSightingViewModel.PublicationName=&'
        f'ReviewSightingViewModel.PublicationComment=&'
        f'ReviewSightingViewModel.SightingsToPublishIds='
    )

    cookies = (
        f'AcceptCookies=1; monthlistpagesize=150; '
        f'logintoken={login_token}; logintoken_ssl=1; '
        f'.ASPXAUTHNO={auth_cookie}; '
        f'__RequestVerificationToken={cookie_token}; '
        f'ReleaseNumber=2.13.12; '
        f'SpeciesGroup=8'
    )

    result = subprocess.run(
        [
            'curl', '-s', '-w', '\n%{http_code}',
            'https://www.artsobservasjoner.no/PublishSighting/PublishAll',
            '--compressed',
            '-X', 'POST',
            '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
            '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            '-H', 'Accept-Language: nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
            '-H', 'Origin: https://www.artsobservasjoner.no',
            '-H', 'Cookie: ' + cookies,
            '-H', 'Content-Type: application/x-www-form-urlencoded',
            '-H', 'Referer: https://www.artsobservasjoner.no/ReviewSighting',
            '-H', 'Upgrade-Insecure-Requests: 1',
            '-H', 'Sec-Fetch-Dest: document',
            '-H', 'Sec-Fetch-Mode: navigate',
            '-H', 'Sec-Fetch-Site: same-origin',
            '-H', 'Sec-Fetch-User: ?1',
            '--data-raw', post_data,
        ],
        capture_output=True,
        text=True,
        timeout=30
    )

    lines = result.stdout.strip().split('\n')
    status = lines[-1]
    html = '\n'.join(lines[:-1])

    print(f'[AO-CURL] Publish HTTP Status: {status}', file=sys.stderr)

    # Lagre response
    with open('/tmp/ao_publish_response.html', 'w') as f:
        f.write(html)

    if status.startswith('5') or status.startswith('4'):
        raise ValueError(f'Publisering feilet: HTTP {status}')

    return {'status': status}
