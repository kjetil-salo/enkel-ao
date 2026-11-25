#!/usr/bin/env python3
"""Gjenopptakbart uttrekk til en egen arbeidsbase og en ny lokalitetseksport.

Ingen produksjonsfil åpnes automatisk. Kjør --help for kommandoene.
"""

import argparse
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import fcntl
import getpass
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
import time

import httpx


AO3 = 'https://mobil.artsobservasjoner.no'
AO2 = 'https://www.artsobservasjoner.no'
MAX_SITES = 1000
MAX_DEPTH = 10
RULE_VERSION = 1
# Adaptivt tempo: starter raskt, nærmer seg gulvet ved jevne gode svar og sakker
# av ved trege svar eller 429/5xx. Ett kall om gangen gjelder uansett.
ADAPTIVE_START = 1.0
ADAPTIVE_FLOOR = 0.1
ADAPTIVE_CEILING = 30.0
# Bremser før AO merker noe: et tregere svar betyr pause, ikke flere kall.
ADAPTIVE_SLOW_RESPONSE = 1.5
ADAPTIVE_STEP_EVERY = 50
REGIONS = {
    'fastland': (4.5, 57.5, 31.5, 71.5),
    'svalbard': (10.0, 74.0, 35.0, 81.1),
    'jan-mayen': (-9.5, 70.5, -7.5, 71.5),
}
SCHEMA = """
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE tiles (
    id INTEGER PRIMARY KEY, west REAL, south REAL, east REAL, north REAL,
    depth INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending',
    raw_count INTEGER, private_count INTEGER
);
CREATE TABLE candidates (
    ao_id INTEGER PRIMARY KEY, name TEXT, lat REAL, lon REAL,
    municipality TEXT, county TEXT, parent_id INTEGER, accuracy REAL,
    raw_json TEXT, detail_json TEXT, state TEXT NOT NULL DEFAULT 'pending',
    seen_at TEXT, checked_at TEXT
);
CREATE INDEX candidates_state ON candidates(state, ao_id);
CREATE INDEX candidates_parent ON candidates(parent_id);
"""
# Private lokaliteter lagres for en eventuell senere beslutning (eier 2026-11-23),
# men de blir ALDRI kandidater og ALDRI med i eksporten. Opprettes også i eldre
# arbeidsbaser ved gjenopptak.
PRIVATE_SCHEMA = """
CREATE TABLE IF NOT EXISTS private_sites (
    ao_id INTEGER PRIMARY KEY, name TEXT, lat REAL, lon REAL,
    municipality TEXT, county TEXT, parent_id INTEGER, accuracy REAL,
    raw_json TEXT, source TEXT NOT NULL, seen_at TEXT
);
"""
PRIVATE_UPSERT = """INSERT INTO private_sites
    (ao_id,name,lat,lon,municipality,county,parent_id,accuracy,raw_json,source,seen_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(ao_id) DO UPDATE SET
    name=excluded.name,lat=excluded.lat,lon=excluded.lon,municipality=excluded.municipality,
    county=excluded.county,parent_id=excluded.parent_id,accuracy=excluded.accuracy,
    raw_json=excluded.raw_json,source=excluded.source,seen_at=excluded.seen_at"""


class ExtractError(ValueError):
    """En feil som kan vises uten sesjonsdata eller rå HTTP-innhold."""


class BudgetReached(Exception):
    """Kallbudsjettet er brukt; neste kjøring fortsetter fra samme sted."""


def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def set_meta(db, key, value):
    db.execute('INSERT OR REPLACE INTO metadata VALUES (?, ?)',
               (key, json.dumps(value, ensure_ascii=False)))


def get_meta(db, key, default=None):
    row = db.execute('SELECT value FROM metadata WHERE key=?', (key,)).fetchone()
    return json.loads(row[0]) if row else default


