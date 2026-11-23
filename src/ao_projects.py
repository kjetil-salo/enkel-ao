"""
Slår opp prosjekter på Artsobservasjoner — for prosjektvelgeren i detaljvinduet.

Samme to kall AOs egen prosjektvelger på /ImportSighting gjør, kartlagt i en
innlogget nettleser 23.11.2026 (kun lesing):

    GET /SimplePicker/RenderUserProjects?parentId=0&onlyReportable=false&dontIncludeSubSpecies=true
        → brukerens egne prosjekter («Mine prosjekt» i velgeren)
    GET /SimplePicker/SearchUserProject?search=<tekst>&returnformat=html&onlyReportable=false&dontIncludeSubSpecies=true
        → fritekstsøk i alle prosjekter brukeren kan rapportere til

Begge svarer HTML, der hvert treff har en
`<span class="itemjson">{"name":"…","id":"…"}</span>`. Vi leser kun de
spennene. `returnformat=json` gir også HTML, så det finnes ingen ren JSON-variant.

Brukerens egne prosjekter vises øverst og merkes `mine: True`. Se docs/ao-prosjekt.md.

NB: begge svarer 200 med tom liste også når sesjonen er utløpt. Det oppdages med
`_er_innlogget()`, se der.
"""

import html
import json
import logging
import re

import httpx

logger = logging.getLogger('fugleobs')

AO_BASE = 'https://www.artsobservasjoner.no'

_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
    'X-Requested-With': 'XMLHttpRequest',
}

_ITEMJSON_RE = re.compile(r'<span class="itemjson">([^<]*)</span>')

MAKS_TREFF = 20
MAKS_SOKELENGDE = 60


def _cookies(login_token, auth_cookie):
    return {
        'AcceptCookies': '1',
        'logintoken': login_token,
        '.ASPXAUTHNO': auth_cookie,
    }


def _er_innlogget(client):
    """Er sesjonen faktisk innlogget? Kun brukt når «Mine prosjekt» kom tomt tilbake.

    SimplePicker-kallene svarer 200 med tom liste også for en utløpt sesjon, så
    «ingen egne prosjekter» og «ikke innlogget» ser helt like ut derfra. Siden
    «Mine prosjekter» (/Project) sender derimot uinnloggede videre til /LogOn.
    """
    svar = client.get(f'{AO_BASE}/Project')
    return svar.status_code == 200


def les_prosjekter(side):
    """Trekk ut [{'id', 'name'}] fra et SimplePicker-svar. Ugyldige treff hoppes over."""
    prosjekter = []
    for rå in _ITEMJSON_RE.findall(side or ''):
        try:
            data = json.loads(html.unescape(rå))
        except ValueError:
            continue
        pid = str(data.get('id') or '').strip()
        navn = str(data.get('name') or '').strip()
        # Kategori-nodene i treet har id 0..22 og ingen egen side — de er ikke prosjekter,
        # men de dukker bare opp i RenderProjectCategories, som vi ikke kaller.
        if pid.isdigit() and navn:
            prosjekter.append({'id': pid, 'name': navn})
    return prosjekter


def hent_prosjekter(login_token, auth_cookie, sok='', timeout=15):
    """
    Returnerer `{'projects': [{'id', 'name', 'mine'}], 'needsLogin': bool}`.

    Tomt søk gir bare brukerens egne prosjekter. Med søk kommer egne treff først,
    så resten. Ved feil gis en tom liste, aldri et unntak (ekstern-API-konvensjonen).
    """
    sok = (sok or '').strip()[:MAKS_SOKELENGDE]
    try:
        with httpx.Client(cookies=_cookies(login_token, auth_cookie), timeout=timeout,
                          headers=_HEADERS) as client:
            svar = client.get(f'{AO_BASE}/SimplePicker/RenderUserProjects', params={
                'parentId': '0', 'onlyReportable': 'false', 'dontIncludeSubSpecies': 'true',
            })
            # Uinnlogget gir AO en 302 til /LogOn (redirects følges ikke)
            if svar.status_code in (301, 302):
                return {'projects': [], 'needsLogin': True}
            if svar.status_code != 200:
                return {'projects': [], 'needsLogin': False}
            mine = les_prosjekter(svar.text)
            if not mine and not _er_innlogget(client):
                return {'projects': [], 'needsLogin': True}

            treff = []
            if sok:
                svar = client.get(f'{AO_BASE}/SimplePicker/SearchUserProject', params={
                    'search': sok, 'returnformat': 'html',
                    'onlyReportable': 'false', 'dontIncludeSubSpecies': 'true',
                })
                if svar.status_code == 200:
                    treff = les_prosjekter(svar.text)
    except httpx.HTTPError as e:
        logger.warning('[AO-PROSJEKT] Oppslag feilet: %s', type(e).__name__)
        return {'projects': [], 'needsLogin': False}

    mine_ider = {p['id'] for p in mine}
    if sok:
        sok_lav = sok.lower()
        egne = [p for p in mine if sok_lav in p['name'].lower()]
    else:
        egne = mine
    resultat = [{**p, 'mine': True} for p in egne]
    resultat += [{**p, 'mine': False} for p in treff if p['id'] not in mine_ider]
    return {'projects': resultat[:MAKS_TREFF], 'needsLogin': False}
