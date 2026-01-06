# Plan for fugleobservasjoner-webapp

Mål: Lage en webapp der du kan logge inn, registrere observasjoner av arter (fugler), og til slutt eksportere en CSV som kan brukes direkte i Artsobservasjoner sin import-funksjon.

## Status per nå (prototype)

- Backend er en enkel Python-basert HTTP-server (server.py) som:
  - Server statiske filer fra public/index.html.
  - Har et API-endepunkt /api/species som proxier til Artsobservasjoner sitt Taxon/PickerSearch-endepunkt.
  - Har et API-endepunkt /api/reverse som bruker Nominatim (OpenStreetMap) til å slå opp stedsnavn fra GPS-koordinater.
  - Parser HTML-svaret fra Artsobservasjoner og returnerer JSON med taxonid, norsk navn og vitenskapelig navn.
- Frontend er én ren HTML/JS-side (public/index.html) som:
  - Har et søkefelt for art med autocomplete mot /api/species.
  - Lar deg velge art med Enter eller klikk, og flytter deretter fokus til et antall-felt.
  - Har en «Oppdater posisjon»-knapp som bruker nettleserens geolokasjon til å hente én GPS-posisjon.
    - Etter vellykket henting lagres lat/lon i minnet og brukes for alle påfølgende observasjoner til du oppdaterer igjen.
    - Det gjøres et kall til /api/reverse for å hente et stedsnavn som kan forhåndsutfylle et eget stedsnavn-felt.
    - Et lite kart-ikon kan åpne posisjonen i OpenStreetMap i ny fane.
  - Har et felt «Stedsnavn (valgfritt)» som:
    - Kan auto-fylles fra reverse geocoding, men kan alltid overstyres manuelt.
    - Verdien lagres sammen med hver observasjon.
  - Når du skriver inn antall og trykker Enter:
    - Kreves det at posisjon er oppdatert (ellers får du beskjed om å oppdatere først).
    - Legges art + antall + gjeldende posisjon + stedsnavn til en intern liste.
    - Listen nederst på kortet er gruppert per stedsnavn, med en liten overskrift (f.eks. «Hylkje», «Knarvik» eller «Uten stedsnavn») og linjer under på formen «antall × art».
    - Fokus flyttes tilbake til søkefeltet for rask neste registrering.
  - Har en knapp «Last ned CSV» som genererer en CSV-fil (fugleobservasjoner.csv) med kolonnene:
    - taxonid;navn;antall;sted;lat;lon
    - CSV-en er fortsatt en skisse; senere skal formatet justeres til Artsobservasjoner sitt eksakte importformat.

Videre faser under er fortsatt gyldige, men enkelte punkter (som observasjonsliste, posisjon, stedsnavn og enkel CSV) er allerede påbegynt i denne prototypen.

## Fase 1: Grunnoppsett + arts-autocomplete (responsiv)

**Mål:** En enkel, mobilvennlig side hvor du kan søke etter fuglearter via Artsobservasjoner sitt autocomplete-endepunkt og få opp forslag.

**Forslag til teknologivalg (kan justeres senere):**
- Frontend: Vite + React + TypeScript (eller ren HTML/JS om du vil holde det helt enkelt).
- Backend: Minimal Node/Express- eller Fastify-server som mellomledd (proxy) mot Artsobservasjoner.

**Hvorfor liten backend/proxy:**
- Unngå CORS-problemer (Artsobservasjoner svarer kanskje ikke direkte til din egen origin).
- Ikke hardkode cookies/token i frontend-kode (sikkerhet).
- Skjule eventuell konfigurasjon (headers osv.) på serversiden.

### Steg i Fase 1

1. **Prosjektoppsett**
   - Initialiser prosjektet i `fugleobservasjoner`-mappen (for eksempel med npm + Vite).
   - Foreslått struktur:
     - `frontend/` (eller `src/`) for UI.
     - `server/` for Node/Express-proxy.
   - Sett opp `npm`-scripts for å starte frontend og backend (evt. én dev-server med proxy).

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
     - Bruk f.eks. `cheerio` for å plukke ut alle `.itemjson`.
     - Kjør `JSON.parse` på innholdet i hver `span.itemjson`.
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

## Fase 2: Enkelt observasjonsskjema (lokal lagring først)

**Mål:** Når en art er valgt, skal du kunne registrere en observasjon og lagre den lokalt (for eksempel i `localStorage`).

**Steg:**
- Definer feltene som trengs: dato, antall, sted (tekst/koordinater), kommentar.
- Bygg et skjema koblet til valgt art.
- Lag en lokal "observasjonsliste" i minne og synk den mot `localStorage`.
- Lag en enkel listevisning av registrerte observasjoner på siden.

Resultat: En fungerende, enkel prototyp uten innlogging.

---

## Fase 3: Innlogging + backend-API + database

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

## Fase 4: Modellering etter Artsobservasjoner CSV-format

**Mål:** Sikre at observasjonene har alle feltene som kreves for import hos Artsobservasjoner.

**Steg:**
- Finn dokumentasjon eller eksempel-CSV for import på Artsobservasjoner.
- Kartlegg hvilke kolonner som er påkrevd (art-id, dato, klokkeslett, koordinatsystem, sted, antall, aktivitet osv.).
- Oppdater datamodellen og skjemaene:
  - Legg til manglende felt.
  - Bruk fornuftige standardverdier / nedtrekkslister der det er mulig.
- Migrer eksisterende observasjoner i databasen til ny struktur.

---

## Fase 5: CSV-eksport og verifikasjon mot import-funksjonen

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

## Fase 6: Produksjonssetting og videreutvikling

**Mål:** Stabil webapp i produksjon.

**Steg:**
- Deploy backend + frontend (f.eks. Railway, Fly.io, Render eller Vercel + hosted DB).
- Sett opp miljøvariabler, logging og enkel overvåkning.
- Mulige videre funksjoner:
  - Favoritt-lokaliteter.
  - Offline-støtte/PWA.
  - Enkle analyser (antall arter per år, topp 10-arter osv.).
