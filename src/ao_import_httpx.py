"""
AO Direct Import - Bruker httpx for HTTP-kall.
"""

import logging
import os
import re
import time
from urllib.parse import quote_plus

import httpx

from src.utils import mask_token as _mask

logger = logging.getLogger('fugleobs')


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

    # VIKTIG: Cookies på CLIENT-nivå for å videresendes ved redirects
    with httpx.Client(cookies=cookies) as client:
        response = client.get(
            'https://www.artsobservasjoner.no/ImportSighting',
            headers=headers,
            timeout=15,
            follow_redirects=True
        )
        response.raise_for_status()
        # Finn cookies fra jar (unngå dict() som krasjer ved duplikater)
        refreshed_auth = None
        cookie_token = None
        for cookie in client.cookies.jar:
            if cookie.name == '.ASPXAUTHNO' and cookie.value != auth_cookie:
                refreshed_auth = cookie.value
            elif cookie.name == '__RequestVerificationToken':
                cookie_token = cookie.value

    html = response.text

    if refreshed_auth:
        logger.debug(f'[AO-HTTPX] Fornyet .ASPXAUTHNO: {_mask(refreshed_auth)}')

    # Hent form-token fra HTML
    match = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', html)
    if not match:
        raise ValueError('Kunne ikke finne form CSRF token i HTML')
    form_token = match.group(1)

    if not cookie_token:
        raise ValueError('Kunne ikke finne cookie CSRF token')

    logger.debug(f'[AO-HTTPX] Form token: {_mask(form_token)}')
    logger.debug(f'[AO-HTTPX] Cookie token: {_mask(cookie_token)}')

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
    logger.debug(f'[AO-HTTPX] CSV length: {len(csv_data)}')

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

    logger.info(f'[AO-HTTPX] HTTP Status: {response.status_code}')

    if response.status_code >= 400:
        logger.error(f'[AO-HTTPX] Feil: HTTP {response.status_code}')
        raise ValueError(f'HTTP {response.status_code}')

    # Steg 2: Vent på at AO prosesserer importen (asynkron)
    logger.debug('[AO-HTTPX] Venter 3 sekunder på at AO prosesserer importen...')
    time.sleep(3)

    # Steg 3: Publiser observasjonene (med retry)
    logger.info('[AO-HTTPX] Starter publisering...')
    last_error = None
    for attempt, delay in enumerate([0, 5, 10], start=1):
        if delay:
            logger.debug(f'[AO-HTTPX] Venter {delay} sekunder før forsøk {attempt}...')
            time.sleep(delay)
        try:
            publish_result = publish_all(login_token, auth_cookie)
            logger.info(f'[AO-HTTPX] Publisering vellykket (forsøk {attempt}): {publish_result}')
            last_error = None
            break
        except Exception as e:
            last_error = e
            logger.warning(f'[AO-HTTPX] Publisering feilet (forsøk {attempt}): {e}')

    if last_error:
        return {
            'success': True,
            'message': f'{len(observations)} observasjoner importert (men publisering feilet: {last_error})',
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

    logger.debug(f'[AO-HTTPX] Publish form token: {_mask(form_token)}')
    logger.debug(f'[AO-HTTPX] Publish cookie token: {_mask(cookie_token)}')

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

    logger.info(f'[AO-HTTPX] Publish HTTP Status: {response.status_code}')

    if response.status_code >= 400:
        raise ValueError(f'Publisering feilet: HTTP {response.status_code}')

    return {'status': response.status_code}
