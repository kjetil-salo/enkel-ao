import base64
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier

import pytest

from src import arbeidsliste_store as lager


# En ekte 1 × 1 piksel JPEG uten EXIF og fargeprofil.
_FOTO = (
    'data:image/jpeg;base64,/9j/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL'
    '/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRol'
    'JicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6'
    'ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDA'
    'wUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/90ABAAB/9oACAEBAAA/ACv/2Q=='
)


@pytest.fixture
def arbeidslager(tmp_path):
    resultat = lager.ArbeidslisteLager(tmp_path / 'stats.db')
    resultat.init_db()
    return resultat


@pytest.fixture
def liste():
    return {
        'schemaVersion': 1,
        'observations': [
            {
                'species': {'taxonName': 'Kråke', 'taxonId': 123, 'scientificNameHtml': '<i>Corvus cornix</i>'},
                'count': 2,
                'position': {'lat': 60.5, 'lon': 5.2, 'accuracy': 12},
                'placeName': 'Teststed',
                'placeId': '456',
                'visitId': 'visit-1',
                'visitLocked': True,
                'timestamp': '2026-11-10T23:55:00',
                'tilKlokkeslett': '2026-11-11T00:05:00',
                'activity': 'Overflygende',
                'age': '',
                'gender': '',
                'comment': 'Feltkommentar',
                'privateComment': 'Privat feltkommentar',
                'hideUntil': '2027-01-01',
                'uncertain': True,
                'notSpontaneous': False,
                'interesting': True,
                'notRefound': False,
                'notFound': False,
                'secondhand': False,
                'coObservers': [{'name': 'Testobservatør', 'alias': 'testobs'}, ''],
                'rarityWarning': {'header': 'Sjekk arten', 'body': 'Testvarsel'},
                'photo': _FOTO,
                'sentTs': '2026-11-11T08:00:00.000Z',
            },
            {'species': {'taxonName': 'Tjeld'}, 'count': 1},
            {'species': {'taxonName': 'Tjeld'}, 'count': 1},
        ],
    }


def lagre(arbeidslager, liste, forsok='forsok-000000000001', erstatter=None, eier='konto-a'):
    return arbeidslager.lagre_kopi(eier, liste, 'Mobil', forsok, erstatter)


def test_bevarer_liste_med_private_felt_bilder_og_duplikatrader(arbeidslager, liste):
    metadata = lagre(arbeidslager, liste)
    assert metadata['antall'] == 3
    assert metadata['fraDato'] == '2026-11-10'
    assert metadata['tilDato'] == '2026-11-11'
    assert metadata['utloperTs'] - metadata['lagretTs'] == lager.LEVETID_SEKUNDER
    assert arbeidslager.siste_kopi('konto-a') == metadata

    omstart = lager.ArbeidslisteLager(arbeidslager.db_path)
    omstart.init_db()
    assert omstart.hent_kopi('konto-a', metadata['id']) == {'kopi': metadata, 'liste': liste}


def test_kopi_id_gir_ingen_tilgang_paa_tvers_av_eier(arbeidslager, liste):
    metadata = lagre(arbeidslager, liste)
    assert arbeidslager.siste_kopi('konto-b') is None
    assert arbeidslager.hent_kopi('konto-b', metadata['id']) is None
    with pytest.raises(lager.Listekonflikt):
        arbeidslager.slett_kopi('konto-b', metadata['id'])
    with pytest.raises(lager.Listekonflikt):
        lagre(arbeidslager, liste, erstatter=metadata['id'], eier='konto-b')
    annen_kopi = lagre(arbeidslager, liste, eier='konto-b')
    assert annen_kopi['id'] != metadata['id']
    assert arbeidslager.siste_kopi('konto-a') == metadata


def test_artsfunn_uten_norsk_navn_bevares(arbeidslager):
    art = {'taxonName': None, 'scientificNameHtml': '<i>Turdus pilaris</i>', 'taxonId': 123}
    liste = {'schemaVersion': 1, 'observations': [{'species': art, 'tilKlokkeslett': '2026-11-11T12:00:00'}]}
    kopi = lagre(arbeidslager, liste)
    assert kopi['fraDato'] == kopi['tilDato'] == '2026-11-11'
    assert arbeidslager.hent_kopi('konto-a', kopi['id'])['liste'] == liste


def test_tapt_kvittering_skriver_ikke_over_nyere_kopi_eller_gjenoppretter_slettet(arbeidslager, liste):
    forste = lagre(arbeidslager, liste)
    assert lagre(arbeidslager, liste) == forste
    ny = lagre(arbeidslager, liste, forsok='forsok-000000000002', erstatter=forste['id'])

    assert lagre(arbeidslager, liste) == forste
    assert arbeidslager.siste_kopi('konto-a') == ny
    assert arbeidslager.hent_kopi('konto-a', forste['id']) is None
    with pytest.raises(lager.Listekonflikt):
        arbeidslager.slett_kopi('konto-a', forste['id'])
    arbeidslager.slett_kopi('konto-a', ny['id'])
    assert lagre(arbeidslager, liste) == forste
    assert arbeidslager.siste_kopi('konto-a') is None


