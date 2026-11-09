"""Tester for tilbakemeldingskanalen (/api/feedback + admin)."""
import os
import sys
import tempfile
import threading
import time
from http.server import HTTPServer

import pytest
import requests

REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

# Bruk en isolert temp-DB før feedback_store importeres (leser DB_PATH ved import).
_TMP_DB = os.path.join(tempfile.mkdtemp(), 'feedback_test.db')
os.environ['DB_PATH'] = _TMP_DB

from src import feedback_store  # noqa: E402
from server import Handler  # noqa: E402

# Sørg for at både modulen og en ev. tidligere lastet instans bruker temp-DB.
feedback_store.DB_PATH = _TMP_DB
feedback_store.init_db()


def start_server(port):
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def test_create_feedback_returns_case_no():
    case_no = feedback_store.create_feedback('Testmelding', fb_type='feil', email='a@b.no')
    assert case_no and case_no.startswith('AO-')
    assert len(case_no) == 3 + feedback_store._CASE_LENGTH

    items = feedback_store.list_feedback()
    assert any(it['case_no'] == case_no for it in items)


def test_empty_message_rejected():
    assert feedback_store.create_feedback('   ') is None


def test_invalid_type_falls_back_to_annet():
    case_no = feedback_store.create_feedback('Hei', fb_type='tull')
    item = next(it for it in feedback_store.list_feedback() if it['case_no'] == case_no)
    assert item['type'] == 'annet'


def test_set_status():
    case_no = feedback_store.create_feedback('Statustest')
    assert feedback_store.set_status(case_no, 'løst') is True
    assert feedback_store.set_status(case_no, 'ugyldig') is False
    item = next(it for it in feedback_store.list_feedback() if it['case_no'] == case_no)
    assert item['status'] == 'løst'


def test_feedback_endpoint_end_to_end():
    port = 38070
    srv = start_server(port)
    time.sleep(0.05)
    try:
        r = requests.post(f'http://127.0.0.1:{port}/api/feedback',
                          json={'type': 'ønske', 'message': 'Ønsker mørk modus'})
        assert r.status_code == 200
        data = r.json()
        assert data['ok'] is True
        assert data['caseNo'].startswith('AO-')

        # Tom melding → 400
        r2 = requests.post(f'http://127.0.0.1:{port}/api/feedback', json={'message': '  '})
        assert r2.status_code == 400
    finally:
        srv.shutdown()


def test_honeypot_does_not_store():
    port = 38071
    srv = start_server(port)
    time.sleep(0.05)
    try:
        before = len(feedback_store.list_feedback(limit=1000))
        r = requests.post(f'http://127.0.0.1:{port}/api/feedback',
                          json={'message': 'spam', 'website': 'http://spam.example'})
        assert r.status_code == 200
        after = len(feedback_store.list_feedback(limit=1000))
        assert after == before  # honeypot → ingenting lagret
    finally:
        srv.shutdown()


def test_email_notify_noop_when_unconfigured(monkeypatch):
    from src import email_notify
    monkeypatch.delenv('FEEDBACK_NOTIFY_TO', raising=False)
    monkeypatch.delenv('RESEND_API_KEY', raising=False)
    monkeypatch.delenv('SMTP2GO_API_KEY', raising=False)
    assert email_notify.is_configured() is False
    # Skal returnere False uten å kaste og uten å prøve å sende
    assert email_notify.send_feedback_notification('AO-TEST1', 'feil', 'hei') is False


