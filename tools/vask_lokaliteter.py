#!/usr/bin/env python3
"""Nattlig vask av lokalitetsbasen: nye steder fra Dagens Funn inn, og status sjekket på nytt.

Leser Dagens Funns rader fra den delte basen (bare lesing) og sjekker dem med AO2 GetSite,
samme kall og samme regler som lokalitetsuttrekket (tools/extract_ao_locations.py):

  bird    -> offentlig fuglelokalitet (is_private=0), vises for alle
  private -> privat, men sett i et åpent funn (is_private=1), vises bak «andres private»
  other   -> annen artsgruppe, fjernes
  unknown -> uendret, prøves igjen neste gang

I tillegg sjekkes en porsjon av de private radene i rotasjon, slik at en privat lokalitet
som komiteen senere gjør offentlig, blir fanget opp innen en måned.
Skriver bare til --target. Se docs/lokalitetsuttrekk-2026-11.md.
"""

import argparse
import json
from pathlib import Path
import sqlite3
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract_ao_locations as x  # noqa: E402


def les_miljofil(path):
    verdier = {}
    for linje in Path(path).read_text().splitlines():
        if '=' in linje and not linje.lstrip().startswith('#'):
            k, v = linje.split('=', 1)
            verdier[k.strip()] = v.strip()
    return verdier


def tilstand(path):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.commit()
    return db


def nye_fra_dagens_funn(shared, cursor):
    # Å lese er gratis; det er kallene mot AO som begrenses (se maks_nye i vask()).
    return shared.execute(
        """SELECT ao_id, name, lat, lon, parent_id, municipality, county, created_at, updated_at
           FROM locations WHERE source='dagens-funn' AND lat IS NOT NULL AND lon IS NOT NULL
             AND updated_at > ? ORDER BY updated_at, ao_id""", (cursor,)).fetchall()


def lagre(target, sid, status, rad=None):
    """Skriv utfallet for én lokalitet. rad er Dagens Funns rad for nye steder."""
    with target:
        if status == 'other':
            target.execute('DELETE FROM locations WHERE ao_id=?', (sid,))
        elif status in ('bird', 'private'):
            privat = 1 if status == 'private' else 0
            if rad is not None:
                target.execute(
                    """INSERT INTO locations (ao_id,name,lat,lon,is_private,is_super,parent_id,municipality,
                                              county,source,created_at,updated_at)
                       VALUES (?,?,?,?,?,0,?,?,?,'dagens-funn',?,datetime('now'))
                       ON CONFLICT(ao_id) DO UPDATE SET is_private=excluded.is_private,
                           updated_at=datetime('now')""",
                    (sid, rad['name'], rad['lat'], rad['lon'], privat, rad['parent_id'],
                     rad['municipality'], rad['county'], rad['created_at']))
            else:
                target.execute("UPDATE locations SET is_private=?, updated_at=datetime('now') WHERE ao_id=?",
                               (privat, sid))


