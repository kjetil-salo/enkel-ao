"""
Tester for å legge bilde på et funn som allerede er PUBLISERT hos AO.

Egen flyt fra bildene som følger med selve sendingen: der må opplastingen skje mens
funnet ligger i gjennomgangskøen, her skjer den timer senere, hjemmefra, mot et funn
som for lengst er publisert.

Det viktigste disse testene vokter er at vi ikke melder suksess uten dekning — AOs
opplastingsrespons er ikke til å stole på alene (se `upload_image`), så bildelista
hos AO er fasiten.
"""

import base64
import os
import sys
import threading
from http.server import HTTPServer
from unittest.mock import Mock

import pytest
import requests

REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, REPO_ROOT)

from src.ao_import_httpx import (
    MAX_IMAGES_PER_SIGHTING,
    _fetch_sighting_csrf,
    _feilutdrag,
    upload_image,
    sighting_images,
    upload_photo_to_published_sighting,
)
from server import Handler

SVART_JPEG = 'data:image/jpeg;base64,' + base64.b64encode(b'\xff\xd8\xff\xdb-testbilde').decode()


def start_server(port):
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def _ao_svar(status, tekst):
    r = Mock()
    r.status_code = status
    r.text = tekst
    r.json = Mock(return_value={'id': 99} if status < 400 else {})
    return r


def _bilde(bilde_id):
    return {'id': bilde_id, 'sightingid': 42022330, 'fileurl': f'/MediaLibrary/{bilde_id}.jpg'}


def _patch_kjeden(monkeypatch, for_opplasting, etter_opplasting, opplasting=None):
    """
    Erstatt AO-kallene flyten gjør: bildeliste før, selve opplastingen, og bildeliste
    etter. Den siste kan spørres flere ganger (verifiseringen prøver på nytt), så alt
    etter første kall svarer med `etter_opplasting`.

    Sendes `etter_opplasting` som en liste av lister, brukes de i rekkefølge — da kan
    en test beskrive at AO bruker et øyeblikk på å vise bildet.
    """
    if etter_opplasting is not None and etter_opplasting and isinstance(etter_opplasting[0], list):
        etterpa = list(etter_opplasting)
    else:
        etterpa = [etter_opplasting]

    kall = {'n': 0}

    def fake_images(*a, **kw):
        i = kall['n']
        kall['n'] += 1
        if i == 0:
            return for_opplasting
        return etterpa[min(i - 1, len(etterpa) - 1)]

    monkeypatch.setattr('src.ao_import_httpx.sighting_images', fake_images)
    monkeypatch.setattr('src.ao_import_httpx._fetch_sighting_csrf',
                        lambda *a, **kw: ('FORMTOK', 'COOKIETOK'))
    monkeypatch.setattr('src.ao_import_httpx.upload_image',
                        opplasting or (lambda *a, **kw: {'id': 3687666}))
    monkeypatch.setattr('src.ao_import_httpx.time.sleep', lambda s: None)


# ============================================================================
# Normal vei
# ============================================================================

def test_legger_bilde_pa_publisert_funn(monkeypatch):
    _patch_kjeden(monkeypatch, [], [_bilde(3687666)])

    res = upload_photo_to_published_sighting(42022330, SVART_JPEG, 'LOGIN', 'AUTH')

    assert res['ok'] is True
    assert res['verified'] is True
    assert res['imageId'] == 3687666
    assert res['imageCount'] == 1


def test_bruker_csrf_fra_funnsiden_ikke_gjennomgangskoen(monkeypatch):
    """
    Tokenet må hentes der skjemaet faktisk står. En bruker uten ventende funn har en
    tom gjennomgangskø, og å lete etter opplastingsskjemaet der ville feilet.
    """
    brukt = {}
    monkeypatch.setattr('src.ao_import_httpx.sighting_images', lambda *a, **kw: [])
    monkeypatch.setattr('src.ao_import_httpx._fetch_sighting_csrf',
                        lambda sid, lt, ac: brukt.setdefault('sightingId', sid) and None or ('F', 'C'))
    monkeypatch.setattr('src.ao_import_httpx.upload_image', lambda *a, **kw: {'id': 1})

    upload_photo_to_published_sighting(42022330, SVART_JPEG, 'LOGIN', 'AUTH')

    assert brukt['sightingId'] == 42022330


def test_fetch_sighting_csrf_treffer_funnsiden(monkeypatch):
    respons = Mock()
    respons.text = '<form id="uploadForm"><input name="__RequestVerificationToken" value="FORMTOK"/></form>'
    respons.status_code = 200
    respons.raise_for_status = Mock()
    respons.cookies = {'__RequestVerificationToken': 'COOKIETOK'}

    client = Mock()
    client.__enter__ = Mock(return_value=client)
    client.__exit__ = Mock(return_value=None)
    client.get = Mock(return_value=respons)
    monkeypatch.setattr('httpx.Client', lambda **kw: client)

    assert _fetch_sighting_csrf(42022330, 'LOGIN', 'AUTH') == ('FORMTOK', 'COOKIETOK')
    assert client.get.call_args.args[0].endswith('/Sighting/42022330')


