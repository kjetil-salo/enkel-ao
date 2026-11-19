"""Tester for artsgrupper (Fase 1 & 3: pattedyr i søk, verdilister, CSV og AO2/AO3-import)."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from src.ao3_import import _prepare, _verdilister
from src.ao_import import observations_to_csv
from src.ao_import_httpx import _obs_species_group, post_with_curl
from src.api_handlers import _normaliser_artsgruppe, fetch_ao_autocomplete, handle_species_search


def test_normaliser_artsgruppe():
    assert _normaliser_artsgruppe('8') == '8'
    assert _normaliser_artsgruppe('11') == '11'
    assert _normaliser_artsgruppe(11) == '11'
    assert _normaliser_artsgruppe('999') == '8'
    assert _normaliser_artsgruppe('') == '8'
    assert _normaliser_artsgruppe(None) == '8'


def test_handle_species_search_sender_artsgruppe():
    mock_resp = MagicMock()
    mock_resp.text = '<span class="itemjson">{"taxonid": "48103", "taxonname": "elg", "speciesgroupid": "11"}</span>'
    mock_resp.raise_for_status = MagicMock()

    mock_client = MagicMock()
    mock_client.__enter__ = MagicMock(return_value=mock_client)
    mock_client.__exit__ = MagicMock(return_value=False)
    mock_client.get.return_value = mock_resp

    with patch('src.api_handlers.httpx.Client', return_value=mock_client):
        result = handle_species_search('elg', species_group='11')

    called_url = mock_client.get.call_args[0][0]
    assert 'speciesGroup=11' in called_url
    assert len(result) == 1
    assert result[0]['taxonId'] == '48103'
    assert result[0]['speciesGroupId'] == '11'


def test_fetch_ao_autocomplete_hopper_over_lokal_db_for_ikke_fugl():
    mock_db = MagicMock()
    res = fetch_ao_autocomplete('hytte', location_db=mock_db, species_group_id='11')
    mock_db.search_by_name.assert_not_called()
    assert res['results'] == []
    assert res['not_logged_in'] is True


def test_pattedyr_lister_json_struktur():
    sti = Path(__file__).resolve().parent.parent / 'public' / 'data' / 'pattedyr_lister.json'
    assert sti.exists()
    data = json.loads(sti.read_text(encoding='utf-8'))
    assert data['speciesGroupId'] == 11
    assert data['name'] == 'Pattedyr'
    for nokkel in ('activities', 'stages', 'genders', 'units', 'discoveryMethods', 'determinationMethods'):
        assert isinstance(data[nokkel], list) and len(data[nokkel]) > 0
        assert all('value' in r and 'label' in r for r in data[nokkel])
    assert any(a['value'] == '23' and a.get('selected') for a in data['activities'])


def test_observations_to_csv_pattedyr_kolonner():
    obs = [{
        'species': {'taxonName': 'elg', 'taxonId': 48103, 'speciesGroupId': '11'},
        'speciesGroupId': 11,
        'placeId': 999999,
        'timestamp': '2026-11-19T12:00:00Z',
        'count': 2,
        'unit': 'Individer',
        'age': 'Voksen',
        'gender': 'Hunn',
        'activity': 'Stasjonær',
        'discoveryMethod': 'Observasjon',
    }]
    csv_tekst = observations_to_csv(obs, species_group_id='11')
    linjer = csv_tekst.split('\r\n')
    header = linjer[0].split('\t')
    rad = linjer[1].split('\t')
    assert 'Superlokalitet' not in header
    assert 'Enhet' in header
    assert 'Metode' in header
    assert rad[header.index('Artsnavn')] == 'elg'
    assert rad[header.index('Enhet')] == 'Individer'
    assert rad[header.index('Metode')] == 'Observasjon'


def test_post_with_curl_splitter_blandede_artsgrupper():
    obs_fugl = {'species': {'taxonName': 'kjøttmeis'}, 'speciesGroupId': 8, 'placeId': 1}
    obs_pattedyr = {'species': {'taxonName': 'elg'}, 'speciesGroupId': 11, 'placeId': 2}
    assert _obs_species_group(obs_fugl) == '8'
    assert _obs_species_group(obs_pattedyr) == '11'

    with patch('src.ao_import_httpx._post_single_group_with_curl') as mock_single:
        mock_single.side_effect = [
            {'success': True, 'published': True, 'count': 1, 'imagesUploaded': 0, 'imagesFailed': 0, 'notPublished': []},
            {'success': True, 'published': True, 'count': 1, 'imagesUploaded': 0, 'imagesFailed': 0, 'notPublished': []},
        ]
        res = post_with_curl([obs_fugl, obs_pattedyr], login_token='lt', auth_cookie='ac')

    assert res['success'] is True
    assert res['count'] == 2
    assert mock_single.call_count == 2
    assert mock_single.call_args_list[0].kwargs['species_group_id'] == '8'
    assert mock_single.call_args_list[1].kwargs['species_group_id'] == '11'


def test_ao3_prepare_pattedyr():
    _verdilister.cache_clear()
    funn = {
        'species': {'taxonId': 48103, 'taxonName': 'elg', 'speciesGroupId': 11},
        'speciesGroupId': 11,
        'placeId': 999999,
        'count': 1,
        'timestamp': '2026-11-19T12:00:00Z',
        'activity': 'Stasjonær',
        'age': 'Voksen',
        'gender': 'Hann',
    }
    with patch('src.ao3_import._ao3_art', return_value={'speciesGroupId': 11, 'vernacularName': {'name': 'elg'}}), \
         patch('src.ao3_import._verdilister', return_value=(
             {'stasjonær': 23}, {'voksen': 58}, {'hann': 1}, {'individer': 9}, {'observasjon': 1}
         )):
        felter = _prepare(funn)
    assert felter['taxonId'] == 48103
    assert felter['activityId'] == 23
    assert felter['stageId'] == 58
    assert felter['genderId'] == 1
