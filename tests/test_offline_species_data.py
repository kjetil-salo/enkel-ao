"""Datakvalitetssjekker for public/data/norske_arter.json.

Regresjonsvern mot to konkrete feil funnet i felt 2026-09-30:
- Slekts-/familienivå-rader uten reelt artsnavn (norwegian == "nan" eller
  ettordslatin) blandet inn blant de reelle artene.
- Duplikate (norsk navn, latinsk navn)-par fra en eldre genereringsprosess,
  som ga synlige dobbeltoppføringer i artssøket.
"""
import json
from collections import Counter
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parent.parent / 'public' / 'data' / 'norske_arter.json'


def _load():
    return json.loads(DATA_PATH.read_text(encoding='utf-8'))


def test_no_duplicate_species():
    species = _load()
    pairs = [(s.get('norwegian'), s.get('latin')) for s in species]
    counts = Counter(pairs)
    duplicates = {k: v for k, v in counts.items() if v > 1}
    assert not duplicates, f'Duplikate (norsk, latin)-par funnet: {duplicates}'


def test_no_nameless_taxonomic_group_rows():
    species = _load()
    for s in species:
        latin = s.get('latin', '')
        assert len(latin.split()) >= 2, f'Ettordslatin (slekt/familie, ikke art): {s}'
    assert all(s.get('norwegian') != 'nan' for s in species), 'Rad uten reelt artsnavn (norwegian=="nan") funnet'


def test_nynorsk_field_present_and_reasonable_coverage():
    species = _load()
    with_nynorsk = sum(1 for s in species if s.get('nynorsk'))
    coverage = with_nynorsk / len(species)
    assert coverage > 0.7, f'Uventet lav nynorsk-dekning: {coverage:.0%} ({with_nynorsk}/{len(species)})'


def test_extended_data_model_fields_and_antall_funn():
    species = _load()
    for s in species:
        assert 'antallFunn' in s and isinstance(s['antallFunn'], int) and s['antallFunn'] >= 0, (
            f'Mangler gyldig antallFunn på {s}'
        )
        assert s.get('nameNob') == s.get('norwegian'), f'nameNob samsvarer ikke med norwegian: {s}'
        assert s.get('latinName') == s.get('latin'), f'latinName samsvarer ikke med latin: {s}'
        assert 'nameNno' in s, f'Mangler nameNno-felt: {s}'

    by_latin = {s['latin'].lower(): s for s in species}
    # Sjekk at rødstrupetrost / raudstrupetrast ligger i seed-data
    assert 'turdus ruficollis' in by_latin, 'rødstrupetrost (Turdus ruficollis) mangler i norske_arter.json'
    ruficollis = by_latin['turdus ruficollis']
    assert ruficollis['norwegian'] == 'rødstrupetrost'
    assert ruficollis['nameNob'] == 'rødstrupetrost'
    assert ruficollis['nynorsk'] == 'raudstrupetrast'
    assert ruficollis['nameNno'] == 'raudstrupetrast'
    assert ruficollis.get('taxonId') == 4560

    # Sjekk at vanlige arter har vesentlig høyere antallFunn enn sjeldne arter
    assert by_latin['erithacus rubecula']['antallFunn'] > 100000  # rødstrupe / raudstrupe
    assert by_latin['sturnus vulgaris']['antallFunn'] > 100000    # stær / stare
    assert by_latin['tringa totanus']['antallFunn'] > 50000       # rødstilk / raudstilk
    assert by_latin['sterna paradisaea']['antallFunn'] > 10000    # rødnebbterne / raudnebbterne
    assert by_latin['tringa totanus']['antallFunn'] > by_latin['branta ruficollis']['antallFunn']
    assert by_latin['branta ruficollis']['antallFunn'] > by_latin['calidris ruficollis']['antallFunn']

    # Sjekk at underarter er relasjonelt knyttet via parentId og har nynorske visningsnavn
    iliacus = by_latin['turdus iliacus']
    assert iliacus['id'] == 4547
    assert iliacus['nameNno'] == 'raudvengtrast'
    subspecies = iliacus.get('subspecies', [])
    assert len(subspecies) >= 2
    for sub in subspecies:
        assert sub.get('parentId') == iliacus['id']
        assert sub.get('isSub') is True
        assert sub.get('nameNno') and 'raudvengtrast, underarten ' in sub['nameNno']
        assert 'nominat-' not in sub['nameNno']
        assert sub.get('nameNob') and 'rødvingetrost' in sub['nameNob'].lower()

    # Sjekk at dedikerte underartsnavn (svartryggerle, såerle) består, og at
    # bokmålsord i dedikerte underartsnavn ("sørlig gulerle") blir til nynorsk ("sørleg gulerle")
    alba_subs = {s['norwegian']: s for s in by_latin['motacilla alba'].get('subspecies', [])}
    assert alba_subs['svartryggerle']['nameNno'] == 'svartryggerle'
    assert alba_subs['maskeerle']['nameNno'] == 'maskeerle'

    flava_subs = {s['norwegian']: s for s in by_latin['motacilla flava'].get('subspecies', [])}
    assert flava_subs['såerle']['nameNno'] == 'såerle'
    assert flava_subs['sørlig gulerle']['nameNno'] == 'sørleg gulerle'
    assert flava_subs['engelsk gulerle']['nameNno'] == 'engelsk gulerle'

    # Sjekk at spesialtilfella (østgulerle -> austgulerle) er på plass i offline-data
    tschutschensis = by_latin['motacilla tschutschensis']
    assert tschutschensis['nameNno'] == 'austgulerle'
    assert tschutschensis['nynorsk'] == 'austgulerle'
    tsch_subs = tschutschensis.get('subspecies', [])
    assert len(tsch_subs) >= 1
    assert tsch_subs[0]['nameNno'] == 'austgulerle, underarten plexa/tschutschensis'

    # Sjekk algoritmen for spesialtilfella
    from src.species_sync import _translate_dedicated_sub_to_nno
    assert _translate_dedicated_sub_to_nno('østgulerle') == 'austgulerle'
    assert _translate_dedicated_sub_to_nno('Østgulerle') == 'Austgulerle'
    assert _translate_dedicated_sub_to_nno('østempid') == 'austempid'
    assert _translate_dedicated_sub_to_nno('Østempid') == 'Austempid'
    assert _translate_dedicated_sub_to_nno('ub- gul-/østgulerle') == 'ub- gul-/austgulerle'
    assert _translate_dedicated_sub_to_nno('ub-gul-/østgulerle') == 'ub- gul-/austgulerle'
    assert _translate_dedicated_sub_to_nno('gul-/østgulerle') == 'gul-/austgulerle'







def test_species_source_local_slar_av_ao_kallet(monkeypatch):
    """SPECIES_SOURCE=local skal gi tom liste og 200, ikke et kall til AO."""
    import os
    import server

    kalt = []
    monkeypatch.setattr(server, 'handle_species_search',
                        lambda *a, **kw: kalt.append(a) or [{'taxonName': 'skal ikke skje'}])
    monkeypatch.setenv('SPECIES_SOURCE', 'local')

    sendt = {}

    class FalskHandler:
        _send_json = lambda self, data, status=200: sendt.update(data=data, status=status)
        _handle_species_api = server.Handler._handle_species_api

    from urllib.parse import urlparse
    FalskHandler()._handle_species_api(urlparse('/api/species?search=gr%C3%A5'))

    assert sendt['data'] == []
    assert sendt['status'] == 200
    assert kalt == [], 'AO skal ikke kalles når SPECIES_SOURCE=local'
