"""Tester for push-abonnementer (src/push_varsel.py og /api/push-*)."""
import os
import sys
import tempfile
import threading
from http.server import HTTPServer

import pytest
import requests

REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

_TMP = tempfile.mkdtemp()
os.environ['DB_PATH'] = os.path.join(_TMP, 'push_test.db')

from src import push_varsel  # noqa: E402
from server import Handler  # noqa: E402

push_varsel.DB_PATH = os.path.join(_TMP, 'push_test.db')
push_varsel.init_db()

FCM = 'https://fcm.googleapis.com/fcm/send/abc123'
APPLE = 'https://web.push.apple.com/QGx-et-endepunkt'
NOKLER = {'p256dh': 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
          'auth': 'tBHItJI5svbpez7KI4CCXg'}


@pytest.fixture(autouse=True)
def tom_tabell():
    with push_varsel._connect() as conn:
        conn.execute('DELETE FROM push_abonnement')
        conn.commit()


def ab(endpoint=FCM, keys=None):
    return {'endpoint': endpoint, 'keys': dict(NOKLER) if keys is None else keys}


def test_lagre_og_hente():
    assert push_varsel.lagre_abonnement(ab()) is True
    rader = push_varsel.hent_abonnementer()
    assert len(rader) == 1
    assert rader[0]['endepunkt'] == FCM
    assert rader[0]['p256dh'] == NOKLER['p256dh']


def test_samme_endepunkt_to_ganger_gir_en_rad():
    push_varsel.lagre_abonnement(ab())
    push_varsel.lagre_abonnement(ab(keys={**NOKLER, 'auth': 'nyAuthNokkel123'}))
    rader = push_varsel.hent_abonnementer()
    assert len(rader) == 1
    assert rader[0]['auth'] == 'nyAuthNokkel123'


@pytest.mark.parametrize('endepunkt', [
    'http://fcm.googleapis.com/fcm/send/x',          # ikke https
    'https://evil.example/fcm.googleapis.com',       # verten er ikke en push-tjeneste
    'https://fcm.googleapis.com.evil.example/x',     # suffiks-triks
    'https://localhost/x',
    'https://169.254.169.254/latest/meta-data',
    'https://fcm.googleapis.com/' + 'x' * 2000,      # for langt
    None,
    12,
])
def test_ukjente_og_ugyldige_endepunkter_avvises(endepunkt):
    """Serveren POSTer til endepunktet ved utsending: vilkårlige URL-er ville vært SSRF."""
    assert push_varsel.lagre_abonnement(ab(endpoint=endepunkt)) is False
    assert push_varsel.hent_abonnementer() == []


def test_kjente_push_tjenester_godtas():
    for e in (FCM, APPLE, 'https://updates.push.services.mozilla.com/wpush/v2/x',
              'https://db5p.notify.windows.com/w/?token=x'):
        assert push_varsel.lagre_abonnement(ab(endpoint=e)) is True, e


@pytest.mark.parametrize('keys', [
    {}, {'p256dh': NOKLER['p256dh']}, {'p256dh': 'har mellomrom', 'auth': 'x'},
    {'p256dh': NOKLER['p256dh'], 'auth': 'a' * 300}, 'ikke-et-objekt',
])
def test_ugyldige_nokler_avvises(keys):
    assert push_varsel.lagre_abonnement(ab(keys=keys)) is False


def test_slett():
    push_varsel.lagre_abonnement(ab())
    assert push_varsel.slett_abonnement(FCM) is True
    assert push_varsel.slett_abonnement(FCM) is False
    assert push_varsel.hent_abonnementer() == []


def test_kun_filtrerer_pa_endepunkt():
    push_varsel.lagre_abonnement(ab(FCM))
    push_varsel.lagre_abonnement(ab(APPLE))
    assert [r['endepunkt'] for r in push_varsel.hent_abonnementer(kun='apple')] == [APPLE]


def test_torrkjoring_sender_ingenting(capsys, monkeypatch):
    push_varsel.lagre_abonnement(ab())
    kalt = []
    monkeypatch.setattr(push_varsel, 'send_til', lambda *a: kalt.append(a))
    assert push_varsel.main(['send', '--tittel', 'T', '--tekst', 'B']) == 0
    assert kalt == []
    assert 'Tørrkjøring' in capsys.readouterr().out


def test_send_med_kun_gar_bare_til_filtrerte(monkeypatch):
    push_varsel.lagre_abonnement(ab(FCM))
    push_varsel.lagre_abonnement(ab(APPLE))
    kalt = []
    monkeypatch.setattr(push_varsel, 'hent_offentlig_nokkel', lambda: 'nokkel')
    monkeypatch.setattr(push_varsel, 'send_til',
                        lambda abs_, m: kalt.append((abs_, m)) or {'sendt': len(abs_), 'fjernet': 0, 'feilet': 0})
    assert push_varsel.main(['send', '--tittel', 'T', '--tekst', 'B', '--url', '/changelog.html',
                             '--kun', 'apple', '--send']) == 0
    assert [a['endepunkt'] for a in kalt[0][0]] == [APPLE]
    assert kalt[0][1] == {'title': 'T', 'body': 'B', 'url': '/changelog.html', 'tag': 'nyheter'}


