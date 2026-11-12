from http.server import ThreadingHTTPServer
import threading
from unittest.mock import Mock

import pytest
import requests

import server
from src import arbeidsliste_auth
from src.arbeidsliste_store import ArbeidslisteLager


STI = '/api/arbeidsliste-overforing'
LISTE = {'schemaVersion': 1, 'observations': [{'species': {'taxonName': 'Tjeld'}, 'count': 2}]}


@pytest.fixture
def api(tmp_path, monkeypatch):
    lager = ArbeidslisteLager(tmp_path / 'stats.db')
    lager.init_db()
    monkeypatch.setattr(server, '_arbeidsliste_lager', lager)
    monkeypatch.setattr(server, '_arbeidsliste_aktiv', True)
    for treff in (server._ao_login_hits, server._arbeidsliste_ip_hits, server._arbeidsliste_skrive_hits):
        treff.clear()
    login = Mock(side_effect=lambda bruker, *args, **kwargs: {
        'authCookie': f'mock:{bruker}', 'loginToken': 'mock-token', 'userId': 'ustabilt-prefiks',
    })
    profil = Mock(side_effect=lambda cookie: ('ao:1', 'A') if cookie == 'mock:A' else ('ao:2', 'B'))
    monkeypatch.setattr(server, 'login_to_ao', login)
    monkeypatch.setattr(server, 'hent_ao_konto', profil)
    with ThreadingHTTPServer(('127.0.0.1', 0), server.Handler) as tjeneste:
        tråd = threading.Thread(target=tjeneste.serve_forever, daemon=True)
        tråd.start()
        try:
            yield f'http://127.0.0.1:{tjeneste.server_port}{STI}', lager, login, profil
        finally:
            tjeneste.shutdown()
            tråd.join()


def logg_inn(url, navn):
    svar = requests.post(url + '/innlogging', json={'username': navn, 'password': 'testpassord'}, timeout=5)
    assert svar.ok
    assert svar.headers['Cache-Control'] == 'no-store'
    assert 'Access-Control-Allow-Origin' not in svar.headers
    sesjon = svar.json()['sesjon']
    return {'Authorization': f"Bearer {sesjon['token']}"}, sesjon


def test_to_enheter_og_separat_konto(api):
    url, _, login, profil = api
    mobil, sesjon = logg_inn(url, 'A')
    mac, samme = logg_inn(url, 'A')
    annen, _ = logg_inn(url, 'B')
    assert sesjon['eier'] == samme['eier']
    assert sesjon['token'] != samme['token']
    assert login.call_count == profil.call_count == 3
    assert login.call_args.kwargs == {'bind_token': False, 'diskret': True}

    lagring = {'liste': LISTE, 'kilde': 'Mobil', 'forsok': '1234567890123456', 'erstatter': None}
    svar = requests.post(url, headers=mobil, json=lagring, timeout=5)
    assert svar.ok
    kopi = svar.json()['kopi']
    assert requests.get(url, headers=mac, timeout=5).json() == {'kopi': kopi}
    hent = {'X-Arbeidsliste-Kopi': kopi['id']}
    svar = requests.get(url + '/innhold', headers={**mac, **hent}, timeout=5)
    assert svar.json() == {'kopi': kopi, 'liste': LISTE}
    assert svar.headers['Cache-Control'] == 'no-store'
    assert 'Access-Control-Allow-Origin' not in svar.headers

    feil_eier = {**annen, **hent, 'X-AO-User-Id': '1', 'X-AO-Username': 'A'}
    assert requests.get(url, headers=feil_eier, timeout=5).json() == {'kopi': None}
    assert requests.get(url + '/innhold', headers=feil_eier, timeout=5).status_code == 404
    assert requests.post(url + '/slett', headers=feil_eier, json={'id': kopi['id']}, timeout=5).status_code == 409
    assert requests.post(url + '/slett', headers=mac, json={'id': kopi['id']}, timeout=5).ok
    assert requests.get(url + '/innhold', headers={**mobil, **hent}, timeout=5).status_code == 404
    assert login.call_count == profil.call_count == 3


