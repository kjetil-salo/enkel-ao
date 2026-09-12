"""
Fellestur-føderasjon — kryss-app-bro mellom enkel-ao sin Fellestur og andre
apper (i første omgang Feltlogg) som følger samme peer-kontrakt.

Dette modulet endrer ALDRI hvordan Fellestur oppfører seg for vanlige
enkel-ao-brukere. Det er en tynn oversettelsesbro (se
docs/ANALYSIS_FELLESTUR_FODERASJON.md, alternativ B): innkommende og
utgående peer-events oversettes til/fra den samme `fellestur_obs`-tabellen
og de samme `apply_sync()`-kallene som `/api/fellestur-sync` allerede bruker.
En Feltlogg-bruker og en enkel-ao-bruker på samme kode ser bokstavelig talt
samme rader.

**Peer-kontrakten** (mottatt fra Feltlogg som "Appendix A" i et delt
dokument) er normativ for feltnavn, statuskoder og semantikk. Kort
oppsummert:

- Event-typer: `add`, `update`, `count` (delta), `delete`.
- Endepunkt: `POST <base>/<kode>/events`, `Authorization: Bearer <mottakers
  hemmelighet>`, batch på 1-50 events.
- Svar: `200 {accepted: [id...], seq}` — duplikate id-er (allerede sett)
  telles ikke med i `accepted`, men er ikke en feil.
- `400` ved ugyldig batch (hele batchen forkastes), `401` ved feil/manglende
  token, `404` når koden er ukjent/utløpt her, `413` ved >50 events.

**Design-valg fra analysen, verdt å huske ved videre endringer:**

- Kodeformat: 5 sifre overalt i enkel-ao nå (se `fellestur_store.py`) —
  matcher kontrakten uten oversettelse.
- Automatisk forwarding av ALLE fellesturer i v1 (ingen opt-in), bevisst
  besluttet av produkteier. Selve avgjørelsen sitter i `skal_forwardes()`
  under — endre KUN den funksjonen den dagen dette skal bli betinget.
- Utgående fra oss er alltid `add`/`update`/`delete` — vi genererer aldri en
  `count`-delta selv, siden mutasjonslaget i enkel-ao ikke skiller en
  antall-endring fra annen redigering. Innkommende `count`-events fra en
  peer håndteres derimot korrekt som delta (se `_apply_count_delta`).
  Akseptert forenkling — se risikotabellen i analysen.
- Validering her er bevisst minimal: de feltene `sanitize_observasjon()` i
  `fellestur_store.py` uansett vasker/kapper (lengder, ukjente felt) valideres
  IKKE på nytt her. Vi validerer kun det som ville fått `apply_sync()` til å
  hoppe stille over en rad (manglende artsnavn/sted/dato/antall) — uten det
  ville en ugyldig batch fått `200 accepted:[...]` uten at noe faktisk ble
  lagret, som bryter kontraktens `400`-garanti.
"""
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import threading
import time

from src import fellestur_store

logger = logging.getLogger('fugleobs')

# Samme database som fellestur_store (stats.db) — én egen tabell for
# idempotens på mottatte peer-event-ider.
DB_PATH = os.environ.get('DB_PATH', '/data/stats.db')

# Persistert på /data (docker-volum), IKKE i repo-mappen — repo-innholdet
# rsynces/bygges på nytt ved hver deploy og overlever ikke en rebuild.
SECRET_PATH = os.environ.get('FELLESTUR_PEER_SECRET_PATH', '/data/fellestur_peer_secret.txt')
PROVIDERS_PATH = os.environ.get('FELLESTUR_PEER_PROVIDERS_PATH', '/data/fellestur_peer_providers.json')

MAX_EVENTS_PER_BATCH = 50
SEEN_TTL_SEC = 7 * 24 * 3600  # rydding — ikke del av selve fellestur-TTL-en
HTTP_TIMEOUT_SEC = 10
RETRY_BACKOFFS = (2, 10, 60)  # sekunder mellom forsøk 1→2, 2→3, 3→4

_PEER_REGISTRERT_AV = 'Ekstern app'

