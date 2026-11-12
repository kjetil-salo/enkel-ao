# public — statisk dokumentrot og PWA-skall

## Overview

Dokumentroten `server.py` serverer. Katalogen inneholder alt klienten laster:
service workeren, elleve HTML-sider, web-app-manifestet, ikonene, og
underkatalogene med moduler, stilark, data og bilder.

Arkitekturen er bevisst flat og uten byggesteg. Hver HTML-side er sin egen
inngang som laster de ES6-modulene den trenger direkte fra `./js/`. Det finnes
ingen bundler, ingen transpilering og ingen ruter på klientsiden — navigasjon
mellom sidene er vanlige lenker. Filene her er derfor identiske med det
nettleseren faktisk kjører.

Katalogens eget kildeinnhold er `sw.js`, som gjør appen til en PWA. Den gjør to
ting: forhåndslaster app-skallet slik at sidene virker uten nett, og håndhever
appens tre nettverksmodi (`online` / `hybrid` / `offline`) på hver enkelt
forespørsel. Modusen eies av [js/offline-db.js:setNetworkMode] og kommer inn
hit via `postMessage`, med en kopi i Cache API som overlever at workeren startes
på nytt.

Den største fellen i denne katalogen er cache-versjonering. `sw.js` må endres
for at nettleseren i det hele tatt skal trigge `install`/`activate` — uten en
bumpet `CACHE_NAME` henter installerte PWA-er aldri ny JavaScript, uansett hva
som er deployet. Se Invariants.

## Interface

### Underkataloger

- **js**: [./js/EGM.md](./js/EGM.md) — all klientlogikk. 38 ES6-moduler uten
  rammeverk: inngangsskript per side ([js/main.js:init], [js/map.js:startMapUI],
  `js/fellestur.js`), lagringslaget ([js/storage.js:saveObservations],
  [js/offline-db.js:getNetworkMode], [js/fellestur-sync.js:synk],
  [js/visits.js:resolveVisitIdForNewObservation]), eneste backend-klient
  ([js/api.js:fetchAoSitesCached]), og ren, enhetstestet logikk
  ([js/species-matcher.js:searchSpecies], [js/kart-visning.js:nesteVisning],
  [js/bilde-editor.js:hentResultat], [js/offline-area.js:clampTilAreal]).
- **css**: sju lagdelte stilark (`1-tokens.css` … `7-page-specific.css`).
  Ingen kildekode etter EGMs definisjon, derfor ingen egen kontraktfil. Alle sju
  står i [sw.js:STATIC_ASSETS].
- **data**: `activities.json`, `norske_arter.json`,
  `norske_arter_hierarki.json`. Lest av [js/api.js:loadActivities] og
  [js/species_offline.js:loadOfflineSpecies]; alle tre er precachet i
  [sw.js:STATIC_ASSETS]. Ingen egen kontraktfil (ren data).
- **img**: bilder brukt av nyhetssplashen. Ingen egen kontraktfil.

### sw.js — service workeren

- [sw.js:CACHE_NAME] — app-skallets cache-navn, gjeldende verdi `'fugleobs-v208'`.
- [sw.js:MAP_TILE_CACHE_NAME] — `'enkel-ao-kartverket-tiles-v1'`, delt med
  [js/offline-area.js:MAP_TILE_CACHE_NAME].
- [sw.js:NETWORK_MODE_CACHE_URL] — `'https://enkel-ao.local/__network_mode__'`,
  den syntetiske nøkkelen modusen lagres under.
- [sw.js:STATIC_ASSETS] — lista over alt som forhåndslastes ved `install`:
  sidene, de sju stilarkene, manifestet, ikonene, hver enkelt JS-modul, de tre
  datafilene, og Leaflet + markørikoner fra eksterne CDN-er.
- [sw.js:normalizeSwMode] — normaliserer en modusstreng; ukjent verdi gir
  `'hybrid'`.
- [sw.js:resolveSwNetworkMode] — leser modus først fra minne
  (`currentNetworkMode`), deretter fra Cache API hvis workeren er startet på
  nytt.
- Rutingpredikatene [sw.js:isApiRequest], [sw.js:isMapTileRequest],
  [sw.js:isAppShellRequest], [sw.js:isExternalAssetRequest] og de fire
  tilhørende strategiene [sw.js:handleApiFetch], [sw.js:handleMapTileFetch],
  [sw.js:handleAppShellFetch], [sw.js:handleExternalAssetFetch].
- [sw.js:matchAppShell] — cache-oppslag med `ignoreSearch`-fallback, og
  fallback til `/` eller `/index.html` for navigasjoner.
