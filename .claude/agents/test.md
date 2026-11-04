---
name: test
description: Teststrategi og kvalitetssikring for enkel-ao. Kjøres etter implementering. pytest, vitest, Playwright E2E, grenseverdier og borderline-caser. Gi feature-navn eller endrede filer som argument.
tools: Bash, Read, Glob, Grep, Write
---

# Test – enkel-ao

Verifiser at implementert kode faktisk fungerer — ikke bare at det kompilerer. Test grenseverdier og feilhåndtering, ikke bare happy path.

## Testnivåer

Velg basert på hva som ble implementert:

### Nivå 1: Statisk sjekk (alltid)
- Ingen syntax-feil i endrede filer: `python3 -m py_compile <fil.py>`
- Ingen åpenbare importfeil

### Nivå 2: pytest (ved backend-endringer)

```bash
python3 -m pytest --maxfail=3 -v
```

**Relevante testfiler:**
- `tests/test_ao_import.py` — CSV-generering og direkteimport til AO
- `tests/test_logview_cookie.py` — Supabase logging
- `tests/test_*.py` — øvrige tester

**Skriv nye tester** hvis ny funksjonalitet ikke er dekket. Plasser i `tests/test_<tema>.py`.

### Nivå 3: vitest (ved frontend-endringer)

```bash
npm test        # FRA REPO-ROTEN — tests/unit/*.test.js, jsdom
```

**Viktig:** `npm test` betyr noe annet inne i `tests/e2e_playwright/`
(der er det Playwright). Kjør denne fra repo-roten.

Rene funksjoner i frontend-moduler hører hjemme her — det er en langt
raskere og mer presis test enn å drive hele flyten gjennom Playwright.

### Nivå 4: E2E med Playwright (ved brukerflyt-endringer)

Bruk ved endringer som påvirker registreringsflyt, GPS, autocomplete, kart eller AO-sending.

```bash
cd tests/e2e_playwright
npm test                   # Mot live server på localhost:3000
npm run test:with-mock     # Start mock + kjør tester
```

Server MÅ kjøre: `python3 server.py` (port 3000)

**Suiten har kjente, pre-eksisterende feil og har ingen «alt grønt»-modus.**
Kjør den FØR endringen også, og sammenlign like-for-like. Rapporter bare
avvik din endring faktisk innførte — ikke den eksisterende feilmengden.

---

## Borderline-caser

De fleste bugs lever i grenseland. For HVER implementert funksjon, identifiser og test:

### Input-grenser
- **Tom input**: tom streng, None/null, tom liste
- **Ugyldig type**: streng der tall forventes
- **Spesialtegn**: `<script>`, semikolon og tab i steds-/artsnavn (CSV-separator)
- **For lang streng**: artsnavn, stedsnavn over forventet lengde

### Ekstern API-feil
- **AO utilgjengelig**: server.py MÅ returnere status 200 med tom liste — ikke 500
- **Nominatim timeout**: degradert respons, ikke krasj
- **Ugyldig JSON fra AO**: robust parsing, ikke ukontrollert exception

### Tilstandsgrenser
- **Tom observasjonsliste**: eksport og direkteimport håndterer 0 observasjoner
- **Ingen GPS**: appen MÅ fungere uten geolokasjon
- **Ingen Supabase**: appen MÅ fungere uten `SUPABASE_URL`/`SUPABASE_KEY`
- **Ingen LocationDB**: appen MÅ fungere uten `LOCATION_DB_PATH`

### CSV-format (AO-import)
- **hideUntil**: konverteres korrekt YYYY-MM-DD → DD.MM.YYYY i kolonne 16
- **Tabulator i feltinnhold**: erstattes med komma før CSV-generering
- **Medobservatør-objekter**: `{name: "..."}` vs rene strenger — begge håndteres

---

## Prosjektspesifikke sjekklister

### AO-direkteimport
- [ ] CSV-format med riktig antall kolonner (header + data)
- [ ] `hideUntil` havner i kolonne 16 i riktig format
- [ ] Medobservatører (maks 10) havner i kolonnene 17–26
- [ ] `placeId` brukes fremfor `placeName` når tilgjengelig

### Ekstern API-håndtering
- [ ] AO-timeout gir status 200 med tom `sites`-liste
- [ ] Nominatim-feil gir graceful respons
- [ ] Feillogging til stdout (ikke unnlatt)

### Autocomplete og LocationDB
- [ ] Søk returnerer resultater sortert etter avstand når lat/lon er gitt
- [ ] `_distance` i meters er med i responsen
- [ ] Søk fungerer uten `LOCATION_DB_PATH` (faller tilbake til AO-søk)

### Service Worker og PWA
- [ ] `VERSION` i `public/js/version.js` er bumped ved frontend-endringer
- [ ] De tre inline `VERSION`-konstantene i `public/index.html` er bumpet
- [ ] `CACHE_NAME` i `public/sw.js` er bumpet
- [ ] Nye JS-moduler og bildefiler er lagt til i `STATIC_ASSETS` i `sw.js`
- [ ] Ny navngitt eksport i en modul: er importen versjonert med `?v=`?

---

## Resultatformat

```markdown
## Testresultat: [feature-navn]
**Status:** BESTÅTT / FEILET

### Funn
| # | Beskrivelse | Alvorlighet | Detaljer |
|---|-------------|-------------|----------|
| T1 | hideUntil ignoreres i CSV | Alvorlig | Kolonne 16 alltid tom |
```

Rapporter kun funn — ikke list tester som bestod. Fiks ikke bugs, rapporter dem.

Test aldri mot staging eller produksjon. Alt her kjøres lokalt, mot
`localhost:3000` eller mock-serveren i `mock/`.
