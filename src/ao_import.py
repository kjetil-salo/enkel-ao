"""
Håndterer direkte posting av observasjoner til Artsobservasjoner.no.

MERK: Dette er en personlig funksjon for eieren av appen.
Krever hardkodede cookies som miljøvariabler.

STRUKTUR:
- observations_to_csv() - AKTIV: Brukes av ao_import_httpx.py (testet)
- fetch_csrf_token()    - DEPRECATED: Legacy urllib-kode (ikke testet)
- post_to_ao()          - DEPRECATED: Legacy urllib-kode (ikke testet)

Aktiv kode finnes i ao_import_httpx.py (httpx-basert, 80% test coverage).
"""

import json
import os
import re
import sys
from urllib.parse import urlencode, quote_plus
from urllib.request import Request, urlopen


def _mask(token, visible=6):
    """Masker et token for logging."""
    if not token:
        return 'None'
    return token[:visible] + '***'


def observations_to_csv(observations):
    """
    Konverter observations array til AO CSV-format.

    Format matcher observations.js toCsv() funksjonen:
    Header + data-rader med tab-separerte verdier.
    """
    # CSV Header - VIKTIG: Må matche nøyaktig det AO forventer
    header_cols = [
        'Artsnavn',
        'Lokalitetsnavn',
        'Superlokalitet',
        'Nord',
        'Øst',
        'Nøyaktighet',
        'Fra dato',
        'Til dato',
        'Fra klokkeslett',
        'Til klokkeslett',
        'Antall',
        'Alder',
        'Kjønn',
        'Aktivitet',
        'Kommentar (synlig for alle)',
        'Privat kommentar (kun synlig for deg selv)',
        'Skjul funn til dato',
    ]

    # Legg til 10 medobservatør-kolonner
    for i in range(10):
        header_cols.append('Medobservatør')

    # Resten av kolonnene (tomme for oss, men AO forventer dem)
    extra_cols = [
        'Bestemmelsesmetode', 'Natursystem', 'Beskriv natursystem',
        'Livsmedium', 'Beskriv livsmedium', 'Art som livsmedium',
        'Beskriv art som livsmedium', 'Dybde min', 'Dybde maks',
        'Høyde min', 'Høyde maks', 'Andrehånds', 'Usikker artsbestemming',
        'Ikke spontan', 'Interessant observasjon', 'Ikke gjenfunnet',
        'Ikke funnet', 'Offentlig samling', 'Privat samling',
        'Referansenummer i samling', 'Beskrivelse artsbestemming',
        'Bestemt av', 'Bestemt av (fritekst)', 'Bestemmelsesår',
        'Bekreftet av', 'Bekreftet av (fritekst)', 'Bekreftelsesår',
    ]
    header_cols.extend(extra_cols)

    lines = ['\t'.join(header_cols)]

    # Data-rader
    for obs in observations:
        # Species kan være objekt med taxonName
        species = obs.get('species', '')
        if isinstance(species, dict):
            species_name = species.get('taxonName', '')
        else:
            species_name = str(species) if species else ''

        # Dato/tid fra timestamp (ISO format)
        date_str = ''
        time_str = ''
        if obs.get('timestamp'):
            from datetime import datetime
            try:
                dt = datetime.fromisoformat(obs['timestamp'].replace('Z', '+00:00'))
                # DD.MM.YYYY format
                date_str = dt.strftime('%d.%m.%Y')
                # HH:MM format (unntatt 00:00)
                if dt.hour != 0 or dt.minute != 0:
                    time_str = dt.strftime('%H:%M')
            except Exception:
                pass

        # Til-klokkeslett (valgfritt)
        time_to_str = ''
        if obs.get('tilKlokkeslett'):
            from datetime import datetime
            try:
                dt = datetime.fromisoformat(obs['tilKlokkeslett'].replace('Z', '+00:00'))
                time_to_str = dt.strftime('%H:%M')
            except Exception:
                pass

        # Hvis ingen til-tid, bruk fra-tid
        if not time_to_str:
            time_to_str = time_str

        row = [
            species_name,
            obs.get('placeName', ''),
            '',  # Superlokalitet
            '',  # Nord (lat)
            '',  # Øst (lon)
            '',  # Nøyaktighet
            date_str,
            date_str,  # Til dato = fra dato
            time_str,
            time_to_str,
            str(obs.get('count', '')),
            obs.get('age', ''),
            obs.get('gender', ''),
            obs.get('activity', ''),
            obs.get('comment', ''),
            '',  # Privat kommentar
            '',  # Skjul funn til dato
        ]

        # Medobservatører (maks 10)
        co_obs = obs.get('coObservers', [])
        for i in range(10):
            if i < len(co_obs):
                # Kan være objekt med .name eller bare string
                co = co_obs[i]
                if isinstance(co, dict):
                    row.append(co.get('name', ''))
                else:
                    row.append(str(co) if co else '')
            else:
                row.append('')

        # Ekstra kolonner (alle tomme)
        for _ in extra_cols:
            row.append('')

        lines.append('\t'.join(row))

    # VIKTIG: AO forventer \r\n line endings
    return '\r\n'.join(lines)


