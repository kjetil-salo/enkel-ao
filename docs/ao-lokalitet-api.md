# AO Lokalitets-API Dokumentasjon

Reverse-engineered API-dokumentasjon for oppretting av lokaliteter på Artsobservasjoner.no.

**Status:** Eksperimentell - ikke implementert i Enkel-AO ennå
**Dato:** 2026-02-15

## Bakgrunn

Feature request fra bruker: "Kan vi ha en knapp som lager NY lokasjon basert på GPS?"

Dette dokumentet beskriver API-flyten for å opprette nye lokaliteter på AO, samt utfordringer og mulige løsninger.

---

## API-endepunkter

### 1. Valider posisjon

**Endepunkt:** `POST /Map/IsSiteWithinAllowedAreaAndValidGeometry`

**Formål:** Sjekk om posisjonen er innenfor tillatt område og har gyldig geometri.

**Content-Type:** `application/x-www-form-urlencoded`

**Payload:**
```
siteCoordX=595007
siteCoordY=8515048
geometryWkt=POINT(595007.0409111626 8515047.79585106)
```

**Koordinatsystem:** UTM33 (CoordinateSystemId=19)

---

### 2. Hent overordnede lokaliteter

**Endepunkt:** `POST /Site/GetNearestParentSites`

**Formål:** Finn nærmeste overordnede områder (fylke, kommune, etc.) basert på GPS-posisjon.

**Content-Type:** `application/json`

**Payload:**
```json
{
  "XCoord": 595007,
  "YCoord": 8515048,
  "CoordinateSystemId": 19,
  "CoordinateSystemNotationId": 1,
  "currentSpeciesGroupId": "8",
  "currentTaxonId": ""
}
```

**Alternative koordinater (WGS84):**
```json
{
  "XCoord": "5.3457975",
  "YCoord": "60.5133867",
  "CoordinateSystemId": "10",
  "CoordinateSystemNotationId": "4",
  "currentSpeciesGroupId": "8",
  "currentTaxonId": ""
}
```

**Koordinatsystem:**
- CoordinateSystemId=10 → WGS84 (lat/lon)
- CoordinateSystemId=19 → UTM33 (X/Y)

**Response:** (ukjent struktur - må testes)
- Returnerer sannsynligvis liste med parent sites
- Inkluderer ParentId som brukes i AddSiteInfo

---

### 3. Hent geografiske områder

**Endepunkt:** `POST /Site/GetSiteAreas`

**Formål:** Hent geografiske områder (fylke, kommune, etc.) for en posisjon.

**Content-Type:** `application/json`

**Payload:**
```json
{
  "XCoord": "5.3457975",
  "YCoord": "60.5133867",
  "CoordinateSystemId": "10",
  "CoordinateSystemNotationId": "4",
  "currentSpeciesGroupId": "8"
}
```

**Response:** (ukjent struktur - må testes)
- Returnerer sannsynligvis liste med area IDs

---

### 4. Opprett ny lokasjon

**Endepunkt:** `POST /Map/AddSiteInfo`

**Formål:** Lagre ny lokasjon i AO-databasen.

**Content-Type:** `application/x-www-form-urlencoded`

**Payload:**
```
Id=-1
Name=Hylkjesvingen 53
XCoord=595007
YCoord=8515048
Accuracy=25
Geometry=POINT(595007.0409111626 8515047.79585106)
ParentId=362858
comment=Test
```

**Felter:**
- `Id=-1` → Ny lokasjon (eksisterende har positiv ID)
- `Name` → Lokalitetsnavn (påkrevd)
- `XCoord` → X-koordinat i UTM33
- `YCoord` → Y-koordinat i UTM33
- `Accuracy` → Nøyaktighet i meter (25, 50, 100, 500, etc.)
- `Geometry` → WKT (Well-Known Text) geometri
- `ParentId` → Overordnet lokalitet fra GetNearestParentSites (valgfri)
- `comment` → Kommentar (valgfri)

**Response:** (ukjent struktur - må testes)
- Sannsynligvis returnerer ny lokalitets-ID ved suksess
- Feilmeldinger ved validering

**Autentisering:** Krever AO-innlogging
- Cookie: `logintoken`
- Cookie: `.ASPXAUTHNO`
- Cookie: `__RequestVerificationToken` (CSRF)
- Cookie: `CurrentRole`

---

## Koordinatsystem-konvertering

AO støtter flere koordinatsystemer:

**WGS84 (GPS-format):**
- CoordinateSystemId: 10
- Format: Lat/Lon (60.5133867, 5.3457975)
- Dette er det GPS gir oss

**UTM33 (Norsk standard):**
- CoordinateSystemId: 19
- Format: X/Y (595007, 8515048)
- Dette brukes i AddSiteInfo payload

