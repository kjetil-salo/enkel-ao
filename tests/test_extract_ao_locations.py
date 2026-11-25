"""Kontroll av separat uttrekk: ingen test kontakter AO."""

import json
from pathlib import Path
import sqlite3
import time

import httpx
import pytest

from tools import extract_ao_locations as extract


@pytest.fixture
def work(tmp_path):
    path = tmp_path / 'work.db'
    extract.initialize(path, [(5.49, 58.75, 5.51, 58.76)])
    with extract.open_work(path) as db:
        yield db


def public_site(sid=1, **fields):
    return {'id': sid, 'name': f'Offentlig sted {sid}', 'latitude': 58.754,
            'longitude': 5.5, 'isPrivate': False, 'accuracy': 10,
            'parentSiteId': None, 'municipalityName': 'Klepp', 'countyName': 'Rogaland', **fields}


def bird_detail(sid=1, **fields):
    return {'SiteId': sid, 'IsNotBirdSite': False, 'SiteSpeciesGroupId': 8,
            'SiteIsPrivate': False, 'Areas': '2,183', 'CanReportSigthingOnSite': True, **fields}


@pytest.fixture
def make_api():
    clients = []

    def make(db, handler, limit=100):
        client = extract.AOClient(db, max_requests=limit, delay=0,
                                 username='test@example.org', password='mock-passord',
                                 transport=httpx.MockTransport(handler))
        client.authenticated = True
        clients.append(client)
        return client

    yield make
    for client in clients:
        client.close()


def seed(db, rows):
    values, _ = extract.normalize_public(rows)
    with db:
        db.executemany('''INSERT INTO candidates
            (ao_id,name,lat,lon,municipality,county,parent_id,accuracy,raw_json,seen_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)''', values)


def first_tile(db):
    return db.execute("SELECT * FROM tiles WHERE state='pending' ORDER BY id LIMIT 1").fetchone()


def test_init_refuses_existing_file_and_resume_refuses_application_db(tmp_path):
    path = tmp_path / 'production.db'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE locations (id INTEGER)')
    before = path.read_bytes()
    with pytest.raises(FileExistsError):
        extract.initialize(path, [(5, 58, 6, 59)])
    with pytest.raises(sqlite3.Error):
        with extract.open_work(path):
            pytest.fail('Skal ikke åpne appbasen som arbeidsbase')
    assert path.read_bytes() == before


def test_resume_refuses_changed_rules(tmp_path, monkeypatch):
    path = tmp_path / 'work.db'
    extract.initialize(path, [(5, 58, 5.1, 58.1)])
    monkeypatch.setattr(extract, 'RULE_VERSION', 2)
    with pytest.raises(extract.ExtractError, match='kompatibel'):
        with extract.open_work(path):
            pass


def test_overlapping_process_is_rejected(tmp_path):
    path = tmp_path / 'work.db'
    extract.initialize(path, [(5, 58, 5.1, 58.1)])
    with extract.open_work(path):
        with pytest.raises(extract.ExtractError, match='annen prosess'):
            with extract.open_work(path):
                pass


def test_alias_cannot_bypass_process_lock(tmp_path):
    path, alias = tmp_path / 'work.db', tmp_path / 'alias.db'
    extract.initialize(path, [(5, 58, 5.1, 58.1)])
    alias.symlink_to(path)
    with extract.open_work(path):
        with pytest.raises(extract.ExtractError, match='annen prosess'):
            with extract.open_work(alias):
                pass


def test_grid_has_no_empty_cells_at_decimal_boundaries(tmp_path):
    path = tmp_path / 'work.db'
    extract.initialize(path, [(5, 58, 5.4, 58.2)])
    with extract.open_work(path) as db:
        rows = db.execute('SELECT west,south,east,north FROM tiles').fetchall()
        assert len(rows) == 1
        assert all(row['west'] < row['east'] and row['south'] < row['north'] for row in rows)