def test_sesjon_kan_trekkes_tilbake_og_utloper(api):
    url, lager, *_ = api
    mobil, sesjon = logg_inn(url, 'A')
    assert requests.post(url + '/logg-ut', headers=mobil, timeout=5).ok
    assert requests.get(url, headers=mobil, timeout=5).status_code == 401
    mobil, ny_sesjon = logg_inn(url, 'A')
    with lager._tilkobling() as conn:
        rader = conn.execute('SELECT token_hash FROM arbeidsliste_sesjoner').fetchall()
        assert len(rader) == 1
        assert rader[0]['token_hash'] not in (sesjon['token'], ny_sesjon['token'])
        conn.execute('UPDATE arbeidsliste_sesjoner SET utloper_ts = 0')
    assert requests.get(url, headers=mobil, timeout=5).status_code == 401


def test_ao_innlogging_kan_ikke_oppta_kapasiteten_for_lokal_henting(api):
    url, _, _, _ = api
    mobil, _ = logg_inn(url, 'A')
    kapasitet = server._arbeidsliste_innlogginger
    with kapasitet, kapasitet:
        svar = requests.post(url + '/innlogging', json={'username': 'A', 'password': 'testpassord'}, timeout=5)
        assert svar.status_code == 503
        assert requests.get(url, headers=mobil, timeout=5).json() == {'kopi': None}


def test_kryssopprinnelse_og_bodygrense(api, monkeypatch, caplog):
    url, _, login, _ = api
    fremmed = {'Origin': 'https://annen.example'}
    assert requests.options(url, headers=fremmed, timeout=5).status_code == 405
    assert requests.get(url, headers=fremmed, timeout=5).status_code == 403
    assert requests.post(url + '/innlogging', headers=fremmed, json={}, timeout=5).status_code == 403
    login.assert_not_called()
    assert requests.get(url + '?privat-testverdi', timeout=5).status_code == 401
    assert 'privat-testverdi' not in caplog.text

    mobil, _ = logg_inn(url, 'A')
    monkeypatch.setitem(server._MAX_BODY_PER_PATH, STI, 64)
    svar = requests.post(url, headers=mobil, json={'data': 'a' * 80}, timeout=5)
    assert svar.status_code == 413
    assert svar.headers['Cache-Control'] == 'no-store'
    assert 'Access-Control-Allow-Origin' not in svar.headers


def test_brukerbeskjed_ved_ao_feil_og_lagerfeil(api, monkeypatch):
    url, lager, _, profil = api
    profil.side_effect = None
    profil.return_value = None
    svar = requests.post(url + '/innlogging', json={'username': 'A', 'password': 'testpassord'}, timeout=5)
    assert svar.status_code == 200
    assert 'sesjon' not in svar.json()
    profil.return_value = ('ao:1', 'A')
    mobil, _ = logg_inn(url, 'A')
    monkeypatch.setattr(lager, 'db_path', lager.db_path.parent / 'mangler' / 'stats.db')
    svar = requests.get(url, headers=mobil, timeout=5)
    assert svar.status_code == 503
    assert str(lager.db_path) not in svar.text


def test_publisering_krever_innhentet_listes_ao_konto(api):
    url, _, login, profil = api
    ao_login = url.removesuffix(STI) + '/api/ao-login'
    valg = {'username': 'B', 'password': 'testpassord', 'arbeidslisteEier': 'ao:1'}
    assert requests.post(ao_login, json=valg, timeout=5).status_code == 403
    valg['username'] = 'A'
    assert requests.post(ao_login, json=valg, timeout=5).json()['success']
    assert login.call_count == profil.call_count == 2


def test_verifisert_profil_leser_konto_fra_skjema(monkeypatch):
    profil_html = ('<ul id="usernavigation" data-useralias="testprofil"></ul>'
                   '<input name="EditUser.User.Id" type="hidden" value="71">')
    svar = Mock(status_code=200, text=profil_html)
    get = Mock(return_value=svar)
    monkeypatch.setattr(arbeidsliste_auth.httpx, 'get', get)
    assert arbeidsliste_auth.hent_ao_konto('mocket-sesjon') == ('ao:71', 'testprofil')
    assert get.call_args.kwargs['cookies']['.ASPXAUTHNO'] == 'mocket-sesjon'
    svar.text = profil_html + '<input name="EditUser.User.Id" type="hidden" value="99">'
    assert arbeidsliste_auth.hent_ao_konto('mocket-sesjon') is None
    svar.status_code = 302
    assert arbeidsliste_auth.hent_ao_konto('mocket-sesjon') is None
