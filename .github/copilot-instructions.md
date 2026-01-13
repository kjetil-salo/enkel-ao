# AI Coding Agent Instructions for Fugleobservasjoner

## Project Overview
A Norwegian bird observation web app with species autocomplete and location services. Built as a lightweight Python HTTP server serving static frontend + API proxies to external services (Artsobservasjoner.no, OpenStreetMap Nominatim).

**Core Tech:** Python 3.12 + `http.server.ThreadingHTTPServer`, vanilla HTML/CSS/JS frontend, Docker, Supabase logging.

## Architecture & Data Flow

### Request Routing (server.py)
The `Handler` class extends `SimpleHTTPRequestHandler` with custom routing:
- `/` → serves [public/index.html](public/index.html)
- `/api/species?search=X` → proxies to artsobservasjoner.no taxon picker (HTML scraping + JSON extraction)
- `/api/reverse?lat=X&lon=Y` → proxies to Nominatim for reverse geocoding
- `/api/ao-sites?lat=X&lon=Y` → fetches nearby observation locations from Artsobservasjoner mobile API
- `/api/logview` (POST) → logs page views to Supabase with IP/UA
- `/stats?key=X` → displays Supabase analytics (key-protected)

**Critical:** External API calls use explicit `User-Agent` headers for ethical scraping. Nominatim URL is configurable via `NOMINATIM_URL` env var for mock testing.

### Frontend ([public/index.html](public/index.html))
Single-page app with inline styles (Norwegian text). Key mobile considerations:
- Input font-size ≥16px to prevent iOS zoom-in
- "chosen species" display can clip on small screens (known issue, see [docs/ENDRINGER_OG_TODO.md](docs/ENDRINGER_OG_TODO.md))

## Developer Workflows

### Local Development
```bash
# Run server directly (dev mode, hits real external APIs)
python3 server.py  # or: npm run dev

# Run with Docker + mock external services (SAFE for load testing)
docker-compose up --build -d  # mock Nominatim at localhost:8080
```

**When to use mock:** Always for load testing. Mock is [mock/nominatim_app.py](mock/nominatim_app.py) (Flask stub).

### Testing & Load Tests
- Unit tests: [tests/test_reverse.py](tests/test_reverse.py), [tests/test_species_and_logview.py](tests/test_species_and_logview.py)
- Load testing: `python3 tools/load_test.py --mode gentle --requests 100 --concurrency 10`
  - **Modes:** `static` (homepage only), `mixed` (all APIs), `gentle` (with delays), `ramp`, `soak`, `spike`, `smoke`
  - **Ethics:** NEVER run large tests against real Nominatim/Artsobservasjoner. Use `docker-compose` mock or `--mode gentle` with low counts.

### Building & Deploying
```bash
# Build Docker image
make build  # or: docker build -t fugleobservasjoner:local .

# Run container (production-like)
make run  # docker run -p 3000:3000

# View logs/stats
make logs   # last 200 lines
make stats  # memory/CPU snapshot
```

Deploy via Fly.io (see [docs/deploy_strategy.md](docs/deploy_strategy.md)). Planned: separate `staging` and `production` environments with CI/CD (GitHub Actions not yet implemented).

## Project-Specific Conventions

### Language & Comments
All code comments, docs, and UI text in **Norwegian** (`nb`). Keep this consistent.

### Error Handling for External APIs
External API failures return graceful degraded responses (empty arrays, generic messages) rather than 500 errors. Example:
```python
except Exception as e:
    print('Feil ved henting fra Artsobservasjoner:', e)
    self._send_json({'sites': []}, status=200)  # NOT 500
```

### Supabase Integration
- Optional: app runs without Supabase if `SUPABASE_URL`/`SUPABASE_KEY` not set
- Logging is non-blocking (failures only print warnings)
- Stats page requires `STATS_KEY` env var (default: `'salo'`), stored in localStorage

### Mobile-First Quirks
- **Input zoom prevention:** All `<input>` elements need `font-size: 16px` minimum (iOS)
- **Chosen species visibility:** Active issue where selected species can clip suggestions on mobile ([docs/ENDRINGER_OG_TODO.md](docs/ENDRINGER_OG_TODO.md))

## Integration Points

**External Dependencies:**
1. **artsobservasjoner.no** (PickerSearch endpoint) — HTML scraping for species autocomplete. Response has `<span class="itemjson">` tags with JSON payloads.
2. **mobil.artsobservasjoner.no** (ByBoundingBox API) — location search, requires `X-CSRF: 1` header.
3. **nominatim.openstreetmap.org/reverse** — geocoding. Requires descriptive User-Agent per OSM policy.

**Environment Variables:**
- `PORT` (default: 3000)
- `NOMINATIM_URL` (override for testing)
- `SUPABASE_URL`, `SUPABASE_KEY` (optional logging)
- `STATS_KEY` (stats page auth, default: `'salo'`)

## File Organization
- [server.py](server.py) — monolithic server (HTTP handler + API logic)
- [supabase_log.py](supabase_log.py) — Supabase client wrapper
- [public/](public/) — static assets (HTML, CSS, SVGs)
- [mock/](mock/) — test stubs for external services
- [tools/load_test.py](tools/load_test.py) — concurrent load tester
- [docs/](docs/) — deployment strategy, TODOs, setup guides

## Next Steps (TODOs)
From [docs/ENDRINGER_OG_TODO.md](docs/ENDRINGER_OG_TODO.md):
- Fix mobile "chosen species" display clipping suggestions
- Set up separate `staging` and `production` deployments
- Resolve urllib3/OpenSSL warnings in Python environment

## Important Reminders
- **Ethical API usage:** Never hammer public APIs. Use mocks or `--mode gentle` for testing.
- **User-Agent headers:** Required for external services (already set in code, don't remove).
- **Norwegian language:** Maintain Norwegian for all user-facing text and documentation.
