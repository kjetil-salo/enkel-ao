"""Miljømerking av hjemskjerm-ikonet (APP_ENV=staging).

Staging og prod serverer identiske filer. Uten merking får begge navnet
«Enkel-AO» og samme ikon, og man kan registrere ekte funn i testmiljøet
uten å oppdage det.
"""
import json
import os
import sys
import threading
from http.server import HTTPServer

import requests

REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

import server as server_module
from server import Handler

PUBLIC_DIR = os.path.join(REPO_ROOT, 'public')


def start_server(port):
    srv = HTTPServer(('', port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def test_prod_serverer_manifest_og_index_umerket(monkeypatch):
    """Uten APP_ENV skal alt se ut akkurat som før.

    Suffikset settes eksplisitt tomt, slik at testen ikke avhenger av om
    APP_ENV tilfeldigvis står i miljøet der testene kjøres.
    """
    monkeypatch.setattr(server_module, 'APP_NAME_SUFFIX', '')
    port = 38071
    srv = start_server(port)
    try:
        manifest = requests.get(f'http://127.0.0.1:{port}/manifest.json').json()
        assert manifest['short_name'] == 'Enkel-AO'
        assert manifest['name'] == 'Enkel-AO'
        assert not manifest['description'].startswith('TESTMILJØ')
        assert {i['src'] for i in manifest['icons']} == {
            '/favicon.png', '/icon-192.png', '/icon-512.png'
        }

        html = requests.get(f'http://127.0.0.1:{port}/').text
        assert 'name="apple-mobile-web-app-title" content="Enkel-AO"' in html
        assert 'href="/apple-touch-icon.png"' in html
        assert 'staging' not in html
    finally:
        srv.shutdown()


def test_staging_merker_navn_og_ikon(monkeypatch):
    """APP_ENV=staging gir «-S» på navnet og nedtonede ikoner."""
    monkeypatch.setattr(server_module, 'APP_NAME_SUFFIX', '-S')
    port = 38072
    srv = start_server(port)
    try:
        r = requests.get(f'http://127.0.0.1:{port}/manifest.json')
        assert r.headers['Content-Type'].startswith('application/manifest+json')
        # Cloudflare cacher ellers manifestet i en time.
        assert 'no-cache' in r.headers['Cache-Control']

        manifest = r.json()
        # short_name er det som faktisk står under ikonet på hjemskjermen.
        assert manifest['short_name'] == 'Enkel-AO-S'
        assert manifest['name'] == 'Enkel-AO-S'
        assert manifest['description'].startswith('TESTMILJØ')
        assert {i['src'] for i in manifest['icons']} == {
            '/favicon-staging.png', '/icon-staging-192.png', '/icon-staging-512.png'
        }

        # iOS leser navnet fra HTML-en, ikke fra manifestet.
        html = requests.get(f'http://127.0.0.1:{port}/').text
        assert 'name="apple-mobile-web-app-title" content="Enkel-AO-S"' in html
        assert 'href="/apple-touch-icon-staging.png"' in html
        assert 'href="/favicon-staging.png"' in html
        # og:site_name skal IKKE ha blitt truffet av navneerstatningen.
        assert 'property="og:site_name" content="Enkel-AO"' in html
    finally:
        srv.shutdown()


def test_nedtonede_ikonfiler_finnes():
    """Manifestet peker på disse — mangler de, får staging et tomt ikon."""
    for navn in server_module.STAGING_ICON_MAP.values():
        sti = os.path.join(PUBLIC_DIR, navn.lstrip('/'))
        assert os.path.isfile(sti), f'Mangler {navn}'
        assert os.path.getsize(sti) > 0


def test_manifest_i_repo_matcher_ikonkartet():
    """Nytt ikon i manifest.json uten staging-variant ville blitt servert farget."""
    with open(os.path.join(PUBLIC_DIR, 'manifest.json'), encoding='utf-8') as f:
        manifest = json.load(f)
    for icon in manifest['icons']:
        assert icon['src'] in server_module.STAGING_ICON_MAP, (
            f"{icon['src']} mangler en nedtonet variant i STAGING_ICON_MAP"
        )
