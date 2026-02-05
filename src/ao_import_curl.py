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


def post_with_curl(observations, login_token=None, auth_cookie=None):
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

    # Steg 0: Hent baseline FØR vi importerer
    print(f'[AO-CURL] Henter baseline før import...', file=sys.stderr)
    baseline = check_import_status(login_token, auth_cookie)
    print(f'[AO-CURL] Baseline: importing={baseline["importing"]}, submitted={baseline["submitted"]}', file=sys.stderr)

    # Hent eksisterende SightingId-er slik at vi kan filtrere dem bort etterpå
    baseline_grid = get_review_sightings_details(login_token, auth_cookie)
    baseline_ids = baseline_grid.get('sightingIds', set())
    print(f'[AO-CURL] Baseline SightingIds: {len(baseline_ids)} obs fra før', file=sys.stderr)

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
        f'ImportSightingViewModel.Area=&'
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

    # Steg 2: Poll NumberOfSightingsSubmitted til alle obs er ferdig importert
    import time
    expected = len(observations)
    max_polls = 15
    poll_interval = 1

    print(f'[AO-POLL] Venter på at {expected} obs importeres...', file=sys.stderr)

    for poll_nr in range(1, max_polls + 1):
        time.sleep(poll_interval)

        check = check_import_status(login_token, auth_cookie)
        submitted_delta = check['submitted'] - baseline['submitted']

        print(f'[AO-POLL] #{poll_nr}: submitted={submitted_delta}/{expected}', file=sys.stderr)

        if submitted_delta >= expected:
            print(f'[AO-POLL] Alle {expected} obs er importert!', file=sys.stderr)
            break
    else:
        print(f'[AO-POLL] Timeout. submitted={submitted_delta}/{expected}', file=sys.stderr)

    # Steg 3: Hent ReviewSighting grid og sjekk ErrorCount per observasjon
    print(f'[AO-POLL] Henter detaljert valideringsstatus fra grid...', file=sys.stderr)
    grid_details = get_review_sightings_details(login_token, auth_cookie, exclude_ids=baseline_ids)

    if grid_details['hasErrors']:
        error_count = grid_details['obsWithErrors']
        print(f'[AO-POLL] VALIDERINGSFEIL: {error_count} obs har feil!', file=sys.stderr)

        return {
            'success': True,
            'message': f'{expected} observasjoner importert, men har valideringsfeil',
            'count': expected,
            'published': False,
            'validationErrors': grid_details['errors'],
            'errorCount': error_count,
            'refreshedAuthCookie': refreshed_auth
        }

    # Steg 3: Publiser observasjonene (kun hvis ingen valideringsfeil)
    print(f'[AO-CURL] Ingen valideringsfeil - starter publisering...', file=sys.stderr)
    try:
        publish_result = publish_all(login_token, auth_cookie)
        print(f'[AO-CURL] Publisering: {publish_result}', file=sys.stderr)

        # Sjekk om det var valideringsfeil
        if publish_result.get('validationErrors'):
            print(f'[AO-CURL] Publisering stoppet pga valideringsfeil', file=sys.stderr)
            return {
                'success': True,
                'message': f'{len(observations)} observasjoner importert, men ikke publisert pga valideringsfeil',
                'count': len(observations),
                'published': False,
                'validationErrors': publish_result['validationErrors'],
                'warnings': publish_result.get('warnings', []),
                'refreshedAuthCookie': refreshed_auth
            }

        # Ingen valideringsfeil - publisering OK
        response = {
            'success': True,
            'message': f'{len(observations)} observasjoner importert og publisert',
            'count': len(observations),
            'published': True,
            'refreshedAuthCookie': refreshed_auth
        }

        # Inkluder advarsler hvis de finnes
        if publish_result.get('warnings'):
            response['warnings'] = publish_result['warnings']

        return response

    except Exception as e:
        print(f'[AO-CURL] Publisering feilet: {e}', file=sys.stderr)
        return {
            'success': True,
            'message': f'{len(observations)} observasjoner importert (men publisering feilet: {e})',
            'count': len(observations),
            'published': False,
            'error': str(e),
            'refreshedAuthCookie': refreshed_auth
        }


