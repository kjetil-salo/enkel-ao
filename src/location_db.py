"""
Lokal SQLite-database for AO-lokasjoner.

Deles mellom enkel-ao og dagens-funn via et felles Docker-volum.
Aktiveres med miljøvariabel LOCATION_DB_PATH.
"""

import logging
import math
import sqlite3
import threading

logger = logging.getLogger('fugleobs')

_SCHEMA = """
CREATE TABLE IF NOT EXISTS locations (
    ao_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    is_private INTEGER DEFAULT 0,
    is_super INTEGER DEFAULT 0,
    parent_id INTEGER,
    source TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_locations_geo ON locations(lat, lon);
CREATE INDEX IF NOT EXISTS idx_locations_name ON locations(name COLLATE NOCASE);
"""


class LocationDB:
    """SQLite-basert lokasjons-cache med WAL-modus for deling mellom containere."""

    def __init__(self, db_path):
        self.db_path = db_path
        self._local = threading.local()
        # Initialiser schema med én tilkobling
        conn = self._get_conn()
        conn.executescript(_SCHEMA)
        conn.commit()
        logger.info(f'LocationDB initialisert: {db_path}')

    def _get_conn(self):
        """Hent tråd-lokal tilkobling (SQLite-tilkoblinger er ikke trådsikre)."""
        if not hasattr(self._local, 'conn') or self._local.conn is None:
            conn = sqlite3.connect(self.db_path, timeout=5.0)
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA busy_timeout=5000')
            conn.row_factory = sqlite3.Row
            self._local.conn = conn
        return self._local.conn

    def upsert_locations(self, sites, source='enkel-ao'):
        """Sett inn eller oppdater lokasjoner.

        Args:
            sites: Liste med site-dicts (id, name, lat, lon, isPrivate, isSuper, parentId)
            source: Kildeapp ('enkel-ao' eller 'dagens-funn')
        """
        conn = self._get_conn()
        inserted = 0
        for site in sites:
            ao_id = site.get('id')
            name = site.get('name')
            lat = site.get('lat')
            lon = site.get('lon')
            if ao_id is None or not name or lat is None or lon is None:
                continue
            try:
                conn.execute(
                    """INSERT INTO locations (ao_id, name, lat, lon, is_private, is_super, parent_id, source)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(ao_id) DO UPDATE SET
                           name=excluded.name,
                           lat=excluded.lat,
                           lon=excluded.lon,
                           is_private=excluded.is_private,
                           is_super=excluded.is_super,
                           parent_id=excluded.parent_id,
                           updated_at=datetime('now')""",
                    (
                        int(ao_id),
                        name,
                        float(lat),
                        float(lon),
                        1 if site.get('isPrivate') else 0,
                        1 if site.get('isSuper') else 0,
                        site.get('parentId'),
                        source,
                    )
                )
                inserted += 1
            except (ValueError, TypeError, sqlite3.Error) as e:
                logger.debug(f'LocationDB upsert feilet for site {ao_id}: {e}')
        conn.commit()
        if inserted:
            logger.debug(f'LocationDB: upsert {inserted} lokasjoner fra {source}')
        return inserted

    def search_nearby(self, lat, lon, radius_m=600):
        """Finn lokasjoner innenfor radius.

        Bruker bounding box for grovfiltrering, deretter haversine for nøyaktighet.

        Returns:
            Liste med site-dicts.
        """
        # Beregn bounding box (grov filtrering)
        lat_delta = radius_m / 111_320.0
        lon_delta = radius_m / (111_320.0 * math.cos(math.radians(lat)))

        conn = self._get_conn()
        rows = conn.execute(
            """SELECT ao_id, name, lat, lon, is_private, is_super, parent_id, source
               FROM locations
               WHERE lat BETWEEN ? AND ?
                 AND lon BETWEEN ? AND ?""",
            (lat - lat_delta, lat + lat_delta, lon - lon_delta, lon + lon_delta)
        ).fetchall()

        results = []
        for row in rows:
            dist = _haversine(lat, lon, row['lat'], row['lon'])
            if dist <= radius_m:
                results.append({
                    'id': row['ao_id'],
                    'name': row['name'],
                    'lat': row['lat'],
                    'lon': row['lon'],
                    'isPrivate': bool(row['is_private']),
                    'isSuper': bool(row['is_super']),
                    'parentId': row['parent_id'],
                    '_source': 'local_db',
                    '_distance': dist,
                })
        results.sort(key=lambda s: s['_distance'])
        return results

    def search_by_name(self, query, limit=50):
        """Søk lokasjoner på navn (case-insensitive LIKE).

        Returns:
            Liste med site-dicts.
        """
        conn = self._get_conn()
        rows = conn.execute(
            """SELECT ao_id, name, lat, lon, is_private, is_super, parent_id, source
               FROM locations
               WHERE name LIKE ?
               LIMIT ?""",
            (f'%{query}%', limit)
        ).fetchall()
        return [
            {
                'id': row['ao_id'],
                'name': row['name'],
                'lat': row['lat'],
                'lon': row['lon'],
                'isPrivate': bool(row['is_private']),
                'isSuper': bool(row['is_super']),
                'parentId': row['parent_id'],
                '_source': 'local_db',
            }
            for row in rows
        ]

    def count(self):
        """Antall lokasjoner i databasen."""
        conn = self._get_conn()
        return conn.execute('SELECT COUNT(*) FROM locations').fetchone()[0]


def _haversine(lat1, lon1, lat2, lon2):
    """Beregn avstand i meter mellom to koordinater."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
