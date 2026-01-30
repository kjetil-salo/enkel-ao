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

# E2E tests (Playwright)
cd tests/e2e_playwright
npm test                   # Against live server at localhost:3000
npm run test:mock          # With mock server
npm run test:with-mock     # Start mock + run tests
```

### Docker & Deploy
```bash
make build                 # Build Docker image
make run                   # Run container on port 3000
docker-compose up --build  # Run with mock Nominatim (safe for load testing)

# Deploy to Fly.io
./update-app.sh staging    # Deploy to staging
./update-app.sh production # Deploy to production — tester kjøres automatisk!
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
- `/api/ao-sites?lat=X&lon=Y` → fetches nearby observation locations from Artsobservasjoner
- `/api/logview` (POST) → logs page views to Supabase
- `/stats?key=X` → displays analytics (key-protected)
- `/health` → health check endpoint

### Backend Modules (src/)
- `api_handlers.py` — External API calls (species search, geocoding, AO sites)
- `html_templates.py` — HTML generation for stats pages
- `supabase_log.py` — Optional Supabase analytics logging

### Frontend Modules (public/js/)
Pure ES6 modules with no framework:
- `api.js` — API communication with 1-hour species cache
- `location.js` — Geolocation and AO sites integration
- `observations.js` — Main observation form logic
- `observation-commit.js` — Observation validation and activity pills rendering
- `storage.js` — Browser localStorage management (includes activity pills config)
- `ui.js` — UI state and rendering

### Konfigurerbare Aktivitetspills (v1.18.0+)
Brukere kan velge 0-6 aktiviteter som vises som hurtigknapper:
- **localStorage-nøkkel:** `activityPills_v1`
- **Format:** `{version: 1, pills: [{label: "Stasjonær", value: "23"}, ...]}`
- **Funksjoner:** `saveActivityPills()`, `loadActivityPills()` i `storage.js`
- **UI:** Settings-side med dynamisk liste og +/- knapper
- **Migrering:** Automatisk fra gammelt `activityPillCount` format
- **Default:** 4 pills (Stasjonær, Rastende, Overflygende, Næringssøkende)
- **Dokumentasjon:** Se `docs/aktivitetspills-konfigurasjon.md`

### Test Structure
- `tests/test_*.py` — Python unit tests (pytest)
- `tests/e2e_playwright/` — Playwright E2E tests with mock server support

## Key Conventions

### Language
All code comments, docs, and UI text in **Norwegian** (`nb`). Maintain this consistency.

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
- `SUPABASE_URL`, `SUPABASE_KEY` (optional logging)
- `STATS_KEY` (stats page auth, default: 'salo')

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
- **Production deploy**: `update-app.sh production` kjører automatisk `python3 -m pytest --maxfail=3` først. Deploy avbrytes hvis tester feiler.

### Versjonering
- Ved ny versjon (git tag): Oppdater alltid `VERSION` i `public/js/version.js` (brukes av index.html og help.html footers)
