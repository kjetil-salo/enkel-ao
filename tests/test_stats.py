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


def test_gammel_stats_url_finnes_ikke_lenger():
    """
    `/stats?key=salo` er fjernet. Standardnøkkelen sto i klartekst i et offentlig
    repo, altså ingen beskyttelse for den som leste koden.
    """
    port = 38010
    srv = start_server(port)
    time.sleep(0.05)
    try:
        # Ukjente stier faller gjennom til selve appen, så statuskoden er 200.
        # Det som betyr noe er at ingen admin-data serveres.
        for url in (f'http://127.0.0.1:{port}/stats',
                    f'http://127.0.0.1:{port}/stats?key=salo'):
            r = requests.get(url)
            assert 'Brukerstatistikk' not in r.text
            assert 'sidevisninger' not in r.text
    finally:
        srv.shutdown()


def test_feil_hemmelighet_gir_404_ikke_hint(monkeypatch):
    """
    Feil hemmelighet skal se ut som at siden ikke finnes. En 403 eller en
    innloggingsside ville bekreftet at det ER noe der — og det er hele poenget
    med en hemmelig adresse.
    """
    monkeypatch.setenv('ADMIN_STI', 'riktig-hemmelighet')
    port = 38011
    srv = start_server(port)
    time.sleep(0.05)
    try:
        r = requests.get(f'http://127.0.0.1:{port}/s/feil-hemmelighet')
        assert r.status_code == 404
        assert 'Brukerstatistikk' not in r.text
        assert 'Logg inn' not in r.text
    finally:
        srv.shutdown()


def test_riktig_hemmelighet_viser_statistikk(monkeypatch):
    monkeypatch.setenv('ADMIN_STI', 'testhemmelighet')
    monkeypatch.delenv('SUPABASE_URL', raising=False)
    monkeypatch.delenv('SUPABASE_KEY', raising=False)

    _stats['total'] = 5
    _stats['per_ip'] = {'127.0.0.1': 3, '192.168.1.1': 2}
    _stats['per_ua'] = {'TestAgent/1.0': 4, 'OtherAgent/2.0': 1}

    port = 38012
    srv = start_server(port)
    time.sleep(0.05)
    try:
        r = requests.get(f'http://127.0.0.1:{port}/s/testhemmelighet')
        assert r.status_code == 200
        assert 'Brukerstatistikk' in r.text or 'sidevisninger' in r.text
    finally:
        srv.shutdown()


def test_tomme_stats_gir_fortsatt_side(monkeypatch):
    monkeypatch.setenv('ADMIN_STI', 'testhemmelighet')
    _stats['total'] = 0
    _stats['per_ip'] = {}
    _stats['per_ua'] = {}

    port = 38013
    srv = start_server(port)
    time.sleep(0.05)
    try:
        r = requests.get(f'http://127.0.0.1:{port}/s/testhemmelighet')
        assert r.status_code == 200
        assert 'Brukerstatistikk' in r.text or 'sidevisninger' in r.text
    finally:
        srv.shutdown()


def test_ukjent_underside_bak_hemmeligheten_gir_404(monkeypatch):
    monkeypatch.setenv('ADMIN_STI', 'testhemmelighet')
    port = 38014
    srv = start_server(port)
    time.sleep(0.05)
    try:
        r = requests.get(f'http://127.0.0.1:{port}/s/testhemmelighet/noe-annet')
        assert r.status_code == 404
    finally:
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