_KODE_RE = re.compile(r'^\d{5}$')
_EVENT_ID_RE = re.compile(r'^[A-Za-z0-9_-]{8,64}$')
_SIGHTING_ID_RE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_ALLOWED_TYPES = {'add', 'update', 'count', 'delete'}


def _connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS fellestur_peer_seen (
                event_id    TEXT PRIMARY KEY,
                kode        TEXT NOT NULL,
                received_ts REAL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_fellestur_peer_seen_kode ON fellestur_peer_seen(kode)")
        conn.commit()


# ---------------------------------------------------------------------------
# Hemmeligheter og providere
# ---------------------------------------------------------------------------

def get_own_secret():
    """
    Vår egen inbound-hemmelighet — det peers skal sende som Bearer-token til
    OSS. Genereres automatisk første gang den trengs, lagres på /data
    (overlever container-rebuild), aldri logget. Returnerer None (aldri en
    feil) hvis lesing/skriving mislykkes — inbound-auth svarer da alltid 401
    i stedet for å krasje.
    """
    try:
        if os.path.exists(SECRET_PATH):
            with open(SECRET_PATH, 'r') as f:
                secret = f.read().strip()
            if secret:
                return secret
        secret = secrets.token_urlsafe(32)
        os.makedirs(os.path.dirname(SECRET_PATH), exist_ok=True)
        with open(SECRET_PATH, 'w') as f:
            f.write(secret)
        try:
            os.chmod(SECRET_PATH, 0o600)
        except OSError:
            pass
        return secret
    except Exception as e:
        logger.warning(f'[fellestur-peer] Klarte ikke lese/generere eget secret: {e}')
        return None


def verify_inbound_token(auth_header: str) -> bool:
    """Constant-time sammenligning av `Authorization: Bearer <token>` mot vårt eget secret."""
    if not auth_header or not auth_header.startswith('Bearer '):
        return False
    token = auth_header[len('Bearer '):].strip()
    own = get_own_secret()
    if not own or not token:
        return False
    return hmac.compare_digest(token, own)


def load_providers():
    """
    Liste over `{'name', 'url', 'secret'}` — `secret` er DEN ANDRE partens
    hemmelighet (det vi skal sende som Bearer til dem). Manglende eller
    ugyldig fil → tom liste, aldri en feil. Ingen fil = ingen peers =
    funksjonen er et rent no-op, resten av Fellestur upåvirket.
    """
    try:
        if not os.path.exists(PROVIDERS_PATH):
            return []
        with open(PROVIDERS_PATH, 'r') as f:
            data = json.load(f)
        if not isinstance(data, list):
            return []
        out = []
        for p in data:
            if isinstance(p, dict) and p.get('url') and p.get('secret'):
                out.append({'name': str(p.get('name', '?')), 'url': str(p['url']), 'secret': str(p['secret'])})
        return out
    except Exception as e:
        logger.warning(f'[fellestur-peer] Klarte ikke lese providers-fil: {e}')
        return []


def skal_forwardes(tur: dict) -> bool:
    """
    Skal denne turens hendelser sendes videre til konfigurerte providere?

    v1: alltid True — automatisk deling av alt, bevisst besluttet av
    produkteier (se docs/ANALYSIS_FELLESTUR_FODERASJON.md). Holdt som egen
    funksjon med turen som parameter nettopp slik at en fremtidig
    per-tur-avgjørelse (f.eks. et eksplisitt "del med tilkoblede apper"-valg
    satt ved opprettelse) kun krever å endre DENNE funksjonen — kallerne og
    resten av modulen trenger ikke røres.
    """
    return True


# ---------------------------------------------------------------------------
# Utgående — fan-out til providere
# ---------------------------------------------------------------------------

def _split_ts(ts):
    """`'YYYY-MM-DDTHH:MM:SS'` → `(dato, 'HH:MM')`, eller `('', '')` hvis tom/ugyldig."""
    if not isinstance(ts, str) or 'T' not in ts:
        return '', ''
    dato, _, tid = ts.partition('T')
    return dato, tid[:5]


def obs_to_sighting(obs_id: str, obs: dict) -> dict:
    """Oversett en enkel-ao-observasjon (fellestur_store sin form) til Feltloggs `sighting`-skjema."""
    obs = obs or {}
    dato, tid_fra = _split_ts(obs.get('timestamp'))
    _, tid_til = _split_ts(obs.get('tilKlokkeslett'))
    species = obs.get('species') or {}
    place_id = obs.get('placeId')
    return {
        'id': obs_id,
        'location': obs.get('placeName') or '',
        'locationId': str(place_id) if place_id not in (None, '') else '',
        'date': dato,
        'timeFrom': tid_fra,
        'timeTo': tid_til or tid_fra,
        'species': species.get('taxonName') or '',
        'count': obs.get('count') if isinstance(obs.get('count'), int) else 1,
        'activity': obs.get('activity') or '',
        'age': obs.get('age') or '',
        'gender': obs.get('gender') or '',
        'comments': obs.get('comment') or '',
        'hideUntil': '',
        'notObservedSelf': False,
        'locked': bool(obs.get('visitLocked')),
    }


def _bygg_utgaende_event(kode: str, etype: str, obs_id: str, obs, registrert_av: str) -> dict:
    sighting = {'id': obs_id} if etype == 'delete' else obs_to_sighting(obs_id, obs)
    return {
        'id': f'eao_{secrets.token_urlsafe(9)}',
        'code': kode,
        'type': etype,
        'origin': f'enkelao:{(registrert_av or "-").strip()[:40]}',
        'sighting': sighting,
    }


def fan_out(kode: str, endringer: list, tur: dict, registrert_av: str = ''):
    """
    Bygg og send utgående events til alle konfigurerte providere, på en
    bakgrunnstråd — blokkerer aldri klientens egen `/api/fellestur-sync`-kall.

    `endringer` er en liste av `(type, obs_id, obs_eller_None)`-tupler, samlet
    opp av `fellestur_store.apply_sync()` sin `on_event`-callback.
    """
    if not endringer:
        return
    if not skal_forwardes(tur):
        return
    providers = load_providers()
    if not providers:
        return

    events = [_bygg_utgaende_event(kode, etype, obs_id, obs, registrert_av) for etype, obs_id, obs in endringer]
    thread = threading.Thread(target=_send_to_providers, args=(providers, events), daemon=True)
    thread.start()
    return thread


def _send_to_providers(providers, events):
    for provider in providers:
        try:
            _send_with_retry(provider, events)
        except Exception as e:
            logger.warning(f"[fellestur-peer] Uventet feil mot provider {provider.get('name', '?')}: {e}")


def _send_with_retry(provider, events):
    import httpx

    url = f"{provider['url'].rstrip('/')}/{events[0]['code']}/events"
    navn = provider.get('name', '?')
    forsok = 0
    while True:
        try:
            r = httpx.post(
                url,
                json={'events': events},
                headers={
                    'Authorization': f"Bearer {provider['secret']}",
                    'Content-Type': 'application/json; charset=utf-8',
                },
                timeout=HTTP_TIMEOUT_SEC,
            )
        except Exception as e:
            feil_beskrivelse = f'nettverksfeil: {e}'
            status = None
        else:
            status = r.status_code
            feil_beskrivelse = f'HTTP {status}'
            if status == 200:
                return
            if status in (400, 401, 404, 413):
                # Ikke en feil å logge høyt for 404 — helt forventet når
                # peeren ikke har noen deltaker på denne koden (jf. D14).
                if status == 404:
                    logger.info(f'[fellestur-peer] {navn} kjenner ikke koden ennå (404) — dropper batch')
                else:
                    logger.warning(f'[fellestur-peer] {navn} avviste batch ({status}) — dropper, ingen retry')
                return

        if forsok >= len(RETRY_BACKOFFS):
            logger.warning(f'[fellestur-peer] Ga opp å nå {navn} etter {forsok + 1} forsøk ({feil_beskrivelse})')
            return
        time.sleep(RETRY_BACKOFFS[forsok])
        forsok += 1


# ---------------------------------------------------------------------------
# Innkommende — motta events fra en peer
# ---------------------------------------------------------------------------

def _validate_event(ev, kode):
    """
    Minimal strukturvalidering. Returnerer en feilmelding (streng) eller None.

    Bevisst ikke fullstendig — feltlengder og ukjente felt vaskes uansett av
    `fellestur_store.sanitize_observasjon()` når vi kaller `apply_sync()`
    lenger nede. Det vi MÅ fange her er alt som ellers ville fått
    `apply_sync()` til å hoppe stille over raden (manglende artsnavn, sted,
    dato, antall) — uten det ville batchen fått `200 accepted` uten at noe
    faktisk ble lagret, som bryter kontraktens 400-garanti (Appendix A.3).
    """
    if not isinstance(ev, dict):
        return 'event må være et objekt'
    if not isinstance(ev.get('id'), str) or not _EVENT_ID_RE.match(ev['id']):
        return 'ugyldig eller manglende event-id'
    if ev.get('code') != kode:
        return 'code i event matcher ikke <kode> i URL-en'
    etype = ev.get('type')
    if etype not in _ALLOWED_TYPES:
        return 'ugyldig type'
    origin = ev.get('origin')
    if not isinstance(origin, str) or not (1 <= len(origin) <= 64):
        return 'ugyldig eller manglende origin'
    sighting = ev.get('sighting')
    if not isinstance(sighting, dict):
        return 'mangler sighting'
    if not isinstance(sighting.get('id'), str) or not _SIGHTING_ID_RE.match(sighting['id']):
        return 'ugyldig sighting.id'

    if etype == 'count':
        delta = ev.get('delta')
        if not isinstance(delta, int) or isinstance(delta, bool) or delta == 0 or not (-1000 <= delta <= 1000):
            return 'ugyldig delta'

    if etype in ('add', 'update'):
        if not isinstance(sighting.get('location'), str) or not sighting['location'].strip():
            return 'mangler sighting.location'
        if not _DATE_RE.match(sighting.get('date') or ''):
            return 'ugyldig eller manglende sighting.date'
        if not isinstance(sighting.get('species'), str) or not sighting['species'].strip():
            return 'mangler sighting.species'
        count = sighting.get('count')
        if not isinstance(count, int) or isinstance(count, bool) or count < 1:
            return 'ugyldig sighting.count'

    return None


def sighting_to_obs(sighting: dict) -> dict:
    """Oversett Feltloggs `sighting`-skjema til enkel-ao sin observasjonsform (før sanitize_observasjon)."""
    dato = sighting.get('date') or ''
    tid_fra = sighting.get('timeFrom') or ''
    tid_til = sighting.get('timeTo') or tid_fra
    timestamp = f"{dato}T{tid_fra or '00:00'}:00" if dato else None
    til_klokkeslett = f"{dato}T{tid_til or '00:00'}:00" if dato else None
    return {
        'species': {
            'taxonName': sighting.get('species') or '',
            'taxonId': None,
            'scientificNameHtml': None,
        },
        'count': sighting.get('count'),
        'activity': sighting.get('activity') or '',
        'placeName': sighting.get('location') or '',
        'placeId': sighting.get('locationId') or None,
        'visitId': None,
        'visitLocked': bool(sighting.get('locked')),
        'timestamp': timestamp,
        'tilKlokkeslett': til_klokkeslett,
        'age': sighting.get('age') or '',
        'gender': sighting.get('gender') or '',
        'comment': sighting.get('comments') or '',
        'coObservers': [],
    }


def _apply_count_delta(kode: str, sighting: dict, delta: int):
    """
    `count = max(1, lokal + delta)`, jf. Appendix A.7. Ukjent id → ignorer.

    Merk: leser gjeldende rad og skriver den tilbake i to separate kall
    (ingen delt lås mulig her — `fellestur_store._lock` er ikke reentrant og
    `apply_sync()` tar den selv). En sjelden race mot en samtidig endring på
    nøyaktig samme rad fra en annen kilde er en akseptert risiko, samme
    kategori som count-race mellom apper — se analysens risikotabell.
    """
    tur = fellestur_store.get_fellestur(kode)
    if not tur:
        return
    rad = next((o for o in tur['observasjoner'] if o.get('id') == sighting['id']), None)
    if rad is None:
        return
    obs = {k: v for k, v in rad.items() if k not in ('id', 'registrert_av', 'created_ts', 'updated_ts')}
    obs['count'] = max(1, (obs.get('count') or 0) + delta)
    dato = sighting.get('date')
    if dato:
        tid_fra = sighting.get('timeFrom') or ''
        tid_til = sighting.get('timeTo') or tid_fra
        obs['timestamp'] = f"{dato}T{tid_fra or '00:00'}:00"
        obs['tilKlokkeslett'] = f"{dato}T{tid_til or '00:00'}:00"
    fellestur_store.apply_sync(kode, upserts=[{'id': sighting['id'], 'obs': obs}])


def _apply_single_event(kode: str, ev: dict):
    etype = ev['type']
    sighting = ev['sighting']
    if etype == 'delete':
        fellestur_store.apply_sync(kode, deletes=[sighting['id']])
    elif etype == 'count':
        _apply_count_delta(kode, sighting, ev.get('delta', 0))
    else:  # add / update
        obs = sighting_to_obs(sighting)
        fellestur_store.apply_sync(kode, upserts=[{'id': sighting['id'], 'obs': obs}], registrert_av=_PEER_REGISTRERT_AV)


def _is_seen(event_id: str) -> bool:
    with _connect() as conn:
        return conn.execute("SELECT 1 FROM fellestur_peer_seen WHERE event_id = ?", (event_id,)).fetchone() is not None


def _mark_seen(event_id: str, kode: str):
    with _connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO fellestur_peer_seen (event_id, kode, received_ts) VALUES (?,?,?)",
            (event_id, kode, time.time())
        )


