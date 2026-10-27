#!/usr/bin/env python3
"""
No-op round-trip mot AOs redigeringsskjema — prosjektets sikkerhetsport.

Åpner ett publisert funn, bygger Save-bodyen med `ao_edit.bygg_save_body()` UTEN
endringer, lagrer, publiserer tilbake, og sammenligner funnet før og etter felt
for felt. Er noe ulikt, er `ao_edit` ikke trygg å bygge en endringsside på.

Dette er milepælen `docs/rediger-sendte-obs-plan.md` og
`docs/ao-mine-funn-api.md` punkt 3b krever grønn FØR ett eneste felt endres.

Bruk:
    python3 tools/ao_noop_roundtrip.py --sighting-id 42030658 --dry-run
    python3 tools/ao_noop_roundtrip.py --sighting-id 42030658 --skriv

`--dry-run` (standard) åpner skjemaet, bygger bodyen og viser hva som VILLE blitt
sendt — uten å poste til Save. Funnet blir likevel midlertidig upublisert, fordi
det å åpne skjemaet er nok; skriptet publiserer det tilbake.

Legitimasjon, i prioritert rekkefølge:

  1. `AO_LOGIN_TOKEN` + `AO_AUTH_COOKIE` fra `.env` (som alt ligger der). Ingen
     passord involvert. Er `.ASPXAUTHNO` utløpt, fornyes den automatisk via
     logintoken — den varer rundt et år.
  2. `AO_USERNAME` + `AO_PASSWORD` i miljøet.
  3. Ingenting satt → skriptet spør om brukernavn og passord interaktivt
     (`getpass`, så passordet vises ikke og havner ikke i shell-historikken).
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import ao_edit  # noqa: E402
from src.ao_edit import AoEditError  # noqa: E402

# Feltene som bærer funnets innhold. Disse MÅ være identiske etter et no-op.
SAMMENLIGN = [
    ('TaxonId', 'art'),
    ('Quantity', 'antall'),
    ('ActivityName', 'aktivitet'),
    ('UniversalDate', 'dato'),
    ('FormattedTime', 'tid'),
    ('SiteId', 'lokalitet-id'),
    ('StageName', 'stadium'),
    ('GenderName', 'kjønn'),
    ('UnitName', 'enhet'),
    ('PublicComment', 'offentlig kommentar'),
    ('PrivateComment', 'privat kommentar'),
    ('DiscoveryMethodName', 'funnmetode'),
    ('ValidationStatusLabel', 'valideringsstatus'),
]


def _les_env_fil(sti='.env'):
    """Les enkle KEY=VALUE-linjer fra .env uten å kreve python-dotenv."""
    if not os.path.exists(sti):
        return {}
    ut = {}
    with open(sti, encoding='utf-8') as f:
        for linje in f:
            linje = linje.strip()
            if not linje or linje.startswith('#') or '=' not in linje:
                continue
            nøkkel, _, verdi = linje.partition('=')
            ut[nøkkel.strip()] = verdi.strip().strip('"').strip("'")
    return ut


def _virker(login_token, auth_cookie):
    """Er sesjonen levende? Billig sjekk: svarer AO med en innlogget side?"""
    try:
        with ao_edit.ny_klient(login_token, auth_cookie) as client:
            resp = client.get(f'{ao_edit.AO_BASE}/ReviewSighting',
                              follow_redirects=True, timeout=20)
            return resp.status_code == 200 and 'LogOff' in resp.text
    except Exception:
        return False


def _logg_inn():
    """
    Skaff (login_token, auth_cookie) med minst mulig bruk av passord.

    Rekkefølgen er bevisst: tokens fra .env først, så miljøvariabler, så et
    interaktivt spørsmål. Et passord på kommandolinja havner i shell-historikken,
    og et passord i .env ligger der for alltid — tokens er både tryggere og nok.
    """
    env = {**_les_env_fil(), **os.environ}

    # 1) Tokens vi alt har
    token = env.get('AO_LOGIN_TOKEN')
    auth = env.get('AO_AUTH_COOKIE')
    if token and auth:
        if _virker(token, auth):
            print('Bruker AO_LOGIN_TOKEN + AO_AUTH_COOKIE (sesjonen er levende).')
            return token, auth
        # .ASPXAUTHNO har kort levetid; logintoken varer rundt et år. Prøv å fornye.
        print('Lagret auth-cookie er utløpt. Fornyer via logintoken…')
        try:
            from src.api_handlers import _refresh_with_logintoken
            ny = _refresh_with_logintoken(token, env.get('AO_USER_ID') or '')
        except Exception as exc:
            ny = None
            print(f'  fornyelse feilet: {exc}')
        if ny and _virker(token, ny):
            print('  fornyet. Oppdater gjerne AO_AUTH_COOKIE i .env til:')
            print(f'  AO_AUTH_COOKIE={ny}')
            return token, ny
        print('  klarte ikke fornye — faller tilbake til innlogging.')

    # 2) Brukernavn/passord fra miljøet
    brukernavn = env.get('AO_USERNAME')
    passord = env.get('AO_PASSWORD')

    # 3) Spør interaktivt. getpass holder passordet ute av historikk og terminalekko.
    if not brukernavn or not passord:
        if not sys.stdin.isatty():
            sys.exit('Ingen brukbar legitimasjon. Sett AO_LOGIN_TOKEN + AO_AUTH_COOKIE '
                     'i .env, eller AO_USERNAME + AO_PASSWORD i miljøet.')
        import getpass
        print('Ingen gyldige tokens funnet. Logger inn med brukernavn/passord.')
        print('(Verdiene lagres ikke noe sted av dette skriptet.)')
        brukernavn = brukernavn or input('AO-brukernavn: ').strip()
        passord = passord or getpass.getpass('AO-passord: ')
    if not brukernavn or not passord:
        sys.exit('Avbrutt — ingen legitimasjon oppgitt.')

    from src.api_handlers import login_to_ao
    try:
        res = login_to_ao(brukernavn, passord)
    except Exception as exc:
        sys.exit(f'Innlogging mot AO feilet: {exc}')
    token, auth = res.get('loginToken'), res.get('authCookie')
    if not token or not auth:
        sys.exit('Innlogging mot AO ga ingen tokens.')
    print('Innlogget. Vil du slippe dette neste gang, legg i .env:')
    print(f'  AO_LOGIN_TOKEN={token}')
    print(f'  AO_AUTH_COOKIE={auth}')
    return token, auth


def _hent_funn(login_token, auth_cookie, sighting_id):
    """Hent funnets rad fra AOs grid, slik vi ser den både før og etter."""
    from src import ao_sightings
    data = ao_sightings.fetch_my_sightings(login_token, auth_cookie, days=60, limit=200)
    for rad in data.get('sightings', []):
        if str(rad.get('sightingId')) == str(sighting_id):
            return rad
    return None


def _raa_rad(login_token, auth_cookie, sighting_id):
    """
    Hent den UBEARBEIDEDE grid-raden — ikke `normalize_row`-utgaven.

    Sammenligningen må skje på AOs egne felt, ikke på vår normaliserte visning.
    Normaliseringen kaster bort nettopp de feltene som ville avslørt et tap
    (Stage, Gender, Unit, DiscoveryMethod).
    """
    from src import ao_sightings
    with ao_sightings.httpx.Client(
            cookies=ao_sightings._cookies(login_token, auth_cookie),
            timeout=30) as client:
        stored, total = ao_sightings._create_stored_search(client, 60)
        if not stored:
            sys.exit('Fant ikke funn-lista hos AO.')
        side = 1
        while True:
            rader, _ = ao_sightings._fetch_grid_page(client, stored, total, side, 50)
            if not rader:
                return None
            for rad in rader:
                if rad.get('SightingId') == int(sighting_id):
                    return rad
            if len(rader) < 50 or side >= 20:
                return None
            side += 1


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--sighting-id', required=True, type=int)
    p.add_argument('--skriv', action='store_true',
                   help='Post faktisk til /ReviewSighting/Save. Uten denne: dry-run.')
    args = p.parse_args()

    sid = args.sighting_id
    token, auth = _logg_inn()
    print(f'Innlogget. Testfunn: {sid}')

    foer = _raa_rad(token, auth, sid)
    if not foer:
        sys.exit(f'Fant ikke funn {sid} blant brukerens egne publiserte funn.')
    print(f'  art={foer.get("TaxonId")} antall={foer.get("Quantity")!r} '
          f'aktivitet={foer.get("ActivityName")!r} dato={foer.get("UniversalDate")}')

    with ao_edit.ny_klient(token, auth) as client:
        # Porten: køen MÅ være tom, ellers blir målingen feil og publiseringen
        # tilbake kan dra med andres ventende funn.
        rader = ao_edit.ko_rader(client)
        if rader:
            sys.exit(f'AVBRYTER: gjennomgangskøen har {len(rader)} funn fra før. '
                     'Publiser eller rydd dem først — ellers blir skjemaet et kort '
                     '34 KB-skjema, og publiseringen tilbake treffer feil funn.')
        print('Kø er tom. Åpner skjemaet (funnet blir midlertidig upublisert)…')

        try:
            html = ao_edit.aapne_skjema(client, sid)
            print(f'  skjema: {len(html) // 1024} KB')

            funn = {
                'taxon_id': str(foer.get('TaxonId')),
                'dato': _dato_til_no(foer.get('UniversalDate')),
                'site_id': str(foer.get('SiteId')),
                'site_name': ao_edit_site_name(foer),
                'activity_navn': foer.get('ActivityName'),
            }
            body = ao_edit.bygg_save_body(html, funn)
            print(f'  bygget body: {len(body)} entries '
                  f'({len({n for n, _ in body})} unike navn)')

            if not args.skriv:
                print('\nDRY-RUN — poster IKKE til Save. Publiserer funnet tilbake.')
                ao_edit.publiser_tilbake(client, sid)
                print('Funnet er publisert tilbake.')
                _rapporter(token, auth, sid, foer)
                return

            print('Poster til /ReviewSighting/Save…')
            ao_edit.lagre(client, body)
            temp_id = ao_edit.temp_id_for(client, sid)
            if temp_id is None:
                sys.exit('FEIL: funnet ligger ikke i køen etter Save. '
                         'Sjekk AO manuelt før du gjør noe mer.')
            print(f'  lagret, TemporarySightingId={temp_id}. Publiserer…')
            ao_edit.publiser(client, [temp_id])

        except Exception as exc:
            print(f'\nFEIL: {exc}', file=sys.stderr)
            print('Forsøker å publisere funnet tilbake…', file=sys.stderr)
            try:
                if ao_edit.publiser_tilbake(client, sid):
                    print('Funnet er publisert tilbake.', file=sys.stderr)
                else:
                    print('Funnet lå ikke i køen.', file=sys.stderr)
            except Exception as exc2:
                print(f'KRITISK: klarte ikke publisere tilbake: {exc2}\n'
                      f'Funn {sid} kan ligge UPUBLISERT. Sjekk '
                      f'https://www.artsobservasjoner.no/ReviewSighting',
                      file=sys.stderr)
            raise

        rester = ao_edit.ko_rader(client)
        if rester:
            print(f'ADVARSEL: {len(rester)} funn ligger fortsatt i køen.')
        else:
            print('Kø er tom igjen.')

    _rapporter(token, auth, sid, foer)


def ao_edit_site_name(rad):
    from src.ao_sightings import _strip_html
    return _strip_html(rad.get('SiteName'))


def _dato_til_no(iso):
    """`2026-10-25` → `25.10.2026`, formatet AOs skjema bruker."""
    if not iso or len(iso) < 10:
        return iso
    aar, mnd, dag = iso[:10].split('-')
    return f'{dag}.{mnd}.{aar}'


def _rapporter(token, auth, sid, foer):
    print('\nHenter funnet på nytt for sammenligning…')
    etter = _raa_rad(token, auth, sid)
    if not etter:
        sys.exit('FEIL: finner ikke funnet etter operasjonen.')

    avvik = []
    for felt, navn in SAMMENLIGN:
        a, b = foer.get(felt), etter.get(felt)
        if a != b:
            avvik.append(f'  {navn} ({felt}): {a!r} → {b!r}')

    print()
    if avvik:
        print('❌ NO-OP ROUND-TRIP FEILET — funnet er endret:')
        for rad in avvik:
            print(rad)
        print('\nIkke bygg endringssiden på dette. Rett `ao_edit` først.')
        sys.exit(1)

    print(f'✅ NO-OP ROUND-TRIP GRØNN — {len(SAMMENLIGN)} felt uendret.')


if __name__ == '__main__':
    main()
