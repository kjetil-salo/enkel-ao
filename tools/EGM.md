# tools

## Overview

Operasjonelle engangs- og vedlikeholdsskript som kjøres manuelt fra repo-roten —
ikke en del av serverprosessen. Katalogen har fire grupper: import og berikelse av
datagrunnlag (`import_ao_locations.py`, `enrich_nynorsk.py`, `sync_species.py`,
`xlsx_to_json.py`), sikkerhetsporter og røyktester mot Artsobservasjoner
(`ao_noop_roundtrip.py`, `ao_edit_smoketest.py`), inspeksjons- og
feilsøkingsverktøy (`ao_site_inspect.py`, `check_ao_sites.py`,
`compare_ao_geojson.py`, `smoke_test.sh`) og drift (`load_test.py`,
`migrate_user_agents.py`, `ping_render.py`).

Flere av skriptene snakker med offentlige, eksterne API-er (Artsobservasjoner.no,
OpenStreetMap Nominatim, Artsdatabanken Artskart) og noen skriver destruktivt til
SQLite, til `public/data/norske_arter.json` eller til ekte, publiserte
AO-observasjoner. Pausene, grensene og legitimasjons-rekkefølgen som er kodet inn
er bevisste og må ikke fjernes — se avsnittene nedenfor.

Forretningslogikken ligger ikke her. Skriptene er tynne CLI-skall over moduler i
`src/` (`src/location_db.py`, `src/species_sync.py`, `src/ao_edit.py`,
`src/ao_sightings.py`, `src/api_handlers.py`, `src/supabase_log.py`).

## Interface

Import og berikelse av datagrunnlag:

- `[import_ao_locations.py:main]` — batch-import av offentlige AO-lokasjoner til
  SQLite. Skanner Norge med et rutenett og upserter per celle.
- `[import_ao_locations.py:fetch_sites_in_bbox]` — ett kall mot AOs
  `/core/Sites/ByBoundingBox`.
- `[import_ao_locations.py:fetch_municipality]` — reverse-geokoding mot Nominatim,
  brukt kun som fallback. Returnerer `(None, None)` ved feil.
- `[import_ao_locations.py:normalize_sites]` — oversetter AOs varierende
  feltnavn til `location_db`-formatet.
- `[import_ao_locations.py:_frange]` — flytallsgenerator uten akkumulert
  avrundingsfeil.
- `[sync_species.py:main]` — CLI over `src/species_sync.sync_species_data()`.
  Flagg: `--nynorsk N`, `--dry-run`, `--json-path`. Returnerer exitkode.
- `[enrich_nynorsk.py:enrich]` — fyller `nynorsk`-feltet på arter og underarter i
  `public/data/norske_arter.json` fra Artsdatabanken.
- `[enrich_nynorsk.py:_query]` — cachet oppslag mot Artskart-API-et.
- `[enrich_nynorsk.py:_extract_nn]` — velger beste `nn-NO`-treff blant kandidatene.
- `[enrich_nynorsk.py:_subspecies_full_latin]` — utvider forkortet underartsnavn
  til fullt latinsk navn.
- `[xlsx_to_json.py:XLSX_PATH]` / `[xlsx_to_json.py:JSON_PATH]` — rent
  modulnivå-skript (ingen funksjoner): leser Norgeslisten-regnearket fra `docs/`
  og skriver artslista som JSON.

Sikkerhetsporter og røyktester mot AO:

- `[ao_noop_roundtrip.py:main]` — prosjektets sikkerhetsport før redigering av
  sendte observasjoner: åpner ett publisert funn, bygger Save-bodyen UTEN
  endringer og sammenligner funnet felt for felt før og etter. Krever
  `--sighting-id`; `--skriv` poster faktisk til AO.
- `[ao_noop_roundtrip.py:_logg_inn]` — skaffer `(login_token, auth_cookie)`.
  Gjenbrukt av `ao_edit_smoketest.py` via `from tools.ao_noop_roundtrip import
  _logg_inn`, og er dermed katalogens eneste interne avhengighet.
- `[ao_noop_roundtrip.py:_les_env_fil]` — leser enkle `KEY=VALUE`-linjer fra
  `.env` uten å kreve `python-dotenv`.
