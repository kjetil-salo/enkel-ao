"""Tester for medobs-backupen (/api/medobs-load, /api/medobs-save)."""
import os
import sys
import tempfile
import threading
import time
from http.server import HTTPServer

import pytest
import requests

REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

# Isolert temp-DB før medobs_store importeres (leser DB_PATH ved import).
_TMP_DB = os.path.join(tempfile.mkdtemp(), 'medobs_test.db')
os.environ['DB_PATH'] = _TMP_DB

from src import medobs_store  # noqa: E402
from server import Handler  # noqa: E402

medobs_store.DB_PATH = _TMP_DB
medobs_store.init_db()


def start_server(port):
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def test_save_and_load_roundtrip():
    lst = [{'name': 'Kari', 'active': True}, {'name': 'Ola', 'active': False}]
    assert medobs_store.save_list('testbruker', lst) is True
    assert medobs_store.load_list('testbruker') == lst


def test_load_unknown_username_gir_tom_liste():
    assert medobs_store.load_list('finnes-ikke') == []


def test_tomt_username_avvises():
    assert medobs_store.save_list('', [{'name': 'Kari', 'active': False}]) is False
    assert medobs_store.load_list('') == []


def test_ugyldig_liste_avvises():
    assert medobs_store.save_list('bruker2', 'ikke-en-liste') is False


def test_for_mange_rader_kappes():
    lst = [{'name': f'Navn{i}', 'active': False} for i in range(80)]
    medobs_store.save_list('mangerader', lst)
    lagret = medobs_store.load_list('mangerader')
    assert len(lagret) == medobs_store.MAX_ITEMS


def test_for_langt_navn_kappes():
    lst = [{'name': 'x' * 500, 'active': False}]
    medobs_store.save_list('langtnavn', lst)
    lagret = medobs_store.load_list('langtnavn')
    assert len(lagret[0]['name']) == medobs_store.MAX_NAME_LEN


def test_ukjente_felt_droppes():
    lst = [{'name': 'Kari', 'active': True, 'ekstra': 'skal bort'}]
    medobs_store.save_list('ekstrafelt', lst)
    lagret = medobs_store.load_list('ekstrafelt')
    assert lagret == [{'name': 'Kari', 'active': True}]


def test_alias_overlever_rundturen():
    """Alias skiller to personer med samme navn hos AO. Mister serveren det, sletter
    refreshMedobsFromServer() det lokalt også (funnet 25.11.2026)."""
    lst = [{'name': 'Ola Nordmann', 'alias': 'olanor', 'active': False},
           {'name': 'Kari', 'active': True}]
    medobs_store.save_list('alias', lst)
    assert medobs_store.load_list('alias') == [
        {'name': 'Ola Nordmann', 'active': False, 'alias': 'olanor'},
        {'name': 'Kari', 'active': True},
    ]


def test_overskriver_ved_ny_lagring():
    medobs_store.save_list('overskriv', [{'name': 'Først', 'active': False}])
    medobs_store.save_list('overskriv', [{'name': 'Sist', 'active': True}])
    assert medobs_store.load_list('overskriv') == [{'name': 'Sist', 'active': True}]


def test_endepunkt_save_og_load_end_to_end():
    port = 38090
    srv = start_server(port)
    time.sleep(0.05)
    try:
        r = requests.post(f'http://127.0.0.1:{port}/api/medobs-save', json={
            'username': 'e2ebruker',
            'list': [{'name': 'Per', 'active': True}],
        })
        assert r.status_code == 200
        assert r.json()['ok'] is True

        r2 = requests.post(f'http://127.0.0.1:{port}/api/medobs-load', json={'username': 'e2ebruker'})
        assert r2.status_code == 200
        assert r2.json()['list'] == [{'name': 'Per', 'active': True}]
    finally:
        srv.shutdown()


def test_endepunkt_load_uten_lagring_gir_tom_liste():
    port = 38091
    srv = start_server(port)
    time.sleep(0.05)
    try:
        r = requests.post(f'http://127.0.0.1:{port}/api/medobs-load', json={'username': 'aldri-lagret'})
        assert r.status_code == 200
        assert r.json() == {'list': []}
    finally:
        srv.shutdown()


def test_endepunkt_save_uten_username_avvises():
    port = 38092
    srv = start_server(port)
    time.sleep(0.05)
    try:
        r = requests.post(f'http://127.0.0.1:{port}/api/medobs-save', json={
            'list': [{'name': 'Per', 'active': True}],
        })
        assert r.status_code == 400
        assert r.json()['ok'] is False
    finally:
        srv.shutdown()


def test_endepunkt_save_med_ugyldig_liste_avvises():
    port = 38093
    srv = start_server(port)
    time.sleep(0.05)
    try:
        r = requests.post(f'http://127.0.0.1:{port}/api/medobs-save', json={
            'username': 'bruker',
            'list': 'ikke-en-liste',
        })
        assert r.status_code == 400
        assert r.json()['ok'] is False
    finally:
        srv.shutdown()


def test_for_stor_body_avvises_for_den_leses():
    port = 38094
    srv = start_server(port)
    time.sleep(0.05)
    try:
        r = requests.post(f'http://127.0.0.1:{port}/api/medobs-save', json={
            'username': 'bruker',
            'list': [{'name': 'x' * 100, 'active': False}] * 2000,
        })
        assert r.status_code == 413
        assert r.json()['ok'] is False
    finally:
        srv.shutdown()
