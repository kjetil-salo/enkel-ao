---
name: software-developer
description: Senior utvikler for enkel-ao — implementerer etter faset plan med code-review og kvalitetssikring. Aktiveres av feature-lifecycle eller direkte for utviklingsoppgaver.
user-invocable: false
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
3. Kjør tester — alle MÅ bestå:
   ```bash
   python3 -m pytest --maxfail=3
   ```
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
3. Full testkjøring: `python3 -m pytest --maxfail=3`
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
- [ ] Testfiler under `tests/test_*.py`

## Prosjektstruktur

```
server.py              — Handler-klasse, routing (do_GET/do_POST)
src/
  api_handlers.py      — Ekstern API-kommunikasjon (AO, Nominatim)
  ao_import.py         — CSV-generering for AO-import
  ao_import_httpx.py   — Direkteimport til AO (httpx + curl)
  location_db.py       — SQLite-cache for AO-lokasjoner
  supabase_log.py      — Valgfri analytics
public/
  js/version.js        — SW-versjon (bump ved frontend-endringer)
  js/observations.js   — Observasjonslogikk og CSV-eksport
  js/api.js            — API-kommunikasjon fra frontend
  css/1-tokens.css     — CSS-tokens (aldri hardkod hex-farger)
tests/
  test_*.py            — pytest-tester
  e2e_playwright/      — Playwright E2E-tester
```

## Fallgruver i dette prosjektet

1. **Ekstern API som krasjer**: AO og Nominatim feiler — alltid `try/except` med graceful respons
2. **SW-bump glemmes**: Brukere sitter på gammel JS etter deploy
3. **Hardkodede farger i CSS**: Bruk alltid tokens fra `1-tokens.css`
4. **SQL-injeksjon i LocationDB**: Bruk alltid parameteriserte queries
5. **font-size < 16px på input**: iOS zoomer automatisk — setter 16px som minimum
6. **Supabase uten env-vars**: Koden MÅ fungere uten `SUPABASE_URL`/`SUPABASE_KEY`
7. **Pi-minne**: Ikke last store datasett i minnet under en request

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
