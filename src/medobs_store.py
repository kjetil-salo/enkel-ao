"""
Server-backup av brukerens medobservatør-liste (public/medobs.html).

localStorage (`medobs_list_v1`) er fortsatt den raske, autoritative kilden
under normal bruk. Denne modulen finnes KUN for å overleve at appen
avinstalleres og installeres på nytt — da er localStorage tomt, men brukeren
skal ikke måtte skrive inn hele lista si på nytt.

Nøkkelen er AO-brukernavnet (fra `localStorage.ao_username`), ikke en
verifisert sesjon — dette er bevisst en liten, avgrenset feature, ikke den
større multi-enhet-synken skissert i docs/server-lagring-innstillinger-plan.md.
Rekkefølgen i lista ER prioriteringen (som activityPills_v1) — ingen separat
order-kolonne.

Lagres i samme SQLite-database som statistikk/tilbakemeldinger (DB_PATH,
default /data/stats.db). Følger mønsteret fra src/feedback_store.py.
"""
import json
import logging
import os
import sqlite3
import threading
import time

logger = logging.getLogger('fugleobs')

DB_PATH = os.environ.get('DB_PATH', '/data/stats.db')
_lock = threading.Lock()

MAX_USERNAME_LEN = 200
MAX_ITEMS = 50
MAX_NAME_LEN = 200


def _connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS medobs (
                username   TEXT PRIMARY KEY,
                payload    TEXT NOT NULL,
                updated_ts REAL
            )
        """)
        conn.commit()


def _sanitize_list(raw_list):
    """Behold kun feltene vi faktisk bruker, i samme rekkefølge som sendt inn.

    Ukjente ekstra felt fra en fremtidig klientversjon droppes stille i
    stedet for å avvise hele lagringen — en ny, ukjent klientversjon skal
    ikke blokkeres av en eldre server. Dette inkluderer bevisst `alias`
    (AO-koblingen storage.js sin master-liste kan ha, se defaultCoObservers()
    i public/js/storage.js) — en bekvemmelighet for autocomplete, ikke data
    som må overleve en reinstallering. Går den tapt, dukker den opp igjen
    neste gang brukeren velger personen i autocompleten.
    """
    out = []
    for it in raw_list[:MAX_ITEMS]:
        if not isinstance(it, dict):
            continue
        name = str(it.get('name', '')).strip()[:MAX_NAME_LEN]
        active = bool(it.get('active', False))
        out.append({'name': name, 'active': active})
    return out


def save_list(username: str, raw_list) -> bool:
    """Lagre (overskriv) medobs-lista for en AO-bruker. True ved suksess."""
    username = (username or '').strip()[:MAX_USERNAME_LEN]
    if not username:
        return False
    if not isinstance(raw_list, list):
        return False

    payload = json.dumps(_sanitize_list(raw_list), ensure_ascii=False)

    try:
        with _lock:
            with _connect() as conn:
                conn.execute(
                    "INSERT INTO medobs (username, payload, updated_ts) VALUES (?,?,?) "
                    "ON CONFLICT(username) DO UPDATE SET payload = excluded.payload, "
                    "updated_ts = excluded.updated_ts",
                    (username, payload, time.time())
                )
                conn.commit()
        return True
    except Exception as e:
        logger.warning(f'[medobs] Feil ved lagring for {username!r}: {e}')
        return False


def load_list(username: str) -> list:
    """Hent lagret medobs-liste for en AO-bruker. Tom liste hvis ingen finnes."""
    username = (username or '').strip()[:MAX_USERNAME_LEN]
    if not username:
        return []
    try:
        with _connect() as conn:
            row = conn.execute(
                "SELECT payload FROM medobs WHERE username = ?", (username,)
            ).fetchone()
            if not row:
                return []
            return json.loads(row['payload'])
    except Exception as e:
        logger.warning(f'[medobs] Feil ved henting for {username!r}: {e}')
        return []


# Initialiser databasen ved import (samme mønster som feedback_store/share_store)
try:
    init_db()
except Exception as e:
    logger.warning(f'[medobs] Klarte ikke initialisere database: {e}')
