# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Norwegian bird observation web app with species autocomplete and location services. Lightweight Python HTTP server serving static frontend + API proxies to external services (Artsobservasjoner.no, OpenStreetMap Nominatim).

**Core Tech:** Python 3.12 + `http.server.ThreadingHTTPServer`, vanilla HTML/CSS/JS frontend (ES6 modules), Docker, optional Supabase logging.

## Commands

### Local Development
```bash
python3 server.py          # Start server on port 3000
# or: npm run dev
```

### Running Tests
```bash
# Python unit tests
python3 -m pytest --maxfail=3

# JS unit tests (vitest, fra repo-roten — IKKE fra tests/e2e_playwright/)
npm test                   # tests/unit/*.test.js, jsdom-miljø, se vitest.config.js

# E2E tests (Playwright)
cd tests/e2e_playwright
npm test                   # Against live server at localhost:3000
npm run test:mock          # With mock server
npm run test:with-mock     # Start mock + run tests
```
**NB:** `npm test` betyr ulike ting avhengig av hvor den kjøres fra — repo-roten (vitest) vs.
`tests/e2e_playwright/` (Playwright). Ved frontend-endringer, kjør alle tre testtypene.

### Docker & Deploy
```bash
make build                 # Build Docker image
make run                   # Run container on port 3000
docker-compose up --build  # Run with mock Nominatim (safe for load testing)

# Deploy to Fly.io
./update-app.sh staging    # Deploy to staging
./update-app.sh production # Deploy to production — tester kjøres automatisk!

# Deploy to Raspberry Pi (primær produksjon)
./update-ao-pi.sh          # Rsync + docker-compose up --build på Pi

# Deploy til Pi-staging (egen mappe/DB/port, deler kun shared-locations med prod)
./deploy-staging-pi.sh     # Kjører pytest+npm test (vitest) selv, deretter https://aos.efugl.no
```

### Lokasjons-DB import (kjøres ved behov, ~40 min)
```bash
# Fyll LocationDB med alle offentlige norske AO-lokasjoner
LOCATION_DB_PATH=/sti/til/locations.db python3 tools/import_ao_locations.py

# Berik med kommune/fylke-data etterpå (~60 min, Nominatim 1 req/sek)
LOCATION_DB_PATH=/sti/til/locations.db python3 /tmp/enrich2.py
```

### Load Testing
```bash
python3 tools/load_test.py --mode gentle --requests 100 --concurrency 10
# Modes: static, mixed, gentle, ramp, soak, spike, smoke
```

## Architecture

### Request Routing (server.py)
The `Handler` class routes requests:
- `/` → `public/index.html`
- `/api/species?search=X` → proxies to artsobservasjoner.no (HTML scraping + JSON extraction)
- `/api/reverse?lat=X&lon=Y` → proxies to Nominatim for reverse geocoding
- `/api/ao-sites?lat=X&lon=Y&size=M` → fetches nearby observation locations from Artsobservasjoner
  - **Backend returnerer både private og offentlige** (maxSites=1000)
  - **Frontend (map.js)**: Kun offentlige vises på kart (sparer CPU/minne, brukeren vet hvor egne er)
  - **Kommune/fylke**: `municipalityName`/`countyName` fra AO normaliseres til `municipality`/`county`
    og vises som undertekst i dropdown (skiller lokaliteter med samme navn)
  - **Frontend (location.js)**: Både offentlige og private i dropdown, maks 20. Sortering: 🏷️ superlokasjoner → offentlige → 👤 egne private (isMine) → andres private
- `/api/ao-autocomplete?term=X[&lat=Y&lon=Z]` → tekstsøk på lokaliteter
  - Søker lokal DB først (ingen innlogging nødvendig), deretter AO hvis innlogget
  - Med lat/lon: sorterer etter avstand, returnerer `_distance` i meters
  - Returnerer `isSuper`, `isPrivate`, `subvalue` (kommune, fylke) per resultat
