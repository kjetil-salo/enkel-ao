"""
Tester for src/fellestur_peer.py — kryss-app-føderasjon for Fellestur.

Dekker: secret-håndtering, provider-config, oversettelse begge veier,
innkommende batch-validering/anvendelse (inkl. idempotens og count-delta),
og utgående fan-out med retry. Se docs/ANALYSIS_FELLESTUR_FODERASJON.md for
kontrakten dette skal etterleve (Appendix A i det opprinnelige
Feltlogg-dokumentet).
"""
import json
import time
from unittest.mock import patch, MagicMock

import pytest

from src import fellestur_store
from src import fellestur_peer


@pytest.fixture(autouse=True)
def temp_state(tmp_path, monkeypatch):
    """Egen database, secret-fil og providers-fil per test."""
    db = tmp_path / 'stats.db'
    monkeypatch.setattr(fellestur_store, 'DB_PATH', str(db))
    monkeypatch.setattr(fellestur_peer, 'DB_PATH', str(db))
    fellestur_store.init_db()
    fellestur_peer.init_db()

    monkeypatch.setattr(fellestur_peer, 'SECRET_PATH', str(tmp_path / 'secret.txt'))
    monkeypatch.setattr(fellestur_peer, 'PROVIDERS_PATH', str(tmp_path / 'providers.json'))
    yield


def _sighting(**kwargs):
    base = {
        'id': 'peer-sighting-1',
        'location': 'Jærens rev',
        'locationId': '',
        'date': '2026-09-11',
        'timeFrom': '10:30',
        'timeTo': '10:30',
        'species': 'Tundrasnipe',
        'count': 3,
        'activity': 'Rastende',
        'age': '1K',
        'gender': '',
        'comments': '',
        'hideUntil': '',
        'notObservedSelf': False,
        'locked': False,
    }
    base.update(kwargs)
    return base


def _event(event_id='e_abcdefgh', etype='add', sighting=None, kode='12345', delta=None):
    ev = {
        'id': event_id,
        'code': kode,
        'type': etype,
        'origin': 'feltlogg:dev-a81f',
        'sighting': sighting if sighting is not None else _sighting(),
    }
    if delta is not None:
        ev['delta'] = delta
    return ev


# ---------------------------------------------------------------------------
# Secret og providers
# ---------------------------------------------------------------------------

def test_own_secret_genereres_og_er_stabil():
    s1 = fellestur_peer.get_own_secret()
    s2 = fellestur_peer.get_own_secret()
    assert s1 and len(s1) >= 32
    assert s1 == s2


def test_verify_inbound_token():
    secret = fellestur_peer.get_own_secret()
    assert fellestur_peer.verify_inbound_token(f'Bearer {secret}') is True
    assert fellestur_peer.verify_inbound_token('Bearer feil-token') is False
    assert fellestur_peer.verify_inbound_token('') is False
    assert fellestur_peer.verify_inbound_token(None) is False
    assert fellestur_peer.verify_inbound_token(secret) is False  # mangler "Bearer "-prefiks


def test_load_providers_uten_fil_gir_tom_liste():
    assert fellestur_peer.load_providers() == []


def test_load_providers_leser_gyldig_fil(tmp_path):
    fil = tmp_path / 'providers.json'
    fil.write_text(json.dumps([
        {'name': 'feltlogg', 'url': 'https://feltlogg.no/fl/api/group-session', 'secret': 'hemmelig'},
        {'name': 'ugyldig-uten-url'},
        'ikke en dict',
    ]))
    fellestur_peer.PROVIDERS_PATH = str(fil)
    providere = fellestur_peer.load_providers()
    assert len(providere) == 1
    assert providere[0]['name'] == 'feltlogg'


def test_load_providers_ugyldig_json_gir_tom_liste(tmp_path):
    fil = tmp_path / 'providers.json'
    fil.write_text('{ikke gyldig json')
    fellestur_peer.PROVIDERS_PATH = str(fil)
    assert fellestur_peer.load_providers() == []


def test_skal_forwardes_er_alltid_true_i_v1():
    assert fellestur_peer.skal_forwardes({'kode': '12345'}) is True
    assert fellestur_peer.skal_forwardes({}) is True


# ---------------------------------------------------------------------------
# Oversettelse begge veier
# ---------------------------------------------------------------------------

def test_obs_to_sighting_oversetter_felt():
    obs = {
        'species': {'taxonName': 'Tundrasnipe'},
        'count': 3,
        'activity': 'Rastende',
        'placeName': 'Jærens rev',
        'placeId': 12345,
        'timestamp': '2026-09-11T10:30:00',
        'tilKlokkeslett': '2026-09-11T10:41:00',
        'age': '1K',
        'gender': '',
        'comment': 'Sammen med myrsnipe',
        'visitLocked': True,
    }
    sighting = fellestur_peer.obs_to_sighting('obs-1', obs)
    assert sighting['id'] == 'obs-1'
    assert sighting['location'] == 'Jærens rev'
    assert sighting['locationId'] == '12345'
    assert sighting['date'] == '2026-09-11'
    assert sighting['timeFrom'] == '10:30'
    assert sighting['timeTo'] == '10:41'
    assert sighting['species'] == 'Tundrasnipe'
    assert sighting['count'] == 3
    assert sighting['comments'] == 'Sammen med myrsnipe'
    assert sighting['locked'] is True
    assert sighting['hideUntil'] == ''
    assert sighting['notObservedSelf'] is False


