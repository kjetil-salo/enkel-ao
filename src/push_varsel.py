"""
Web push-varsler — foreløpig KUN for nyheter, og kun sendt for hånd.

Brukeren slår varsler på selv på `/varsler.html`. Appen spør aldri av seg selv:
et uoppfordret «vil du ha varsler?» er det raskeste måten å få et nei for alltid.

**Ingen automatisk utsending.** Serveren tar bare imot og lagrer abonnementer.
Selve sendingen startes manuelt fra kommandolinja, inne i containeren:

    docker compose -f docker-compose.pi.yml exec enkel-ao \\
        python3 -m src.push_varsel status
    docker compose -f docker-compose.pi.yml exec enkel-ao \\
        python3 -m src.push_varsel send --tittel "…" --tekst "…" [--kun <bit av endepunkt>] --send

**Varseltyper (emner).** Hvert abonnement har en liste over hva brukeren vil ha
varsel om, og en utsending går bare til dem som har valgt emnet. Foreløpig
finnes bare `nyheter`. En ny type (f.eks. meldinger fra AO) legges til i
`KJENTE_EMNER` her og i `VARSELTYPER` i `public/js/push-varsel.js`.

Uten `--send` er det en tørrkjøring som bare viser hvem som ville fått varselet.
`--kun` sender til abonnementer der endepunktet inneholder teksten. Bruk den
til å teste på din egen telefon før noen andre får varselet.

VAPID-nøkkelparet genereres automatisk første gang og lagres i docker-volumet
(samme mønster som `adminsti.py`). Mistes privatnøkkelen, er alle abonnementer
verdiløse: nettleseren har bundet dem til den offentlige nøkkelen. Brukerne må
da slå varsler av og på igjen.

Lagringen bruker bare standardbiblioteket. `cryptography` og `pywebpush`
importeres først når en nøkkel faktisk skal lages eller et varsel sendes. Da kan
abonnementsdelen testes uten dem.
"""
import argparse
import base64
import json
import logging
import os
import sqlite3
import sys
import threading
import time
from urllib.parse import urlparse

logger = logging.getLogger('fugleobs')

DB_PATH = os.environ.get('DB_PATH', '/data/stats.db')
VAPID_PRIVAT_FIL = os.environ.get('VAPID_PRIVAT_FIL', '/data/vapid_private.pem')
VAPID_OFFENTLIG_FIL = os.environ.get('VAPID_OFFENTLIG_FIL', '/data/vapid_public.txt')

# Avsenderen push-tjenesten kan kontakte ved misbruk. Påkrevd i VAPID. Settes i
# .env. Standardverdien er bare et nettsted, så ingen e-postadresse havner i repoet.
VAPID_KONTAKT = os.environ.get('VAPID_KONTAKT', 'https://ao.efugl.no')

# Bare kjente push-tjenester godtas som endepunkt. Uten en slik liste kunne
# hvem som helst registrere en vilkårlig URL, og serveren ville POSTet til den
# neste gang et varsel ble sendt: en åpen dør til interne adresser (SSRF).
TILLATTE_PUSH_VERTER = (
    'fcm.googleapis.com',             # Chrome, Edge og Samsung på Android
    'push.services.mozilla.com',      # Firefox
    'push.apple.com',                 # Safari og PWA på iOS 16.4+
    'notify.windows.com',             # Edge på Windows
)

# Varseltypene en bruker kan velge. Ukjente emner fra klienten droppes stille.
KJENTE_EMNER = ('nyheter',)

MAX_ENDEPUNKT_LEN = 1024
MAX_NOKKEL_LEN = 256

# Nyheter haster ikke. Er telefonen av i tre døgn, er varselet uansett utdatert.
PUSH_TTL_SEK = 3 * 24 * 3600

_laas = threading.Lock()


