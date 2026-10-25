"""
AO Direct Import - Bruker httpx for HTTP-kall.
"""

import base64
import json
import logging
import os
import re
import secrets
import time
from urllib.parse import quote_plus

import httpx

from src.utils import mask_token as _mask

logger = logging.getLogger('fugleobs')

# Hvor mange rader vi ber AOs gjennomgangs-grid om når køens faktiske størrelse er
# ukjent (tellerendepunktet svarte ikke). Romslig med vilje — se `queue_size` i
# `post_with_curl`.
_UNKNOWN_QUEUE_SIZE = 500


def observations_to_csv(observations):
    """Samme som i ao_import.py"""
    from src.ao_import import observations_to_csv as orig
    return orig(observations)


def _count_review_rows(html):
    """Tell antall observasjonsrader i AO ReviewSighting HTML. Returnerer 0 hvis ingen."""
    # Kendo UI grid (AO bruker Kendo) har k-master-row på datarader
    kendo = re.findall(r'class="[^"]*k-master-row[^"]*"', html)
    if kendo:
        return len(kendo)
    # Fallback: tell <tr>-elementer inne i <tbody>
    tbody = re.search(r'<tbody[^>]*>(.*?)</tbody>', html, re.DOTALL | re.IGNORECASE)
    if tbody:
        rows = re.findall(r'<tr[\s>]', tbody.group(1), re.IGNORECASE)
        return len(rows)
    # Kan ikke bestemme – returner None (betyr "ukjent", ikke 0)
    return None


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


def _post_count(url, login_token, auth_cookie):
    """
    POST til et AO count-endepunkt (body: JSON null) og returner Count som int.

    AOs egen web-UI poller disse for å vise importfremdrift:
    - /ImportSighting/NumberOfSightingsImporting  → hvor mange som fortsatt behandles
    - /ReviewSighting/NumberOfSightingsSubmitted   → hvor mange som ligger i gjennomgang

    Returnerer None hvis endepunktet er utilgjengelig eller svaret ikke kan tolkes.
    """
    cookies = {
        'logintoken': login_token,
        '.ASPXAUTHNO': auth_cookie,
        'AcceptCookies': '1',
    }
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': '*/*',
    }
    try:
        with httpx.Client() as client:
            resp = client.post(url, content='null', cookies=cookies, headers=headers, timeout=10)
        if resp.status_code != 200:
            return None
        return int(resp.json().get('Count'))
    except Exception:
        return None


def number_of_sightings_importing(login_token, auth_cookie):
    """Antall observasjoner AO fortsatt behandler (teller ned til 0 = ferdig parset)."""
    return _post_count(
        'https://www.artsobservasjoner.no/ImportSighting/NumberOfSightingsImporting',
        login_token, auth_cookie,
    )


def number_of_sightings_submitted(login_token, auth_cookie):
    """Antall observasjoner klargjort til gjennomgang (i review-køen)."""
    return _post_count(
        'https://www.artsobservasjoner.no/ReviewSighting/NumberOfSightingsSubmitted',
        login_token, auth_cookie,
    )


def review_queue_rows(login_token, auth_cookie, size=200):
    """
    Hent gjennomgangskøen som JSON fra AOs eget Kendo-grid-endepunkt.

    `POST /ReviewSighting/BindReviewSightingsGrid` med body `page=1&size=N` gir per rad
    bl.a. `SightingId`, `TemporarySightingId`, `TaxonName`, `SearchableStartDate`,
    `TimePresentation`, `ErrorCount` og `TriggeredValidationRulesText`. Bekreftet i
    HAR-fangst 27.07.2026 — se `docs/ao-rediger-api.md`.

    Returnerer liste av dicts, eller None hvis endepunktet ikke svarer som forventet.
    """
    cookies = {
        'logintoken': login_token,
        '.ASPXAUTHNO': auth_cookie,
        'AcceptCookies': '1',
    }
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': '*/*',
    }
    try:
        with httpx.Client() as client:
            resp = client.post(
                'https://www.artsobservasjoner.no/ReviewSighting/BindReviewSightingsGrid',
                content=f'page=1&size={int(size)}',
                cookies=cookies, headers=headers, timeout=10,
            )
        if resp.status_code != 200:
            return None
        rows = resp.json().get('data')
        return rows if isinstance(rows, list) else None
    except Exception:
        return None


def _describe_held_back(login_token, auth_cookie, limit=3, temp_sighting_ids=None):
    """
    Kort, menneskelig beskrivelse av hva som ble liggende igjen i gjennomgangskøen.

    Gir brukeren «tårnseiler 26.07 15:00» i stedet for bare et tall. Returnerer tom
    streng hvis køen ikke kan leses — da faller melding tilbake til antall alene.

    `temp_sighting_ids` begrenser beskrivelsen til VÅR batch (scoped publisering) — uten
    den ville andres ventende funn i køen blitt listet som om de var våre, se
    docs/ao-publish-selective-capture.md.
    """
    rows = review_queue_rows(login_token, auth_cookie)
    if not rows:
        return ''
    if temp_sighting_ids is not None:
        wanted = {str(x) for x in temp_sighting_ids}
        rows = [r for r in rows if str(r.get('TemporarySightingId')) in wanted]
        if not rows:
            return ''
    biter = []
    for row in rows[:limit]:
        navn = (row.get('TaxonName') or '').strip() or 'ukjent art'
        dato = (row.get('SearchableStartDate') or '').strip()
        tid = (row.get('TimePresentation') or '').strip()
        regel = (row.get('TriggeredValidationRulesText') or '').strip()
        tekst = ' '.join(x for x in (navn, dato, tid) if x)
        if regel:
            tekst += f' ({regel})'
        biter.append(tekst)
    if len(rows) > limit:
        biter.append(f'+{len(rows) - limit} til')
    return ', '.join(biter)


