"""
Tester for AO-import funksjonalitet (CSV-generering og curl-basert import).
"""

import json
import os
import sys
import threading
import time
from http.server import HTTPServer
from unittest.mock import MagicMock

import pytest
import requests

# Ensure repo root is importable
REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

from src.ao_import import observations_to_csv
from src.ao_import_curl import fetch_csrf_tokens, post_with_curl, publish_all
from server import Handler


def start_server(port):
    """Start test server på gitt port."""
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


class MockSubprocessResult:
    """Mock for subprocess.run returnverdi."""
    def __init__(self, stdout='', stderr='', returncode=0):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode


# ============================================================================
# Del 1: CSV-generering tester
# ============================================================================

def test_observations_to_csv_basic():
    """Test enkel observasjon → CSV med norske tegn (æøå)."""
    observations = [{
        'species': {'taxonName': 'Gråspurv'},
        'timestamp': '2024-01-15T14:30:00Z',
        'placeName': 'Østensjøvannet',
        'count': '2',
        'activity': 'Stasjonær'
    }]

    csv = observations_to_csv(observations)

    # Verifiser grunnleggende format
    assert '\t' in csv  # Tab-separert
    assert '\r\n' in csv  # Windows line endings
    assert 'Gråspurv' in csv
    assert 'Østensjøvannet' in csv
    assert '15.01.2024' in csv  # Dato-format DD.MM.YYYY
    assert '14:30' in csv  # Tid-format HH:MM
    assert 'Stasjonær' in csv

    # Verifiser header
    lines = csv.split('\r\n')
    assert lines[0].startswith('Artsnavn\tLokalitetsnavn')
    assert 'Medobservatør' in lines[0]


def test_observations_to_csv_with_coobservers():
    """Test med 1-10 medobservatører."""
    observations = [{
        'species': {'taxonName': 'Skjære'},
        'timestamp': '2024-02-20T09:15:00Z',
        'placeName': 'Sognsvann',
        'count': '1',
        'activity': 'Rastende',
        'coObservers': ['Per Hansen', 'Kari Nordmann', 'Ole Olsen']
    }]

    csv = observations_to_csv(observations)
    lines = csv.split('\r\n')
    data_row = lines[1]  # Første data-rad (etter header)
    fields = data_row.split('\t')

    # Finn medobservatør-kolonner (kolonne 17-26)
    # Header: Artsnavn, Lokalitet, ..., Kommentar, Privat, Skjul (17 kolonner)
    # Så 10 medobservatør-kolonner
    medobs_start = 17
    medobs_fields = fields[medobs_start:medobs_start + 10]

    assert medobs_fields[0] == 'Per Hansen'
    assert medobs_fields[1] == 'Kari Nordmann'
    assert medobs_fields[2] == 'Ole Olsen'
    # Resten skal være tomme
    for i in range(3, 10):
        assert medobs_fields[i] == ''


def test_observations_to_csv_with_many_coobservers():
    """Test overskridelse: > 10 medobs → kun første 10 brukes."""
    # Lag 12 medobservatører
    many_coobs = [f'Person {i}' for i in range(1, 13)]

    observations = [{
        'species': {'taxonName': 'Svale'},
        'timestamp': '2024-03-10T12:00:00Z',
        'placeName': 'Bygdøy',
        'count': '5',
        'coObservers': many_coobs
    }]

    csv = observations_to_csv(observations)
    lines = csv.split('\r\n')
    data_row = lines[1]
    fields = data_row.split('\t')

    medobs_start = 17
    medobs_fields = fields[medobs_start:medobs_start + 10]

    # Kun de 10 første skal være med
    for i in range(10):
        assert medobs_fields[i] == f'Person {i + 1}'

    # Person 11 og 12 skal IKKE være med
    assert 'Person 11' not in data_row
    assert 'Person 12' not in data_row


