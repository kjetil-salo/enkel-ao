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

from server import Handler, _stats


def start_server(port):
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def test_species_parsing(monkeypatch):
    # Provide fake HTML with two span.itemjson entries
    item1 = json.dumps({'taxonid': 1, 'taxonname': 'House Sparrow', 'scientificname': 'Passer domesticus', 'leaf': 'true'})
    item2 = json.dumps({'taxonid': 2, 'taxonname': 'Rock Dove', 'scientificname': 'Columba livia', 'leaf': 'true'})
    fake_html = f'<span class="itemjson">{item1}</span><span class="itemjson">{item2}</span>'

    class DummyResp:
        def __init__(self, data):
            self._data = data

        def read(self):
            return self._data.encode('utf-8')

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            pass

    def fake_urlopen(req, timeout=10):
        return DummyResp(fake_html)

    monkeypatch.setattr('src.api_handlers.urlopen', fake_urlopen)

    port = 38003
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/api/species?search=sparrow')
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert any(d.get('taxonName') == 'House Sparrow' for d in data)

    srv.shutdown()


def test_logview_monkeypatch(monkeypatch):
    # Reset stats
    _stats['total'] = 0
    _stats['per_ip'] = {}
    _stats['per_ua'] = {}

    called = {'supabase': False}

    def fake_log_view_to_supabase(ip, ua, device_id=''):
        called['supabase'] = True

    # Patch the supabase logger in both modules so Handler uses the fake
    from src import supabase_log
    import server as server_mod
    monkeypatch.setattr(supabase_log, 'log_view_to_supabase', fake_log_view_to_supabase)
    monkeypatch.setattr(server_mod, 'log_view_to_supabase', fake_log_view_to_supabase)

    port = 38004
    srv = start_server(port)
    time.sleep(0.05)

    headers = {'User-Agent': 'pytest-agent/1.0'}
    r = requests.post(f'http://127.0.0.1:{port}/api/logview', headers=headers)
    assert r.status_code == 200
    assert r.json().get('ok') is True
    assert _stats['total'] == 1
    assert called['supabase'] is True

    srv.shutdown()
