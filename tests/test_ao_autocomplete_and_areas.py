"""Tester for ao-autocomplete og ao-areas endepunkter."""
import threading
import time
import os
import sys
import json
from http.server import HTTPServer
from unittest.mock import MagicMock
import requests

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

from server import Handler


def start_server(port):
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


# --- /api/ao-autocomplete ---

def test_ao_autocomplete_short_term():
    """Test at ao-autocomplete returnerer tom liste for kort søkestreng."""
    port = 38070
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/api/ao-autocomplete?term=a')
    assert r.status_code == 200
    data = r.json()
    assert data['results'] == []

    srv.shutdown()


def test_ao_autocomplete_empty_term():
    """Test at ao-autocomplete returnerer tom liste uten søkestreng."""
    port = 38071
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/api/ao-autocomplete')
    assert r.status_code == 200
    data = r.json()
    assert data['results'] == []

    srv.shutdown()


def test_ao_autocomplete_success(monkeypatch):
    """Test at ao-autocomplete returnerer resultater fra AO."""
    fake_results = [
        {'id': 1, 'value': 'Østensjøvannet', 'label': 'Østensjøvannet (Oslo)'},
        {'id': 2, 'value': 'Østmarka', 'label': 'Østmarka (Oslo)'}
    ]

    def fake_fetch(term, login_token=None, auth_cookie=None, user_id=None):
        return {'results': fake_results, 'refreshed_auth_cookie': None}

    monkeypatch.setattr('src.api_handlers.fetch_ao_autocomplete', fake_fetch)

    port = 38072
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/api/ao-autocomplete?term=Østen')
    assert r.status_code == 200
    data = r.json()
    assert len(data['results']) == 2
    assert data['results'][0]['value'] == 'Østensjøvannet'

    srv.shutdown()


def test_ao_autocomplete_api_error(monkeypatch):
    """Test at ao-autocomplete håndterer feil grasiøst."""
    def fake_fetch(term, login_token=None, auth_cookie=None, user_id=None):
        raise Exception('Nettverksfeil')

    monkeypatch.setattr('src.api_handlers.fetch_ao_autocomplete', fake_fetch)

    port = 38073
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/api/ao-autocomplete?term=Bergen')
    assert r.status_code == 200
    data = r.json()
    assert data['results'] == []

    srv.shutdown()


# --- /api/ao-areas ---

def test_ao_areas_short_search():
    """Test at ao-areas returnerer tom liste for kort søkestreng."""
    port = 38074
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/api/ao-areas?search=a')
    assert r.status_code == 200
    assert r.json() == []

    srv.shutdown()


def test_ao_areas_empty_search():
    """Test at ao-areas returnerer tom liste uten søkestreng."""
    port = 38075
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/api/ao-areas')
    assert r.status_code == 200
    assert r.json() == []

    srv.shutdown()


def test_ao_areas_success(monkeypatch):
    """Test at ao-areas proxy returnerer AO-data."""
    import httpx

    fake_areas = [
        {'id': 100, 'name': 'Bergen kommune'},
        {'id': 101, 'name': 'Bergenhus bydel'}
    ]

    class FakeResponse:
        status_code = 200
        def raise_for_status(self): pass
        def json(self): return fake_areas

    class FakeClient:
        def __init__(self, **kwargs): pass
        def get(self, url, **kwargs): return FakeResponse()
        def __enter__(self): return self
        def __exit__(self, *args): pass

    monkeypatch.setattr('httpx.Client', FakeClient)

    port = 38076
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/api/ao-areas?search=Bergen')
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2
    assert data[0]['name'] == 'Bergen kommune'

    srv.shutdown()


def test_ao_areas_api_error(monkeypatch):
    """Test at ao-areas håndterer AO-feil grasiøst."""
    import httpx

    class FakeClient:
        def __init__(self, **kwargs): pass
        def get(self, url, **kwargs): raise Exception('Timeout')
        def __enter__(self): return self
        def __exit__(self, *args): pass

    monkeypatch.setattr('httpx.Client', FakeClient)

    port = 38077
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/api/ao-areas?search=Bergen')
    assert r.status_code == 200
    assert r.json() == []

    srv.shutdown()