- [sw.js:openCacheSafe] — `caches.open` som svarer `null` i stedet for å kaste.
- Hendelseslyttere: `install`, `activate`, `message` (`SET_NETWORK_MODE`) og
  `fetch`.

### HTML-sider (inngangspunkter)

Hver side laster `/js/theme.js` først for å unngå tema-blink.

| Side | Rolle | Egne modulimporter |
| --- | --- | --- |
| `index.html` | Hovedsiden: registrering i tre trinn | `main.js?v=`, `header-plass.js?v=`, `migration-banner.js`, `storage.js`, `photo-picker.js?v=` |
| `map.html` | Leaflet-kart, pin-drop, offline-områder | `map.js?v=` |
| `sendt.html` | «Tidligere sendt» + bilde i etterkant | `storage.js`, `share.js`, `photo-picker.js?v=`, `bilde-editor.js?v=`, `api.js?v=` |
| `settings.html` | Innstillinger, AO-innlogging, offline-lager | `storage.js?v=`, `api.js?v=`, `location.js?v=`, `offline-db.js?v=` |
| `fellestur.html` | Delt feltloggbok for en gruppe | `fellestur.js?v=` |
| `mine-delinger.html` | Brukerens egne delingslenker | `share.js`, `storage.js` |
| `ao-direct.html` | Direkte AO-import, egen inline-logikk | ingen (inline) |
| `medobs.html` | Medobservatør-administrasjon | ingen (inline) |
| `feedback.html` | Tilbakemeldingsskjema | `version.js` |
| `help.html` | Hjelpeside | `version.js` |
| `changelog.html` | Endringslogg (ren tekst) | ingen |

### manifest.json

Statisk web-app-manifest: `name`/`short_name` er `"Enkel-AO"`, `display`
`"standalone"`, `orientation` `"portrait-primary"`, og ikoner fra
`/favicon.png`, `/icon-192.png`, `/icon-512.png` med både `any` og `maskable`.
Precachet via [sw.js:STATIC_ASSETS]. Filen serveres dynamisk av `server.py` når
`APP_ENV=staging`, med nedtonede ikoner og eget navn.

## Invariants

### Cache-versjonering (den enkeltregelen det er lettest å brekke)

- **[sw.js:CACHE_NAME] MÅ bumpes ved hver ny versjon.** `sw.js` må være endret
  for at nettleseren skal trigge `install`/`activate` i det hele tatt. Uten
  bumpen henter en installert PWA aldri ny JavaScript, uansett hva som ligger på
  serveren.
- **Nye JS-moduler MÅ legges i [sw.js:STATIC_ASSETS].** `activate` sletter alle
  cacher unntatt [sw.js:CACHE_NAME] og [sw.js:MAP_TILE_CACHE_NAME], så en modul
  som mangler i lista blir borte ved neste versjon. Kommentaren ved
  `'/js/kart-visning.js'` i [sw.js:STATIC_ASSETS] dokumenterer presedensen:
  `map.js` importerer den, og mangler den i lista feiler ES-modul-importen
  offline — hele `map.js` evalueres aldri, og kartet blir blankt.
- **Service workeren registreres med en versjonert URL.** `index.html` gjør
  `navigator.serviceWorker.register('/sw.js?v=' + VERSION)` fordi Cloudflare
  overstyrer origins `max-age=300` med fire timer, slik at en endret `/sw.js`
  ellers kan ligge i edge-cachen og aldri nå installerte apper.
- **Versjonsstrengen står tre steder i `index.html`**, bevisst atskilt fra
  `js/version.js`: modultaggen `src="/js/main.js?v=…"`, en inline
  `const VERSION` for SW-registreringen, og en inline `const VERSION` for
  footer-teksten. Grunnen står i koden: `/js/version.js` kan selv være cachet i
  en gammel versjon og dermed fortelle usant om seg selv. Bump alle tre pluss
  `js/version.js`.
- **Sider med egen versjonert modultagg må bumpes hver for seg.** I dag gjelder
  det `index.html` (`main.js?v=`), `map.html` (`map.js?v=`) og `fellestur.html`
  (`fellestur.js?v=`). Glemmes en, kan Cloudflare holde fast på gammel JS for
  akkurat den siden i opptil fire timer etter deploy.
- **Også interne `import … from './x.js?v=…'` mellom modulene må bumpes.**
  Disse har normalt ingen `?v=` i det hele tatt. En stale kopi som mangler en
  nylig lagt til navngitt eksport gir `SyntaxError` ved modul-lasting, og det
  stopper HELE det importerende skriptet — ikke bare den ene funksjonen. Se
  [./js/EGM.md](./js/EGM.md) for hvilke importer som er versjonert i dag.
