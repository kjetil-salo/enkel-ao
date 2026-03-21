"""Tester for hjelpefunksjoner: mask_token, parse_user_agent, CORS."""
import threading
import time
import os
import sys
from http.server import HTTPServer
import requests

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)


# --- mask_token ---

def test_mask_token_normal():
    """Test masking av vanlig token."""
    from src.utils import mask_token
    assert mask_token('abcdefghijk') == 'abcdef***'


def test_mask_token_short():
    """Test masking av kort token."""
    from src.utils import mask_token
    result = mask_token('abc')
    assert result == 'abc***'


def test_mask_token_none():
    """Test masking av None-verdi."""
    from src.utils import mask_token
    assert mask_token(None) == 'None'


def test_mask_token_empty():
    """Test masking av tom streng."""
    from src.utils import mask_token
    assert mask_token('') == 'None'


def test_mask_token_custom_visible():
    """Test masking med egendefinert antall synlige tegn."""
    from src.utils import mask_token
    assert mask_token('abcdefghijk', visible=3) == 'abc***'


# --- parse_user_agent ---

def test_parse_user_agent_mobile():
    """Test parsing av mobil user agent."""
    from src.utils import parse_user_agent
    ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    result = parse_user_agent(ua)
    assert result['device_type'] == 'mobile'
    assert result['os'] == 'iOS'
    assert result['browser'] == 'Mobile Safari'


def test_parse_user_agent_desktop():
    """Test parsing av desktop user agent."""
    from src.utils import parse_user_agent
    ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    result = parse_user_agent(ua)
    assert result['device_type'] == 'desktop'
    assert 'Windows' in result['os']
    assert result['browser'] == 'Chrome'


def test_parse_user_agent_bot():
    """Test parsing av bot user agent."""
    from src.utils import parse_user_agent
    ua = 'Googlebot/2.1 (+http://www.google.com/bot.html)'
    result = parse_user_agent(ua)
    assert result['device_type'] == 'bot'


def test_parse_user_agent_empty():
    """Test parsing av tom user agent."""
    from src.utils import parse_user_agent
    result = parse_user_agent('')
    assert result['device_type'] == 'unknown'
    assert result['os'] == 'unknown'
    assert result['browser'] == 'unknown'


def test_parse_user_agent_none():
    """Test parsing av None user agent."""
    from src.utils import parse_user_agent
    result = parse_user_agent(None)
    assert result['device_type'] == 'unknown'


def test_parse_user_agent_android():
    """Test parsing av Android user agent."""
    from src.utils import parse_user_agent
    ua = 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    result = parse_user_agent(ua)
    assert result['device_type'] == 'mobile'
    assert result['os'] == 'Android'
    assert result['browser'] == 'Chrome Mobile'


# --- CORS (OPTIONS) ---

def test_cors_preflight():
    """Test at OPTIONS returnerer CORS-headers."""
    from server import Handler

    port = 38080
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.05)

    r = requests.options(f'http://127.0.0.1:{port}/api/logview')
    assert r.status_code == 200
    assert r.headers.get('Access-Control-Allow-Origin') == '*'
    assert 'POST' in r.headers.get('Access-Control-Allow-Methods', '')
    assert 'X-AO-Login-Token' in r.headers.get('Access-Control-Allow-Headers', '')

    server.shutdown()


# --- POST til ukjent endepunkt ---

def test_post_unknown_endpoint():
    """Test at POST til ukjent endepunkt gir 404."""
    from server import Handler

    port = 38081
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.05)

    r = requests.post(f'http://127.0.0.1:{port}/api/nonexistent')
    assert r.status_code == 404

    server.shutdown()
