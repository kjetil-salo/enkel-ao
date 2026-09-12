"""Tester for lokal lokasjons-database."""

import os
import sys
import tempfile
import importlib.util

import pytest

# Last location_db direkte uten å trigge src/__init__.py
_spec = importlib.util.spec_from_file_location(
    'location_db',
    os.path.join(os.path.dirname(__file__), '..', 'src', 'location_db.py')
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
LocationDB = _mod.LocationDB
_haversine = _mod._haversine


@pytest.fixture
def db():
    """Opprett en midlertidig database for testing."""
    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
        db_path = f.name
    try:
        yield LocationDB(db_path)
    finally:
        os.unlink(db_path)
        # Fjern WAL/SHM-filer hvis de finnes
        for ext in ('-wal', '-shm'):
            p = db_path + ext
            if os.path.exists(p):
                os.unlink(p)


SITE_OPERAEN = {
    'id': 1001,
    'name': 'Operaen, Oslo',
    'lat': 59.9075,
    'lon': 10.7530,
    'isPrivate': False,
    'isSuper': False,
}

SITE_EKEBERG = {
    'id': 1002,
    'name': 'Ekebergskråningen',
    'lat': 59.9010,
    'lon': 10.7610,
    'isPrivate': False,
    'isSuper': True,
    'parentId': None,
}

SITE_PRIVAT = {
    'id': 1003,
    'name': 'Min private lokalitet',
    'lat': 59.9080,
    'lon': 10.7540,
    'isPrivate': True,
    'isSuper': False,
}


class TestUpsert:
    def test_upsert_single(self, db):
        count = db.upsert_locations([SITE_OPERAEN], source='enkel-ao')
        assert count == 1
        assert db.count() == 1

    def test_upsert_multiple(self, db):
        count = db.upsert_locations([SITE_OPERAEN, SITE_EKEBERG, SITE_PRIVAT])
        assert count == 3
        assert db.count() == 3

    def test_upsert_updates_existing(self, db):
        db.upsert_locations([SITE_OPERAEN])
        updated = {**SITE_OPERAEN, 'name': 'Operaen (oppdatert)'}
        db.upsert_locations([updated])
        assert db.count() == 1
        results = db.search_by_name('oppdatert')
        assert len(results) == 1
        assert results[0]['name'] == 'Operaen (oppdatert)'

    def test_upsert_skips_invalid(self, db):
        invalid = [{'id': None, 'name': 'Test', 'lat': 59.0, 'lon': 10.0}]
        count = db.upsert_locations(invalid)
        assert count == 0

    def test_upsert_skips_missing_name(self, db):
        count = db.upsert_locations([{'id': 99, 'lat': 59.0, 'lon': 10.0}])
        assert count == 0


class TestSearchNearby:
    def test_finds_nearby(self, db):
        db.upsert_locations([SITE_OPERAEN, SITE_EKEBERG])
        results = db.search_nearby(59.907, 10.753, radius_m=1000)
        assert len(results) == 2

    def test_respects_radius(self, db):
        db.upsert_locations([SITE_OPERAEN, SITE_EKEBERG])
        # Svært liten radius — kun nærmeste
        results = db.search_nearby(59.9075, 10.7530, radius_m=50)
        assert len(results) == 1
        assert results[0]['id'] == 1001

    def test_sorted_by_distance(self, db):
        db.upsert_locations([SITE_EKEBERG, SITE_OPERAEN])
        results = db.search_nearby(59.9075, 10.7530, radius_m=2000)
        assert results[0]['id'] == 1001  # Operaen er nærmest

    def test_empty_when_none_nearby(self, db):
        db.upsert_locations([SITE_OPERAEN])
        results = db.search_nearby(60.5, 11.0, radius_m=500)
        assert len(results) == 0

    def test_includes_source_marker(self, db):
        db.upsert_locations([SITE_OPERAEN])
        results = db.search_nearby(59.9075, 10.7530, radius_m=100)
        assert results[0]['_source'] == 'local_db'

    def test_includes_municipality(self, db):
        db.upsert_locations([{**SITE_OPERAEN, 'municipality': 'Oslo', 'county': 'Oslo'}])
        results = db.search_nearby(59.9075, 10.7530, radius_m=100)
        assert results[0]['municipality'] == 'Oslo'
        assert results[0]['county'] == 'Oslo'


class TestSearchByName:
    def test_finds_by_partial_name(self, db):
        db.upsert_locations([SITE_OPERAEN, SITE_EKEBERG])
        results = db.search_by_name('Opera')
        assert len(results) == 1
        assert results[0]['name'] == 'Operaen, Oslo'

    def test_case_insensitive(self, db):
        db.upsert_locations([SITE_OPERAEN])
        results = db.search_by_name('operaen')
        assert len(results) == 1

    def test_empty_on_no_match(self, db):
        db.upsert_locations([SITE_OPERAEN])
        results = db.search_by_name('Stavanger')
        assert len(results) == 0

    def test_preserves_fields(self, db):
        db.upsert_locations([SITE_EKEBERG])
        results = db.search_by_name('Ekeberg')
        assert results[0]['isSuper'] is True
        assert results[0]['id'] == 1002


class TestHaversine:
    def test_same_point(self):
        assert _haversine(59.9, 10.7, 59.9, 10.7) == 0.0

    def test_known_distance(self):
        # Oslo sentrum til Drammen ≈ 36 km
        dist = _haversine(59.913, 10.752, 59.744, 10.204)
        assert 33_000 < dist < 40_000


class TestAreasCache:
    """Tester for AOs Areas-ID-cache (fylke/kommune) per lokalitet."""

    def test_get_cached_areas_none_when_not_cached(self, db):
        db.upsert_locations([SITE_OPERAEN])
        assert db.get_cached_areas(1001) is None

    def test_set_areas_then_get_returns_value(self, db):
        db.upsert_locations([SITE_OPERAEN])
        ok = db.set_areas(1001, '12,34')
        assert ok is True
        assert db.get_cached_areas(1001) == '12,34'

    def test_set_areas_on_unknown_site_returns_false_no_phantom_row(self, db):
        """Site som ikke finnes i DB-en fra før: set_areas skal returnere False
        og IKKE opprette en fantom-rad uten kjent navn."""
        before = db.count()
        ok = db.set_areas(999999, '12,34')
        assert ok is False
        assert db.count() == before
        assert db.get_cached_areas(999999) is None

    def test_get_cached_areas_unknown_site_returns_none(self, db):
        assert db.get_cached_areas(424242) is None

    def test_get_cached_areas_invalid_site_id_type_returns_none(self, db):
        assert db.get_cached_areas('not-an-int') is None
        assert db.get_cached_areas(None) is None

    def test_set_areas_invalid_site_id_type_returns_false(self, db):
        assert db.set_areas('not-an-int', '12,34') is False
        assert db.set_areas(None, '12,34') is False

    def test_cache_fresh_within_ttl(self, db, monkeypatch):
        db.upsert_locations([SITE_OPERAEN])
        db.set_areas(1001, '12,34')
        assert db.get_cached_areas(1001) == '12,34'

    def test_cache_expired_just_over_ttl(self, db):
        from datetime import datetime, timedelta, timezone
        db.upsert_locations([SITE_OPERAEN])
        db.set_areas(1001, '12,34')
        # Manipuler areas_updated_at til å ligge 30 dager + 1 sekund tilbake
        stale = (datetime.now(timezone.utc) - timedelta(days=30, seconds=1)).isoformat()
        with db._connect() as conn:
            conn.execute('UPDATE locations SET areas_updated_at = ? WHERE ao_id = ?', (stale, 1001))
        assert db.get_cached_areas(1001) is None

    def test_cache_exactly_at_ttl_boundary_still_valid(self, db):
        """Grensetest: praktisk talt nøyaktig 30 dager gammel (noen millisekunder
        under grensen pga. kjøretid) skal fortsatt regnes som gyldig."""
        from datetime import datetime, timedelta, timezone
        db.upsert_locations([SITE_OPERAEN])
        db.set_areas(1001, '12,34')
        just_under = (datetime.now(timezone.utc) - timedelta(days=30) + timedelta(seconds=1)).isoformat()
        with db._connect() as conn:
            conn.execute('UPDATE locations SET areas_updated_at = ? WHERE ao_id = ?', (just_under, 1001))
        assert db.get_cached_areas(1001) == '12,34'

    def test_cache_29_days_old_still_valid(self, db):
        from datetime import datetime, timedelta, timezone
        db.upsert_locations([SITE_OPERAEN])
        db.set_areas(1001, '12,34')
        aged = (datetime.now(timezone.utc) - timedelta(days=29)).isoformat()
        with db._connect() as conn:
            conn.execute('UPDATE locations SET areas_updated_at = ? WHERE ao_id = ?', (aged, 1001))
        assert db.get_cached_areas(1001) == '12,34'

    def test_malformed_areas_updated_at_returns_none(self, db):
        db.upsert_locations([SITE_OPERAEN])
        db.set_areas(1001, '12,34')
        with db._connect() as conn:
            conn.execute('UPDATE locations SET areas_updated_at = ? WHERE ao_id = ?', ('not-a-date', 1001))
        assert db.get_cached_areas(1001) is None

    def test_set_areas_overwrites_previous_value(self, db):
        db.upsert_locations([SITE_OPERAEN])
        db.set_areas(1001, '12,34')
        db.set_areas(1001, '56,78')
        assert db.get_cached_areas(1001) == '56,78'

    def test_set_areas_does_not_affect_other_columns(self, db):
        db.upsert_locations([SITE_OPERAEN])
        db.set_areas(1001, '12,34')
        results = db.search_by_name('Operaen')
        assert len(results) == 1
        assert results[0]['name'] == 'Operaen, Oslo'

    def test_empty_areas_str_cached_and_retrieved(self, db):
        """set_areas med tom streng: teknisk lovlig å lagre, men get_cached_areas
        behandler tom/falsy areas som 'ikke cachet' (jf. `not row['areas']`-sjekken)."""
        db.upsert_locations([SITE_OPERAEN])
        ok = db.set_areas(1001, '')
        assert ok is True
        assert db.get_cached_areas(1001) is None
