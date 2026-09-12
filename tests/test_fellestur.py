"""
Tester for fellestur (src/fellestur_store.py) — delt kladdebok for en gruppe
på samme feltøkt. I motsetning til deling (test_share.py) er dette
multi-skriver: alle med koden kan legge til, rette tall på og slette.

v2: klienten sender endringer i batcher via apply_sync() (upserts + deletes,
identifisert med en klientgenerert obs_id/uuid) i stedet for per-rad-kall.
Datamodellen for en oppføring er fortsatt den samme som den lokale
arbeidslista bruker (species/count/activity/placeName/...) — se
sanitize_observasjon().
"""
import time

import pytest

from src import fellestur_store


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    """Egen database per test — fellestur skal aldri skrive i den ekte."""
    db = tmp_path / 'fellesturer.db'
    monkeypatch.setattr(fellestur_store, 'DB_PATH', str(db))
    fellestur_store.init_db()
    yield


def _obs(navn='Tjeld', **kwargs):
    base = {
        'species': {'taxonName': navn, 'taxonId': 12345, 'scientificNameHtml': 'Haematopus ostralegus'},
        'count': 3,
        'activity': 'Rastende',
        'placeName': 'Herdla fyr',
        'placeId': 99,
        'visitId': 'besok-1',
        'visitLocked': False,
        'age': 'Voksen',
        'gender': 'Hann',
        'comment': 'Fin dag',
        'coObservers': ['Kari', 'Ola'],
        'position': {'lat': 60.55, 'lon': 5.0},  # skal aldri lagres
    }
    base.update(kwargs)
    return base


def _upsert(obs_id, **kwargs):
    return {'id': obs_id, 'obs': _obs(**kwargs)}


def test_opprett_gir_kode_i_riktig_alfabet():
    tur = fellestur_store.create_fellestur(navn='Herdla 30/8')
    assert tur is not None
    assert len(tur['kode']) == fellestur_store._KODE_LENGTH
    assert all(c in fellestur_store._KODE_ALPHABET for c in tur['kode'])


def test_hent_ukjent_kode_gir_none():
    assert fellestur_store.get_fellestur('ABCDEF') is None
    assert fellestur_store.get_fellestur('') is None
    assert fellestur_store.get_fellestur('kort') is None


def test_opprettet_tur_kan_hentes_med_medobservatorer():
    tur = fellestur_store.create_fellestur(navn='Herdla', medobservatorer=['Kari', 'Ola'])
    hentet = fellestur_store.get_fellestur(tur['kode'])
    assert hentet['navn'] == 'Herdla'
    assert hentet['medobservatorer'] == ['Kari', 'Ola']
    assert hentet['observasjoner'] == []


def test_upsert_oppretter_ny_oppforing_med_full_datamodell():
    """Kjernekravet: samme observasjonsform som arbeidslista, ikke en egen forenklet form."""
    tur = fellestur_store.create_fellestur()
    resultat = fellestur_store.apply_sync(
        tur['kode'], upserts=[_upsert('uuid-1')], registrert_av='Kari',
    )
    assert resultat is not None
    assert len(resultat['observasjoner']) == 1

    lagret = resultat['observasjoner'][0]
    assert lagret['id'] == 'uuid-1'
    assert lagret['species']['taxonName'] == 'Tjeld'
    assert lagret['species']['taxonId'] == 12345
    assert lagret['species']['scientificNameHtml'] == 'Haematopus ostralegus'
    assert lagret['count'] == 3
    assert lagret['activity'] == 'Rastende'
    assert lagret['placeName'] == 'Herdla fyr'
    assert lagret['placeId'] == 99
    assert lagret['visitId'] == 'besok-1'
    assert lagret['visitLocked'] is False
    assert lagret['age'] == 'Voksen'
    assert lagret['gender'] == 'Hann'
    assert lagret['comment'] == 'Fin dag'
    assert lagret['coObservers'] == ['Kari', 'Ola']
    assert lagret['registrert_av'] == 'Kari'
    assert lagret['created_ts'] is not None
    assert lagret['updated_ts'] is not None


def test_koordinater_lagres_aldri():
    tur = fellestur_store.create_fellestur()
    resultat = fellestur_store.apply_sync(tur['kode'], upserts=[_upsert('uuid-1')])
    assert 'position' not in resultat['observasjoner'][0]

    hentet = fellestur_store.get_fellestur(tur['kode'])
    assert 'position' not in hentet['observasjoner'][0]


