---
name: feature-lifecycle
description: Orkestrerer hele feature-livssyklusen for enkel-ao — analyse, faset implementering, code-review, test og deploy til Pi. Bruk for nye features som krever flere steg.
user-invocable: true
argument-hint: "[feature-beskrivelse]"
---

# Feature-livssyklus – enkel-ao

Orkestrerer hele livssyklusen for en ny feature — fra analyse via faset implementering til deployet kode. Koordinerer code-review og test i riktig rekkefølge og sikrer at ingenting hoppes over.

Prosjektet er **enkel-ao** — Python 3.12 ThreadingHTTPServer backend, vanilla JS ES6-moduler, Docker på Raspberry Pi. Hobby-app for fugleobservasjoner. Vær konservativ med endringer i kjerneflyten (registrering, AO-sending).

---

## Prosess

### Steg 0: Kontekst-sjekk

Før implementering starter — spør brukeren:

> «Vil du at jeg starter i en ny, tom konversasjon for å unngå kontekstproblemer underveis?»

Gjør dette alltid hvis featuren involverer flere faser eller store filer (server.py, observations.js, api_handlers.py). Lang kontekst kan føre til at tidligere lest kode ikke er tilgjengelig.

### Steg 1: Analyse

Gjøres i konversasjonen — ikke opprett dokumenter med mindre featuren er kompleks.

1. Les relevant eksisterende kode før du foreslår noe
2. Utred problemet med minst 2 tilnærminger
3. Vurder mot prosjektets prinsipper:
   - Enkel, pragmatisk løsning — ikke over-engineer
   - Brukes primært på mobil i felt — touch og GPS er kritisk
   - Eksterne API-feil skal gi degradert respons (status 200, tom liste) — aldri 500
   - Frontend-endringer krever SW-bump (`public/js/version.js`)
4. Anbefal én løsning med begrunnelse
5. **Bruker MÅ godkjenne retningen** før implementering starter

### Steg 2: Faset plan

Lag en faset plan i konversasjonen:

- Del opp i logiske faser (F1, F2, F3...)
- Hver fase har klare akseptansekriterier
- Typisk faseinndeling:
  - **Backend-endringer** (server.py-ruter, src/-moduler)
  - **Frontend-endringer** (HTML/CSS/JS, SW-bump ved behov)
  - **Integrasjon og edge cases**
- Marker om SW cache-bump er nødvendig (frontend-endringer = alltid bump)
- Marker om endringer krever staging-test før Pi-deploy

**Bruker MÅ godkjenne planen** før implementering starter.

### Steg 2.5: UX-sjekk (betinget)

Kun hvis featuren berører noe brukeren ser:

- Input `font-size` minimum 16px (iOS zoom-prevention)
- Touch-targets ≥ 44px
- Ny UI fungerer på mobil (320px+)
- CSS-tokens fra `public/css/1-tokens.css` — aldri hardkodede hex
- Nettverksfeil håndteres gracefully (degradert respons, ikke krasj)
- Spinner/feedback ved asynkrone operasjoner

### Steg 3: Implementering per fase

For HVER fase, gjenta dette mønsteret:

**3a. Implementer**
- Implementer kun det fasen beskriver — ikke mer
- Nye ruter i server.py: legg til i `do_GET`/`do_POST`-blokken
- Eksterne API-feil: alltid `except Exception` med graceful fallback
- SQL i location_db.py: alltid parameterisert — aldri f-strings
- Verifiser akseptansekriteriene

**3b. Code review**
- Spawn `/code-review`-skillen med de endrede filene
- Resultat: GODKJENT / BETINGET GODKJENT / AVVIST
- Ved BETINGET/AVVIST: fiks og send til ny review
- Ikke gå videre til neste fase før GODKJENT

**3c. Test**
- Spawn `test`-agenten med feature-navn eller endrede filer som argument
- Velger riktig nivå (pytest / Playwright) basert på hva som ble endret
- Rapporterer funn — fikser dem ikke
- Ved FEILET: fiks og kjør ny test-agent

**3d. Oppsummering**
- Kort notis om hva som ble gjort og eventuelle avvik
- Marker fasen som fullført

**Gjenta 3a-3d for hver fase.**

### Steg 4: Integrasjon

1. Verifiser at alle faser fungerer sammen
2. Sjekk for regresjoner i tilgrensende funksjonalitet
3. Hvis frontend-endringer: bekreft at VERSION er bumped i `public/js/version.js`
4. Full testkjøring: `python3 -m pytest --maxfail=3`

### Steg 5: Deploy

1. **Staging (Fly.io) først** hvis endringen berører:
   - Service Worker eller PWA-manifest
   - AO-innloggingsflyt eller direkteimport
   - Kjerneregistreringsflyt
   ```bash
   ./update-app.sh staging
   ```
2. **Direkte til Pi** er OK for:
   - Rene backend-endringer uten frontend
   - Bugfikser i src/-moduler
   - Nye API-endepunkter som ikke brytes frontend
   ```bash
   ./update-ao-pi.sh
   ```
3. **Prod på Fly.io** (kjører tester automatisk):
   ```bash
   ./update-app.sh production
   ```

### Steg 6: Commit

Norske commit-meldinger. Temabaserte commits:
1. Backend-implementering
2. Frontend-implementering (hvis separat)
3. Tester (hvis mange nye)

**Aldri Co-Authored-By i commits.**

---

## Kvalitetsporter

| Port | Hvem | Hva |
|------|------|-----|
| Etter analyse | Bruker | Riktig forstått? Anbefaling fornuftig? |
| Etter plan | Bruker | Faser OK? Noe mangler? |
| Etter 3b per fase | code-review skill | Kode-kvalitet, sikkerhet, konvensjoner |
| Etter 3c per fase | test-agent | Funksjonalitet, grenseverdier, regresjon |
| Etter steg 5 | Bruker | Staging OK? Klart for Pi? |

---

## Anti-patterns

1. **Implementere før analyse**: Les koden først — ikke gjett
2. **Hoppe over code-review**: Hver fase MÅ gjennom `/code-review`
3. **Droppe SW-bump**: Frontend-endringer uten bump → brukere sitter på gammel kode
4. **Returnere 500 på ekstern API-feil**: AO og Nominatim kan feile — alltid degrader gracefully
5. **Over-engineering**: Hobby-prosjekt — enkle løsninger vinner
6. **Implementere utover plan**: Lever det som ble planlagt, ikke mer
