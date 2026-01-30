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
    # Mock response fra AO API
    fake_sites = [
        {
            'id': 1,
            'name': 'Østensjøvannet',
            'lat': 59.91,
            'lon': 10.81,
        },
        {
            'id': 2,
            'name': 'Sognsvann',
            'lat': 59.97,
            'lon': 10.73,
            'isSuper': True,
        }
    ]

    class DummyResp:
        def __init__(self, data):
            self._data = data

        def read(self):
            return json.dumps(self._data).encode('utf-8')

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            pass

    def fake_urlopen(req, timeout=10):
        return DummyResp(fake_sites)

    monkeypatch.setattr('src.api_handlers.urlopen', fake_urlopen)

    port = 38006
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/api/ao-sites?lat=59.9&lon=10.7&size=1000')
    assert r.status_code == 200
    data = r.json()
    assert 'sites' in data
    assert isinstance(data['sites'], list)
    assert len(data['sites']) == 2
    assert data['sites'][0]['name'] == 'Østensjøvannet'
    assert data['sites'][1]['name'] == 'Sognsvann'
    assert data['sites'][1].get('isSuper') == True

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
    def fake_urlopen(req, timeout=10):
        raise Exception('External API error')

    monkeypatch.setattr('src.api_handlers.urlopen', fake_urlopen)

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


def test_ao_sites_default_size():
    """Test at /api/ao-sites bruker default size hvis ikke oppgitt."""
    # Denne testen bruker faktisk api_handlers direkte
    from src.api_handlers import handle_ao_sites_search

    # Mock urlopen
    import src.api_handlers
    original_urlopen = src.api_handlers.urlopen

    called_urls = []

    class DummyResp:
        def read(self):
            return b'[]'
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass

    def mock_urlopen(req, timeout=10):
        called_urls.append(req.full_url)
        return DummyResp()

    src.api_handlers.urlopen = mock_urlopen

    try:
        result = handle_ao_sites_search(59.9, 10.7)
        assert len(called_urls) == 1
        # Default size er 600 meter
        assert 'minX=' in called_urls[0]
        assert 'maxX=' in called_urls[0]
    finally:
        src.api_handlers.urlopen = original_urlopen