**Konvertering:**
- JavaScript-bibliotek: [proj4js](https://github.com/proj4js/proj4js)
- Alternativ: La AO konvertere (ukjent om støttet i AddSiteInfo)

---

## Flyt i AO-grensesnittet

Når brukeren oppretter en lokasjon manuelt på AO:

1. Åpne observasjonsregistrering: `/SubmitSighting/Report`
2. Gå til "Lokalitet"-fanen
3. Velg "Ny lokalitet"
4. Fyll ut skjema:
   - Lokalitetsnavn (påkrevd)
   - Koordinatsystem: Geographic (WGS 84) eller UTM33
   - Lengdegrad / Breddegrad (eller X/Y)
   - Nøyaktighet (dropdown)
   - Superlokasjon (valgfri)
   - Prosjekt (valgfri)
5. **Lokaliteten lagres når observasjonen lagres**

**Viktig:** Lokaliteten opprettes IKKE umiddelbart, men først når en observasjon lagres på den lokaliteten.

---

## Utfordringer for Enkel-AO

### 1. Autentisering

**Problem:** API-kall krever AO-innlogging (session cookies).

**Løsninger:**
- **A) Backend-proxy:** Enkel-AO → server.py → AO (krever at bruker logger inn via vår app)
- **B) Åpne AO i nytt vindu:** Bryter Enkel-AO konteksten
- **C) Kopier-til-clipboard:** Enkel, men manuelt arbeid

**Anbefaling:** C for nå, evt. tilby API til AO-teamet senere.

### 2. CORS (Cross-Origin Resource Sharing)

**Problem:** Nettleseren blokkerer cross-origin requests fra Enkel-AO til AO.

**Løsning:** Krever backend-proxy via server.py.

### 3. Koordinatkonvertering

**Problem:** GPS gir WGS84, AddSiteInfo forventer UTM33.

**Løsning:**
- Bruk proj4js for konvertering
- Eller test om AddSiteInfo aksepterer WGS84 direkte

### 4. CSV-import og nye lokaliteter

**Åpent spørsmål:** Støtter AO sin CSV-import oppretting av nye lokaliteter med koordinater?

Enkel-AO bruker CSV-format:
```csv
Art,Antall,Dato,Sted,Aktivitet
Gråspurv,3,2026-02-15,Hylkjebukta,Stasjonær
```

**Muligheter:**
1. CSV-import støtter koordinater → Kan sende lat/lon i CSV → AO oppretter lokasjon automatisk
2. CSV-import krever eksisterende lokalitet → Må opprette lokalitet først via API

**Testing nødvendig:** Importer CSV med koordinater i stedet for stedsnavn.

---

## Mulige løsninger

### Løsning A: Kopier-til-clipboard (enklest)

**Implementasjon:**
1. Bruker trykker "Opprett lokasjon"-knapp i Enkel-AO
2. App kopierer GPS-data til clipboard:
   ```
   📍 Opprett lokasjon på Artsobservasjoner.no

   1. Åpne AO → Registrer funn → Lokalitet → "Ny lokalitet"
   2. Fyll inn:
      - Lokalitetsnavn: [forslag fra reverse geocoding]
      - Koordinatsystem: Geographic (WGS 84)
      - Breddegrad: 60.5133867
      - Lengdegrad: 5.3457975
      - Nøyaktighet: 15m

   📌 Generert fra Enkel-AO
   ```
3. Bruker limer inn manuelt på AO

**Fordeler:**
- Enkelt å implementere
- Ingen autentiseringsproblemer
- Fungerer i dag

**Ulemper:**
- Manuelt arbeid
- Bryter Enkel-AO konteksten

---

### Løsning B: Backend-proxy via server.py (kompleks)

**Implementasjon:**
1. Bruker logger inn på AO via Enkel-AO
2. Enkel-AO lagrer AO-session i server.py
3. Når bruker trykker "Opprett lokasjon":
   - Frontend → POST til `/api/ao-create-site`
   - server.py → POST til AO `/Map/AddSiteInfo` (med brukerens session)
   - Response tilbake til frontend
4. Lokalitet opprettet

**Fordeler:**
- Sømløs brukeropplevelse
- Ingen CORS-problemer
- Full kontroll

**Ulemper:**
- Kompleks implementasjon
- Sikkerhetshensyn (håndtere AO-sessions)
- Må håndtere CSRF-tokens
- Krever vedlikehold hvis AO endrer API

---

### Løsning C: Tilby API til AO-teamet (best langsiktig)

**Scenario:**
1. AO-teamet ser verdien i Enkel-AO
2. De adopterer funksjonalitet eller lager offisielt API
3. Enkel-AO bruker offisielt API med OAuth/API-nøkler

**Fordeler:**
- Offisiell støtte
- Bedre sikkerhet
- Vedlikeholdt av AO-teamet

**Ulemper:**
- Avhengig av AO-teamets prioriteringer
- Tar tid

