# Enkel AO — Blueprint

## System Overview

Webapp for å registrere fugleobservasjoner direkte til Artsobservasjoner.no,
med minst mulig klikk og tastetrykk. Observasjonene bor i nettleseren til de
sendes; sending skjer gjennom AOs eget importskjema.

Arkitekturen er bevisst liten og uten rammeverk:

- **Backend:** Python 3.12, `http.server.ThreadingHTTPServer`. All ruting ligger
  i `server.py`; all forretningslogikk i `src/`. Ingen webrammeverk, ingen ORM.
- **Frontend:** rene ES6-moduler i `public/js/`, lastet direkte av hver
  HTML-side. Ingen bundler, ingen transpilering, ingen klientside-ruter.
- **Lagring:** SQLite på docker-volumet `/data`. Fem lagre deler én fil via
  `DB_PATH`; lokalitetsdatabasen er egen.
- **Drift:** Docker på Raspberry Pi er produksjon. Fly.io er ren reserve.

Appen er en PWA med tre nettverksmodi (`online`/`hybrid`/`offline`) som
håndheves både i service workeren og i klientkoden. Den skal virke i felt, på
mobildata, med dårlig eller ingen dekning — det forklarer de fleste
designvalgene under, særlig at et tomt eller degradert svar fra et eksternt API
aldri får slette noe brukeren allerede ser.

Artsobservasjoner.no har ikke noe offentlig skrive-API. Integrasjonen skraper
derfor AOs egne HTML-skjemaer og poster dem tilbake slik en nettleser ville
gjort. Det er den største kilden til skjørhet i systemet, og grunnen til at
AO-modulene heller stopper med feil enn å gjette når et skjema ikke ser ut som
forventet.

## Local Interface & Invariants

Rotkatalogen inneholder én kildefil: `server.py` (2 049 linjer).

### Grensesnitt

- `[server.py:Handler]` — `SimpleHTTPRequestHandler`-subklasse som eier all
  ruting: `do_GET`, `do_POST`, `do_OPTIONS` (CORS-preflight for
  `X-AO-*`-headerne).
- `[server.py:run]` — starter `ThreadingHTTPServer`, gjør `os.chdir(BASE_DIR)`
  og kaller `adminsti.hent_admin_sti()` ved oppstart, slik at driftssiden kan
  lese fila uten å vente på at noen treffer URL-en.
- **GET:** `/health`, `/manifest.json` (kun ved `APP_NAME_SUFFIX`),
  `/s/<hemmelighet>[/tilbakemeldinger]`, `/d/<slug>`, `/api/species`,
  `/api/reverse`, `/api/ao-sites`, `/api/ao-private-sites`, `/api/ao-areas`,
  `/api/ao-autocomplete`, `/api/ao-rarity`, `/api/fellestur`, ellers statisk.
- **POST:** `/api/logview`, `/api/ao-import`, `/api/ao-import-stream`,
  `/api/ao-queue-count`, `/api/ao-my-sightings`, `/api/ao-upload-image`,
  `/api/ao-sighting-form`, `/api/ao-sighting-save`, `/api/ao-sighting-abort`,
  `/api/ao-login`, `/api/ao-refresh`, `/api/ao-create-site`, `/api/log-export`,
  `/api/ao-search-observers`, `/api/share`, `/api/share-update`,
  `/api/share-delete`, `/api/feedback`, `/api/feedback-status`,
  `/api/fellestur`, `/api/fellestur-bli-med`, `/api/fellestur-oppdater`,
  `/api/fellestur-sync`, `/api/fellestur-peer/<kode>/events`. Alt annet → 404.
- Hjelpere: `[server.py:_rate_ok]`, `[server.py:_rydd_stale_rate_entries]`,
  `[server.py:_max_body_bytes]`, `[server.py:_client_ip]`,
  `[server.py:_tell_bilder_ved_sending]`,
  `[server.py:_read_ao_auth_headers]`, `[server.py:translate_path]`,
  `[server.py:end_headers]`, `[server.py:_send_json]`,
  `[server.py:_send_error_response]`.

### Invarianter

- `[server.py:_client_ip]` bruker `CF-Connecting-IP`, ellers **siste** ledd i
  `X-Forwarded-For` — det er leddet proxyen la til. Første ledd er det klienten
  selv skrev; med det kunne hvem som helst velge sin egen IP, komme rundt
  kvotene og legge HTML inn i IP-lista på statistikksiden.
- `[server.py:_handle_admin_side]` svarer **404** på feil hemmelighet, aldri
  403: en 403 bekrefter at det finnes noe der, og det er hele poenget med en
  hemmelig adresse. Dette er ikke autentisering og er ikke ment å være det.
- `[server.py:_handle_static_files]` sjekker `os.path.realpath` mot
  `PUBLIC_DIR` før en sti serveres. Stier MED filendelse som ikke finnes gir
  ekte 404 med `Cache-Control: no-store`; bare endelsesløse stier faller tilbake
  til `index.html`. Uten skillet ble et manglende bilde servert som appen uten
  CSS, og svaret lå i Cloudflare-cachen i fire timer.
