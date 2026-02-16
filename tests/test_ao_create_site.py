"""
Tester for opprettelse av AO-lokasjon.
"""

import json
import os
import sys
from unittest.mock import patch, MagicMock

import pytest

# Ensure repo root is importable
REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

from src.ao_create_site import wgs84_to_web_mercator, create_ao_site


class TestWgs84ToWebMercator:
    """Tester for EPSG:3857 konvertering."""

    def test_bergen(self):
        """Bergen sentrum (~60.39, ~5.32) i Web Mercator."""
        x, y = wgs84_to_web_mercator(60.39, 5.32)
        assert 580000 < x < 610000
        assert 8470000 < y < 8510000

    def test_oslo(self):
        """Oslo sentrum (~59.91, ~10.75) i Web Mercator."""
        x, y = wgs84_to_web_mercator(59.91, 10.75)
        assert 1180000 < x < 1210000
        assert 8360000 < y < 8400000

    def test_tromsoe(self):
        """Tromsø (~69.65, ~18.96) i Web Mercator."""
        x, y = wgs84_to_web_mercator(69.65, 18.96)
        assert 2090000 < x < 2130000
        assert 10930000 < y < 10980000

    def test_equator_prime_meridian(self):
        """Origo (0, 0) skal gi (0, 0) i Web Mercator."""
        x, y = wgs84_to_web_mercator(0, 0)
        assert x == 0
        assert y == 0

    def test_returns_integers(self):
        """Skal returnere heltall."""
        x, y = wgs84_to_web_mercator(60.0, 10.0)
        assert isinstance(x, int)
        assert isinstance(y, int)

    def test_hylkjesvingen(self):
        """Hylkjesvingen 51 - verifisert mot AO (opprettet siteId 3273519)."""
        x, y = wgs84_to_web_mercator(60.5137953, 5.3454789)
        assert x == 595056
        assert y == 8515028


class TestCreateAoSite:
    """Tester for opprettelse av lokasjon."""

    @patch('src.ao_create_site.httpx.Client')
    def test_success_with_site_id(self, mock_client_cls):
        """Skal returnere siteId fra AO response og kalle AddSiteInfo for nøyaktighet."""
        # Mock SaveSite response
        save_response = MagicMock()
        save_response.status_code = 200
        save_response.text = json.dumps({
            'success': True,
            'points': {
                'type': 'FeatureCollection',
                'features': [{
                    'type': 'Feature',
                    'id': 3273519,
                    'properties': {
                        'siteName': 'Testlokasjon',
                        'siteId': 3273519,
                        'siteCoordinateStringPresentation': 'Ø299398, N6714205 Sone 32',
                        'isPrivate': True,
                    }
                }]
            }
        })
        save_response.json.return_value = json.loads(save_response.text)
        save_response.cookies = {}

        # Mock AddSiteInfo response (for nøyaktighet)
        accuracy_response = MagicMock()
        accuracy_response.status_code = 200
        accuracy_response.text = json.dumps({'success': True})
        accuracy_response.json.return_value = {'success': True}

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        # Første kall = SaveSite, andre kall = AddSiteInfo
        mock_client.post.side_effect = [save_response, accuracy_response]
        mock_client_cls.return_value = mock_client

        result = create_ao_site('Testlokasjon', 60.39, 5.32, 50, 'token', 'cookie')

        assert result['success'] is True
        assert result['siteId'] == 3273519
        assert 'Testlokasjon' in result['message']

        # Verifiser at AddSiteInfo ble kalt for å sette nøyaktighet
        assert mock_client.post.call_count == 2
        accuracy_call = mock_client.post.call_args_list[1]
        accuracy_data = accuracy_call.kwargs.get('data') or accuracy_call[1].get('data')
        assert accuracy_data['Id'] == '3273519'
        assert accuracy_data['Accuracy'] == '50'

    @patch('src.ao_create_site.httpx.Client')
    def test_html_redirect_auth_failed(self, mock_client_cls):
        """Skal oppdage HTML-redirect som auth-feil."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = '<!DOCTYPE html><html><body>Login page</body></html>'
        mock_response.cookies = {}

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_cls.return_value = mock_client

        result = create_ao_site('Test', 60.39, 5.32, 50, 'token', 'cookie')

        assert result['success'] is False
        assert 'Auth utløpt' in result['message']

    @patch('src.ao_create_site.httpx.Client')
    def test_ao_error_message(self, mock_client_cls):
        """Skal returnere feilmelding fra AO."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = json.dumps({
            'success': False,
            'message': 'Site not saved: duplicate name'
        })
        mock_response.json.return_value = {'success': False, 'message': 'Site not saved: duplicate name'}
        mock_response.cookies = {}

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_cls.return_value = mock_client

        result = create_ao_site('Test', 60.39, 5.32, 50, 'token', 'cookie')

        assert result['success'] is False
        assert 'duplicate name' in result['message']

    @patch('src.ao_create_site.httpx.Client')
    def test_sends_web_mercator_coords(self, mock_client_cls):
        """Skal sende EPSG:3857 koordinater til AO."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = json.dumps({'success': True, 'points': {'features': []}})
        mock_response.json.return_value = {'success': True, 'points': {'features': []}}
        mock_response.cookies = {}

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_cls.return_value = mock_client

        create_ao_site('Test', 60.5137953, 5.3454789, 25, 'token', 'cookie')

        # Verifiser at POST ble kalt med riktige parametere
        call_args = mock_client.post.call_args
        form_data = call_args.kwargs.get('data') or call_args[1].get('data')
        assert form_data['XCoord'] == '595056'
        assert form_data['YCoord'] == '8515028'
        assert form_data['Geometry'] == 'POINT(595056 8515028)'
        assert form_data['Id'] == '-1'
        assert form_data['Name'] == 'Test'