---

## Eksempel-kode (konseptuell)

### Frontend: Opprett lokasjon-knapp

```javascript
// location.js
export async function createNewSite(position, siteName) {
  const { lat, lon, accuracy } = position;

  // Alternativ 1: Kopier til clipboard
  const text = `
📍 Opprett lokasjon på Artsobservasjoner.no

1. Åpne AO → Registrer funn → Lokalitet → "Ny lokalitet"
2. Fyll inn:
   - Lokalitetsnavn: ${siteName}
   - Koordinatsystem: Geographic (WGS 84)
   - Breddegrad: ${lat}
   - Lengdegrad: ${lon}
   - Nøyaktighet: ${Math.round(accuracy)}m

📌 Generert fra Enkel-AO
  `.trim();

  await navigator.clipboard.writeText(text);
  alert('GPS-data kopiert til clipboard! Lim inn på AO.');
}
```

### Backend: Proxy til AO (hvis Løsning B)

```python
# server.py
def do_POST(self):
    if self.path == '/api/ao-create-site':
        # Les request fra frontend
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        data = json.loads(post_data.decode('utf-8'))

        # Konverter WGS84 → UTM33 (krever proj4-bibliotek)
        utm_x, utm_y = convert_wgs84_to_utm33(data['lat'], data['lon'])

        # Hent ParentId
        parent_id = fetch_nearest_parent_site(utm_x, utm_y)

        # Opprett lokasjon på AO
        payload = {
            'Id': -1,
            'Name': data['siteName'],
            'XCoord': utm_x,
            'YCoord': utm_y,
            'Accuracy': data['accuracy'],
            'Geometry': f'POINT({utm_x} {utm_y})',
            'ParentId': parent_id,
            'comment': 'Opprettet fra Enkel-AO'
        }

        # POST til AO med brukerens session-cookies
        response = httpx.post(
            'https://www.artsobservasjoner.no/Map/AddSiteInfo',
            data=payload,
            cookies=user_ao_session,  # Må lagres fra innlogging
            headers={'X-Requested-With': 'XMLHttpRequest'}
        )

        # Returner til frontend
        self._send_json(response.json())
```

---

## Åpne spørsmål

1. **Response-struktur fra `/Map/AddSiteInfo`:**
   - Hva returneres ved suksess? (lokalitets-ID?)
   - Hvordan ser feilmeldinger ut?

2. **Response fra `/Site/GetNearestParentSites`:**
   - Hva er strukturen på parent-sites?
   - Hvilken ParentId skal vi velge (første i listen)?

3. **CSV-import og koordinater:**
   - Støtter AO CSV-import oppretting av nye lokaliteter med koordinater?
   - Format: `Sted` = "60.5133867,5.3457975" eller eget felt?

4. **Koordinatsystem i AddSiteInfo:**
   - Aksepterer AddSiteInfo WGS84-koordinater direkte?
   - Eller må vi alltid konvertere til UTM33?

5. **Nøyaktighet-verdier:**
   - Hvilke verdier er gyldige? (25, 50, 100, 500, 1000?)
   - Dropdown i UI viser: "5m", "10m", "25m", "50m", "100m", "500m", "1000m+"

---

## Testing nødvendig

For å verifisere API-flyten, test følgende:

1. **Opprett lokasjon via API:**
   ```bash
   curl 'https://www.artsobservasjoner.no/Map/AddSiteInfo' \
     -X POST \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -H 'Cookie: [dine cookies]' \
     --data-raw 'Id=-1&Name=Test&XCoord=595007&YCoord=8515048&Accuracy=25&Geometry=POINT(595007 8515048)&ParentId=362858'
   ```
   - Sjekk response-struktur
   - Verifiser at lokasjon opprettes

2. **Test CSV-import med koordinater:**
   - Importer CSV med koordinater i stedet for stedsnavn
   - Se om AO oppretter lokasjon automatisk

3. **Test WGS84 i AddSiteInfo:**
   - Send WGS84-koordinater i stedet for UTM33
   - Se om AO konverterer automatisk

---

## Konklusjon

Teknisk er det mulig å opprette lokaliteter via AO API, men det krever:
- Autentisering (AO-innlogging)
- Koordinatkonvertering (WGS84 → UTM33)
- Backend-proxy for å unngå CORS
- Håndtering av CSRF-tokens

**Anbefaling for nå:**
Implementer **kopier-til-clipboard** (Løsning A) som en enkel løsning som fungerer i dag.

**Langsiktig:**
Hvis AO-teamet ser verdien, tilby dem denne dokumentasjonen og vurder offisielt API-samarbeid.

---

**Dokumentert av:** Claude Sonnet 4.5
**Basert på:** Network-trace fra Firefox Developer Tools
**Sist oppdatert:** 2026-02-15
