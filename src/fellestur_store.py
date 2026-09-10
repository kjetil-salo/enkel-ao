"""
Fellestur — delt feltregistrering for en gruppe fuglefolk på samme tur.

I motsetning til `share_store.py` (én person publiserer et øyeblikksbilde,
andre bare leser) er dette en **delt kladdebok**: alle som har koden kan
legge til, rette tall på, og slette oppføringer. Ingen kontoer — koden er
hemmelig, ikke privat, akkurat som en delingslenke.

**Samme datamodell som den lokale arbeidslista.** En oppføring lagres som
det samme observasjonsobjektet appen ellers bruker (`species`, `count`,
`activity`, `placeName`, `age`, `gender`, `comment`, ...) — ikke en egen,
forenklet fellestur-spesifikk form. Det gjør at hele oppføringen kan hentes
tilbake inn i arbeidslista uten tap av informasjon når turen er over. Eneste
unntak er koordinater (`position`), som aldri lagres — samme personvernregel
som `share_store.sanitize_observations()`.

Klienten sender endringer i batcher via `apply_sync()`: en liste med
upserts (nye eller endrede oppføringer, identifisert med en klientgenerert
`obs_id`) og en liste med sletting-ider. Siste skriving vinner per rad,
ingen låsing — akkurat som før, bare uttrykt som en diff i stedet for
per-rad-endepunkter.

Ansvarsmodell: den som oppretter turen setter (og kan senere justere)
medobservatørene som skal krediteres. Når turen er over henter én person
hele loggen inn i sin egen arbeidsliste og sender til AO. Hvem, er ikke
håndhevet i koden.

Lagres i samme SQLite-database som deling/tilbakemeldinger (DB_PATH, default
/data/stats.db). Følger mønsteret fra src/share_store.py.

**Utløp uten cron:** hver skriving rydder bort utløpte turer (og deres
oppføringer) — `DELETE WHERE expires_ts < now`. Levetiden er kort
(FELLESTUR_TTL_HOURS): dette er en arbeidsøkt, ikke et arkiv.
"""
import json
import logging
import os
import secrets
import sqlite3
import threading
import time

logger = logging.getLogger('fugleobs')

DB_PATH = os.environ.get('DB_PATH', '/data/stats.db')
_lock = threading.Lock()

# Samme entydige alfabet som share-slug/saksnummer — utelater tegn som lett
# forveksles (0/O, 1/I/L). Kort nok til å tastes inn for hånd.
_KODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
_KODE_LENGTH = 6

FELLESTUR_TTL_HOURS = 48
MAX_OBS_PER_TUR = 300
MAX_PAYLOAD_BYTES = 20_000  # rikelig for én observasjon (uten bilde), stanser misbruk
MAX_NAVN_LEN = 100
MAX_TAXON_LEN = 120
MAX_SCI_NAME_LEN = 200
MAX_TEXT_LEN = 200
MAX_COMMENT_LEN = 1000
MAX_REGISTRERT_AV_LEN = 40
MAX_MEDOBSERVATORER = 10
MAX_MEDOBSERVATOR_LEN = 40
MAX_OBS_ID_LEN = 64