- `/api/ao-rarity?taxonId=X&siteId=Y&date=YYYY-MM-DD` → sjeldenhetsvarsel: proxyer AOs egne
  `/SubmitSighting/GetSite` (henter Areas-ID-er for lokaliteten) + `/SubmitSighting/ValidateTaxonAndArea`
  (sanntidsvurdering art×areas×dato) — samme validering AOs eget skjema kjører FØR publisering
  - Uinnlogget bruker eller AO-feil → stille tomt `{}`/200, aldri 500 (jf. ekstern-API-konvensjonen)
  - Areas-ID-er cachet i `location_db.py` med 30 dagers TTL (`get_cached_areas`/`set_areas`) —
    administrative grenseendringer er sjeldne. Cacher kun lokaliteter som allerede finnes i DB-en
    fra før (unngår å forurense navnesøket med en fantom-rad for en helt ny AO-lokalitet)
  - Frontend (`rarity.js`) viser kun boks ved `Warning` — `Information` alene holdes tilbake i v1.
    Virker ikke med offline-artslista (mangler AOs `taxonId` helt)
  - Full analyse: `docs/sjeldenhetsvarsel.md`
- `/api/ao-login` (POST) → logger inn på AO med brukernavn/passord, returnerer `loginToken` + `authCookie`
- `/api/ao-import` (POST) → direkte publisering av observasjoner til AO (CSV-import + publish). Enkelt JSON-svar.
- `/api/ao-import-stream` (POST) → som `ao-import`, men **streamer fremdrift via SSE** (`text/event-stream`)
  - Fase-events: `importing {remaining, total}` → `publishing {total}` → `done {count}` / `error`
  - Fremdriften polles fra AOs egne endepunkter (se `docs/ao-import-fremdrift.md`):
    - `POST /ImportSighting/NumberOfSightingsImporting` (body `null`) → `{"Count":N}`, teller ned til 0 = ferdig parset
    - `POST /ReviewSighting/NumberOfSightingsSubmitted` (body `null`) → `{"Count":N}` i review-kø
  - Erstatter tidligere blind `sleep(3)` i `src/ao_import_httpx.py` med reell polling
- `/api/logview` (POST) → logs page views to Supabase
- `/api/feedback` (POST) → tar imot brukertilbakemelding (feil/ønske/annet) uten innlogging
  - Lagrer i `src/feedback_store.py` (SQLite), genererer saksnummer `AO-XXXXX`
  - Spam-vern: honeypot-felt (`website`), per-IP throttling (5/10 min), lengdegrenser
  - Sender eier-varsel via `src/email_notify.py` i bakgrunnstråd (best effort, `Reply-To` = melder)
- `/api/feedback-status` (POST, key-protected) → oppdaterer status på en sak (ny/under_arbeid/løst/avvist)
- `/feedback?key=X` → key-beskyttet admin-visning av tilbakemeldinger (statusfilter + statusendring)
- `/api/share` (POST) → lager delbar lenke av valgte observasjoner, returnerer `{slug, url, deleteKey, expiresTs}`
  - Lagres i `src/share_store.py` (SQLite, samme `stats.db`). Slug: 12 tegn fra entydig alfabet
  - **Personvern:** hvitelisting av felt — koordinater lagres aldri, `hideUntil`-obser slippes ikke gjennom
  - Levetid 14 dager (`SHARE_TTL_DAYS`). Utløp uten cron: `DELETE WHERE expires_ts < now` ved hver skriving
  - Spam-vern: egen per-IP-kvote (10/10 min), maks 200 obs og ~100 KB tekst per deling
  - **Bilder:** valgfritt `photo`-felt per observasjon, kun `image/jpeg` godtas. Client-side
    trinnvis nedskalering (800px/q0.55 → 640/0.4 → 480/0.32 → 400/0.28) sikter mot ~50 KB
    («nok for en rask oppdatering til venner») — `MAX_PHOTO_BYTES` (220 KB/bilde) er kun en
    server-side bakstopper. Eget budsjett atskilt fra tekstbudsjettet: `MAX_TOTAL_PHOTO_BYTES`
    (2,5 MB/deling), `MAX_PHOTOS_PER_SHARE` (20). Et for stort/ugyldig bilde droppes stille —
    feller aldri hele delingen, men `photosDropped` i API-svaret gir klienten beskjed om det
    skjedde (vises som `⚠️`-varsel)