- `[server.py:_max_body_bytes]` håndhever tak på `Content-Length` FØR noe leses:
  `[server.py:_MAX_BODY_DEFAULT]` 1 MB, 100 MB for AO-import,
  `[server.py:_MAX_BODY_FELLESTUR_PEER]` 2 MB, og
  `[server.py:MAX_UPLOAD_PHOTO_CHARS]` 12 MB for ett bilde.
- Åtte uavhengige rate-bøtter samlet i `[server.py:_ALLE_RATE_HITS]`:
  tilbakemelding 5/10 min, deling 10/10 min, fellestur 600, fellestur-poll 600,
  peer 200, `ao-login` 10, `ao-search-observers` 100, `logview` og `log-export`
  120. `[server.py:_rydd_stale_rate_entries]` fjerner IP-nøkler uten treff siste
  time — trygt fordi ingen vindusbredde er over 600 s.
- `[server.py:end_headers]` — `.html` og `/` får `no-cache, must-revalidate`,
  `.js`/`.css` `max-age=300`, alt annet `max-age=3600`. `_cache_header_set` lar
  en handler overstyre.
- `[server.py:APP_NAME_SUFFIX]` — kun `APP_ENV=staging` gir dynamisk
  manifest og index. Tom verdi serverer begge filene helt statisk, uten ekstra
  arbeid i den varme stien.
- `[server.py:_read_ao_auth_headers]` — passord-fallback nøkles på
  `X-AO-Username`, ALDRI `user_id`, som ikke er stabilt per AO-konto.
- `[server.py:_handle_log_export_post]` validerer `type` mot
  `stats_store.KJENTE_HENDELSER`; ukjent verdi degraderes til `'unknown'`.
- `[server.py:_tell_bilder_ved_sending]` trekker fra `imagesFailed` — et bilde
  AO ikke tok imot skal ikke se ut som ett som kom fram.

### Side-effekter

- Lytter på `PORT` (default 3000); én tråd per request. `_stats_lock` og
  `_feedback_lock` beskytter delt minnetilstand.
- Logger til konsoll, og ved `LOG_DIR` også til `fugleobs.log` via
  `RotatingFileHandler` (10 MB × 5 filer) — Docker-loggen overlever ikke rebuild.
- Skriver SQLite via `stats_store`, `feedback_store`, `share_store`,
  `fellestur_store`; sender e-post via `email_notify`; videresender events via
  `fellestur_peer`; leser og genererer admin-stien via `adminsti`.

## Subdirectories & System Boundaries

- **src**: [./src/EGM.md](./src/EGM.md) — hele serversiden utenom rutingen.
  20 Python-moduler i fire lag: AO-broer, SQLite-lagre, serverrendret HTML, og
  drift. Eier grasiøs degradering utover og fail-closed oppførsel innover.
- **public**: [./public/EGM.md](./public/EGM.md) — statisk dokumentrot og
  PWA-skall. Eget kildeinnhold er `sw.js` (504 linjer), som precacher
  app-skallet og håndhever de tre nettverksmodiene på hver forespørsel. Elleve
  HTML-sider er hver sin egen inngang.
- **public/js**: [./public/js/EGM.md](./public/js/EGM.md) — all klientlogikk,
  38 ES6-moduler (16 708 linjer): inngangsskript per side, lagringslag
  (localStorage, IndexedDB, fellestur-speil, besøksmodell), `api.js` som eneste
  backend-klient, enhetstestet ren logikk, og ~19 UI-komponenter.
- **tools**: [./tools/EGM.md](./tools/EGM.md) — operasjonelle skript som kjøres
  manuelt fra repo-roten, aldri av serverprosessen: import og berikelse av
  datagrunnlag, manuelle sikkerhetsporter mot ekte AO, inspeksjon, lasttesting.
  Flere av dem har reelle, irreversible side-effekter mot AO.
- **mock**: [./mock/EGM.md](./mock/EGM.md) — to Flask-mocker som finnes for at
  last- og timeout-testing aldri skal treffe de ekte offentlige API-ene.
- **experiments**: [./experiments/EGM.md](./experiments/EGM.md) — utforskende
  kode som ikke er del av appen i drift. Ikke kjørbar slik repoet står.

Følgende kataloger har bevisst ingen EGM-kontrakt, fordi de ikke inneholder
kildekode etter EGMs definisjon:

- `tests/` — ren testkode (pytest, vitest, Playwright). Se `tests/unit/README.md`
  og `tests/e2e_playwright/README.md`.
- `docs/` — prosjektdokumentasjon i Markdown. `docs/README.md` er inngangen, og
  er autoritativ for designbeslutninger og AO-API-kartlegging.
- `release-notes/` — historiske utgivelsesnotater.
- `public/css/`, `public/data/`, `public/img/` — stilark, datafiler og bilder.
  Alle står i `[public/sw.js:STATIC_ASSETS]`.

## Global Invariants

- **Språk.** All kode, dokumentasjon og UI-tekst er norsk bokmål (`nb`).
  EGM-overskriftene i disse kontraktfilene står på engelsk fordi malen krever
  det; alt innhold er norsk.
