"""
Henter brukerens egne arts-tall fra Artsobservasjoner — antall arter totalt
og i inneværende år, slik «Mine lister»-boksen på /User/MyPages viser dem.

Mekanismen er AOs egen lille AJAX-JSON-API, verifisert 20.11.2026 ved å lese
nettverkstrafikken i en ekte, innlogget nettleser (manuell inspeksjon — ingen
automatisert kall mot AO ble gjort med noen reell brukerkonto):

    GET  /User/MyPages          → __RequestVerificationToken (skjemaverdi,
                                   cookie-motparten settes automatisk på
                                   klienten av samme GET)
    POST /Lists/ShortOverview   → ren JSON:
        {"overviewListTotal": [{"SpeciesGroup": {"Id": 8, ...}, "Count": 337}, ...],
         "overviewListYear":  [samme form, kun inneværende år]}

Mye enklere enn søkeskjema-rundturen `species_sync.fetch_ao_species_counts()`
bruker (den er dessuten uinnlogget og henter DERFOR hele Norges tall, ikke
brukerens egne). Cookies MÅ settes på httpx-KLIENTEN, ikke per request — se
samme gotcha i ao_sightings.py/CLAUDE.md: AO sender antiforgery-cookien med
GET-svaret, og den må følge med på det påfølgende POST-et.

Appen er fugle-fokusert — vi plukker derfor kun ut Fugler (SpeciesGroup.Id,
samme verdi som TAXON_GROUP_BIRDS i species_sync.py). De andre taksongruppene
i JSON-svaret (Pattedyr m.fl.) ignoreres bevisst denne runden, planlagt tatt
med i en senere versjon.
"""

import logging
import re

import httpx

logger = logging.getLogger('fugleobs')

AO_BASE = 'https://www.artsobservasjoner.no'
_FUGLER_SPECIES_GROUP_ID = 8

_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
}

_TOKEN_RE = re.compile(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"')


def _cookies(login_token, auth_cookie):
    return {
        'AcceptCookies': '1',
        'logintoken': login_token,
        '.ASPXAUTHNO': auth_cookie,
    }


def _finn_fugler_antall(liste):
    """
    `liste` er en av de to listene i et ALLEREDE vellykket ShortOverview-svar —
    mangler Fugler-raden der, har brukeren reelt sett 0 artsfunn i perioden,
    ikke «ukjent». Se `hent_mine_artstall()` for hvor selve «ukjent»-sjekken
    (uventet svarform) ligger.
    """
    for rad in liste:
        gruppe = rad.get('SpeciesGroup') or {}
        if gruppe.get('Id') == _FUGLER_SPECIES_GROUP_ID:
            try:
                return int(rad.get('Count') or 0)
            except (TypeError, ValueError):
                return None
    return 0


def hent_mine_artstall(login_token, auth_cookie, timeout=15):
    """
    Returnerer `{'fuglerTotalt': int, 'fuglerIAr': int}`.

    Ved feil, uinnlogget sesjon eller uforståelig AO-svar: `None` — kalleren
    (server.py) tolker dette som «vet ikke» og svarer degradert, aldri 500.
    """
    try:
        with httpx.Client(cookies=_cookies(login_token, auth_cookie), timeout=timeout) as client:
            side = client.get(f'{AO_BASE}/User/MyPages', headers=_HEADERS, follow_redirects=True)
            if '/LogOn' in str(side.url):
                logger.debug('[ARTSTALL] Sesjon utløpt (redirect til /LogOn)')
                return None

            treff = _TOKEN_RE.search(side.text)
            if not treff:
                logger.warning('[ARTSTALL] Fant ikke __RequestVerificationToken på /User/MyPages')
                return None
            token = treff.group(1)

            resp = client.post(
                f'{AO_BASE}/Lists/ShortOverview',
                data={'__RequestVerificationToken': token},
                headers={
                    **_HEADERS,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                },
            )
            if resp.status_code != 200:
                logger.warning(f'[ARTSTALL] ShortOverview svarte {resp.status_code}')
                return None
            data = resp.json()
    except Exception as e:
        logger.error(f'[ARTSTALL] Feil ved henting: {e}')
        return None

    total_liste = data.get('overviewListTotal')
    ar_liste = data.get('overviewListYear')
    if total_liste is None or ar_liste is None:
        # Nøklene mangler helt — AO har endret svarformen, ikke bare «ingen
        # Fugler i år». Et reelt svar har alltid begge, selv som tomme lister.
        logger.warning('[ARTSTALL] Uventet form på ShortOverview-svaret')
        return None

    return {
        'fuglerTotalt': _finn_fugler_antall(total_liste),
        'fuglerIAr': _finn_fugler_antall(ar_liste),
    }
