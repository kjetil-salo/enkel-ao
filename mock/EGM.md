# Mock-tjenester for eksterne API-er

## Overview

Pakken finnes for at last- og timeout-testing aldri skal treffe de ekte,
offentlige API-ene til Nominatim (OpenStreetMap) og Artsobservasjoner. Det er to
frittstående Flask-apper som etterligner et lite utsnitt av disse tjenestene, og
som appen peker på ved å overstyre miljøvariablene `NOMINATIM_URL`, `AO_URL` og
`AO_MOBILE_URL`.

De to variantene har hver sin rolle:

- `nominatim_app.py` svarer umiddelbart med en statisk, plausibel respons. Dette
  er den som bygges inn i Docker-bildet, og den brukes til lasttesting der
  poenget er å måle vår egen server uten å belaste noen andres.
- `nominatim_app_timeout.py` sover 15 sekunder før hvert svar. Siden alle
  kallerne i `src/api_handlers.py` bruker `timeout=10`, utløser den bevisst
  timeout-grenen i appen. Dette er ikke en treghet som skal fikses — det er hele
  formålet med fila.

Mock-ene er rene testdobler uten tilstand eller lagring. De validerer ikke
inndata og svarer alltid det samme uavhengig av hvilke koordinater eller søkeord
som sendes inn.

## Interface

- `[nominatim_app.py:app]` — Flask-applikasjonen for den raske mock-en.
- `[nominatim_app.py:reverse]` — `GET /reverse`. Leser `lat` og `lon` fra
  query-strengen og speiler dem tilbake i et JSON-objekt med nøklene
  `place_id`, `licence`, `osm_type`, `osm_id`, `lat`, `lon`, `display_name`
  (`'Oslo, Norway'`) og `address` (`city`, `country`, `country_code`). Svarer
  straks, uten forsinkelse.
- `[nominatim_app_timeout.py:app]` — Flask-applikasjonen for timeout-mock-en.
- `[nominatim_app_timeout.py:reverse]` — `GET /reverse`. Samme responsobjekt som
  den raske varianten, men etter `time.sleep(15)`.
- `[nominatim_app_timeout.py:taxon_picker_search]` — `GET /Taxon/PickerSearch`.
  Sover 15 sekunder og svarer med en tom JSON-liste (`[]`). Motsvarer stien
  `AO_URL + '/Taxon/PickerSearch'` som artssøket setter sammen i
  `[src/api_handlers.py:handle_species_search]`.
- `[nominatim_app_timeout.py:ao_sites_by_bounding_box]` — `GET
  /core/Sites/ByBoundingBox`. Sover 15 sekunder og svarer `{'sites': []}`.
  Motsvarer stien `AO_MOBILE_URL + '/core/Sites/ByBoundingBox'` som
  lokalitetshentingen setter sammen i `[src/api_handlers.py:_fetch_public_sites]`.
- `[Dockerfile:COPY]` — bildet kopierer inn **kun** `nominatim_app.py`.
  Timeout-varianten er bevisst ikke med i bildet.
- `[Dockerfile:EXPOSE]` / `[Dockerfile:CMD]` — eksponerer port 8080 og starter
  `python3 nominatim_app.py`.
- Ingen underkataloger.

## Invariants

- Begge appene binder seg til `0.0.0.0:8080`
  (`[nominatim_app.py:__main__]`, `[nominatim_app_timeout.py:__main__]`). Porten
  er den samme i `[Dockerfile:EXPOSE]` og i portbindingen for `nominatim`-tjenesten
  i `[docker-compose.yml:nominatim]`. Endres porten i én fil, må den endres i alle.
- Rutestiene må være tegn-for-tegn like de stiene serveren setter sammen fra
  base-URL-ene. `/reverse` treffer fordi `NOMINATIM_URL` i seg selv inneholder
  stien (`[docker-compose.yml:fugle]` setter
  `NOMINATIM_URL=http://nominatim:8080/reverse`, og
  `[src/api_handlers.py:handle_reverse_geocoding]` legger bare query-parametere
  på). `/Taxon/PickerSearch` og `/core/Sites/ByBoundingBox` treffer fordi
  AO-kallerne legger nøyaktig disse stiene på sine base-URL-er. En omdøpt rute
  gir 404 i stedet for det svaret testen venter på.
