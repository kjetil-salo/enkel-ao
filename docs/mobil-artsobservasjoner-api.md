# Mobil Artsobservasjoner API

Dokumentasjon av API-endepunkter funnet på `mobil.artsobservasjoner.no`.

**Dato:** 2026-01-21  
**Oppdatert:** 2026-02-02

## Oversikt

Mobilversjonen av Artsobservasjoner er en Angular SPA som kommuniserer med et Core API på `/core/`-stien. API-et krever spesifikke headers for å fungere.

### Viktig bakgrunn: To separate systemer

Artsobservasjoner.no består av **to helt separate systemer** med forskjellig teknologi:

| System | URL | Teknologi | Alder/Status |
|--------|-----|-----------|--------------|
| **Desktop/Hovedside** | `www.artsobservasjoner.no` | ASP.NET MVC 5.2 på IIS 10.0 | Eldre, primært system |
| **Mobilversjon** | `mobil.artsobservasjoner.no` | ASP.NET Core på IIS 10.0 + Angular SPA | Nyere, halvhjertet implementering |

**Viktige observasjoner:**
- Mobilversjonen ble sannsynligvis laget lenge etter desktop-versjonen som et separat prosjekt
- De to systemene deler autentisering (`.ASPXAUTHNO` cookies fungerer på begge)
- Desktop-versjonen har flere funksjoner og er "kilden til sannhet"
- Mobilversjonen mangler Swagger-dokumentasjon (404 på `/core/swagger/`)
- Mobilversjonens API returnerer `application/problem+json` for feil (ASP.NET Core-stil)

### Response headers som avslører teknologi

**www.artsobservasjoner.no (desktop):**
```http
x-aspnetmvc-version: 5.2
x-aspnet-version: 4.0.30319
x-powered-by: ASP.NET
server: Microsoft-IIS/10.0
```

**mobil.artsobservasjoner.no:**
```http
server: Microsoft-IIS/10.0
x-powered-by: ASP.NET
content-type: application/problem+json; charset=utf-8  (for feil)
```

## Teknisk stack (frontend - mobil)

| Komponent | Teknologi |
|-----------|-----------|
| Framework | Angular (SPA) |
| Font | Chivo (Google Fonts) |
| Ikoner | Font Awesome 6 Free |
| Kart | OpenLayers |
| Styling | CSS med variabler (`--ol-*`) |

## Bekreftede, fungerende endepunkter

### 1. Sites/ByBoundingBox

Henter AO-lokaliteter innenfor et geografisk område.

**URL:** `https://mobil.artsobservasjoner.no/core/Sites/ByBoundingBox`

**Metode:** GET

**Parametere:**

| Parameter | Type | Beskrivelse |
|-----------|------|-------------|
| `maxSites` | int | Maks antall steder (f.eks. 200) |
| `minX` | float | Minimum longitude |
| `minY` | float | Minimum latitude |
| `maxX` | float | Maximum longitude |
| `maxY` | float | Maximum latitude |
| `includePublicSites` | bool | Inkluder offentlige steder |

**Påkrevde headers:**

```http
User-Agent: Mozilla/5.0 (compatible; ...)
Accept: application/json, text/plain, */*
X-CSRF: 1
Referer: https://mobil.artsobservasjoner.no/contribute/submit-sightings
```

**Respons-felter (per site):**

- `id` - Lokalitets-ID (int)
- `name` - Navn på lokaliteten
- `presentationName` - Fullt navn inkl. kommune/fylke
- `latitude` / `longitude` - Koordinater
- `isPrivate` - **Se viktig merknad under!**
- `accuracy` - Nøyaktighet i meter
- `municipalityName` - Kommune
- `countyName` - Fylke
- `parentSiteId` - Foreldre-ID (for underlokaliteter, null for toppnivå)
- `isPolygon` - Om lokaliteten er definert som polygon
- `polygonCoordinates` - Array av koordinatpar hvis polygon

### Viktig om `isPrivate`-feltet

`isPrivate: true` betyr **IKKE** at lokaliteten tilhører innlogget bruker!

| `isPrivate` | Betydning |
|-------------|-----------|
| `true` | Lokaliteten ble opprettet av en bruker (personlig lokalitet) |
| `false` | Offentlig/delt lokalitet (f.eks. naturreservater, kjente fuglelokaliteter) |

