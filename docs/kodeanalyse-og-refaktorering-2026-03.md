# Kodeanalyse og refaktorering — Mars 2026

**Dato**: 21. mars 2026
**Formål**: Helhetlig kodeanalyse med fokus på sikkerhet, kodekvalitet, duplisering og testdekning
**Verktøy**: Claude Opus 4.6
**Commits**: `1545373..c53d513` (6 commits)

## Bakgrunn

Kodebasen er utviklet med Claude som primærverktøy (~97% av koden). En ny gjennomgang ble gjort for å avdekke teknisk gjeld, sikkerhetshull og muligheter for opprydding.

## Fase 1 — Sikkerhet

**Commit**: `1545373` — `fix(sikkerhet): path traversal-sjekk, trådsikre cacher og UnboundLocalError`

### Path traversal i statisk filservering

`server.py` sin `_handle_static_files` manglet validering av at oppløst filsti faktisk lå innenfor `PUBLIC_DIR`. En request med `../` i stien kunne potensielt lese filer utenfor public-mappen.

**Fix**: `os.path.realpath()` + prefiks-sjekk mot `PUBLIC_DIR`.

### Trådsikkerhet i cacher

`api_handlers.py` bruker in-memory cacher (`_species_cache`, `_relogin_cache`) som leses/skrives fra flere tråder via `ThreadingHTTPServer`. Uten synkronisering kunne dette gi race conditions.

**Fix**: `threading.Lock()` (`_cache_lock`) rundt alle cache-operasjoner.

### UnboundLocalError i GeoJSON-håndtering

`geojson_data` ble referert etter `httpx`-blokken uten å være initialisert ved unntak.

**Fix**: `geojson_data = None` før httpx-blokken.

## Fase 2 — Opprydding

**Commit**: `eae3158` — `refactor: fjern duplisert kode, pin avhengigheter og rydd opp`

### Fjerning av død kode (~470 linjer)

| Fil | Endring |
|-----|---------|
| `src/ao_import.py` | 428 → ~120 linjer. Fjernet utdaterte `fetch_csrf_token()`, `post_to_ao()`, `_mask()`. Kun `observations_to_csv()` beholdt (eneste aktivt brukte funksjon). |
| `src/ao_import_httpx.py` | Fjernet `_mask()`-definisjon, erstattet med `from src.utils import mask_token` |
| `src/sqlite_log.py` | Fjernet duplisert `_parse_user_agent()` |
| `src/supabase_log.py` | Fjernet duplisert `parse_user_agent()` |

### Ny felles utils-modul (backend)

`src/utils.py` opprettet med:
- `mask_token(token, visible=6)` — var duplisert i 3 filer
- `parse_user_agent(user_agent)` — var duplisert i `sqlite_log.py` og `supabase_log.py`

### Avhengigheter pinnet

`requirements.txt` oppdatert med versjonsbegrensninger:
```
supabase>=2.0,<3
python-dotenv>=1.0
user-agents>=2.2
httpx>=0.27
```

`package.json`: `@playwright/test` flyttet fra `dependencies` til `devDependencies`.

## Fase 3 — Standardisering

**Commits**: `7eb9c7f` + `a42f8cc`

### HTTP-klient: Alt over på httpx

`urllib.request` (urlopen/Request) ble erstattet med `httpx.Client` i alle gjenværende steder i `api_handlers.py`:
- `handle_species_search`
- `handle_reverse_geocoding`
- `_fetch_public_sites` (ByBoundingBox)

### Logging: Alt over på `logging`-modulen

Alle `print()` / `print(file=sys.stderr)` i `src/`-moduler erstattet med `logger.warning()` / `logger.info()` / `logger.debug()`:
- `src/ao_import_httpx.py`
- `src/ao_create_site.py`
- `src/sqlite_log.py`
- `src/supabase_log.py`

### Oppdeling av handle_ao_sites_search

Funksjonen var 380 linjer lang. Splittet i 8 fokuserte hjelpefunksjoner + en tynn orkestrator:

| Funksjon | Ansvar |
|----------|--------|
| `_wgs84_to_mercator(lat, lon)` | Koordinatkonvertering |
| `_compute_bbox(lat, lon, size_m)` | Bounding box-beregning |
| `_ensure_auth(ao_auth, ao_user_id, login_token)` | Auto-relogin + sliding expiration |
| `_fetch_private_site_ids(...)` | Hent private sites via GeoJSON |
| `_fetch_public_sites(bbox, ao_mobile_base_url)` | Hent offentlige sites via ByBoundingBox |
| `_normalize_site(item, my_site_ids)` | Normalisering med superlokasjon-deteksjon |
| `_resolve_super_sites(sites)` | Utled superlokasjoner fra parent-referanser |
| `_mark_env_owned_sites(sites)` | Merk bruker-eide fra `MY_AO_SITE_IDS` |

## Fase 4 — Tester

**Commit**: `29c04c0` — `test: fiks ødelagte tester og legg til 22 nye for refaktorerte hjelpefunksjoner`

### Fikset ødelagte tester

5 Python-tester og 16 JS-tester var ødelagt av fase 2-3-endringene:

**Python** — 5 tester mocka `urlopen` som ikke fantes lenger. Oppdatert til å mocke `httpx.Client`.
- `test_ao_sites_valid`, `test_ao_sites_api_error`, `test_ao_sites_default_size`
- `test_reverse_valid`
- `test_species_parsing`

**JavaScript** — 16 tester feilet pga:
- `location.test.js`: Manglende mock for `getCachedPrivateSites` og `ensureAoTokens` fra `api.js`
- `api.test.js`: `fetchAoSites` krasjet på `null`-respons (null-sjekk lagt til i `api.js`)
- `location.test.js`: `setCurrentPlace` kalles nå med `(name, siteId)`, test forventet bare `(name)`

### 22 nye enhetstester

Nye tester i `tests/test_ao_sites_helpers.py`:

| Funksjon | Antall tester |
|----------|:---:|
| `_wgs84_to_mercator` | 3 |
| `_compute_bbox` | 3 |
| `_normalize_site` | 7 |
| `_resolve_super_sites` | 3 |
| `_mark_env_owned_sites` | 2 |
| `_ensure_auth` (auth-refresh cascade) | 4 |

## Fase 5 — Frontend dedup

**Commit**: `c53d513` — `refactor(frontend): flytt toLocalISOString og haversine til felles utils.js`

Ny fil `public/js/utils.js` med to funksjoner som var duplisert:

| Funksjon | Fjernet fra |
|----------|-------------|
| `toLocalISOString(date)` | `observations.js`, `observation-commit.js` |
| `haversine(lat1, lon1, lat2, lon2)` | `map.js`, `ui.js` |

`ui.js` re-eksporterer `haversine` fra `utils.js` for bakoverkompatibilitet (brukes av `location.js`).

## Resultat

| Metrikk | Før | Etter |
|---------|-----|-------|
| Python-tester | 78 (5 feilet) | 100 (alle grønne) |
| JS-tester | 114 (16 feilet) | 114 (alle grønne) |
| Total | 192 (21 feilet) | 214 (alle grønne) |
| Duplisert kode fjernet | — | ~470 linjer backend, ~75 linjer frontend |
| HTTP-klienter | urllib + httpx | kun httpx |
| Logging | print + logging | kun logging |

### Konklusjon

Kodekvaliteten var allerede god. Endringene handler primært om konsistens (en HTTP-klient, en loggingsmekanisme), eliminering av duplisering, og bedre testdekning for de refaktorerte hjelpefunksjonene.
