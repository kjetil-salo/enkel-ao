"""Tester for refaktorerte hjelpefunksjoner i api_handlers."""
import json
import math
import os
import sys
import tempfile

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


def test_compute_bbox_covers_full_radius():
    """Bbox skal dekke full søkeradius — ikke bare halvparten.

    search_nearby() bruker haversine-radius = size_m. _compute_bbox() må strekke
    seg minst size_m meter i hver kardinalretning slik at AO-resultater og lokal
    DB-treff er konsistente (ingen sites havner i lokal DB men utenfor AO-bbox).
    """
    import math
    size_m = 1000
    bbox = _compute_bbox(60.0, 10.0, size_m)
    meters_per_deg_lat = 111_320.0
    half_lat_m = (bbox['max_y'] - bbox['min_y']) / 2 * meters_per_deg_lat
    assert half_lat_m >= size_m * 0.99, (
        f'Bbox dekker bare {half_lat_m:.0f}m nord/sør, forventet minst {size_m}m'
    )


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


def test_normalize_site_municipality():
    """Test at kommune og fylke fra AO tas med."""
    raw = {'id': 3, 'name': 'Storevatnet', 'lat': 60.0, 'lon': 10.0,
           'municipalityName': 'Bergen', 'countyName': 'Vestland'}
    site = _normalize_site(raw, set())
    assert site['municipality'] == 'Bergen'
    assert site['county'] == 'Vestland'


def test_normalize_site_without_municipality():
    """Test at manglende kommune ikke gir tomme felt."""
    raw = {'id': 4, 'name': 'Uten kommune', 'lat': 60.0, 'lon': 10.0}
    site = _normalize_site(raw, set())
    assert 'municipality' not in site
    assert 'county' not in site


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


def test_resolve_super_sites_string_vs_int_id():
    """Test at int site-ID og string parentSiteId (eller omvendt) matches korrekt."""
    # AO returnerer noen ganger id som int men parentSiteId som string
    sites = [
        {'id': 1, 'name': 'Parent', 'raw': {'id': 1}},
        {'id': 2, 'name': 'Child', 'raw': {'id': 2, 'parentSiteId': '1'}},
    ]
    _resolve_super_sites(sites)
    assert sites[0].get('isSuper') is True
    assert sites[1].get('isSuper') is False


def test_resolve_super_sites_pascal_case_parent():
    """Test at PascalCase ParentSiteId gjenkjennes."""
    sites = [
        {'id': 10, 'name': 'Parent', 'raw': {'id': 10}},
        {'id': 20, 'name': 'Child', 'raw': {'id': 20, 'ParentSiteId': 10}},
    ]
    _resolve_super_sites(sites)
    assert sites[0].get('isSuper') is True
    assert sites[1].get('isSuper') is False


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


def test_ensure_auth_sliding_returns_new_cookie(monkeypatch):
    """Test at sliding expiration returnerer ny cookie."""
    monkeypatch.setattr(
        'src.api_handlers._sliding_expiration',
        lambda auth, user_id, login: 'new-cookie'
    )
    auth, refreshed = _ensure_auth('old-cookie', '12345', '12345:abc')
    assert auth == 'new-cookie'
    assert refreshed == 'new-cookie'


def test_ensure_auth_full_relogin_fallback(monkeypatch):
    """Test at full relogin brukes når sliding feiler og cookie er utløpt."""
    monkeypatch.setattr(
        'src.api_handlers._sliding_expiration',
        lambda auth, user_id, login: None
    )
    monkeypatch.setattr(
        'src.api_handlers._is_cookie_expired',
        lambda auth, user_id, login: True
    )
    monkeypatch.setattr(
        'src.api_handlers._full_relogin',
        lambda user_id, login, username=None: 'relogin-cookie'
    )
    auth, refreshed = _ensure_auth('old-cookie', '12345', '12345:abc')
    assert auth == 'relogin-cookie'
    assert refreshed == 'relogin-cookie'


