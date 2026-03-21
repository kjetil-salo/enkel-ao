"""Tester for refaktorerte hjelpefunksjoner i api_handlers."""
import math
import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

from src.api_handlers import (
    _wgs84_to_mercator,
    _compute_bbox,
    _normalize_site,
    _resolve_super_sites,
    _mark_env_owned_sites,
    _ensure_auth,
)


# --- _wgs84_to_mercator ---

def test_wgs84_to_mercator_oslo():
    """Test konvertering av Oslo-koordinater."""
    x, y = _wgs84_to_mercator(59.9139, 10.7522)
    # Oslo i Web Mercator: x ~ 1196900, y ~ 8388600
    assert 1_190_000 < x < 1_200_000
    assert 8_380_000 < y < 8_400_000


def test_wgs84_to_mercator_equator():
    """Test at ekvator gir y=0."""
    x, y = _wgs84_to_mercator(0.0, 0.0)
    assert abs(x) < 1
    assert abs(y) < 1


def test_wgs84_to_mercator_negative():
    """Test negative koordinater (sørlig halvkule)."""
    x, y = _wgs84_to_mercator(-33.8688, 151.2093)  # Sydney
    assert x > 0
    assert y < 0


# --- _compute_bbox ---

def test_compute_bbox_symmetry():
    """Test at bbox er symmetrisk rundt senterpunktet."""
    bbox = _compute_bbox(60.0, 10.0, 1000)
    assert bbox['min_y'] < 60.0 < bbox['max_y']
    assert bbox['min_x'] < 10.0 < bbox['max_x']
    # Sjekk symmetri
    assert abs((bbox['max_y'] - 60.0) - (60.0 - bbox['min_y'])) < 1e-10
    assert abs((bbox['max_x'] - 10.0) - (10.0 - bbox['min_x'])) < 1e-10


def test_compute_bbox_size_proportional():
    """Test at større size gir større bbox."""
    small = _compute_bbox(60.0, 10.0, 100)
    large = _compute_bbox(60.0, 10.0, 10000)
    assert (large['max_y'] - large['min_y']) > (small['max_y'] - small['min_y'])
    assert (large['max_x'] - large['min_x']) > (small['max_x'] - small['min_x'])


def test_compute_bbox_minimum_size():
    """Test at bbox har minimum størrelse selv med size=0."""
    bbox = _compute_bbox(60.0, 10.0, 0)
    # size clampes til 1.0, så bbox bør være > 0
    assert bbox['max_y'] > bbox['min_y']
    assert bbox['max_x'] > bbox['min_x']


# --- _normalize_site ---

def test_normalize_site_standard():
    """Test normalisering med standard feltnavn."""
    raw = {'id': 42, 'name': 'Østensjøvannet', 'latitude': 59.91, 'longitude': 10.81}
    site = _normalize_site(raw, set())
    assert site['id'] == 42
    assert site['name'] == 'Østensjøvannet'
    assert site['lat'] == 59.91
    assert site['lon'] == 10.81


def test_normalize_site_alternate_keys():
    """Test normalisering med alternative feltnavn."""
    raw = {'Id': 5, 'Name': 'Sognsvann', 'Lat': 59.97, 'Lon': 10.73}
    site = _normalize_site(raw, set())
    assert site['id'] == 5
    assert site['name'] == 'Sognsvann'


def test_normalize_site_mine():
    """Test at site markeres som min."""
    raw = {'id': 42, 'name': 'Min lokasjon', 'lat': 60.0, 'lon': 10.0}
    site = _normalize_site(raw, {42})
    assert site.get('isMine') is True


def test_normalize_site_not_mine():
    """Test at andre sites ikke markeres som mine."""
    raw = {'id': 42, 'name': 'Andres lokasjon', 'lat': 60.0, 'lon': 10.0}
    site = _normalize_site(raw, {99, 100})
    assert 'isMine' not in site


def test_normalize_site_issuper_true():
    """Test superlokasjon-deteksjon fra eksplisitt flagg."""
    raw = {'id': 1, 'name': 'Super', 'lat': 60.0, 'lon': 10.0, 'isSuper': True}
    site = _normalize_site(raw, set())
    assert site['isSuper'] is True


def test_normalize_site_issuper_false():
    """Test at isSuper=false bevares."""
    raw = {'id': 1, 'name': 'Normal', 'lat': 60.0, 'lon': 10.0, 'isSuper': False}
    site = _normalize_site(raw, set())
    assert site['isSuper'] is False