- Precachede bilder lastes ned av ALLE brukere, også de på mobildata i felt.
  `img/nyhet-offline-kart.jpg` og `img/espen.jpg` står i
  [sw.js:STATIC_ASSETS]; hold slike filer små.

### Installasjon og aktivering

- `install` er **fail-closed**: feiler én lokal ressurs, slettes hele
  [sw.js:CACHE_NAME] og feilen kastes videre, slik at den gamle, fungerende
  workeren blir stående. Et halvt app-skall er verre enn et gammelt.
- Eksterne ressurser (Leaflet, markørikoner fra CDN) er **valgfrie**: feilen
  telles bare når `new URL(asset, self.location.origin).origin` er samme origin.
  En CDN-glipp skal ikke blokkere en oppdatering.
- Står appen i `'offline'`-modus og `/index.html` alt ligger i cachen, hoppes
  hele forhåndslastingen over — ellers ville en oppdatering brukt mobildata i
  felt stikk i strid med modusen brukeren valgte.
- `activate` sletter alle cacher unntatt [sw.js:CACHE_NAME] og
  [sw.js:MAP_TILE_CACHE_NAME]; nedlastede kartfliser skal aldri forsvinne i en
  vanlig oppdatering. Samme regel speiles i
  [js/offline-db.js:clearAppCachesPreservingMapTiles].
- Både `install` og `activate` tar over umiddelbart (`skipWaiting` +
  `clients.claim`).

### Rutingrekkefølge i `fetch`

Rekkefølgen er ikke vilkårlig:

1. **`/api/`-kall sjekkes FØRST** [sw.js:isApiRequest], FØR
   `if (request.method !== 'GET') return;`. Snus dette, slipper POST-kallene
   forbi offline-sperren.
2. Ikke-GET returnerer uhåndtert.
3. Kartfliser [sw.js:isMapTileRequest] — verter som inneholder
   `cache.kartverket.no` eller `tile.openstreetmap.org`.
4. App-skall [sw.js:isAppShellRequest] — samme origin, ikke `/api/`.
5. Eksterne ressurser [sw.js:isExternalAssetRequest] — annen origin, og
   `request.destination` i `['script', 'style', 'image', 'font']`.

### Nettverksmodus håndhevet i service workeren

- Gyldige verdier er `'online'`, `'hybrid'`, `'offline'`, med `'hybrid'` som
  standard [sw.js:normalizeSwMode] — samme standard som
  [js/offline-db.js:DEFAULT_NETWORK_MODE]. De to stedene må holdes i synk.
- Modusen leses fra minne først, fra Cache API deretter
  [sw.js:resolveSwNetworkMode]. Cache-kopien finnes nettopp fordi en service
  worker termineres og startes på nytt uten at siden lastes om.
- **Kartfliser** [sw.js:handleMapTileFetch]: `offline` = strengt cache-only,
  bom gir `504 'Offline Mode (Strict Cache Only)'`. `hybrid` = cache først,
  nettverk som fallback. `online` = nettverk først, med cache som fallback ved
  feil. I begge nettverksmodi lagres svaret, også `type === 'opaque'`.
- **App-skallet** [sw.js:handleAppShellFetch]: i `offline` går det ALDRI til
  nettverket, ikke engang for å revalidere. Dette er en rettet feil, ikke en
  forenkling — tidligere gikk hver side-, JS-, CSS- og JSON-forespørsel til
  nettverket med `cache: 'no-cache'` selv i offline-modus, og brukte mobildata.
- **Men offline-modus har en bevisst nødutgang:** mangler ressursen i cachen,
  prøves nettverket likevel, slik at appen ikke låses permanent i 504. Samme
  nødutgang i [sw.js:handleExternalAssetFetch].
- **`/api/`-kall** [sw.js:handleApiFetch]: i `offline` svares
  `503` med `{"error": "Offline-modus: ingen nettverkskall"}` uten å røre
  nettverket. I øvrige modi sendes de uendret videre; ingen API-svar caches
  noensinne.
- **Eneste tillatte omgåelse** er en `POST` til `/api/ao-login` eller
  `/api/ao-import-stream` med headeren `x-allow-offline-network: '1'`
  [sw.js:handleApiFetch]. Lista er hardkodet, og headeren settes kun etter at
  brukeren eksplisitt har godkjent nettverksbruk i
  [js/export-operations.js:handleDirectSend]. Utvides lista, utvides samtidig
  det som kan gå på nett bak ryggen på en bruker som har valgt offline.
- [sw.js:matchAppShell] faller tilbake til `/` eller `/index.html` KUN når
  `request.mode === 'navigate'` — en manglende JS-fil skal aldri svares med
  HTML, for da ville modul-lastingen feile med en forvirrende parse-feil.