def test_ensure_auth_no_refresh_needed(monkeypatch):
    """Test at auth beholdes når sliding ikke gir ny cookie og cookie er gyldig."""
    monkeypatch.setattr(
        'src.api_handlers._sliding_expiration',
        lambda auth, user_id, login: None
    )
    monkeypatch.setattr(
        'src.api_handlers._is_cookie_expired',
        lambda auth, user_id, login: False
    )
    auth, refreshed = _ensure_auth('valid-cookie', '12345', '12345:abc')
    assert auth == 'valid-cookie'
    assert refreshed is None


# --- _save_credentials / _load_credentials ---
#
# Nøkkelen er brukernavn (case-insensitive), IKKE AOs "user_id" — det tallet
# viste seg IKKE stabilt per AO-konto (samme konto fikk 309 forskjellige
# user_id-verdier i prod). Passordet utleveres bare mot et logintoken fra en
# innlogging med det. Se _load_credentials-docstring i src/api_handlers.py.

def test_credentials_roundtrip(monkeypatch):
    """Credentials lagres og lastes fra disk, nøkkel = brukernavn, bundet til logintoken."""
    from src.api_handlers import _save_credentials, _load_credentials

    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f:
        tmp_path = f.name

    try:
        monkeypatch.setattr('src.api_handlers._CREDENTIALS_PATH', tmp_path)

        _save_credentials('testuser', 'testpass', '111:token-a')

        # Case-insensitive oppslag, original username-casing bevares i verdien
        assert _load_credentials('testuser', '111:token-a') == ('testuser', 'testpass')
        assert _load_credentials('TestUser', '111:token-a') == ('testuser', 'testpass')

        assert _load_credentials('ukjentbruker', '111:token-a') is None
    finally:
        os.unlink(tmp_path)


def test_credentials_krever_logintoken_fra_innloggingen(monkeypatch):
    """Brukernavnet alene gir ikke passordet — det var et hull der hvem som helst
    kunne få en AO-sesjon for en annen bruker ved å sende X-AO-Username."""
    from src.api_handlers import _save_credentials, _load_credentials

    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f:
        tmp_path = f.name

    try:
        monkeypatch.setattr('src.api_handlers._CREDENTIALS_PATH', tmp_path)
        _save_credentials('offer', 'hemmelig', '111:offerets-token')

        assert _load_credentials('offer') is None
        assert _load_credentials('offer', None) is None
        assert _load_credentials('offer', '') is None
        assert _load_credentials('offer', '111:gjettet-token') is None

        with open(tmp_path) as f:
            lagret = f.read()
        assert 'offerets-token' not in lagret  # bare hashen ligger på disk
    finally:
        os.unlink(tmp_path)


def test_credentials_flere_enheter_per_bruker(monkeypatch):
    """Hver enhet får sitt eget logintoken; alle skal kunne bruke fallbacket,
    men bare de siste _MAX_TOKENS_PER_USER."""
    from src import api_handlers
    from src.api_handlers import _save_credentials, _load_credentials

    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f:
        tmp_path = f.name

    try:
        monkeypatch.setattr('src.api_handlers._CREDENTIALS_PATH', tmp_path)
        _save_credentials('bruker', 'pass', '1:mobil')
        _save_credentials('bruker', 'pass', '2:pc')
        assert _load_credentials('bruker', '1:mobil') == ('bruker', 'pass')
        assert _load_credentials('bruker', '2:pc') == ('bruker', 'pass')

        for i in range(api_handlers._MAX_TOKENS_PER_USER):
            _save_credentials('bruker', 'pass', f'9:ny-{i}')
        assert _load_credentials('bruker', '1:mobil') is None
        assert _load_credentials('bruker', f'9:ny-{api_handlers._MAX_TOKENS_PER_USER - 1}') == ('bruker', 'pass')
    finally:
        os.unlink(tmp_path)


def test_credentials_survives_overwrite(monkeypatch):
    """Credentials for flere brukere lagres uavhengig."""
    from src.api_handlers import _save_credentials, _load_credentials

    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f:
        tmp_path = f.name

    try:
        monkeypatch.setattr('src.api_handlers._CREDENTIALS_PATH', tmp_path)

        _save_credentials('user1', 'pass1', '1:a')
        _save_credentials('user2', 'pass2', '2:b')

        assert _load_credentials('user1', '1:a') == ('user1', 'pass1')
        assert _load_credentials('user2', '2:b') == ('user2', 'pass2')
        assert _load_credentials('user2', '1:a') is None
    finally:
        os.unlink(tmp_path)