def test_observations_to_csv_time_omitted_when_midnight():
    """Verifiser at tid utelates hvis 00:00."""
    observations = [{
        'species': {'taxonName': 'Rørhøne'},
        'timestamp': '2024-05-01T00:00:00Z',
        'placeName': 'Maridalsvannet',
        'count': '1'
    }]

    csv = observations_to_csv(observations)
    lines = csv.split('\r\n')
    data_row = lines[1]

    # Dato skal være med
    assert '01.05.2024' in data_row

    # Tid skal IKKE være med (kolonne 8 og 9 skal være tomme)
    fields = data_row.split('\t')
    # Fra klokkeslett (kolonne 8), Til klokkeslett (kolonne 9)
    assert fields[8] == ''
    assert fields[9] == ''


# ============================================================================
# Del 2: CSRF Token Parsing
# ============================================================================

def test_fetch_csrf_tokens_success(monkeypatch, tmp_path):
    """Test vellykket CSRF token-henting."""
    # Mock subprocess.run
    def fake_run(args, **kwargs):
        # Skriv mock headers
        headers_file = tmp_path / 'ao_headers.txt'
        headers_file.write_text(
            'HTTP/1.1 200 OK\r\n'
            'Set-Cookie: __RequestVerificationToken=COOKIE123; path=/\r\n'
            'Set-Cookie: .ASPXAUTHNO=REFRESHED456; path=/; HttpOnly\r\n'
            '\r\n'
        )

        # Skriv mock cookies (Netscape format)
        cookies_file = tmp_path / 'ao_cookies.txt'
        cookies_file.write_text(
            '# Netscape HTTP Cookie File\n'
            'artsobservasjoner.no\tFALSE\t/\tTRUE\t0\t__RequestVerificationToken\tCOOKIE123\n'
        )

        # Return HTML med form token
        html = '<input name="__RequestVerificationToken" value="FORM789" />'
        return MockSubprocessResult(stdout=html)

    # Patch subprocess.run og /tmp file paths
    monkeypatch.setattr('subprocess.run', fake_run)

    # Patch file open til å bruke tmp_path
    original_open = open

    def fake_open(path, *args, **kwargs):
        if '/tmp/ao_headers.txt' in str(path):
            return original_open(tmp_path / 'ao_headers.txt', *args, **kwargs)
        elif '/tmp/ao_cookies.txt' in str(path):
            return original_open(tmp_path / 'ao_cookies.txt', *args, **kwargs)
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr('builtins.open', fake_open)

    # Test
    form_token, cookie_token, refreshed_auth = fetch_csrf_tokens('LOGIN123', 'AUTH456')

    assert form_token == 'FORM789'
    assert cookie_token == 'COOKIE123'
    assert refreshed_auth == 'REFRESHED456'


def test_fetch_csrf_tokens_httponly_cookie(monkeypatch, tmp_path):
    """Test parsing av HttpOnly cookies (prefix #HttpOnly_)."""
    def fake_run(args, **kwargs):
        headers_file = tmp_path / 'ao_headers.txt'
        headers_file.write_text('HTTP/1.1 200 OK\r\n\r\n')

        # HttpOnly cookie med prefix
        cookies_file = tmp_path / 'ao_cookies.txt'
        cookies_file.write_text(
            '#HttpOnly_artsobservasjoner.no\tFALSE\t/\tTRUE\t0\t__RequestVerificationToken\tHTTPONLY789\n'
        )

        html = '<input name="__RequestVerificationToken" value="FORMTOKEN" />'
        return MockSubprocessResult(stdout=html)

    monkeypatch.setattr('subprocess.run', fake_run)

    original_open = open

    def fake_open(path, *args, **kwargs):
        if '/tmp/' in str(path):
            filename = os.path.basename(path)
            return original_open(tmp_path / filename, *args, **kwargs)
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr('builtins.open', fake_open)

    form_token, cookie_token, refreshed_auth = fetch_csrf_tokens('LOGIN', 'AUTH')

    assert cookie_token == 'HTTPONLY789'
    assert form_token == 'FORMTOKEN'


