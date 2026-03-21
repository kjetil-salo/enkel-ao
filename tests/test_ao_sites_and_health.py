import threading
import time
import os
import sys
import json
from http.server import HTTPServer
import requests

import pytest

# Ensure repo root is importable
REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

from server import Handler


def start_server(port):
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def test_health_endpoint():
    """Test at /health endpointet returnerer OK status."""
    port = 38005
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/health')
    assert r.status_code == 200
    data = r.json()
    assert data.get('status') == 'ok'
    assert 'timestamp' in data
    assert isinstance(data['timestamp'], (int, float))

    srv.shutdown()


def test_ao_sites_valid(monkeypatch):
    """Test /api/ao-sites med gyldig input."""
    # Mock response fra AO API (ByBoundingBox-format)
    # Site 1 er en superlokasjon (referert som parent av site 2)
    # Site 2 er en underlokasjon med parentSiteId=1
    fake_sites = [
        {
            'id': 1,
            'name': 'Østensjøvannet',
            'latitude': 59.91,
            'longitude': 10.81,
        },
        {
            'id': 2,
            'name': 'Sognsvann',
            'latitude': 59.97,
            'longitude': 10.73,
            'parentSiteId': 1,
        }
    ]

    class FakeResponse:
        status_code = 200
        def __init__(self, data=None):
            self._data = data
        def raise_for_status(self):
            pass
        def json(self):
            return self._data

    class FakeClient:
        def __init__(self, **kwargs):
            pass
        def get(self, url, **kwargs):
            return FakeResponse(fake_sites)
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass

    monkeypatch.setattr('httpx.Client', FakeClient)

    port = 38006
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/api/ao-sites?lat=59.9&lon=10.7&size=1000')
    assert r.status_code == 200
    data = r.json()
    assert 'sites' in data
    assert isinstance(data['sites'], list)
    assert len(data['sites']) == 2
    names = [s['name'] for s in data['sites']]
    assert 'Østensjøvannet' in names
    assert 'Sognsvann' in names
    # Østensjøvannet er superlokasjon (referert som parent av Sognsvann)
    ostensjovannet = next(s for s in data['sites'] if s['name'] == 'Østensjøvannet')
    sognsvann = next(s for s in data['sites'] if s['name'] == 'Sognsvann')
    assert ostensjovannet.get('isSuper') is True
    assert sognsvann.get('isSuper') is False

    srv.shutdown()


def test_ao_sites_missing_params():
    """Test /api/ao-sites uten påkrevde parametere."""
    port = 38007
    srv = start_server(port)
    time.sleep(0.05)

    # Mangler lat
    r = requests.get(f'http://127.0.0.1:{port}/api/ao-sites?lon=10.7')
    assert r.status_code == 400

    # Mangler lon
    r = requests.get(f'http://127.0.0.1:{port}/api/ao-sites?lat=59.9')
    assert r.status_code == 400

    srv.shutdown()


def test_ao_sites_invalid_coords():
    """Test /api/ao-sites med ugyldige koordinater."""
    port = 38008
    srv = start_server(port)
    time.sleep(0.05)

    # Ugyldig lat
    r = requests.get(f'http://127.0.0.1:{port}/api/ao-sites?lat=invalid&lon=10.7')
    assert r.status_code == 400

    # Ugyldig lon
    r = requests.get(f'http://127.0.0.1:{port}/api/ao-sites?lat=59.9&lon=notfloat')
    assert r.status_code == 400

    srv.shutdown()


def test_ao_sites_api_error(monkeypatch):
    """Test at /api/ao-sites håndterer eksterne API-feil grasiøst."""
    class FakeClient:
        def __init__(self, **kwargs):
            pass
        def get(self, url, **kwargs):
            raise Exception('External API error')
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass

    monkeypatch.setattr('httpx.Client', FakeClient)

    port = 38009
    srv = start_server(port)
    time.sleep(0.05)

    # Forventer graceful degradation - tom liste, status 200
    r = requests.get(f'http://127.0.0.1:{port}/api/ao-sites?lat=59.9&lon=10.7')
    assert r.status_code == 200
    data = r.json()
    assert 'sites' in data
    assert data['sites'] == []

    srv.shutdown()


def test_ao_sites_default_size(monkeypatch):
    """Test at /api/ao-sites bruker default size hvis ikke oppgitt."""
    from src.api_handlers import handle_ao_sites_search

    called_urls = []

    class FakeResponse:
        status_code = 200
        def raise_for_status(self):
            pass
        def json(self):
            return []

    class FakeClient:
        def __init__(self, **kwargs):
            pass
        def get(self, url, **kwargs):
            called_urls.append(url)
            return FakeResponse()
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass

    monkeypatch.setattr('httpx.Client', FakeClient)

    sites, refreshed_auth, auth_failed = handle_ao_sites_search(59.9, 10.7)
    assert len(called_urls) == 1
    # Default size er 600 meter
    assert 'minX=' in called_urls[0]
    assert 'maxX=' in called_urls[0]