def fetch_csrf_token(login_token, auth_cookie, ao_base_url='https://www.artsobservasjoner.no'):
    """
    DEPRECATED: Bruk ao_import_curl.fetch_csrf_tokens() i stedet.

    Legacy urllib-basert implementasjon. Ny curl-basert kode finnes i ao_import_curl.py.
    Denne funksjonen er ikke lenger i bruk og mangler test-coverage.

    Hent CSRF token fra AO ImportSighting siden.
    Krever cookies for å få tilgang (må være logget inn).

    Returnerer dict med:
    - csrf_token: CSRF token for POST
    - auth_cookie: Eventuell fornyet .ASPXAUTHNO fra Set-Cookie, eller original
    """
    import_url = f'{ao_base_url}/ImportSighting'

    print(f'[AO] Henter CSRF token fra: {import_url}', file=sys.stderr)
    sys.stderr.flush()

    # Bygg cookies (må være logget inn for å få tilgang til ImportSighting)
    cookies = f'logintoken={login_token}; .ASPXAUTHNO={auth_cookie}; AcceptCookies=1'

    req = Request(
        import_url,
        headers={
            'User-Agent': 'Mozilla/5.0 (compatible; Fugleobservasjoner-DirectImport/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Cookie': cookies,
        },
    )

    # Hold styr på eventuell fornyet auth cookie
    refreshed_auth = auth_cookie

    try:
        with urlopen(req, timeout=10) as resp:
            status = resp.getcode()
            print(f'[AO] CSRF fetch status: {status}')
            
            # Fang eventuelle Set-Cookie headers for å oppdatere auth cookie
            set_cookie_headers = resp.headers.get_all('Set-Cookie') or []
            for sc in set_cookie_headers:
                # Søk etter .ASPXAUTHNO=...
                m = re.search(r'\.ASPXAUTHNO=([^;]+)', sc)
                if m:
                    refreshed_auth = m.group(1)
                    print(f'[AO] Fornyet .ASPXAUTHNO fra Set-Cookie: {_mask(refreshed_auth)}', file=sys.stderr)
                    sys.stderr.flush()
            
            html = resp.read().decode('utf-8', errors='ignore')

        # Søk etter __RequestVerificationToken i HTML
        # Format: <input name="__RequestVerificationToken" type="hidden" value="TOKEN" />
        match = re.search(
            r'<input[^>]*name="__RequestVerificationToken"[^>]*value="([^"]+)"',
            html,
            re.IGNORECASE
        )

        if match:
            token = match.group(1)
            print(f'[AO] Hentet CSRF token: {_mask(token)}', file=sys.stderr)
            sys.stderr.flush()
            return {'csrf_token': token, 'auth_cookie': refreshed_auth}

        # Alternativt format i cookie
        match = re.search(
            r'__RequestVerificationToken["\']?\s*[:=]\s*["\']?([a-zA-Z0-9_-]+)',
            html
        )
        if match:
            return {'csrf_token': match.group(1), 'auth_cookie': refreshed_auth}

        raise ValueError('Kunne ikke finne CSRF token i AO ImportSighting siden')

    except Exception as e:
        from urllib.error import HTTPError
        if isinstance(e, HTTPError):
            print(f'[AO] CSRF fetch failed - HTTP {e.code}: {e.reason}')
            print(f'[AO] URL: {e.url}')
        print(f'[AO] Feil ved henting av CSRF token: {e}')
        raise


