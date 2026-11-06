#!/usr/bin/env python3
"""
Hent gruppe-takson (familier, ordener og «ub.»-takson) fra Artsobservasjoner
og legg dem inn i public/data/norske_arter.json, merket med erGruppe=True.

    python3 tools/sync_species_groups.py --dry-run   # vis hva som ville skjedd
    python3 tools/sync_species_groups.py             # skriv fila

HVORFOR DETTE FINNES
Den lokale artslista er generert fra Norgeslisten og har bare art og underart.
Søker du «måke» hos oss, får du gråmåke, fiskemåke og hettemåke — men ikke
«måkefamilien», og heller ikke «ub. stormmåke/gråmåke». Fikk du ikke
artsbestemt fuglen, finnes ikke valget. AO tillater å rapportere på gruppenivå,
så muligheten er reell; den er bare usynlig hos oss.

Den som ALLEREDE vet at gruppene finnes, kommer til dem i dag ved å skrive nok
til at lokallista bommer («måkefam» gir 0 lokale treff, og da spørres AO). Det
denne synken løser er oppdagelsen: ser du «måkefamilien» nederst i lista den
dagen du trenger den, har du lært noe appen ellers aldri forteller.

HVORFOR ET VERKTØY OG IKKE ET API-KALL
Samme begrunnelse som sync_species.py: gruppene er like for alle brukere og
endrer seg omtrent aldri. De hentes én gang her og følger med i docker-imaget,
framfor ett AO-kall per bruker per tastetrykk. Kadens: ved behov — en ny
fuglefamilie i Norge er ikke en årlig hendelse.

HVORFOR SØKEORD OG IKKE ET TAKSONOMI-ENDEPUNKT
AO har ikke et endepunkt som lister gruppene; /Taxon/PickerSearch er et
søkefelt. Derfor søkes det på etterleddene i de norske artsnavnene vi allerede
har («måke», «meis», «trost» …) — norske fuglefamilier heter nettopp etter
etterleddet sitt (måkefamilien, meisefamilien). Etterleddene utledes fra
artslista, så lista holder seg selv oppdatert.

AO-ETIKK
Ett kall per søkeord med pause mellom, og søkeordene er avledet, ikke
uttømmende alfabetsøk. Typisk 30-40 kall for en full kjøring, én gang.
"""

import argparse
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.api_handlers import handle_species_search

SPECIES_JSON_PATH = Path(__file__).resolve().parent.parent / 'public' / 'data' / 'norske_arter.json'

# Pause mellom AO-kall. Vi er gjest hos et offentlig API.
PAUSE_SEKUNDER = 1.0

# Hvor mange av de vanligste etterleddene vi søker på. Halen er lang og tynn:
# etterledd som bare én art har (f.eks. «konge» i fuglekonge) gir ingen familie.
ANTALL_ETTERLEDD = 30

# «ub.» henter alle ubestemt-takson i ett. Uten punktum, fordi AO-søket
# returnerte flere treff da (107 mot 47) — punktumet ser ut til å snevre inn.
EKSTRA_SØKEORD = ['ub']


def er_gruppe(navn: str) -> bool:
    """
    Er dette et gruppe-takson og ikke en art?

    AOs eget `leaf`-felt kan IKKE brukes til dette. Det betyr «har underliggende
    takson», så helt vanlige arter med underarter er merket leaf=false («skjære
    — Pica pica»), mens noen ub.-takson er leaf=true. Navnet er den pålitelige
    kilden:

      - «... familien»   → familie (måkefamilien, meisefamilien)
      - «...fugler»      → orden (andefugler, vade-, måke- og alkefugler)
      - «ub. ...»        → ubestemt takson, det en feltobservatør faktisk
                           rapporterer når arten ikke lot seg bestemme

    Rene slektsnavn uten norsk navn («Mareca») er bevisst UTE: de sier ingenting
    til en norsk bruker, og ville bare fylt opp bunnen av lista.
    """
    n = (navn or '').strip().lower()
    if not n:
        return False
    if n.startswith('ub. ') or n.startswith('ub.'):
        return True
    if 'familien' in n:
        return True
    if n.endswith('fugler'):
        return True
    return False