def test_ugyldig_lisens_faller_tilbake_til_ao_sin_default(monkeypatch):
    brukt = {}

    def fake_upload(sid, b, fn, lt, ac, lisens='10', csrf=None):
        brukt['lisens'] = lisens
        return {'id': 7}

    _patch_kjeden(monkeypatch, [], [_bilde(7)], opplasting=fake_upload)

    upload_photo_to_published_sighting(42022330, SVART_JPEG, 'L', 'A', media_license='999')

    assert brukt['lisens'] == '10'


def test_gyldig_lisens_sendes_videre(monkeypatch):
    brukt = {}

    def fake_upload(sid, b, fn, lt, ac, lisens='10', csrf=None):
        brukt['lisens'] = lisens
        return {'id': 7}

    _patch_kjeden(monkeypatch, [], [_bilde(7)], opplasting=fake_upload)

    upload_photo_to_published_sighting(42022330, SVART_JPEG, 'L', 'A', media_license='60')

    assert brukt['lisens'] == '60'


# ============================================================================
# Det som skal gå galt, skal gå galt tydelig
# ============================================================================

def test_melder_ikke_suksess_nar_ao_ikke_tok_imot(monkeypatch):
    """
    Opplastingsresponsen kan være tom eller HTML selv når AO avviste bildet. Fasiten
    er bildelista: uendret antall betyr at bildet ikke kom fram.
    """
    _patch_kjeden(monkeypatch, [_bilde(1)], [_bilde(1)], opplasting=lambda *a, **kw: {})

    res = upload_photo_to_published_sighting(42022330, SVART_JPEG, 'L', 'A')

    assert res['ok'] is False
    assert 'tok ikke imot' in res['error']


def test_stopper_pa_aos_bildegrense(monkeypatch):
    fulle = [_bilde(i) for i in range(MAX_IMAGES_PER_SIGHTING)]
    monkeypatch.setattr('src.ao_import_httpx.sighting_images', lambda *a, **kw: fulle)
    monkeypatch.setattr('src.ao_import_httpx.upload_image',
                        lambda *a, **kw: pytest.fail('Skal ikke forsøke opplasting når funnet er fullt'))

    res = upload_photo_to_published_sighting(42022330, SVART_JPEG, 'L', 'A')

    assert res['ok'] is False
    assert str(MAX_IMAGES_PER_SIGHTING) in res['error']


def test_opplasting_som_kaster_blir_pen_feilmelding(monkeypatch):
    def eksploder(*a, **kw):
        raise ValueError('Bildeopplasting feilet: HTTP 500')

    _patch_kjeden(monkeypatch, [], [], opplasting=eksploder)

    res = upload_photo_to_published_sighting(42022330, SVART_JPEG, 'L', 'A')

    assert res['ok'] is False
    assert 'HTTP 500' in res['error']


def test_prover_en_gang_til_nar_ao_svarer_500(monkeypatch):
    """
    AO har svart HTTP 500 på en opplasting som er helt lik en som nettopp lyktes mot
    samme funn (observert i felt 25.10.2026). Ett nytt forsøk er billig, og sparer
    brukeren for å måtte velge bildet på nytt.
    """
    svar = [_ao_svar(500, '<html><title>Runtime Error</title></html>'),
            _ao_svar(200, '{"id": 99}')]
    kall = {'n': 0}

    def fake_post(*a, **kw):
        r = svar[min(kall['n'], len(svar) - 1)]
        kall['n'] += 1
        return r

    client = Mock()
    client.__enter__ = Mock(return_value=client)
    client.__exit__ = Mock(return_value=None)
    client.post = Mock(side_effect=fake_post)
    monkeypatch.setattr('httpx.Client', lambda **kw: client)
    monkeypatch.setattr('src.ao_import_httpx.time.sleep', lambda s: None)

    res = upload_image(42022330, b'ABC', 'bilde.jpg', 'L', 'A', csrf=('F', 'C'))

    assert res == {'id': 99}
    assert kall['n'] == 2


def test_gir_opp_og_tar_med_aos_egen_tekst(monkeypatch, caplog):
    """Vedvarende feil skal fortsatt feile — men AOs egen tekst skal havne i loggen."""
    client = Mock()
    client.__enter__ = Mock(return_value=client)
    client.__exit__ = Mock(return_value=None)
    client.post = Mock(return_value=_ao_svar(500, '<html><title>Runtime Error</title></html>'))
    monkeypatch.setattr('httpx.Client', lambda **kw: client)
    monkeypatch.setattr('src.ao_import_httpx.time.sleep', lambda s: None)

    with caplog.at_level('WARNING'):
        with pytest.raises(ValueError, match='HTTP 500'):
            upload_image(42022330, b'ABC', 'bilde.jpg', 'L', 'A', csrf=('F', 'C'))

    assert 'Runtime Error' in caplog.text