- `/api/share-update` (POST) → oppdaterer innholdet i en eksisterende deling (samme slug/URL),
  krever `slug` + `deleteKey`. `expires_ts` endres bevisst ikke — forlenger ikke levetiden
- `/api/share-delete` (POST) → trekker tilbake en deling; krever `slug` + `deleteKey`
- `/d/<slug>` → offentlig delingsside. Ukjent og utløpt slug gir **samme** 404-side (ingen enumerering)
- `/mine-delinger.html` → frittstående side som lister brukerens delinger fra `myShares_v1`
  (localStorage, kun lokalt — ikke et serverendepunkt), med oppdater- og trekk tilbake-knapp per rad
- `/api/fellestur` (POST) → oppretter en ny fellestur (delt, skrivbar loggbok for en gruppe i felt),
  returnerer `{kode, expiresTs}`. 5-sifret kode (`_KODE_LENGTH`/`_KODE_ALPHABET` i `fellestur_store.py`)
- `/api/fellestur?kode=X` (GET) → henter turnavn, medobservatører og alle oppføringer (polling)
- `/api/fellestur-oppdater` (POST) → endrer turnavn/medobservatører — alle med koden kan gjøre dette
- `/api/fellestur-sync` (POST) → klienten sender en diff (`upserts`+`deletes`) mot sist bekreftede
  server-tilstand, får hele turen tilbake. Se `src/fellestur_store.py` for synk-modellen
- `/api/fellestur-peer/<kode>/events` (POST) → **kryss-app-føderasjon**: mottar en batch events fra
  en peer-server (f.eks. Feltlogg) som følger samme delte kode. Se `src/fellestur_peer.py` og
  `docs/ANALYSIS_FELLESTUR_FODERASJON.md` for full kontrakt og designvalg
- `/stats?key=X` → displays analytics (key-protected)
- `/health` → health check endpoint

### Backend Modules (src/)
- `api_handlers.py` — External API calls (species search, geocoding, AO sites, autocomplete)
  - `get_ao_rarity()`/`fetch_site_areas()`/`check_taxon_rarity()` — sjeldenhetsvarsel-orkestrering
    (se `/api/ao-rarity` og `docs/sjeldenhetsvarsel.md`). `_oslo_midnight_utc_iso()` konverterer
    dato til AOs forventede format (norsk lokal midnatt som UTC-ISO), verifisert mot ekte AO-respons
- `html_templates.py` — HTML generation for stats- og feedback-admin-sider
- `supabase_log.py` — Optional Supabase analytics logging
- `feedback_store.py` — SQLite-lagring av tilbakemeldinger (samme `stats.db` via `DB_PATH`)
  - Schema: `case_no, type, message, email, app_version, user_agent, device_type, os, browser, ip, status, ts`
  - Saksnummer `AO-XXXXX` fra entydig alfabet (uten 0/O/1/I/L); `create_feedback`, `list_feedback`, `set_status`, `count_by_status`
- `email_notify.py` — Eier-varsel ved ny tilbakemelding. Provider auto-detekteres, ren no-op hvis ukonfigurert
  - Prioritet: SMTP (`SMTP_HOST`+`SMTP_USER`+`SMTP_PASS` via smtplib/STARTTLS) → Resend → SMTP2GO HTTP
  - `Reply-To` settes til melderens epost → «Svar» går rett til brukeren. 1 retry ved forbigående feil
  - **Prod bruker SMTP2GO** (gjenbruker drivstoff-appens creds): `mail-eu.smtp2go.com:2525`, From `noreply@drivstoffprisene.no`