def test_normalize_site_parent_implies_not_super():
    """Test at site med parentSiteId ikke er superlokasjon."""
    raw = {'id': 2, 'name': 'Sub', 'lat': 60.0, 'lon': 10.0, 'parentSiteId': 1}
    site = _normalize_site(raw, set())
    assert site['isSuper'] is False
    assert site['parentId'] == 1


# --- _resolve_super_sites ---

def test_resolve_super_sites():
    """Test at parent-referanser utleder superlokasjoner."""
    sites = [
        {'id': 1, 'name': 'Parent', 'raw': {'id': 1}},
        {'id': 2, 'name': 'Child', 'raw': {'id': 2, 'parentSiteId': 1}},
    ]
    _resolve_super_sites(sites)
    assert sites[0].get('isSuper') is True
    assert sites[1].get('isSuper') is False


def test_resolve_super_sites_no_parents():
    """Test at sites uten parent-referanser ikke endres."""
    sites = [
        {'id': 1, 'name': 'A', 'raw': {'id': 1}},
        {'id': 2, 'name': 'B', 'raw': {'id': 2}},
    ]
    _resolve_super_sites(sites)
    assert 'isSuper' not in sites[0]
    assert 'isSuper' not in sites[1]


def test_resolve_super_sites_orphan_parent():
    """Test at child med parent utenfor listen håndteres."""
    sites = [
        {'id': 2, 'name': 'Child', 'raw': {'id': 2, 'parentSiteId': 99}},
    ]
    _resolve_super_sites(sites)
    assert sites[0].get('isSuper') is False
    assert sites[0].get('parentId') == 99


# --- _mark_env_owned_sites ---

def test_mark_env_owned_sites(monkeypatch):
    """Test at sites merkes fra MY_AO_SITE_IDS."""
    monkeypatch.setenv('MY_AO_SITE_IDS', '42, 99')
    sites = [
        {'id': 42, 'name': 'Min'},
        {'id': 1, 'name': 'Andres'},
        {'id': 99, 'name': 'Min også'},
    ]
    _mark_env_owned_sites(sites)
    assert sites[0].get('isMine') is True
    assert 'isMine' not in sites[1]
    assert sites[2].get('isMine') is True


def test_mark_env_owned_sites_empty(monkeypatch):
    """Test at tom MY_AO_SITE_IDS ikke markerer noe."""
    monkeypatch.delenv('MY_AO_SITE_IDS', raising=False)
    sites = [{'id': 42, 'name': 'Test'}]
    _mark_env_owned_sites(sites)
    assert 'isMine' not in sites[0]


# --- _ensure_auth ---

def test_ensure_auth_no_credentials():
    """Test at _ensure_auth returnerer uendret uten credentials."""
    auth, refreshed = _ensure_auth(None, None, None)
    assert auth is None
    assert refreshed is None


def test_ensure_auth_auto_relogin(monkeypatch):
    """Test at auto-relogin trigger ved gyldige credentials."""
    monkeypatch.setattr(
        'src.api_handlers.auto_relogin_if_needed',
        lambda user_id, auth, login: 'new-cookie'
    )
    auth, refreshed = _ensure_auth('old-cookie', '12345', '12345:abc')
    assert auth == 'new-cookie'
    assert refreshed == 'new-cookie'


def test_ensure_auth_sliding_fallback(monkeypatch):
    """Test at sliding expiration brukes når auto-relogin ikke gir ny cookie."""
    monkeypatch.setattr(
        'src.api_handlers.auto_relogin_if_needed',
        lambda user_id, auth, login: None
    )
    monkeypatch.setattr(
        'src.api_handlers.refresh_ao_cookie_if_needed',
        lambda auth, user_id, login: 'sliding-cookie'
    )
    auth, refreshed = _ensure_auth('old-cookie', '12345', '12345:abc')
    assert auth == 'sliding-cookie'
    assert refreshed == 'sliding-cookie'


def test_ensure_auth_no_refresh_needed(monkeypatch):
    """Test at auth beholdes når ingen refresh trengs."""
    monkeypatch.setattr(
        'src.api_handlers.auto_relogin_if_needed',
        lambda user_id, auth, login: None
    )
    monkeypatch.setattr(
        'src.api_handlers.refresh_ao_cookie_if_needed',
        lambda auth, user_id, login: None
    )
    auth, refreshed = _ensure_auth('valid-cookie', '12345', '12345:abc')
    assert auth == 'valid-cookie'
    assert refreshed is None
