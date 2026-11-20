"""
Tester for brukerens egne arts-tall fra Artsobservasjoner (src/ao_species_stats.py
og /api/ao-my-species-stats). Mocker httpx.Client — ingen ekte AO-kall her, se
CLAUDE.md «Testkonto på Artsobservasjoner» for hvorfor.
"""

import os
import sys
import threading
from http.server import HTTPServer
from unittest.mock import Mock

import requests

REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

from src.ao_species_stats import hent_mine_artstall
from server import Handler


def start_server(port):
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def _mock_client(get_resp, post_resp):
    client = Mock()
    client.__enter__ = Mock(return_value=client)
    client.__exit__ = Mock(return_value=None)
    client.get = Mock(return_value=get_resp)
    client.post = Mock(return_value=post_resp)
    return client


def _resp(status=200, text='', url='https://www.artsobservasjoner.no/User/MyPages', payload=None):
    r = Mock()
    r.status_code = status
    r.text = text
    r.url = url
    r.json = Mock(return_value=payload if payload is not None else {})
    return r


MYPAGES_HTML = '<html><body><input type="hidden" name="__RequestVerificationToken" value="TOK123" /></body></html>'

SHORT_OVERVIEW_JSON = {
    'overviewListTotal': [
        {'SpeciesGroup': {'Id': 8, 'ResourceLabelLocalized': 'Fugler'}, 'Count': 337},
        {'SpeciesGroup': {'Id': 11, 'ResourceLabelLocalized': 'Pattedyr'}, 'Count': 10},
    ],
    'overviewListYear': [
        {'SpeciesGroup': {'Id': 8, 'ResourceLabelLocalized': 'Fugler'}, 'Count': 220},
        {'SpeciesGroup': {'Id': 11, 'ResourceLabelLocalized': 'Pattedyr'}, 'Count': 1},
    ],
}


# ============================================================================
# hent_mine_artstall()
# ============================================================================

def test_happy_path_plukker_ut_fugler(monkeypatch):
    client = _mock_client(_resp(text=MYPAGES_HTML), _resp(payload=SHORT_OVERVIEW_JSON))
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    resultat = hent_mine_artstall('LOGIN', 'AUTH')

    assert resultat == {'fuglerTotalt': 337, 'fuglerIAr': 220}


def test_cookies_settes_pa_klienten(monkeypatch):
    sett = {}

    def fake_client(**kw):
        sett.update(kw)
        return _mock_client(_resp(text=MYPAGES_HTML), _resp(payload=SHORT_OVERVIEW_JSON))

    monkeypatch.setattr('httpx.Client', fake_client)
    hent_mine_artstall('LOGIN', 'AUTH')

    assert sett['cookies']['logintoken'] == 'LOGIN'
    assert sett['cookies']['.ASPXAUTHNO'] == 'AUTH'


def test_post_sender_token_fra_siden(monkeypatch):
    client = _mock_client(_resp(text=MYPAGES_HTML), _resp(payload=SHORT_OVERVIEW_JSON))
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    hent_mine_artstall('LOGIN', 'AUTH')

    _, kwargs = client.post.call_args
    assert kwargs['data']['__RequestVerificationToken'] == 'TOK123'


def test_utlopt_sesjon_gir_none(monkeypatch):
    client = _mock_client(
        _resp(text=MYPAGES_HTML, url='https://www.artsobservasjoner.no/LogOn?ReturnUrl=%2fUser%2fMyPages'),
        _resp(payload=SHORT_OVERVIEW_JSON),
    )
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    assert hent_mine_artstall('LOGIN', 'AUTH') is None
    client.post.assert_not_called()


def test_mangler_token_pa_siden_gir_none(monkeypatch):
    client = _mock_client(_resp(text='<html><body>ingen token her</body></html>'), _resp(payload=SHORT_OVERVIEW_JSON))
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    assert hent_mine_artstall('LOGIN', 'AUTH') is None
    client.post.assert_not_called()


def test_post_feiler_gir_none(monkeypatch):
    client = _mock_client(_resp(text=MYPAGES_HTML), _resp(status=500, payload=SHORT_OVERVIEW_JSON))
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    assert hent_mine_artstall('LOGIN', 'AUTH') is None


def test_ingen_fugler_i_svar_gir_null_ikke_ukjent(monkeypatch):
    """Tom liste er et GYLDIG svar — mangler Fugler-raden har brukeren 0 funn,
    ikke «ukjent». Se `_finn_fugler_antall()`."""
    tomt_svar = {'overviewListTotal': [], 'overviewListYear': []}
    client = _mock_client(_resp(text=MYPAGES_HTML), _resp(payload=tomt_svar))
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    assert hent_mine_artstall('LOGIN', 'AUTH') == {'fuglerTotalt': 0, 'fuglerIAr': 0}


def test_uventet_svarform_gir_none(monkeypatch):
    """Mangler selve nøklene (ikke bare en tom liste), er det AO som har endret
    svarformen — ekte «ukjent», ikke «0 arter»."""
    client = _mock_client(_resp(text=MYPAGES_HTML), _resp(payload={'noeAnnet': True}))
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    assert hent_mine_artstall('LOGIN', 'AUTH') is None


def test_unntak_fanges_og_gir_none(monkeypatch):
    def eksploder(**kw):
        raise RuntimeError('nettverksfeil')
    monkeypatch.setattr('httpx.Client', eksploder)

    assert hent_mine_artstall('LOGIN', 'AUTH') is None


# ============================================================================
# Endepunktet /api/ao-my-species-stats
# ============================================================================

def test_endepunkt_uten_tokens_svarer_degradert_og_200():
    port = 8781
    server = start_server(port)
    try:
        r = requests.post(f'http://localhost:{port}/api/ao-my-species-stats', json={}, timeout=5)
        assert r.status_code == 200
        assert r.json() == {'fuglerTotalt': None, 'fuglerIAr': None}
    finally:
        server.shutdown()


def test_endepunkt_svarer_med_tall(monkeypatch):
    monkeypatch.setattr('server.hent_mine_artstall',
                        lambda lt, ac: {'fuglerTotalt': 337, 'fuglerIAr': 220})
    port = 8782
    server = start_server(port)
    try:
        r = requests.post(f'http://localhost:{port}/api/ao-my-species-stats',
                          json={'loginToken': 'L', 'authCookie': 'A'}, timeout=5)
        assert r.status_code == 200
        assert r.json() == {'fuglerTotalt': 337, 'fuglerIAr': 220}
    finally:
        server.shutdown()


def test_endepunkt_degraderer_ved_ao_feil(monkeypatch):
    monkeypatch.setattr('server.hent_mine_artstall',
                        lambda *a, **kw: (_ for _ in ()).throw(RuntimeError('AO nede')))
    port = 8783
    server = start_server(port)
    try:
        r = requests.post(f'http://localhost:{port}/api/ao-my-species-stats',
                          json={'loginToken': 'L', 'authCookie': 'A'}, timeout=5)
        assert r.status_code == 200
        assert r.json() == {'fuglerTotalt': None, 'fuglerIAr': None}
    finally:
        server.shutdown()
