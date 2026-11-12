"""Privat, tidsbegrenset kopi av en arbeidsliste i SQLite."""

import base64
import binascii
from contextlib import closing, contextmanager
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import re
import secrets
import sqlite3
import time
import uuid


SKJEMAVERSJON = 1
LEVETID_SEKUNDER = 7 * 24 * 60 * 60
SESJON_SEKUNDER = 24 * 60 * 60
MAKS_BODY_BYTES = 8 * 1024 * 1024
MAKS_OBSERVASJONER = 2_000
MAKS_TEKST_BYTES = 2 * 1024 * 1024
MAKS_BILDE_BASE64 = 4 * 1024 * 1024
MAKS_LAGER_BYTES = 256 * 1024 * 1024
_JPEG_PREFIKS = 'data:image/jpeg;base64,'
_JPEG_RAMMER = frozenset({0xC0, 0xC1, 0xC2})
_MAKS_BILDESIDE = 4096
_FORSOK_RE = re.compile(r'[A-Za-z0-9_-]{16,80}')
_KOPI_RE = re.compile(r'[a-f0-9]{32}')
_SESJON_RE = re.compile(r'[A-Za-z0-9_-]{43}')

_TEKSTFELT = frozenset({
    'activity', 'age', 'gender', 'placeName', 'visitId', 'timestamp',
    'tilKlokkeslett', 'hideUntil', 'sentTs', 'obsId', 'comment', 'privateComment',
})
_FLAGGFELT = frozenset({
    'visitLocked', 'uncertain', 'notSpontaneous', 'interesting', 'notRefound',
    'notFound', 'secondhand', 'hadPhoto',
})
_ART_TEKST = frozenset({
    'taxonName', 'scientificNameHtml', 'scientificName', 'latin', 'latinName',
    'nynorsk', 'nameNno', 'nameNob', 'source', 'gruppeType',
})
_ART_ID = frozenset({'id', 'taxonId', 'parentId', 'speciesGroupId', 'protectionLevelId'})
_ART_FLAGG = frozenset({'leaf', 'isSub', 'erGruppe'})
_ART_NAVN = _ART_TEKST - {'source', 'gruppeType'}
_POSISJON_TALL = frozenset({'lat', 'lon', 'accuracy'})
_POSISJON_FLAGG = frozenset({'isFallback', 'isLastKnown'})


class UgyldigListe(ValueError):
    """En kopi eller et endringsvilkår kan ikke brukes."""


class Listekonflikt(Exception):
    """Serverkopien eller lagringsforsøket har endret seg."""


class LagerFullt(Exception):
    """Summen av aktive kopier har nådd grensen for lageret."""


def _tekst(verdi, maks=512):
    return verdi is None or (isinstance(verdi, str) and len(verdi) <= maks)


def _tall(verdi):
    return type(verdi) in (int, float) and -1e15 <= verdi <= 1e15 and math.isfinite(verdi)


def _id(verdi):
    return _tekst(verdi) or (type(verdi) is int and _tall(verdi))


def _flagg(verdi):
    return verdi is None or type(verdi) is bool


def _objekt(verdi, felter):
    return isinstance(verdi, dict) and verdi.keys() <= felter


def _art(verdi):
    if not _objekt(verdi, _ART_TEKST | _ART_ID | _ART_FLAGG | {'antallFunn'}):
        return False
    return (
        all(_tekst(verdi[felt]) for felt in verdi.keys() & _ART_TEKST)
        and any(verdi.get(felt) and verdi[felt].strip() for felt in _ART_NAVN)
        and all(_id(verdi[felt]) for felt in verdi.keys() & _ART_ID)
        and all(_flagg(verdi[felt]) for felt in verdi.keys() & _ART_FLAGG)
        and (verdi.get('antallFunn') is None or _tall(verdi['antallFunn']))
    )


def _posisjon(verdi):
    if verdi is None:
        return True
    if not _objekt(verdi, _POSISJON_TALL | _POSISJON_FLAGG):
        return False
    lat, lon, noyaktighet = verdi.get('lat'), verdi.get('lon'), verdi.get('accuracy')
    return (
        _tall(lat) and -90 <= lat <= 90 and _tall(lon) and -180 <= lon <= 180
        and (noyaktighet is None or (_tall(noyaktighet) and noyaktighet >= 0))
        and all(_flagg(verdi[felt]) for felt in verdi.keys() & _POSISJON_FLAGG)
    )


def _medobservator(verdi):
    return _tekst(verdi) or (
        _objekt(verdi, {'name', 'alias'}) and isinstance(verdi.get('name'), str)
        and all(_tekst(felt) for felt in verdi.values())
    )


