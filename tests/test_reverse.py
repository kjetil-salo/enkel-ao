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

from server import Handler, run, _stats


def start_server(port):
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def test_reverse_valid(monkeypatch):
    # Mock httpx.Client for å returnere fake Nominatim-respons
    from unittest.mock import MagicMock

    fake_json = {'display_name': 'Test Place', 'address': {'city': 'TestCity'}}

    class FakeResponse:
        status_code = 200
        text = json.dumps(fake_json)
        def raise_for_status(self):
            pass

    class FakeClient:
        def __init__(self, **kwargs):
            pass
        def get(self, url, **kwargs):
            return FakeResponse()
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass

    monkeypatch.setattr('httpx.Client', FakeClient)

    port = 38001
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/api/reverse?lat=59.0&lon=10.0')
    assert r.status_code == 200
    data = r.json()
    assert 'name' in data

    srv.shutdown()


def test_reverse_invalid():
    port = 38002
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.get(f'http://127.0.0.1:{port}/api/reverse?lat=notfloat&lon=10.0')
    assert r.status_code == 400

    srv.shutdown()
