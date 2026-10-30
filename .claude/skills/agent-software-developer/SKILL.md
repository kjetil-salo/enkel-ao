---
name: software-developer
description: Senior utvikler for enkel-ao — implementerer etter faset plan med code-review og kvalitetssikring. Bruk for alle ikke-trivielle kodeendringer i dette repoet.
user-invocable: true
argument-hint: "[oppgave]"
---

# Software Developer – enkel-ao

Implementer produksjonsklar kode etter en faset plan med innebygd kvalitetssikring.

Prosjektet er **enkel-ao** — Python 3.12 ThreadingHTTPServer, vanilla JS ES6-moduler, Docker på Raspberry Pi. Brukes på mobil i felt for fugleregistrering.

## Arbeidsprosess: Faset plan

**Alle ikke-trivielle oppgaver følger denne prosessen.** Enkle fikser (< 20 linjer, ett sted) kan gjøres direkte — men alltid etter å ha lest koden.

### Steg 1: Analyse og planlegging

1. Les og forstå all relevant eksisterende kode — aldri gjett på strukturen
2. Identifiser berøringspunkter og avhengigheter
3. Lag en faset plan i konversasjonen:
   - Klare faser (F1, F2, F3...)
   - Hva hver fase leverer
   - Akseptansekriterier per fase (testbare påstander)
   - Marker faser som krever SW cache-bump
   - Marker faser som krever staging-test
4. **Planen MÅ godkjennes av bruker** før implementering starter

### Steg 2: Implementer → review → test (per fase)

**For HVER fase, gjør disse delstegene i rekkefølge:**

**2a. Implementer fasen**
1. Implementer kun det fasen beskriver — ikke mer
2. Sjekk prosjektspesifikke krav:
   - Nye API-ruter: legg til i `do_GET`/`do_POST`-blokken i `server.py`
   - Ekstern API-kall: `except Exception as e: print(...); return graceful_response`
   - SQL: alltid parameterisert (`?`) — aldri f-strings i queries
   - Frontend-endringer: bump `VERSION` i `public/js/version.js`
   - Input-validering på serversiden — ikke stol på frontend
3. Kjør tester — alle MÅ bestå. **Prosjektet har tre suiter**, og `npm test`
   betyr ulike ting avhengig av hvor den kjøres fra:
   ```bash
   python3 -m pytest --maxfail=3   # backend
   npm test                        # vitest (tests/unit/) — FRA REPO-ROTEN
   cd tests/e2e_playwright && npm test   # Playwright, krever server på :3000
   ```
   Ved frontend-endringer: kjør minst pytest + vitest. Playwright-suiten har
   kjente, pre-eksisterende feil — sammenlign alltid mot samme suite FØR
   endringen, ikke mot «alt grønt».
4. Skriv nye tester hvis ny funksjonalitet ikke er dekket
5. Verifiser alle akseptansekriterier

**2b. Code review**
1. Spawn `/code-review`-skillen med de endrede filene som argument
2. Resultat: GODKJENT / BETINGET GODKJENT / AVVIST
3. Ved BETINGET/AVVIST: fiks og send til ny review
4. Ikke gå videre til neste fase før GODKJENT

**2c. Oppsummering**
- Huk av akseptansekriterier
- Dokumenter code-review-resultat og eventuelle funn
- Dokumenter avvik fra plan

**Gjenta 2a-2c for hver fase.**

### Steg 3: Integrasjon og avslutning

1. Verifiser at alle faser fungerer sammen
2. Sjekk for regresjoner i tilgrensende funksjonalitet
3. Full testkjøring: `python3 -m pytest --maxfail=3` og `npm test` fra repo-roten
4. Hvis frontend-endringer: bekreft at `VERSION` er bumped

## Kvalitetskrav

### Kode
- [ ] Ingen duplisering — DRY, men unngå prematur abstraksjon
- [ ] Eksterne API-feil gir graceful degradering — aldri 500
- [ ] Ingen over-engineering — enkleste løsning som oppfyller kravene
- [ ] Feilmeldinger til bruker avslører ikke intern tilstand
- [ ] Norske kommentarer og loggmeldinger

