"""Tester for ao-refresh og ao-create-site endepunkter."""
import threading
import time
import os
import sys
import json
from http.server import HTTPServer
from unittest.mock import MagicMock, patch
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


# --- /api/ao-refresh ---

def test_ao_refresh_missing_login_token():
    """Test at /api/ao-refresh krever loginToken."""
    port = 38060
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.post(
        f'http://127.0.0.1:{port}/api/ao-refresh',
        json={'authCookie': 'abc', 'userId': '123'}
    )
    assert r.status_code == 400
    assert 'loginToken' in r.json().get('error', '')

    srv.shutdown()


def test_ao_refresh_success(monkeypatch):
    """Test at /api/ao-refresh returnerer ny cookie ved vellykket refresh."""
    import httpx

    class FakeResponse:
        status_code = 200
        url = 'https://www.artsobservasjoner.no/User/MyPages'
        text = '<html>MyPages</html>'

    class FakeCookieJar:
        def __iter__(self):
            cookie1 = MagicMock()
            cookie1.name = '.ASPXAUTHNO'
            cookie1.value = 'new-auth-cookie-value'
            yield cookie1

    class FakeClient:
        def __init__(self, **kwargs):
            self.cookies = MagicMock()
            self.cookies.jar = FakeCookieJar()

        def get(self, url, **kwargs):
            return FakeResponse()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    monkeypatch.setattr('httpx.Client', FakeClient)

    port = 38061
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.post(
        f'http://127.0.0.1:{port}/api/ao-refresh',
        json={
            'loginToken': '12345:abcdef',
            'authCookie': 'old-auth-cookie',
            'userId': '12345'
        }
    )
    assert r.status_code == 200
    data = r.json()
    assert data.get('refreshedAuthCookie') == 'new-auth-cookie-value'

    srv.shutdown()


def test_ao_refresh_expired_logintoken(monkeypatch):
    """Test at /api/ao-refresh gir feil når husk-meg-revival mislykkes.

    Ved utløpt logintoken utsteder forsiden ingen .ASPXAUTHNO (og redirecter
    ikke til /LogOn siden den er offentlig), så mangel på ny cookie = utløpt.
    """
    class FakeResponse:
        status_code = 200
        url = 'https://www.artsobservasjoner.no/'
        text = '<html>Logg inn</html>'

    class FakeCookieJar:
        def __iter__(self):
            # Ingen .ASPXAUTHNO = revival mislyktes (kun uinteressante cookies)
            cookie1 = MagicMock()
            cookie1.name = 'AcceptCookies'
            cookie1.value = '1'
            yield cookie1

    class FakeClient:
        def __init__(self, **kwargs):
            self.cookies = MagicMock()
            self.cookies.jar = FakeCookieJar()

        def get(self, url, **kwargs):
            return FakeResponse()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    import httpx
    monkeypatch.setattr('httpx.Client', FakeClient)

    port = 38062
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.post(
        f'http://127.0.0.1:{port}/api/ao-refresh',
        json={
            'loginToken': '12345:abcdef',
            'authCookie': 'old-auth-cookie',
            'userId': '12345'
        }
    )
    assert r.status_code == 200
    data = r.json()
    # Ingen ny cookie => logintoken utløpt, krever ny innlogging
    assert 'refreshedAuthCookie' not in data
    assert 'error' in data

    srv.shutdown()


# --- /api/ao-create-site ---

def test_ao_create_site_missing_name():
    """Test at /api/ao-create-site krever navn."""
    port = 38063
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.post(
        f'http://127.0.0.1:{port}/api/ao-create-site',
        json={'lat': 60.0, 'lon': 5.0, 'loginToken': 'abc', 'authCookie': 'def'}
    )
    assert r.status_code == 400
    assert 'Navn' in r.json().get('error', '')

    srv.shutdown()


def test_ao_create_site_missing_coords():
    """Test at /api/ao-create-site krever koordinater."""
    port = 38064
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.post(
        f'http://127.0.0.1:{port}/api/ao-create-site',
        json={'name': 'Teststed', 'loginToken': 'abc', 'authCookie': 'def'}
    )
    assert r.status_code == 400
    assert 'Koordinater' in r.json().get('error', '')

    srv.shutdown()


