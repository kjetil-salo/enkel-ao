#!/usr/bin/env python3
"""
Røyktest av endringsendepunktene mot en kjørende server og ekte AO.

Tester kjeden frontend bruker:

    /api/ao-my-sightings      → finn et funn å teste på
    /api/ao-sighting-details  → rent lesende, åpner ALDRI AOs skjema
    /api/ao-sighting-save     → åpne + lagre + publiser + bekreft, i ett kall

Standard er en trygg test: lagrer med TOMME endringer. Det går likevel
gjennom hele kjeden (åpning, bygging av feltlista, publisering, bekreftelse
tilbake fra AO) uten å endre noe reelt — funnet blir aldri synlig upublisert
for brukeren, siden `/api/ao-sighting-save` gjør alt i ett serverkall.

    # 1) Start serveren i et annet vindu
    python3 server.py

    # 2) Trygg test — åpner, lagrer uendret, bekrefter
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


def lagre(cred, sid, endringer):
    """Ett kall: åpne + lagre + publiser + bekreft."""
    return post('/api/ao-sighting-save', {**cred, 'sightingId': sid, 'endringer': endringer})


def main():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--sighting-id', type=int,
                   help='Funn å teste på. Uten denne velges ditt nyeste uten bilde.')
    p.add_argument('--sett-antall', type=int,
                   help='Gjør en EKTE endring av antall. Uten denne: lagre uendret.')
    p.add_argument('--tilbakestill', action='store_true',
                   help='Sett antallet tilbake til opprinnelig verdi etterpå.')
    args = p.parse_args()

    token, auth = _logg_inn()
    cred = {'loginToken': token, 'authCookie': auth}

    # --- Finn et funn ---------------------------------------------------
    print(f'\n[1/3] Henter dine funn fra {BASE} …')
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

    # --- Les detaljer (rent lesende, funnet forblir publisert) ----------
    print(f'\n[2/3] Henter /api/ao-sighting-details for {sid} …')
    detaljer = post('/api/ao-sighting-details', {**cred, 'sightingId': sid})
    if not detaljer.get('ok'):
        sys.exit(f'      FEIL: {detaljer.get("error")!r}')

    funn = detaljer.get('funn') or {}
    print(f'      ok. antall={funn.get("quantity")!r} aktivitet={funn.get("activity_navn")!r} '
          f'alder={funn.get("age_navn")!r} kjønn={funn.get("gender_navn")!r}')
    opprinnelig = funn.get('quantity')

    # --- Lagre ------------------------------------------------------------
    endringer = {'quantity': str(args.sett_antall)} if args.sett_antall is not None else {}
    beskrivelse = (f'antall {opprinnelig} → {args.sett_antall}' if endringer
                   else 'ingen endring (trygg test)')
    print(f'\n[3/3] Lagrer via /api/ao-sighting-save: {beskrivelse} …')
    res = lagre(cred, sid, endringer)

    if res.get('queueNotEmpty'):
        sys.exit(f'      AVVIST (som den skal): {res.get("error")}')

    print(f'      ok={res.get("ok")} bekreftet={res.get("bekreftet")}')
    if res.get('avvik'):
        print(f'      avvik: {res["avvik"]}')
    if res.get('ao'):
        print(f'      AO sier: {kort(res["ao"], ["Quantity", "ActivityName", "TaxonId", "UnitName", "StageName", "GenderName"])}')
    if not res.get('ok'):
        sys.exit(f'      LAGRING FEILET: {res.get("error")!r}')
    if res.get('bekreftet') is False:
        sys.exit('      ❌ AO BEKREFTET IKKE endringen — se avvik over.')
    if res.get('bekreftet') is None:
        print('      ⚠️  Kunne ikke bekrefte (nettverk?). Sjekk manuelt.')
    else:
        print('      ✅ AO bekrefter endringen.' if endringer else '      ✅ Uendret, bekreftet.')

    if args.sett_antall is not None and args.tilbakestill and opprinnelig:
        print(f'\n[4/4] Setter antall tilbake til {opprinnelig} …')
        r2 = lagre(cred, sid, {'quantity': str(opprinnelig)})
        print(f'      bekreftet={r2.get("bekreftet")} '
              f'antall={(r2.get("ao") or {}).get("Quantity")!r}')


if __name__ == '__main__':
    main()