def _purge_old_seen():
    with _connect() as conn:
        conn.execute("DELETE FROM fellestur_peer_seen WHERE received_ts < ?", (time.time() - SEEN_TTL_SEC,))


def _count_seen(kode: str) -> int:
    with _connect() as conn:
        return conn.execute("SELECT COUNT(*) AS n FROM fellestur_peer_seen WHERE kode = ?", (kode,)).fetchone()['n']


def apply_peer_batch(kode: str, events) -> tuple[dict, int]:
    """
    Anvend en innkommende batch fra en peer. Returnerer `(json_body, status)`.

    Følger Appendix A.3 presist: hele batchen forkastes (400) ved
    valideringsfeil FØR noe som helst lagres; en ukjent/utløpt kode gir 404;
    duplikate event-id-er (allerede sett) hoppes stille over og telles ikke
    med i `accepted`, men er ikke en feil.

    Bruker korte, separate tilkoblinger per oppslag/merking i stedet for én
    lang transaksjon rundt hele løkka — `fellestur_store.apply_sync()` åpner
    sin egen tilkobling til samme database internt, og en omsluttende, ennå
    uncommitet transaksjon her ville låst den ute («database is locked»).
    """
    if not isinstance(kode, str) or not _KODE_RE.match(kode):
        return {'error': 'Ugyldig kode — skal være 5 siffer'}, 400
    if not isinstance(events, list) or not events:
        return {'error': 'events må være en liste med 1-50 elementer'}, 400
    if len(events) > MAX_EVENTS_PER_BATCH:
        return {'error': f'For mange events i én batch (maks {MAX_EVENTS_PER_BATCH})'}, 413

    for ev in events:
        feil = _validate_event(ev, kode)
        if feil:
            return {'error': feil}, 400

    tur = fellestur_store.get_fellestur(kode)
    if tur is None:
        return {'error': 'Ukjent eller utløpt kode'}, 404

    _purge_old_seen()
    accepted = []
    for ev in events:
        eid = ev['id']
        if _is_seen(eid):
            continue
        try:
            _apply_single_event(kode, ev)
        except Exception as e:
            logger.warning(f'[fellestur-peer] Feil ved anvendelse av event {eid}: {e}')
            continue
        _mark_seen(eid, kode)
        accepted.append(eid)

    return {'accepted': accepted, 'seq': _count_seen(kode)}, 200


try:
    init_db()
except Exception as e:
    logger.warning(f'[fellestur-peer] Klarte ikke initialisere database: {e}')