def test_private_rows_are_kept_apart_and_never_become_candidates(work, make_api):
    rows = [public_site(), public_site(2, isPrivate=True, name='Privat navn')]
    api = make_api(work, lambda r: httpx.Response(200, json=rows))
    extract.discover_one(work, api, first_tile(work))
    assert work.execute('SELECT count(*) FROM candidates').fetchone()[0] == 1
    assert 'Privat navn' not in str([tuple(r) for r in work.execute('SELECT * FROM candidates')])
    private = work.execute('SELECT * FROM private_sites').fetchone()
    assert (private['ao_id'], private['name'], private['source']) == (2, 'Privat navn', 'ao3')
    assert extract.report(work)['tiles'] == {'done': 1}


@pytest.mark.parametrize('privacy', [None, 0, 'false'])
def test_unknown_privacy_keeps_whole_tile_pending(work, make_api, privacy):
    api = make_api(work, lambda r: httpx.Response(200, json=[public_site(), public_site(2, isPrivate=privacy)]))
    with pytest.raises(extract.ExtractError, match='privatstatus'):
        extract.discover_one(work, api, first_tile(work))
    assert work.execute('SELECT count(*) FROM candidates').fetchone()[0] == 0
    assert extract.report(work)['tiles'] == {'pending': 1}


def test_saturation_uses_raw_count_before_private_filter_and_deduplicates(work, make_api, monkeypatch):
    monkeypatch.setattr(extract, 'MAX_SITES', 3)
    api = make_api(work, lambda r: httpx.Response(200, json=[public_site(), public_site(), public_site(2, isPrivate=True)]))
    extract.discover_one(work, api, first_tile(work))
    assert extract.report(work)['tiles'] == {'pending': 4, 'split': 1}
    assert work.execute('SELECT count(*) FROM candidates').fetchone()[0] == 1
    children = work.execute("SELECT * FROM tiles WHERE state='pending' ORDER BY id").fetchall()
    assert children[0]['east'] > children[1]['west']
    assert children[0]['north'] > children[2]['south']


def test_saturation_at_max_depth_keeps_rows_and_marks_truncated(work, make_api, monkeypatch):
    # Samme lokalitet 1000 ganger på ett punkt kan ikke deles bort; uttrekket skal ikke stå fast.
    monkeypatch.setattr(extract, 'MAX_SITES', 1)
    monkeypatch.setattr(extract, 'MAX_DEPTH', 0)
    api = make_api(work, lambda r: httpx.Response(200, json=[public_site()]))
    extract.discover_one(work, api, first_tile(work))
    assert work.execute('SELECT count(*) FROM candidates').fetchone()[0] == 1
    assert extract.report(work)['tiles'] == {'truncated': 1}


def test_too_large_box_is_split(work, make_api):
    api = make_api(work, lambda r: httpx.Response(400, text='BoundingBox too large'))
    extract.discover_one(work, api, first_tile(work))
    assert extract.report(work)['tiles'] == {'pending': 4, 'split': 1}


@pytest.mark.parametrize('response', [httpx.Response(200, text='ikke JSON'),
                                     httpx.Response(200, json={'ukjent': []}),
                                     httpx.Response(403)])
def test_unusable_discovery_is_not_an_empty_area(work, make_api, response):
    api = make_api(work, lambda r: response)
    with pytest.raises(extract.ExtractError):
        extract.discover_one(work, api, first_tile(work))
    assert extract.report(work)['tiles'] == {'pending': 1}


@pytest.mark.parametrize(('detail', 'expected'), [
    (bird_detail(), 'bird'),
    ({'IsNotBirdSite': True}, 'other'),
    (bird_detail(SiteIsPrivate=True), 'private'),
    (bird_detail(IsNotBirdSite=True), 'unknown'),
    (bird_detail(SiteId=2), 'unknown'),
    ({'IsNotBirdSite': False}, 'unknown'),
    ({'SiteSpeciesGroupId': 8}, 'unknown'),
    ([], 'unknown'),
])
def test_only_explicit_matching_public_bird_is_accepted(detail, expected):
    assert extract.classify_detail(1, detail) == expected


