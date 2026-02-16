#!/usr/bin/env python3
"""
FINAL - Opprett Hylkjesvingen 51 via /Map/SaveSite (korrekt endepunkt).

Parametrene (fra AO JavaScript NewSiteAdded):
  Id=-1 (ny site)
  Name=lokalitetsnavn
  XCoord=easting (EPSG:3857 Web Mercator)
  YCoord=northing (EPSG:3857 Web Mercator)
  Geometry=WKT POINT (EPSG:3857)
  comment=
"""

import json
import math
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import httpx
from src.ao_import_httpx import fetch_csrf_tokens

AO_BASE = 'https://www.artsobservasjoner.no'
LAT = 60.5137953
LON = 5.3454789

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
    'X-Requested-With': 'XMLHttpRequest',
}


def wgs84_to_web_mercator(lat, lon):
    """Konverter WGS84 til EPSG:3857 (Web Mercator)."""
    x = lon * 20037508.34 / 180.0
    y = math.log(math.tan((90.0 + lat) * math.pi / 360.0)) / math.pi * 20037508.34
    return round(x), round(y)


def build_cookies(login_token, auth_cookie, cookie_token=None):
    c = {
        'logintoken': login_token,
        '.ASPXAUTHNO': auth_cookie,
        'AcceptCookies': '1',
    }
    if cookie_token:
        c['__RequestVerificationToken'] = cookie_token
    return c


def main():
    if len(sys.argv) < 3:
        print('Bruk: python3 tools/test_create_site_final.py <loginToken> <authCookie>')
        sys.exit(1)

    login_token = sys.argv[1]
    auth_cookie = sys.argv[2]

    # Konverter til Web Mercator
    x, y = wgs84_to_web_mercator(LAT, LON)
    print(f'WGS84: {LAT}, {LON}')
    print(f'EPSG:3857: x={x}, y={y}')

    # Hent CSRF
    print('\nHenter CSRF tokens...')
    form_token, cookie_token, refreshed_auth = fetch_csrf_tokens(login_token, auth_cookie)
    effective_auth = refreshed_auth or auth_cookie
    cookies = build_cookies(login_token, effective_auth, cookie_token)

    # WKT POINT i EPSG:3857
    wkt_point = f'POINT({x} {y})'

    # SaveSite med minimale parametere (slik AO JS gjør det)
    params = {
        'Id': '-1',
        'Name': 'Hylkjesvingen 51',
        'XCoord': str(x),
        'YCoord': str(y),
        'Geometry': wkt_point,
        'comment': '',
    }

    print(f'\nPOST /Map/SaveSite')
    print(f'Payload: {params}')

    url = f'{AO_BASE}/Map/SaveSite'

    with httpx.Client() as client:
        resp = client.post(url, cookies=cookies, headers=HEADERS,
                           data=params, timeout=15, follow_redirects=True)

    print(f'\nStatus: {resp.status_code}')
    print(f'Body: {resp.text[:2000]}')

    # Parse response
    try:
        data = resp.json()
        if data.get('success'):
            print('\n=== SUKSESS! ===')
            features = data.get('points', {}).get('features', [])
            if features:
                props = features[0].get('properties', {})
                print(f'  SiteId: {props.get("siteId")}')
                print(f'  SiteName: {props.get("siteName")}')
                print(f'  Koordinater: {props.get("siteCoordinateStringPresentation")}')
                print(f'  ParentName: {props.get("parentName")}')
                print(f'  IsPrivate: {props.get("isPrivate")}')
                site_id = props.get('siteId')
                if site_id and site_id > 0:
                    print(f'\n  Lokasjon permanent opprettet med ID {site_id}!')
                else:
                    print(f'\n  ADVARSEL: siteId={site_id} - muligens ikke permanent lagret')
        else:
            print(f'\nFeilet: {data.get("message")}')
    except Exception as e:
        print(f'\nKunne ikke parse response: {e}')


if __name__ == '__main__':
    main()