def _jpeg_med_bilde(data):
    """Sjekk ramme, dimensjoner og start av bildedata før nettleseren dekoder."""
    if not data.startswith(b'\xff\xd8') or not data.endswith(b'\xff\xd9'):
        return False
    pos = 2
    har_ramme = False
    while pos < len(data) - 2 and data[pos] == 0xFF:
        while pos < len(data) and data[pos] == 0xFF:
            pos += 1
        if pos + 3 > len(data):
            return False
        markor = data[pos]
        pos += 1
        lengde = int.from_bytes(data[pos:pos + 2], 'big')
        if lengde < 2 or pos + lengde > len(data) - 2:
            return False
        if markor in _JPEG_RAMMER:
            if lengde < 8 or data[pos + 2] != 8:
                return False
            hoyde = int.from_bytes(data[pos + 3:pos + 5], 'big')
            bredde = int.from_bytes(data[pos + 5:pos + 7], 'big')
            komponenter = data[pos + 7]
            if not (0 < hoyde <= _MAKS_BILDESIDE and 0 < bredde <= _MAKS_BILDESIDE
                    and komponenter in (1, 3, 4) and lengde == 8 + 3 * komponenter):
                return False
            har_ramme = True
        if markor == 0xDA:
            return har_ramme and lengde >= 8 and pos + lengde < len(data) - 2
        pos += lengde
    return False


def _bilde(verdi):
    if verdi is None or verdi == '':
        return
    if not isinstance(verdi, str) or not verdi.startswith(_JPEG_PREFIKS):
        raise UgyldigListe('Lista inneholder et bilde i et format som ikke støttes.')
    if len(verdi) > MAKS_BILDE_BASE64 + len(_JPEG_PREFIKS):
        raise UgyldigListe('Et bilde i lista er for stort til å overføre.')
    try:
        data = base64.b64decode(verdi[len(_JPEG_PREFIKS):], validate=True)
    except (ValueError, binascii.Error):
        raise UgyldigListe('Lista inneholder et ugyldig bilde.') from None
    if not _jpeg_med_bilde(data):
        raise UgyldigListe('Lista inneholder et ugyldig eller for stort JPEG-bilde.')


def _observasjon(obs):
    felter = _TEKSTFELT | _FLAGGFELT | {
        'species', 'count', 'position', 'placeId', 'coObservers', 'rarityWarning', 'photo',
    }
    if not _objekt(obs, felter):
        return False
    medobs = obs.get('coObservers')
    varsel = obs.get('rarityWarning')
    antall = obs.get('count')
    return (
        _art(obs.get('species'))
        and all(_tekst(obs[felt], 8192 if felt in {'comment', 'privateComment'} else 512)
                for felt in obs.keys() & _TEKSTFELT)
        and all(_flagg(obs[felt]) for felt in obs.keys() & _FLAGGFELT)
        and (_tall(antall) or _tekst(antall, 32))
        and _id(obs.get('placeId')) and _posisjon(obs.get('position'))
        and (medobs is None or (isinstance(medobs, list) and len(medobs) <= 10
                                and all(_medobservator(v) for v in medobs)))
        and (varsel is None or (_objekt(varsel, {'header', 'body'})
                                and all(_tekst(v, 8192) for v in varsel.values())))
    )


def _json_bytes(data):
    return json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def _dato(verdi):
    try:
        return date.fromisoformat(verdi[:10]).isoformat() if verdi else None
    except ValueError:
        return None


def _valider_liste(liste):
    if (not _objekt(liste, {'schemaVersion', 'observations'})
            or type(liste.get('schemaVersion')) is not int
            or liste['schemaVersion'] != SKJEMAVERSJON):
        raise UgyldigListe('Denne versjonen av lista kan ikke overføres.')
    observasjoner = liste.get('observations')
    if not isinstance(observasjoner, list) or not observasjoner:
        raise UgyldigListe('Lista må inneholde minst én observasjon.')
    if len(observasjoner) > MAKS_OBSERVASJONER:
        raise UgyldigListe(f'Lista har mer enn {MAKS_OBSERVASJONER} observasjoner.')

    datoer = []
    tekst_bytes = 0
    try:
        for nummer, obs in enumerate(observasjoner, 1):
            if not _observasjon(obs):
                raise UgyldigListe(f'Observasjon {nummer} har felt som ikke kan overføres.')
            _bilde(obs.get('photo'))
            tekst_bytes += len(_json_bytes({felt: verdi for felt, verdi in obs.items() if felt != 'photo'}))
            if tekst_bytes > MAKS_TEKST_BYTES:
                raise UgyldigListe('Lista inneholder for mye tekst til å overføre.')
            datoer.extend(dag for felt in ('timestamp', 'tilKlokkeslett')
                          if (dag := _dato(obs.get(felt))))
        payload = _json_bytes(liste)
    except UnicodeError:
        raise UgyldigListe('Lista inneholder tekst som ikke kan overføres.') from None
    if len(payload) > MAKS_BODY_BYTES:
        raise UgyldigListe('Lista med bilder er for stor til å overføre.')
    return payload, len(observasjoner), min(datoer, default=None), max(datoer, default=None)


