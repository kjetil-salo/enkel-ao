## 1.7.0 – 2026-01-19
### Forbedringer og visuelle endringer
- Bredere desktop-visning (max-width 800px)
- Oppdater posisjon-knapp med tydelig ramme og hover-effekt
- Søkeradius-felt med bedre plass og justert label
- Mer diskret label uten caps lock
- Observasjonslisten uten scroll – eksportknapp alltid synlig
- Diverse små visuelle justeringer og bedre design
```markdown

## Unreleased
### Dato: 2026-01-19
- **Ny rediger-side**: `public/edit.html` — egen side for å redigere registrerte observasjoner (art, antall, aktivitet, alder, kjønn, sted og kommentar). Dette ble valgt fremfor en modal for å unngå global state-regresjoner.
- **Edit-knapp i observasjonslisten**: Lagt til ✏️-knapp på hver rad i observasjonslisten som åpner `public/edit.html?id=<index>`.
- **Kommentar-felt**: Kommentar lagres på observasjonsobjektet som `comment` og inkluderers i CSV-eksporten (kolonne 15 "Kommentar (synlig for alle)").
- **Load-order-fix**: `loadState()` kjører tidlig ved oppstart slik at lagrede observasjoner vises på init.
- **Layout- og mobilforbedringer**: Flere responsive endringer for å forbedre plassbruk på mobil (mindre paddings, kortere posisjonsknapp, og bedre plassering av sletteknapp).
- **Fjernede filer**: `public/ao-import.html` ble fjernet fra arbeidsområdet etter brukerønske.

### Notater
- Endringene er implementert i `public/index.html`, `public/edit.html`, og noen CSS-oppdateringer i `public/style.css` og inline-stiler i `public/index.html`.
- Lokalt lagres observasjoner i `localStorage` under nøkkelen `fugleobservasjoner_v1` (schema: `{version:1, observations: [...]}`)
- Deploy ble testet mot Fly (enkel-ao) fra feature-branch `feature/superlokalitet-badge` uten å tagge en ny release. Prod-deploy skjer kun ved opprettelse av en ny `v*`-tag.

## 1.7.0 – 2026-01-19
### Forbedringer og visuelle endringer
- Bredere desktop-visning (max-width 800px)
- Oppdater posisjon-knapp med tydelig ramme og hover-effekt
- Søkeradius-felt med bedre plass og justert label
- Mer diskret label uten caps lock
- Observasjonslisten uten scroll – eksportknapp alltid synlig
- Diverse små visuelle justeringer og bedre design
## 1.6.0 – 2026-01-17
### ✨ Nye funksjoner
- **AO-lokasjonsdropdown**: Egen custom dropdown for Artsobservasjoner-lokaliteter med avstand, sortering og mobilvennlig visning
- **Pluss/minus-knapper**: Rask endring av antall direkte i listen, optimalisert for mobil (touch-vennlig)

### 🐛 Feilrettinger
- Fikset at observasjoner ikke vises før ny art er registrert
- Fikset feil ved tom liste og grupperingslogikk
- Fikset event listeners og initialisering for pålitelig lasting

### 🎨 UI/UX
- Mindre og mer diskrete pluss/minus-knapper
- Bedre layout og touch-vennlighet på mobil

### 📚 Dokumentasjon
- Oppdatert README og changelog
## 1.5.0 – 2026-01-14
### ✨ Nye funksjoner
- **Utvidet E2E-testing**: Lagt til mock-server for artssøk-API i Playwright-tester
 - Mock-server ([mock-server.ts](tests/e2e_playwright/mock-server.ts)) simulerer `/api/species`, `/api/reverse` og `/api/ao-sites`
 - Forhåndsdefinerte mock-arter: gråspurv, blåmeis, meis, trost, ørn
 - Automatisk oppstart via Playwright `webServer`-konfigurasjon

### 🧪 Testforbedringer
- **10 nye E2E-tester** for artssøk og brukergrensesnitt:
 - Søk med autocomplete og resultatvisning
 - Velge art fra liste (klikk og Enter)
 - Piltast-navigering i resultater
 - Melding ved for kort søkestreng
 - Status-tekst visning
 - Antall-felt aktivering etter valg av art
 - Nye npm-scripts: `test:mock`, `mock`, `test:with-mock`
 - TypeScript-konfigurasjon for mock-server

### 📚 Dokumentasjon
- Utvidet [README for E2E-tester](tests/e2e_playwright/README.md) med mock-server-instruksjoner

## 1.4.0 – 2026-01-13
### 🎨 UI/UX Forbedringer
- **Visuell seksjonering**: Tydelige bokser skiller obligatoriske og valgfrie felt
- **Korrekt visuelt hierarki**: Grønne bokser for obligatoriske felt, grå for valgfrie
- **Forbedret gruppering**: Lokasjon, observasjon (obligatorisk), og tilleggsinfo (valgfritt) i separate seksjoner
- **Tydeligere borders og skygger**: Gjør seksjonene mer synlige og profesjonelle
- **Responsiv seksjonering**: Mindre padding på mobile enheter

### 🔧 Tekniske forbedringer  
- **Valgfri Supabase**: App fungerer uten Supabase-credentials (in-memory modus for GitHub Codespaces)
- **Miljøvariabel-deteksjon**: Automatisk fallback til in-memory hvis `SUPABASE_URL`/`SUPABASE_KEY` mangler
- **Forbedret portabilitet**: Kan kjøres i alle miljøer uten eksterne avhengigheter

### 🐛 Feilrettinger
- Fjernet forvirrende registreringsflyt med stor knapp
- Alder/kjønn-felt alltid synlige (ikke skjult bak toggle)
- Inline ✓-knapp for registrering (tilbake til original design)

## 1.3.0 – 2026-01-13
### ✨ Nye funksjoner
- **Avanserte felter**: Lagt til alder og kjønn som valgfrie felter med checkbox-toggle
 - Alder: Komplett dropdown med AO-kompatible verdier (Egg, Pulli, 1K, 1K+, 2K, 2K+, osv.)
 - Kjønn: Dropdown med AO-verdier (Hann, Hunn, Hunnfarget, I par)
 - Feltene huskes i localStorage og aktiveres automatisk når art velges
 - Ny stor registreringsknapp under alle felter for intuitiv navigasjon
 - Utvidet CSV-eksport: Alder og kjønn inkluderes i riktige kolonner for AO-import
 - Forbedret observasjonsvisning: Ny "Detaljer"-kolonne viser alder/kjønn når satt

### 🎨 Design og UX
- Ny profesjonell registreringsknapp med gradient, hover-effekter og skygge
- Flyttet registrering fra inline til dedikert knapp for bedre flyt (art → antall → activity → avanserte felter → registrer)
- Responsiv styling for avanserte felter på mobile enheter
- Oppdatert placeholder-tekst og navigasjon med Enter-key

### 🐛 Feilrettinger
- Fikset JavaScript-feil som hindret "Hent lokalitet"-funksjonen
- Fjernet duplikat variabel-deklarasjoner som forårsaket script-stopp
- Alder/kjønn-felter nullstilles automatisk etter hver registrering

### 🔧 Tekniske forbedringer
- Modularisert toggle-logikk for avanserte felter
- Forbedret CSV-generering med riktig kolonneindeksering
- Optimalisert event listeners og form state management

## 1.1.3 – 2026-01-12
- Lagt til `pytest`-tester for sentrale API-endepunkter.
- GitHub Actions kjører tester på push/PR til `main`.
- Deploy til Fly.io skjer kun på tag (`v*`) for tryggere produksjonssetting.

## 1.1.2 – 2026-01-12
- Løst problem med at input-felt for antall zoomet inn på mobil (font-size 16px på alle input/knapper).
- Forbedret visning av den grønne haken (submit-knapp) slik at den ikke klippes eller havner utenfor på små skjermer.
- Forbedret responsivitet: knapper nederst kan nå wrappe og havner ikke utenfor skjermen på mobil.
- Lagt inn hack for å scrolle art-feltet inn i synlig område på mobil når tastatur/autofyll vises.
- Forsøkt å skjule valgt-linjen (chosen) på mobil, men beholdt på desktop.
- Oppdatert TODO: behov for både prod- og test-side for trygg videreutvikling.

## 1.1.1 – 2026-01-11
- Penere statistikk-side (/stats)
- Statistikk hentes fra Supabase
- Robusthet: stats-siden skal virke selv om Supabase er nede (TODO)
- Fly.io-deploy med secrets for Supabase
- .env for lokal utvikling

## 1.1.0 – 2026-01-11
- Første versjon med Supabase-logging og statistikk
- Fly.io-deploy
- Responsivt og mobilvennlig GUI

``` 
