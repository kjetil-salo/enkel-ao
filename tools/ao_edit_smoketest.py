#!/usr/bin/env python3
"""
Røyktest av endringsendepunktene mot en kjørende server og ekte AO.

Tester kjeden frontend kommer til å bruke:

    /api/ao-my-sightings   → finn et funn å teste på
    /api/ao-sighting-form  → åpne (funnet blir UPUBLISERT her)
    /api/ao-sighting-save  → lagre + publiser + bekreft
       eller
    /api/ao-sighting-abort → angre, publiser tilbake uendret

Standard er `--abort`: åpner skjemaet og angrer med én gang. Da er funnet
upublisert i et par sekunder, og ingenting endres. Det er den trygge testen.

    # 1) Start serveren i et annet vindu
    python3 server.py

    # 2) Trygg test — åpner og angrer, endrer ingenting
    python3 tools/ao_edit_smoketest.py

    # 3) Velg et bestemt funn
    python3 tools/ao_edit_smoketest.py --sighting-id 42030658

    # 4) Ekte endring: sett antall til 4, bekreft, og sett det TILBAKE etterpå
    python3 tools/ao_edit_smoketest.py --sighting-id 42030658 --sett-antall 4 --tilbakestill

Legitimasjon: samme som `ao_noop_roundtrip.py` — tokens fra `.env`, ellers
miljøvariabler, ellers et interaktivt spørsmål.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tools.ao_noop_roundtrip import _logg_inn  # noqa: E402

BASE = os.environ.get('SMOKE_BASE', 'http://localhost:3000')


def post(sti, nyttelast, timeout=120):
    req = urllib.request.Request(
        BASE + sti,
        data=json.dumps(nyttelast).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.URLError as exc:
        sys.exit(f'Får ikke kontakt med {BASE}{sti}: {exc}\n'
                 f'Kjører serveren? Start den med: python3 server.py')


def kort(d, felt):
    return {k: d.get(k) for k in felt if k in d}


def main():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--sighting-id', type=int,
                   help='Funn å teste på. Uten denne velges ditt nyeste uten bilde.')
    p.add_argument('--sett-antall', type=int,
                   help='Gjør en EKTE endring av antall. Uten denne: bare åpne og angre.')
    p.add_argument('--tilbakestill', action='store_true',
                   help='Sett antallet tilbake til opprinnelig verdi etterpå.')
    args = p.parse_args()

    token, auth = _logg_inn()
    cred = {'loginToken': token, 'authCookie': auth}

    # --- Finn et funn ---------------------------------------------------
    print(f'\n[1/4] Henter dine funn fra {BASE} …')
    mine = post('/api/ao-my-sightings', {**cred, 'days': 30})
    if mine.get('needsLogin'):
        sys.exit('Serveren sier at sesjonen er utløpt.')
    funn_liste = mine.get('sightings') or []
    if not funn_liste:
        sys.exit('Fant ingen funn de siste 30 dagene.')
    print(f'      {len(funn_liste)} funn funnet.')

    if args.sighting_id:
        valgt = next((f for f in funn_liste
                      if str(f.get('sightingId')) == str(args.sighting_id)), None)
        if not valgt:
            sys.exit(f'Funn {args.sighting_id} er ikke blant dine siste 30 dager.')
    else:
        # Et funn du selv har rapportert — bare da tillater AO redigering.
        valgt = next((f for f in funn_liste if f.get('isReporter')), None)
        if not valgt:
            sys.exit('Fant ingen funn du selv har rapportert.')

    sid = valgt['sightingId']
    print(f'      Valgt: {sid} — {valgt.get("species")} × {valgt.get("count")}, '
          f'{valgt.get("activity")}, {valgt.get("place")}')

    # --- Åpne skjemaet --------------------------------------------------
    print(f'\n[2/4] Åpner /api/ao-sighting-form for {sid} …')
    print('      ⚠️  Funnet blir UPUBLISERT nå.')
    form = post('/api/ao-sighting-form', {**cred, 'sightingId': sid})

    if not form.get('ok'):
        if form.get('queueNotEmpty'):
            sys.exit(f'      AVVIST (som den skal): {form.get("error")}')
        sys.exit(f'      FEIL: {form.get("error")!r}')

    print(f'      ok. unpublished={form.get("unpublished")} '
          f'antall={form.get("quantity")!r} '
          f'aktivitet-id={form.get("activityId")!r} '
          f'aktiviteter={len(form.get("activityOptions") or [])} '
          f'skjema={len(form.get("formHtml") or "") // 1024} KB')

    opprinnelig = form.get('quantity')

    try:
        if args.sett_antall is None:
            # --- Trygg vei: angre ---------------------------------------
            print(f'\n[3/4] Angrer med /api/ao-sighting-abort …')
            ab = post('/api/ao-sighting-abort', {**cred, 'sightingId': sid})
            print(f'      {ab}')
            if not ab.get('ok'):
                sys.exit('      ABORT FEILET — sjekk «Kontrollér funn» hos AO!')
            print('\n[4/4] Ferdig. Ingenting ble endret.')
            return

        # --- Ekte endring -----------------------------------------------
        print(f'\n[3/4] Lagrer: antall {opprinnelig} → {args.sett_antall} …')
        res = post('/api/ao-sighting-save', {
            **cred, 'sightingId': sid,
            'formHtml': form['formHtml'],
            'funn': form['funn'],
            'endringer': {'quantity': str(args.sett_antall)},
        })
        print(f'      ok={res.get("ok")} bekreftet={res.get("bekreftet")}')
        if res.get('avvik'):
            print(f'      avvik: {res["avvik"]}')
        if res.get('ao'):
            print(f'      AO sier: {kort(res["ao"], ["Quantity","ActivityName","TaxonId","UnitName","StageName"])}')
        if not res.get('ok'):
            sys.exit(f'      LAGRING FEILET: {res.get("error")!r}')
        if res.get('bekreftet') is False:
            sys.exit('      ❌ AO BEKREFTET IKKE endringen — se avvik over.')
        if res.get('bekreftet') is None:
            print('      ⚠️  Kunne ikke bekrefte (nettverk?). Sjekk manuelt.')
        else:
            print('      ✅ AO bekrefter endringen.')
    finally:
        if args.sett_antall is not None and args.tilbakestill and opprinnelig:
            print(f'\n[4/4] Setter antall tilbake til {opprinnelig} …')
            f2 = post('/api/ao-sighting-form', {**cred, 'sightingId': sid})
            if f2.get('ok'):
                r2 = post('/api/ao-sighting-save', {
                    **cred, 'sightingId': sid,
                    'formHtml': f2['formHtml'], 'funn': f2['funn'],
                    'endringer': {'quantity': str(opprinnelig)}})
                print(f'      bekreftet={r2.get("bekreftet")} '
                      f'antall={(r2.get("ao") or {}).get("Quantity")!r}')
            else:
                print(f'      Klarte ikke åpne for tilbakestilling: {f2.get("error")!r}')
                print(f'      Sett antallet tilbake til {opprinnelig} manuelt hos AO.')


if __name__ == '__main__':
    main()
