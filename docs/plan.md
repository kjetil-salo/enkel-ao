# Plan for fugleobservasjoner-webapp

Mål: Lage en webapp der du kan logge inn, registrere observasjoner av arter (fugler), og til slutt eksportere en CSV som kan brukes direkte i Artsobservasjoner sin import-funksjon.

## Status per nå (prototype)

- Backend er en enkel Python-basert HTTP-server (server.py) som:
  - Server statiske filer fra public/index.html.
  - Har API-endepunktene /api/species, /api/reverse og /api/ao-sites som kun opptrer som proxier mot Artsobservasjoner og Nominatim.
  - Lagrer ingen observasjoner eller brukerdata på server – all «state» er i nettleseren.
- Frontend er én ren HTML/JS-side (public/index.html) som:
  - Har et søkefelt for art med autocomplete mot /api/species.
  - Lar deg velge art med Enter eller klikk, og flytter deretter fokus til et antall-felt.
  - Har en «Oppdater posisjon»-knapp som bruker nettleserens geolokasjon til å hente én GPS-posisjon (valgfritt, men anbefalt).
    - Etter vellykket henting lagres lat/lon i minnet og brukes for alle påfølgende observasjoner til du oppdaterer igjen.
    - Det gjøres et kall til /api/reverse for å hente et stedsnavn som kan forhåndsutfylle et eget stedsnavn-felt.
    - Det gjøres et kall til /api/ao-sites for å hente nærmeste lokaliteter fra Artsobservasjoner, vist som klikkbare forslag.
    - Et lite kart-ikon kan åpne posisjonen i OpenStreetMap i ny fane.
  - Har et felt «Stedsnavn» som:
    - Kan auto-fylles fra reverse geocoding eller AO-lokaliteter, men kan alltid overstyres manuelt.
    - Verdien lagres sammen med hver observasjon og brukes som «Lokalitetsnavn» ved eksport.
  - Har feltene «Antall» og «Aktivitet» og en grønn ✓‑knapp for å lagre observasjoner raskt (særlig på mobil).
  - Viser observasjonene i en tabell per sted (kolonnene Art, Antall, Aktivitet), gruppert på stedsnavn.
  - Lagrer observasjonene i nettleserens localStorage slik at de overlever refresh / utilsiktet navigering bort fra siden.
  - Har eksport til TSV/CSV tilpasset Artsobservasjoner sitt importformat for fugl (v2.20), der Artsnavn, Lokalitetsnavn, Fra/til‑dato, Antall og Aktivitet fylles ut automatisk.

Videre faser under er mest historikk/plan; per nå fungerer prototypen godt nok til feltbruk og eksport til Artsobservasjoner uten innlogging eller databaseserver.

## (Historikk) Fase 1: Grunnoppsett + arts-autocomplete (responsiv)

**Mål:** En enkel, mobilvennlig side hvor du kan søke etter fuglearter via Artsobservasjoner sitt autocomplete-endepunkt og få opp forslag.

**Forslag til teknologivalg (kan justeres senere):**
- Frontend: Ren HTML/JS (som i `public/`) – eller Vite/React hvis du senere vil bygge om.
- Backend: Den eksisterende Python-serveren (`server.py`) som mellomledd (proxy) mot Artsobservasjoner.

**Hvorfor liten backend/proxy:**
- Unngå CORS-problemer (Artsobservasjoner svarer kanskje ikke direkte til din egen origin).
- Ikke hardkode cookies/token i frontend-kode (sikkerhet).
- Skjule eventuell konfigurasjon (headers osv.) på serversiden.

### Steg i Fase 1

1. **Prosjektoppsett**
   - Hold det enkelt: statiske filer i `public/` og én backend i rot (`server.py`).
   - Foreslått struktur (som nå):
     - `public/` for UI.
     - `server.py` for API-proxy.

2. **Responsivt grunnlayout**
   - Lag en enkel side med:
     - Toppseksjon med tittel (f.eks. "Fugleobservasjoner – artsvalg").
     - Input-felt for søk ("Søk etter art").
     - Resultatliste under input-feltet.
   - Bruk enkel CSS (Grid/Flex) for å:
     - La input fylle bredden på mobil.
     - Sørge for at lista tilpasser seg små skjermer.
   - Test i mobil-visning i nettleseren.

3. **Backend-proxy mot Artsobservasjoner**
   - Lag et API-endepunkt, f.eks. `GET /api/species?search=<query>`.
   - I dette endepunktet:
     - Bygg URL til Artsobservasjoner:
       - `https://www.artsobservasjoner.no/Taxon/PickerSearch?search=<query>&returnformat=html&onlyReportable=true&dontIncludeSubSpecies=true&speciesGroup=8&language=4`.
     - Send med et minimum av nødvendige headers (User-Agent, Accept, X-Requested-With).
     - Ikke hardkode personlige cookies eller tokens i koden. Dersom endepunktet krever innlogging, vurderes en tryggere løsning senere, men ikke i frontend.
     - Motta HTML-snippet og returner renset JSON til frontend.