- `share_store.py` — SQLite-lagring av delte observasjonslister (samme `stats.db`)
  - Schema: `slug, payload, display_name, delete_key, created_ts, expires_ts, views`
  - `sanitize_observations()` hviteliste-filtrerer felt — nye obs-felt lekker ikke ut ved uhell
  - `create_share()`/`get_share()`/`update_share()`/`delete_share()`. `update_share()` overskriver
    `payload`/`display_name`/`email` på samme rad, urørt `expires_ts`
  - Bevisst **ikke** Redis: SQLite gir persistens, backup og «utløpt»-melding gratis. Se `docs/deling-av-observasjoner-plan.md`
- `fellestur_store.py` — SQLite-lagring av fellesturer (samme `stats.db`). Delt kladdebok — alle
  med koden kan legge til, rette og slette. 5-sifret kode. Full observasjonsmodell gjenbrukes
  (samme felt som arbeidslista), koordinater aldri lagret (`sanitize_observasjon()`). `apply_sync()`
  tar en valgfri `on_event(type, obs_id, obs)`-callback — brukt av `fellestur_peer.py` til å bygge
  utgående federasjons-events uten å forurense det vanlige klient-svaret
- `fellestur_peer.py` — Kryss-app-føderasjon for Fellestur (v1: Feltlogg). Tynn oversettelsesbro,
  IKKE en egen datamodell — peer-events anvendes på samme `fellestur_obs`-tabell via
  `fellestur_store.apply_sync()`. Se `docs/ANALYSIS_FELLESTUR_FODERASJON.md` for full analyse
  - Eget inbound-secret på `FELLESTUR_PEER_SECRET_PATH` (default `/data/fellestur_peer_secret.txt`,
    docker-volum — IKKE i repo-mappen, overlever ikke en rebuild ellers), generert automatisk
    første gang, `hmac.compare_digest` mot innkommende `Authorization: Bearer`
  - Providere (den andre partens URL + DERES hemmelighet vi skal sende) i
    `FELLESTUR_PEER_PROVIDERS_PATH` (default `/data/fellestur_peer_providers.json`). Manglende fil
    = ingen peers = funksjonen er et rent no-op
  - `count`-events fra en peer anvendes som delta (`max(1, lokal+delta)`); utgående fra oss er
    alltid `add`/`update`/`delete` (aldri en ekte delta) — akseptert forenkling, se analysen
  - **Automatisk forwarding av ALLE fellesturer i v1** (ingen opt-in), bevisst besluttet av
    produkteier. Avgjørelsen sitter i `skal_forwardes(tur)` — endre KUN den funksjonen om dette
    skal bli betinget senere
  - Idempotens på mottatte peer-event-ider i egen tabell `fellestur_peer_seen`, ryddet etter 7 dager
- `location_db.py` — SQLite-cache for AO-lokasjoner (delt mellom containere via Docker-volum)
  - Aktiveres med `LOCATION_DB_PATH` env-var
  - Schema: `ao_id, name, lat, lon, is_private, is_super, parent_id, municipality, county, source`
  - `search_by_name(query, limit, lat, lon)` — tekstsøk, sorterer etter avstand hvis lat/lon gitt
  - `search_nearby(lat, lon, radius_m)` — geo-søk (haversine, radius i meter)
  - `upsert_locations(sites, source)` — idempotent insert/update
  - **Super-deteksjon**: AO ByBoundingBox returnerer `parentSiteId=null` i sanntid. Super-status utledes i merge-steget fra lokal DB sin `parent_id` — hvis en lokal site peker på en foreldreside som finnes i AO-resultatet, markeres forelderen `isSuper=True`.
  - **Viktig**: `is_private` i lokal DB kan være utdatert (site endret til privat etter import). Bbox-størrelse (`_compute_bbox`) dekker nå full `size_m`-radius slik at AO-APIet returnerer korrekt `isPrivate` for sites i ytterkanten.
  - `get_cached_areas(site_id)`/`set_areas(site_id, areas_str)` — cache for AOs Areas-ID-er
    (fylke/kommune) per lokalitet, 30 dagers TTL. `set_areas()` oppdaterer kun eksisterende rad —
    en helt ny AO-lokalitet (ikke i lokal DB fra før) hoppes stille over. Brukt av sjeldenhetsvarselet

