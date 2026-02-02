#!/usr/bin/env python3
"""
Fetch AO site detail with authenticated cookies and look for owner/creator fields.

Usage:
  AO_LOGIN_TOKEN="..." AO_AUTH_COOKIE="..." python3 tools/ao_site_inspect.py 477517

Note: Do NOT paste tokens into chat. Export them locally as env vars before running.
"""
import os
import sys
import json
import argparse
from urllib.request import Request, urlopen
from urllib.parse import urlencode


def find_owner_fields(obj, path=''):
    matches = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            lk = k.lower()
            if any(substr in lk for substr in ('owner', 'created', 'creator', 'user', 'userid', 'ownerid', 'createdby')):
                matches.append((path + k, v))
            matches.extend(find_owner_fields(v, path + k + '.'))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            matches.extend(find_owner_fields(v, f'{path}[{i}].'))
    return matches


def fetch_site(site_id, ao_mobile_base='https://mobil.artsobservasjoner.no'):
    login_token = os.getenv('AO_LOGIN_TOKEN')
    auth_cookie = os.getenv('AO_AUTH_COOKIE')

    if not login_token or not auth_cookie:
        print('Missing AO_LOGIN_TOKEN or AO_AUTH_COOKIE in environment. Aborting.', file=sys.stderr)
        sys.exit(2)

    # Normalize auth_cookie: allow either raw value or ".ASPXAUTHNO=..."
    if auth_cookie.startswith('.ASPXAUTHNO='):
        auth_val = auth_cookie.split('=', 1)[1]
    else:
        auth_val = auth_cookie

    cookies = f'logintoken={login_token}; .ASPXAUTHNO={auth_val}; AcceptCookies=1'

    # Først: besøk ImportSighting for å se om AO serveren sender en fornyet .ASPXAUTHNO
    import_url = f"{ao_mobile_base}/ImportSighting"
    import_req = Request(
        import_url,
        headers={
            'User-Agent': 'Fugleobservasjoner-inspect/1.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Cookie': cookies,
            'Referer': 'https://mobil.artsobservasjoner.no/contribute/submit-sightings',
        },
    )

    try:
        with urlopen(import_req, timeout=15) as r:
            # Sjekk Set-Cookie-headers for fornyet .ASPXAUTHNO
            set_cookie_headers = r.headers.get_all('Set-Cookie') or []
            for sc in set_cookie_headers:
                m = None
                try:
                    import re
                    m = re.search(r'\.ASPXAUTHNO=([^;]+)', sc)
                except Exception:
                    m = None
                if m:
                    auth_val = m.group(1)
                    # oppdater cookies-strengen for neste kall
                    cookies = f'logintoken={login_token}; .ASPXAUTHNO={auth_val}; AcceptCookies=1'

    except Exception:
        # Ikke kritisk hvis import-siden feiler, vi forsøker ById uansett
        pass

    url = f"{ao_mobile_base}/core/Sites/ById?" + urlencode({'id': site_id})

    req = Request(
        url,
        headers={
            'User-Agent': 'Fugleobservasjoner-inspect/1.0',
            'Accept': 'application/json, text/plain, */*',
            'X-CSRF': '1',
            'Referer': 'https://mobil.artsobservasjoner.no/contribute/submit-sightings',
            'Cookie': cookies,
        },
    )

    try:
        with urlopen(req, timeout=15) as resp:
            status = resp.getcode()
            body = resp.read().decode('utf-8', errors='ignore')
            try:
                data = json.loads(body) if body else None
            except Exception:
                data = body
            return status, resp.headers, data
    except Exception as e:
        print('Request failed:', repr(e), file=sys.stderr)
        raise


def main():
    p = argparse.ArgumentParser()
    p.add_argument('site_id', help='AO site id to inspect')
    p.add_argument('--base', default=os.getenv('AO_MOBILE_URL', 'https://mobil.artsobservasjoner.no'))
    args = p.parse_args()

    status, headers, data = fetch_site(args.site_id, ao_mobile_base=args.base)

    print('HTTP status:', status)
    # Print a couple of headers that might hint at issues
    for h in ('content-type', 'content-length'):
        if h in headers:
            print(f'{h}:', headers[h])

    out_path = f'/tmp/ao_site_{args.site_id}.json'
    try:
        with open(out_path, 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print('Saved JSON to', out_path)
    except Exception:
        pass

    if not data:
        print('No JSON body returned; raw response printed above or saved to file.', file=sys.stderr)
        return

    print('\nTop-level keys:', list(data.keys()) if isinstance(data, dict) else type(data))

    matches = find_owner_fields(data)
    if matches:
        print('\nPotential owner/creator-like fields found:')
        for path, val in matches:
            print('-', path, '=>', repr(val)[:300])
    else:
        print('\nNo obvious owner/creator fields found in response.')


if __name__ == '__main__':
    main()
