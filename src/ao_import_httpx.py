"""
AO Direct Import - Bruker httpx for HTTP-kall.
"""

import json
import os
import re
import sys
import time
from urllib.parse import quote_plus

import httpx


def _mask(token, visible=6):
    """Masker et token for logging."""
    if not token:
        return 'None'
    return token[:visible] + '***'


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
    cookies = {
        'logintoken': login_token,
        '.ASPXAUTHNO': auth_cookie,
        'AcceptCookies': '1'
    }

    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0'
    }

    with httpx.Client() as client:
        response = client.get(
            'https://www.artsobservasjoner.no/ImportSighting',
            cookies=cookies,
            headers=headers,
            timeout=15,
            follow_redirects=True
        )
        response.raise_for_status()

    html = response.text

    # Sjekk Set-Cookie header for fornyet .ASPXAUTHNO
    refreshed_auth = None
    if '.ASPXAUTHNO' in response.cookies:
        refreshed_auth = response.cookies['.ASPXAUTHNO']
        print(f'[AO-HTTPX] Fornyet .ASPXAUTHNO: {_mask(refreshed_auth)}', file=sys.stderr)

    # Hent form-token fra HTML
    match = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', html)
    if not match:
        raise ValueError('Kunne ikke finne form CSRF token i HTML')
    form_token = match.group(1)

    # Hent cookie-token fra response cookies
    cookie_token = response.cookies.get('__RequestVerificationToken')
    if not cookie_token:
        raise ValueError('Kunne ikke finne cookie CSRF token')

    print(f'[AO-HTTPX] Form token: {_mask(form_token)}', file=sys.stderr)
    print(f'[AO-HTTPX] Cookie token: {_mask(cookie_token)}', file=sys.stderr)

    return form_token, cookie_token, refreshed_auth


def post_with_curl(observations, login_token=None, auth_cookie=None, area_id=''):
    """
    Post til AO med httpx - med korrekt CSRF token-håndtering.

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
    print(f'[AO-HTTPX] CSV length: {len(csv_data)}', file=sys.stderr)
    print(f'[AO-HTTPX] CSV preview: {csv_data[:100]}...', file=sys.stderr)

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

    # Cookies dict (httpx håndterer dette bedre enn string)
    cookies = {
        'AcceptCookies': '1',
        'monthlistpagesize': '150',
        'logintoken': login_token,
        'logintoken_ssl': '1',
        '.ASPXAUTHNO': auth_cookie,
        '__RequestVerificationToken': cookie_token,
        'ReleaseNumber': '2.13.12',
        'SpeciesGroup': '8'
    }

    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
        'Origin': 'https://www.artsobservasjoner.no',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://www.artsobservasjoner.no/ImportSighting',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
    }

    with httpx.Client() as client:
        response = client.post(
            'https://www.artsobservasjoner.no/ImportSighting/ParseObservations',
            content=post_data,
            cookies=cookies,
            headers=headers,
            timeout=30,
            follow_redirects=True
        )

    print(f'[AO-HTTPX] HTTP Status: {response.status_code}', file=sys.stderr)

    if response.status_code >= 400:
        # Lagre response for debugging
        with open('/tmp/ao_httpx_response.html', 'w') as f:
            f.write(response.text)
        print(f'[AO-HTTPX] Response saved to /tmp/ao_httpx_response.html', file=sys.stderr)
        raise ValueError(f'HTTP {response.status_code}')

    # Lagre suksess-response
    with open('/tmp/ao_httpx_response.html', 'w') as f:
        f.write(response.text)

    # Steg 2: Vent på at AO prosesserer importen (asynkron)
    print(f'[AO-HTTPX] Venter 3 sekunder på at AO prosesserer importen...', file=sys.stderr)
    time.sleep(3)

    # Steg 3: Publiser observasjonene
    print(f'[AO-HTTPX] Starter publisering...', file=sys.stderr)
    try:
        publish_result = publish_all(login_token, auth_cookie)
        print(f'[AO-HTTPX] Publisering: {publish_result}', file=sys.stderr)
    except Exception as e:
        print(f'[AO-HTTPX] Publisering feilet: {e}', file=sys.stderr)
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
    cookies = {
        'logintoken': login_token,
        '.ASPXAUTHNO': auth_cookie,
        'AcceptCookies': '1'
    }

    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0'
    }

    with httpx.Client() as client:
        response = client.get(
            'https://www.artsobservasjoner.no/ReviewSighting',
            cookies=cookies,
            headers=headers,
            timeout=15,
            follow_redirects=True
        )
        response.raise_for_status()

    html = response.text

    # Hent form-token fra HTML
    match = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', html)
    if not match:
        raise ValueError('Kunne ikke finne form CSRF token for publisering')
    form_token = match.group(1)

    # Hent cookie-token fra response
    cookie_token = response.cookies.get('__RequestVerificationToken')
    if not cookie_token:
        raise ValueError('Kunne ikke finne cookie CSRF token for publisering')

    print(f'[AO-HTTPX] Publish form token: {_mask(form_token)}', file=sys.stderr)
    print(f'[AO-HTTPX] Publish cookie token: {_mask(cookie_token)}', file=sys.stderr)

    # URL-encode form token
    encoded_form_token = quote_plus(form_token, safe='', encoding='utf-8')

    post_data = (
        f'__RequestVerificationToken={encoded_form_token}&'
        f'ReviewSightingViewModel.PublicationName=&'
        f'ReviewSightingViewModel.PublicationComment=&'
        f'ReviewSightingViewModel.SightingsToPublishIds='
    )

    # Cookies for publish POST
    publish_cookies = {
        'AcceptCookies': '1',
        'monthlistpagesize': '150',
        'logintoken': login_token,
        'logintoken_ssl': '1',
        '.ASPXAUTHNO': auth_cookie,
        '__RequestVerificationToken': cookie_token,
        'ReleaseNumber': '2.13.12',
        'SpeciesGroup': '8'
    }

    publish_headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
        'Origin': 'https://www.artsobservasjoner.no',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://www.artsobservasjoner.no/ReviewSighting',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
    }

    with httpx.Client() as client:
        response = client.post(
            'https://www.artsobservasjoner.no/PublishSighting/PublishAll',
            content=post_data,
            cookies=publish_cookies,
            headers=publish_headers,
            timeout=30,
            follow_redirects=True
        )

    print(f'[AO-HTTPX] Publish HTTP Status: {response.status_code}', file=sys.stderr)

    # Lagre response
    with open('/tmp/ao_publish_response.html', 'w') as f:
        f.write(response.text)

    if response.status_code >= 400:
        raise ValueError(f'Publisering feilet: HTTP {response.status_code}')

    return {'status': response.status_code}