def get_review_sightings_details(login_token, auth_cookie, exclude_ids=None):
    """
    Hent detaljert liste over observasjoner i ReviewSighting via grid-API.

    Args:
        exclude_ids: Set med SightingId-er som skal ignoreres (obs fra før import)
    """
    cookie_header = f'logintoken={login_token}; logintoken_ssl=1; .ASPXAUTHNO={auth_cookie}; AcceptCookies=1'

    result = subprocess.run(
        [
            'curl', '-s',
            'https://www.artsobservasjoner.no/ReviewSighting/BindReviewSightingsGrid',
            '-X', 'POST',
            '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
            '-H', 'Accept: text/plain, */*; q=0.01',
            '-H', 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8',
            '-H', 'X-Requested-With: XMLHttpRequest',
            '-H', f'Cookie: {cookie_header}',
            '--data-raw', 'page=1&size=200'
        ],
        capture_output=True,
        text=True,
        timeout=15
    )

    response_text = result.stdout

    # Lagre for debugging
    with open('/tmp/ao_review_grid.json', 'w') as f:
        f.write(response_text)

    errors = []
    sighting_ids = set()
    exclude_ids = exclude_ids or set()

    try:
        data = json.loads(response_text)
        items = data.get('data', [])
        total = data.get('total', 0)

        print(f'[AO-GRID] {total} observasjoner i ReviewSighting', file=sys.stderr)

        for item in items:
            sid = item.get('SightingId', 0)
            sighting_ids.add(sid)

            # Hopp over obs som fantes fra før
            if sid in exclude_ids:
                print(f'[AO-GRID] Hopper over gammel obs SightingId={sid}', file=sys.stderr)
                continue

            error_count = item.get('ErrorCount', 0)
            if error_count == 0:
                continue

            taxon = item.get('TaxonName', 'Ukjent art')
            print(f'[AO-GRID] {taxon} (SightingId={sid}): {error_count} feil', file=sys.stderr)

            # Map feltnavn til norske labels
            field_labels = {
                'ActivityName': 'Aktivitet',
                'SiteName': 'Lokalitet',
                'DecoratedTaxonName': 'Art',
                'StartDate': 'Fra dato',
                'EndDate': 'Til dato',
                'Quantity': 'Antall',
                'StartTime': 'Fra klokkeslett',
                'EndTime': 'Til klokkeslett',
                'StageName': 'Alder',
                'GenderName': 'Kjønn',
            }

            obs_errors = []
            for field_name, label in field_labels.items():
                field_html = item.get(field_name, '')
                if 'val_error_li' not in field_html:
                    continue

                val_match = re.search(r"class='val_error'>(.*?)<div", field_html)
                field_val = ''
                if val_match:
                    field_val = val_match.group(1)
                    for entity, char in [('&#229;', 'å'), ('&#248;', 'ø'), ('&#230;', 'æ'), ('&amp;', '&')]:
                        field_val = field_val.replace(entity, char)

                field_errors = re.findall(r"class='val_error_li'>(.*?)</li>", field_html)
                for err in field_errors:
                    for entity, char in [('&#229;', 'å'), ('&#248;', 'ø'), ('&#230;', 'æ'), ('&amp;', '&')]:
                        err = err.replace(entity, char)
                    obs_errors.append(f'{label}: {err}' + (f' → "{field_val}"' if field_val else ''))

            if obs_errors:
                errors.append(f'**{taxon}**')
                errors.extend(obs_errors)
            else:
                errors.append(f'{taxon}: {error_count} valideringsfeil')

    except (json.JSONDecodeError, ValueError) as e:
        print(f'[AO-GRID] Kunne ikke parse JSON: {e}', file=sys.stderr)

    print(f'[AO-GRID] Feilmeldinger (nye obs): {errors}', file=sys.stderr)

    # Tell antall obs med feil (= antall **header**-linjer)
    obs_with_errors = sum(1 for e in errors if e.startswith('**') and e.endswith('**'))

    return {
        'errors': errors,
        'hasErrors': len(errors) > 0,
        'obsWithErrors': obs_with_errors,
        'sightingIds': sighting_ids
    }


