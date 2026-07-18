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


### v1.13.0 (28. januar 2026)

#### 🔧 Refaktorering
- **Splittet main.js**: Fra 919 til 306 linjer ved å ekstrahere 4 nye moduler:
  - `form-state.js` — progressiv aktivering av skjemafelter
  - `species-search.js` — artssøk, resultatvisning og artsvalg
  - `observation-commit.js` — validering, lagring og aktivitets-pills
  - `export-operations.js` — CSV-eksport, kopiering og sletting
- **Delt tilstand**: All mutable state samlet i `appState`-objekt, DOM-referanser i `dom`-objekt
- **Unit-tester**: Nye tester for storage, location, api og species_offline
- **Fikset 3 E2E-tester**: Oppdatert tittel-sjekk og erstattet `#chosen` med `#search.species-selected`

#### 🛡️ Feilhåndtering og robusthet
- **Tre separate feilscenarioer**:
  - *Server nede*: "Ingen kontakt med server — bruker lokal artsliste — ⚙️ Innstillinger"
  - *AO nede*: "AO svarer ikke — bruker lokal artsliste — ⚙️ Innstillinger"
  - *Offline*: "Du er offline — bruker lokal artsliste — ⚙️ Innstillinger"
- **Status-rad**: Rød prikk med klikkbar lenke til innstillinger ved feil
- **Underarter deaktiveres** automatisk ved offline fallback
- **Service worker v43**: API-kall (`/api/`) går utenom SW-timeout, statiske filer har 5s timeout med cache-fallback
- **Offline artsliste**: Begrenset til 15 treff med forbedret sortering (startsWith prioriteres)

#### ⚙️ Konfigurasjon
- **Konfigurerbare AO-URLer**: `AO_URL` og `AO_MOBILE_URL` miljøvariabler for lokal testing med mock
- **Mock-server**: `mock/nominatim_app_timeout.py` for testing av timeout-scenarioer

#### 🎨 UI/UX
- **Større artsnavn**: Søkefelt 1.25rem, resultatliste 1.08rem, større søkeikon
- **Kompaktere layout**: Strammere padding i søkefelt og resultatliste, 6px border-radius
- **Kun sifre i antall-felt**: Blokkerer bokstaver, `e`, `.`, `+`, `-` på desktop
- **Grønn knapp på linje**: Aktivitetsknappen holder seg på samme linje som dropdown
- **Valgt art i søkefeltet**: Artsnavn vises direkte i feltet, markeres ved klikk
- **Kompakt iPad-layout**: Mindre vertikal padding og gap
- **Aktivitets-pills offline**: Klikkbare også i offline-modus
- **Offline underarter-advarsel**: Diskret gult ikon under boksen
- **Redigerings-side**: `public/edit.html` for å endre eksisterende observasjoner
- **CSV-kommentarer**: Mappes til kolonne 15 (AO-kompatibelt felt)

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
- ✅ **Forbedret feilhåndtering**: Tre separate meldinger for server nede, AO nede og offline. Status-rad med lenke til innstillinger. Underarter deaktiveres ved fallback. Mock-server for testing (`mock/nominatim_app_timeout.py`).

#### Mobile forbedringer:
- ~~**"Chosen species" bug**~~: Løst — valgt art vises nå i søkefeltet, ikke som separat element

### 🟡 Middels prioritet

#### UX-forbedringer:
- **Forkortelser på aktivitets-pills** (tips fra Espen): La aktivitets-hurtigknappene kunne vise et kort navn (maks ~5 tegn) i stedet for fullt navn. Motivasjon: kompakte pills → flere hurtigknapper får plass på skjermen. Hører hjemme i **innstillinger** (av som default — de fleste vil ikke ha det, men de ivrigste vil).
  - **Foreslått løsning (hybrid):** Legg til valgfritt `short`-felt (maxlength 5) per pill i `activityPills_v1`-konfigen. Tomt felt → vis fullt navn. Pills på hovedsiden viser `short` når satt.
  - **Kuraterte standarder:** Ship en «Foreslå forkortelser»-knapp som fyller inn fornuftige forkortelser for de 6 standard-aktivitetene (Stasjonær→«Stasj», Rastende→«Rast», osv.). Brukeren kan redigere.
  - **Beslutning (valgt):** ✅ **Hybrid** — vi kuraterer forslag for standard-aktivitetene («Foreslå forkortelser»-knapp), men brukeren kan redigere/skrive egne kortnavn (maks 5 tegn). Tomt felt = fullt navn.
  - **Berører:** `storage.js` (utvid pill-format + migrering), `settings.html` (kortnavn-felt i pill-liste), `observation-commit.js` (render `short` på pills). Bakoverkompatibel migrering fra dagens `{label, value}`.
  - **✅ IMPLEMENTERT (2026-07-09):** Valgfritt `short`-felt (maks 5 tegn) i `activityPills_v1`, kortnavn-input per rad i innstillinger, «Foreslå forkortelser»-knapp (`ACTIVITY_SHORT_SUGGESTIONS`, fyller kun tomme felt), pills viser `short` med fullt navn som tooltip. Klikk matcher fortsatt på fullt `label`. Bakoverkompatibelt.
