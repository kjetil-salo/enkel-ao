# Stedsnavn-autocomplete i etterregistreringsmodus

_v1.19.4 - 15. februar 2026_

## Oversikt

Autocomplete på stedsnavn-feltet gjør det enkelt å velge riktig lokalitet fra Artsobservasjoner.no når du etterregistrerer observasjoner hjemme. Systemet søker mens du skriver og viser lokaliteter med fargekoding.

## Bruk

### Aktivering
Autocomplete er **kun aktiv i etterregistreringsmodus**. I feltmodus brukes GPS-basert lokalisering med kart i stedet.

1. Toggle til etterregistreringsmodus (toggle-knapp øverst)
2. Klikk i stedsnavn-feltet
3. Begynn å skrive (minimum 2 tegn)
4. Dropdown vises etter 300ms (debounced)

### Søkeresultater
Lokaliteter vises med fargekoding:
- **Grønn kantlinje og bakgrunn**: Offentlige lokaliteter (#006600)
- **Gul kantlinje og bakgrunn + ★ "Min"**: Dine egne private lokaliteter (#ffff00)

Format per resultat:
```
Lokalitetsnavn ★ Min (hvis privat)
Kommune/område (hvis forskjellig fra navn)
```

### Navigering
- **Skriv**: Autocomplete søker automatisk
- **Pil opp/ned**: Naviger i resultatlisten
- **Enter**: Velg markert lokalitet
- **Escape**: Lukk dropdown
- **Klikk utenfor**: Lukk dropdown
- **Museover**: Highlight resultat

### Lokalitets-ID i eksport
Når du velger en lokalitet fra autocomplete:
- Både **navn** og **ID** lagres
- Ved CSV-eksport brukes **ID** i stedet for navn
- Dette unngår tvetydige stedsnavn (f.eks. "Dale" matcher 50+ lokaliteter i Norge)

**Viktig**: Hvis du manuelt redigerer stedsnavnet etter valg fra dropdown, nullstilles ID-en og navn brukes i eksporten.

## Autentisering

### Offentlige lokaliteter
AO sitt autocomplete-API krever autentisering selv for offentlige lokaliteter.

### Private lokaliteter
For å se dine egne private lokaliteter må du:
1. Være innlogget via AO-direkte (langt trykk på "Enkel-AO" header)
2. Tokens (`loginToken`, `authCookie`) sendes automatisk fra localStorage

Tokens lagres i `localStorage.ao_tokens`:
```json
{
  "loginToken": "xxxxx",
  "authCookie": "yyyyy",
  "userId": "12345"
}
```

## Teknisk implementasjon

### Frontend
**Modul**: `public/js/autocomplete.js`

```javascript
// Aktivering i main.js (kun etterregistreringsmodus)
if (isAfterMode && dom.placeInput && !autocompleteCleanup) {
  autocompleteCleanup = initAutocomplete(dom.placeInput, (name, id) => {
    appState.currentPlaceName = name;
    appState.currentPlaceId = id;
  });
}

// Deaktivering ved modus-bytte
if (autocompleteCleanup) {
  autocompleteCleanup();
  autocompleteCleanup = null;
}
```

**Funksjoner**:
- `initAutocomplete(placeInput, onSelect)` - Hovedfunksjon
- `fetchAutocomplete(term)` - Henter resultater fra backend
- `renderResults(results)` - Rendrer dropdown med fargekoding
- `selectItem(index)` - Velger lokalitet og kaller callback
- Keyboard handlers (ArrowUp, ArrowDown, Enter, Escape)
- Click outside handler

### Backend
**Endepunkt**: `GET /api/ao-autocomplete?term=X&loginToken=Y&authCookie=Z`

**Handler i server.py**:
```python
def _handle_ao_autocomplete_api(self, parsed):
    params = parse_qs(parsed.query)
    term = params.get('term', [''])[0].strip()
    login_token = params.get('loginToken', [''])[0].strip()
    auth_cookie = params.get('authCookie', [''])[0].strip()

    results = fetch_ao_autocomplete(term, login_token, auth_cookie)
    self._send_json(results)
```

**API-funksjon i src/api_handlers.py**:
```python
def fetch_ao_autocomplete(term: str, login_token: str = None, auth_cookie: str = None) -> list:
    if not term or len(term) < 2:
        return []

    base_url = os.getenv('AO_MOBILE_URL', 'https://mobil.artsobservasjoner.no')
    params = {
        'term': term,
        'siteTypeIdList': '1,2,3,4,5,6'  # Alle typer lokaliteter
    }

    url = f'{base_url}/Map/FindSitesByNameForAutocomplete?{urlencode(params)}'

    headers = {
        'User-Agent': 'Fugleobservasjoner/1.19.4',
        'Accept': 'application/json'
    }

    if login_token and auth_cookie:
        headers['Cookie'] = f'logintoken={login_token}; .ASPXAUTHNO={auth_cookie}; AcceptCookies=1'

    response = httpx.get(url, headers=headers, timeout=10, follow_redirects=False)

    # Sjekk at respons er JSON (ikke HTML redirect)
    content_type = response.headers.get('content-type', '')
    if 'application/json' not in content_type:
        print(f'[AO-AUTOCOMPLETE] Ikke-JSON respons (mangler autentisering?)')
        return []

    return response.json()
```

### Dataflyt
1. **Bruker skriver** → `input` event → debounce 300ms
2. **Frontend kaller** `GET /api/ao-autocomplete?term=X&loginToken=Y&authCookie=Z`
3. **Backend kaller** AO API med autentisering
4. **AO returnerer** JSON med lokaliteter
5. **Frontend renderer** dropdown med fargekoding
6. **Bruker velger** → `onSelect(name, id)` callback
7. **main.js oppdaterer** `appState.currentPlaceName` og `appState.currentPlaceId`
8. **observation-commit.js** inkluderer `placeId` i observasjon
9. **observations.js** bruker `placeId` (hvis satt) i CSV-eksport

### CSV-eksport med ID
I `observations.js`:
```javascript
// Bruk lokalitets-ID hvis tilgjengelig, ellers navn
const place = (obs.placeId || obs.placeName || '').toString().replace(/[;\t]/g, ',');
```

### Nullstilling av ID ved manuell redigering
I `main.js`:
```javascript
dom.placeInput.addEventListener('input', () => {
  // Nullstill placeId hvis bruker manuelt endrer navn
  appState.currentPlaceId = null;
});
```

## Feilhåndtering

### Ingen autentisering
Hvis bruker ikke er innlogget returnerer AO HTML redirect til `/LogOn` i stedet for JSON:
```python
content_type = response.headers.get('content-type', '')
if 'application/json' not in content_type:
    print(f'[AO-AUTOCOMPLETE] Ikke-JSON respons')
    return []  # Tom liste, ikke 500-error
```

### Nettverksfeil
```javascript
catch (error) {
  console.error('Autocomplete-feil:', error);
  dropdown.style.display = 'none';  // Skjul dropdown, ikke vis feilmelding
}
```

### Ingen resultater
Dropdown vises ikke hvis:
- Søketerm < 2 tegn
- AO returnerer tom liste
- Autentisering mangler (AO redirecter til login)

## Testing

### Manuell testing
1. **Uten innlogging**: Skal vise kun offentlige lokaliteter
2. **Med innlogging**: Skal vise både offentlige og private (gule med ★)
3. **Tastaturnavigasjon**: Pil opp/ned, Enter, Escape
4. **Manuell redigering**: ID nullstilles, navn brukes i eksport
5. **Modus-toggle**: Autocomplete deaktiveres i feltmodus

### Eksempel søk
- "Hylkje" → Viser Hylkje og Hylkje sjø
- "Dale" → Viser mange lokaliteter (derfor ID brukes i eksport!)
- "Fana" → Viser lokaliteter i Fana

## Fremtidige forbedringer

### Muligheter
- Caching av søkeresultater (1-time TTL)
- Vis avstand fra brukerens posisjon (hvis GPS er aktivert)
- Nylig brukte lokaliteter øverst
- Fuzzy matching på frontend (f.eks. "hlkje" → "Hylkje")

### Begrensninger
- AO API krever minimum 2 tegn (hardkodet i AO backend)
- Maksimalt 20 resultater returneres av AO
- Ingen paginering/scrolling for å hente flere

## ao-direct.html Auto-oppdatering

Når tokens fornyes via autocomplete eller ao-sites, oppdateres ao-direct.html automatisk:

### Custom Events
**Frontend dispatches event ved token-refresh:**
```javascript
window.dispatchEvent(new CustomEvent('ao_tokens_updated', {
  detail: { source: 'autocomplete', tokens }
}));
```

**ao-direct.html lytter og oppdaterer felt:**
```javascript
// Samme tab
window.addEventListener('ao_tokens_updated', (e) => {
  loadTokensIntoFields();  // Oppdater input-felt
  // Vis notifikasjon: "✅ Token automatisk oppdatert!"
});

// Andre tabs/windows
window.addEventListener('storage', (e) => {
  if (e.key === 'ao_tokens') loadTokensIntoFields();
});
```

**Resultat:**
- Token-feltene i ao-direct.html oppdateres automatisk
- Fungerer både i samme tab og andre tabs
- Bruker ser alltid oppdaterte tokens

## Test-resultater (2026-02-16)

### Sliding Expiration
- ✅ Fungerer perfekt - AO sender ny cookie etter ~1 time
- ✅ 5 min interval gir god balanse (5% overhead ved aktiv bruk)
- ✅ Token holdes i live så lenge bruker er aktiv (<30 min mellom søk)

### Caching
- ✅ Skipper refresh hvis <5 min siden sist probe
- ✅ Reduserer overhead betydelig

### Neste test
- ⏳ LoginToken-refresh (når token faktisk utløper >30 min)

## Se også
- `docs/ao-lokalitet-api.md` - Dokumentasjon av AO lokalitet-API
- `docs/ao-token-autentisering.md` - Autentisering mot AO
- `docs/mobil-artsobservasjoner-api.md` - Mobil API dokumentasjon