def test_private_detail_purges_payload_and_prevents_reinsertion(work, make_api):
    seed(work, [public_site()])
    api = make_api(work, lambda r: httpx.Response(200, json=bird_detail(SiteIsPrivate=True)))
    extract.enrich_one(work, api, 1)
    row = work.execute('SELECT * FROM candidates').fetchone()
    assert row['state'] == 'private'
    assert all(row[k] is None for k in ['name', 'lat', 'lon', 'raw_json', 'detail_json', 'parent_id'])
    kept = work.execute('SELECT * FROM private_sites WHERE ao_id=1').fetchone()
    assert kept['name'] == 'Offentlig sted 1' and kept['source'] == 'ao2-detail'
    api = make_api(work, lambda r: httpx.Response(200, json=[public_site()]))
    extract.discover_one(work, api, first_tile(work))
    row = work.execute('SELECT * FROM candidates').fetchone()
    assert row['state'] == 'private' and row['name'] is None


def test_budget_resume_does_not_repeat_completed_discovery(work, make_api):
    requests = []

    def handler(request):
        requests.append(request.url.path)
        return httpx.Response(200, json=[public_site()] if request.method == 'GET' else bird_detail())

    extract.run(work, make_api(work, handler, limit=1))
    assert extract.report(work)['candidates'] == {'pending': 1}
    extract.run(work, make_api(work, handler, limit=1))
    assert extract.report(work)['complete']
    assert requests == ['/core/Sites/ByBoundingBox', '/SubmitSighting/GetSite']


def test_429_honors_retry_after_without_finishing_tile(work, make_api):
    api = make_api(work, lambda r: httpx.Response(429, headers={'Retry-After': '3600'}))
    with pytest.raises(extract.ExtractError, match='429'):
        extract.discover_one(work, api, first_tile(work))
    assert extract.get_meta(work, 'pause_until') >= time.time() + 3590
    assert first_tile(work)
    api = make_api(work, lambda r: pytest.fail('Ingen kall under lagret pause'))
    extract.run(work, api)
    assert api.calls == 0


def test_expired_session_reauthenticates_with_same_budget_and_no_persisted_secrets(work, make_api):
    seed(work, [public_site()])
    attempts = []

    def handler(request):
        attempts.append(request.url.path)
        if request.url.path == '/LogOn' and request.method == 'GET':
            return httpx.Response(200, text='<input name="__RequestVerificationToken" value="csrf-mock">',
                                  headers={'Set-Cookie': '__RequestVerificationToken=cookie; Path=/'})
        if request.url.path == '/LogOn':
            assert 'mock-passord' in request.content.decode()
            return httpx.Response(302, headers={'Location': '/', 'Set-Cookie': '.ASPXAUTHNO=mock-cookie; Path=/'})
        if len(attempts) == 1:
            return httpx.Response(302, headers={'Location': '/LogOn'})
        return httpx.Response(200, json=bird_detail())

    api = make_api(work, handler)
    extract.enrich_one(work, api, 1)
    assert api.calls == 4
    assert extract.report(work)['candidates'] == {'bird': 1}
    stored = str([tuple(r) for r in work.execute('SELECT * FROM metadata')])
    assert 'mock-passord' not in stored and 'mock-cookie' not in stored


def test_budget_during_login_keeps_candidate_pending(work, make_api):
    seed(work, [public_site()])
    work.execute("UPDATE tiles SET state='done'")
    work.commit()
    api = make_api(work, lambda r: httpx.Response(200, text='<input name="__RequestVerificationToken" value="x">'), limit=1)
    api.authenticated = False
    extract.run(work, api)
    assert extract.report(work)['candidates'] == {'pending': 1}