def test_feilutdrag_plukker_ut_noe_lesbart():
    assert _feilutdrag('<html><title>Runtime Error</title><body>x</body></html>') == 'Runtime Error'
    assert 'noe gikk galt' in _feilutdrag('<div><p>noe gikk galt</p></div>')
    assert _feilutdrag('') == ''


def test_ugyldig_bildedata(monkeypatch):
    monkeypatch.setattr('src.ao_import_httpx.sighting_images',
                        lambda *a, **kw: pytest.fail('Skal avvise før AO kontaktes'))

    assert upload_photo_to_published_sighting(1, 'ikke-en-data-url', 'L', 'A')['ok'] is False


def test_ugyldig_funn_id(monkeypatch):
    monkeypatch.setattr('src.ao_import_httpx.sighting_images',
                        lambda *a, **kw: pytest.fail('Skal avvise før AO kontaktes'))

    assert upload_photo_to_published_sighting('tull', SVART_JPEG, 'L', 'A')['ok'] is False


def test_ukjent_bildeliste_stopper_ikke_opplastingen(monkeypatch):
    """
    Svarer AO ikke på bildelista (None = «vet ikke»), skal vi fortsatt forsøke.
    Å nekte ville gjort en forbigående AO-feil til en blokkering.
    """
    _patch_kjeden(monkeypatch, None, None)

    res = upload_photo_to_published_sighting(42022330, SVART_JPEG, 'L', 'A')

    assert res['ok'] is True
    assert res['imageCount'] is None


def test_uten_telling_for_opplasting_meldes_som_ubekreftet(monkeypatch):
    """
    Feilet tellingen FØR opplastingen, finnes det ingenting å sammenligne mot etterpå.
    Da skal svaret si at det er ubekreftet — og ikke gjette på en ID fra et bilde som
    lå der fra før. Et «ok» uten dekning er nøyaktig løgnen verifiseringen finnes for.
    """
    _patch_kjeden(monkeypatch, None, [_bilde(111)], opplasting=lambda *a, **kw: {})

    res = upload_photo_to_published_sighting(42022330, SVART_JPEG, 'L', 'A')

    assert res['ok'] is True
    assert res['verified'] is False
    assert res['imageId'] is None


def test_venter_litt_nar_ao_bruker_tid_pa_a_vise_bildet(monkeypatch):
    """
    AO kan bruke et øyeblikk på å gjøre bildet synlig i lista. Konkluderte vi med
    «ikke mottatt» på første forsøk, ville brukeren lastet opp på nytt — og da ligger
    det to like bilder på funnet.
    """
    _patch_kjeden(monkeypatch, [_bilde(1)],
                  [[_bilde(1)], [_bilde(1)], [_bilde(1), _bilde(2)]])

    res = upload_photo_to_published_sighting(42022330, SVART_JPEG, 'L', 'A')

    assert res['ok'] is True
    assert res['verified'] is True
    assert res['imageCount'] == 2


def test_sighting_images_degraderer_til_none(monkeypatch):
    def eksploder(**kw):
        raise RuntimeError('nettverket forsvant')
    monkeypatch.setattr('httpx.Client', eksploder)

    assert sighting_images(42022330, 'L', 'A') is None


# ============================================================================
# Endepunktet
# ============================================================================

def test_endepunkt_krever_innlogging():
    port = 8773
    server = start_server(port)
    try:
        r = requests.post(f'http://localhost:{port}/api/ao-upload-image',
                          json={'sightingId': 1, 'photo': SVART_JPEG}, timeout=5)
        assert r.status_code == 200
        assert r.json()['ok'] is False
    finally:
        server.shutdown()


def test_endepunkt_avviser_for_stort_bilde():
    port = 8774
    server = start_server(port)
    try:
        r = requests.post(f'http://localhost:{port}/api/ao-upload-image',
                          json={'sightingId': 1, 'loginToken': 'L', 'authCookie': 'A',
                                'photo': 'data:image/jpeg;base64,' + 'A' * (13 * 1024 * 1024)},
                          timeout=20)
        assert r.status_code == 200
        assert r.json()['ok'] is False
        assert 'stort' in r.json()['error']
    finally:
        server.shutdown()


def test_endepunkt_svarer_200_ogsa_ved_uventet_feil(monkeypatch):
    monkeypatch.setattr('server.upload_photo_to_published_sighting',
                        lambda *a, **kw: (_ for _ in ()).throw(RuntimeError('AO nede')))
    port = 8775
    server = start_server(port)
    try:
        r = requests.post(f'http://localhost:{port}/api/ao-upload-image',
                          json={'sightingId': 1, 'loginToken': 'L', 'authCookie': 'A',
                                'photo': SVART_JPEG}, timeout=5)
        assert r.status_code == 200
        assert r.json()['ok'] is False
    finally:
        server.shutdown()