def _decode_data_url(data_url):
    """Del opp en data:-URL (data:image/jpeg;base64,....) og returner rå bytes."""
    if not data_url or ',' not in data_url:
        raise ValueError('Ugyldig bildedata')
    _, b64 = data_url.split(',', 1)
    return base64.b64decode(b64)


def _obs_label(obs):
    """Kort, menneskelig beskrivelse av en observasjon — til feilmeldinger."""
    species = obs.get('species', '')
    navn = species.get('taxonName', '') if isinstance(species, dict) else str(species or '')
    return (navn or 'ukjent art').strip()


def _fetch_csrf_from_page(url, login_token, auth_cookie):
    """
    Hent (form_token, cookie_token) fra en vilkårlig innlogget AO-side.

    Begge opplastingsskjemaene vi bruker ligger på hver sin side — gjennomgangskøen
    for funn som ennå ikke er publisert, og funnsiden for dem som er det — men
    token-mønsteret er identisk.
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
            url, cookies=cookies, headers=headers, timeout=15, follow_redirects=True,
        )
        response.raise_for_status()

    html = response.text
    match = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', html)
    if not match:
        raise ValueError('Kunne ikke finne form CSRF token for bildeopplasting')
    form_token = match.group(1)

    cookie_token = response.cookies.get('__RequestVerificationToken')
    if not cookie_token:
        raise ValueError('Kunne ikke finne cookie CSRF token for bildeopplasting')

    return form_token, cookie_token


def _fetch_review_csrf(login_token, auth_cookie):
    """
    Hent CSRF-token fra /ReviewSighting (samme mønster som `publish_all`).

    Brukes til bildeopplasting som skjer FØR publisering, mens funnet fortsatt ligger
    i gjennomgangskøen.
    """
    return _fetch_csrf_from_page(
        'https://www.artsobservasjoner.no/ReviewSighting', login_token, auth_cookie)


def _fetch_sighting_csrf(sighting_id, login_token, auth_cookie):
    """
    Hent CSRF-token fra funnsiden til et PUBLISERT funn.

    `/Sighting/<id>` rendrer AOs eget `<form action="/Media/UploadImageAction">` — se
    `docs/ao-mine-funn-api.md`. Vi henter tokenet der skjemaet faktisk står, i stedet
    for fra gjennomgangskøen, som kan være tom for en bruker uten ventende funn.
    """
    return _fetch_csrf_from_page(
        f'https://www.artsobservasjoner.no/Sighting/{int(sighting_id)}',
        login_token, auth_cookie)


def _feilutdrag(html, lengde=300):
    """
    Plukk ut noe lesbart fra en ASP.NET-feilside.

    Sidene er flere kilobyte markup rundt én setning som faktisk sier noe. Vi leter
    etter den vanlige plasseringen først, og faller tilbake på ren tekst.
    """
    if not html:
        return ''
    treff = re.search(r'<title>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
    if treff:
        tittel = re.sub(r'\s+', ' ', treff.group(1)).strip()
        if tittel:
            return tittel[:lengde]
    ren = re.sub(r'\s+', ' ', re.sub(r'<[^>]*>', ' ', html)).strip()
    return ren[:lengde]


def upload_image(sighting_id, image_bytes, filename, login_token, auth_cookie,
                 media_license='10', csrf=None):
    """
    Last opp ett bilde til en observasjon.

    Krever en ekte `SightingId`. Funnet kan enten ligge i gjennomgangskøen (se
    `PossibleToUploadImages` i `review_queue_rows()`) eller være publisert — begge
    deler er bekreftet mot AO, se `docs/ao-bilder-api.md`.

    `media_license` er AOs lisensvalg for bildet: 10=CC BY (default), 20=CC BY-SA,
    30=CC BY-NC-SA, 60=Ingen (alle rettigheter forbeholdt).

    `csrf` kan sendes inn ferdig hentet som `(form_token, cookie_token)`. Utelatt
    hentes det fra gjennomgangskøen, som er riktig kilde under selve sendingen.
    """
    form_token, cookie_token = csrf or _fetch_review_csrf(login_token, auth_cookie)

    cookies = {
        'AcceptCookies': '1',
        'logintoken': login_token,
        '.ASPXAUTHNO': auth_cookie,
        '__RequestVerificationToken': cookie_token,
    }
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
        'Referer': 'https://www.artsobservasjoner.no/ReviewSighting',
    }
    data = {
        '__RequestVerificationToken': form_token,
        'UploadImageViewModel.Sighting.Id': str(sighting_id),
        'UploadImageViewModel.MediaLicense': str(media_license),
    }
    files = {
        'UploadImageViewModel.Image': (filename, image_bytes, 'image/jpeg'),
    }

    # AO svarer av og til HTTP 500 på en opplasting som er helt lik en som nettopp
    # lyktes mot samme funn (observert i felt 25.10.2026). Vi vet ikke hvorfor, og
    # svaret er en ASP.NET-feilside, ikke noe maskinlesbart. Ett nytt forsøk er
    # billig og løser et forbigående problem; er det vedvarende, kommer feilen fram
    # som før — og nå med AOs egen tekst i loggen, så vi slipper å gjette neste gang.
    siste_svar = None
    for forsok, pause in enumerate([0, 2], start=1):
        if pause:
            time.sleep(pause)
        with httpx.Client() as client:
            siste_svar = client.post(
                'https://www.artsobservasjoner.no/Media/UploadImageAction',
                data=data, files=files, cookies=cookies, headers=headers, timeout=30,
            )
        if siste_svar.status_code < 400:
            break
        logger.warning(
            f'[AO-BILDE] Opplasting til funn {sighting_id} svarte HTTP '
            f'{siste_svar.status_code} (forsøk {forsok}). AO sa: '
            f'{_feilutdrag(siste_svar.text)!r}'
        )

    response = siste_svar
    if response.status_code >= 400:
        raise ValueError(f'Artsobservasjoner svarte HTTP {response.status_code} — prøv igjen om litt')

    # HTTP < 400 er selve beviset på at AO tok imot bildet — se docs/ao-bilder-api.md.
    # Responsen er ikke nødvendigvis ren JSON: AOs eget UI bruker en iframe-postback, og
    # slike endepunkter pakker ofte JSON-en inn i HTML (f.eks. <textarea>...</textarea>)
    # for å unngå at nettleseren prøver å laste den ned som fil. Bekreftet i praksis
    # 03.08.2026 — `response.json()` feilet med "Expecting value: line 1 column 1" selv
    # om bildet var korrekt lastet opp og synlig på AO.
    try:
        return response.json()
    except ValueError:
        match = re.search(r'\{.*\}', response.text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except ValueError:
                pass
        logger.debug(f'[AO-HTTPX] Opplastingsrespons var ikke JSON, ignorerer: {response.text[:200]!r}')
        return {}


# AO tillater maks 10 bilder per funn (`MediaFilePerSightingRestriction` i
# opplastingsskjemaet, se docs/ao-bilder-api.md).
MAX_IMAGES_PER_SIGHTING = 10

# AOs lisensvalg. Hvitelistet fordi verdien går rett inn i et skjema hos AO — vi
# sender aldri videre noe klienten finner på selv.
MEDIA_LICENSES = {'10', '20', '30', '60'}

# Hvor mange ganger bildelista sjekkes etter en opplasting før vi konkluderer med at
# AO ikke tok imot. AO kan bruke et øyeblikk på å gjøre bildet synlig, og en for rask
# konklusjon får brukeren til å laste opp på nytt — med dublett som resultat.
_IMAGE_VERIFY_ATTEMPTS = 3
_IMAGE_VERIFY_DELAY = 1.0


def sighting_images(sighting_id, login_token, auth_cookie):
    """
    Hvilke bilder ligger på dette funnet nå?

    `/Media/EditableImagesForSightingId/` svarer med en liste (tom hvis ingen bilder)
    for funn brukeren selv kan redigere — verifisert mot et publisert funn 25.10.2026.
    Returnerer None hvis AO ikke kunne spørres, slik at kalleren kan skille «ingen
    bilder» fra «vet ikke».
    """
    cookies = {
        'logintoken': login_token,
        '.ASPXAUTHNO': auth_cookie,
        'AcceptCookies': '1',
    }
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Requested-With': 'XMLHttpRequest',
    }
    try:
        with httpx.Client() as client:
            resp = client.post(
                'https://www.artsobservasjoner.no/Media/EditableImagesForSightingId/',
                content=json.dumps({'sightingId': int(sighting_id)}),
                cookies=cookies, headers=headers, timeout=15,
            )
        if resp.status_code != 200:
            return None
        data = resp.json()
        return data if isinstance(data, list) else None
    except Exception as e:
        logger.warning(f'[AO-BILDE] Kunne ikke hente bildeliste for funn {sighting_id}: {e}')
        return None


def upload_photo_to_published_sighting(sighting_id, photo_data_url, login_token, auth_cookie,
                                       media_license='10'):
    """
    Legg et bilde på et funn som allerede er publisert — «berik hjemmefra».

    Dette er den delen av bildestøtten som IKKE henger sammen med selve sendingen:
    funnet ble kanskje rapportert fra mobilen i felt, og bildet kommer fra kamera
    flere timer senere. Derfor hentes CSRF fra funnsiden, ikke fra gjennomgangskøen.

    Returnerer en dict med `ok` og enten `imageId` eller `error`. Kaster ikke —
    kalleren er et endepunkt som skal svare brukeren, ikke en intern flyt.
    """
    if media_license not in MEDIA_LICENSES:
        media_license = '10'

    try:
        sighting_id = int(sighting_id)
    except (TypeError, ValueError):
        return {'ok': False, 'error': 'Ugyldig funn-ID'}

    try:
        image_bytes = _decode_data_url(photo_data_url)
    except Exception:
        return {'ok': False, 'error': 'Kunne ikke lese bildet'}

    if not image_bytes:
        return {'ok': False, 'error': 'Bildet var tomt'}

    # Tell før: både for å stoppe på AOs egen grense, og for å kunne si med sikkerhet
    # etterpå om bildet faktisk kom fram. Opplastingsresponsen er ikke til å stole
    # på alene — den kommer av og til som HTML (se upload_image).
    for_opplasting = sighting_images(sighting_id, login_token, auth_cookie)
    if for_opplasting is not None and len(for_opplasting) >= MAX_IMAGES_PER_SIGHTING:
        return {'ok': False,
                'error': f'Funnet har allerede {MAX_IMAGES_PER_SIGHTING} bilder, som er AOs grense'}

    try:
        csrf = _fetch_sighting_csrf(sighting_id, login_token, auth_cookie)
        svar = upload_image(sighting_id, image_bytes, 'bilde.jpg',
                            login_token, auth_cookie, media_license, csrf=csrf)
    except Exception as e:
        logger.warning(f'[AO-BILDE] Opplasting feilet for funn {sighting_id}: {e}')
        return {'ok': False, 'error': str(e)}

    image_id = svar.get('id') if isinstance(svar, dict) else None

    # Kunne vi ikke telle FØR opplastingen, kan vi heller ikke sammenligne etterpå.
    # Da sier vi det, i stedet for å gjette: et «ok» uten dekning er nøyaktig løgnen
    # denne verifiseringen finnes for å unngå. Å lese siste bilde i lista som «vårt»
    # ville i verste fall rapportert ID-en til et bilde som lå der fra før.
    if for_opplasting is None:
        logger.info(f'[AO-BILDE] Kunne ikke telle bilder før opplasting på funn {sighting_id} '
                    '— rapporterer ubekreftet')
        return {'ok': True, 'verified': False, 'imageId': image_id, 'imageCount': None}

    # AO kan bruke et øyeblikk på å gjøre bildet synlig i lista. Å konkludere med
    # «ikke mottatt» på første forsøk ville fått brukeren til å laste opp på nytt —
    # og da ligger det to like bilder på funnet.
    etter = None
    for forsok in range(_IMAGE_VERIFY_ATTEMPTS):
        if forsok:
            time.sleep(_IMAGE_VERIFY_DELAY)
        etter = sighting_images(sighting_id, login_token, auth_cookie)
        if etter is not None and len(etter) > len(for_opplasting):
            break

    if etter is None:
        return {'ok': True, 'verified': False, 'imageId': image_id, 'imageCount': None}

    if len(etter) <= len(for_opplasting):
        return {'ok': False, 'error': 'AO tok ikke imot bildet'}

    if image_id is None:
        image_id = etter[-1].get('id')

    return {'ok': True, 'verified': True, 'imageId': image_id, 'imageCount': len(etter)}


def _find_row_for_marker(rows, marker):
    """
    Finn gjennomgangskø-raden hvis `PrivateCommentLong` inneholder `marker`.

    Markøren (`_importMarker`) kan dele kolonnen med brukerens egen private kommentar
    (se ao_import.py), så vi leter etter den som substreng i stedet for eksakt match.
    """
    for row in rows:
        if marker in (row.get('PrivateCommentLong') or ''):
            return row
    return None


def _upload_pending_images(observations, login_token, auth_cookie, progress_cb=None, rows=None):
    """
    Match observasjoner med vedlagt bilde mot ekte SightingId (via markøren i privat
    kommentar) og last dem opp — best-effort, aldri blokkerende for selve publiseringen.

    `rows` kan sendes inn forhåndshentet (unngår et ekstra `review_queue_rows`-kall når
    den allerede er hentet for scoped publisering, se post_with_curl) — hentes selv hvis
    utelatt.

    Returnerer liste av artsnavn det IKKE lot seg gjøre å laste opp bilde for (tom liste
    hvis alt gikk bra, eller ingen bilder var vedlagt).
    """
    photo_obs = [o for o in observations if o.get('photo') and o.get('_importMarker')]
    if not photo_obs:
        return []

    total = len(photo_obs)
    if progress_cb:
        progress_cb({'phase': 'uploading-images', 'done': 0, 'total': total})

    if rows is None:
        rows = review_queue_rows(login_token, auth_cookie) or []

    failed = []
    for i, obs in enumerate(photo_obs):
        row = _find_row_for_marker(rows, obs['_importMarker'])
        if not row:
            logger.warning(f'[AO-HTTPX] Fant ikke gjennomgangsrad for bilde ({_obs_label(obs)}) — hopper over')
            failed.append(_obs_label(obs))
        else:
            try:
                image_bytes = _decode_data_url(obs['photo'])
                upload_image(row.get('SightingId'), image_bytes, 'bilde.jpg', login_token, auth_cookie)
            except Exception as e:
                logger.warning(f'[AO-HTTPX] Bildeopplasting feilet for {_obs_label(obs)}: {e}')
                failed.append(_obs_label(obs))
        if progress_cb:
            progress_cb({'phase': 'uploading-images', 'done': i + 1, 'total': total})

    return failed


def _resolve_temp_ids_for_publish(observations, rows):
    """
    Slå opp `TemporarySightingId` for hver observasjon via `_importMarker`.

    Brukes KUN når gjennomgangskøen hadde funn fra før denne importen startet (se
    post_with_curl) — da må publiseringen begrenses til nøyaktig denne batchen i stedet
    for å dra med andres ventende funn (`PublishAll` publiserer ellers hele køen). Se
    docs/ao-publish-selective-capture.md for hvordan AOs faktiske feltformat ble bekreftet.

    `TemporarySightingId` (ikke den permanente `SightingId`) er ID-typen
    `/PublishSighting/Publish` faktisk forventer.

    Umatchede observasjoner publiseres IKKE — fail-safe heller enn å gjette feil ID.

    Returnerer (temp_ids: list[str], unmatched_labels: list[str]).
    """
    temp_ids = []
    unmatched = []
    for obs in observations:
        marker = obs.get('_importMarker')
        row = _find_row_for_marker(rows, marker) if marker else None
        if row and row.get('TemporarySightingId') is not None:
            temp_ids.append(str(row['TemporarySightingId']))
        else:
            unmatched.append(_obs_label(obs))
    return temp_ids, unmatched


def _poll_until_zero(get_remaining, timeout=6.0, interval=1.0):
    """
    Generisk poll-løkke: kall `get_remaining()` til den returnerer 0/None, eller til
    tiden går ut. Delt av `_remaining_after_publish` og `_remaining_scoped` — eneste
    forskjell mellom dem er HVA som telles, ikke selve ventemønsteret.
    """
    deadline = time.time() + timeout
    remaining = None
    while time.time() < deadline:
        remaining = get_remaining()
        if remaining is None or remaining == 0:
            return remaining
        time.sleep(interval)
    return remaining


def _remaining_after_publish(login_token, auth_cookie, timeout=6.0, interval=1.0):
    """
    Antall observasjoner som fortsatt ligger i gjennomgangskøen etter publisering.

    AO publiserer ikke rader den underkjenner (typisk «Angi et tidspunkt som ikke er
    passert» ved tidspunkt frem i tid) — de blir liggende i køen. Uten denne sjekken
    meldte appen «sendt til AO!» selv om observasjonen aldri ble publisert.

    Kun gyldig når HELE køen er vår (ikke-scoped publisering) — se `_remaining_scoped`
    for varianten som brukes ved scoped publisering.

    Returnerer antall gjenværende, eller None hvis endepunktet ikke svarer.
    """
    return _poll_until_zero(
        lambda: number_of_sightings_submitted(login_token, auth_cookie), timeout, interval)


def _remaining_scoped(login_token, auth_cookie, temp_sighting_ids, timeout=6.0, interval=1.0):
    """
    Som `_remaining_after_publish`, men teller kun VÅRE `temp_sighting_ids` — ikke hele
    køen. Andres ventende funn kan fortsatt ligge der uten at VÅR publisering feilet.

    Returnerer antall av våre temp_sighting_ids som fortsatt ligger i køen (0 = alt gikk
    gjennom), eller None hvis køen ikke kunne leses.
    """
    wanted = {str(x) for x in temp_sighting_ids}

    def get_remaining():
        rows = review_queue_rows(login_token, auth_cookie)
        if rows is None:
            return None
        present = {str(r.get('TemporarySightingId')) for r in rows}
        return len(wanted & present)

    return _poll_until_zero(get_remaining, timeout, interval)


def _poll_importing_done(login_token, auth_cookie, total, progress_cb=None,
                         timeout=None, interval=0.7, expect_markers=None, queue_size=200):
    """
    Poll til AO BÅDE er ferdig med å parse (NumberOfSightingsImporting == 0) OG har
    faktisk lagt alle observasjonene inn i gjennomgangskøen, før publiseringen trigges.

    Hvordan «lagt inn i køen» avgjøres avhenger av modus:

    - `expect_markers=None` — køen var BEKREFTET tom før import (det vanlige tilfellet).
      Da er `NumberOfSightingsSubmitted >= total` direkte sammenlignbart, og den billige
      tellingen holder.
    - `expect_markers={...}` — scoped publisering: køen var ikke tom, ELLER vi fikk ikke
      svar på hvor full den var. Da kreves det at hver enkelt markør faktisk finnes igjen
      i gjennomgangskøen. Et absolutt tall duger ikke her: i «fikk ikke svar»-tilfellet
      vet vi ikke hvor mange fremmede rader som lå der fra før, og en terskel basert på
      en gjettet baseline (0) ville sluppet publiseringen gjennom for tidlig — nøyaktig
      racet denne gaten finnes for. Den tyngre grid-lesingen gjøres kun når den billige
      «importing»-telleren allerede melder ferdig.

    AOs "importing"-teller kan nå 0 i god tid FØR alle radene er skrevet til
    gjennomgangstabellen — en race i AOs egen backend, størst ved flere observasjoner.
    Å bare sjekke det første tallet (tidligere versjon) gjorde at "Publiser"-klikket kom
    for tidlig ved batcher på 5+ obs, og halen ble liggende igjen som "ikke publisert"
    uten at brukeren merket det før etterpå. Bekreftet i produksjonslogg 2026-09-27:
    6 innsendte obs, men kun 1 rukket inn i gjennomgangskøen på de 1,5 sekundene
    "importing"-telleren brukte på å nå 0 to ganger på rad.

    Tidsgrensen skaleres med antall observasjoner — større batcher tar reelt lengre
    tid hos AO. Faller tilbake til kort blind venting hvis BEGGE endepunkt er nede;
    hvis bare ett svarer, styres ferdig-vurderingen av det som faktisk svarer.
    """
    effective_timeout = timeout if timeout is not None else min(120.0, max(30.0, total * 1.5))
    deadline = time.time() + effective_timeout
    consecutive_ready = 0
    remaining = submitted = None
    while time.time() < deadline:
        remaining = number_of_sightings_importing(login_token, auth_cookie)
        submitted = number_of_sightings_submitted(login_token, auth_cookie)

        if remaining is None and submitted is None:
            # Begge endepunkt utilgjengelige — blind fallback, la publish-retry ta resten
            logger.debug('[AO-HTTPX] Progress-endepunkter svarte ikke — faller tilbake til venting')
            time.sleep(3)
            return

        if progress_cb and remaining is not None and remaining > 0:
            progress_cb({'phase': 'importing', 'remaining': remaining, 'total': total})

        importing_done = True if remaining is None else remaining == 0

        if expect_markers is None:
            queue_filled = True if submitted is None else submitted >= total
        elif not importing_done:
            # Ikke bruk den tunge grid-lesingen før den billige telleren melder ferdig
            queue_filled = False
        else:
            rows = review_queue_rows(login_token, auth_cookie, size=queue_size)
            if rows is None:
                queue_filled = False  # kunne ikke lese køen — vent, ikke gjett
            else:
                present = '\n'.join(r.get('PrivateCommentLong') or '' for r in rows)
                queue_filled = all(marker in present for marker in expect_markers)

        # Krev to påfølgende ferdig-avlesninger for å unngå å publisere før AO har startet
        if importing_done and queue_filled:
            consecutive_ready += 1
            if consecutive_ready >= 2:
                if progress_cb:
                    progress_cb({'phase': 'importing', 'remaining': 0, 'total': total})
                return
        else:
            consecutive_ready = 0
        time.sleep(interval)
    logger.warning(
        f'[AO-HTTPX] Poll-timeout nådd etter {effective_timeout:.0f}s ({total} obs, '
        f'siste avlesning: importing={remaining}, submitted={submitted}) — fortsetter til publisering'
    )


def post_with_curl(observations, login_token=None, auth_cookie=None, area_id='', progress_cb=None):
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

    # Lå det noe i gjennomgangskøen FØR denne importen (andre funn, ikke fra denne
    # sendingen)? Da må publiseringen etterpå begrenses til nøyaktig vår batch — ellers
    # publiserer PublishAll alt i køen, se docs/ao-publish-selective-capture.md og
    # brukerhenvendelsen som avdekket dette (02.10.2026). For de aller fleste er køen tom
    # her, og resten av funksjonen oppfører seg akkurat som før.
    #
    # Fail-safe-retning: svarer ikke endepunktet (None), VET vi ikke om køen var tom —
    # da må vi anta at den IKKE var det. Å anta «tom» i mangel på svar ville falt
    # tilbake til nøyaktig buggen denne fiksen skal unngå (publiserer fremmede, ventende
    # funn). Kun en BEKREFTET tom kø (0) slår av scoped publisering.
    pre_existing_count = number_of_sightings_submitted(login_token, auth_cookie)
    needs_scoped_publish = pre_existing_count != 0

    # Hvor mange rader må vi be AOs grid om for å se HELE køen (fremmede + vår batch)?
    # Er køstørrelsen ukjent (endepunktet svarte ikke), kan vi ikke regne oss fram til
    # den — da ber vi om et romslig vindu i stedet. Et for lite vindu ville gjort at
    # egne rader falt utenfor og feilaktig ble regnet som «ikke importert».
    if pre_existing_count is None:
        queue_size = _UNKNOWN_QUEUE_SIZE
    else:
        queue_size = max(200, pre_existing_count + len(observations) + 20)

    # Observasjoner får en unik markør i privat kommentar (kun synlig for reporter selv på
    # AO), slik at vi etterpå kan koble raden i gjennomgangskøen til riktig lokal
    # observasjon — se `_upload_pending_images`, `_resolve_temp_ids_for_publish` og
    # `docs/bilde-opplasting-plan.md`. Bilde-observasjoner får den uansett (trengs til
    # bildeopplasting); øvrige får den kun når scoped publisering faktisk trengs, slik at
    # det store flertallet av sendinger aldri får en markør i privat kommentar i det hele
    # tatt.
    for obs in observations:
        if obs.get('photo') or needs_scoped_publish:
            obs['_importMarker'] = f'#imp-{secrets.token_hex(4)}'

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
    logger.debug(f'[AO-HTTPX] ParseObservations URL etter redirect: {response.url}')
    logger.debug(f'[AO-HTTPX] ParseObservations respons (første 500 tegn): {response.text[:500]}')

    if response.status_code >= 400:
        logger.error(f'[AO-HTTPX] Feil: HTTP {response.status_code}')
        raise ValueError(f'HTTP {response.status_code}')

    # Steg 2: Vent på at AO er ferdig med å parse importen — poll ekte fremdrift.
    # Ved scoped publisering avgjøres «ferdig» av at våre egne markører faktisk finnes
    # igjen i køen, ikke av et absolutt tall — se `_poll_importing_done`.
    total = len(observations)
    if progress_cb:
        progress_cb({'phase': 'importing', 'remaining': total, 'total': total})
    expect_markers = (
        [obs['_importMarker'] for obs in observations if obs.get('_importMarker')]
        if needs_scoped_publish else None
    )
    _poll_importing_done(login_token, auth_cookie, total, progress_cb,
                         expect_markers=expect_markers, queue_size=queue_size)

    # Hent gjennomgangskøen ÉN gang — brukes til bildeopplasting og/eller
    # ID-oppslag for scoped publisering, avhengig av hva denne batchen trenger.
    rows = None
    if any(obs.get('_importMarker') for obs in observations):
        rows = review_queue_rows(login_token, auth_cookie, size=queue_size) or []

    # Steg 2b: last opp vedlagte bilder mens funnene ligger i gjennomgangskøen — det er
    # eneste vinduet AO tillater det (PossibleToUploadImages, docs/ao-bilder-api.md).
    # Best-effort: et bilde som feiler stopper aldri selve publiseringen.
    images_failed = _upload_pending_images(observations, login_token, auth_cookie, progress_cb, rows=rows)

    # Steg 2c: slå opp TemporarySightingId for hele batchen når publiseringen må
    # begrenses (se merknaden ved needs_scoped_publish over). Umatchede observasjoner
    # publiseres ikke — fail-safe heller enn å risikere å dra med andres ventende funn.
    temp_sighting_ids = None
    unmatched_for_publish = []
    if needs_scoped_publish:
        temp_sighting_ids, unmatched_for_publish = _resolve_temp_ids_for_publish(observations, rows or [])
        if not temp_sighting_ids:
            logger.error('[AO-HTTPX] Fant ingen av observasjonene igjen i gjennomgangskøen — avbryter uten å publisere')
            return {
                'success': False,
                'error': ('Fant ingen av observasjonene igjen i AOs gjennomgangskø etter import. '
                          'Avbryter publisering for å unngå å publisere andres ventende funn.'),
                'count': 0,
                'published': False,
                'refreshedAuthCookie': refreshed_auth
            }

    if progress_cb:
        progress_cb({'phase': 'publishing', 'total': total})

    # Steg 3: Publiser observasjonene (med retry)
    logger.info('[AO-HTTPX] Starter publisering...')
    last_error = None
    publish_result = None
    for attempt, delay in enumerate([0, 5, 10], start=1):
        if delay:
            logger.debug(f'[AO-HTTPX] Venter {delay} sekunder før forsøk {attempt}...')
            time.sleep(delay)
        # Scoped publisering: slå opp TemporarySightingId på nytt før hvert nytt forsøk
        # (ikke bare det første) — stabiliteten til denne ID-en over tid/flere forsøk er
        # ikke verifisert mot AO, se docs/ao-publish-selective-capture.md. Et forsøk som
        # gjenbruker en ID fra for 5-15 sekunder siden kan i verste fall treffe en rad
        # som ikke lenger finnes, uten at det gir et synlig unntak.
        if needs_scoped_publish and attempt > 1:
            fresh_rows = review_queue_rows(login_token, auth_cookie, size=queue_size) or []
            temp_sighting_ids, unmatched_for_publish = _resolve_temp_ids_for_publish(observations, fresh_rows)
            if not temp_sighting_ids:
                # Radene lå i køen før forrige forsøk, men er borte nå. Den klart mest
                # sannsynlige forklaringen er at forrige forsøk FAKTISK lyktes hos AO og
                # at unntaket traff på vei hjem (timeout på responsen e.l.) — ikke at
                # importen feilet. Å melde «feilet» her ville fått brukeren til å sende
                # på nytt og dermed duplisere funnet hos AO.
                logger.info(
                    f'[AO-HTTPX] Radene er borte fra gjennomgangskøen før forsøk {attempt} '
                    '— tolker forrige forsøk som vellykket publisering'
                )
                publish_result = {'status': 200}
                last_error = None
                break
        try:
            publish_result = publish_all(login_token, auth_cookie, temp_sighting_ids=temp_sighting_ids)
            logger.info(f'[AO-HTTPX] Publisering vellykket (forsøk {attempt}): {publish_result}')
            last_error = None
            break
        except Exception as e:
            last_error = e
            logger.warning(f'[AO-HTTPX] Publisering feilet (forsøk {attempt}): {e}')

    if last_error:
        return {
            'success': False,
            'error': f'Publisering feilet: {last_error}',
            'count': 0,
            'published': False,
            'refreshedAuthCookie': refreshed_auth
        }

    pending = publish_result.get('pending_count') if publish_result else None
    if pending == 0:
        logger.warning('[AO-HTTPX] AO hadde ingen observasjoner til publisering – import kan ha feilet')
        return {
            'success': False,
            'error': 'AO aksepterte ingen observasjoner. Importen kan være nede, eller lokaliteten/arten ble ikke gjenkjent.',
            'count': 0,
            'published': False,
            'refreshedAuthCookie': refreshed_auth
        }

    # Steg 4: Verifiser at køen faktisk ble tømt. Rader AO underkjenner blir liggende,
    # og da er «publisert» en løgn overfor brukeren. Scoped publisering må telle KUN
    # våre egne temp_sighting_ids — ellers rapporteres andres ventende funn feilaktig
    # som om VI mislyktes med å publisere dem (se docs/ao-publish-selective-capture.md).
    if temp_sighting_ids is not None:
        held_back = _remaining_scoped(login_token, auth_cookie, temp_sighting_ids)
    else:
        held_back = _remaining_after_publish(login_token, auth_cookie)

    published_count = len(observations) - len(unmatched_for_publish)
    result = {
        'success': True,
        'message': f'{published_count} observasjoner importert og publisert',
        'count': published_count,
        'published': True,
        'refreshedAuthCookie': refreshed_auth
    }
    if images_failed:
        result['imagesFailed'] = images_failed
    if unmatched_for_publish:
        result['notPublished'] = unmatched_for_publish
        result['message'] += (f' — {len(unmatched_for_publish)} kunne ikke identifiseres entydig i AOs '
                              'gjennomgangskø og ble ikke publisert (ligger fortsatt der)')
    if held_back:
        detaljer = _describe_held_back(login_token, auth_cookie, temp_sighting_ids=temp_sighting_ids)
        logger.warning(f'[AO-HTTPX] {held_back} observasjon(er) ble ikke publisert: {detaljer or "ukjent årsak"}')
        result['heldBack'] = held_back
        result['heldBackDetails'] = detaljer
        result['message'] = (f'{published_count} importert, men {held_back} ble ikke publisert '
                             '— de ligger til gjennomgang på AO')
    return result


def publish_all(login_token, auth_cookie, temp_sighting_ids=None):
    """
    Publiser observasjoner i gjennomgangskøen.

    `temp_sighting_ids=None` (standard): publiser ALT i køen —
    `POST /PublishSighting/PublishAll` med tom `SightingsToPublishIds`, uendret
    oppførsel fra før. Brukes når køen var tom før denne importen startet.

    `temp_sighting_ids=[...]` (ikke-tom liste av `TemporarySightingId`): publiser KUN
    disse radene — `POST /PublishSighting/Publish`. Bodyen er den SAMME som over, bare
    med `SightingsToPublishIds` fylt ut (kommaseparert). Brukt når køen hadde funn fra
    før, slik at PublishAll ikke skal dra med dem.

    Begge varianter er bekreftet mot ekte AO ved å lese `#PublishForm` direkte — den har
    nøyaktig fire felt, og `SightingsToPublishIds` er det eneste ID-feltet. Se
    docs/ao-publish-selective-capture.md.
    """
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
    logger.debug(f'[AO-HTTPX] ReviewSighting respons (første 500 tegn): {html[:500]}')

    # Tell antall observasjoner som venter på publisering
    pending_count = _count_review_rows(html)
    logger.info(f'[AO-HTTPX] Observasjoner til gjennomgang: {pending_count}')
    if pending_count is not None and pending_count == 0:
        raise ValueError('AO har ingen observasjoner til publisering – importen kan ha feilet')

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

    # Samme skjema (#PublishForm) i begge tilfeller — kun ID-feltet og URL-en skiller.
    # Tom ID-liste + /PublishAll = «publiser alt»; utfylt ID-liste + /Publish = «publiser valgte».
    encoded_ids = quote_plus(','.join(str(x) for x in temp_sighting_ids), safe='', encoding='utf-8') \
        if temp_sighting_ids else ''
    post_data = (
        f'__RequestVerificationToken={encoded_form_token}&'
        f'ReviewSightingViewModel.PublicationName=&'
        f'ReviewSightingViewModel.PublicationComment=&'
        f'ReviewSightingViewModel.SightingsToPublishIds={encoded_ids}'
    )
    publish_url = (
        'https://www.artsobservasjoner.no/PublishSighting/Publish' if temp_sighting_ids
        else 'https://www.artsobservasjoner.no/PublishSighting/PublishAll'
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
            publish_url,
            content=post_data,
            cookies=publish_cookies,
            headers=publish_headers,
            timeout=30,
            follow_redirects=True
        )

    logger.info(f'[AO-HTTPX] Publish HTTP Status: {response.status_code}')

    if response.status_code >= 400:
        raise ValueError(f'Publisering feilet: HTTP {response.status_code}')

    return {'status': response.status_code, 'pending_count': pending_count}
