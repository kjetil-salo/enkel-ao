import sqlite3

from tools import vask_lokaliteter as vask

SKJEMA = """CREATE TABLE locations (ao_id INTEGER PRIMARY KEY, name TEXT NOT NULL, lat REAL, lon REAL,
    is_private INTEGER DEFAULT 0, is_super INTEGER DEFAULT 0, parent_id INTEGER, municipality TEXT,
    county TEXT, source TEXT NOT NULL, created_at TEXT, updated_at TEXT)"""


def detalj(sid, *, privat=False, fugl=True):
    return {'SiteId': sid, 'SiteIsPrivate': privat, 'IsNotBirdSite': not fugl,
            'SiteSpeciesGroupId': 8 if fugl else 0}


class FalskAO:
    def __init__(self, svar):
        self.svar, self.kalt = svar, []

    def site_detail(self, sid):
        self.kalt.append(sid)
        return self.svar[sid]


def baser(tmp_path):
    shared = sqlite3.connect(tmp_path / 'shared.db')
    shared.row_factory = sqlite3.Row
    target = sqlite3.connect(tmp_path / 'target.db')
    for db in (shared, target):
        db.execute(SKJEMA)
    shared.executemany(
        "INSERT INTO locations VALUES (?,?,59.9,10.7,0,0,NULL,'Oslo','Oslo',?,'2026-11-01',?)",
        [(1, 'Ny fugl', 'dagens-funn', '2026-11-26 01:00:00'),
         (2, 'Ny privat', 'dagens-funn', '2026-11-26 02:00:00'),
         (3, 'Ny annen gruppe', 'dagens-funn', '2026-11-26 03:00:00'),
         (4, 'Kjent fugl', 'dagens-funn', '2026-11-26 04:00:00'),
         (5, 'Gammel', 'dagens-funn', '2026-11-20 00:00:00'),
         (6, 'Fra import', 'bulk-import', '2026-11-26 05:00:00')])
    target.executemany(
        "INSERT INTO locations VALUES (?,?,59.9,10.7,?,0,NULL,'Oslo','Oslo',?,'2026-11-01','2026-11-01')",
        [(4, 'Kjent fugl', 0, 'ao-public-extract'),
         (7, 'Blir offentlig', 1, 'dagens-funn'),
         (8, 'Fortsatt privat', 1, 'dagens-funn')])
    target.commit()
    return shared, target


def test_nye_fra_dagens_funn_sjekkes_og_private_vaskes_i_rotasjon(tmp_path):
    shared, target = baser(tmp_path)
    state = vask.tilstand(tmp_path / 'state.db')
    vask.x.set_meta(state, 'df_cursor', '2026-11-25 07:40:15')
    ao = FalskAO({1: detalj(1), 2: detalj(2, privat=True, fugl=False), 3: detalj(3, fugl=False),
                  7: detalj(7), 8: detalj(8, privat=True, fugl=False)})

    teller = vask.vask(shared, target, state, ao, maks_nye=100, rotasjon=100)

    status = dict(target.execute('SELECT ao_id, is_private FROM locations'))
    assert status == {1: 0, 2: 1, 4: 0, 7: 0, 8: 1}  # 3 er annen artsgruppe og fjernet
    assert 4 not in ao.kalt and 5 not in ao.kalt and 6 not in ao.kalt  # kjent, gammel, ikke DF
    assert teller['ble_offentlig'] == 1
    assert vask.x.get_meta(state, 'df_cursor') == '2026-11-26 04:00:00'
    assert vask.x.get_meta(state, 'rotasjon_cursor') == 0  # runden er ferdig, starter på nytt

    # Neste natt: Dagens Funn har sett et kjent sted igjen (sjekkes ikke, det tar rotasjonen),
    # og ett sted gir et ugyldig svar fra AO (hoppes over, vasken fortsetter).
    shared.execute("UPDATE locations SET updated_at='2026-11-27 00:00:00' WHERE ao_id=2")
    ao.kalt.clear()
    ao.svar[2] = None  # rotasjonen tar 2 og 8; 2 feiler
    def detalj_eller_feil(sid):
        ao.kalt.append(sid)
        if ao.svar[sid] is None:
            raise vask.x.ExtractError('Ugyldig JSON i detaljoppslaget.')
        return ao.svar[sid]
    ao.site_detail = detalj_eller_feil
    teller = vask.vask(shared, target, state, ao, maks_nye=100, rotasjon=100)
    assert ao.kalt == [2, 8] and teller['hoppet_over'] == 1
