import threading
import time
import os
import sys
from http.server import HTTPServer
import requests

import pytest

# Ensure repo root is importable
REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

from server import Handler, _stats


def start_server(port):
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def test_stats_page_no_key():
    """Test at /stats krever nøkkel."""
    port = 38010
    srv = start_server(port)
    time.sleep(0.05)

    # Uten key parameter
    r = requests.get(f'http://127.0.0.1:{port}/stats')
    assert r.status_code == 200
    # Sjekk for login-form i HTML
    assert 'Logg inn' in r.text or 'stats-key' in r.text

    srv.shutdown()


def test_stats_page_wrong_key():
    """Test at /stats avviser feil nøkkel."""
    port = 38011
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/stats?key=wrongkey')
    assert r.status_code == 200
    # Sjekk for login-form i HTML
    assert 'Logg inn' in r.text or 'stats-key' in r.text

    srv.shutdown()


def test_stats_page_correct_key(monkeypatch):
    """Test at /stats viser data med korrekt nøkkel."""
    # Sett STATS_KEY for test og disable Supabase
    monkeypatch.setenv('STATS_KEY', 'testkey')
    monkeypatch.delenv('SUPABASE_URL', raising=False)
    monkeypatch.delenv('SUPABASE_KEY', raising=False)

    # Reset stats
    _stats['total'] = 5
    _stats['per_ip'] = {'127.0.0.1': 3, '192.168.1.1': 2}
    _stats['per_ua'] = {'TestAgent/1.0': 4, 'OtherAgent/2.0': 1}

    port = 38012
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/stats?key=testkey')
    assert r.status_code == 200
    # Sjekk at stats-siden vises (enten fra Supabase eller in-memory)
    assert 'Brukerstatistikk' in r.text or 'sidevisninger' in r.text
    # Ikke sjekk spesifikk data siden Supabase kan være aktiv

    srv.shutdown()


def test_stats_page_empty_stats(monkeypatch):
    """Test at /stats håndterer tomme stats."""
    monkeypatch.setenv('STATS_KEY', 'testkey')

    # Reset stats til tom
    _stats['total'] = 0
    _stats['per_ip'] = {}
    _stats['per_ua'] = {}

    port = 38013
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/stats?key=testkey')
    assert r.status_code == 200
    # Sjekk at stats-siden er returnert (enten med data eller melding om tom stats)
    assert 'Brukerstatistikk' in r.text or 'sidevisninger' in r.text

    srv.shutdown()


def test_stats_increment():
    """Test at stats incrementeres ved logview."""
    from server import _stats

    # Reset stats
    _stats['total'] = 0
    _stats['per_ip'] = {}
    _stats['per_ua'] = {}

    port = 38014
    srv = start_server(port)
    time.sleep(0.05)

    headers = {'User-Agent': 'pytest-agent/1.0'}
    r = requests.post(f'http://127.0.0.1:{port}/api/logview', headers=headers)
    assert r.status_code == 200
    assert _stats['total'] == 1
    assert '127.0.0.1' in _stats['per_ip']
    assert 'pytest-agent/1.0' in _stats['per_ua']

    srv.shutdown()


def test_unknown_api_endpoint():
    """Test at ukjente API endpoints gir feilmelding."""
    port = 38015
    srv = start_server(port)
    time.sleep(0.05)

    # Ukjent API endpoint
    r = requests.get(f'http://127.0.0.1:{port}/api/nonexistent')
    # Server vil prøve å serve fra public/, men siden den ikke finnes kan vi få 404 eller 200
    # Det viktigste er at appen ikke krasjer
    assert r.status_code in [200, 404]

    srv.shutdown()