def _connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS fellesturer (
                kode            TEXT PRIMARY KEY,
                navn            TEXT,
                medobservatorer TEXT,
                created_ts      REAL,
                expires_ts      REAL
            )
        """)

        # fellestur_obs byttet radidentitet fra AUTOINCREMENT-int til
        # klientens obs_id (uuid) — nødvendig for at apply_sync() skal
        # kjenne igjen samme rad på tvers av batcher (upsert via
        # ON CONFLICT(kode, obs_id)). Dette har aldri vært i produksjon,
        # så gammel data (kun staging-testdata) kastes uten migrering.
        kolonner = {r['name'] for r in conn.execute("PRAGMA table_info(fellestur_obs)")}
        if kolonner and 'obs_id' not in kolonner:
            conn.execute("DROP TABLE fellestur_obs")

        conn.execute("""
            CREATE TABLE IF NOT EXISTS fellestur_obs (
                kode          TEXT NOT NULL,
                obs_id        TEXT NOT NULL,
                payload       TEXT NOT NULL,
                registrert_av TEXT,
                created_ts    REAL,
                updated_ts    REAL,
                PRIMARY KEY (kode, obs_id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_fellestur_obs_kode ON fellestur_obs(kode)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_fellesturer_expires ON fellesturer(expires_ts)")
        conn.commit()


def _generate_kode() -> str:
    return ''.join(secrets.choice(_KODE_ALPHABET) for _ in range(_KODE_LENGTH))


def _gyldig_kode_format(kode) -> bool:
    return isinstance(kode, str) and len(kode) == _KODE_LENGTH and all(c in _KODE_ALPHABET for c in kode)


def _purge_expired(conn):
    """Rydd bort utløpte fellesturer og deres oppføringer. Kalles ved hver skriving."""
    utlopte = [r['kode'] for r in conn.execute(
        "SELECT kode FROM fellesturer WHERE expires_ts < ?", (time.time(),)
    )]
    if not utlopte:
        return
    conn.executemany("DELETE FROM fellestur_obs WHERE kode = ?", [(k,) for k in utlopte])
    conn.executemany("DELETE FROM fellesturer WHERE kode = ?", [(k,) for k in utlopte])


def _clean_text(value, limit=MAX_TEXT_LEN) -> str:
    if not isinstance(value, str):
        return ''
    return value.strip()[:limit]


def _clean_medobservatorer(raw) -> list:
    if not isinstance(raw, list):
        return []
    rene = []
    for navn in raw[:MAX_MEDOBSERVATORER]:
        navn = _clean_text(navn, MAX_MEDOBSERVATOR_LEN)
        if navn:
            rene.append(navn)
    return rene


def sanitize_observasjon(obs) -> dict | None:
    """
    Plukk ut feltene som skal lagres fra ett observasjonsobjekt — samme
    hviteliste-prinsipp som `share_store.sanitize_observations()`: nye felt
    på observasjonen lekker ikke inn ved et uhell, og de skal her uansett
    plukkes eksplisitt inn etter behov.

    Full obs-modell (samme som den lokale arbeidslista bruker), men
    `position` (koordinater), `photo` (bilde) og klientens `obsId`/`sentTs`
    er bevisst aldri med — koordinater og bilde av samme personvern-/
    størrelsesgrunn som deling, `obsId`/`sentTs` fordi de er klient-only.
    Returnerer None hvis observasjonen mangler et gyldig artsnavn.
    """
    if not isinstance(obs, dict):
        return None

    species = obs.get('species')
    taxon_name = _clean_text(species.get('taxonName'), MAX_TAXON_LEN) if isinstance(species, dict) else ''
    if not taxon_name:
        return None

    count = obs.get('count')
    try:
        count = int(count)
    except (TypeError, ValueError):
        count = None

    taxon_id = species.get('taxonId') if isinstance(species, dict) else None
    if not isinstance(taxon_id, (int, str)):
        taxon_id = None

    place_id = obs.get('placeId')
    if not isinstance(place_id, (int, str)):
        place_id = None

    return {
        'species': {
            'taxonName': taxon_name,
            'taxonId': taxon_id,
            'scientificNameHtml': _clean_text(species.get('scientificNameHtml'), MAX_SCI_NAME_LEN) or None,
        },
        'count': count,
        'activity': _clean_text(obs.get('activity'), 60),
        'placeName': _clean_text(obs.get('placeName'), MAX_TEXT_LEN),
        'placeId': place_id,
        'visitId': _clean_text(obs.get('visitId'), MAX_TEXT_LEN) or None,
        'visitLocked': obs.get('visitLocked') is True,
        'timestamp': _clean_text(obs.get('timestamp'), 40) or None,
        'tilKlokkeslett': _clean_text(obs.get('tilKlokkeslett'), 40) or None,
        'age': _clean_text(obs.get('age'), 20),
        'gender': _clean_text(obs.get('gender'), 20),
        'comment': _clean_text(obs.get('comment'), MAX_COMMENT_LEN),
        'coObservers': _clean_medobservatorer(obs.get('coObservers')),
    }


def create_fellestur(navn: str = '', medobservatorer=None, ttl_hours: int = FELLESTUR_TTL_HOURS) -> dict | None:
    """Opprett en ny fellestur. Returnerer {'kode', 'expiresTs'} eller None ved feil."""
    navn = _clean_text(navn, MAX_NAVN_LEN)
    medobservatorer = _clean_medobservatorer(medobservatorer)
    now = time.time()
    expires_ts = now + ttl_hours * 3600

    try:
        with _lock:
            with _connect() as conn:
                _purge_expired(conn)
                for _ in range(5):
                    kode = _generate_kode()
                    try:
                        conn.execute(
                            "INSERT INTO fellesturer (kode, navn, medobservatorer, created_ts, expires_ts) "
                            "VALUES (?,?,?,?,?)",
                            (kode, navn, json.dumps(medobservatorer, ensure_ascii=False), now, expires_ts)
                        )
                        conn.commit()
                        return {'kode': kode, 'expiresTs': expires_ts}
                    except sqlite3.IntegrityError:
                        continue  # kollisjon på kode — svært usannsynlig, prøv på nytt
        logger.warning('[fellestur] Klarte ikke generere unik kode')
        return None
    except Exception as e:
        logger.warning(f'[fellestur] Feil ved oppretting: {e}')
        return None


def _rad_til_observasjon(rad) -> dict:
    payload = json.loads(rad['payload'])
    return {
        'id': rad['obs_id'],
        'registrert_av': rad['registrert_av'],
        'created_ts': rad['created_ts'],
        'updated_ts': rad['updated_ts'],
        **payload,
    }


def get_fellestur(kode: str) -> dict | None:
    """Hent turnavn, medobservatører og alle oppføringer. None hvis ukjent/utløpt."""
    if not _gyldig_kode_format(kode):
        return None
    try:
        with _connect() as conn:
            tur = conn.execute("SELECT * FROM fellesturer WHERE kode = ?", (kode,)).fetchone()
            if not tur:
                return None
            if tur['expires_ts'] and tur['expires_ts'] < time.time():
                return None
            rader = conn.execute(
                "SELECT * FROM fellestur_obs WHERE kode = ? ORDER BY created_ts ASC", (kode,)
            ).fetchall()
            return {
                'kode': tur['kode'],
                'navn': tur['navn'],
                'medobservatorer': json.loads(tur['medobservatorer'] or '[]'),
                'expiresTs': tur['expires_ts'],
                'observasjoner': [_rad_til_observasjon(r) for r in rader],
            }
    except Exception as e:
        logger.warning(f'[fellestur] Feil ved henting: {e}')
        return None


def update_fellestur(kode: str, navn=None, medobservatorer=None) -> bool:
    """Oppdater turnavn og/eller medobservatører. Alle med koden kan gjøre dette."""
    if not _gyldig_kode_format(kode):
        return False
    felt = {}
    if navn is not None:
        felt['navn'] = _clean_text(navn, MAX_NAVN_LEN)
    if medobservatorer is not None:
        felt['medobservatorer'] = json.dumps(_clean_medobservatorer(medobservatorer), ensure_ascii=False)
    if not felt:
        return False

    try:
        with _lock:
            with _connect() as conn:
                _purge_expired(conn)
                set_clause = ', '.join(f'{k} = ?' for k in felt)
                cur = conn.execute(
                    f"UPDATE fellesturer SET {set_clause} WHERE kode = ?",
                    (*felt.values(), kode)
                )
                conn.commit()
                return cur.rowcount > 0
    except Exception as e:
        logger.warning(f'[fellestur] Feil ved oppdatering av tur: {e}')
        return False


def apply_sync(kode: str, upserts=None, deletes=None, registrert_av: str = '') -> dict | None:
    """
    Anvend en batch med endringer fra klienten mot den delte loggen:

    - `upserts`: liste av `{'id': obs_id, 'obs': {...}}`. Ukjent `obs_id`
      lager en ny rad (skriver `registrert_av`/`created_ts`), kjent `obs_id`
      oppdaterer payload og `updated_ts` **uten** å røre den opprinnelige
      `registrert_av`/`created_ts` — den som endret antall sist skal ikke
      overta æren for hele oppføringen.
    - `deletes`: liste av `obs_id` som skal fjernes.

    Ugyldige enkeltrader (manglende artsnavn, for stor payload, ugyldig
    obs_id) hoppes stille over — resten av batchen anvendes likevel.
    `MAX_OBS_PER_TUR` håndheves per ny rad, også innad i samme batch.

    Returnerer hele turen (`get_fellestur()`-format), eller None hvis turen
    ikke finnes eller er utløpt.
    """
    if not _gyldig_kode_format(kode):
        return None
    if not isinstance(upserts, list):
        upserts = []
    if not isinstance(deletes, list):
        deletes = []

    registrert_av = _clean_text(registrert_av, MAX_REGISTRERT_AV_LEN)
    now = time.time()

    try:
        with _lock:
            with _connect() as conn:
                _purge_expired(conn)
                tur = conn.execute("SELECT kode FROM fellesturer WHERE kode = ?", (kode,)).fetchone()
                if not tur:
                    return None

                antall_rader = conn.execute(
                    "SELECT COUNT(*) AS n FROM fellestur_obs WHERE kode = ?", (kode,)
                ).fetchone()['n']
                eksisterende_ider = {
                    r['obs_id'] for r in conn.execute(
                        "SELECT obs_id FROM fellestur_obs WHERE kode = ?", (kode,)
                    )
                }

                for item in upserts:
                    if not isinstance(item, dict):
                        continue
                    obs_id = item.get('id')
                    if not isinstance(obs_id, str) or not (1 <= len(obs_id) <= MAX_OBS_ID_LEN):
                        continue

                    rein_obs = sanitize_observasjon(item.get('obs'))
                    if rein_obs is None:
                        continue

                    payload = json.dumps(rein_obs, ensure_ascii=False)
                    if len(payload.encode('utf-8')) > MAX_PAYLOAD_BYTES:
                        logger.warning(f'[fellestur] Oppføring {obs_id} for {kode} avvist — for stor payload')
                        continue

                    ny_rad = obs_id not in eksisterende_ider
                    if ny_rad:
                        if antall_rader >= MAX_OBS_PER_TUR:
                            logger.warning(f'[fellestur] {kode} har nådd maks antall oppføringer')
                            continue
                        antall_rader += 1
                        eksisterende_ider.add(obs_id)

                    conn.execute(
                        "INSERT INTO fellestur_obs (kode, obs_id, payload, registrert_av, created_ts, updated_ts) "
                        "VALUES (?,?,?,?,?,?) "
                        "ON CONFLICT(kode, obs_id) DO UPDATE SET "
                        "payload = excluded.payload, updated_ts = excluded.updated_ts",
                        (kode, obs_id, payload, registrert_av, now, now)
                    )

                for obs_id in deletes:
                    if not isinstance(obs_id, str):
                        continue
                    conn.execute(
                        "DELETE FROM fellestur_obs WHERE kode = ? AND obs_id = ?", (kode, obs_id)
                    )

                conn.commit()
    except Exception as e:
        logger.warning(f'[fellestur] Feil ved synk: {e}')
        return None

    return get_fellestur(kode)


# Initialiser databasen ved import (samme mønster som share_store/feedback_store)
try:
    init_db()
except Exception as e:
    logger.warning(f'[fellestur] Klarte ikke initialisere database: {e}')