def test_load_credentials_missing_file(monkeypatch):
    """Manglende fil returnerer None."""
    from src.api_handlers import _load_credentials

    monkeypatch.setattr('src.api_handlers._CREDENTIALS_PATH', '/tmp/nonexistent_creds_xyz.json')
    assert _load_credentials('testuser', '1:a') is None


def test_migrate_credentials_file_fjerner_rader_uten_tokenbinding(monkeypatch):
    """Rader fra før tokenbindingen (begge de gamle formatene) kan aldri brukes
    igjen, så passordene i dem skal ikke bli liggende på disk."""
    import json as json_module
    from src.api_handlers import _migrate_credentials_file, _save_credentials, _load_credentials

    with tempfile.NamedTemporaryFile(suffix='.json', mode='w', delete=False) as f:
        json_module.dump({
            '111111': {'username': 'kjetils', 'password': 'hunter2'},
            'annenbruker': {'username': 'annenbruker', 'password': 'annet-pass'},
        }, f)
        tmp_path = f.name

    try:
        monkeypatch.setattr('src.api_handlers._CREDENTIALS_PATH', tmp_path)
        _save_credentials('ny', 'ny-pass', '5:ny')
        _migrate_credentials_file()

        with open(tmp_path) as f:
            migrert = json_module.load(f)

        assert list(migrert.keys()) == ['ny']
        assert 'hunter2' not in json_module.dumps(migrert)
        assert _load_credentials('ny', '5:ny') == ('ny', 'ny-pass')

        _migrate_credentials_file()  # idempotent
        with open(tmp_path) as f:
            assert json_module.load(f) == migrert
    finally:
        os.unlink(tmp_path)


# --- _full_relogin ---

def test_full_relogin_logintoken_first(monkeypatch):
    """Test at logintoken-refresh prøves før credentials."""
    from src.api_handlers import _full_relogin

    monkeypatch.setattr(
        'src.api_handlers._refresh_with_logintoken',
        lambda login_token, user_id: 'logintoken-cookie'
    )
    result = _full_relogin('12345', '12345:abc')
    assert result == 'logintoken-cookie'


def test_full_relogin_credentials_fallback(monkeypatch):
    """Test at credentials brukes når logintoken feiler, slått opp på username."""
    from src.api_handlers import _full_relogin, _save_credentials

    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f:
        tmp_path = f.name

    try:
        monkeypatch.setattr('src.api_handlers._CREDENTIALS_PATH', tmp_path)
        monkeypatch.setattr(
            'src.api_handlers._refresh_with_logintoken',
            lambda login_token, user_id: None
        )
        monkeypatch.setattr(
            'src.api_handlers.login_to_ao',
            lambda username, password, bind_token=True: {'authCookie': 'cred-cookie', 'loginToken': 'lt', 'userId': '99999'}
        )

        _save_credentials('testuser', 'testpass', '12345:abc')
        # user_id her ('12345') er BEVISST forskjellig fra det som ble brukt ved lagring
        # (ustabilt tall) — poenget er at oppslaget skjer på username, ikke user_id.
        result = _full_relogin('12345', '12345:abc', username='testuser')
        assert result == 'cred-cookie'
    finally:
        os.unlink(tmp_path)


def test_full_relogin_no_credentials(monkeypatch):
    """Test at None returneres uten credentials og logintoken."""
    from src.api_handlers import _full_relogin

    monkeypatch.setattr('src.api_handlers._CREDENTIALS_PATH', '/tmp/nonexistent_creds_xyz.json')
    result = _full_relogin('12345', None, username='testuser')
    assert result is None