def finn_etterledd(arter: list, antall: int) -> list:
    """
    De vanligste etterleddene i de norske artsnavnene.

    «gråmåke», «fiskemåke» og «hettemåke» ender alle på «måke», og det er
    nettopp det ordet familien heter etter (måkefamilien). AO prefiks-matcher,
    så søkeordet må være HELE etterleddet: «åke» treffer ikke «måkefamilien».

    Ordgrensen finnes uten ordliste, ved å utvide suffikset så lenge det ikke
    koster treff: «åke» og «måke» deles av de samme 10 artene, mens «åmåke»
    bare deles av 2. Der antallet stuper, går ordgrensen — og «måke» er det
    lengste suffikset som fortsatt beskriver hele gruppa.
    """
    teller = Counter()
    for art in arter:
        navn = (art.get('norwegian') or art.get('nameNob') or '').strip().lower()
        if not navn or ' ' in navn or '-' in navn:
            continue
        for lengde in range(3, 9):
            if len(navn) > lengde:
                teller[navn[-lengde:]] += 1

    # Utvid hvert suffiks så langt det ikke koster nevneverdig. Terskelen er
    # 80 %, ikke 100 %: «åke» deles av ti arter og «måke» av ni (bokfinken
    # «bokfink» og slike gir av og til én avviker), og da er «måke» likevel det
    # riktige ordet. Faller antallet under terskelen, har vi krysset ordgrensen.
    def lengst_uten_tap(s: str) -> str:
        beste = s
        endret = True
        while endret:
            endret = False
            for kandidat, n in teller.items():
                if (len(kandidat) == len(beste) + 1 and kandidat.endswith(beste)
                        and n >= teller[s] * 0.8):
                    beste = kandidat
                    endret = True
                    break
        return beste

    # Bare etterledd som deles av flere arter — en gruppe med én art er ingen gruppe.
    utvidet = Counter()
    for ord_, n in teller.items():
        if n < 3:
            continue
        utvidet[lengst_uten_tap(ord_)] = n

    # Et etterledd som ender på et annet valgt etterledd er samme gruppe
    # («esnipe» og «snipe»). Behold det flest arter deler.
    kandidater = sorted(utvidet, key=lambda o: (-utvidet[o], len(o)))
    valgt = []
    for ord_ in kandidater:
        if any(ord_.endswith(v) for v in valgt):
            continue
        valgt.append(ord_)
        if len(valgt) >= antall:
            break
    return valgt


def hent_grupper(søkeord: list, verbose: bool = True) -> dict:
    """Søk AO for hvert ord og samle gruppe-takson, nøklet på taxonId."""
    funnet = {}
    for i, ord_ in enumerate(søkeord, 1):
        try:
            treff = handle_species_search(ord_)
        except Exception as e:
            print(f'  ! «{ord_}» feilet: {e}', file=sys.stderr)
            continue
        nye = 0
        for t in treff:
            navn = t.get('taxonName') or ''
            tid = t.get('taxonId')
            if not tid or not er_gruppe(navn):
                continue
            if tid not in funnet:
                funnet[tid] = {
                    'taxonId': str(tid),
                    'taxonName': navn,
                    'latin': _strip_html(t.get('scientificNameHtml') or ''),
                }
                nye += 1
        if verbose:
            print(f'  [{i}/{len(søkeord)}] «{ord_}»: {len(treff)} treff, {nye} nye grupper')
        time.sleep(PAUSE_SEKUNDER)
    return funnet


def _strip_html(s: str) -> str:
    return re.sub(r'<[^>]+>', '', s).strip()


def til_artslisteform(gruppe: dict) -> dict:
    """
    Formen artslista bruker. Gruppene får samme felter som artene, så all
    eksisterende kode som leser lista fungerer uendret — pluss erGruppe, som
    sorteringen i species-matcher.js bruker til å legge dem nederst.

    antallFunn settes bevisst IKKE: gruppene rangeres ikke på hvor vanlige de
    er (det ville vært meningsløst — «ub. måke» er ikke en fugl man teller),
    og et tall her ville latt dem konkurrere med artene i sorteringen.
    """
    navn = gruppe['taxonName']
    return {
        'norwegian': navn,
        'latin': gruppe['latin'],
        'subspecies': [],
        'nynorsk': navn,
        'taxonId': gruppe['taxonId'],
        'nameNob': navn,
        'nameNno': navn,
        'latinName': gruppe['latin'],
        'erGruppe': True,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dry-run', action='store_true', help='ikke skriv fila, bare vis hva som ville endret seg')
    ap.add_argument('--etterledd', type=int, default=ANTALL_ETTERLEDD, metavar='N',
                    help=f'hvor mange etterledd å søke på (standard: {ANTALL_ETTERLEDD})')
    args = ap.parse_args()

    data = json.loads(SPECIES_JSON_PATH.read_text(encoding='utf-8'))
    arter = [x for x in data if not x.get('erGruppe')]
    eksisterende = {str(x.get('taxonId')) for x in data if x.get('erGruppe')}

    søkeord = finn_etterledd(arter, args.etterledd) + EKSTRA_SØKEORD
    print(f'{len(arter)} arter i lista. Søker på {len(søkeord)} ord '
          f'(~{len(søkeord) * PAUSE_SEKUNDER:.0f} sek):')
    print('  ' + ', '.join(søkeord))
    print()

    grupper = hent_grupper(søkeord)
    print(f'\n{len(grupper)} gruppe-takson funnet.')

    nye = {tid: g for tid, g in grupper.items() if tid not in eksisterende}
    print(f'{len(nye)} er nye.')
    for g in sorted(nye.values(), key=lambda g: g['taxonName'])[:50]:
        print(f"  + {g['taxonName']} — {g['latin']}")

    if args.dry_run:
        print('\n--dry-run: fila er ikke rørt.')
        return 0
    if not nye:
        print('\nIngenting nytt å skrive.')
        return 0

    # Artene først, gruppene bakerst i fila. Rekkefølgen i fila styrer ingenting
    # (sorteringen skjer i species-matcher.js), men den gjør diffen lesbar.
    beholdte_grupper = [x for x in data if x.get('erGruppe')]
    ut = arter + beholdte_grupper + [til_artslisteform(g) for g in
                                     sorted(nye.values(), key=lambda g: g['taxonName'])]
    SPECIES_JSON_PATH.write_text(json.dumps(ut, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'\nSkrevet: {len(ut)} elementer ({len(arter)} arter, '
          f'{len(ut) - len(arter)} grupper) → {SPECIES_JSON_PATH}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