- `[ao_noop_roundtrip.py:_virker]` — billig sjekk på om AO-sesjonen lever.
- `[ao_noop_roundtrip.py:_raa_rad]` — henter den ubearbeidede grid-raden via
  `src.ao_sightings.fetch_raw_row`.
- `[ao_noop_roundtrip.py:_rapporter]` — sammenligner og avslutter med exitkode 1
  ved avvik.
- `[ao_noop_roundtrip.py:SAMMENLIGN]` — de 13 feltene som bærer funnets innhold.
- `[ao_noop_roundtrip.py:_dato_til_no]` / `[ao_noop_roundtrip.py:ao_edit_site_name]`
  — formathjelpere for AOs skjema.
- `[ao_edit_smoketest.py:main]` — røyktest av endringskjeden mot en kjørende
  lokal server. Flagg: `--sighting-id`, `--sett-antall`, `--tilbakestill`.
- `[ao_edit_smoketest.py:post]` — POST med JSON mot `BASE`, avslutter med en
  lesbar feilmelding hvis serveren ikke svarer.
- `[ao_edit_smoketest.py:BASE]` — mål-URL, overstyrbar med `SMOKE_BASE`.

Inspeksjon og feilsøking:

- `[ao_site_inspect.py:main]` — henter AOs site-detaljer autentisert og leter
  etter eier-/oppretter-felt. Posisjonsargument `site_id`, flagg `--base`.
- `[ao_site_inspect.py:fetch_site]` — kallet mot `/core/Sites/ById`, inkludert et
  forberedende besøk på `/ImportSighting` for å fange en fornyet `.ASPXAUTHNO`.
- `[ao_site_inspect.py:find_owner_fields]` — rekursivt søk etter nøkler som
  inneholder `owner`, `created`, `creator`, `user` m.fl.
- `[check_ao_sites.py:main]` — starter `server.Handler` i en tråd på port 38030 og
  inspekterer sorteringen `/api/ao-sites` gir.
- `[compare_ao_geojson.py]` — modulnivå-skript uten funksjoner: sammenligner to
  AO GeoJSON-dumper som allerede må ligge i `/tmp`.
- `[smoke_test.sh]` — tre `curl`-sjekker (rot, `/api/reverse`, `/api/species`) mot
  verten gitt som første argument.

Drift:

- `[load_test.py:main]` — lasttest med modusene `mixed`, `static`, `gentle`,
  `ramp`, `soak`, `spike`, `smoke`.
- `[load_test.py:worker]` — én forespørsel, med valgfri jitter i `gentle`-modus.
- `[load_test.py:DEFAULT_URLS]` — målene, alle på `localhost:3000`.
- `[migrate_user_agents.py:migrate]` — engangs-migrering som parser
  `user_agent`-kolonnen i Supabase `stats` til `device_type`/`os`/`browser`.
- `[ping_render.py:URL]` — holder en Render-instans varm i en uendelig løkke.
- `[__init__.py]` — tom fil. Gjør `tools` til en pakke, som er det
  `ao_edit_smoketest.py` sin `from tools.ao_noop_roundtrip import _logg_inn`
  hviler på.

Underkataloger: ingen (`__pycache__` er generert og ignorert). Testfila i
katalogen (`test_create_site_final.py`) er ikke en del av dette grensesnittet.

## Invariants

Etikk mot eksterne API-er — dette er det viktigste i katalogen:

- Pausen mellom AO-kall i importen er `SLEEP_S = 0.2` sekunder og kjøres for
  HVER celle, også når cellen feilet `[import_ao_locations.py:SLEEP_S]`. Fjernes
  den, hamrer skriptet ~2 450 kall mot et offentlig API uten pust.
- Pausen i nynorsk-berikelsen er `SLEEP_S = 0.25` sekunder, og `_cache` sørger
  for at samme søkeord aldri slås opp to ganger
  `[enrich_nynorsk.py:SLEEP_S]`, `[enrich_nynorsk.py:_cache]`.
- Alle utgående kall setter eksplisitt `User-Agent`
  `[import_ao_locations.py:fetch_sites_in_bbox]`,
  `[import_ao_locations.py:fetch_municipality]`, `[enrich_nynorsk.py:HEADERS]`,
  `[ao_site_inspect.py:fetch_site]`.
