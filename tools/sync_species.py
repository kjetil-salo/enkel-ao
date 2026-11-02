#!/usr/bin/env python3
"""
Oppdater public/data/norske_arter.json med ferske registreringstall (antallFunn)
fra Artsobservasjoner, og eventuelt manglende nynorsknavn fra Artsdatabanken.

Dette er et VERKTØY, ikke et API. Tallene er like for alle brukere, så de hentes
én gang her og følger med i docker-imaget — ikke én gang per bruker per enhet.
Samme mønster som tools/import_ao_locations.py.

    python3 tools/sync_species.py                 # kun antallFunn (3 AO-kall)
    python3 tools/sync_species.py --nynorsk 40    # + opptil 40 navneoppslag
    python3 tools/sync_species.py --dry-run       # vis hva som ville endret seg

Kadens: månedlig, eller før en release. Rekkefølgen mellom vanlige arter er
stabil over år — gråmåke passerer ikke gråtrost på to uker. Det som endrer seg
er at en streiffugl går fra 0 til 1 funn, og den havner nederst uansett.

MERK om --nynorsk: artene som mangler nynorsknavn er stort sett sjeldne
streiffugler (amerikasvartand, gråhodevipe, tundraspove ...) som Artsdatabanken
trolig ikke har noe foretrukket nn-NO-navn for i det hele tatt. Oppslagene gir
da ingenting, og det finnes ingen «prøvd, fantes ikke»-markør. Kjør med et høyt
tall én gang i stedet for et lavt tall ofte.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.species_sync import SPECIES_JSON_PATH, sync_species_data


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--nynorsk', type=int, default=0, metavar='N',
                    help='slå opp inntil N manglende nynorsknavn hos Artsdatabanken (standard: 0)')
    ap.add_argument('--dry-run', action='store_true',
                    help='ikke skriv fila, bare vis hva som ville endret seg')
    ap.add_argument('--json-path', type=Path, default=SPECIES_JSON_PATH,
                    help=f'artsfil som skal oppdateres (standard: {SPECIES_JSON_PATH})')
    args = ap.parse_args()

    før = {}
    if args.json_path.exists():
        for art in json.loads(args.json_path.read_text(encoding='utf-8')):
            nøkkel = (art.get('latin') or art.get('latinName') or '').lower()
            if nøkkel:
                før[nøkkel] = art.get('antallFunn', 0)

    print(f'Henter artsliste fra Artsobservasjoner …', flush=True)
    try:
        res = sync_species_data(
            json_path=args.json_path,
            enrich_missing_nynorsk=args.nynorsk > 0,
            max_adb_lookups=args.nynorsk,
            save_to_disk=not args.dry_run,
        )
    except Exception as e:
        print(f'FEIL: {e}', file=sys.stderr)
        return 1

    print(f'\n  {res["aoFetchedCount"]} taksa hentet fra AO')
    print(f'  {res["updatedCount"]} av {res["totalSpecies"]} arter fikk oppdatert antallFunn')
    if args.nynorsk:
        print(f'  {res["namesUpdated"]} nynorsknavn hentet fra Artsdatabanken')

    # Vis de største endringene, så det er synlig om noe ser galt ut. Leses fra
    # svaret, ikke fra fila — ellers hadde --dry-run alltid vist null endringer.
    endringer = []
    for nøkkel, art in res['overrides'].items():
        gammel = før.get(nøkkel)
        ny = art.get('antallFunn', 0)
        if gammel is not None and ny != gammel:
            endringer.append((ny - gammel, art.get('nameNob') or nøkkel, gammel, ny))
    if endringer:
        endringer.sort(key=lambda x: -abs(x[0]))
        print(f'\n  Største endringer ({len(endringer)} arter endret):')
        for diff, navn, gammel, ny in endringer[:10]:
            print(f'    {navn:<28} {gammel:>8} -> {ny:>8}  ({diff:+})')

    if args.dry_run:
        print('\n  --dry-run: ingenting skrevet.')
    else:
        print(f'\n  Skrevet til {args.json_path}')
        print('  Husk å committe fila og bumpe CACHE_NAME i public/sw.js.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