def check_import_status(login_token, auth_cookie):
    """
    Sjekk import-status ved å sammenligne importerte vs klare til publisering.

    AO har to API-endepunkter:
    - NumberOfSightingsImporting: Antall importerte observasjoner
    - NumberOfSightingsSubmitted: Antall observasjoner klare til publisering (uten feil)

    Hvis disse ikke stemmer overens, er det valideringsfeil.

    Returnerer:
        dict med:
        - hasErrors: bool
        - imported: antall importerte
        - submitted: antall klare til publisering
        - errorCount: antall med feil (imported - submitted)
    """
    cookie_header = f'logintoken={login_token}; logintoken_ssl=1; .ASPXAUTHNO={auth_cookie}; AcceptCookies=1'

    # Sjekk antall importerte
    result_importing = subprocess.run(
        [
            'curl', '-s',
            'https://www.artsobservasjoner.no/ImportSighting/NumberOfSightingsImporting',
            '-X', 'POST',
            '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
            '-H', 'Accept: */*',
            '-H', 'Content-Type: application/json; charset=UTF-8',
            '-H', 'X-Requested-With: XMLHttpRequest',
            '-H', f'Cookie: {cookie_header}',
            '--data-raw', 'null'
        ],
        capture_output=True,
        text=True,
        timeout=15
    )

    # Sjekk antall klare til publisering
    result_submitted = subprocess.run(
        [
            'curl', '-s',
            'https://www.artsobservasjoner.no/ReviewSighting/NumberOfSightingsSubmitted',
            '-X', 'POST',
            '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
            '-H', 'Accept: */*',
            '-H', 'Content-Type: application/json; charset=UTF-8',
            '-H', 'X-Requested-With: XMLHttpRequest',
            '-H', f'Cookie: {cookie_header}',
            '--data-raw', 'null'
        ],
        capture_output=True,
        text=True,
        timeout=15
    )

    try:
        # Parse JSON response {"Count": X}
        importing_json = json.loads(result_importing.stdout.strip())
        submitted_json = json.loads(result_submitted.stdout.strip())

        importing_count = importing_json.get('Count', 0)
        submitted_count = submitted_json.get('Count', 0)

        print(f'[AO-CHECK] I "importing" status: {importing_count}, I "submitted" status (godkjent): {submitted_count}', file=sys.stderr)

        # AO flytter observasjoner fra "importing" til "submitted" når de er godkjent
        # Så: importing > 0 betyr at noen IKKE er godkjent (har valideringsfeil)
        # submitted > 0 betyr at noen ER godkjent (kan publiseres)

        total_imported = importing_count + submitted_count
        error_count = importing_count  # De som er stuck i "importing" har feil
        has_errors = error_count > 0

        if has_errors:
            print(f'[AO-CHECK] {error_count} observasjon(er) har valideringsfeil!', file=sys.stderr)

        return {
            'hasErrors': has_errors,
            'importing': importing_count,      # Antall stuck i "importing" (har feil)
            'submitted': submitted_count,       # Antall godkjent (kan publiseres)
            'errorCount': error_count,
            'total': total_imported
        }

    except (ValueError, AttributeError, json.JSONDecodeError) as e:
        print(f'[AO-CHECK] Kunne ikke parse API-respons: {e}', file=sys.stderr)
        print(f'[AO-CHECK] Importing response: {result_importing.stdout[:100]}', file=sys.stderr)
        print(f'[AO-CHECK] Submitted response: {result_submitted.stdout[:100]}', file=sys.stderr)
        # Fallback: anta at alt er OK hvis vi ikke kan parse
        return {
            'hasErrors': False,
            'imported': 0,
            'submitted': 0,
            'errorCount': 0
        }


def publish_all(login_token, auth_cookie):
    """
    Publiser alle importerte observasjoner.

    Returnerer:
        dict med:
        - status: HTTP status code
        - validationErrors: liste med valideringsfeil (tom hvis alt OK)
        - warnings: liste med advarsler
    """
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

    # Parse HTML for valideringsfeil og advarsler
    validation_errors = []
    warnings = []

    # Sjekk etter valideringsfeil (røde meldinger)
    # AO bruker typisk class="validation-summary-errors" eller lignende
    error_patterns = [
        r'<div[^>]*class="[^"]*validation-summary-errors[^"]*"[^>]*>(.*?)</div>',
        r'<span[^>]*class="[^"]*field-validation-error[^"]*"[^>]*>(.*?)</span>',
        r'<div[^>]*class="[^"]*alert-danger[^"]*"[^>]*>(.*?)</div>',
        # Stedsnavn-spesifikk feil
        r'Lokaliteten.*?kunne ikke identifiseres',
        r'Flertydig lokalitet',
        r'Stedsnavnet.*?er ikke entydig',
    ]

    for pattern in error_patterns:
        matches = re.finditer(pattern, html, re.IGNORECASE | re.DOTALL)
        for match in matches:
            error_text = match.group(1) if match.lastindex else match.group(0)
            # Rens HTML-tagger
            error_text = re.sub(r'<[^>]+>', '', error_text)
            error_text = error_text.strip()
            if error_text and len(error_text) > 5:  # Ignorer tomme eller veldig korte
                validation_errors.append(error_text)

    # Sjekk etter advarsler (gule meldinger)
    warning_patterns = [
        r'<div[^>]*class="[^"]*alert-warning[^"]*"[^>]*>(.*?)</div>',
    ]

    for pattern in warning_patterns:
        matches = re.finditer(pattern, html, re.IGNORECASE | re.DOTALL)
        for match in matches:
            warning_text = re.sub(r'<[^>]+>', '', match.group(1)).strip()
            if warning_text and len(warning_text) > 5:
                warnings.append(warning_text)

    if validation_errors:
        print(f'[AO-CURL] Valideringsfeil funnet: {validation_errors}', file=sys.stderr)
    if warnings:
        print(f'[AO-CURL] Advarsler funnet: {warnings}', file=sys.stderr)

    return {
        'status': status,
        'validationErrors': validation_errors,
        'warnings': warnings
    }