- Nominatim slås KUN opp når minst én lokalitet i cellen mangler kommune fra AO,
  og da kun én gang per celle, på celle-senteret
  `[import_ao_locations.py:main]`. AOs egen `municipalityName`/`countyName` er
  mer presis enn Nominatim nær kommunegrenser
  `[import_ao_locations.py:normalize_sites]`.
- Lasttesten peker utelukkende på `localhost:3000`, aldri rett på et eksternt
  API `[load_test.py:DEFAULT_URLS]`. `gentle`-modus legger på tilfeldig jitter
  før hver forespørsel `[load_test.py:GENTLE_DELAY]`, `[load_test.py:worker]`.

Krav til miljø og kjørested:

- `LOCATION_DB_PATH` må være satt; uten den avsluttes importen med exitkode 1 før
  noe nettverkskall `[import_ao_locations.py:main]`.
- `SUPABASE_URL` og `SUPABASE_KEY` sjekkes på MODULNIVÅ i migreringsskriptet —
  en manglende variabel gir exitkode 1 allerede ved import, ikke i `migrate()`
  `[migrate_user_agents.py:SUPABASE_URL]`.
- `ao_site_inspect.py` avslutter med exitkode 2 hvis `AO_LOGIN_TOKEN` eller
  `AO_AUTH_COOKIE` mangler `[ao_site_inspect.py:fetch_site]`.
- `check_ao_sites.py` har `REPO_ROOT = '.'` og importerer `server` relativt til
  gjeldende arbeidskatalog — MÅ kjøres fra repo-roten
  `[check_ao_sites.py:REPO_ROOT]`.
- `compare_ao_geojson.py` forutsetter at `/tmp/ao_geojson_with_user.json` og
  `/tmp/ao_geojson_no_user.json` alt finnes; det lager dem ikke selv
  `[compare_ao_geojson.py]`.
- `smoke_test.sh` har `set -euo pipefail` og default-vert
  `http://localhost:3001` — merk at det er en annen port enn
  utviklingsserverens 3000 `[smoke_test.sh:HOST]`.

Rutenett og normalisering i importen:

- Stegstørrelsene `LAT_STEP = 0.20` og `LON_STEP = 0.40` er valgt fordi AOs API
  tillater maks ~0.22°×0.22° eller ~0.20°×0.40° per kall
  `[import_ao_locations.py:LAT_STEP]`, `[import_ao_locations.py:LON_STEP]`.
  Økes de, begynner AO å avvise kallene.
- `MAX_SITES = 1000` er taket per celle `[import_ao_locations.py:MAX_SITES]`.
- Cellegrensene beregnes med `_frange`, ikke med akkumulert addisjon, slik at
  rutenettet ikke drifter over 2 450 celler `[import_ao_locations.py:_frange]`.
- `normalize_sites` setter `isPrivate: False` for alt importen henter — den
  spør kun med `includePublicSites` `[import_ao_locations.py:normalize_sites]`.
  Rader uten navn, id, lat eller lon hoppes stille over.
- En feilende celle øker `errors` og lar løkken gå videre; en enkelt
  AO-forstyrrelse avbryter ikke hele importen `[import_ao_locations.py:main]`.

Sikkerhetsporten mot AO (`ao_noop_roundtrip.py`) — bryt ingen av disse:

- Gjennomgangskøen MÅ være tom før skjemaet åpnes; er den ikke det, avsluttes
  kjøringen `[ao_noop_roundtrip.py:main]` via `src.ao_edit.ko_rader`. Ellers blir
  skjemaet et kort 34 KB-skjema og publiseringen tilbake treffer feil funn.
- Sammenligningen skjer på AOs RÅ grid-rad, aldri på `normalize_row`-utgaven —
  normaliseringen kaster bort nettopp feltene som ville avslørt et tap
  (`Stage`, `Gender`, `Unit`, `DiscoveryMethod`) `[ao_noop_roundtrip.py:_raa_rad]`.
