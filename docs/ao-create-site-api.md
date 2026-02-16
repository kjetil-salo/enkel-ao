# AO API: Opprett ny lokasjon

Dokumentasjon av det eksakte API-kallet til Artsobservasjoner.no for å opprette nye lokasjoner.
Funnet ved reverse-engineering av AO sitt minifiserte JavaScript (`NewSiteAdded`-funksjonen i MasterJs-bundelen).

Verifisert 2026-02-16 med opprettelse av "Hylkjesvingen 51" (siteId 3273519).

---

## Steg 1: Opprett lokasjon — POST /Map/SaveSite

### Request

**URL:** `https://www.artsobservasjoner.no/Map/SaveSite`

**Method:** POST (form-encoded, IKKE JSON)

**Headers:**
```
Content-Type: application/x-www-form-urlencoded
X-Requested-With: XMLHttpRequest
User-Agent: Mozilla/5.0 ...
```

**Cookies (påkrevd for auth):**
```
logintoken=291498:badb30983a8f6d2fef725773301684e7e2952f081571afc7440242caa208c8a4
.ASPXAUTHNO=BB32A8E5...
AcceptCookies=1
```

**Body (form-encoded):**
```
Id=-1
Name=Hylkjesvingen 51
XCoord=595056
YCoord=8515028
Accuracy=50
Geometry=POINT(595056 8515028)
comment=
```

### Parametere forklart

| Parameter | Verdi | Beskrivelse |
|-----------|-------|-------------|
| `Id` | `-1` | Alltid -1 for ny lokasjon |
| `Name` | `Hylkjesvingen 51` | Lokalitetsnavn |
| `XCoord` | `595056` | Easting i EPSG:3857 (Web Mercator) |
| `YCoord` | `8515028` | Northing i EPSG:3857 (Web Mercator) |
| `Accuracy` | `50` | Nøyaktighet i meter — **IGNORERES av SaveSite!** |
| `Geometry` | `POINT(595056 8515028)` | WKT POINT i EPSG:3857. **PÅKREVD** — uten denne får du NullReferenceException |
| `comment` | *(tom)* | Valgfri kommentar |

### Koordinatkonvertering: WGS84 → EPSG:3857

AO bruker **EPSG:3857 (Web Mercator)**, IKKE UTM eller WGS84 desimalgrader.

```
x = lon × 20037508.34 / 180
y = ln(tan((90 + lat) × π / 360)) / π × 20037508.34
```

**Eksempel:** Hylkjesvingen 51 (60.5137953°N, 5.3454789°E)
```
x = 5.3454789 × 20037508.34 / 180 = 595056
y = ln(tan((90 + 60.5137953) × π / 360)) / π × 20037508.34 = 8515028
```

### Response (suksess)

```json
{
  "success": true,
  "points": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "id": 3273519,
        "geometry": {
          "type": "Point",
          "coordinates": [595056, 8515028]
        },
        "properties": {
          "siteName": "Hylkjesvingen 51",
          "siteId": 3273519,
          "siteCoordinateStringPresentation": "Ø299398, N6714205 Sone 32",
          "isPrivate": true,
          "parentName": "Hylkje",
          "accuracy": 0
        }
      }
    ]
  }
}
```

**Merk:** `accuracy: 0` — SaveSite setter ALLTID nøyaktighet til 0, uansett hva du sender.

### Feilresponser

**Auth utløpt** — AO returnerer HTML (redirect til login), ikke JSON:
```html
<!DOCTYPE html><html>...<title>Logg inn</title>...</html>
```

**Duplikat navn:**
```json
{"success": false, "message": "Site not saved: duplicate name"}
```

**Manglende Geometry:**
```json
{"message": "Object reference not set to an instance of an object."}
```

---

## Steg 2: Sett nøyaktighet — POST /Map/AddSiteInfo

Siden SaveSite ignorerer Accuracy, må du kalle AddSiteInfo etterpå.
Dette er samme endepunkt som AO bruker ved redigering av eksisterende lokasjoner.

### Request

**URL:** `https://www.artsobservasjoner.no/Map/AddSiteInfo`

**Method:** POST (form-encoded)

**Headers og cookies:** Samme som SaveSite.