### Frontend Modules (public/js/)
Pure ES6 modules with no framework:
- `api.js` — API communication with 1-hour species cache
  - `createAoSite()` legger den nye lokasjonen rett inn i `ao_private_sites`-cachen (localStorage,
    24t TTL) fra opprettelsessvaret — IKKE via refetch fra AO (unngår en read-after-write-avhengighet
    mot AOs API). Uten dette var nyopprettede private lokasjoner usynlige i «Velg lokasjon» i opptil
    et døgn, siden cachen ellers kun fornyes ved innlogging eller når den tilfeldigvis er tom (v1.53.0)
- `location.js` — Geolocation and AO sites integration
- `rarity.js` — Sjeldenhetsvarsel: debounced, race-sikker sjekk mot `/api/ao-rarity` når både art og
  lokasjon er valgt (både felt- og etterregistrering). Se `/api/ao-rarity` over og `docs/sjeldenhetsvarsel.md`
- `celebrate.js` — `celebrateRareFind(speciesName)`: fyrverkeri (konfetti + stort banner + kort
  Web Audio-klang, ingen lydfil) over hele skjermen når en registrert observasjon har en aktiv
  sjeldenhetsvarsel-boks. Trigges fra `observation-commit.js` rett der `obs.rarityWarning` fanges
  (v1.53.1). Bevisst stort — skjer sjelden, i motsetning til den vanlige registrerings-toasten
  - Kalt i try/catch fra kalleren — en kosmetisk feil her skal aldri kunne ta med seg lagringen
    av selve observasjonen
  - Den vanlige "art registrert"-toasten droppes ved sjeldent funn (kolliderte visuelt med
    banneret, som allerede sier "Sjeldent funn: X!") — se `celebratedRareFind`-flagget i
    `observation-commit.js` (v1.53.2)
  - Respekterer `prefers-reduced-motion` (banner uten bevegelse, ingen konfetti)
- `observations.js` — Main observation form logic
  - Gruppeoverskriften i ③ har tre knapper: ↩ (tilbake til besøket), 🔒 (lås besøk), 🕐 (sett klokkeslett)
  - **↩ = «gå tilbake til akkurat dette besøket»**, ikke bare «bytt lokalitet». Modulen eier ikke
    `appState` og sender `CustomEvent('obs:bruk-lokalitet', {detail:{placeName, placeId, visitKey,
    visitLocked}})` på `document`. Lytteren i `main.js` setter `currentPlaceName`/`currentPlaceId`
    **og `etterregVisitKey`**, kollapser ① og fokuserer art-feltet
  - Så lenge `etterregVisitKey` er satt, hopper `observation-commit.js` over
    `resolveVisitIdForNewObservation`: obsen får det besøkets `visitId`, besøkets **tidsspenn**
    (`getVisitTimeSpan()` → `timestamp`=fra, `tilKlokkeslett`=til) og besøkets `visitLocked`.
    Man vet at arten ble sett i løpet av besøket, ikke nøyaktig når. Uten arvet lås ville et låst
    besøk stille låse seg opp igjen (gruppa regnes som låst bare når *alle* obsene i den er det)
  - **Fremtids-valideringen kjører etter overstyringen**, ikke før: det er tidene som faktisk lagres
    som skal valideres. Sto skjemaets klokke frem i tid i etterregistreringsmodus, ble ↩-registreringen
    ellers avvist for en tid som aldri kom til å bli brukt
  - `etterregVisitKey` nullstilles av `avsluttEtterregistrering()` fra alle andre måter å sette plass
    på (GPS-dropdown, autocomplete, kartvalg, manuell skriving) og fra `expandLocation()` —
    «Bytt plass» er den synlige veien tilbake til «nå»-registrering
  - Merket `#loc-pinned-visit` i den festede lokasjonslinja viser tidsspennet man får («↩ 17:09–17:18»,
    «🔒 ↩ 17:09» for låst besøk / ett tidspunkt). Tida skal aldri settes i det skjulte
  - **Full beskrivelse:** `docs/besok-og-tilbake-til-besok.md` (begrepet besøk, tidsregelen,
    fallgruver, testdekning)