- Alle 13 feltene i `SAMMENLIGN` må være identiske etter et no-op; ett avvik gir
  exitkode 1 og beskjed om at `src/ao_edit.py` ikke er trygg å bygge videre på
  `[ao_noop_roundtrip.py:_rapporter]`, `[ao_noop_roundtrip.py:SAMMENLIGN]`.
- `--dry-run` er standard; det kreves et eksplisitt `--skriv` for å poste til
  `/ReviewSighting/Save` `[ao_noop_roundtrip.py:main]`.
- Legitimasjons-rekkefølgen er bevisst: tokens fra `.env` først, så
  `AO_USERNAME`/`AO_PASSWORD` fra miljøet, så interaktiv `getpass`. Et passord på
  kommandolinja havner i shell-historikken, og et passord i `.env` ligger der for
  alltid `[ao_noop_roundtrip.py:_logg_inn]`.
- Uten en TTY spørres det ikke interaktivt — skriptet avslutter i stedet med en
  beskjed om hvilke variabler som må settes `[ao_noop_roundtrip.py:_logg_inn]`.
- Skriptet lagrer ingen legitimasjon noe sted; det skriver kun ut hva brukeren
  selv kan legge i `.env` `[ao_noop_roundtrip.py:_logg_inn]`.

Røyktesten (`ao_edit_smoketest.py`):

- Uten `--sett-antall` gjør skriptet kun «åpne og angre» — den trygge testen.
  En ekte endring krever eksplisitt flagg `[ao_edit_smoketest.py:main]`.
- Velges funnet automatisk, tas kun et funn der `isReporter` er sann; AO tillater
  ikke redigering av andres rapporter `[ao_edit_smoketest.py:main]`.
- Tilbakestillingen ligger i en `finally`-blokk, slik at antallet settes tilbake
  også hvis noe kaster underveis `[ao_edit_smoketest.py:main]`.

Øvrig:

- Migreringen plukker kun rader der `device_type` er `null`, og er dermed
  idempotent — en ny kjøring rører ikke det som alt er migrert
  `[migrate_user_agents.py:migrate]`.
- `soak`-modus i lasttesten tolker `--requests` som SEKUNDER, ikke som antall
  forespørsler `[load_test.py:main]`.
- `xlsx_to_json.py` tar kun rader der det latinske navnet har minst to ord, slik
  at ordens- og familienavn (`Anseriformes`, `Anatidae`) ikke blir «arter»
  `[xlsx_to_json.py]`.
- `enrich_nynorsk.py` hopper over rader der `latin` er `'Scientific name'` — en
  feilrad/overskrift i kilden `[enrich_nynorsk.py:enrich]`.
- `sync_species.py` leser de største endringene fra API-svaret, ikke fra fila på
  disk; ellers ville `--dry-run` alltid vist null endringer
  `[sync_species.py:main]`.
- `ping_render.py` er en uendelig løkke med 600 sekunders pause og avslutter
  aldri av seg selv `[ping_render.py:URL]`.

## Side Effects

Destruktive skrivinger til disk:

- SQLite-skriving til `LOCATION_DB_PATH` via `LocationDB.upsert_locations(...,
  source='bulk-import')` — upsert per celle gjennom hele kjøringen (~40 min)
  `[import_ao_locations.py:main]`. Modulen lastes med
  `importlib.util.spec_from_file_location` direkte fra `src/location_db.py`
  `[import_ao_locations.py:LocationDB]`.
- `public/data/norske_arter.json` OVERSKRIVES på plass, uten sikkerhetskopi:
  `[enrich_nynorsk.py:enrich]`, `[xlsx_to_json.py:JSON_PATH]` og
  `[sync_species.py:main]` (sistnevnte kun uten `--dry-run`).
- `/tmp/ao_site_<site_id>.json` skrives med responsen fra AO
  `[ao_site_inspect.py:main]`.

Mutasjon av ekte, publiserte AO-observasjoner:

- Å ÅPNE redigeringsskjemaet gjør funnet midlertidig UPUBLISERT hos AO —
  også i `--dry-run` `[ao_noop_roundtrip.py:main]` via `src.ao_edit.aapne_skjema`.
  Skriptet publiserer det tilbake med `src.ao_edit.publiser_tilbake`.