def test_export_excludes_nonbirds_unknown_and_private_and_preserves_metadata(work, make_api, tmp_path):
    seed(work, [public_site(1), public_site(2, parentSiteId=1), public_site(3), public_site(4), public_site(5)])
    details = {1: bird_detail(1), 2: bird_detail(2), 3: {'IsNotBirdSite': True},
               4: {'uventet': 'rådata'}, 5: bird_detail(5, SiteIsPrivate=True)}
    api = make_api(work, lambda r: httpx.Response(200, json=details[json.loads(r.content)['SiteId']]))
    for sid in details:
        extract.enrich_one(work, api, sid)
    with work:
        work.execute("UPDATE tiles SET state='done'")
    target = tmp_path / 'new-locations.db'
    extract.export_snapshot(work, target)
    with sqlite3.connect(target) as db:
        assert db.execute('SELECT ao_id,is_private,is_super FROM locations ORDER BY ao_id').fetchall() == [(1, 0, 1), (2, 0, 0)]
        assert db.execute('SELECT parent_id,municipality,county,areas FROM locations WHERE ao_id=2').fetchone() == (1, 'Klepp', 'Rogaland', '2,183')
        assert db.execute('SELECT count(*) FROM location_metadata WHERE is_bird=1 AND checked_at IS NOT NULL').fetchone()[0] == 2
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        # Private (her nr. 5, lagret i private_sites) skal ikke finnes noe sted i eksporten.
        assert db.execute("SELECT count(*) FROM sqlite_master WHERE name='private_sites'").fetchone()[0] == 0
        assert 'Offentlig sted 5' not in str(db.execute('SELECT * FROM locations').fetchall())
        assert 'Offentlig sted 5' not in str(db.execute('SELECT * FROM location_metadata').fetchall())
    assert work.execute('SELECT count(*) FROM private_sites WHERE ao_id=5').fetchone()[0] == 1
    before = target.read_bytes()
    with pytest.raises(extract.ExtractError, match='finnes allerede'):
        extract.export_snapshot(work, target)
    assert target.read_bytes() == before


def test_incomplete_or_empty_export_creates_no_file(work, tmp_path):
    target = tmp_path / 'new.db'
    with pytest.raises(extract.ExtractError, match='ferdig behandling'):
        extract.export_snapshot(work, target)
    assert not target.exists()


def test_init_and_status_need_no_login_or_network(tmp_path, monkeypatch):
    monkeypatch.setattr(httpx.Client, 'request', lambda *a, **kw: pytest.fail('Uventet nettverkskall'))
    path = str(tmp_path / 'work.db')
    assert extract.main(['init', '--db', path, '--bbox', '5.49', '58.75', '5.51', '58.76']) == 0
    assert extract.main(['status', '--db', path]) == 0


def test_adaptive_pace_speeds_up_slows_down_and_is_remembered(work, make_api, monkeypatch):
    calls = {'n': 0}

    def handler(request):
        calls['n'] += 1
        return httpx.Response(429 if calls['n'] > 100 else 200, json=[])

    api = make_api(work, handler, limit=200)
    api.adaptive, api.delay = True, extract.ADAPTIVE_START
    monkeypatch.setattr(extract.time, 'sleep', lambda s: None)
    for _ in range(100):
        api.request(api.public, 'GET', 'https://example.org')
    assert api.delay == pytest.approx(extract.ADAPTIVE_START * 0.9 ** 2)
    with pytest.raises(extract.ExtractError, match='429'):
        api.request(api.public, 'GET', 'https://example.org')
    assert api.delay == pytest.approx(extract.ADAPTIVE_START * 0.9 ** 2 * 2)
    resumed = extract.AOClient(work, max_requests=1, delay=extract.ADAPTIVE_START, adaptive=True)
    try:
        assert resumed.delay == pytest.approx(api.delay)
    finally:
        resumed.close()


def test_adaptive_pace_never_goes_below_floor(work, make_api, monkeypatch):
    api = make_api(work, lambda request: httpx.Response(200, json=[]), limit=10_000)
    api.adaptive, api.delay = True, extract.ADAPTIVE_FLOOR
    monkeypatch.setattr(extract.time, 'sleep', lambda s: None)
    for _ in range(200):
        api.request(api.public, 'GET', 'https://example.org')
    assert api.delay == extract.ADAPTIVE_FLOOR