### Testing (OBLIGATORISK)
- [ ] Tester for all ny/endret funksjonalitet
- [ ] Tester kjøres og alle MÅ bestå
- [ ] Dekker: normalflyt, feilhåndtering, grenseverdier
- [ ] Backend-tester under `tests/test_*.py` (pytest)
- [ ] Frontend-tester under `tests/unit/*.test.js` (vitest, jsdom)

## Prosjektstruktur

```
server.py              — Handler-klasse, routing (do_GET/do_POST)
src/
  api_handlers.py      — Ekstern API-kommunikasjon (AO, Nominatim)
  ao_import.py         — CSV-generering for AO-import
  ao_import_httpx.py   — Direkteimport til AO (httpx + curl)
  ao_sightings.py      — Brukerens egne publiserte funn hos AO
  location_db.py       — SQLite-cache for AO-lokasjoner (~487k rader)
  share_store.py       — Delte observasjonslister (/d/<slug>)
  fellestur_store.py   — Fellestur: delt loggbok, synk-modell
  fellestur_peer.py    — Kryss-app-føderasjon for Fellestur
  feedback_store.py    — Brukertilbakemeldinger (saksnr AO-XXXXX)
  supabase_log.py      — Valgfri analytics
public/
  js/version.js        — appversjon (bump ved frontend-endringer)
  sw.js                — Service Worker: CACHE_NAME + STATIC_ASSETS
  js/observations.js   — Observasjonslogikk
  js/api.js            — API-kommunikasjon fra frontend
  css/1-tokens.css     — CSS-tokens (aldri hardkod hex-farger)
tests/
  test_*.py            — pytest-tester (backend)
  unit/*.test.js       — vitest-tester (frontend)
  e2e_playwright/      — Playwright E2E-tester
```

## Fallgruver i dette prosjektet

1. **Ekstern API som krasjer**: AO og Nominatim feiler — alltid `try/except` med graceful respons
2. **SW-bump glemmes**: Brukere sitter på gammel JS etter deploy. Versjon skal
   bumpes på FIRE steder, ikke ett: `public/js/version.js`, de tre inline
   `VERSION`-konstantene i `public/index.html`, `CACHE_NAME` i `public/sw.js`,
   og en linje i `public/changelog.html`. Se «Versjonering» i `CLAUDE.md`
3. **Cloudflare holder gammel JS i 4 timer**: en ny navngitt eksport i en modul
   som importeres med en bar `import ... from './x.js'` kan gi `SyntaxError` og
   en helt død side hos brukeren, selv om din lokale kopi er fersk. Legger du
   til en ny eksport andre moduler er avhengige av, må importen versjoneres
   (`./x.js?v=vX.Y.Z`) og bumpes. Dette har brutt staging minst to ganger
4. **Hardkodede farger i CSS**: Bruk alltid tokens fra `1-tokens.css`
5. **SQL-injeksjon i LocationDB**: Bruk alltid parameteriserte queries
6. **font-size < 16px på input**: iOS zoomer automatisk — setter 16px som minimum
7. **Supabase uten env-vars**: Koden MÅ fungere uten `SUPABASE_URL`/`SUPABASE_KEY`
8. **Pi-minne**: Ikke last store datasett i minnet under en request

## Levering

Denne skillen leverer **kode**, ikke en utrulling.

- Jobb på en egen branch — aldri commit direkte på `main`
- Norske commit-meldinger. **Aldri `Co-Authored-By`**
- Push branchen og åpne en PR med kort beskrivelse av hva som er endret og
  hvordan det er testet
- **Ikke kjør deploy-skriptene** (`update-ao-pi.sh`, `deploy-staging-pi.sh`,
  `update-app.sh`). Utrulling til staging og produksjon gjøres av
  repo-eieren — de krever tilgang til infrastruktur som ikke ligger i dette
  repoet
- Trenger endringen verifisering i et ekte miljø, si det i PR-en i stedet for
  å prøve å rulle den ut selv

## Mal: Akseptansekriterier per fase

```markdown
## F1: [fasenavn]
**Leverer:** [kort beskrivelse]
**Filer:** [berørte filer]
**Akseptansekriterier:**
- [ ] [testbar påstand 1]
- [ ] [testbar påstand 2]
**Krever SW-bump:** ja/nei
**Krever staging-test:** ja/nei
**Code-review:** [GODKJENT / BETINGET → GODKJENT etter fiks]
```