def test_full_relogin_no_username_skips_credentials_lookup(monkeypatch):
    """Test at fallback hoppes over (ikke krasjer) når klienten ikke sender username —
    f.eks. en gammel, ikke-oppdatert klient. Skal ikke prøve å slå opp på user_id."""
    from src.api_handlers import _full_relogin, _save_credentials

    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f:
        tmp_path = f.name

    try:
        monkeypatch.setattr('src.api_handlers._CREDENTIALS_PATH', tmp_path)
        monkeypatch.setattr(
            'src.api_handlers._refresh_with_logintoken',
            lambda login_token, user_id: None
        )
        _save_credentials('testuser', 'testpass', '12345:abc')

        result = _full_relogin('12345', '12345:abc', username=None)
        assert result is None
    finally:
        os.unlink(tmp_path)


def test_ensure_auth_gir_ikke_sesjon_til_fremmed_med_bare_brukernavn(monkeypatch):
    """Gjenskaper angrepet: GET /api/ao-sites med X-AO-User-Id og X-AO-Username,
    uten offerets logintoken. Serveren skal ikke logge inn med lagret passord."""
    from src.api_handlers import _ensure_auth, _save_credentials

    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f:
        tmp_path = f.name

    forsok = []
    try:
        monkeypatch.setattr('src.api_handlers._CREDENTIALS_PATH', tmp_path)
        monkeypatch.setattr('src.api_handlers._refresh_with_logintoken', lambda lt, uid: None)
        monkeypatch.setattr('src.api_handlers._is_cookie_expired', lambda *a: True)
        monkeypatch.setattr(
            'src.api_handlers.login_to_ao',
            lambda u, p, bind_token=True: forsok.append((u, p)) or {'authCookie': 'offerets-sesjon'},
        )
        _save_credentials('offer', 'hemmelig', '111:offerets-token')

        assert _ensure_auth(None, '1', None, username='offer') == (None, None)
        assert _ensure_auth(None, '1', '1:falsk', username='offer') == (None, None)
        assert forsok == []

        # Den ekte klienten med sitt eget token får fortsatt fallbacket
        assert _ensure_auth(None, '111', '111:offerets-token', username='offer') == ('offerets-sesjon', 'offerets-sesjon')
    finally:
        os.unlink(tmp_path)


def test_serverens_egen_relogin_spiser_ikke_en_tokenplass(monkeypatch):
    """Når serveren relogger på brukerens vegne, får den et nytt logintoken
    klienten aldri ser. Bindes det, presses brukerens egne avtrykk mot taket
    uten at noen kan bruke det nye. Funnet i gjennomgang 09.11.2026."""
    import json as json_module
    from src.api_handlers import _full_relogin, _save_credentials, _token_hash

    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f:
        tmp_path = f.name

    try:
        monkeypatch.setattr('src.api_handlers._CREDENTIALS_PATH', tmp_path)
        monkeypatch.setattr('src.api_handlers._refresh_with_logintoken', lambda lt, uid: None)
        bind = []

        def fake_login(u, p, bind_token=True):
            bind.append(bind_token)
            return {'authCookie': 'ny-sesjon', 'loginToken': '9:serverens-token', 'userId': '9'}

        monkeypatch.setattr('src.api_handlers.login_to_ao', fake_login)

        _save_credentials('bruker', 'pass', '1:klientens-token')
        assert _full_relogin('1', '1:klientens-token', username='bruker') == 'ny-sesjon'

        assert bind == [False]
        with open(tmp_path) as f:
            assert json_module.load(f)['bruker']['tokens'] == [_token_hash('1:klientens-token')]
    finally:
        os.unlink(tmp_path)


def test_samme_token_og_passord_skriver_ikke_filen_pa_nytt(monkeypatch):
    """Appen logger inn på nytt ved hver sending til AO. Gir AO samme token,
    skal ikke lista stokkes om — da slites ikke taket ned av ren gjentakelse."""
    import json as json_module
    from src.api_handlers import _save_credentials

    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f:
        tmp_path = f.name

    try:
        monkeypatch.setattr('src.api_handlers._CREDENTIALS_PATH', tmp_path)
        _save_credentials('bruker', 'pass', '1:token')
        for _ in range(5):
            _save_credentials('bruker', 'pass', '1:token')

        with open(tmp_path) as f:
            assert len(json_module.load(f)['bruker']['tokens']) == 1
    finally:
        os.unlink(tmp_path)