**Body (form-encoded):**
```
Id=3273519
Name=Hylkjesvingen 51
XCoord=595056
YCoord=8515028
Accuracy=50
Geometry=POINT(595056 8515028)
ParentId=0
comment=
```

### Parametere forklart

| Parameter | Verdi | Beskrivelse |
|-----------|-------|-------------|
| `Id` | `3273519` | siteId fra SaveSite-responsen |
| `Name` | `Hylkjesvingen 51` | Samme navn som ved opprettelse |
| `XCoord` | `595056` | Samme koordinater som ved opprettelse |
| `YCoord` | `8515028` | Samme koordinater som ved opprettelse |
| `Accuracy` | `50` | Nøyaktighet i meter (25, 50, 100, 500) |
| `Geometry` | `POINT(595056 8515028)` | Samme WKT POINT |
| `ParentId` | `0` | 0 = behold eksisterende parent |
| `comment` | *(tom)* | Valgfri kommentar |

### Response (suksess)

```json
{"success": true}
```

---

## Komplett flyt oppsummert

```
1. Konverter WGS84 (lat, lon) → EPSG:3857 (x, y)
2. POST /Map/SaveSite  →  Får tilbake siteId
3. POST /Map/AddSiteInfo  →  Setter nøyaktighet
```

## Ting som IKKE trengs

- **CSRF-token** — ikke nødvendig for SaveSite/AddSiteInfo (i motsetning til import-endepunktene)
- **GetNearestParentSites** — returnerer alltid 400, og SaveSite fungerer uten ParentId
- **UTM-koordinater** — AO bruker EPSG:3857, ikke UTM33

## cURL-eksempel

```bash
# Steg 1: Opprett lokasjon
curl -X POST 'https://www.artsobservasjoner.no/Map/SaveSite' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -b 'logintoken=DITT_TOKEN; .ASPXAUTHNO=DIN_COOKIE; AcceptCookies=1' \
  -d 'Id=-1&Name=Min+lokasjon&XCoord=595056&YCoord=8515028&Accuracy=50&Geometry=POINT(595056+8515028)&comment='

# Steg 2: Sett nøyaktighet (bruk siteId fra steg 1)
curl -X POST 'https://www.artsobservasjoner.no/Map/AddSiteInfo' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -b 'logintoken=DITT_TOKEN; .ASPXAUTHNO=DIN_COOKIE; AcceptCookies=1' \
  -d 'Id=SITE_ID&Name=Min+lokasjon&XCoord=595056&YCoord=8515028&Accuracy=50&Geometry=POINT(595056+8515028)&ParentId=0&comment='
```

## Python-eksempel

```python
import math
import httpx

def wgs84_to_web_mercator(lat, lon):
    x = lon * 20037508.34 / 180.0
    y = math.log(math.tan((90.0 + lat) * math.pi / 360.0)) / math.pi * 20037508.34
    return round(x), round(y)

lat, lon = 60.5137953, 5.3454789
x, y = wgs84_to_web_mercator(lat, lon)  # (595056, 8515028)

cookies = {
    'logintoken': 'DITT_TOKEN',
    '.ASPXAUTHNO': 'DIN_COOKIE',
    'AcceptCookies': '1',
}
headers = {'X-Requested-With': 'XMLHttpRequest'}

# Steg 1: Opprett
with httpx.Client() as client:
    resp = client.post('https://www.artsobservasjoner.no/Map/SaveSite',
        cookies=cookies, headers=headers,
        data={
            'Id': '-1', 'Name': 'Min lokasjon',
            'XCoord': str(x), 'YCoord': str(y),
            'Accuracy': '50', 'Geometry': f'POINT({x} {y})', 'comment': '',
        })
    site_id = resp.json()['points']['features'][0]['properties']['siteId']

# Steg 2: Sett nøyaktighet
    resp = client.post('https://www.artsobservasjoner.no/Map/AddSiteInfo',
        cookies=cookies, headers=headers,
        data={
            'Id': str(site_id), 'Name': 'Min lokasjon',
            'XCoord': str(x), 'YCoord': str(y),
            'Accuracy': '50', 'Geometry': f'POINT({x} {y})',
            'ParentId': '0', 'comment': '',
        })
```