def _connect():
    os.makedirs(os.path.dirname(DB_PATH) or '.', exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS push_abonnement (
                endepunkt   TEXT PRIMARY KEY,
                p256dh      TEXT NOT NULL,
                auth        TEXT NOT NULL,
                emner       TEXT NOT NULL DEFAULT '["nyheter"]',
                opprettet_ts REAL NOT NULL,
                oppdatert_ts REAL NOT NULL
            )
        """)
        conn.commit()


def _er_base64url(verdi):
    if not verdi or len(verdi) > MAX_NOKKEL_LEN:
        return False
    try:
        base64.urlsafe_b64decode(verdi + '=' * (-len(verdi) % 4))
    except Exception:
        return False
    return all(c.isalnum() or c in '-_=' for c in verdi)


def endepunkt_er_gyldig(endepunkt):
    """Kun https mot en kjent push-tjeneste. Se TILLATTE_PUSH_VERTER."""
    if not isinstance(endepunkt, str) or len(endepunkt) > MAX_ENDEPUNKT_LEN:
        return False
    try:
        url = urlparse(endepunkt)
    except Exception:
        return False
    vert = (url.hostname or '').lower()
    if url.scheme != 'https' or not vert:
        return False
    return any(vert == v or vert.endswith('.' + v) for v in TILLATTE_PUSH_VERTER)


def rens_emner(emner):
    """Behold kjente emner i fast rekkefølge. Manglende liste betyr `nyheter`."""
    if emner is None:
        return ['nyheter']
    if not isinstance(emner, list):
        return []
    return [e for e in KJENTE_EMNER if e in emner]


def lagre_abonnement(abonnement, emner=None):
    """
    Lagre et abonnement slik nettleserens `PushSubscription.toJSON()` gir det:
    `{endpoint, keys: {p256dh, auth}}`, med valgte emner. Idempotent: samme
    endepunkt oppdateres. True ved suksess, False ved ugyldig innhold eller
    ingen kjente emner (vil brukeren ingenting, skal klienten avslutte i stedet).
    """
    if not isinstance(abonnement, dict):
        return False
    endepunkt = abonnement.get('endpoint')
    nokler = abonnement.get('keys') or {}
    if not isinstance(nokler, dict):
        return False
    p256dh = nokler.get('p256dh')
    auth = nokler.get('auth')
    if not endepunkt_er_gyldig(endepunkt) or not _er_base64url(p256dh) or not _er_base64url(auth):
        return False
    emner = rens_emner(emner)
    if not emner:
        return False

    naa = time.time()
    with _laas:
        with _connect() as conn:
            conn.execute(
                "INSERT INTO push_abonnement (endepunkt, p256dh, auth, emner, opprettet_ts, oppdatert_ts) "
                "VALUES (?,?,?,?,?,?) ON CONFLICT(endepunkt) DO UPDATE SET "
                "p256dh = excluded.p256dh, auth = excluded.auth, emner = excluded.emner, "
                "oppdatert_ts = excluded.oppdatert_ts",
                (endepunkt, p256dh, auth, json.dumps(emner), naa, naa),
            )
            conn.commit()
    return True


def slett_abonnement(endepunkt):
    """Fjern et abonnement. True hvis det fantes."""
    if not isinstance(endepunkt, str) or not endepunkt:
        return False
    with _laas:
        with _connect() as conn:
            cur = conn.execute("DELETE FROM push_abonnement WHERE endepunkt = ?", (endepunkt,))
            conn.commit()
            return cur.rowcount > 0


def hent_abonnementer(kun=None, emne=None):
    """
    Alle abonnementer, eventuelt bare de som har valgt `emne` og/eller der
    endepunktet inneholder `kun`.
    """
    with _connect() as conn:
        rader = conn.execute(
            "SELECT endepunkt, p256dh, auth, emner, opprettet_ts, oppdatert_ts "
            "FROM push_abonnement ORDER BY opprettet_ts"
        ).fetchall()
    ut = []
    for r in rader:
        rad = dict(r)
        try:
            rad['emner'] = json.loads(rad['emner'])
        except Exception:
            rad['emner'] = []
        ut.append(rad)
    if emne:
        ut = [r for r in ut if emne in r['emner']]
    if kun:
        ut = [r for r in ut if kun in r['endepunkt']]
    return ut


# ---------------------------------------------------------------------------
# VAPID-nøkler
# ---------------------------------------------------------------------------

def _les_fil(sti):
    try:
        with open(sti, 'r', encoding='utf-8') as f:
            return f.read().strip() or None
    except FileNotFoundError:
        return None


def _generer_nokkelpar():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    privat = ec.generate_private_key(ec.SECP256R1())
    pem = privat.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    rå = privat.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    offentlig = base64.urlsafe_b64encode(rå).decode('ascii').rstrip('=')

    os.makedirs(os.path.dirname(VAPID_PRIVAT_FIL) or '.', exist_ok=True)
    with open(VAPID_PRIVAT_FIL, 'wb') as f:
        f.write(pem)
    os.chmod(VAPID_PRIVAT_FIL, 0o600)
    with open(VAPID_OFFENTLIG_FIL, 'w', encoding='utf-8') as f:
        f.write(offentlig)
    logger.info(f'[PUSH] Nytt VAPID-nøkkelpar generert i {VAPID_PRIVAT_FIL}')
    return offentlig


def hent_offentlig_nokkel():
    """
    Den offentlige VAPID-nøkkelen nettleseren trenger for å abonnere.
    Lages første gang. None hvis den verken finnes eller kan lages.
    Da viser innstillingssiden at varsler ikke er tilgjengelige.
    """
    with _laas:
        offentlig = _les_fil(VAPID_OFFENTLIG_FIL)
        if offentlig and os.path.exists(VAPID_PRIVAT_FIL):
            return offentlig
        try:
            return _generer_nokkelpar()
        except Exception as e:
            logger.warning(f'[PUSH] Kunne ikke lage VAPID-nøkler: {e}')
            return None


# ---------------------------------------------------------------------------
# Sending (kun fra kommandolinja)
# ---------------------------------------------------------------------------

def lag_melding(tittel, tekst, url='/', tag='nyheter'):
    """Innholdet service workeren leser i `push`-hendelsen (public/sw.js)."""
    return {'title': tittel, 'body': tekst, 'url': url or '/', 'tag': tag or 'nyheter'}


def send_til(abonnementer, melding):
    """
    Send `melding` til hvert abonnement. Abonnementer push-tjenesten svarer
    404/410 på er avsluttet av nettleseren, og slettes. Returnerer
    `{'sendt': n, 'fjernet': n, 'feilet': n}`.
    """
    from pywebpush import WebPushException, webpush

    data = json.dumps(melding, ensure_ascii=False)
    resultat = {'sendt': 0, 'fjernet': 0, 'feilet': 0}
    for ab in abonnementer:
        try:
            webpush(
                subscription_info={
                    'endpoint': ab['endepunkt'],
                    'keys': {'p256dh': ab['p256dh'], 'auth': ab['auth']},
                },
                data=data,
                vapid_private_key=VAPID_PRIVAT_FIL,
                vapid_claims={'sub': VAPID_KONTAKT},
                ttl=PUSH_TTL_SEK,
                headers={'Urgency': 'low'},
                timeout=10,
            )
            resultat['sendt'] += 1
        except WebPushException as e:
            status = getattr(e.response, 'status_code', None)
            if status in (404, 410):
                slett_abonnement(ab['endepunkt'])
                resultat['fjernet'] += 1
            else:
                resultat['feilet'] += 1
                print(f'  Feilet ({status}): {ab["endepunkt"][:60]}… {e}', file=sys.stderr)
        except Exception as e:
            resultat['feilet'] += 1
            print(f'  Feilet: {ab["endepunkt"][:60]}… {e}', file=sys.stderr)
    return resultat


def _kort(endepunkt):
    vert = urlparse(endepunkt).hostname or '?'
    return f'{vert} …{endepunkt[-12:]}'


def main(argv=None):
    p = argparse.ArgumentParser(prog='python3 -m src.push_varsel',
                                description='Push-varsler for nyheter i Enkel-AO')
    under = p.add_subparsers(dest='kommando', required=True)

    under.add_parser('status', help='Vis antall abonnenter')

    s = under.add_parser('send', help='Send et varsel (tørrkjøring uten --send)')
    s.add_argument('--tittel', required=True)
    s.add_argument('--tekst', required=True)
    s.add_argument('--url', default='/', help='Siden som åpnes ved trykk (standard /)')
    s.add_argument('--tag', default=None,
                   help='Varsler med samme tag erstatter hverandre på telefonen (standard: emnet)')
    s.add_argument('--emne', default='nyheter', choices=KJENTE_EMNER,
                   help='Bare abonnenter som har valgt denne varseltypen (standard nyheter)')
    s.add_argument('--kun', help='Bare abonnementer der endepunktet inneholder denne teksten')
    s.add_argument('--send', action='store_true', help='Send faktisk. Uten dette: tørrkjøring')

    args = p.parse_args(argv)
    init_db()

    if args.kommando == 'status':
        alle = hent_abonnementer()
        print(f'{len(alle)} abonnement(er)')
        for ab in alle:
            opprettet = time.strftime('%Y-%m-%d %H:%M', time.localtime(ab['opprettet_ts']))
            print(f'  {opprettet}  {",".join(ab["emner"]):<12} {_kort(ab["endepunkt"])}')
        return 0

    mottakere = hent_abonnementer(kun=args.kun, emne=args.emne)
    melding = lag_melding(args.tittel, args.tekst, args.url, args.tag or args.emne)
    print(json.dumps(melding, ensure_ascii=False, indent=2))
    print(f'Mottakere: {len(mottakere)} med emnet «{args.emne}»'
          + (f', filtrert på «{args.kun}»' if args.kun else ' (ALLE som har valgt det)'))

    if not args.send:
        print('Tørrkjøring — ingenting sendt. Legg til --send for å sende.')
        return 0
    if not mottakere:
        print('Ingen mottakere.')
        return 0
    if not hent_offentlig_nokkel():
        print('Mangler VAPID-nøkler.', file=sys.stderr)
        return 1

    r = send_til(mottakere, melding)
    print(f'Sendt: {r["sendt"]}, fjernet (utløpt): {r["fjernet"]}, feilet: {r["feilet"]}')
    return 0 if r['feilet'] == 0 else 1


try:
    init_db()
except Exception as e:
    logger.warning(f'[PUSH] Klarte ikke initialisere database: {e}')


if __name__ == '__main__':
    sys.exit(main())
