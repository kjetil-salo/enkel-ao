import threading
import time
import os
import sys
import json
from http.server import HTTPServer
import requests

import pytest

# Ensure repo root is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from server import Handler, run, _stats


def start_server(port):
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def test_reverse_valid(monkeypatch):
    # Mock urlopen to return a simple JSON body
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
        body = json.dumps({'display_name': 'Test Place', 'address': {'city': 'TestCity'}})
        return DummyResp(body)

    monkeypatch.setattr('server.urlopen', fake_urlopen)

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
