# Forbedringsforslag for Fugleobservasjoner

## Høy prioritet (lav risiko, høy verdi)

### 1. ✅ Undo ved sletting av observasjoner
- **Problem:** Akkurat nå er slett permanent
- **Løsning:** "Undo"-toast i 5 sekunder etter sletting
- **Verdi:** Enkel UX-forbedring som folk setter pris på
- **Status:** Implementert

### 2. ✅ Unit-tester for JS-moduler
- **Problem:** Har E2E-tester, men ingen unit-tester
- **Løsning:** 114 unit-tester med Vitest for storage, location, api, species_offline, observations og ui
- **Verdi:** Fanger bugs før deploy
- **Status:** Implementert

### 3. ✅ Refaktorer main.js
- **Problem:** main.js var blitt 919 linjer
- **Løsning:** Splittet til 306 linjer + 4 nye moduler:
  - `form-state.js` — progressiv aktivering av skjemafelter
  - `species-search.js` — artssøk, resultatvisning og artsvalg
  - `observation-commit.js` — validering, lagring og aktivitets-pills
  - `export-operations.js` — CSV-eksport, kopiering og sletting
- **Verdi:** Bedre vedlikeholdbarhet og testbarhet
- **Status:** Implementert

## Medium prioritet (mer arbeid, god verdi)

### 4. Cloud backup av observasjoner
- **Problem:** Kun localStorage - hvis bruker mister telefon, mister alt
- **Løsning:** Bruk Supabase (allerede integrasjon for logging)
  - Sync til cloud ved hver lagring
  - Last ned ved oppstart
  - Konfliktløsning ved samtidig bruk på flere enheter
- **Verdi:** Kritisk for datavern
- **Estimat:** Halvdag
- **Status:** Ikke startet

### 5. Batch-operasjoner
- **Problem:** Tidkrevende å gjøre samme endring på mange observasjoner
- **Løsning:**
  - Endre stedsnavn på alle obs fra en dag
  - Legge til medobservatør på flere obs samtidig
  - Slette alle obs fra en lokalitet
- **Verdi:** Tidsbesparelse ved mange observasjoner
- **Estimat:** 1-2 dager
- **Status:** Ikke startet

### 6. ✅ Offline-varsling med lenke til innstillinger
- **Problem:** Bruker med online-modus kan oppleve timeout/færre treff uten å forstå hvorfor
- **Løsning:** Klikkbar lenke til ⚙️ Innstillinger ved timeout og offline fallback
- **Verdi:** Hjelper brukeren å oppdage offline-innstillingen når den trengs
- **Status:** Implementert

## Lavere prioritet (nice-to-have)

### 7. TypeScript
- **Fordeler:** Ville fanget mange bugs compile-time
- **Ulemper:** Krever build-step - mister enkelhet
- **Vurdering:** Kanskje ikke verdt det for dette prosjektet
- **Status:** Ikke planlagt

### 8. Export til flere formater
- **Forslag:**
  - JSON for backup
  - Excel for analyse
  - GeoJSON for kartvisning
- **Verdi:** Mer fleksibilitet i databruk
- **Estimat:** 1 dag
- **Status:** Ikke startet

### 9. Drag-and-drop for reordering
- **Løsning:** Dra obs opp/ned for å endre rekkefølge
- **Verdi:** Mest relevant hvis du sorterer kronologisk
- **Estimat:** Halvdag
- **Status:** Ikke startet

### 10. PWA install prompt
- **Problem:** Har manifest.json og service worker, men ingen install-prompt
- **Løsning:** Gjør det enklere å "installere" som app på hjemskjerm
- **Verdi:** Bedre app-følelse
- **Estimat:** 2-3 timer
- **Status:** Ikke startet

## Anbefalt rekkefølge

1. ✅ **Undo ved sletting** — implementert
2. ✅ **Unit-tester** — 114 tester med Vitest
3. ✅ **Refaktorer main.js** — splittet i 5 moduler
4. **Cloud backup med Supabase** (kritisk for datavern)
5. **Offline-varsling** (guide brukeren til innstillinger ved nettverksfeil)

---

*Sist oppdatert: 2026-01-27*