- `observation-commit.js` — Observation validation and activity pills rendering
  - Fanger en synlig sjeldenhetsvarsel-boks (`dom.rarityWarning`) ved registrering inn i
    `obs.rarityWarning = {header, body}` — vist som ⚠️-merke i lista (`observations.js`)
  - `edit-modal.js` nullstiller `obs.rarityWarning` hvis art/lokasjon/dato endres ved redigering
    — det gamle AO-svaret er ellers ikke lenger til å stole på
- `storage.js` — Browser localStorage management (includes activity pills config)
  - `saveObservations()` returnerer `true`/`false` for om `localStorage.setItem()` faktisk
    lyktes (full kvote, f.eks. store bilder på iOS Safari, kaster ellers i stillhet).
    `lastSaveError` (live-binding export) har teknisk feilbeskrivelse til varsling.
    **Viktig:** alle sider som lagrer observasjoner må importere `saveObservations` herfra —
    en lokal, egendefinert kopi med samme navn i `edit.html` forårsaket en kritisk regresjon
    (v1.43.8→v1.43.9) der returverdien alltid var `undefined`
  - **Sendt-logg** (`sent_observations_v1`): `appendSentBatch()` / `loadSentBatches()`
  - Publiserte obser stemples med `sentTs` i arbeidslista → «✓ sendt»-merke og dublett-vern
    før neste sending. `sentTs` strippes ved «Kopier til lista» fra `sendt.html`
  - Kvittering for det som er publisert, 7 dager / maks 200 obs (`SENT_MAX_DAYS`, `SENT_MAX_OBS`)
  - Skrives i `handleDirectSend` **før** «tøm lista»-spørsmålet — ellers er kvitteringen borte
  - Opprydding skjer ved lesing og skriving; ingen cron
- `ui.js` — UI state and rendering
- `share.js` — Deling av funn: forhåndsvisning, lenke-generering, oppdatering og tilbaketrekking
  - «Dagens funn» = **nyeste observasjonsdato i lista**, ikke kalenderdagen (viktig for etterregistrering)
  - Lagrer visningsnavn i `shareDisplayName_v1` og egne delinger i `myShares_v1`
    (`{slug, deleteKey, ts, displayName, obsCount, dato, expiresTs}`) — samme `slug` oppdateres
    på plass i stedet for å dupliseres. Eksporterer `hentMineDelinger()`/`glemDeling()` for
    `mine-delinger.html`
  - `openShareDialog(observations, existing = null)` — satt `existing` ({slug, deleteKey}) åpner
    samme dialog i oppdater-modus mot `/api/share-update` i stedet for `/api/share`
  - Bilder: `nedskalerMedFallback()` prøver `downscaleForShare()` trinnvis (800px/q0.55 →
    640/0.4 → 480/0.32 → 400/0.28) til resultatet er under ~50 KB, fra `obs.photo` — atskilt
    fra den større AO-kvalitets-thumbnailen `edit.html` lager
