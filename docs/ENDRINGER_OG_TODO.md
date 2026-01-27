# Endringer og TODO

## ✅ Gjennomførte forbedringer (nyeste)

### 🎨 UI/UX Forbedringer
- **Visuell seksjonering**: Tydelige bokser skiller obligatoriske og valgfrie felt
- **Korrekt visuelt hierarki**: Grønne bokser for obligatoriske felt, grå for valgfrie
- **Forbedret gruppering**: Lokasjon, observasjon (obligatorisk), og tilleggsinfo (valgfritt)
- **Responsiv design**: Mindre padding og bedre mobile tilpasninger
- **Valgt art flash-effekt**: Flash-animasjonen på valgt art ("chosen") er nå svært subtil og dempet, slik at fokus ikke tas bort fra antall-feltet ved registrering.

### 🔧 Tekniske forbedringer
- **Valgfri Supabase**: App fungerer uten Supabase-credentials (in-memory modus)
- **Miljøvariabel-deteksjon**: Automatisk fallback til in-memory hvis `SUPABASE_URL`/`SUPABASE_KEY` mangler
- **Forbedret portabilitet**: Kan kjøres i GitHub Codespaces og andre miljøer uten eksterne avhengigheter
- **Staging/Production setup**: Separate miljøer med `enkel-ao-staging` og `enkel-ao`
  - `./update-app.sh staging` → https://enkel-ao-staging.fly.dev
  - `./update-app.sh production` → https://enkel-ao.fly.dev
  - Staging branch for testing før produksjon


  ### Siste endringer (ikke tagget)
  - **Refaktorert main.js**: Splittet fra 919 til 306 linjer ved å ekstrahere 4 nye moduler:
    - `form-state.js` — progressiv aktivering av skjemafelter
    - `species-search.js` — artssøk, resultatvisning og artsvalg
    - `observation-commit.js` — validering, lagring og aktivitets-pills
    - `export-operations.js` — CSV-eksport, kopiering og sletting
  - **Delt tilstand**: All mutable state samlet i `appState`-objekt, DOM-referanser i `dom`-objekt
  - **Fikset 3 E2E-tester**: Oppdatert tittel-sjekk og erstattet manglende `#chosen` med `#search.species-selected`
  - **Offline fallback-bugfiks**: Rettet feil der artsnavn viste "(ukjent navn)" ved offline fallback (`s.norwegian` → `s.taxonName`)
  - **Lenke til innstillinger**: Ved timeout og offline fallback vises klikkbar lenke til ⚙️ Innstillinger
  - **Forbedret service worker (v42)**: Nye moduler og `norske_arter.json` caches. 5s timeout på nettverkskall forhindrer at appen henger når server er nede
  - **Valgt art vises i søkefeltet**: Når du velger en art, vises navnet nå direkte i søkefeltet (ikke som separat "pill").
  - **Marker all tekst ved klikk**: Når det står en valgt art i søkefeltet, markeres hele teksten automatisk ved klikk (for rask overskriving).
  - **Kompakt layout for iPad**: Mindre vertikal padding og gap for bedre oversikt på store nettbrett.
  - **Aktivitets-pills klikkbare i offline-modus**: Nå kan du velge aktivitet med pills også når du er offline.
  - **Offline underarter**: Underarter er deaktivert i offline-modus. Brukeren får en tydelig, men diskret advarsel med gult ikon under boksen. Dette er for å sikre at eksporten alltid matcher AO sitt importformat og for å unngå feil navn.
  - **Redigerings-side**: `public/edit.html` tilgjengelig for å endre eksisterende observasjoner (art, antall, aktivitet, alder, kjønn, sted, kommentar).
  - **CSV-oppdatering**: Kommentarer mappes til kolonne 15 i eksportformatet (AO-kompatibelt felt "Kommentar (synlig for alle)").
  - **Brukervurdering**: Se [docs/brukervurdering.md](docs/brukervurdering.md) for fersk vurdering av styrker, svakheter og forslag.


### 📈 Statistikkmuligheter
- **Supabase-statistikk**: Fullstendig historikk når miljøvariabler er konfigurert
- **In-memory fallback**: Øktbasert statistikk når Supabase ikke er tilgjengelig
- **Automatisk deteksjon**: Ingen konfigurasjon nødvendig - fungerer i begge moduser