def validate_bbox(bbox):
    w, s, e, n = bbox
    if not all(math.isfinite(v) for v in bbox) or not (-180 <= w < e <= 180 and -85 < s < n < 85):
        raise ExtractError('Ugyldig kartrektangel: bruk vest sør øst nord i WGS84.')
    return tuple(bbox)


def initialize(path, boxes):
    boxes = [validate_bbox(box) for box in boxes]
    if not boxes:
        raise ExtractError('Velg minst ett kartrektangel.')
    # Eksklusiv opprettelse beskytter også eksisterende tomme filer og symlinker.
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        with closing(sqlite3.connect(path)) as db, db:
            db.executescript(SCHEMA)
            set_meta(db, 'kind', 'ao-location-extract')
            set_meta(db, 'rules', {'version': RULE_VERSION, 'ao2': AO2, 'ao3': AO3,
                                   'max_sites': MAX_SITES, 'max_depth': MAX_DEPTH})
            set_meta(db, 'boxes', boxes)
            set_meta(db, 'created_at', utcnow())
            for bbox in boxes:
                w, s, e, n = validate_bbox(bbox)
                for y in range(max(1, math.ceil((n - s) / 0.2 - 1e-10))):
                    south, north = s + y * 0.2, min(s + (y + 1) * 0.2, n)
                    for x in range(max(1, math.ceil((e - w) / 0.4 - 1e-10))):
                        west, east = w + x * 0.4, min(w + (x + 1) * 0.4, e)
                        if west >= east or south >= north:
                            continue
                        db.execute('INSERT INTO tiles(west,south,east,north) VALUES(?,?,?,?)',
                                   (west, south, east, north))
    except BaseException:
        Path(path).unlink(missing_ok=True)
        raise


