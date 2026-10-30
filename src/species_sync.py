"""
Synkroniseringsteneste for artsnamn (bokmål/nynorsk) og registreringstal (antallFunn).

Kjelder:
1. Artsobservasjoner.no (/ViewSighting/SearchSighting -> /ViewSighting/ViewSpeciesList):
   Hentar offisielle registreringstal (antallFunn) og takson-ID (taxonId) for alle
   rapporterte og rapporterbare fugleartar i Noreg (SpeciesGroup=8).
2. Artsdatabanken Artskart Public API (https://artskart.artsdatabanken.no/publicapi/api/taxon):
   Hentar offisielle norske artsnamn på både bokmål (nb-NO) og nynorsk (nn-NO).
"""

import json
import logging
import re
import time
from pathlib import Path
from urllib.parse import urlencode

import httpx

from src.ao_sightings import parse_search_form, _override, _HEADERS

logger = logging.getLogger('fugleobs')

ROOT_DIR = Path(__file__).resolve().parent.parent
SPECIES_JSON_PATH = ROOT_DIR / 'public' / 'data' / 'norske_arter.json'

AO_BASE_URL = 'https://www.artsobservasjoner.no'
ARTSKART_TAXON_API = 'https://artskart.artsdatabanken.no/publicapi/api/taxon'
TAXON_GROUP_BIRDS = '8'

# Initiell fallback-oppføring for rødstrupetrost / raudstrupetrast dersom den manglar
RODSTRUPETROST_SEED = {
    'id': 4560,
    'taxonId': 4560,
    'norwegian': 'rødstrupetrost',
    'nameNob': 'rødstrupetrost',
    'nynorsk': 'raudstrupetrast',
    'nameNno': 'raudstrupetrast',
    'latin': 'Turdus ruficollis',
    'latinName': 'Turdus ruficollis',
    'antallFunn': 0,
    'subspecies': [],
}


def parse_ao_species_list_html(html: str) -> list[dict]:
    """
    Parse HTML frå Artsobservasjoner sin ViewSpeciesList-side (<ul class="listofspecies">).

    Returnerer ei liste med dict per takson:
      {
        'id': int,
        'taxonId': int,
        'nameNob': str,
        'latinName': str,
        'antallFunn': int,
        'isChild': bool
      }
    """
    if not html:
        return []

    taxon_blocks = re.findall(r'<li\s+class="taxon"[^>]*>(.*?)</li>', html, re.DOTALL)
    results = []

    for block in taxon_blocks:
        cnt_match = re.search(
            r'<span class="sightingscount">\s*<a[^>]*>\s*([\d\s\xa0]+)\s*</a>\s*</span>',
            block,
            re.DOTALL,
        )
        if not cnt_match:
            cnt_match = re.search(
                r'<span class="sightingcount"[^>]*data-value="(\d+)"',
                block,
                re.DOTALL,
            )
        if not cnt_match:
            continue

        raw_cnt = re.sub(r'\D', '', cnt_match.group(1))
        if not raw_cnt:
            continue
        antall_funn = int(raw_cnt)

        spans = re.findall(
            r'<span\s+data-taxonid="(\d+)"([^>]*)>\s*<b>([^<]+)</b>(?:&nbsp;|\s*)(?:<i>([^<]+)</i>)?',
            block,
        )
        if spans:
            taxon_id_str, attrs, nob_raw, latin_raw = spans[-1]
            taxon_id = int(taxon_id_str)
            is_child = 'childtaxa' in (attrs or '')
            name_nob = (nob_raw or '').strip()
            latin_name = (latin_raw or '').strip()
        else:
            nob_m = re.search(r'<span class="speciesname">([^<]+)</span>', block)
            lat_m = re.search(r'<span class="scientific">([^<]+)</span>', block)
            id_m = re.search(r'viewSightingsByTaxonIds\((\d+)\)', block)
            if not (nob_m and id_m):
                continue
            taxon_id = int(id_m.group(1))
            is_child = False
            name_nob = nob_m.group(1).strip()
            latin_name = lat_m.group(1).strip() if lat_m else ''

        if not name_nob:
            continue

        results.append({
            'id': taxon_id,
            'taxonId': taxon_id,
            'nameNob': name_nob,
            'latinName': latin_name,
            'antallFunn': antall_funn,
            'isChild': is_child,
        })

    return results


