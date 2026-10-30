"""Enhetstester for src/species_sync.py (Steg 2: synkronisering av antallFunn og artsnamn)."""

from unittest.mock import patch, MagicMock
from src.species_sync import (
    parse_ao_species_list_html,
    fetch_artsdatabanken_names,
    merge_species_counts_and_names,
    RODSTRUPETROST_SEED,
)


SAMPLE_AO_SPECIES_LIST_HTML = """
<ul class="listofspecies" id="taxonlist">
<li class="taxon">
    <span class="sightingscount"><a href="/ViewSighting/ViewSightings?storedSearchCriterias=17138105&amp;taxa=4507">428\xa0362</a></span>
    <span data-taxonid="4507"><b>rødstrupe</b>&nbsp;<i>Erithacus rubecula</i></span>
</li>
<li class="taxon">
    <span class="sightingscount"><a href="/ViewSighting/ViewSightings?storedSearchCriterias=17138105&amp;taxa=3799">213\xa0847</a></span>
    <span data-taxonid="3799"><b>rødstilk</b>&nbsp;<i>Tringa totanus</i></span>
</li>
<li class="taxon">
    <span class="sightingscount"><a href="/ViewSighting/ViewSightings?storedSearchCriterias=17138105&amp;taxa=4560">0</a></span>
    <span data-taxonid="4560"><b>rødstrupetrost</b>&nbsp;<i>Turdus ruficollis</i></span>
</li>
</ul>
"""


def test_parse_ao_species_list_html():
    parsed = parse_ao_species_list_html(SAMPLE_AO_SPECIES_LIST_HTML)
    assert len(parsed) == 3

    by_id = {item['taxonId']: item for item in parsed}
    assert by_id[4507]['nameNob'] == 'rødstrupe'
    assert by_id[4507]['latinName'] == 'Erithacus rubecula'
    assert by_id[4507]['antallFunn'] == 428362

    assert by_id[3799]['nameNob'] == 'rødstilk'
    assert by_id[3799]['antallFunn'] == 213847

    assert by_id[4560]['nameNob'] == 'rødstrupetrost'
    assert by_id[4560]['latinName'] == 'Turdus ruficollis'
    assert by_id[4560]['antallFunn'] == 0


def test_merge_species_counts_and_names_adds_seed_and_updates_counts():
    existing = [
        {
            'norwegian': 'rødstrupe',
            'nynorsk': 'raudstrupe',
            'latin': 'Erithacus rubecula',
            'subspecies': [],
        },
        {
            'norwegian': 'rødstilk',
            'nynorsk': 'raudstilk',
            'latin': 'Tringa totanus',
            'subspecies': [],
        },
    ]
    ao_items = parse_ao_species_list_html(SAMPLE_AO_SPECIES_LIST_HTML)

    updated_list, updated_count = merge_species_counts_and_names(
        species_list=existing,
        ao_counts=ao_items,
    )

    assert updated_count >= 2
    by_latin = {s['latin'].lower(): s for s in updated_list}

    assert by_latin['erithacus rubecula']['antallFunn'] == 428362
    assert by_latin['erithacus rubecula']['taxonId'] == 4507
    assert by_latin['erithacus rubecula']['nameNno'] == 'raudstrupe'
    assert by_latin['erithacus rubecula']['nameNob'] == 'rødstrupe'

    # Sjekk at rødstrupetrost / raudstrupetrast ble lagt til automatisk hvis den manglet
    assert 'turdus ruficollis' in by_latin
    assert by_latin['turdus ruficollis']['nynorsk'] == RODSTRUPETROST_SEED['nynorsk']
    assert by_latin['turdus ruficollis']['norwegian'] == RODSTRUPETROST_SEED['norwegian']


@patch('src.species_sync.httpx.Client')
def test_fetch_artsdatabanken_names(mock_client_cls):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = [
        {
            'ValidScientificName': 'Turdus ruficollis',
            'ValidScientificNameId': 12345,
            'PopularNames': [
                {'Name': 'rødstrupetrost', 'language': 'nb-NO', 'Preffered': True},
                {'Name': 'raudstrupetrast', 'language': 'nn-NO', 'Preffered': True},
            ],
        }
    ]
    mock_client = MagicMock()
    mock_client.get.return_value = mock_resp
    mock_client_cls.return_value.__enter__.return_value = mock_client

    res = fetch_artsdatabanken_names('Turdus ruficollis')
    assert res is not None
    assert res['nameNob'] == 'rødstrupetrost'
    assert res['nameNno'] == 'raudstrupetrast'
    assert res['latinName'] == 'Turdus ruficollis'