class ArbeidslisteLager:
    def __init__(self, db_path):
        self.db_path = Path(db_path)

    @contextmanager
    def _tilkobling(self):
        with closing(sqlite3.connect(self.db_path)) as conn:
            conn.row_factory = sqlite3.Row
            with conn:
                yield conn

    def init_db(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._tilkobling() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS arbeidsliste_kopier (
                    eier TEXT PRIMARY KEY,
                    kopi_id TEXT NOT NULL UNIQUE,
                    kilde TEXT NOT NULL,
                    lagret_ts REAL NOT NULL,
                    utloper_ts REAL NOT NULL,
                    antall INTEGER NOT NULL,
                    fra_dato TEXT,
                    til_dato TEXT,
                    payload BLOB NOT NULL
                );
                CREATE INDEX IF NOT EXISTS arbeidsliste_kopier_utloper
                    ON arbeidsliste_kopier(utloper_ts);
                CREATE TABLE IF NOT EXISTS arbeidsliste_kvitteringer (
                    eier TEXT NOT NULL,
                    forsok TEXT NOT NULL,
                    innhold_hash TEXT NOT NULL,
                    kvittering TEXT NOT NULL,
                    utloper_ts REAL NOT NULL,
                    PRIMARY KEY (eier, forsok)
                );
                CREATE INDEX IF NOT EXISTS arbeidsliste_kvitteringer_utloper
                    ON arbeidsliste_kvitteringer(utloper_ts);
                CREATE TABLE IF NOT EXISTS arbeidsliste_sesjoner (
                    token_hash TEXT PRIMARY KEY,
                    eier TEXT NOT NULL,
                    utloper_ts REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS arbeidsliste_sesjoner_utloper
                    ON arbeidsliste_sesjoner(utloper_ts);
            """)

    @staticmethod
    def _rydd(conn, naa):
        conn.execute('DELETE FROM arbeidsliste_kopier WHERE utloper_ts <= ?', (naa,))
        conn.execute('DELETE FROM arbeidsliste_kvitteringer WHERE utloper_ts <= ?', (naa,))
        conn.execute('DELETE FROM arbeidsliste_sesjoner WHERE utloper_ts <= ?', (naa,))

    def rydd_utlopte(self):
        with self._tilkobling() as conn:
            conn.execute('PRAGMA secure_delete = ON')
            self._rydd(conn, time.time())

    @staticmethod
    def _token_hash(token):
        if isinstance(token, str) and _SESJON_RE.fullmatch(token):
            return hashlib.sha256(token.encode('ascii')).hexdigest()
        return None

    def opprett_sesjon(self, eier):
        token = secrets.token_urlsafe(32)
        utlop = time.time() + SESJON_SEKUNDER
        with self._tilkobling() as conn:
            conn.execute('INSERT INTO arbeidsliste_sesjoner VALUES (?, ?, ?)',
                         (self._token_hash(token), eier, utlop))
        return {'token': token, 'eier': eier, 'utloperTs': utlop}

    def hent_sesjonseier(self, token):
        token_hash = self._token_hash(token)
        if token_hash is None:
            return None
        with self._tilkobling() as conn:
            rad = conn.execute('SELECT eier FROM arbeidsliste_sesjoner WHERE token_hash = ? AND utloper_ts > ?',
                               (token_hash, time.time())).fetchone()
        return rad['eier'] if rad else None

    def slett_sesjon(self, token):
        token_hash = self._token_hash(token)
        if token_hash is not None:
            with self._tilkobling() as conn:
                conn.execute('DELETE FROM arbeidsliste_sesjoner WHERE token_hash = ?', (token_hash,))

    @staticmethod
    def _metadata(rad):
        return {
            'id': rad['kopi_id'], 'kilde': rad['kilde'], 'lagretTs': rad['lagret_ts'],
            'utloperTs': rad['utloper_ts'], 'antall': rad['antall'],
            'fraDato': rad['fra_dato'], 'tilDato': rad['til_dato'],
        }

    def siste_kopi(self, eier):
        with self._tilkobling() as conn:
            rad = conn.execute("""
                SELECT kopi_id, kilde, lagret_ts, utloper_ts, antall, fra_dato, til_dato
                FROM arbeidsliste_kopier WHERE eier = ? AND utloper_ts > ?
            """, (eier, time.time())).fetchone()
        return self._metadata(rad) if rad else None

    def hent_kopi(self, eier, kopi_id):
        with self._tilkobling() as conn:
            rad = conn.execute("""
                SELECT * FROM arbeidsliste_kopier WHERE eier = ? AND kopi_id = ? AND utloper_ts > ?
            """, (eier, kopi_id, time.time())).fetchone()
        return {'kopi': self._metadata(rad), 'liste': json.loads(rad['payload'])} if rad else None

    def lagre_kopi(self, eier, liste, kilde, forsok, erstatter):
        if not isinstance(forsok, str) or not _FORSOK_RE.fullmatch(forsok):
            raise UgyldigListe('Lagringsforsøket har en ugyldig identifikator.')
        if erstatter is not None and (not isinstance(erstatter, str) or not _KOPI_RE.fullmatch(erstatter)):
            raise UgyldigListe('Lista som skal erstattes, har en ugyldig identifikator.')
        if not isinstance(kilde, str) or len(kilde) > 60 or not kilde.strip():
            raise UgyldigListe('Velg et enhetsnavn på inntil 60 tegn.')
        kilde = kilde.strip()
        payload, antall, fra_dato, til_dato = _valider_liste(liste)
        innhold_hash = hashlib.sha256(payload)
        try:
            innhold_hash.update(_json_bytes([kilde, erstatter]))
        except UnicodeError:
            raise UgyldigListe('Enhetsnavnet inneholder ugyldig tekst.') from None
        innhold_hash = innhold_hash.hexdigest()

        with self._tilkobling() as conn:
            conn.execute('PRAGMA secure_delete = ON')
            conn.execute('BEGIN IMMEDIATE')
            naa = time.time()
            self._rydd(conn, naa)
            kvittering = conn.execute("""
                SELECT innhold_hash, kvittering FROM arbeidsliste_kvitteringer
                WHERE eier = ? AND forsok = ?
            """, (eier, forsok)).fetchone()
            if kvittering:
                if kvittering['innhold_hash'] != innhold_hash:
                    raise Listekonflikt('Dette lagringsforsøket er allerede brukt for en annen liste.')
                return json.loads(kvittering['kvittering'])

            forrige = conn.execute('SELECT kopi_id FROM arbeidsliste_kopier WHERE eier = ?', (eier,)).fetchone()
            if (forrige['kopi_id'] if forrige else None) != erstatter:
                raise Listekonflikt('Serverkopien har endret seg. Hent gjeldende kopi og prøv igjen.')
            brukt = conn.execute('SELECT coalesce(sum(length(payload)), 0) FROM arbeidsliste_kopier WHERE eier <> ?',
                                 (eier,)).fetchone()[0]
            if brukt + len(payload) > MAKS_LAGER_BYTES:
                raise LagerFullt('Serverlageret er fullt. Prøv igjen senere.')

            rad = {
                'kopi_id': uuid.uuid4().hex, 'kilde': kilde, 'lagret_ts': naa,
                'utloper_ts': naa + LEVETID_SEKUNDER, 'antall': antall,
                'fra_dato': fra_dato, 'til_dato': til_dato,
            }
            conn.execute("""
                INSERT INTO arbeidsliste_kopier
                    (eier, kopi_id, kilde, lagret_ts, utloper_ts, antall, fra_dato, til_dato, payload)
                VALUES (:eier, :kopi_id, :kilde, :lagret_ts, :utloper_ts, :antall, :fra_dato, :til_dato, :payload)
                ON CONFLICT(eier) DO UPDATE SET
                    kopi_id = excluded.kopi_id, kilde = excluded.kilde, lagret_ts = excluded.lagret_ts,
                    utloper_ts = excluded.utloper_ts, antall = excluded.antall, fra_dato = excluded.fra_dato,
                    til_dato = excluded.til_dato, payload = excluded.payload
            """, {'eier': eier, 'payload': payload, **rad})
            metadata = self._metadata(rad)
            conn.execute("""
                INSERT INTO arbeidsliste_kvitteringer (eier, forsok, innhold_hash, kvittering, utloper_ts)
                VALUES (?, ?, ?, ?, ?)
            """, (eier, forsok, innhold_hash, json.dumps(metadata), rad['utloper_ts']))
        return metadata

    def slett_kopi(self, eier, kopi_id):
        with self._tilkobling() as conn:
            conn.execute('PRAGMA secure_delete = ON')
            cursor = conn.execute("""
                DELETE FROM arbeidsliste_kopier WHERE eier = ? AND kopi_id = ? AND utloper_ts > ?
            """, (eier, kopi_id, time.time()))
            if cursor.rowcount != 1:
                raise Listekonflikt('Serverkopien har endret seg eller er allerede borte.')