@contextmanager
def open_work(path):
    # Låsen omfatter også eksport. Den nye arbeidsfilen opprettes bare av init.
    path = Path(path).resolve(strict=True)
    if path.stat().st_nlink != 1:
        raise ExtractError('Arbeidsfilen må være en egen fil uten hardlenker.')
    # En separat, kanonisk låsefil unngår konflikt med SQLite-låsene på macOS.
    with open(str(path) + '.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ExtractError('En annen prosess bruker denne arbeidsbasen.') from None
        db = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=rw', uri=True)
        db.row_factory = sqlite3.Row
        try:
            expected = {'version': RULE_VERSION, 'ao2': AO2, 'ao3': AO3,
                        'max_sites': MAX_SITES, 'max_depth': MAX_DEPTH}
            if get_meta(db, 'kind') != 'ao-location-extract' or get_meta(db, 'rules') != expected:
                raise ExtractError('Filen er ikke en kompatibel arbeidsbase. Opprett en ny med init.')
            with db:
                db.executescript(PRIVATE_SCHEMA)
            yield db
        finally:
            db.close()


def _float_or_none(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def normalize_private(row):
    sid = row.get('id')
    if type(sid) is not int or sid <= 0:
        raise ExtractError('AO3 ga en privat lokalitet uten gyldig ID. Kartboksen er ikke fullført.')
    name = row.get('name')
    parent = row.get('parentSiteId')
    return (sid, name.strip() if isinstance(name, str) else None,
            _float_or_none(row.get('latitude')), _float_or_none(row.get('longitude')),
            row.get('municipalityName'), row.get('countyName'),
            parent if type(parent) is int and parent > 0 else None,
            _float_or_none(row.get('accuracy')), json.dumps(row, ensure_ascii=False), 'ao3', utcnow())


def normalize_public(rows):
    """Gir (offentlige, antall private). Se normalize_rows for de private radene."""
    sites, private = normalize_rows(rows)
    return sites, len(private)


def normalize_rows(rows):
    sites, private = {}, {}
    for row in rows:
        if not isinstance(row, dict) or type(row.get('isPrivate')) is not bool:
            raise ExtractError('AO3 mangler entydig privatstatus. Kartboksen er ikke fullført.')
        if row['isPrivate']:
            entry = normalize_private(row)
            private[entry[0]] = entry
            continue
        try:
            sid, name = row['id'], row['name'].strip()
            lat, lon = float(row['latitude']), float(row['longitude'])
            if (type(sid) is not int or sid <= 0 or not name or
                    not math.isfinite(lat) or not math.isfinite(lon) or
                    not (-90 <= lat <= 90 and -180 <= lon <= 180)):
                raise ValueError
            parent = row.get('parentSiteId') or None
            if parent is not None and (type(parent) is not int or parent <= 0):
                raise ValueError
        except (KeyError, TypeError, ValueError, AttributeError):
            raise ExtractError('AO3 ga en ugyldig offentlig lokalitet. Kartboksen er ikke fullført.') from None
        sites[sid] = (sid, name, lat, lon, row.get('municipalityName'), row.get('countyName'),
                      parent, row.get('accuracy'), json.dumps(row, ensure_ascii=False), utcnow())
    return list(sites.values()), list(private.values())


def split_tile(db, tile):
    if tile['depth'] >= MAX_DEPTH:
        raise ExtractError('Et kartutsnitt er fortsatt avkortet eller for stort ved maksimal deling.')
    w, s, e, n = (tile[k] for k in ('west', 'south', 'east', 'north'))
    mx, my = (w + e) / 2, (s + n) / 2
    # Litt overlapp hindrer hull dersom API-et behandler grenser strengt.
    overlap = min(0.000001, (e - w) / 100, (n - s) / 100)
    boxes = [(w, s, mx + overlap, my + overlap), (mx - overlap, s, e, my + overlap),
             (w, my - overlap, mx + overlap, n), (mx - overlap, my - overlap, e, n)]
    db.executemany('INSERT INTO tiles(west,south,east,north,depth) VALUES(?,?,?,?,?)',
                   [(*box, tile['depth'] + 1) for box in boxes])
    db.execute("UPDATE tiles SET state='split' WHERE id=?", (tile['id'],))


class AOClient:
    def __init__(self, db, *, max_requests, delay, username=None, password=None, transport=None,
                 adaptive=False):
        self.db, self.limit, self.delay = db, max_requests, delay
        self.adaptive, self.good_streak, self.latencies = adaptive, 0, []
        if adaptive:
            # Tempoet huskes mellom kjøringer, så en 429 i går ikke glemmes ved omstart.
            self.delay = get_meta(db, 'adaptive_delay', delay)
        self.calls, self.authenticated = 0, False
        self.username, self.password = username, password
        headers = {'User-Agent': 'Enkel-AO (langsomt offentlig lokalitetsuttrekk)',
                   'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}
        self.public = httpx.Client(headers={**headers, 'X-CSRF': '1'}, timeout=20,
                                   follow_redirects=False, transport=transport)
        self.ao2 = httpx.Client(headers=headers, timeout=20, follow_redirects=False, transport=transport)

    def close(self):
        self.public.close()
        self.ao2.close()

    def request(self, client, method, url, **kwargs):
        if self.calls >= self.limit:
            raise BudgetReached
        wait = get_meta(self.db, 'last_request_at', 0) + self.delay - time.time()
        if wait > 0:
            time.sleep(wait)
        with self.db:
            set_meta(self.db, 'last_request_at', time.time())
        self.calls += 1
        started = time.monotonic()
        try:
            response = client.request(method, url, **kwargs)
        except httpx.HTTPError:
            self.adapt(failed=True)
            self.cooldown(900)
            raise ExtractError('Nettverksfeil mot AO. Fremdriften er bevart; prøv igjen senere.') from None
        if response.status_code == 429 or response.status_code >= 500:
            self.adapt(failed=True)
            pause = 900
            retry_after = response.headers.get('Retry-After')
            if retry_after:
                try:
                    pause = max(pause, float(retry_after))
                except ValueError:
                    try:
                        pause = max(pause, parsedate_to_datetime(retry_after).timestamp() - time.time())
                    except (ValueError, TypeError, OverflowError):
                        pass
            self.cooldown(pause)
            raise ExtractError(f'AO svarte HTTP {response.status_code}. Pause og fremdrift er lagret.')
        elapsed = time.monotonic() - started
        self.latencies = (self.latencies + [elapsed])[-25:]
        self.adapt(slow=elapsed > ADAPTIVE_SLOW_RESPONSE)
        return response

    def adapt(self, *, failed=False, slow=False):
        if not self.adaptive:
            return
        if failed:
            self.delay, self.good_streak = min(self.delay * 2, ADAPTIVE_CEILING), 0
        elif slow:
            self.delay, self.good_streak = min(self.delay * 1.5, ADAPTIVE_CEILING), 0
        else:
            self.good_streak += 1
            if self.good_streak % ADAPTIVE_STEP_EVERY == 0:
                self.delay = max(ADAPTIVE_FLOOR, self.delay * 0.9)
        with self.db:
            set_meta(self.db, 'adaptive_delay', self.delay)

    def cooldown(self, seconds):
        with self.db:
            set_meta(self.db, 'pause_until', time.time() + seconds)

    def login(self):
        if not self.username:
            raise ExtractError('Sett AO_EXTRACT_USERNAME eller --username for detaljkontrollen.')
        if not self.password:
            if not sys.stdin.isatty():
                raise ExtractError('Sett AO_EXTRACT_PASSWORD i miljøet eller en uttrykkelig valgt miljøfil.')
            self.password = getpass.getpass('AO-passord (lagres ikke): ')
        page = self.request(self.ao2, 'GET', AO2 + '/LogOn')
        token = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', page.text)
        if page.status_code != 200 or not token:
            raise ExtractError('Kunne ikke lese AOs innloggingsskjema.')
        response = self.request(self.ao2, 'POST', AO2 + '/LogOn', data={
            '__RequestVerificationToken': token.group(1),
            'AuthenticationViewModel.UserName': self.username,
            'AuthenticationViewModel.Password': self.password,
            'AuthenticationViewModel.RememberMe': 'true',
        })
        if (response.status_code not in (302, 303) or
                '/logon' in response.headers.get('location', '').lower() or
                not any(c.name == '.ASPXAUTHNO' for c in self.ao2.cookies.jar)):
            raise ExtractError('AO-innloggingen kunne ikke bekreftes. Ingen kandidat er endret.')
        self.authenticated = True

    def site_detail(self, sid):
        if not self.authenticated:
            self.login()
        for attempt in range(2):
            response = self.request(self.ao2, 'POST', AO2 + '/SubmitSighting/GetSite',
                                    json={'SiteId': sid})
            expired = (response.is_redirect or response.status_code in (401, 403) or
                       any(response.headers.get(k) == '1' for k in
                           ('REQUIRES_AUTH', 'SESSION_TIMEOUT', 'ROLE_NOT_AUTHORIZED')) or
                       response.text.lstrip().startswith('<'))
            if expired:
                if attempt == 0:
                    self.login()
                    continue
                raise ExtractError('AO-sesjonen er utløpt eller mangler tilgang. Kandidaten står ventende.')
            if response.status_code != 200:
                raise ExtractError(f'Detaljoppslaget svarte HTTP {response.status_code}. Kandidaten står ventende.')
            try:
                return response.json()
            except ValueError:
                raise ExtractError('Ugyldig JSON i detaljoppslaget. Kandidaten står ventende.') from None


def discover_one(db, api, tile):
    response = api.request(api.public, 'GET', AO3 + '/core/Sites/ByBoundingBox', params={
        'maxSites': MAX_SITES, 'minX': tile['west'], 'minY': tile['south'],
        'maxX': tile['east'], 'maxY': tile['north'], 'includePublicSites': 'true',
    })
    if response.status_code == 400 and 'boundingbox' in response.text.lower().replace(' ', '') and 'large' in response.text.lower():
        with db:
            split_tile(db, tile)
        return
    if response.status_code != 200:
        raise ExtractError(f'Kartoppslaget svarte HTTP {response.status_code}. Boksen står ventende.')
    try:
        rows = response.json()
    except ValueError:
        raise ExtractError('AO3 ga ugyldig JSON. Boksen står ventende.') from None
    if isinstance(rows, dict):
        rows = rows.get('sites', rows.get('Sites'))
    if not isinstance(rows, list):
        raise ExtractError('Ukjent svarformat fra AO3. Boksen står ventende.')
    sites, private = normalize_rows(rows)
    private_count = len(private)
    with db:
        db.executemany(PRIVATE_UPSERT, private)
        db.executemany("""INSERT INTO candidates
            (ao_id,name,lat,lon,municipality,county,parent_id,accuracy,raw_json,seen_at)
            VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(ao_id) DO UPDATE SET
            name=excluded.name,lat=excluded.lat,lon=excluded.lon,
            municipality=excluded.municipality,county=excluded.county,
            parent_id=excluded.parent_id,accuracy=excluded.accuracy,
            raw_json=excluded.raw_json,seen_at=excluded.seen_at
            WHERE candidates.state != 'private'""", sites)
        db.execute('UPDATE tiles SET raw_count=?,private_count=? WHERE id=?',
                   (len(rows), private_count, tile['id']))
        if len(rows) >= MAX_SITES and tile['depth'] >= MAX_DEPTH:
            # Typisk samme lokalitet lagt inn 1000 ganger på ett punkt (Nordre Follo,
            # 2026-11-24): deling hjelper ikke. Behold det AO ga, og merk boksen.
            db.execute("UPDATE tiles SET state='truncated' WHERE id=?", (tile['id'],))
        elif len(rows) >= MAX_SITES:
            split_tile(db, tile)
        else:
            db.execute("UPDATE tiles SET state='done' WHERE id=?", (tile['id'],))


def classify_detail(sid, detail):
    if not isinstance(detail, dict):
        return 'unknown'
    if detail.get('SiteIsPrivate') is True:
        return 'private'
    if detail.get('IsNotBirdSite') is True:
        return 'unknown' if detail.get('SiteSpeciesGroupId') == 8 else 'other'
    if (detail.get('IsNotBirdSite') is False and detail.get('SiteSpeciesGroupId') == 8 and
            detail.get('SiteIsPrivate') is False and type(detail.get('SiteId')) is int and
            detail['SiteId'] == sid):
        return 'bird'
    return 'unknown'


def enrich_one(db, api, sid):
    detail = api.site_detail(sid)
    state = classify_detail(sid, detail)
    with db:
        if state == 'private':
            # Ta vare på steddataene i den separate private tabellen før kandidaten tømmes.
            db.execute("""INSERT INTO private_sites
                (ao_id,name,lat,lon,municipality,county,parent_id,accuracy,raw_json,source,seen_at)
                SELECT ao_id,name,lat,lon,municipality,county,parent_id,accuracy,raw_json,'ao2-detail',?
                FROM candidates WHERE ao_id=? AND name IS NOT NULL
                ON CONFLICT(ao_id) DO UPDATE SET source='ao2-detail'""", (utcnow(), sid))
            db.execute("""UPDATE candidates SET name=NULL,lat=NULL,lon=NULL,municipality=NULL,
                county=NULL,parent_id=NULL,accuracy=NULL,raw_json=NULL,detail_json=NULL,
                state='private',checked_at=? WHERE ao_id=?""", (utcnow(), sid))
        else:
            # Ukjent respons kan ha personlige felt. Den lagres ikke som offentlig rådata.
            public_detail = json.dumps(detail, ensure_ascii=False) if state == 'bird' else None
            db.execute('UPDATE candidates SET state=?,detail_json=?,checked_at=? WHERE ao_id=?',
                       (state, public_detail, utcnow(), sid))


def report(db):
    tile_counts = dict(db.execute('SELECT state,count(*) FROM tiles GROUP BY state').fetchall())
    candidates = dict(db.execute('SELECT state,count(*) FROM candidates GROUP BY state').fetchall())
    private = db.execute('SELECT count(*) FROM private_sites').fetchone()[0]
    return {'boxes': get_meta(db, 'boxes'), 'tiles': tile_counts, 'candidates': candidates,
            'private_stored': private,
            'complete': not tile_counts.get('pending', 0) and not candidates.get('pending', 0),
            'pause_until_epoch': get_meta(db, 'pause_until', 0)}


def run(db, api):
    if get_meta(db, 'pause_until', 0) > time.time():
        print('AO-pausen gjelder fortsatt. Ingen nettverkskall er gjort.')
        return
    try:
        while True:
            tile = db.execute("SELECT * FROM tiles WHERE state='pending' ORDER BY id LIMIT 1").fetchone()
            if tile:
                discover_one(db, api, tile)
            else:
                candidate = db.execute("SELECT ao_id FROM candidates WHERE state='pending' ORDER BY ao_id LIMIT 1").fetchone()
                if not candidate:
                    break
                enrich_one(db, api, candidate[0])
            if api.calls % 25 == 0:
                latency = sum(api.latencies) / len(api.latencies) if api.latencies else None
                print(json.dumps({'calls_this_run': api.calls, 'delay': round(api.delay, 2),
                                  'avg_response_s': latency and round(latency, 2), **report(db)},
                                 ensure_ascii=False), flush=True)
    except BudgetReached:
        print('Kallbudsjettet er brukt. Neste kjøring fortsetter fra samme sted.')


def export_snapshot(db, target):
    status = report(db)
    if not status['complete'] or not status['candidates'].get('bird'):
        raise ExtractError('Eksport krever ferdig behandling og minst én bekreftet fuglelokalitet.')
    if target.exists() or target.is_symlink():
        raise ExtractError('Eksportfilen finnes allerede. Velg et nytt filnavn.')
    # Bruk appens skjema uten å kjøre migreringer eller importere src-pakken.
    source = Path(__file__).resolve().parents[1] / 'src' / 'location_db.py'
    spec = importlib.util.spec_from_file_location('extract_location_schema', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fd, temporary = tempfile.mkstemp(prefix=target.name + '.', suffix='.tmp', dir=target.parent)
    os.close(fd)
    try:
        with closing(sqlite3.connect(temporary)) as out, out:
            out.executescript(module._SCHEMA)
            out.executescript('''CREATE TABLE location_metadata (
                ao_id INTEGER PRIMARY KEY, is_bird INTEGER NOT NULL, checked_at TEXT,
                accuracy REAL, super_source TEXT, raw_json TEXT, detail_json TEXT);
                CREATE TABLE extract_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);''')
            now = utcnow()
            rows = db.execute("""SELECT c.*,EXISTS(SELECT 1 FROM candidates child
                WHERE child.parent_id=c.ao_id AND child.state='bird') AS inferred_super
                FROM candidates c WHERE c.state='bird' ORDER BY c.ao_id""")
            for row in rows:
                detail = json.loads(row['detail_json'])
                areas = detail.get('Areas')
                areas = areas if isinstance(areas, str) else None
                out.execute('''INSERT INTO locations
                    (ao_id,name,lat,lon,is_private,is_super,parent_id,municipality,county,
                     source,areas,areas_updated_at,created_at,updated_at)
                    VALUES(?,?,?,?,0,?,?,?,?,?,?,?,?,?)''',
                            (row['ao_id'], row['name'], row['lat'], row['lon'], row['inferred_super'],
                             row['parent_id'], row['municipality'], row['county'], 'ao-public-extract',
                             areas, row['checked_at'] if areas else None, now, row['checked_at']))
                out.execute('INSERT INTO location_metadata VALUES(?,1,?,?,?,?,?)',
                            (row['ao_id'], row['checked_at'], row['accuracy'],
                             'parent-reference' if row['inferred_super'] else 'unknown',
                             row['raw_json'], row['detail_json']))
            out.executemany('INSERT INTO extract_metadata VALUES(?,?)',
                            db.execute('SELECT key,value FROM metadata').fetchall())
            out.execute('INSERT INTO extract_metadata VALUES(?,?)', ('summary', json.dumps(status)))
        # Eksklusiv og atomisk publisering av ferdig fil på samme filsystem.
        os.link(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    commands = p.add_subparsers(dest='command', required=True)
    for name in ('init', 'run', 'status', 'retry-unknown', 'export'):
        cmd = commands.add_parser(name)
        cmd.add_argument('--db', type=Path, required=True, help='Egen arbeidsdatabase, aldri produksjonsbasen')
        if name == 'init':
            coverage = cmd.add_mutually_exclusive_group(required=True)
            coverage.add_argument('--region', choices=[*REGIONS, 'alle'])
            coverage.add_argument('--bbox', nargs=4, type=float, metavar=('VEST', 'SØR', 'ØST', 'NORD'))
        elif name == 'run':
            cmd.add_argument('--max-requests', type=int, default=200, help='Inkluderer innloggingskall')
            cmd.add_argument('--delay', type=float, default=2, help='Minste sekunder mellom kall, minst 2')
            cmd.add_argument('--adaptive', action='store_true',
                             help=f'Start på {ADAPTIVE_START} s, ned mot {ADAPTIVE_FLOOR} s, sakk av ved 429/trege svar')
            cmd.add_argument('--username', help='Testkonto; ellers AO_EXTRACT_USERNAME')
            cmd.add_argument('--env-file', type=Path, help='Uttrykkelig valgt fil med AO_EXTRACT_USERNAME/PASSWORD')
        elif name == 'export':
            cmd.add_argument('--output', type=Path, required=True, help='Ny eksportfil; overskriver aldri')
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    api = None
    try:
        if args.command == 'init':
            boxes = [validate_bbox(args.bbox)] if args.bbox else (
                list(REGIONS.values()) if args.region == 'alle' else [REGIONS[args.region]])
            initialize(args.db, boxes)
        with open_work(args.db) as db:
            if args.command == 'run':
                if args.adaptive:
                    args.delay = ADAPTIVE_START
                if args.max_requests < 3 or not math.isfinite(args.delay) or args.delay < 2 and not args.adaptive:
                    raise ExtractError('Bruk minst 3 kall per kjøring og minst 2 sekunder mellom kall.')
                credentials = {}
                if args.env_file:
                    from dotenv import dotenv_values
                    credentials = dotenv_values(args.env_file, interpolate=False)
                    if not args.env_file.is_file():
                        raise ExtractError('Den valgte miljøfilen finnes ikke.')
                api = AOClient(db, max_requests=args.max_requests, delay=args.delay,
                               username=args.username or os.getenv('AO_EXTRACT_USERNAME') or credentials.get('AO_EXTRACT_USERNAME'),
                               password=os.getenv('AO_EXTRACT_PASSWORD') or credentials.get('AO_EXTRACT_PASSWORD'),
                               adaptive=args.adaptive)
                run(db, api)
            elif args.command == 'retry-unknown':
                with db:
                    db.execute("UPDATE candidates SET state='pending' WHERE state='unknown'")
            elif args.command == 'export':
                export_snapshot(db, args.output)
            print(json.dumps(report(db), ensure_ascii=False, indent=2))
        return 0
    except KeyboardInterrupt:
        print('Avbrutt. Fullførte oppslag er lagret.', file=sys.stderr)
        return 130
    except (ExtractError, sqlite3.Error, OSError):
        # Operativsystemfeil og rå HTTP-unntak kan inneholde mer enn vi vil logge.
        error = sys.exception()
        message = str(error) if isinstance(error, ExtractError) else type(error).__name__
        print(f'Uttrekket stoppet: {message}', file=sys.stderr)
        return 1
    finally:
        if api:
            api.close()


if __name__ == '__main__':
    sys.exit(main())