- `autocomplete.js` — Lokalitet-autocomplete med avstand og ikoner (🏷️ super, 👤 privat, ⭐ mine)
  - Aktivt i **begge** modi (Felt og Etterregistrering)
  - `initAutocomplete(placeInput, onSelect, getPosition)` — getPosition gir GPS-posisjon for sortering
- `map.js` — Kartvisning (Leaflet) med brukerposisjon, AO-lokaliteter og pin-drop for ny lokasjon
  - Kartlag: OpenStreetMap (standard), Kartverket Topo, Kartverket Gråtone — velges via `L.control.layers` nederst til venstre
  - Kartverket-tiles er gratis WMTS uten nøkkel (`cache.kartverket.no/v1/wmts/1.0.0/{topo|topograatone}/...`)

### Konfigurerbare Aktivitetspills (v1.18.0+)
Brukere kan velge 0-6 aktiviteter som vises som hurtigknapper:
- **localStorage-nøkkel:** `activityPills_v1`
- **Format:** `{version: 1, pills: [{label: "Stasjonær", value: "23", short: "Stasj"}, ...]}` (`short` valgfritt, maks 5 tegn — kortnavn på pill; tomt = fullt navn)
- **Funksjoner:** `saveActivityPills()`, `loadActivityPills()` i `storage.js`
- **UI:** Settings-side med dynamisk liste og +/- knapper
- **Migrering:** Automatisk fra gammelt `activityPillCount` format
- **Default:** 4 pills (Stasjonær, Rastende, Overflygende, Næringssøkende)
- **Dokumentasjon:** Se `docs/aktivitetspills-konfigurasjon.md`

### Test Structure
- `tests/test_*.py` — Python unit tests (pytest)
- `tests/unit/*.test.js` — JS-enhetstester (vitest, jsdom), kjøres med `npm test` fra repo-roten
- `tests/e2e_playwright/` — Playwright E2E tests with mock server support

## Key Conventions

### Language
All code comments, docs, and UI text in **Norwegian** (`nb`). Maintain this consistency.

Claude skal alltid svare på norsk bokmål i denne samtalen/dette repoet, med mindre brukeren
eksplisitt ber om et annet språk.

### External API Error Handling
External API failures return graceful degraded responses (empty arrays, status 200) rather than 500 errors:
```python
except Exception as e:
    print('Feil ved henting fra Artsobservasjoner:', e)
    self._send_json({'sites': []}, status=200)  # NOT 500
```

### External API Ethics
- Never run aggressive load tests against public APIs (Nominatim, Artsobservasjoner)
- Use `docker-compose` mock or `--mode gentle` with low request counts
- External API calls require explicit `User-Agent` headers (already configured)

### Environment Variables
- `PORT` (default: 3000)
- `AO_URL` (default: `https://www.artsobservasjoner.no`) — base-URL for artssøk
- `AO_MOBILE_URL` (default: `https://mobil.artsobservasjoner.no`) — base-URL for AO-lokaliteter
- `NOMINATIM_URL` (default: `https://nominatim.openstreetmap.org/reverse`) — reverse geokoding
- `LOCATION_DB_PATH` (optional) — sti til SQLite-DB med AO-lokasjoner
  - På Pi: `/mnt/ssd/docker/volumes/shared-locations/_data/locations.db`
  - Aktiverer lokalt navnesøk og avstandssortering i autocomplete uten innlogging
  - Fylles med `tools/import_ao_locations.py` (~487k norske lokasjoner, 78 MB)