- **Versjonsbump er en flerstegsprotokoll, og halv utførelse er usynlig.** En ny
  versjon krever: `[public/js/version.js:VERSION]`, de **tre** egne inline
  `VERSION`-konstantene i `public/index.html` (modultagg, SW-registrering,
  footer — de importerer bevisst ikke fra `version.js`, siden en cachet gammel
  `version.js` ville fortalt usant om seg selv), `[public/sw.js:CACHE_NAME]`,
  de versjonerte modultaggene i `map.html` og `fellestur.html`, versjonerte
  interne `?v=`-imports mellom JS-moduler, og `public/changelog.html`.
  Glemmes `CACHE_NAME`, henter en installert PWA aldri ny JavaScript. Glemmes en
  versjonert modultagg, kan Cloudflare holde fast på gammel JS i fire timer.
- **Eksterne API-feil degraderes, de eskalerer ikke.** Et AO- eller
  Nominatim-problem gir tom liste og HTTP 200, aldri 500. Men et TOMT svar er
  ikke bevis på et tomt resultat: det caches aldri, og det får aldri slette
  lokaliteter, private lokasjoner eller kø-antall brukeren allerede ser.
- **Fail-safe-retningen er valgt bevisst, og den er ikke symmetrisk.** «Vet
  ikke» (`None`) behandles som den trygge antagelsen, ikke som null: kun en
  BEKREFTET `0` i AOs gjennomgangskø slår av scoped publisering, og kun en
  bekreftet tilstand regnes som bekreftet. Å gjette «tomt» ville gjenåpnet en
  bug der andres ventende funn ble publisert.
- **Koordinater forlater aldri enheten gjennom deling eller fellestur.** Både
  `[src/share_store.py:sanitize_observations]` og
  `[src/fellestur_store.py:sanitize_observasjon]` er hvitelister, ikke
  svartelister, slik at et nytt observasjonsfelt ikke kan lekke ved uhell.
  Observasjoner med `hideUntil` slippes aldri gjennom.
- **Ekstern API-etikk.** Ingen aggressiv lasttesting mot Nominatim eller
  Artsobservasjoner. Alle utgående kall setter eksplisitt `User-Agent`.
  Importskriptene har pauser som også kjøres når et kall feilet.
- **Hemmeligheter bor i docker-volumet `/data`, ikke i repo-mappen** — admin-sti,
  peer-secret og peer-providere. Ligger de i repo-mappen, forsvinner de ved
  hver rebuild.
- **`npm test` betyr to ulike ting avhengig av katalog:** vitest fra repo-roten,
  Playwright fra `tests/e2e_playwright/`. Ved frontend-endringer kjøres alle tre
  suitene.
- **Produksjon er Raspberry Pi** (`update-ao-pi.sh`), ikke Fly.io.
  `update-ao-pi.sh` kjører ikke tester selv. `deploy-staging-pi.sh` gjør det, og
  Pi-staging er det reelle testmiljøet — Fly-staging mangler
  `LOCATION_DB_PATH`, så stedssøk uten AO-innlogging virker ikke der.

## Global Side Effects

- **SQLite på `/data`:** `stats.db` deles av `stats`/`exports`, `feedback`,
  `shares`, `fellesturer`/`fellestur_obs` og `fellestur_peer_seen`.
  `locations.db` (~487 000 norske AO-lokasjoner, 78 MB) er egen, delt mellom
  containere via docker-volum i WAL-modus.
- **Artsobservasjoner.no:** lesing (artssøk, lokaliteter, egne funn,
  sjeldenhetsvurdering) og skriving (CSV-import, publisering, bildeopplasting,
  redigering, opprettelse av lokalitet). Skrivingene er reelle og delvis
  irreversible — `[src/ao_edit.py:aapne_skjema]` gjør et publisert funn
  midlertidig upublisert bare ved å bli åpnet.
- **OpenStreetMap Nominatim:** reverse-geokoding, 1 request/sek.
- **Artsdatabanken Artskart:** artsnavn ved synkronisering av artslista.
- **SMTP2GO:** eiervarsel ved ny tilbakemelding, med `Reply-To` satt til
  melderen. Ren no-op hvis ukonfigurert.
- **Supabase:** valgfri analytics-backup. Appen er fullt funksjonell uten.
- **Kartverket og OpenStreetMap:** kartfliser, også nedlastet til Cache API for
  offline bruk (tak 250 km² per område).
- **Cloudflare foran produksjon:** `max-age=14400` på JS gjør cache-busting til
  en korrekthetssak, ikke en ytelsessak.
- **Fellestur-føderasjon:** utgående events til konfigurerte peer-servere
  (v1: Feltlogg). Manglende providerfil betyr ingen peers og dermed no-op.

## System Verification

- Run: `python3 -m pytest` (Python, fra repo-roten)
- Run: `npm test` (JS-enhetstester, vitest, fra repo-roten)
- Run: `cd tests/e2e_playwright && npm test` (E2E, mot server på
  `localhost:3000`)