4. **Parsing av svar fra Artsobservasjoner**
   - Svaret er HTML med elementer som:
     - `<span class="itemjson">{"taxonid": "3454", "taxonname":"krikkand", ...}</span>`.
   - På backend:
     - Plukk ut alle `span.itemjson`.
     - Parse JSON-innholdet i hver `span.itemjson`.
     - Returner en array med objekter, f.eks.:
       - `{ taxonId, taxonName, scientificName, speciesGroupId, protectionLevelId, ... }`.

5. **Frontend-autocomplete**
   - På keyup i søkefeltet:
     - Debounce (f.eks. 300 ms) for å unngå for mange kall.
     - Kall `GET /api/species?search=<tekst>`.
   - Presenter resultatene i en liste under input:
     - Vis norsk navn (`taxonname`) + vitenskapelig navn i kursiv.
     - Håndter "ingen treff"-tilfeller.
   - Når brukeren klikker på en art:
     - Lagre valgt art i lokal state.
     - Vis valgt art under input-feltet.

6. **UI/UX-finstpuss i fase 1**
   - Tastaturnavigasjon (pil opp/ned + Enter) i lista (valgfritt).
   - Loader/spinner mens søk pågår.
   - Feilhåndtering (vis enkel feilmelding ved nettverksfeil).

7. **Testing og validering**
   - Test med flere søk (kri, blå, måk osv.) for å se at lista oppfører seg som på Artsobservasjoner.
   - Sjekk i nettverksfanen at:
     - Frontend kun treffer `/api/species`.
     - Backend treffer Artsobservasjoner med korrekte parametere.

---

## (Historikk) Fase 2: Enkelt observasjonsskjema (lokal lagring først)

**Mål:** Når en art er valgt, skal du kunne registrere en observasjon og lagre den lokalt (for eksempel i `localStorage`).

**Steg:**
- Definer feltene som trengs: dato, antall, sted (tekst/koordinater), kommentar.
- Bygg et skjema koblet til valgt art.
- Lag en lokal "observasjonsliste" i minne og synk den mot `localStorage`.
- Lag en enkel listevisning av registrerte observasjoner på siden.

Resultat: En fungerende, enkel prototyp uten innlogging.

---

## (Plan, ikke implementert) Fase 3: Innlogging + backend-API + database

**Mål:** Brukere skal kunne logge inn og få observasjoner lagret på server.

**Steg:**
- Velg autentiseringsstrategi:
  - Enkel e-post + passord med JWT, eller
  - OAuth (GitHub/Google el.l.).
- Sett opp database (SQLite/Postgres) via et ORM (Prisma/Drizzle/Knex e.l.).
- Lag API-er:
  - `POST /api/login`, `POST /api/register`.
  - `GET/POST/PUT/DELETE /api/observations`.
- Knytt frontend mot disse API-endepunktene.
- Behold evt. `localStorage` som cache.

---

## (Plan, delvis erstattet) Fase 4: Modellering etter Artsobservasjoner CSV-format

**Mål:** Sikre at observasjonene har alle feltene som kreves for import hos Artsobservasjoner.

**Steg:**
- Finn dokumentasjon eller eksempel-CSV for import på Artsobservasjoner.
- Kartlegg hvilke kolonner som er påkrevd (art-id, dato, klokkeslett, koordinatsystem, sted, antall, aktivitet osv.).
- Oppdater datamodellen og skjemaene:
  - Legg til manglende felt.
  - Bruk fornuftige standardverdier / nedtrekkslister der det er mulig.
- Migrer eksisterende observasjoner i databasen til ny struktur.

---

## (Plan, delvis realisert) Fase 5: CSV-eksport og verifikasjon mot import-funksjonen

**Mål:** Fra webappen skal du kunne generere en CSV som godtas av Artsobservasjoner sin import.

**Steg:**
- Lag API-endepunkt `GET /api/export/csv` som:
  - Henter observasjoner for innlogget bruker.
  - Mapper til korrekt kolonnerekkefølge og format (dato, desimaler, koder osv.).
  - Returnerer `text/csv`.
- I frontend:
  - Legg til knapp "Last ned CSV" eller "Kopier CSV".
- Test:
  - Generer CSV med noen observasjoner.
  - Test import i Artsobservasjoner.
  - Juster format til importen går gjennom uten feil.

---

## (Plan) Fase 6: Produksjonssetting og videreutvikling

**Mål:** Stabil webapp i produksjon.

**Steg:**
- Deploy backend + frontend (f.eks. Railway, Fly.io, Render eller Vercel + hosted DB).
- Sett opp miljøvariabler, logging og enkel overvåkning.
- Mulige videre funksjoner:
  - Favoritt-lokaliteter.
  - Offline-støtte/PWA.
  - Enkle analyser (antall arter per år, topp 10-arter osv.).