# ============================================================================
# Del 3: post_with_curl Integration
# ============================================================================

def test_post_with_curl_success(monkeypatch, tmp_path):
    """Test vellykket post til AO med curl."""
    # Mock fetch_csrf_tokens
    def fake_fetch_csrf(login_token, auth_cookie):
        return ('FORM123', 'COOKIE456', 'REFRESHED789')

    monkeypatch.setattr('src.ao_import_curl.fetch_csrf_tokens', fake_fetch_csrf)

    # Mock subprocess.run for POST
    post_called = []

    def fake_run(args, **kwargs):
        # Sjekk om dette er POST-kallet
        if 'ParseObservations' in str(args):
            post_called.append(True)
            # Returner success-HTML med status 200
            html = '<html><body>Import vellykket</body></html>\n200'
            return MockSubprocessResult(stdout=html)
        # Ellers returner default
        return MockSubprocessResult(stdout='')

    monkeypatch.setattr('subprocess.run', fake_run)

    # Mock time.sleep
    monkeypatch.setattr('time.sleep', lambda x: None)

    # Mock publish_all
    def fake_publish(login_token, auth_cookie):
        return {'status': '200'}

    monkeypatch.setattr('src.ao_import_curl.publish_all', fake_publish)

    # Mock file writes
    write_calls = []

    original_open = open

    def fake_open(path, *args, **kwargs):
        if '/tmp/' in str(path) and 'w' in args:
            # Mock write
            class FakeFile:
                def write(self, content):
                    write_calls.append((path, content))

                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    pass

            return FakeFile()
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr('builtins.open', fake_open)

    # Test
    observations = [
        {'species': {'taxonName': 'Gråspurv'}, 'count': '1', 'timestamp': '2024-01-15T14:00:00Z', 'placeName': 'Oslo'}
    ]
    result = post_with_curl(observations, 'LOGIN123', 'AUTH456')

    assert result['success'] is True
    assert result['count'] == 1
    assert result['published'] is True
    assert result['refreshedAuthCookie'] == 'REFRESHED789'
    assert len(post_called) > 0


# ============================================================================
# Del 4: publish_all Flow
# ============================================================================

def test_publish_all_success(monkeypatch, tmp_path):
    """Test vellykket publisering."""
    call_count = [0]

    def fake_run(args, **kwargs):
        call_count[0] += 1

        # Første kall: GET ReviewSighting
        if call_count[0] == 1:
            headers_file = tmp_path / 'ao_review_headers.txt'
            headers_file.write_text('HTTP/1.1 200 OK\r\n\r\n')

            cookies_file = tmp_path / 'ao_review_cookies.txt'
            cookies_file.write_text(
                'artsobservasjoner.no\tFALSE\t/\tTRUE\t0\t__RequestVerificationToken\tREVIEWCOOKIE\n'
            )

            html = '<input name="__RequestVerificationToken" value="REVIEWFORM" />'
            return MockSubprocessResult(stdout=html)

        # Andre kall: POST PublishAll
        else:
            html = '<html>Success</html>\n200'
            return MockSubprocessResult(stdout=html)

    monkeypatch.setattr('subprocess.run', fake_run)

    # Mock file open
    original_open = open

    def fake_open(path, *args, **kwargs):
        if '/tmp/' in str(path):
            filename = os.path.basename(path)
            if 'w' in args:
                # Mock write
                class FakeFile:
                    def write(self, content):
                        pass

                    def __enter__(self):
                        return self

                    def __exit__(self, *args):
                        pass

                return FakeFile()
            else:
                return original_open(tmp_path / filename, *args, **kwargs)
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr('builtins.open', fake_open)

    # Test
    result = publish_all('LOGIN123', 'AUTH456')

    assert result['status'] == '200'
    assert call_count[0] == 2  # GET + POST


# ============================================================================
# Del 5: API Endpoint Integration
# ============================================================================

