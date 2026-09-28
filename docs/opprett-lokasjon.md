# Opprett ny AO-lokasjon

Funksjon for å opprette nye lokasjoner i Artsobservasjoner.no direkte fra appen.

## Oversikt

Brukere i felt kan opprette nye lokasjoner uten å åpne artsobservasjoner.no manuelt.
Krever GPS-posisjon og AO-innlogging (loginToken + authCookie).

## Brukerflyt

1. Hent GPS-posisjon (klikk GPS-knappen)
2. Klikk ➕-knappen (vises kun når GPS + AO-innlogging er aktiv)
3. Fyll inn lokalitetsnavn (pre-fylt med gjeldende stedsnavn)
4. Velg nøyaktighet (default 50m)
5. Klikk "Opprett"
6. Lokasjon opprettes i AO og dukker opp i dropdown

## Teknisk arkitektur

### Frontend → Backend → AO API

```
➕-knapp → POST /api/ao-create-site → create_ao_site() → POST /Map/SaveSite
                                                        → POST /Map/AddSiteInfo (nøyaktighet)
```

### Koordinatsystem

AO sitt kart bruker **EPSG:3857 (Web Mercator)** internt. Konvertering fra WGS84:

```python
x = lon * 20037508.34 / 180.0
y = ln(tan((90 + lat) * π / 360)) / π * 20037508.34
```

Verifisert mot AO JavaScript (EPSG-koder `['3857', '4326', '900913']` i MasterJs).

### To-stegs opprettelse

1. **`/Map/SaveSite`** - Oppretter lokasjon (ignorerer Accuracy-parameter)
2. **`/Map/AddSiteInfo`** - Setter nøyaktighet etterpå

SaveSite returnerer alltid `accuracy: 0` uansett hva man sender.
AddSiteInfo brukes normalt ved redigering av eksisterende sites, men fungerer
også for å sette nøyaktighet rett etter opprettelse.

## AO API-detaljer

### POST /Map/SaveSite

Oppretter ny lokasjon. Parametere funnet ved reverse-engineering av
`NewSiteAdded`-funksjonen i AO sitt minifiserte JavaScript (MasterJs).

**Request** (form-encoded):
```
Id=-1
Name=Hylkjesvingen 51
XCoord=595056
YCoord=8515028
Accuracy=50
Geometry=POINT(595056 8515028)
comment=
```

**Response** (JSON):
```json
{
  "success": true,
  "points": {
    "type": "FeatureCollection",
    "features": [{
      "type": "Feature",
      "id": 3273519,
      "properties": {
        "siteName": "Hylkjesvingen 51",
        "siteId": 3273519,
        "siteCoordinateStringPresentation": "Ø299398, N6714205 Sone 32",
        "isPrivate": true,
        "parentName": "Hylkje"
      }
    }]
  }
}
```

**Viktige funn:**
- `Id=-1` betyr ny lokasjon
- `Geometry` (WKT POINT) er **påkrevd** - uten den feiler AO med NullReferenceException
- Koordinater må være EPSG:3857, ikke WGS84 eller UTM
- CSRF-token er IKKE nødvendig (i motsetning til import-endepunktene)
- Auth via cookies: `logintoken` + `.ASPXAUTHNO`

### POST /Map/AddSiteInfo

Oppdaterer eksisterende lokasjon (brukes her kun for nøyaktighet).

**Request** (form-encoded):
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

**Response** (JSON):
```json
{"success": true}
```

### Feilhåndtering

| Scenario | Respons |
|----------|---------|
| Auth utløpt | HTML-redirect til login-side |
| Duplikat navn | `{"success": false, "message": "Site not saved: duplicate name"}` |
| Mangler Geometry | NullReferenceException |
| `success=true` men siteId mangler/er ukjent | `{"success": true, "siteId": -1, ...}` (`ao_create_site.py` linje 207) — se merknaden under om samspill med kartets dedup-vern |

## Filer

| Fil | Beskrivelse |
|-----|-------------|
| `src/ao_create_site.py` | Backend: koordinatkonvertering + API-kall |
| `server.py` | Route: `POST /api/ao-create-site` |
| `public/js/api.js` | Frontend: `createAoSite()` |
| `public/js/location.js` | Frontend: ➕-knapp og modal |
| `public/js/map.js` | Frontend: pin-drop-varianten på kartsiden (➕-FAB → trykk i kart → panel), samme `createAoSite()`-kall |
| `tests/test_ao_create_site.py` | Enhetstester |
| `tools/test_create_site_final.py` | Manuelt testskript for AO API |

### Samspill med panorer-og-oppdater på kartet (v1.53.15)

En nyopprettet lokasjon fra pin-drop får sin egen permanente markør direkte i
`map.js` (`addNewSiteMarker`), UTENFOR laget som panorer-oppdateringen tegner
på nytt (`siteLayerGroup`). Siden `createAoSite()` også skriver den nye
lokasjonen inn i 24-timers privat-cachen (`ao_private_sites`), ville en
panorering rett etter opprettelse ellers hentet den samme lokasjonen på nytt
via `mergeAoSitesWithPrivateCache` og tegnet den en gang til. `map.js` sporer
derfor `siteId` (normalisert til streng, `AO kan returnere -1` ved
`success=true` uten gyldig id — se Feilhåndtering-tabellen — behandles som en
akseptert sjelden restrisiko, ikke en unik id å stole på for annet enn dette)
i `manuallyPlacedSiteIds` og hopper over dobbel tegning av samme id ved
panorer-oppdatering. Se `CLAUDE.md` (repo-roten) sin `map.js`-seksjon for
detaljer om selve panorer-og-oppdater-mekanismen.

## Verifisert

- Hylkjesvingen 51 (60.5137953, 5.3454789) opprettet med siteId 3273519
- EPSG:3857 koordinater: x=595056, y=8515028
- Nøyaktighet settes via AddSiteInfo etter opprettelse