def test_gjenbruk_av_forsok_med_endret_liste_avvises(arbeidslager, liste):
    forste = lagre(arbeidslager, liste)
    endret = deepcopy(liste)
    endret['observations'][0]['count'] = 3
    with pytest.raises(lager.Listekonflikt):
        lagre(arbeidslager, endret)
    assert arbeidslager.hent_kopi('konto-a', forste['id'])['liste'] == liste


def test_bare_en_av_to_samtidige_oppdateringer_lykkes(arbeidslager, liste):
    forste = lagre(arbeidslager, liste)
    start = Barrier(2)

    def skriv(nummer):
        start.wait(timeout=5)
        try:
            return lagre(arbeidslager, liste, forsok=f'samtidig-forsok-{nummer}', erstatter=forste['id'])
        except lager.Listekonflikt:
            return None

    with ThreadPoolExecutor(max_workers=2) as arbeidere:
        resultater = list(arbeidere.map(skriv, [1, 2]))
    assert resultater.count(None) == 1
    assert arbeidslager.siste_kopi('konto-a') in resultater
    assert arbeidslager.siste_kopi('konto-a') is not None


def test_utlop_gjelder_ved_lesing_for_opprydding(arbeidslager, liste, monkeypatch):
    metadata = lagre(arbeidslager, liste)
    monkeypatch.setattr(lager.time, 'time', lambda: metadata['utloperTs'])
    assert arbeidslager.siste_kopi('konto-a') is None
    assert arbeidslager.hent_kopi('konto-a', metadata['id']) is None
    arbeidslager.rydd_utlopte()
    with arbeidslager._tilkobling() as conn:
        assert conn.execute('SELECT COUNT(*) FROM arbeidsliste_kopier').fetchone()[0] == 0
        assert conn.execute('SELECT COUNT(*) FROM arbeidsliste_kvitteringer').fetchone()[0] == 0


@pytest.mark.parametrize('endring', [
    {'photo': 'https://example.com/bilde.jpg'},
    {'photo': 'data:image/svg+xml;base64,PHN2Zz4='},
    {'photo': 'data:image/jpeg;base64,PHN2Zz4='},
    {'photo': 'data:image/jpeg;base64,/9j/bm9uZS3/2Q=='},
    {'position': {'lat': 90.1, 'lon': 5}},
    {'position': {'lat': True, 'lon': 5}},
    {'count': float('nan')},
    {'coObservers': [{'name': 'Test', 'password': 'testdata'}]},
    {'species': {'taxonName': 'Kråke', 'loginToken': 'testdata'}},
    {'comment': '\ud800'},
    {'ao_password': 'testdata'},
])
def test_ugyldig_observasjon_bevarer_forrige_kopi(arbeidslager, liste, endring):
    forste = lagre(arbeidslager, liste)
    endret = deepcopy(liste)
    endret['observations'][0].update(endring)
    with pytest.raises(lager.UgyldigListe):
        lagre(arbeidslager, endret, forsok='forsok-000000000002', erstatter=forste['id'])
    assert arbeidslager.hent_kopi('konto-a', forste['id'])['liste'] == liste


@pytest.mark.parametrize('liste_endring', [{'schemaVersion': 2}, {'schemaVersion': True}, {'observations': []}])
def test_avviser_ukjent_skjema_og_tom_liste(arbeidslager, liste, liste_endring):
    liste.update(liste_endring)
    with pytest.raises(lager.UgyldigListe):
        lagre(arbeidslager, liste)
    assert arbeidslager.siste_kopi('konto-a') is None


@pytest.mark.parametrize('grense', ['MAKS_OBSERVASJONER', 'MAKS_TEKST_BYTES', 'MAKS_BILDE_BASE64', 'MAKS_BODY_BYTES'])
def test_grenser_avviser_hele_lista(arbeidslager, liste, monkeypatch, grense):
    monkeypatch.setattr(lager, grense, 1)
    with pytest.raises(lager.UgyldigListe):
        lagre(arbeidslager, liste)
    assert arbeidslager.siste_kopi('konto-a') is None


def test_lagerkvote_avviser_ny_kopi_uten_aa_rulle_tilbake_andres(arbeidslager, liste, monkeypatch):
    forste = lagre(arbeidslager, liste)
    monkeypatch.setattr(lager, 'MAKS_LAGER_BYTES', 1)
    with pytest.raises(lager.LagerFullt):
        lagre(arbeidslager, liste, eier='konto-b')
    assert arbeidslager.siste_kopi('konto-b') is None
    assert arbeidslager.siste_kopi('konto-a') == forste


def test_avviser_jpeg_med_for_store_dimensjoner(arbeidslager, liste):
    data = bytearray(base64.b64decode(_FOTO.split(',', 1)[1]))
    rammestart = data.index(b'\xff\xc0')
    data[rammestart + 7:rammestart + 9] = (4097).to_bytes(2, 'big')
    liste['observations'][0]['photo'] = 'data:image/jpeg;base64,' + base64.b64encode(data).decode()
    with pytest.raises(lager.UgyldigListe, match='JPEG'):
        lagre(arbeidslager, liste)