def test_ao_import_endpoint(monkeypatch):
    """Test /api/ao-import endpoint."""
    # Mock post_with_curl - må mocke der den brukes (i server.py)
    def fake_post(observations, login_token, auth_cookie, area_id=''):
        return {
            'success': True,
            'message': f'{len(observations)} observasjoner importert',
            'count': len(observations),
            'published': True,
            'refreshedAuthCookie': None
        }

    # Import server module først for å mocke i riktig kontekst
    import server
    monkeypatch.setattr('server.post_with_curl', fake_post)

    # Start server
    port = 38010
    srv = start_server(port)
    time.sleep(0.05)

    try:
        # Test request
        r = requests.post(
            f'http://127.0.0.1:{port}/api/ao-import',
            json={
                'observations': [
                    {'species': {'taxonName': 'Gråspurv'}, 'count': '1'},
                    {'species': {'taxonName': 'Skjære'}, 'count': '2'}
                ],
                'loginToken': 'LOGIN123',
                'authCookie': 'AUTH456'
            }
        )

        assert r.status_code == 200
        data = r.json()
        assert data['success'] is True
        assert data['count'] == 2
        assert data['published'] is True

    finally:
        srv.shutdown()


def test_ao_import_endpoint_missing_params():
    """Test /api/ao-import uten påkrevde parametere."""
    port = 38011
    srv = start_server(port)
    time.sleep(0.05)

    try:
        # Mangler loginToken
        r = requests.post(
            f'http://127.0.0.1:{port}/api/ao-import',
            json={
                'observations': [{'species': 'Gråspurv'}],
                'authCookie': 'AUTH456'
            }
        )
        assert r.status_code == 400

        # Mangler authCookie
        r = requests.post(
            f'http://127.0.0.1:{port}/api/ao-import',
            json={
                'observations': [{'species': 'Gråspurv'}],
                'loginToken': 'LOGIN123'
            }
        )
        assert r.status_code == 400

    finally:
        srv.shutdown()


# ============================================================================
# Del 6: Login Endpoint
# ============================================================================

def test_ao_login_endpoint(monkeypatch):
    """Test /api/ao-login endpoint."""
    # Mock login_to_ao - må mocke der den brukes (i server.py)
    def fake_login(username, password):
        if username == 'testuser' and password == 'testpass':
            return {
                'authCookie': 'TESTAUTHCOOKIE123',
                'loginToken': '12345:abcdef',
                'userId': '12345'
            }
        raise ValueError('Feil brukernavn eller passord')

    import server
    monkeypatch.setattr('server.login_to_ao', fake_login)

    # Start server
    port = 38012
    srv = start_server(port)
    time.sleep(0.05)

    try:
        # Test vellykket login
        r = requests.post(
            f'http://127.0.0.1:{port}/api/ao-login',
            json={
                'username': 'testuser',
                'password': 'testpass'
            }
        )

        assert r.status_code == 200
        data = r.json()
        assert data['success'] is True
        assert data['authCookie'] == 'TESTAUTHCOOKIE123'
        assert data['loginToken'] == '12345:abcdef'
        assert data['userId'] == '12345'

        # Test feil credentials
        r = requests.post(
            f'http://127.0.0.1:{port}/api/ao-login',
            json={
                'username': 'wronguser',
                'password': 'wrongpass'
            }
        )

        assert r.status_code == 401

    finally:
        srv.shutdown()


def test_ao_login_endpoint_missing_params():
    """Test /api/ao-login uten påkrevde parametere."""
    port = 38013
    srv = start_server(port)
    time.sleep(0.05)

    try:
        # Mangler password
        r = requests.post(
            f'http://127.0.0.1:{port}/api/ao-login',
            json={'username': 'testuser'}
        )
        assert r.status_code == 400

        # Mangler username
        r = requests.post(
            f'http://127.0.0.1:{port}/api/ao-login',
            json={'password': 'testpass'}
        )
        assert r.status_code == 400

    finally:
        srv.shutdown()
