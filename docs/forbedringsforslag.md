# Forbedringsforslag for Fugleobservasjoner

## Høy prioritet (lav risiko, høy verdi)

### 1. ✅ Undo ved sletting av observasjoner
- **Problem:** Akkurat nå er slett permanent
- **Løsning:** "Undo"-toast i 5 sekunder etter sletting
- **Verdi:** Enkel UX-forbedring som folk setter pris på
- **Status:** Implementert

### 2. Unit-tester for JS-moduler
- **Problem:** Har E2E-tester, men ingen unit-tester
- **Løsning:** Test `toCsv()`, `haversine()`, `renderObservations()` isolert
- **Verdi:** Ville fanget bugs før deploy
- **Estimat:** 1-2 dager
- **Status:** Ikke startet

### 3. Refaktorer main.js
- **Problem:** main.js er blitt 400+ linjer
- **Løsning:** Splitt i flere moduler:
  - `form-state.js` (progressive activation logic)
  - `event-handlers.js` (all event listener setup)
  - `observation-commit.js` (commit logic)
- **Verdi:** Bedre vedlikeholdbarhet og testbarhet
- **Estimat:** Halvdag
- **Status:** Ikke startet

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

### 6. Bedre offline-indikator
- **Problem:** Service worker cacher, men bruker vet ikke når de er offline
- **Løsning:** Tydelig banner: "Du er offline - endringer lagres lokalt"
- **Verdi:** Bedre forståelse av app-tilstand
- **Estimat:** 2-3 timer
- **Status:** Ikke startet

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

1. ✅ **Undo ved sletting** (1-2 timer, stor UX-gevinst)
2. **Cloud backup med Supabase** (halvdag, kritisk for datavern)
3. **Refaktorer main.js** (halvdag, bedre vedlikeholdbarhet)
4. **Unit-tester** (1-2 dager, bedre kvalitetssikring)
5. **Offline-indikator** (2-3 timer, bedre brukeropplevelse)

---

*Sist oppdatert: 2026-01-22*
