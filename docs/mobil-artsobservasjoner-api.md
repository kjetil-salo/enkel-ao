# Mobil Artsobservasjoner API

Dokumentasjon av API-endepunkter funnet på `mobil.artsobservasjoner.no`.

**Dato:** 2026-01-21

## Oversikt

Mobilversjonen av Artsobservasjoner er en Angular SPA som kommuniserer med et Core API på `/core/`-stien. API-et krever spesifikke headers for å fungere.

## Teknisk stack (frontend)

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

- `id` / `Id` / `siteId` - Lokalitets-ID
- `name` / `Name` / `siteName` - Navn
- `lat` / `latitude` - Breddegrad
- `lon` / `longitude` - Lengdegrad
- `parentSiteId` / `parentId` - Foreldre-ID (for underlokaliteter)
- `isSuper` / `isSuperSite` - Om dette er en superlokasjon
- `siteType` / `type` - Type lokalitet

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