def vask(shared, target, state, api, *, maks_nye, rotasjon):
    teller = {'nye_sjekket': 0, 'rotasjon_sjekket': 0, 'bird': 0, 'private': 0, 'other': 0,
              'unknown': 0, 'ble_offentlig': 0, 'hoppet_over': 0}
    kjente = {r[0] for r in target.execute('SELECT ao_id FROM locations')}
    feil_paa_rad = 0

    def sjekk(sid):
        """Status for én lokalitet. Et ugyldig svar for én lokalitet stopper ikke vasken,
        men AO-pause (429/5xx/nettverk) og fem feil på rad gjør det."""
        nonlocal feil_paa_rad
        try:
            status = x.classify_detail(sid, api.site_detail(sid))
        except x.ExtractError:
            if x.get_meta(state, 'pause_until', 0) > time.time():
                raise
            feil_paa_rad += 1
            if feil_paa_rad >= 5:
                raise
            print(f'Hopper over {sid}: ugyldig svar fra AO', file=sys.stderr)
            teller['hoppet_over'] += 1
            return None
        feil_paa_rad = 0
        return status

    # 1. Rader fra Dagens Funn som er nye for basen. Dagens Funn oppdaterer også steder den
    #    har sett før (≈2 900 i døgnet); dem tar rotasjonen. Markøren flyttes etter hver rad,
    #    så et avbrudd fortsetter der det stoppet.
    cursor = x.get_meta(state, 'df_cursor')
    for rad in nye_fra_dagens_funn(shared, cursor):
        sid = rad['ao_id']
        if sid not in kjente:
            if teller['nye_sjekket'] + teller['hoppet_over'] >= maks_nye:
                break  # resten tas neste natt; markøren står på siste behandlede rad
            kjente.add(sid)
            status = sjekk(sid)
            if status:
                lagre(target, sid, status, rad)
                teller['nye_sjekket'] += 1
                teller[status] += 1
        with state:
            x.set_meta(state, 'df_cursor', rad['updated_at'])

    # 2. Rotasjon over private rader fra Dagens Funn: er noen blitt offentlige?
    start = x.get_meta(state, 'rotasjon_cursor', 0)
    rader = [r[0] for r in target.execute(
        """SELECT ao_id FROM locations WHERE source='dagens-funn' AND is_private=1 AND ao_id > ?
           ORDER BY ao_id LIMIT ?""", (start, rotasjon))]
    for sid in rader:
        status = sjekk(sid)
        if status:
            if status != 'private':
                lagre(target, sid, status)
            teller['rotasjon_sjekket'] += 1
            teller[status] += 1
            teller['ble_offentlig'] += status == 'bird'
        with state:
            x.set_meta(state, 'rotasjon_cursor', sid)
    if len(rader) < rotasjon:
        with state:
            x.set_meta(state, 'rotasjon_cursor', 0)  # ny runde neste natt
    return teller


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--shared', required=True, help='Delt lokalitetsbase (bare lesing)')
    p.add_argument('--target', required=True, help='Basen som oppdateres')
    p.add_argument('--state', required=True, help='Egen tilstandsfil (markører, AO-pause, tempo)')
    p.add_argument('--env-file', required=True, help='Fil med AO_EXTRACT_USERNAME/PASSWORD')
    p.add_argument('--start', help='Første markør (updated_at) hvis tilstandsfilen er ny')
    p.add_argument('--maks-nye', type=int, default=2000)
    p.add_argument('--rotasjon', type=int, default=2000)
    args = p.parse_args(argv)

    state = tilstand(args.state)
    if x.get_meta(state, 'df_cursor') is None:
        if not args.start:
            print('Ny tilstandsfil: oppgi --start (updated_at basen ble bygd fra).', file=sys.stderr)
            return 2
        with state:
            x.set_meta(state, 'df_cursor', args.start)
    if x.get_meta(state, 'pause_until', 0) > time.time():
        print('AO-pausen gjelder fortsatt. Ingen kall er gjort.')
        return 0

    miljo = les_miljofil(args.env_file)
    shared = sqlite3.connect(Path(args.shared).resolve().as_uri() + '?mode=ro', uri=True, timeout=30)
    shared.row_factory = sqlite3.Row
    target = sqlite3.connect(args.target, timeout=30)
    api = x.AOClient(state, max_requests=args.maks_nye + args.rotasjon + 10, delay=x.ADAPTIVE_START,
                     username=miljo.get('AO_EXTRACT_USERNAME'), password=miljo.get('AO_EXTRACT_PASSWORD'),
                     adaptive=True)
    try:
        teller = vask(shared, target, state, api, maks_nye=args.maks_nye, rotasjon=args.rotasjon)
    except x.ExtractError as e:
        print(f'Vasken stoppet: {e}', file=sys.stderr)
        return 1
    finally:
        api.close()
    teller['markør'] = x.get_meta(state, 'df_cursor')
    print(json.dumps(teller, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