def test_emner_lagres_og_ukjente_droppes():
    assert push_varsel.lagre_abonnement(ab(), ['nyheter', 'finnes-ikke']) is True
    assert push_varsel.hent_abonnementer()[0]['emner'] == ['nyheter']


def test_uten_emner_er_standard_nyheter():
    """Eldre klient som ikke sender emner, skal fortsatt få nyheter."""
    push_varsel.lagre_abonnement(ab())
    assert push_varsel.hent_abonnementer()[0]['emner'] == ['nyheter']


@pytest.mark.parametrize('emner', [[], ['finnes-ikke'], 'nyheter'])
def test_ingen_kjente_emner_avvises(emner):
    """Vil brukeren ingenting, skal klienten avslutte abonnementet, ikke lagre et tomt."""
    assert push_varsel.lagre_abonnement(ab(), emner) is False
    assert push_varsel.hent_abonnementer() == []


def test_utsending_gar_bare_til_dem_som_har_valgt_emnet(monkeypatch):
    push_varsel.lagre_abonnement(ab(FCM), ['nyheter'])
    monkeypatch.setattr(push_varsel, 'KJENTE_EMNER', ('nyheter', 'ao-meldinger'))
    push_varsel.lagre_abonnement(ab(APPLE), ['ao-meldinger'])
    assert [r['endepunkt'] for r in push_varsel.hent_abonnementer(emne='nyheter')] == [FCM]
    assert [r['endepunkt'] for r in push_varsel.hent_abonnementer(emne='ao-meldinger')] == [APPLE]


# --- HTTP-endepunktene -------------------------------------------------------

@pytest.fixture(scope='module')
def base_url():
    server = HTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f'http://127.0.0.1:{server.server_address[1]}'
    server.shutdown()


def test_api_subscribe_og_unsubscribe(base_url):
    r = requests.post(f'{base_url}/api/push-subscribe',
                      json={'subscription': ab(), 'emner': ['nyheter']}, timeout=5)
    assert r.status_code == 200 and r.json() == {'ok': True}
    assert push_varsel.hent_abonnementer()[0]['emner'] == ['nyheter']

    r = requests.post(f'{base_url}/api/push-unsubscribe', json={'endpoint': FCM}, timeout=5)
    assert r.status_code == 200
    assert push_varsel.hent_abonnementer() == []


def test_api_subscribe_avviser_ugyldig(base_url):
    r = requests.post(f'{base_url}/api/push-subscribe',
                      json={'subscription': ab(endpoint='https://evil.example/x')}, timeout=5)
    assert r.status_code == 400
    assert push_varsel.hent_abonnementer() == []


def test_api_offentlig_nokkel_svarer_null_uten_nokler(base_url, monkeypatch):
    monkeypatch.setattr(push_varsel, 'hent_offentlig_nokkel', lambda: None)
    r = requests.get(f'{base_url}/api/push-public-key', timeout=5)
    assert r.status_code == 200 and r.json() == {'publicKey': None}


def test_api_offentlig_nokkel_leses_fra_fil(base_url, monkeypatch, tmp_path):
    privat = tmp_path / 'p.pem'
    offentlig = tmp_path / 'o.txt'
    privat.write_text('dummy')
    offentlig.write_text('BOffentligNokkel')
    monkeypatch.setattr(push_varsel, 'VAPID_PRIVAT_FIL', str(privat))
    monkeypatch.setattr(push_varsel, 'VAPID_OFFENTLIG_FIL', str(offentlig))
    r = requests.get(f'{base_url}/api/push-public-key', timeout=5)
    assert r.json() == {'publicKey': 'BOffentligNokkel'}


def test_nokkelpar_genereres_med_riktig_format(monkeypatch, tmp_path):
    pytest.importorskip('cryptography')
    monkeypatch.setattr(push_varsel, 'VAPID_PRIVAT_FIL', str(tmp_path / 'p.pem'))
    monkeypatch.setattr(push_varsel, 'VAPID_OFFENTLIG_FIL', str(tmp_path / 'o.txt'))
    nokkel = push_varsel.hent_offentlig_nokkel()
    # Ukomprimert P-256-punkt: 65 bytes → 87 tegn base64url uten padding
    assert len(nokkel) == 87 and nokkel.startswith('B')
    assert push_varsel.hent_offentlig_nokkel() == nokkel  # gjenbrukes, lages ikke på nytt
    assert oct((tmp_path / 'p.pem').stat().st_mode & 0o777) == '0o600'