def test_sighting_to_obs_oversetter_felt():
    obs = fellestur_peer.sighting_to_obs(_sighting())
    assert obs['species']['taxonName'] == 'Tundrasnipe'
    assert obs['placeName'] == 'Jærens rev'
    assert obs['count'] == 3
    assert obs['timestamp'] == '2026-09-11T10:30:00'
    assert obs['tilKlokkeslett'] == '2026-09-11T10:30:00'
    assert obs['coObservers'] == []


# ---------------------------------------------------------------------------
# Innkommende batch — validering
# ---------------------------------------------------------------------------

def test_ugyldig_kode_gir_400():
    body, status = fellestur_peer.apply_peer_batch('ikke-fem-siffer', [_event(kode='ikke-fem-siffer')])
    assert status == 400


def test_tom_events_liste_gir_400():
    tur = fellestur_store.create_fellestur()
    body, status = fellestur_peer.apply_peer_batch(tur['kode'], [])
    assert status == 400


def test_for_mange_events_gir_413():
    tur = fellestur_store.create_fellestur()
    events = [_event(event_id=f'e_{i:08d}', kode=tur['kode']) for i in range(51)]
    body, status = fellestur_peer.apply_peer_batch(tur['kode'], events)
    assert status == 413


def test_ukjent_kode_gir_404():
    body, status = fellestur_peer.apply_peer_batch('99999', [_event(kode='99999')])
    assert status == 404


def test_manglende_artsnavn_gir_400_og_lagrer_ingenting():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    ugyldig = _event(kode=kode, sighting=_sighting(species=''))
    body, status = fellestur_peer.apply_peer_batch(kode, [ugyldig])
    assert status == 400
    assert fellestur_store.get_fellestur(kode)['observasjoner'] == []


def test_manglende_dato_gir_400():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    ugyldig = _event(kode=kode, sighting=_sighting(date='ikke-en-dato'))
    body, status = fellestur_peer.apply_peer_batch(kode, [ugyldig])
    assert status == 400


def test_code_mismatch_gir_400():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    ev = _event(kode=kode)
    ev['code'] = '00000'  # matcher ikke URL-koden
    body, status = fellestur_peer.apply_peer_batch(kode, [ev])
    assert status == 400


def test_en_ugyldig_event_forkaster_hele_batchen():
    """Én ugyldig rad → 400 for HELE batchen, ingenting lagres — selv ikke de gyldige radene."""
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    gyldig = _event(event_id='e_gyldig01', kode=kode, sighting=_sighting(id='s-1'))
    ugyldig = _event(event_id='e_ugyldig1', kode=kode, sighting=_sighting(id='s-2', count=0))
    body, status = fellestur_peer.apply_peer_batch(kode, [gyldig, ugyldig])
    assert status == 400
    assert fellestur_store.get_fellestur(kode)['observasjoner'] == []


# ---------------------------------------------------------------------------
# Innkommende batch — anvendelse
# ---------------------------------------------------------------------------

def test_add_event_lagrer_observasjon():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    ev = _event(kode=kode, sighting=_sighting(id='s-1'))
    body, status = fellestur_peer.apply_peer_batch(kode, [ev])
    assert status == 200
    assert body['accepted'] == [ev['id']]

    hentet = fellestur_store.get_fellestur(kode)
    assert len(hentet['observasjoner']) == 1
    assert hentet['observasjoner'][0]['species']['taxonName'] == 'Tundrasnipe'
    assert hentet['observasjoner'][0]['id'] == 's-1'


def test_duplikat_event_id_hoppes_over_men_er_ikke_en_feil():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    ev = _event(kode=kode, sighting=_sighting(id='s-1'))

    forste = fellestur_peer.apply_peer_batch(kode, [ev])
    assert forste[1] == 200
    assert forste[0]['accepted'] == [ev['id']]

    andre = fellestur_peer.apply_peer_batch(kode, [ev])
    assert andre[1] == 200
    assert andre[0]['accepted'] == []  # allerede sett — ikke en feil, bare ikke listet

    hentet = fellestur_store.get_fellestur(kode)
    assert len(hentet['observasjoner']) == 1  # ingen duplikat rad


def test_delete_event_fjerner_observasjon():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    fellestur_peer.apply_peer_batch(kode, [_event(event_id='e_add0001', kode=kode, sighting=_sighting(id='s-1'))])

    slett = _event(event_id='e_del0001', etype='delete', kode=kode, sighting={'id': 's-1'})
    body, status = fellestur_peer.apply_peer_batch(kode, [slett])
    assert status == 200
    assert fellestur_store.get_fellestur(kode)['observasjoner'] == []