- Forsinkelsen på 15 sekunder i `[nominatim_app_timeout.py:reverse]`,
  `[nominatim_app_timeout.py:taxon_picker_search]` og
  `[nominatim_app_timeout.py:ao_sites_by_bounding_box]` må holdes STØRRE enn
  `timeout=10` hos kallerne (`[src/api_handlers.py:handle_reverse_geocoding]`,
  `[src/api_handlers.py:handle_species_search]`,
  `[src/api_handlers.py:_fetch_public_sites]`). Senkes den under 10, slutter
  timeout-testene å teste timeout — de begynner å teste en treg, men vellykket
  respons, uten at noe feiler synlig.
- Responsformen må holde seg innenfor det kallerne faktisk parser.
  `{'sites': []}` fra `[nominatim_app_timeout.py:ao_sites_by_bounding_box]`
  plukkes opp av dict-grenen i `[src/api_handlers.py:_fetch_public_sites]`, som
  leser `data.get('sites')`.
- `[nominatim_app.py:reverse]` og `[nominatim_app_timeout.py:reverse]` validerer
  ikke `lat`/`lon` — manglende parametere speiles tilbake som `null`. Validering
  av koordinater skjer hos kalleren
  (`[src/api_handlers.py:handle_reverse_geocoding]`), ikke her.
- Den raske mock-en dekker kun `/reverse`
  (`[nominatim_app.py:reverse]`). Den har ingen AO-ruter, så
  `[docker-compose.yml:fugle]` overstyrer med vilje bare `NOMINATIM_URL` — ikke
  `AO_URL` eller `AO_MOBILE_URL`. Skal AO-kall også gå til en mock, må
  timeout-varianten startes manuelt, slik det er beskrevet i `CLAUDE.md`.

## Side Effects

- Åpner en lyttende TCP-socket på port 8080 via Flasks utviklingsserver
  (`[nominatim_app.py:__main__]`, `[nominatim_app_timeout.py:__main__]`).
- Blokkerer den betjenende tråden i 15 sekunder per forespørsel
  (`[nominatim_app_timeout.py:reverse]`,
  `[nominatim_app_timeout.py:taxon_picker_search]`,
  `[nominatim_app_timeout.py:ao_sites_by_bounding_box]`). Flasks
  utviklingsserver er enkeltrådet som standard, så samtidige kall står i kø bak
  hverandre.
- Ingen diskskriving, ingen database, ingen utgående nettverkskall og ingen
  tilstand mellom forespørsler — `[nominatim_app.py:reverse]` og
  `[nominatim_app_timeout.py:reverse]` bygger svaret på nytt hver gang.
- `[Dockerfile:RUN]` installerer `flask` med pip ved bygging av bildet. Flask er
  en avhengighet for denne pakken alene, ikke for appen i produksjon.

## Verification

- Kjør: `python3 -m pytest` (fra repo-roten; `pytest.ini` setter
  `testpaths = tests`). Merk at ingen test under `tests/` importerer disse to
  filene — pytest vokter ikke mock-ene direkte, bare at resten av repoet
  fortsatt er grønt.
- Rask mock sammen med appen: `docker-compose up --build` bygger `./mock` som
  tjenesten `nominatim` og peker appens `NOMINATIM_URL` på den
  (`[docker-compose.yml:nominatim]`, `[docker-compose.yml:fugle]`).
- Timeout-mock manuelt (ikke med i Docker-bildet, jf. `[Dockerfile:COPY]`):

  ```bash
  python3 mock/nominatim_app_timeout.py &
  AO_URL=http://localhost:8080 AO_MOBILE_URL=http://localhost:8080 python3 server.py
  ```