def test_email_notify_smtp_path(monkeypatch):
    from src import email_notify
    monkeypatch.setenv('FEEDBACK_NOTIFY_TO', 'eier@eks.no')
    monkeypatch.setenv('FEEDBACK_NOTIFY_FROM', 'noreply@eks.no')
    monkeypatch.setenv('SMTP_HOST', 'mail-eu.smtp2go.com')
    monkeypatch.setenv('SMTP_USER', 'smtpbruker')
    monkeypatch.setenv('SMTP_PASS', 'hemmelig')
    monkeypatch.delenv('RESEND_API_KEY', raising=False)

    sent = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            sent['host'] = host; sent['port'] = port
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def starttls(self): sent['tls'] = True
        def login(self, u, p): sent['login'] = (u, p)
        def send_message(self, msg):
            sent['from'] = msg['From']; sent['to'] = msg['To']
            sent['reply_to'] = msg['Reply-To']; sent['subject'] = msg['Subject']

    import smtplib
    monkeypatch.setattr(smtplib, 'SMTP', FakeSMTP)

    ok = email_notify.send_feedback_notification(
        'AO-SMTP1', 'ønske', 'Test SMTP', email='melder@eks.no')
    assert ok is True
    assert sent['host'] == 'mail-eu.smtp2go.com' and sent['port'] == 2525
    assert sent['tls'] is True
    assert sent['reply_to'] == 'melder@eks.no'
    assert 'AO-SMTP1' in sent['subject']


def test_email_notify_resend_payload(monkeypatch):
    from src import email_notify
    monkeypatch.setenv('FEEDBACK_NOTIFY_TO', 'eier@eks.no')
    monkeypatch.setenv('FEEDBACK_NOTIFY_FROM', 'noreply@eks.no')
    monkeypatch.setenv('RESEND_API_KEY', 'test-key')
    monkeypatch.delenv('SMTP2GO_API_KEY', raising=False)

    captured = {}

    class FakeResp:
        def raise_for_status(self): pass

    def fake_post(url, headers=None, json=None, timeout=None):
        captured['url'] = url
        captured['json'] = json
        captured['headers'] = headers
        return FakeResp()

    import httpx
    monkeypatch.setattr(httpx, 'post', fake_post)

    ok = email_notify.send_feedback_notification(
        'AO-ABC12', 'feil', 'Noe er galt', email='melder@eks.no', app_version='v1.39.0')
    assert ok is True
    assert 'resend.com' in captured['url']
    assert captured['json']['to'] == ['eier@eks.no']
    assert captured['json']['reply_to'] == 'melder@eks.no'  # svar går til melder
    assert 'AO-ABC12' in captured['json']['subject']


def test_email_notify_failure_is_swallowed(monkeypatch):
    from src import email_notify
    monkeypatch.setenv('FEEDBACK_NOTIFY_TO', 'eier@eks.no')
    monkeypatch.setenv('RESEND_API_KEY', 'test-key')

    import httpx
    def boom(*a, **k):
        raise RuntimeError('nettverksfeil')
    monkeypatch.setattr(httpx, 'post', boom)

    # Skal svelge feilen og returnere False
    assert email_notify.send_feedback_notification('AO-XYZ99', 'annet', 'test') is False


def test_admin_side_ligger_bak_hemmelig_sti(monkeypatch):
    monkeypatch.setenv('ADMIN_STI', 'hemmelig')
    port = 38072
    srv = start_server(port)
    time.sleep(0.05)
    try:
        # Den gamle nøkkel-adressen er fjernet. Ukjente stier faller gjennom til
        # appen, så det som betyr noe er at ingen admin-data serveres.
        assert 'Tilbakemeldinger' not in requests.get(
            f'http://127.0.0.1:{port}/feedback').text
        assert 'Tilbakemeldinger' not in requests.get(
            f'http://127.0.0.1:{port}/feedback?key=hemmelig').text

        # Feil hemmelighet skal ikke røpe at det finnes noe der
        r = requests.get(f'http://127.0.0.1:{port}/s/feil/tilbakemeldinger')
        assert r.status_code == 404
        assert 'Tilbakemeldinger' not in r.text

        r2 = requests.get(f'http://127.0.0.1:{port}/s/hemmelig/tilbakemeldinger')
        assert 'Tilbakemeldinger' in r2.text
        # Hemmeligheten må følge med i lenkene, ellers faller man ut ved første klikk
        assert '?s=hemmelig' in r2.text
    finally:
        srv.shutdown()


