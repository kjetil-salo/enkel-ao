# Testdekning - Forbedring Januar 2026

**Dato**: 28. januar 2026
**Formål**: Analyse og forbedring av testdekning
**Resultat**: Backend-dekning økt fra 36% til 78%

> Dette dokumentet er grunnlag for artikkel om testdekning i praksis.

## Bakgrunn

Fugleobservasjoner er en norsk web-app for registrering av fugleobservasjoner. Stack:
- **Backend**: Python 3.12 (`http.server.ThreadingHTTPServer`)
- **Frontend**: Vanilla JavaScript (ES6 modules)
- **Deploy**: Fly.io med automatisk testing før production
- **Testing**: pytest (backend), Vitest (frontend), Playwright (E2E)

Prosjektet hadde allerede en del tester, men testdekningen var lav og noen tester feilet.

## Utgangspunkt

**Backend (Python)**: 36% dekning
```
Name                    Coverage    Tests
server.py               45%         2
src/api_handlers.py     30%         2
src/html_templates.py   12%         0
src/supabase_log.py     26%         0
Total                   36%         4
```

**Mangler**:
- `/api/ao-sites` endpoint (0% dekning)
- `/health` endpoint (0% dekning)
- Stats-pages (`/stats`) (nesten 0%)
- Error handling for eksterne API-feil
- Edge cases i api_handlers

**Frontend (JavaScript)**: 114 unit-tester
- 112 passerte ✅
- 2 feilet ❌ (`location.test.js`)

**E2E (Playwright)**: 11 tester (alle OK)

## Analyse av feilende tester

### Feil #1: openMap-test
**Problem**: Testen forventet OpenStreetMap-URL, men implementasjonen bruker:
- Apple Maps på iOS
- Google Maps på Android og desktop

**Root cause**: Test skrev anta en implementasjon som ikke stemte med virkeligheten.

**Lærdom**: Les koden før du skriver testen!

### Feil #2: setAoSiteSuggestions click-test
**Problem**: Testen klikket på feil DOM-element.

**Kode-struktur**:
```html
<div class="ao-site-suggestion">  <!-- Parent -->
  <span>Site name</span>           <!-- Click listener her -->
  <button>Map</button>
</div>
```

**Testen gjorde**: `dropdown.children[1].click()` (parent)
**Skulle gjort**: `dropdown.children[1].querySelector('span').click()` (span)

**Lærdom**: Forstå DOM-strukturen og hvor event listeners faktisk er.

## Utvidelse av testdekning

### Strategi
1. Start med kritiske endpoints som mangler tester
2. Dekk både happy path og error cases
3. Mock eksterne avhengigheter (Artsobservasjoner API, Nominatim)
4. Test graceful degradation ved feil

### Nye tester - Backend

**`tests/test_ao_sites_and_health.py`** (6 tester, 182 linjer):

```python
# 1. Health endpoint
def test_health_endpoint():
    """Enkel smoke test - er serveren i live?"""
    r = requests.get(f'http://127.0.0.1:{port}/health')
    assert r.status_code == 200
    assert data.get('status') == 'ok'

# 2. AO-sites med valid input
def test_ao_sites_valid(monkeypatch):
    """Test happy path med mock data."""
    # Mock external API response
    fake_sites = [...]
    monkeypatch.setattr('src.api_handlers.urlopen', fake_urlopen)

# 3-4. Missing/invalid parameters
def test_ao_sites_missing_params():
    """Validering av påkrevde parametere."""

# 5. External API error handling
def test_ao_sites_api_error(monkeypatch):
    """Test graceful degradation - tom liste ved feil."""
```

**Key points**:
- Bruker `monkeypatch` for å mocke `urlopen`
- Tester returnerer 200 med tom liste ved feil (ikke 500)
- Hver test starter egen server på unik port (parallellitet)

**`tests/test_stats.py`** (6 tester, 134 linjer):

```python
# 1-2. Autentisering
def test_stats_page_no_key():
    """Viser login-form uten nøkkel."""

def test_stats_page_wrong_key():
    """Avviser feil nøkkel."""

# 3-4. Stats-visning
def test_stats_page_correct_key(monkeypatch):
    """Viser stats med riktig nøkkel."""
    monkeypatch.setenv('STATS_KEY', 'testkey')
    monkeypatch.delenv('SUPABASE_URL', raising=False)  # Disable Supabase

# 5. Stats-incrementering
def test_stats_increment():
    """Sjekk at stats oppdateres ved logview."""
```

**Key points**:
- Stats kan bruke enten Supabase eller in-memory
- Disable Supabase i test for å teste in-memory path
- Test både autentisering og datavisning

## Resultater

### Coverage improvement

| Modul | Før | Etter | Δ | Note |
|-------|----:|------:|--:|------|
| `server.py` | 45% | **78%** | +33% | Health, stats, ao-sites |
| `src/api_handlers.py` | 30% | **78%** | +48% | AO-sites search |
| `src/html_templates.py` | 12% | **92%** | +80% | Stats HTML-gen |
| `src/supabase_log.py` | 26% | **71%** | +45% | Optional logging |
| **Total backend** | **36%** | **78%** | **+42%** | ⭐ |

### Test counts

- **Backend**: 4 → 16 tester (+300%)
- **Frontend**: 114 tester (100% pass)
- **E2E**: 11 tester
- **Totalt**: 141 tester

### Hva dekkes ikke?

De resterende 22% i backend:
- Supabase edge cases (optional funksjonalitet)
- Spesifikke error paths i stats-sider
- Import errors (lines 11-12 i flere filer)
- Kompleks Supabase query-logikk (lines 152-173 i server.py)