def test_ukjente_felt_forkastes():
    tur = fellestur_store.create_fellestur()
    resultat = fellestur_store.apply_sync(
        tur['kode'], upserts=[_upsert('uuid-1', hemmelig='lekkasje')],
    )
    assert 'hemmelig' not in resultat['observasjoner'][0]


def test_obs_uten_id_forkastes_men_resten_av_batchen_anvendes():
    tur = fellestur_store.create_fellestur()
    resultat = fellestur_store.apply_sync(
        tur['kode'],
        upserts=[
            {'id': '', 'obs': _obs()},  # tom id — ugyldig
            {'obs': _obs()},  # mangler id helt
            _upsert('uuid-gyldig'),
        ],
    )
    assert resultat is not None
    assert len(resultat['observasjoner']) == 1
    assert resultat['observasjoner'][0]['id'] == 'uuid-gyldig'


def test_obs_uten_artsnavn_hoppes_over():
    tur = fellestur_store.create_fellestur()
    resultat = fellestur_store.apply_sync(
        tur['kode'],
        upserts=[
            {'id': 'uuid-1', 'obs': {'species': {}}},
            {'id': 'uuid-2', 'obs': {}},
            {'id': 'uuid-3', 'obs': 'ikke en dict'},
        ],
    )
    assert resultat is not None
    assert resultat['observasjoner'] == []


def test_upsert_med_samme_id_oppdaterer_men_bevarer_registrert_av_og_created_ts():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']

    forste = fellestur_store.apply_sync(
        kode, upserts=[_upsert('uuid-1', count=3)], registrert_av='Kari',
    )
    original = forste['observasjoner'][0]
    assert original['count'] == 3
    assert original['registrert_av'] == 'Kari'

    time.sleep(0.01)
    andre = fellestur_store.apply_sync(
        kode, upserts=[_upsert('uuid-1', count=7)], registrert_av='Ola',
    )
    assert len(andre['observasjoner']) == 1
    oppdatert = andre['observasjoner'][0]

    # Siste skriving vinner på selve innholdet …
    assert oppdatert['count'] == 7
    # … men den opprinnelige innsenderen og opprettelsestidspunktet er urørt.
    assert oppdatert['registrert_av'] == 'Kari'
    assert oppdatert['created_ts'] == original['created_ts']
    assert oppdatert['updated_ts'] >= original['updated_ts']

    # Resten av observasjonen skal fortsatt være der, urørt av tall-endringen
    assert oppdatert['species']['taxonName'] == 'Tjeld'
    assert oppdatert['placeName'] == 'Herdla fyr'


def test_delete_fjerner_oppforing():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    fellestur_store.apply_sync(kode, upserts=[_upsert('uuid-1')])

    resultat = fellestur_store.apply_sync(kode, deletes=['uuid-1'])
    assert resultat is not None
    assert resultat['observasjoner'] == []


def test_delete_av_ukjent_id_er_en_stille_no_op():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    fellestur_store.apply_sync(kode, upserts=[_upsert('uuid-1')])

    resultat = fellestur_store.apply_sync(kode, deletes=['finnes-ikke'])
    assert resultat is not None
    assert len(resultat['observasjoner']) == 1


def test_upsert_og_delete_i_samme_batch():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    fellestur_store.apply_sync(kode, upserts=[_upsert('uuid-1'), _upsert('uuid-2', navn='Steinvender')])

    resultat = fellestur_store.apply_sync(
        kode,
        upserts=[_upsert('uuid-3', navn='Sandlo')],
        deletes=['uuid-1'],
    )
    arter = sorted(o['species']['taxonName'] for o in resultat['observasjoner'])
    assert arter == ['Sandlo', 'Steinvender']


def test_flere_kan_legge_til_oppforinger():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    fellestur_store.apply_sync(kode, upserts=[_upsert('uuid-1')], registrert_av='Kari')
    fellestur_store.apply_sync(kode, upserts=[_upsert('uuid-2', placeName='Andre siden')], registrert_av='Ola')

    hentet = fellestur_store.get_fellestur(kode)
    arter = [o['species']['taxonName'] for o in hentet['observasjoner']]
    assert arter == ['Tjeld', 'Tjeld']  # samme art to ganger er gyldig, ingen unique constraint