- Med `--skriv` postes det til `/ReviewSighting/Save` og deretter publiseres
  `TemporarySightingId` på nytt `[ao_noop_roundtrip.py:main]`.
- Feiler publiseringen tilbake, kan funnet forbli UPUBLISERT hos AO. Skriptet
  skriver da en KRITISK-melding med lenke til `/ReviewSighting`
  `[ao_noop_roundtrip.py:main]`.
- `ao_edit_smoketest.py` POSTer til `/api/ao-sighting-form`,
  `/api/ao-sighting-save` og `/api/ao-sighting-abort` på en lokal server, som i
  sin tur endrer data hos ekte AO. `--sett-antall` er en reell endring av antall
  på et publisert funn `[ao_edit_smoketest.py:main]`.

Nettverkskall mot eksterne tjenester:

- Artsobservasjoner `/core/Sites/ByBoundingBox` — ett kall per rutenettcelle
  `[import_ao_locations.py:fetch_sites_in_bbox]`.
- OpenStreetMap Nominatim reverse-geokoding `[import_ao_locations.py:fetch_municipality]`.
- Artsdatabanken Artskart `publicapi/api/taxon` `[enrich_nynorsk.py:API_URL]`.
- Artsobservasjoner via `src/species_sync.py` `[sync_species.py:main]`.
- Artsobservasjoner `/ImportSighting` og `/core/Sites/ById`
  `[ao_site_inspect.py:fetch_site]`.
- Artsobservasjoner-innlogging og token-fornyelse gjennom
  `src.api_handlers.login_to_ao` og `src.api_handlers._refresh_with_logintoken`
  `[ao_noop_roundtrip.py:_logg_inn]`.
- Render-instansen `bird-observations-made-simple.onrender.com` hvert 10. minutt,
  i det uendelige `[ping_render.py:URL]`.

Lokale prosesser, porter og last:

- `check_ao_sites.py` binder TCP-port 38030 og starter `server.Handler` i en
  daemon-tråd; forespørselen den sender treffer ekte AO gjennom
  `/api/ao-sites` `[check_ao_sites.py:main]`.
- `load_test.py` kjører opptil `--concurrency` samtidige tråder mot den lokale
  serveren, som proxyer videre til AO og Nominatim med mindre mock brukes
  `[load_test.py:main]`.
- `smoke_test.sh` sender tre `curl`-forespørsler mot den oppgitte verten
  `[smoke_test.sh]`.

Ekstern databaseskriving:

- Supabase-tabellen `stats` oppdateres rad for rad med
  `device_type`, `os` og `browser` `[migrate_user_agents.py:migrate]`.

Lesing av hemmeligheter og utskrift av dem:

- `.env` i arbeidskatalogen leses `[ao_noop_roundtrip.py:_les_env_fil]`, og
  gyldige `AO_LOGIN_TOKEN`/`AO_AUTH_COOKIE` skrives ut til stdout som
  kopierbare linjer `[ao_noop_roundtrip.py:_logg_inn]`. Utdata fra disse
  skriptene bør ikke limes inn i loggsamlere eller chat.

## Verification

- Kjør: `python3 -m pytest` (fra repo-roten; `pytest.ini` setter
  `testpaths = tests`).
- MERK: ingen test under `tests` importerer noen
  modul fra `tools/` — verifisert med søk på `from tools` / `import tools`.
  Skriptene i denne katalogen har altså ingen direkte automatisert dekning.
  Det `pytest` dekker, er `src/`-modulene de delegerer til, blant annet
  `tests/test_species_sync.py` for `src/species_sync.py` (som
  `sync_species.py` er et CLI-skall over), `tests/test_location_db.py` for
  `src/location_db.py` (som `import_ao_locations.py` skriver gjennom) og
  `tests/test_ao_edit.py` for `src/ao_edit.py` (som `ao_noop_roundtrip.py`
  utøver mot ekte AO).
- `ao_noop_roundtrip.py` er en MANUELL sikkerhetsport, ikke en pytest-test: den
  må kjøres og være grønn mot ekte AO før redigering av sendte observasjoner
  bygges videre. Se `docs/rediger-sendte-obs-plan.md` og
  `docs/ao-mine-funn-api.md` punkt 3b.
