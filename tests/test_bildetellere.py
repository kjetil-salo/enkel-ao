"""
Tester for tellerne som måler bildeopplasting til Artsobservasjoner.

To vaner skilles med vilje: bilder som følger selve sendingen, og bilder som
legges på et allerede publisert funn når man kommer hjem med kamera.

Det viktigste disse vokter er at tellerne ikke lyver. De telles serverside ved
faktisk opplasting, og et bilde som ikke kom fram skal ikke se ut som ett som
gjorde det.
"""

import os
import sys
import threading
from http.server import HTTPServer

import pytest
import requests

REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

from src import stats_store
import server
from server import Handler, _tell_bilder_ved_sending


def start_server(port):
    srv = HTTPServer(('', port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


@pytest.fixture
def talte(monkeypatch):
    """Fang hendelsene som logges, i stedet for å skrive til databasen."""
    hendelser = []
    monkeypatch.setattr(stats_store, 'log_export', lambda t: hendelser.append(t) or True)
    monkeypatch.setattr(server.stats_store, 'log_export', lambda t: hendelser.append(t) or True)
    return hendelser


def _obs(med_bilde):
    o = {'species': {'taxonName': 'gråspurv'}, 'count': '1'}
    if med_bilde:
        o['photo'] = 'data:image/jpeg;base64,AAA'
    return o


# ============================================================================
# Bilder som følger sendingen
# ============================================================================

def test_teller_ett_per_bilde_som_kom_fram(talte):
    obs = [_obs(True), _obs(True), _obs(False)]

    _tell_bilder_ved_sending(obs, {'success': True})

    assert talte == [stats_store.BILDE_VED_SENDING] * 2


def test_teller_ikke_bilder_som_feilet(talte):
    """
    `imagesFailed` er bilder AO ikke tok imot. Å telle dem ville gjort
    statistikken til et mål på forsøk, ikke på bilder som faktisk ligger der.
    """
    obs = [_obs(True), _obs(True), _obs(True)]

    _tell_bilder_ved_sending(obs, {'success': True, 'imagesFailed': ['gråspurv', 'kjøttmeis']})

    assert talte == [stats_store.BILDE_VED_SENDING]


def test_teller_ingenting_uten_bilder(talte):
    _tell_bilder_ved_sending([_obs(False), _obs(False)], {'success': True})

    assert talte == []


def test_alle_bilder_feilet_gir_null(talte):
    obs = [_obs(True)]

    _tell_bilder_ved_sending(obs, {'success': True, 'imagesFailed': ['gråspurv']})

    assert talte == []


def test_flere_feilede_enn_vedlagte_gir_ikke_negativt(talte):
    """Et uventet svar fra AO skal ikke kunne gi en meningsløs telling."""
    _tell_bilder_ved_sending([_obs(True)], {'imagesFailed': ['a', 'b', 'c']})

    assert talte == []


def test_telling_kan_aldri_velte_sendingen(talte, monkeypatch):
    """
    Statistikk er det minst viktige som skjer her. En feil i tellingen skal aldri
    boble opp og ødelegge en sending som allerede er fullført hos AO.
    """
    def eksploder(_):
        raise RuntimeError('databasen er borte')
    monkeypatch.setattr(server.stats_store, 'log_export', eksploder)

    _tell_bilder_ved_sending([_obs(True)], {'success': True})   # skal ikke kaste


# ============================================================================
# Bilder lagt på i etterkant
# ============================================================================

def test_teller_bilde_lagt_pa_publisert_funn(talte, monkeypatch):
    monkeypatch.setattr(server, 'upload_photo_to_published_sighting',
                        lambda *a, **kw: {'ok': True, 'imageId': 1, 'verified': True})
    srv = start_server(8781)
    try:
        r = requests.post('http://localhost:8781/api/ao-upload-image',
                          json={'sightingId': 42, 'photo': 'data:image/jpeg;base64,AAA',
                                'loginToken': 'L', 'authCookie': 'A'}, timeout=5)
        assert r.json()['ok'] is True
    finally:
        srv.shutdown()

    assert talte == [stats_store.BILDE_ETTERPA]


def test_teller_ikke_mislykket_opplasting(talte, monkeypatch):
    monkeypatch.setattr(server, 'upload_photo_to_published_sighting',
                        lambda *a, **kw: {'ok': False, 'error': 'AO tok ikke imot bildet'})
    srv = start_server(8782)
    try:
        requests.post('http://localhost:8782/api/ao-upload-image',
                      json={'sightingId': 42, 'photo': 'data:image/jpeg;base64,AAA',
                            'loginToken': 'L', 'authCookie': 'A'}, timeout=5)
    finally:
        srv.shutdown()

    assert talte == []


# ============================================================================
# Hendelsestypene
# ============================================================================

def test_de_to_bildetypene_er_atskilte():
    """Blandes de, mister vi nettopp skillet tellerne finnes for å vise."""
    assert stats_store.BILDE_VED_SENDING != stats_store.BILDE_ETTERPA
    assert stats_store.BILDE_VED_SENDING in stats_store.KJENTE_HENDELSER
    assert stats_store.BILDE_ETTERPA in stats_store.KJENTE_HENDELSER


def test_eksporthendelsene_er_fortsatt_gyldige():
    """De gamle typene må bli værende — /api/log-export bruker samme hviteliste."""
    assert 'copy_open' in stats_store.KJENTE_HENDELSER
    assert 'direct' in stats_store.KJENTE_HENDELSER


def test_ukjent_hendelsestype_avvises(talte):
    srv = start_server(8783)
    try:
        requests.post('http://localhost:8783/api/log-export',
                      json={'type': 'noe-helt-annet'}, timeout=5)
    finally:
        srv.shutdown()

    assert talte == ['unknown']
