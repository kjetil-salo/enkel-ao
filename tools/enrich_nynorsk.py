"""Beriker public/data/norske_arter.json med nynorske artsnavn.

Kilde: Artsdatabankens Artskart public API (ingen pålogging/nøkkel):
  https://artskart.artsdatabanken.no/publicapi/api/taxon

AO sitt eget søke-API støtter bare bokmål (verifisert manuelt 2026-09-30:
kun language=4 gir treff), så nynorsk må hentes fra en helt separat kilde.
Se docs/ for full mulighetsstudie.

Kjøres som engangs-script, lokalt, med ro på kallene (ETHICS: aldri
aggressiv load mot eksterne API-er, jf. CLAUDE.md).
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = ROOT / 'public' / 'data' / 'norske_arter.json'

API_URL = 'https://artskart.artsdatabanken.no/publicapi/api/taxon'
HEADERS = {'User-Agent': 'enkel-ao-nynorsk-enrichment (kjetil@vikebo.com), engangsjobb'}
SLEEP_S = 0.25
TAXON_GROUP_FUGLER = '8'

_cache = {}


def _query(term: str):
    if term in _cache:
        return _cache[term]
    q = urllib.parse.urlencode({'term': term, 'taxonGroups': TAXON_GROUP_FUGLER, 'take': 8})
    req = urllib.request.Request(f'{API_URL}?{q}', headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.load(resp)
    except Exception as e:
        print(f'  FEIL ved oppslag av "{term}": {e}')
        data = []
    _cache[term] = data
    time.sleep(SLEEP_S)
    return data


def _extract_nn(candidates, expected_scientific_name: str):
    """Finn beste nn-NO-treff blant kandidatene for et eksakt artsnavn."""
    # 1. forsøk eksakt match på ValidScientificName
    exact = [c for c in candidates if c.get('ValidScientificName', '').strip() == expected_scientific_name]
    pool = exact if exact else candidates
    for c in pool:
        for pn in c.get('PopularNames', []):
            if pn.get('language') == 'nn-NO' and pn.get('Preffered'):
                return pn['Name']
    # 2. fallback: ikke-eksakt match, men fortsatt riktig art (uten subsp.-suffiks-krasj)
    if not exact:
        for c in candidates:
            if c.get('ValidScientificName', '').strip().startswith(expected_scientific_name):
                for pn in c.get('PopularNames', []):
                    if pn.get('language') == 'nn-NO' and pn.get('Preffered'):
                        return pn['Name']
    return None


def _subspecies_full_latin(parent_latin: str, sub_latin: str) -> str | None:
    """'Oxyura jamaicensis' + 'O. j. jamaicensis' -> 'Oxyura jamaicensis jamaicensis'."""
    parent_parts = parent_latin.split()
    if len(parent_parts) < 2:
        return None
    genus, species = parent_parts[0], parent_parts[1]
    sub_parts = sub_latin.replace('.', '').split()
    if not sub_parts:
        return None
    epithet = sub_parts[-1]
    return f'{genus} {species} {epithet}'


def enrich():
    species_list = json.load(open(JSON_PATH, encoding='utf-8'))
    total_species = 0
    found_species = 0
    total_sub = 0
    found_sub = 0
    missing_species = []

    for art in species_list:
        latin = art.get('latin')
        if not latin or latin == 'Scientific name':
            continue  # feilrad/overskrift, ikke reell art
        total_species += 1
        candidates = _query(latin)
        nn = _extract_nn(candidates, latin)
        art['nynorsk'] = nn
        if nn:
            found_species += 1
        else:
            missing_species.append(f"{art.get('norwegian')} ({latin})")

        for sub in art.get('subspecies', []) or []:
            sub_latin_raw = sub.get('latin')
            if not sub_latin_raw:
                continue
            total_sub += 1
            full_latin = _subspecies_full_latin(latin, sub_latin_raw)
            sub_nn = None
            if full_latin:
                sub_candidates = _query(full_latin)
                # forventet ValidScientificName-format: "Genus species subsp. epithet"
                genus, species_word, epithet = full_latin.split()
                expected = f'{genus} {species_word} subsp. {epithet}'
                sub_nn = _extract_nn(sub_candidates, expected)
            sub['nynorsk'] = sub_nn
            if sub_nn:
                found_sub += 1

        if total_species % 100 == 0:
            print(f'... {total_species} arter behandlet ({found_species} med nynorsk)')

    json.dump(species_list, open(JSON_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    print()
    print(f'Arter:      {found_species}/{total_species} fikk nynorsk-navn')
    print(f'Underarter: {found_sub}/{total_sub} fikk nynorsk-navn')
    print(f'Lagret til {JSON_PATH}')
    if missing_species:
        print()
        print(f'Arter UTEN nynorsk-treff ({len(missing_species)}):')
        for m in missing_species[:50]:
            print(f'  - {m}')
        if len(missing_species) > 50:
            print(f'  ... og {len(missing_species) - 50} til')


if __name__ == '__main__':
    enrich()
