# Endringer og TODO

## ✅ Gjennomførte forbedringer (v1.4.0)

### 🎨 UI/UX Forbedringer
- **Visuell seksjonering**: Tydelige bokser skiller obligatoriske og valgfrie felt
- **Korrekt visuelt hierarki**: Grønne bokser for obligatoriske felt, grå for valgfrie
- **Forbedret gruppering**: Lokasjon, observasjon (obligatorisk), og tilleggsinfo (valgfritt)
- **Responsiv design**: Mindre padding og bedre mobile tilpasninger

### 🔧 Tekniske forbedringer
- **Valgfri Supabase**: App fungerer uten Supabase-credentials (in-memory modus)
- **Miljøvariabel-deteksjon**: Automatisk fallback til in-memory hvis `SUPABASE_URL`/`SUPABASE_KEY` mangler
- **Forbedret portabilitet**: Kan kjøres i GitHub Codespaces og andre miljøer uten eksterne avhengigheter

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
- **Separert staging/production**: Implementere CI/CD for ulike miljøer
- **Forbedret feilhåndtering**: Bedre fallback for API-feil

#### Mobile forbedringer:
- **"Chosen species" bug**: Valgt art kan dekke over forslags-dropdown på mobile
  - Må fikse z-index eller layout for mindre skjermer

### 🟡 Middels prioritet

#### UX-forbedringer:
- **Performance optimaliseringer**: Raskere artsøk og lokalitetshenting
- **Optimaliser dropdown-design**: Grupper alder-valg logisk (Egg | Ungfugl: 1K-serie | Voksen: Adult)

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

Sist oppdatert: 13.01.2026