def test_count_event_legger_til_delta():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    fellestur_peer.apply_peer_batch(
        kode, [_event(event_id='e_add0001', kode=kode, sighting=_sighting(id='s-1', count=3))]
    )

    ev = _event(event_id='e_cnt0001', etype='count', kode=kode,
                sighting={'id': 's-1', 'date': '2026-09-11', 'timeFrom': '10:41', 'timeTo': '10:41'},
                delta=2)
    body, status = fellestur_peer.apply_peer_batch(kode, [ev])
    assert status == 200

    hentet = fellestur_store.get_fellestur(kode)
    assert hentet['observasjoner'][0]['count'] == 5
    assert hentet['observasjoner'][0]['timestamp'] == '2026-09-11T10:41:00'


def test_count_delta_holder_seg_over_null():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    fellestur_peer.apply_peer_batch(
        kode, [_event(event_id='e_add0001', kode=kode, sighting=_sighting(id='s-1', count=1))]
    )
    ev = _event(event_id='e_cnt0001', etype='count', kode=kode, sighting={'id': 's-1'}, delta=-10)
    fellestur_peer.apply_peer_batch(kode, [ev])
    hentet = fellestur_store.get_fellestur(kode)
    assert hentet['observasjoner'][0]['count'] == 1  # aldri under 1


def test_count_event_pa_ukjent_id_er_stille_no_op():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    ev = _event(event_id='e_cnt0001', etype='count', kode=kode, sighting={'id': 'finnes-ikke'}, delta=1)
    body, status = fellestur_peer.apply_peer_batch(kode, [ev])
    assert status == 200
    assert body['accepted'] == [ev['id']]
    assert fellestur_store.get_fellestur(kode)['observasjoner'] == []


def test_ugyldig_delta_gir_400():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    ev = _event(etype='count', kode=kode, sighting={'id': 's-1'}, delta=0)
    body, status = fellestur_peer.apply_peer_batch(kode, [ev])
    assert status == 400


# ---------------------------------------------------------------------------
# Utgående — fan-out
# ---------------------------------------------------------------------------

def test_fan_out_uten_providers_gjor_ingenting():
    thread = fellestur_peer.fan_out('12345', [('add', 'obs-1', {})], {'kode': '12345'})
    assert thread is None


@patch('httpx.post')
def test_fan_out_sender_til_konfigurert_provider(mock_post, tmp_path):
    fellestur_peer.PROVIDERS_PATH = str(tmp_path / 'providers.json')
    (tmp_path / 'providers.json').write_text(json.dumps(
        [{'name': 'feltlogg', 'url': 'https://feltlogg.no/fl/api/group-session', 'secret': 'deres-hemmelighet'}]
    ))
    mock_post.return_value = MagicMock(status_code=200)

    obs = {'species': {'taxonName': 'Tundrasnipe'}, 'placeName': 'Jærens rev', 'count': 3}
    thread = fellestur_peer.fan_out('12345', [('add', 'obs-1', obs)], {'kode': '12345'}, registrert_av='Kari')
    assert thread is not None
    thread.join(timeout=5)

    assert mock_post.call_count == 1
    args, kwargs = mock_post.call_args
    assert args[0] == 'https://feltlogg.no/fl/api/group-session/12345/events'
    assert kwargs['headers']['Authorization'] == 'Bearer deres-hemmelighet'
    sendt_events = kwargs['json']['events']
    assert len(sendt_events) == 1
    assert sendt_events[0]['type'] == 'add'
    assert sendt_events[0]['sighting']['species'] == 'Tundrasnipe'


@patch('time.sleep', return_value=None)
@patch('httpx.post')
def test_fan_out_retryer_pa_5xx_og_gir_opp(mock_post, mock_sleep, tmp_path):
    fellestur_peer.PROVIDERS_PATH = str(tmp_path / 'providers.json')
    (tmp_path / 'providers.json').write_text(json.dumps(
        [{'name': 'feltlogg', 'url': 'https://feltlogg.no/api', 'secret': 's'}]
    ))
    mock_post.return_value = MagicMock(status_code=500)

    thread = fellestur_peer.fan_out('12345', [('delete', 'obs-1', None)], {'kode': '12345'})
    thread.join(timeout=5)

    assert mock_post.call_count == 1 + len(fellestur_peer.RETRY_BACKOFFS)  # 1 forsøk + retries
    assert mock_sleep.call_count == len(fellestur_peer.RETRY_BACKOFFS)


@patch('time.sleep', return_value=None)
@patch('httpx.post')
def test_fan_out_gir_ikke_retry_pa_404(mock_post, mock_sleep, tmp_path):
    fellestur_peer.PROVIDERS_PATH = str(tmp_path / 'providers.json')
    (tmp_path / 'providers.json').write_text(json.dumps(
        [{'name': 'feltlogg', 'url': 'https://feltlogg.no/api', 'secret': 's'}]
    ))
    mock_post.return_value = MagicMock(status_code=404)

    thread = fellestur_peer.fan_out('12345', [('delete', 'obs-1', None)], {'kode': '12345'})
    thread.join(timeout=5)

    assert mock_post.call_count == 1  # ingen retry på 404
    assert mock_sleep.call_count == 0