**For å identifisere brukerens egne lokaliteter** må man bruke desktop-API-et (`GetSitesGeoJson`) med autentisering. Se [ao-token-autentisering.md](ao-token-autentisering.md).

**Eksempel-respons:**
```json
{
  "id": 253660,
  "name": "Indre Hordvik",
  "presentationName": "Indre Hordvik, Bergen, Ve",
  "longitude": 5.31568188,
  "latitude": 60.51590884,
  "isPrivate": true,
  "accuracy": 61,
  "municipalityName": "Bergen",
  "countyName": "Vestland",
  "parentSiteId": null,
  "isPolygon": true,
  "polygonCoordinates": [[5.316, 60.516], ...]
}
```

**Eksempel:**

```bash
curl -H "X-CSRF: 1" \
     -H "Referer: https://mobil.artsobservasjoner.no/contribute/submit-sightings" \
     "https://mobil.artsobservasjoner.no/core/Sites/ByBoundingBox?maxSites=50&minX=10.7&minY=59.9&maxX=10.8&maxY=60.0&includePublicSites=true"
```

## Endepunkter funnet i JavaScript (ikke testet)

Disse ble funnet ved analyse av minifiserte JavaScript-filer.

### 2. ValidationRules/TaxonInformationRules

CRUD-operasjoner for taxon-informasjonsregler.

| Metode | URL | Beskrivelse |
|--------|-----|-------------|
| GET | `/ValidationRules/TaxonInformationRules` | Liste regler |
| POST | `/ValidationRules/TaxonInformationRules` | Opprett regel |
| PUT | `/ValidationRules/TaxonInformationRules/{id}` | Oppdater regel |
| DELETE | `/ValidationRules/TaxonInformationRules/{id}` | Slett regel |

**Query-parametere (GET):**

- `PageNumber` - Sidenummer (default: 1)
- `PageSize` - Elementer per side (default: 10)
- `TaxonId` - Valgfri taxon-ID

### 3. SystemInformationMessage

Systemmeldinger (f.eks. driftsvarsler).

| Metode | URL | Beskrivelse |
|--------|-----|-------------|
| GET | `/SystemInformationMessage` | Hent meldinger |
| PUT | `/SystemInformationMessage` | Oppdater melding |
| DELETE | `/SystemInformationMessage` | Slett melding |

### 4. Cms/News

Nyheter fra CMS.

| Metode | URL | Beskrivelse |
|--------|-----|-------------|
| GET | `/Cms/News` | Hent nyheter (sortert etter dato) |

## Tjenester identifisert (uten eksakte URLer)

Disse ble funnet som Angular-tjenester i JavaScript:

- **CoreApiService** - Hovedtjeneste for API-kommunikasjon
- **getContacts()** - Henter kontaktliste
- **getConversations()** - Henter meldinger
- **postConversation()** - Sender ny melding
- **sendToArchive()** - Arkiverer melding
- **authService** - Brukerautentisering

## Potensielle endepunkter (spekulativt)

Basert på desktop-versjonen og Angular-strukturen kan disse finnes:

```
/core/Species/Search?...
/core/Sightings/...
/core/Taxon/...
/core/User/...
/core/Observations/...
```

## Begrensninger

1. **Swagger-dokumentasjon krever autentisering** - `/core/swagger/index.html` returnerer 401
2. **JavaScript er minifisert** - Vanskelig å finne alle endepunkter
3. **Noen endepunkter krever innlogging** - authService brukes flere steder

## Videre utforskning

For å finne flere endepunkter:

1. Åpne DevTools (F12) → Network-fanen
2. Gå til `mobil.artsobservasjoner.no`
3. Utfør handlinger (søk arter, registrer observasjon)
4. Se hvilke API-kall som gjøres

## Sammenligning: Desktop vs Mobil API

| Funksjon | Desktop (www) | Mobil |
|----------|---------------|-------|
| Artsøk | `/Taxon/PickerSearch` (HTML scraping) | Ukjent |
| Lokaliteter | Ikke brukt | `/core/Sites/ByBoundingBox` (JSON) |
| Format | HTML med embedded JSON | Ren JSON |
| Autentisering | Cookie-basert | Ukjent (X-CSRF header) |

## Bruk i fugleobservasjoner-appen

Mobilens Sites-API brukes i `src/api_handlers.py:124` (`handle_ao_sites_search`).