# --- Ende-til-ende: kryptering og VAPID mot en falsk push-tjeneste ------------

def _b64url_dekod(v):
    import base64
    return base64.urlsafe_b64decode(v + '=' * (-len(v) % 4))


def test_send_til_kan_dekrypteres_av_mottakeren(monkeypatch, tmp_path):
    """
    Spiller nettleseren: lager et ekte ECDH-nøkkelpar og en auth-hemmelighet,
    sender via pywebpush til en lokal falsk push-tjeneste, dekrypterer det som
    kom fram og sjekker VAPID-signaturen mot serverens offentlige nøkkel.
    Fanger feil i nøkkelformat, VAPID og kryptering uten en ekte telefon.
    """
    pytest.importorskip('pywebpush')
    import base64
    import json
    import secrets
    from http.server import BaseHTTPRequestHandler

    import http_ece
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

    monkeypatch.setattr(push_varsel, 'VAPID_PRIVAT_FIL', str(tmp_path / 'p.pem'))
    monkeypatch.setattr(push_varsel, 'VAPID_OFFENTLIG_FIL', str(tmp_path / 'o.txt'))
    server_offentlig = push_varsel.hent_offentlig_nokkel()

    # «Nettleseren»
    klient = ec.generate_private_key(ec.SECP256R1())
    klient_pub = klient.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    auth = secrets.token_bytes(16)
    b64 = lambda b: base64.urlsafe_b64encode(b).decode().rstrip('=')  # noqa: E731

    mottatt = {}

    class FalskPushTjeneste(BaseHTTPRequestHandler):
        def do_POST(self):
            mottatt['headers'] = dict(self.headers)
            mottatt['body'] = self.rfile.read(int(self.headers['Content-Length']))
            self.send_response(201)
            self.end_headers()

        def log_message(self, *a):
            pass

    tjeneste = HTTPServer(('127.0.0.1', 0), FalskPushTjeneste)
    threading.Thread(target=tjeneste.serve_forever, daemon=True).start()
    try:
        endepunkt = f'http://127.0.0.1:{tjeneste.server_address[1]}/push/abc'
        melding = push_varsel.lag_melding('Nytt i Enkel-AO', 'Æ, ø og å kommer fram', '/changelog.html')
        r = push_varsel.send_til(
            [{'endepunkt': endepunkt, 'p256dh': b64(klient_pub), 'auth': b64(auth)}], melding)
    finally:
        tjeneste.shutdown()

    assert r == {'sendt': 1, 'fjernet': 0, 'feilet': 0}
    h = {k.lower(): v for k, v in mottatt['headers'].items()}
    assert h['content-encoding'] == 'aes128gcm'
    assert h['ttl'] == str(push_varsel.PUSH_TTL_SEK)
    assert h['urgency'] == 'low'

    # Innholdet kan dekrypteres med nettleserens private nøkkel
    klartekst = http_ece.decrypt(mottatt['body'], private_key=klient, auth_secret=auth, version='aes128gcm')
    assert json.loads(klartekst) == melding

    # VAPID: «vapid t=<jwt>, k=<offentlig nøkkel>», signert med serverens nøkkel
    vapid = h['authorization']
    assert vapid.startswith('vapid ')
    deler = dict(p.strip().split('=', 1) for p in vapid[len('vapid '):].split(','))
    assert deler['k'] == server_offentlig
    hode, nyttelast, signatur = deler['t'].split('.')
    claims = json.loads(_b64url_dekod(nyttelast))
    assert claims['sub'] == push_varsel.VAPID_KONTAKT
    assert claims['aud'] == f'http://127.0.0.1:{tjeneste.server_address[1]}'
    sig = _b64url_dekod(signatur)
    offentlig = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), _b64url_dekod(server_offentlig))
    offentlig.verify(
        encode_dss_signature(int.from_bytes(sig[:32], 'big'), int.from_bytes(sig[32:], 'big')),
        f'{hode}.{nyttelast}'.encode(), ec.ECDSA(hashes.SHA256()))


def test_send_til_fjerner_abonnement_som_er_borte(monkeypatch):
    """410 Gone fra push-tjenesten = nettleseren har avsluttet abonnementet."""
    pywebpush = pytest.importorskip('pywebpush')
    push_varsel.lagre_abonnement(ab())

    class Svar:
        status_code = 410

    def feiler(**_):
        raise pywebpush.WebPushException('borte', response=Svar())

    monkeypatch.setattr(pywebpush, 'webpush', feiler)
    r = push_varsel.send_til(push_varsel.hent_abonnementer(), push_varsel.lag_melding('T', 'B'))
    assert r == {'sendt': 0, 'fjernet': 1, 'feilet': 0}
    assert push_varsel.hent_abonnementer() == []