logging.getLogger('httpx').setLevel(logging.WARNING)
logging.getLogger('httpcore').setLevel(logging.WARNING)


def fetch_ao_species_counts(
    ao_base_url: str = AO_BASE_URL,
    stored_search_url: str | None = None,
    include_unreported: bool = True,
    timeout: float = 25.0,
) -> list[dict]:
    """
    Hent artsliste med antallFunn frå Artsobservasjoner.

    Merk: `storedSearchCriterias=<id>` hos Artsobservasjoner er sesjonsbunden på serveren
    deira og returnerer HTTP 500 ved direkte GET i ei ny HTTP-økt. Dersom `stored_search_url`
    peikar på AO sin standard `ViewSpeciesList?storedSearchCriterias=...`, opprettar vi difor
    direkte eit nytt søk via `/ViewSighting/SearchSighting` -> `/ViewSighting/ViewSpeciesList`
    for fuglar (SpeciesGroup=8). Dersom ein tilpassa/ekstern URL (f.eks. lokal testserver)
    er oppgitt utan standard AO-vert, vert den forsøkt først.
    """
    with httpx.Client(cookies={'AcceptCookies': '1'}, follow_redirects=True, timeout=timeout) as client:
        html = ''

        if stored_search_url:
            clean_url = stored_search_url.split('#')[0]
            is_session_bound_ao_url = (
                'artsobservasjoner.no' in clean_url.lower()
                and 'storedsearchcriterias=' in clean_url.lower()
            )
            if not is_session_bound_ao_url:
                try:
                    direct_resp = client.get(clean_url, headers=_HEADERS)
                    if direct_resp.status_code == 200 and '<li class="taxon"' in direct_resp.text:
                        html = direct_resp.text
                except Exception as e:
                    logger.debug(f'[SPECIES-SYNC] Direkte oppslag mot {clean_url} feila, opprettar nytt søk: {e}')

        if not html:
            search_resp = client.get(f'{ao_base_url}/ViewSighting/SearchSighting', headers=_HEADERS)
            search_resp.raise_for_status()
            fields = parse_search_form(search_resp.text)
            if not fields:
                raise ValueError('Kunne ikkje lese søkeskjema frå Artsobservasjoner')

            fields = _override(fields, {
                'SearchViewModel.StoredSearchCriterias.SearchCriterias.SpeciesGroup': TAXON_GROUP_BIRDS,
            })

            post_resp = client.post(
                f'{ao_base_url}/ViewSighting/ViewSpeciesList',
                content=urlencode(fields, encoding='utf-8'),
                headers={**_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'},
            )
            post_resp.raise_for_status()
            html = post_resp.text

            if include_unreported:
                tok_m = re.search(
                    r'name="__RequestVerificationToken" type="hidden" value="([^"]+)"',
                    html,
                )
                sc_m = re.search(
                    r'name="SearchViewModel\.StoredSearchCriterias\.Id" type="hidden" value="(\d+)"',
                    html,
                )
                if tok_m and sc_m:
                    unrep_resp = client.post(
                        str(post_resp.url),
                        data={
                            '__RequestVerificationToken': tok_m.group(1),
                            'SearchViewModel.ResetCriteriaLabel': '',
                            'SearchViewModel.StoredSearchCriterias.Id': sc_m.group(1),
                            'SearchViewModel.ShowSubspecies': 'true',
                            'SearchViewModel.ExcludeHybrids': 'false',
                            'SearchViewModel.ShowUnreportedSpecies': 'true',
                        },
                        headers={**_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'},
                    )
                    if unrep_resp.status_code == 200 and '<li class="taxon"' in unrep_resp.text:
                        html = unrep_resp.text

        return parse_ao_species_list_html(html)


def fetch_artsdatabanken_names(term: str, timeout: float = 10.0) -> dict | None:
    """
    Slå opp offisielle artsnamn på bokmål (nb-NO) og nynorsk (nn-NO) frå Artsdatabanken sitt API.

    Returnerer dict:
      {
        'taxonId': int | None,
        'latinName': str,
        'nameNob': str | None,
        'nameNno': str | None
      }
    """
    q = (term or '').strip()
    if not q:
        return None

    params = {'term': q, 'taxonGroups': TAXON_GROUP_BIRDS, 'take': 8}
    url = f'{ARTSKART_TAXON_API}?{urlencode(params)}'
    headers = {'User-Agent': 'Enkel-AO/1.0 (artsnavn-synkronisering)'}

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url, headers=headers)
            resp.raise_for_status()
            candidates = resp.json()
    except Exception as e:
        logger.warning(f'[SPECIES-SYNC] Artsdatabanken-oppslag feila for "{q}": {e}')
        return None

    if not isinstance(candidates, list) or not candidates:
        return None

    q_lower = q.lower()
    exact = [
        c for c in candidates
        if (c.get('ValidScientificName') or '').strip().lower() == q_lower
        or (c.get('PrefferedPopularname') or c.get('PreferredPopularname') or '').strip().lower() == q_lower
    ]
    chosen = exact[0] if exact else candidates[0]

    name_nob = None
    name_nno = None
    for pn in chosen.get('PopularNames') or []:
        lang = (pn.get('language') or '').lower()
        is_pref = bool(pn.get('Preffered') or pn.get('Preferred'))
        if lang == 'nb-no' and is_pref and not name_nob:
            name_nob = pn.get('Name')
        elif lang == 'nn-no' and is_pref and not name_nno:
            name_nno = pn.get('Name')

    if not name_nob and (chosen.get('PrefferedPopularname') or chosen.get('PreferredPopularname')):
        name_nob = chosen.get('PrefferedPopularname') or chosen.get('PreferredPopularname')

    return {
        'taxonId': chosen.get('ValidScientificNameId') or chosen.get('TaxonId'),
        'latinName': (chosen.get('ValidScientificName') or '').strip(),
        'nameNob': name_nob,
        'nameNno': name_nno,
    }


def _translate_dedicated_sub_to_nno(sub_nob: str, parent_nob: str = '', parent_nno: str = '') -> str:
    """
    Omset bokmålsord/ledd i eit dedikert underartsnamn til nynorsk
    (t.d. "sørlig gulerle" -> "sørleg gulerle", "svartryggerle" -> "svartryggerle").
    """
    res = (sub_nob or '').strip()
    if not res:
        return ''

    p_nob = (parent_nob or '').strip()
    p_nno = (parent_nno or '').strip()
    if p_nob and p_nno and p_nob.lower() != p_nno.lower():
        pattern = re.compile(re.escape(p_nob), re.IGNORECASE)

        def _repl_parent(m):
            orig = m.group(0)
            if orig[0].isupper():
                return p_nno[0].upper() + p_nno[1:]
            return p_nno

        res = pattern.sub(_repl_parent, res)

    special_replacements = [
        (r'\bub-?\s*gul-/østgulerle\b', 'ub- gul-/austgulerle'),
        (r'\bgul-/østgulerle\b', 'gul-/austgulerle'),
        (r'\bøstgulerle\b', 'austgulerle'),
        (r'\bøstempid\b', 'austempid'),
    ]
    for pat, target in special_replacements:
        def _repl_special(m, t=target):
            orig = m.group(0)
            if orig[0].isupper():
                return t[0].upper() + t[1:]
            return t

        res = re.sub(pat, _repl_special, res, flags=re.IGNORECASE)

    replacements = [
        (r'\bsørlig\b', 'sørleg'),
        (r'\bnordlig\b', 'nordleg'),
        (r'\bøstlig\b', 'austleg'),
        (r'\bvestlig\b', 'vestleg'),
        (r'\bsvarthodet\b', 'svarthovuda'),
        (r'\bsvartbuket\b', 'svartbuka'),
        (r'\bmørkbuket\b', 'mørkbuka'),
        (r'\blysbuket\b', 'lysbuka'),
        (r'\bmørkbrystet\b', 'mørkbrysta'),
        (r'svarthode', 'svarthovud'),
        (r'gråhode', 'gråhovud'),
        (r'brunhode', 'brunhovud'),
        (r'rød', 'raud'),
        (r'måke', 'måse'),
        (r'sanger', 'songar'),
        (r'varsler', 'varslar'),
        (r'trost', 'trast'),
        (r'spurv', 'sporv'),
        (r'\bbro-/', 'bru-/'),
        (r'gulnese-', 'gulnase-'),
    ]
    for pat, target in replacements:
        def _repl(m, t=target):
            orig = m.group(0)
            if orig[0].isupper():
                return t[0].upper() + t[1:]
            return t

        res = re.sub(pat, _repl, res, flags=re.IGNORECASE)

    return res


def merge_species_counts_and_names(
    species_list: list[dict],
    ao_counts: list[dict],
    adb_updates: dict[str, dict] | None = None,
) -> tuple[list[dict], int]:
    """
    Slå saman eksisterande artsliste med nye registreringstal (antallFunn) og takson-ID frå AO,
    samt eventuelle namneoppdateringar frå Artsdatabanken.

    Returnerer (oppdatert_liste, antall_oppdaterte_artar).
    """
    by_latin_main = {}
    by_nob_main = {}
    by_nob_any = {}

    for row in ao_counts or []:
        tid = row.get('taxonId') or row.get('id')
        cnt = row.get('antallFunn', 0)
        nob_clean = (row.get('nameNob') or '').strip().lower()
        latin_clean = (row.get('latinName') or '').strip().lower()
        is_child = bool(row.get('isChild'))

        if nob_clean:
            by_nob_any[nob_clean] = (tid, cnt, row.get('latinName') or '')
        if not is_child:
            if latin_clean:
                by_latin_main[latin_clean] = (tid, cnt, row.get('nameNob') or '')
            if nob_clean:
                by_nob_main[nob_clean] = (tid, cnt, row.get('latinName') or '')

    adb_updates = adb_updates or {}
    updated_count = 0

    for art in species_list:
        lat = (art.get('latin') or art.get('latinName') or '').strip()
        nob = (art.get('norwegian') or art.get('nameNob') or '').strip()
        nno = art.get('nynorsk') or art.get('nameNno') or None

        lat_lower = lat.lower()
        nob_lower = nob.lower()

        adb_hit = adb_updates.get(lat_lower) or adb_updates.get(nob_lower)
        if adb_hit:
            if adb_hit.get('nameNob') and adb_hit['nameNob'] != 'nan':
                nob = adb_hit['nameNob']
                art['norwegian'] = nob
            if adb_hit.get('nameNno'):
                nno = adb_hit['nameNno']
                art['nynorsk'] = nno
            if adb_hit.get('taxonId') and not art.get('taxonId'):
                art['id'] = int(adb_hit['taxonId'])
                art['taxonId'] = int(adb_hit['taxonId'])

        hit = by_latin_main.get(lat_lower) or by_nob_main.get(nob_lower) or by_nob_any.get(nob_lower)
        if hit:
            tid, cnt, _ = hit
            if tid:
                art['id'] = tid
                art['taxonId'] = tid
            art['antallFunn'] = cnt
            updated_count += 1
        else:
            art['id'] = art.get('id') or art.get('taxonId') or None
            art['taxonId'] = art.get('taxonId') or art.get('id') or None
            art['antallFunn'] = int(art.get('antallFunn') or 0)

        if not nno and nob and nob != 'nan':
            trans = _translate_dedicated_sub_to_nno(nob)
            if trans and trans.lower() != nob.lower():
                nno = trans
                art['nynorsk'] = nno

        art['nameNob'] = nob if nob != 'nan' else ''
        art['nameNno'] = nno
        art['latinName'] = lat

        parent_id = art.get('id') or art.get('taxonId')
        latin_parts = lat.split()

        for sub in art.get('subspecies') or []:
            sub['parentId'] = parent_id
            sub['isSub'] = True
            sub_nob = (sub.get('norwegian') or sub.get('nameNob') or '').strip()
            sub_lat = (sub.get('latin') or sub.get('latinName') or '').strip()
            sub_words = [w.strip('.') for w in sub_lat.split() if w.strip('.')]
            epithet = sub_words[-1].lower() if sub_words else ''

            if len(latin_parts) >= 2 and epithet:
                full_sub_latin = f'{latin_parts[0]} {latin_parts[1]} {epithet}'
            else:
                full_sub_latin = sub_lat

            sub_hit = (
                by_nob_any.get(sub_nob.lower())
                if sub_nob and sub_nob != 'nan'
                else None
            ) or (
                by_nob_any.get(f'{nob_lower}, underarten {epithet}')
                if nob_lower and epithet
                else None
            )
            if sub_hit:
                s_tid, s_cnt, _ = sub_hit
                if s_tid:
                    sub['id'] = s_tid
                    sub['taxonId'] = s_tid
                sub['antallFunn'] = s_cnt
            else:
                sub['antallFunn'] = int(sub.get('antallFunn') or 0)

            is_generic = (
                not sub_nob
                or sub_nob.lower() == 'nan'
                or sub_nob.lower() == nob_lower
                or ', underarten ' in sub_nob.lower()
                or 'nominat-' in sub_nob.lower()
                or 'ssp.' in sub_nob.lower()
                or 'subsp.' in sub_nob.lower()
            )

            if is_generic:
                sub['nameNob'] = f'{nob}, underarten {epithet}' if (nob and epithet) else nob
                if nno and epithet:
                    sub_nno = f'{nno}, underarten {epithet}'
                elif nob and epithet:
                    sub_nno = f'{nob}, underarten {epithet}'
                else:
                    sub_nno = nno or nob or None
            else:
                sub['nameNob'] = sub_nob
                sub_nno = _translate_dedicated_sub_to_nno(sub_nob, nob, nno or '')

            sub['nameNno'] = sub_nno
            sub['nynorsk'] = sub_nno
            sub['latinName'] = full_sub_latin

    # Sikre at rødstrupetrost / raudstrupetrast alltid er til stades i databasen
    has_rodstrupetrost = any(
        (a.get('norwegian') or a.get('nameNob') or '').strip().lower() == 'rødstrupetrost'
        or (a.get('latin') or a.get('latinName') or '').strip().lower() == 'turdus ruficollis'
        for a in species_list
    )
    if not has_rodstrupetrost:
        seed_copy = dict(RODSTRUPETROST_SEED)
        hit = by_latin_main.get('turdus ruficollis') or by_nob_main.get('rødstrupetrost')
        if hit:
            seed_copy['id'] = hit[0]
            seed_copy['taxonId'] = hit[0]
            seed_copy['antallFunn'] = hit[1]
        species_list.append(seed_copy)

    return species_list, updated_count


def sync_species_data(
    json_path: Path = SPECIES_JSON_PATH,
    stored_search_url: str | None = None,
    enrich_missing_nynorsk: bool = False,
    max_adb_lookups: int = 10,
    save_to_disk: bool = True,
) -> dict:
    """
    Full synkronisering av artsnamn og antallFunn.

    1. Les lokal artsdatabase (norske_arter.json).
    2. Hentar ferske registreringstal (antallFunn) og takson-ID frå Artsobservasjoner.
    3. Oppdaterer eventuelt manglande nynorsknamn frå Artsdatabanken sitt API.
    4. Lagrar oppdatert artsdatabase og returnerer samandrag + kompakt synkroniseringspakke.
    """
    if json_path.exists():
        species_list = json.loads(json_path.read_text(encoding='utf-8'))
    else:
        species_list = []

    ao_counts = fetch_ao_species_counts(stored_search_url=stored_search_url)

    adb_updates = {}
    if enrich_missing_nynorsk:
        lookups = 0
        for art in species_list:
            if lookups >= max_adb_lookups:
                break
            if not (art.get('nynorsk') or art.get('nameNno')):
                latin = (art.get('latin') or art.get('latinName') or '').strip()
                if latin:
                    adb_info = fetch_artsdatabanken_names(latin)
                    lookups += 1
                    if adb_info:
                        adb_updates[latin.lower()] = adb_info

    updated_list, updated_count = merge_species_counts_and_names(
        species_list,
        ao_counts,
        adb_updates=adb_updates,
    )

    if save_to_disk and json_path:
        json_path.write_text(
            json.dumps(updated_list, ensure_ascii=False, indent=2),
            encoding='utf-8',
        )

    # Bygg kompakt oppslagstabell for rask localStorage-synk i nettlesaren
    overrides = {}
    for art in updated_list:
        key = (art.get('latin') or art.get('latinName') or art.get('norwegian') or '').strip().lower()
        if not key:
            continue
        overrides[key] = {
            'id': art.get('id'),
            'taxonId': art.get('taxonId'),
            'nameNob': art.get('nameNob') or art.get('norwegian'),
            'nameNno': art.get('nameNno') or art.get('nynorsk'),
            'latinName': art.get('latinName') or art.get('latin'),
            'antallFunn': art.get('antallFunn', 0),
        }

    return {
        'ok': True,
        'success': True,
        'updatedCount': updated_count,
        'namesUpdated': len(adb_updates),
        'totalSpecies': len(updated_list),
        'aoFetchedCount': len(ao_counts),
        'timestamp': int(time.time()),
        'overrides': overrides,
    }