def post_to_ao(observations, ao_base_url='https://www.artsobservasjoner.no'):
    """
    DEPRECATED: Bruk ao_import_httpx.post_with_curl() i stedet.

    Legacy urllib-basert implementasjon. Ny httpx-basert kode finnes i ao_import_httpx.py.
    Denne funksjonen er ikke lenger i bruk og mangler test-coverage.

    Post observasjoner direkte til AO ved å kalle curl.

    Krever miljøvariabler:
    - AO_LOGIN_TOKEN: logintoken cookie
    - AO_AUTH_COOKIE: .ASPXAUTHNO cookie
    """
    import subprocess

    # Hent cookies fra miljøvariabler
    login_token = os.getenv('AO_LOGIN_TOKEN')
    auth_cookie = os.getenv('AO_AUTH_COOKIE')

    if not login_token or not auth_cookie:
        raise ValueError(
            'Mangler AO cookies. Sett miljøvariabler:\n'
            'AO_LOGIN_TOKEN="282144:443cdde8..."\n'
            'AO_AUTH_COOKIE=".ASPXAUTHNO=6AFD6389..."'
        )

    # Hent CSRF token (krever cookies) - returnerer dict med csrf_token og eventuell fornyet auth_cookie
    csrf_result = fetch_csrf_token(login_token, auth_cookie, ao_base_url)
    csrf_token = csrf_result['csrf_token']
    # Bruk eventuell fornyet auth cookie fra Set-Cookie header
    auth_cookie = csrf_result['auth_cookie']

    # Generer CSV
    csv_data = observations_to_csv(observations)

    # Lagre CSV til fil for debugging
    with open('/tmp/ao_import.csv', 'w') as f:
        f.write(csv_data)
    print(f'[AO] CSV saved to /tmp/ao_import.csv ({len(csv_data)} bytes)', file=sys.stderr)
    sys.stderr.flush()

    # Bygg POST-data (URL-encoded)
    # Må replikere nøyaktig samme encoding som browser/curl:
    # - Tabs = %09
    # - Newlines = %0D%0A
    # - Space = +
    # - Spesialtegn (æøå) = UTF-8 percent-encoded

    def browser_encode(text):
        """Encode som browser gjør det - space til +, resten percent-encoded."""
        # quote_plus med UTF-8 encoding (default) - space blir +, alt annet %-encoded
        return quote_plus(text, safe='', encoding='utf-8')

    # Encode CSV med browser-encoding
    encoded_csv = browser_encode(csv_data)

    post_parts = [
        f'__RequestVerificationToken={browser_encode(csrf_token)}',
        f'ImportSightingViewModel.Observations={encoded_csv}',
        'ImportSightingViewModel.Area=',
        'ImportSightingViewModel.OwnAndFavoriteSites=true',
        'OwnAndFavoriteSites=false',
        'ImportSightingViewModel.ProjectToAdd=',
        'ImportSightingViewModel.ProjectToAdd_Name=',
        'Shared_Import=Importer',
    ]

    # Join med & og encode til bytes
    post_body = '&'.join(post_parts).encode('utf-8')

    # Debug: lagre POST body
    with open('/tmp/ao_post_body.txt', 'wb') as f:
        f.write(post_body)
    print(f'[AO] POST body saved to /tmp/ao_post_body.txt ({len(post_body)} bytes)', file=sys.stderr)
    print(f'[AO] POST preview: {post_body[:300]}', file=sys.stderr)
    sys.stderr.flush()

    # Bygg cookies header (ALLE cookies fra working curl-kommando)
    cookies = (
        f'AcceptCookies=1; '
        f'monthlistpagesize=150; '
        f'logintoken={login_token}; '
        f'logintoken_ssl=1; '
        f'.ASPXAUTHNO={auth_cookie}; '
        f'__RequestVerificationToken={csrf_token}; '
        f'ReleaseNumber=2.13.12; '
        f'TempUserId=9f7277de-feda-4c32-977a-521e179981e3; '
        f'SpeciesGroup=8'
    )

    # POST request
    post_url = f'{ao_base_url}/ImportSighting/ParseObservations'

    req = Request(
        post_url,
        data=post_body,
        headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'nb-NO,nb;q=0.9,no-NO;q=0.8,no;q=0.7,nn-NO;q=0.6,nn;q=0.5,en-US;q=0.4,en;q=0.3',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': ao_base_url,
            'Connection': 'keep-alive',
            'Referer': f'{ao_base_url}/ImportSighting',
            'Cookie': cookies,
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1',
            'Priority': 'u=0, i',
        },
    )

    try:
        print(f'[AO] Poster {len(observations)} observasjoner til {post_url}...')
        print(f'[AO] CSV preview: {csv_data[:200]}...')

        with urlopen(req, timeout=30) as resp:
            response_html = resp.read().decode('utf-8', errors='ignore')
            status_code = resp.getcode()

        print(f'[AO] Response status: {status_code}', file=sys.stderr)
        sys.stderr.flush()

        # Lagre response til fil for debugging
        with open('/tmp/ao_response.html', 'w') as f:
            f.write(response_html)
        print(f'[AO] Full response saved to /tmp/ao_response.html', file=sys.stderr)
        sys.stderr.flush()

        # Sjekk om import var vellykket
        # AO redirecter til /ImportSighting/Import ved suksess
        # eller viser feilmelding i HTML

        if 'ImportSighting/Import' in response_html or status_code == 200:
            # Sjekk for feilmeldinger i HTML
            if 'validation-summary-errors' in response_html.lower() or 'error' in response_html.lower():
                # Prøv å parse ut feilmelding
                error_match = re.search(
                    r'<div[^>]*class="[^"]*validation-summary-errors[^"]*"[^>]*>(.*?)</div>',
                    response_html,
                    re.DOTALL | re.IGNORECASE
                )
                if error_match:
                    error_html = error_match.group(1)
                    # Strip HTML tags
                    error_text = re.sub(r'<[^>]+>', '', error_html).strip()
                    raise ValueError(f'AO returnerte feil: {error_text}')

            return {
                'success': True,
                'message': f'{len(observations)} observasjoner importert til AO',
                'count': len(observations),
            }
        else:
            raise ValueError('Uventet respons fra AO')

    except Exception as e:
        from urllib.error import HTTPError
        if isinstance(e, HTTPError):
            print(f'[AO] HTTP Error {e.code}: {e.reason}', file=sys.stderr)
            print(f'[AO] URL: {e.url}', file=sys.stderr)
            sys.stderr.flush()
            try:
                error_body = e.read().decode('utf-8', errors='ignore')
                # Lagre error response
                with open('/tmp/ao_error_response.html', 'w') as f:
                    f.write(error_body)
                print(f'[AO] Error response saved to /tmp/ao_error_response.html', file=sys.stderr)

                # Prøv å finne feilmelding
                if 'validation-summary' in error_body:
                    match = re.search(r'<li>(.*?)</li>', error_body, re.DOTALL)
                    if match:
                        error_msg = re.sub(r'<[^>]+>', '', match.group(1)).strip()
                        print(f'[AO] Feilmelding: {error_msg}', file=sys.stderr)
                sys.stderr.flush()
            except Exception as read_err:
                print(f'[AO] Kunne ikke lese error body: {read_err}', file=sys.stderr)
                sys.stderr.flush()
        print(f'[AO] Feil ved posting: {e}', file=sys.stderr)
        sys.stderr.flush()
        raise