## Tidligere versjoner

### v1.3.0 (13. januar 2026)

#### ✨ Nye funksjoner implementert:
- **Avanserte felter**: Lagt til alder og kjønn som valgfrie felter med checkbox-toggle
  - Alder: Komplett dropdown med AO-kompatible verdier (Egg, Pulli, 1K, 1K+, osv.)
  - Kjønn: Dropdown med AO-verdier (Hann, Hunn, Hunnfarget, I par)
- **Ny registreringsknapp**: Stor grønn knapp under alle felter
- **Utvidet CSV-eksport**: Alder og kjønn inkluderes for AO-import
- **Forbedret observasjonsvisning**: Ny "Detaljer"-kolonne

#### 🐛 Feilrettinger:
- Fikset JavaScript-feil som hindret "Hent lokalitet"-funksjonen
- Fjernet duplikat variabel-deklarasjoner

### 🎨 UI/UX Analyse (v1.4.0 grunnlag)

#### Sterke sider:
- ✅ Mørkt tema - moderne og øyenskånsomt
- ✅ Mobile-first - godt tilpasset mobilbruk med 16px font-size  
- ✅ Tydelige ikoner - 🕊️, 📍, osv.
- ✅ Responsiv layout

#### 🚨 Kritiske UX-problemer som ble løst:

**1. Forvirrende registreringsflyt:**
- ✅ Fjernet stor registreringsknapp, bruker inline ✓-knapp
- ✅ Forenklede flyt med tilbake til original design

**2. Visuell hierarki manglende:**
- ✅ Implementerte seksjonering med grønne/grå bokser
- ✅ Tydelig skille mellom obligatoriske og valgfrie felt

**3. Avanserte felter lite synlige:**
- ✅ Alder/kjønn alltid synlige (ikke skjult bak checkbox)
- ✅ Tydelige seksjoner viser hva som er obligatorisk/valgfritt

**4. Overveldende dropdown-lister:**
- ✅ Fortsatt mange valg, men nå tydelig markert som "tilleggsinfo"
- ✅ Visuell separasjon gjør det mindre overveldende

## 📋 TODO fremover (prioritert)

### 🔴 Høy prioritet

#### Tekniske forbedringer:
- ✅ **Forbedret feilhåndtering**: Offline fallback med lenke til innstillinger, SW timeout
- **Bedre meldingstekster ved AO-feil**: Vurdere om "offline" er riktig begrep når appen fungerer men AO ikke svarer. Kan testes med unit-tester (mock `searchSpecies` til å kaste feil).

#### Mobile forbedringer:
- ~~**"Chosen species" bug**~~: Løst — valgt art vises nå i søkefeltet, ikke som separat element

### 🟡 Middels prioritet

#### UX-forbedringer:
- **Performance optimaliseringer**: Raskere artsøk og lokalitetshenting
- **Optimaliser dropdown-design**: Grupper alder-valg logisk (Egg | Ungfugl: 1K-serie | Voksen: Adult)
- **Lyst/mørkt tema**: Implementere theme-switching for alle sider (index, hjelp, stats)
  - Toggle-knapp for å bytte mellom lyst og mørkt tema
  - Lagre brukerens preferanse i localStorage

#### Tekniske oppgaver:
- **OpenSSL warnings**: Fikse urllib3/OpenSSL-advarsel i Python-miljø (lav prioritet)

### 🟢 Lav prioritet

#### Funksjonalitet:
- **Backup/export**: Eksporter hele observasjonshistorikken
- **Ytterligere Supabase-funksjoner**: Bruke Supabase til mer enn bare statistikk

---

## Miljøvariabler og portabilitet

### Supabase (valgfritt)
Appen fungerer perfekt uten Supabase-konfigurasjon og faller tilbake til in-memory statistikk:
- `SUPABASE_URL` - for full statistikk-lagring
- `SUPABASE_KEY` - for autentisering mot Supabase

### Andre miljøvariabler:
- `PORT` (default: 3000)
- `NOMINATIM_URL` (override for testing - default: OpenStreetMap)
- `STATS_KEY` (for statistikk-side, default: 'salo')

Sist oppdatert: 27.01.2026