- `SUPABASE_URL`, `SUPABASE_KEY` (optional logging)
- `STATS_KEY` (stats- og feedback-admin auth, default: 'salo')
- **Tilbakemelding-epostvarsel** (alle valgfrie — uten dem er varsling en no-op, skjema virker uansett):
  - `FEEDBACK_NOTIFY_TO` — mottaker (eier). Uten denne sendes ingenting
  - `FEEDBACK_NOTIFY_FROM` — avsender (må være verifisert hos provideren)
  - `SMTP_HOST`, `SMTP_PORT` (default 2525), `SMTP_USER`, `SMTP_PASS` — SMTP-utsending (prioriteres)
  - alternativt `RESEND_API_KEY` eller `SMTP2GO_API_KEY` for HTTP-API-utsending
  - Prod (Pi) og staging (Fly) bruker SMTP2GO SMTP; ligger som secrets/`.env` utenfor repo
- **Fellestur-føderasjon** (begge valgfrie — uten dem virker Fellestur som før, ingen forwarding):
  - `FELLESTUR_PEER_SECRET_PATH` (default `/data/fellestur_peer_secret.txt`) — vårt eget
    inbound-secret, auto-generert. Gi denne filens innhold til en peer som skal kunne kalle OSS
  - `FELLESTUR_PEER_PROVIDERS_PATH` (default `/data/fellestur_peer_providers.json`) — liste over
    `[{name, url, secret}]` der `secret` er DEN ANDRE partens inbound-secret. Manglende fil = ingen
    peers konfigurert

For å teste med mock (simulere AO-timeout):
```bash
python3 mock/nominatim_app_timeout.py &                # Start mock på port 8080
AO_URL=http://localhost:8080 AO_MOBILE_URL=http://localhost:8080 python3 server.py
```

### Mobile Considerations
- Input `font-size: 16px` minimum to prevent iOS zoom
- App is fully functional without Supabase (optional dependency)

### Geolocation Limitations
- **Mobil (anbefalt):** GPS gir nøyaktig posisjon (5-50 meter)
- **PC/Mac:** Kun IP-basert lokalisering, kan gi feil posisjon (flere km avvik)
- Appen er primært designet for bruk på mobil i felt

### Git Commits
- **Aldri bruk Co-Authored-By** - commit uten co-author linje

### Deploy
- **«Prod» = Raspberry Pi** (`update-ao-pi.sh`), ikke Fly.io. Fly kjøres kun som sjelden brukt backup.
- **Pi-staging** (`deploy-staging-pi.sh`, `https://aos.efugl.no`) kjører pytest+vitest selv
  før deploy og er det reelle test-miljøet (Fly-staging mangler `LOCATION_DB_PATH`, så stedssøk
  uten AO-innlogging ikke virker der). Bruk denne før `update-ao-pi.sh` ved usikre endringer.
  Fly har fra nå av kun rolle som reserve om Pi går ned — se README.md.
- **`update-ao-pi.sh` kjører IKKE tester selv** — kjør `pytest`+`npm test` manuelt før bruk.
- **Fly production deploy**: `update-app.sh production` kjører automatisk `python3 -m pytest --maxfail=3` først. Deploy avbrytes hvis tester feiler.

### Versjonering
Ved ny versjon, gjør alltid følgende:
1. Oppdater `VERSION` i `public/js/version.js` (brukes av `help.html`/`feedback.html` footers via import)
2. **`public/index.html` har TRE EGNE inline `VERSION`-konstanter** (main.js-cache-bust, SW-registrering,
   footer-tekst) — importerer bevisst IKKE fra `version.js` (unngår at en cachet gammel `version.js`
   forteller usant om seg selv). Kjør `grep -n "v[0-9]*\.[0-9]*\.[0-9]*" public/index.html` og bump
   ALLE treff, ikke bare `version.js`.
3. **Bump `CACHE_NAME` i `public/sw.js`** (`fugleobs-vNN` → `vNN+1`). **Uten dette henter
   installerte PWA-er aldri ny JS** — sw.js må endres for at nettleseren skal trigge
   install/activate. Nye JS-moduler må også legges til i `STATIC_ASSETS`.
4. Oppdater `public/changelog.html` med kort beskrivelse av hva som er nytt
5. Oppdater relevant dokumentasjon i `docs/` hvis funksjonalitet er endret