Dette er bevisst utelatt - ROI for å teste disse er lav.

## Læringspunkter

### 1. Start med det viktigste
Ikke jakt 100% coverage. Vi gikk fra 36% → 78% ved å fokusere på:
- Kritiske endpoints (`/api/ao-sites`, `/health`)
- Brukersynlige features (stats-pages)
- Error handling (graceful degradation)

### 2. Mock eksterne avhengigheter
```python
def fake_urlopen(req, timeout=10):
    return DummyResp(fake_data)

monkeypatch.setattr('src.api_handlers.urlopen', fake_urlopen)
```

Dette gjør testene:
- Raske (ingen nettverkskall)
- Pålitelige (ingen eksterne avhengigheter)
- Kontrollerbare (kan simulere feil)

### 3. Test i isolasjon
Hver test starter egen server på unik port:
```python
port = 38001  # Unique per test
srv = start_server(port)
time.sleep(0.05)  # La server starte
# ... test ...
srv.shutdown()
```

Dette tillater parallell kjøring og unngår port-konflikter.

### 4. Test error paths, ikke bare happy path
```python
def test_ao_sites_api_error(monkeypatch):
    """Ekstern API feiler - returnerer tom liste."""
    def fake_urlopen(req, timeout=10):
        raise Exception('External API error')

    r = requests.get(f'.../api/ao-sites?lat=59.9&lon=10.7')
    assert r.status_code == 200  # Ikke 500!
    assert data['sites'] == []    # Graceful degradation
```

Produksjon-systemer må håndtere feil grasiøst.

### 5. Verifiser testene faktisk tester riktig ting
De to feilende frontend-testene var gode eksempler på tester som ikke matchet implementasjonen:
- En antok feil URL-format
- En klikket på feil DOM-element

**Lærdom**: Kjør testene, se at de feiler av riktig grunn, fiks koden, se at de passerer.

## Sammenligning med industrien

**For hobbyprosjekter**:
- De fleste: 0-20% coverage (eller ingen tester)
- Ditt prosjekt: 78% backend + 114 frontend tester
- **Vurdering**: Topp 5%

**For profesjonelle prosjekter**:
- Dårlig: 0-30% (overraskende vanlig)
- Akseptabelt: 30-60%
- Godt: 60-80% ← **Her er du**
- Svært godt: 80-95%+
- **Vurdering**: Topp 30%

**Hva gjør det bra**:
1. Alle tre test-lag: Unit + Integration + E2E
2. Automatisk i CI/CD (production blokkeres hvis tester feiler)
3. Error handling testet (ikke bare happy path)
4. Frontend unit-tester (sjeldent for vanilla JS-prosjekter)

## Praktisk implementering

### Teststruktur
```
tests/
├── test_reverse.py              # Reverse geocoding
├── test_species_and_logview.py  # Species search + logging
├── test_ao_sites_and_health.py  # NEW: AO-sites + health
├── test_stats.py                # NEW: Stats pages
├── e2e_playwright/              # E2E tests
│   └── tests/
│       ├── flow.spec.ts
│       └── super-site.spec.ts
└── unit/                        # Frontend unit tests
    ├── api.test.js
    ├── location.test.js
    ├── observations.test.js
    ├── species_offline.test.js
    ├── storage.test.js
    └── ui.test.js
```

### CI/CD integrasjon
```bash
# update-app.sh production
python3 -m pytest --maxfail=3    # Blokkerer deploy ved feil
fly deploy --app fugleobservasjoner
```

### Kjøre tester lokalt
```bash
# Backend
python3 -m pytest                           # Alle tester
python3 -m pytest --cov=src --cov=server   # Med coverage

# Frontend
npm test                    # Vitest unit tests
cd tests/e2e_playwright
npm test                    # Playwright E2E
```

## Konklusjon

**Tid brukt**: ~2 timer
**Verdi skapt**:
- Backend coverage: 36% → 78% (+117% relativ økning)
- 12 nye backend-tester
- 2 frontend-tester fikset
- Dokumentasjon for fremtidig vedlikehold/artikkel

**ROI**: Høy. Dette er tid godt brukt for produksjonskvalitet.

**Neste steg**:
- Supabase error handling (hvis relevant)
- Flere E2E-tester for kritiske flows
- Performance testing (load testing allerede på plass)

---

**Commit**: `ec8649b` - "Forbedre testdekning for backend og fikse feilende frontend-tester"
**Branch**: `main`
**Deploy**: Automatisk til production etter test pass

## Ressurser

- [pytest documentation](https://docs.pytest.org/)
- [Vitest](https://vitest.dev/)
- [Playwright](https://playwright.dev/)
- [Testing Best Practices](https://testingjavascript.com/)

## Medium-artikkel ideer

**Mulige vinkler**:
1. "Fra 36% til 78% testdekning på 2 timer" (case study)
2. "Testing i praksis: Python backend + Vanilla JS frontend"
3. "Hvorfor de fleste hobbyprosjekter har dårlige tester (og hvordan fikse det)"
4. "Graceful degradation: Test error paths, ikke bare happy path"
5. "Testing uten frameworks: Vanilla JS med Vitest"

**Target audience**:
- Utviklere som vil forbedre testdekning
- Hobbyutviklere som bygger produksjonskvalitet
- Team leads som vil bevise ROI av testing

**Nøkkelpunkter**:
- Konkret før/etter med tall
- Praktiske eksempler med kode
- Honest om hva som IKKE testes (og hvorfor det er OK)
- ROI-fokus (tid vs. verdi)