def test_ao_create_site_missing_auth():
    """Test at /api/ao-create-site krever loginToken og authCookie."""
    port = 38065
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.post(
        f'http://127.0.0.1:{port}/api/ao-create-site',
        json={'name': 'Teststed', 'lat': 60.0, 'lon': 5.0}
    )
    assert r.status_code == 401
    assert 'loginToken' in r.json().get('error', '') or 'authCookie' in r.json().get('error', '')

    srv.shutdown()


def test_ao_create_site_success(monkeypatch):
    """Test vellykket opprettelse av AO-lokasjon."""
    def fake_create_ao_site(name, lat, lon, accuracy, login_token, auth_cookie):
        return {'success': True, 'siteId': 42, 'message': 'Lokasjon opprettet'}

    monkeypatch.setattr('src.ao_create_site.create_ao_site', fake_create_ao_site)

    port = 38066
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.post(
        f'http://127.0.0.1:{port}/api/ao-create-site',
        json={
            'name': 'Teststed',
            'lat': 60.0,
            'lon': 5.0,
            'accuracy': 25,
            'loginToken': '12345:abc',
            'authCookie': 'auth123'
        }
    )
    assert r.status_code == 200
    data = r.json()
    assert data.get('success') is True
    assert data.get('siteId') == 42

    srv.shutdown()


def test_ao_create_site_invalid_coords():
    """Test at /api/ao-create-site håndterer ugyldige koordinater."""
    port = 38067
    srv = start_server(port)
    time.sleep(0.05)

    r = requests.post(
        f'http://127.0.0.1:{port}/api/ao-create-site',
        json={
            'name': 'Teststed',
            'lat': 'not-a-number',
            'lon': 5.0,
            'loginToken': 'abc',
            'authCookie': 'def'
        }
    )
    assert r.status_code == 400

    srv.shutdown()


# --- handle_ao_private_sites: auto-revival av utløpt sesjon ---

def test_private_sites_revives_expired_session(monkeypatch):
    """Utløpt .ASPXAUTHNO skal revitaliseres via _ensure_auth før BindUserSitesGrid,
    og den fornyede cookien skal returneres til frontend."""
    from src import api_handlers

    calls = {}

    def fake_ensure_auth(auth, user_id, login_token):
        calls['ensure_auth'] = (auth, user_id, login_token)
        return 'ny-gyldig-cookie', 'ny-gyldig-cookie'

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {'data': [
                {'SiteId': 1, 'Name': 'Myra', 'SiteXCoord': 600000,
                 'SiteYCoord': 8400000, 'Accuracy': 10},
            ]}

    class FakeClient:
        def __init__(self, **kwargs):
            calls['seed_cookies'] = kwargs.get('cookies')

        def post(self, url, **kwargs):
            return FakeResponse()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    monkeypatch.setattr(api_handlers, '_ensure_auth', fake_ensure_auth)
    monkeypatch.setattr('httpx.Client', FakeClient)

    sites, refreshed = api_handlers.handle_ao_private_sites(
        'utlopt-cookie', login_token='123:abc', user_id='123')

    # _ensure_auth ble kalt med den utløpte cookien
    assert calls['ensure_auth'] == ('utlopt-cookie', '123', '123:abc')
    # Den fornyede cookien brukes i selve kallet og returneres til frontend
    assert calls['seed_cookies']['.ASPXAUTHNO'] == 'ny-gyldig-cookie'
    assert refreshed == 'ny-gyldig-cookie'
    assert len(sites) == 1 and sites[0]['name'] == 'Myra'


def test_private_sites_without_user_id_skips_ensure_auth(monkeypatch):
    """Uten user_id (bakoverkompatibel sti) skal _ensure_auth ikke kalles,
    og refreshed skal være None."""
    from src import api_handlers

    def fail_ensure_auth(*args, **kwargs):
        raise AssertionError('_ensure_auth skal ikke kalles uten user_id')

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {'data': []}

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        def post(self, url, **kwargs):
            return FakeResponse()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    monkeypatch.setattr(api_handlers, '_ensure_auth', fail_ensure_auth)
    monkeypatch.setattr('httpx.Client', FakeClient)

    sites, refreshed = api_handlers.handle_ao_private_sites('cookie', login_token='123:abc')

    assert sites == []
    assert refreshed is None
