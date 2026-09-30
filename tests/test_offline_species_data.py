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