### Sidene

- `index.html` setter `apple-mobile-web-app-title` til `"Enkel-AO"`. Navnet
  under hjemskjerm-ikonet må settes BEGGE steder — her for iOS og i
  `manifest.json` sin `short_name` for Android/Chrome. `server.py` genererer
  begge dynamisk når `APP_ENV=staging`, og et nytt ikon i manifestet trenger en
  nedtonet variant der.
- Hver side laster `/js/theme.js` som det første skriptet, før innhold tegnes.
- Alle sider som lagrer observasjoner importerer
  [js/storage.js:saveObservations] fra modulen. En lokal kopi med samme navn
  forårsaket en kritisk regresjon der returverdien alltid var `undefined`, slik
  at en full localStorage-kvote ble tapt i stillhet.
- `changelog.html` er en ren tekstside uten skript, og må oppdateres ved hver
  ny versjon.

## Side Effects

### Cache API

- [sw.js:CACHE_NAME] (`'fugleobs-v208'`) — app-skallet, fylt i `install` og
  oppdatert fortløpende av [sw.js:handleAppShellFetch] og
  [sw.js:handleExternalAssetFetch].
- [sw.js:MAP_TILE_CACHE_NAME] (`'enkel-ao-kartverket-tiles-v1'`) — kartfliser,
  skrevet av [sw.js:handleMapTileFetch] og av
  [js/offline-area.js:downloadTilesInBatches]. Holder også
  [sw.js:NETWORK_MODE_CACHE_URL]-oppføringen.
- `activate` sletter alle andre cacher.

### Service worker-livssyklus

- `navigator.serviceWorker.register('/sw.js?v=' + VERSION)` fra `index.html`.
- `self.skipWaiting()` i `install` og `self.clients.claim()` i `activate` —
  den nye workeren tar over uten å vente på at alle faner lukkes.
- `message`-lytteren muterer modulvariabelen `currentNetworkMode` fra
  `SET_NETWORK_MODE`, sendt av
  [js/offline-db.js:syncNetworkModeToServiceWorker].
- `settings.html` kaller `navigator.serviceWorker.getRegistrations()` for
  administrasjon av offline-lageret.

### Nettverk fra sidenes egne inline-skript

Disse endepunktene kalles direkte fra HTML-sidene, utenom `js/api.js`:

- `ao-direct.html`: `/api/ao-login`, `/api/ao-refresh`, `/api/ao-areas`,
  `/api/ao-import`.
- `sendt.html`: `/api/ao-my-sightings`, `/api/ao-upload-image`,
  `/api/ao-sighting-form`, `/api/ao-sighting-save`, `/api/ao-sighting-abort`,
  `/api/ao-queue-count`, `/api/ao-rarity`, `/api/species`.
- `settings.html`: `/api/ao-login`.
- `medobs.html`: `/api/ao-search-observers`.
- `feedback.html`: `/api/feedback`.
- `mine-delinger.html`: `/api/share-delete` (i tillegg til det
  [js/share.js:openShareDialog] gjør).

Alt annet nettverk går gjennom `./js/`; se [./js/EGM.md](./js/EGM.md).

### Eksterne avhengigheter hentet ved install

[sw.js:STATIC_ASSETS] henter Leaflet 1.9.4 og Leaflet.markercluster 1.5.3 fra
`unpkg.com`, markørskyggen fra `cdnjs.cloudflare.com`, og fem fargede
markørikoner fra `raw.githubusercontent.com`. Alle er valgfrie ved install;
feiler de, fortsetter oppdateringen.

### Lagring på klienten

`sw.js` rører verken localStorage (ikke tilgjengelig i en worker) eller
IndexedDB. All annen klientlagring eies av `./js/` — se
[./js/EGM.md](./js/EGM.md) for de eksakte nøklene og TTL-ene.

## Verification

- Kjør: `npm test`

`npm test` fra **repo-roten** kjører vitest-suiten i
`tests/unit/*.test.js` (jsdom, se `vitest.config.js`).
Samme kommando fra `tests/e2e_playwright/` betyr Playwright i stedet — kjør den
fra roten.

Endringer i denne katalogen bør dekkes av alle tre suitene, siden sidene og
service workeren først og fremst testes ende-til-ende:

```bash
npm test                                    # vitest, fra repo-roten
python3 -m pytest --maxfail=3               # backend, inkl. staging-merking
cd tests/e2e_playwright && npm test         # Playwright E2E
```

`tests/test_env_merking.py` vokter at et nytt ikon i `manifest.json` har en
nedtonet staging-variant i `server.py`.