def test_kvoten_kan_ikke_omgas_med_egen_x_forwarded_for(monkeypatch):
    """Første ledd i X-Forwarded-For skriver klienten selv. Var det det som ble
    brukt, fikk hver forespørsel med ny verdi en ny kvote — og en ny e-post."""
    import server
    monkeypatch.setattr(server, '_feedback_hits', {})
    port = 38073
    srv = start_server(port)
    time.sleep(0.05)
    try:
        koder = []
        for i in range(server.FEEDBACK_MAX_PER_WINDOW + 2):
            r = requests.post(
                f'http://127.0.0.1:{port}/api/feedback',
                json={'message': f'spam {i}'},
                headers={'X-Forwarded-For': f'10.0.0.{i}, 203.0.113.7'},
            )
            koder.append(r.status_code)
        assert koder[-1] == 429
        assert koder.count(200) == server.FEEDBACK_MAX_PER_WINDOW
    finally:
        srv.shutdown()


def test_client_ip_foretrekker_cloudflare_og_siste_proxyledd():
    from server import Handler

    class H(Handler):
        def __init__(self, headers):
            self.headers = headers
            self.client_address = ('127.0.0.1', 0)

    assert H({'CF-Connecting-IP': '198.51.100.4', 'X-Forwarded-For': '1.1.1.1'})._client_ip() == '198.51.100.4'
    assert H({'X-Forwarded-For': 'forfalsket, 203.0.113.7'})._client_ip() == '203.0.113.7'
    assert H({'X-Forwarded-For': '203.0.113.7'})._client_ip() == '203.0.113.7'
    assert H({})._client_ip() == '127.0.0.1'


def test_for_stor_body_avvises_for_den_leses():
    """Uten tak leste serveren hele Content-Length inn i minnet."""
    import socket
    port = 38074
    srv = start_server(port)
    time.sleep(0.05)
    try:
        r = requests.post(f'http://127.0.0.1:{port}/api/feedback',
                          json={'message': 'x' * (2 * 1024 * 1024)})
        assert r.status_code == 413
        assert r.json()['ok'] is False

        # Oppgitt lengde alene skal avgjøre: serveren svarer uten å vente på bodyen
        with socket.create_connection(('127.0.0.1', port), timeout=5) as sock:
            sock.sendall(b'POST /api/feedback HTTP/1.1\r\nHost: x\r\n'
                         b'Content-Type: application/json\r\nContent-Length: 999999999\r\n\r\n')
            assert b' 413 ' in sock.recv(4096).split(b'\r\n')[0]

        with socket.create_connection(('127.0.0.1', port), timeout=5) as sock:
            sock.sendall(b'POST /api/feedback HTTP/1.1\r\nHost: x\r\nContent-Length: -1\r\n\r\n')
            assert b' 413 ' in sock.recv(4096).split(b'\r\n')[0]

        # Et vanlig kall går som før
        r = requests.post(f'http://127.0.0.1:{port}/api/feedback',
                          json={'message': 'vanlig melding'},
                          headers={'CF-Connecting-IP': '192.0.2.50'})
        assert r.status_code == 200
    finally:
        srv.shutdown()


def test_admin_side_har_kjorbar_hemmelighet_i_script():
    """Statusnedtrekket på admin-siden var dødt: `html.escape` gjorde fnuttene
    rundt HEMMELIGHET om til `&#x27;`, og inne i et `<script>` dekodes ikke
    tegnreferanser. JS-parseren fikk en SyntaxError, `setStatus` ble aldri
    definert, og hvert statusvalg gjorde ingenting (kun en konsollfeil).
    Funnet i gjennomgangen 09.11.2026."""
    from src.html_templates import generate_feedback_admin_page

    html = generate_feedback_admin_page([], {}, 'abc123XYZ', '')
    linje = next(l.strip() for l in html.splitlines() if 'const HEMMELIGHET' in l)

    assert linje == 'const HEMMELIGHET = "abc123XYZ";'
    assert '&#x27;' not in linje and '&quot;' not in linje

    # ...og en verdi kan ikke lukke script-elementet
    farlig = generate_feedback_admin_page([], {}, '</script><img src=x>', '')
    assert '</script><img' not in farlig