- **Dropdown uten layout-forskyvning**: Vurder å vise søkeresultater med `position: absolute` så de ligger over innholdet under i stedet for å forskyve det ned. Gir mer stabil layout under søk.
- **Performance optimaliseringer**: Raskere artsøk og lokalitetshenting
- **Optimaliser dropdown-design**: Grupper alder-valg logisk (Egg | Ungfugl: 1K-serie | Voksen: Adult)
- **Lyst/mørkt tema**: Implementere theme-switching for alle sider (index, hjelp, stats)
  - Toggle-knapp for å bytte mellom lyst og mørkt tema
  - Lagre brukerens preferanse i localStorage

#### Tekniske oppgaver:
- **Staging-miljø på Pi**: Lag en staging-instans på Raspberry Pi (f.eks. egen container på annen port + `staging-ao-pi.efugl.no`, eller en `update-ao-pi.sh staging`-modus). **Motivasjon:** Fly-deploy tar for lang tid når man vil se en endring raskt i felt-lignende miljø. Pi er primær prod, så en Pi-staging gir rask iterasjon uten å røre prod. Vurder delt vs. separat LocationDB-volum og at staging ikke logger til prod-Supabase.
- **OpenSSL warnings**: Fikse urllib3/OpenSSL-advarsel i Python-miljø (lav prioritet)
- **Cloudflare cache-flush i deploy (Pi)**: `update-ao-pi.sh` bør purge Cloudflare-cachen for `ao-pi.efugl.no` etter deploy. **Problem observert 2026-07-09:** Cloudflare cachet gammel `storage.js`/`version.js` (4t edge-TTL, `cf-cache-status: HIT`) selv om origin sender `max-age=300`. Ny `settings.html` importerte `ACTIVITY_SHORT_SUGGESTIONS` fra en gammel cachet `storage.js` uten eksporten → ES-modul-import kastet → hele settings-scriptet stoppet (ingen pill-rader). Fly har ikke dette problemet.
  - **Løsning:** Legg til et purge-kall på slutten av `update-ao-pi.sh`, f.eks. `curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" --data '{"purge_everything":true}'`. Krever `CF_ZONE_ID` + scoped `CF_API_TOKEN` (Cache Purge-rettighet), lagret utenfor repo.
  - **Alternativ/tillegg:** Vurder Cloudflare Cache Rule som bypasser cache for `/js/*` og `/*.html` (så versjonerte assets alltid revalideres), eller cache-busting query (`?v=<VERSION>`) på modul-imports.

### 🟢 Lav prioritet

#### Funksjonalitet:
- **Backup/export**: Eksporter hele observasjonshistorikken
- **Ytterligere Supabase-funksjoner**: Bruke Supabase til mer enn bare statistikk
- **Server-lagring av brukerinnstillinger (multi-enhet)**: La brukeren synke innstillinger (aktivitets-pills, forkortelser, tema, medobservatører, radius m.m.) på tvers av enheter. Naturlig nøkkel: AO `userId` (allerede tilgjengelig ved innlogging), lagret i Supabase. Vurder synk-strategi (siste-skriver-vinner vs. flett), og hva som IKKE skal synkes (aldri passord). Henger sammen med innloggings-løftet — når bruker først er innlogget, kan innstillinger følge kontoen.

---

## Miljøvariabler og portabilitet

### Supabase (valgfritt)
Appen fungerer perfekt uten Supabase-konfigurasjon og faller tilbake til in-memory statistikk:
- `SUPABASE_URL` - for full statistikk-lagring
- `SUPABASE_KEY` - for autentisering mot Supabase

### Andre miljøvariabler:
- `PORT` (default: 3000)
- `AO_URL` (default: `https://www.artsobservasjoner.no`) — base-URL for artssøk
- `AO_MOBILE_URL` (default: `https://mobil.artsobservasjoner.no`) — base-URL for AO-lokaliteter
- `NOMINATIM_URL` (default: `https://nominatim.openstreetmap.org/reverse`) — reverse geokoding
- `STATS_KEY` (for statistikk-side, default: 'salo')

Sist oppdatert: 28.01.2026