def test_medobservatorer_kan_endres_underveis():
    tur = fellestur_store.create_fellestur(medobservatorer=['Kari'])
    kode = tur['kode']

    ok = fellestur_store.update_fellestur(kode, medobservatorer=['Kari', 'Ola'])
    assert ok is True
    hentet = fellestur_store.get_fellestur(kode)
    assert hentet['medobservatorer'] == ['Kari', 'Ola']


def test_utlopt_tur_er_utilgjengelig():
    tur = fellestur_store.create_fellestur(ttl_hours=0)
    time.sleep(0.01)
    assert fellestur_store.get_fellestur(tur['kode']) is None


def test_synk_mot_ukjent_eller_utlopt_tur_gir_none():
    assert fellestur_store.apply_sync('ABCDEF', upserts=[_upsert('uuid-1')]) is None

    tur = fellestur_store.create_fellestur(ttl_hours=0)
    time.sleep(0.01)
    assert fellestur_store.apply_sync(tur['kode'], upserts=[_upsert('uuid-1')]) is None


def test_for_mange_oppforinger_avvises():
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    original_maks = fellestur_store.MAX_OBS_PER_TUR
    fellestur_store.MAX_OBS_PER_TUR = 2
    try:
        resultat = fellestur_store.apply_sync(
            kode,
            upserts=[
                _upsert('uuid-1', navn='Tjeld'),
                _upsert('uuid-2', navn='Steinvender'),
                _upsert('uuid-3', navn='Sandlo'),
            ],
        )
        assert len(resultat['observasjoner']) == 2
        arter = {o['species']['taxonName'] for o in resultat['observasjoner']}
        assert arter == {'Tjeld', 'Steinvender'}
    finally:
        fellestur_store.MAX_OBS_PER_TUR = original_maks


def test_on_event_kalles_add_update_delete():
    """on_event() brukes av fellestur_peer.py til å bygge utgående federasjons-events."""
    tur = fellestur_store.create_fellestur()
    kode = tur['kode']
    hendelser = []

    fellestur_store.apply_sync(
        kode, upserts=[_upsert('uuid-1')], on_event=lambda t, oid, obs: hendelser.append((t, oid))
    )
    assert hendelser == [('add', 'uuid-1')]

    hendelser.clear()
    fellestur_store.apply_sync(
        kode, upserts=[_upsert('uuid-1', count=9)], on_event=lambda t, oid, obs: hendelser.append((t, oid))
    )
    assert hendelser == [('update', 'uuid-1')]

    hendelser.clear()
    fellestur_store.apply_sync(
        kode, deletes=['uuid-1'], on_event=lambda t, oid, obs: hendelser.append((t, oid))
    )
    assert hendelser == [('delete', 'uuid-1')]


def test_on_event_kalles_ikke_for_slett_av_ukjent_id():
    tur = fellestur_store.create_fellestur()
    hendelser = []
    fellestur_store.apply_sync(
        tur['kode'], deletes=['finnes-ikke'], on_event=lambda t, oid, obs: hendelser.append((t, oid))
    )
    assert hendelser == []


def test_apply_sync_uten_on_event_fungerer_som_for():
    """Eksisterende kallere (server.py sin /api/fellestur-sync) sender ikke on_event — skal ikke kreve det."""
    tur = fellestur_store.create_fellestur()
    resultat = fellestur_store.apply_sync(tur['kode'], upserts=[_upsert('uuid-1')])
    assert resultat is not None
    assert len(resultat['observasjoner']) == 1


def test_slett_med_feil_kode_er_no_op_for_annen_tur():
    tur1 = fellestur_store.create_fellestur()
    tur2 = fellestur_store.create_fellestur()
    fellestur_store.apply_sync(tur1['kode'], upserts=[_upsert('uuid-1')])

    resultat = fellestur_store.apply_sync(tur2['kode'], deletes=['uuid-1'])
    assert resultat is not None
    assert resultat['observasjoner'] == []  # slettingen traff tur2, som aldri hadde raden

    hentet = fellestur_store.get_fellestur(tur1['kode'])
    assert len(hentet['observasjoner']) == 1  # tur1 er urørt
