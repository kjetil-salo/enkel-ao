# Oppsummering (2026-02-03)

## Hvordan AO fungerer (antatt)
- AO bruker ASP.NET Forms Authentication med sliding expiration for autentisering.
- .ASPXAUTHNO er en kryptert session-cookie, ikke lesbar eller base64-dekoderbar for klienten.
- logintoken er kun for "Husk meg"-funksjon ved manuell innlogging, ikke for API-autentisering.
- Sliding expiration: AO fornyer kun .ASPXAUTHNO hvis den fortsatt er gyldig og nær utløp, og kun ved besøk på “ekte” AO-sider (f.eks. /Observations eller .aspx-sider).
- Utløpt/invalidert cookie kan ikke fornyes – da kreves ny innlogging.
- logintoken kan ikke konverteres til .ASPXAUTHNO programmatisk, kun via manuell innlogging.
- Session restore i nettleser gir illusjon av langvarig innlogging, men er ikke token-basert.

## Vår løsning

### Token-flyt
1. Bruker logger inn manuelt på AO og kopierer logintoken, userId og .ASPXAUTHNO til appen (via ao-direct.html).
2. Tokens lagres i localStorage som et JSON-objekt: { userId, loginToken, authCookie }.
3. API-kall fra frontend sender tokens til backend.
4. Backend (server.py/api_handlers.py):
  - Bruker tokens til å hente private lokaliteter fra AO.
  - Prøver sliding expiration: gjør GET til AO-side for å forlenge .ASPXAUTHNO hvis det er >10 min siden sist.
  - Logger alle relevante steg, inkludert om Set-Cookie finnes i responsen.
  - Hvis AO returnerer ny .ASPXAUTHNO, sendes denne til frontend og lagres i localStorage.
  - Hvis AO ikke returnerer ny cookie, men eksisterende cookie fortsatt er gyldig, får bruker fortsatt private data.
  - Hvis AO returnerer redirect til /LogOn eller ingen private site-IDs, er cookien utløpt/invalidert.

### Debugging og logging
- Logger tydelig når sliding expiration forsøkes, og når ny cookie mottas (med ######-linje).
- Logger alle Set-Cookie-headere fra AO.
- Logger om private site-IDs faktisk hentes (viser at token er gyldig).

### Begrensninger og erfaringer
- Automatisk fornyelse fungerer kun for gyldige cookies. Utløpte/invalidert cookies må erstattes manuelt.
- Bruker må selv lime inn userId (ingen automatisk overskriving).
- Frontend og backend håndterer oppdatering av tokens i localStorage automatisk når ny cookie mottas.
- logintoken og .ASPXAUTHNO er ikke lesbare eller base64-dekodet – de er kun “nøkler” mot AO.
- Langvarig sesjon (1 år) er ikke mulig – AO krever ny innlogging etter utløp.

## Oppsummert
- Vi har implementert robust sliding expiration med tydelig logging og automatisk oppdatering av cookie.
- Vi kan ikke lese ut data fra token – kun AO kan validere og utstede gyldig .ASPXAUTHNO.
- Løsningen er så robust som AO tillater: så lenge brukeren er aktiv og cookien ikke er utløpt, vil fornyelse skje automatisk.
- Når cookien er utløpt, må bruker logge inn på nytt og lime inn ny token.

# AO Token-autentisering og refresh

## Oversikt

Artsobservasjoner.no bruker ASP.NET Forms Authentication med sliding expiration tokens for autentisering.

## Token-typer

### 1. `.ASPXAUTHNO` (Auth Cookie)
- **Levetid:** ~10-15 minutter
- **Type:** Session cookie med sliding expiration
- **Funksjon:** Hovedautentisering for API-kall
- **Refresh:** AO sender ny cookie i `Set-Cookie`-header når token nærmer seg utløp

### 2. `logintoken` 
- **Levetid:** Lengre enn auth cookie (timer/dager)
- **Funksjon:** Brukes sammen med auth cookie for å identifisere bruker
- **Lagring:** localStorage som `ao_tokens.loginToken`

### 3. `userId`
- **Funksjon:** Brukeridentifikator
- **Lagring:** localStorage som `ao_tokens.userId`

## Lagring i frontend

Tokens lagres i localStorage som JSON-objekt:

```javascript
// Struktur i localStorage
ao_tokens: {
  userId: "12345",
  loginToken: "abc123...",
  authCookie: ".ASPXAUTHNO=xyz789..."
}
```

## Token-flyt

### 1. Bruker logger inn (manuelt på ao-direct.html)
```
Bruker → ao-direct.html → Logger inn på artsobservasjoner.no → Kopierer tokens → Limer inn
```

### 2. API-kall med tokens
```
Frontend → /api/ao-sites?lat=X&lon=Y 
  (med ao_tokens JSON i query param)
    ↓
Server → Dekoder tokens
    ↓
Server → GetSitesGeoJson (curl med -i for headers)
  Headers: Cookie: .ASPXAUTHNO=...; logintoken=...
    ↓
AO API → Returnerer private lokaliteter + evt. ny Set-Cookie
    ↓
Server → Parser Set-Cookie for ny .ASPXAUTHNO
    ↓
Server → Returnerer sites + refreshed_auth_cookie (hvis oppdatert)
    ↓
Frontend → Oppdaterer ao_tokens i localStorage hvis ny cookie
```

### 3. Token refresh
AO sender **kun** ny `Set-Cookie` når:
- Token nærmer seg utløp (sliding expiration)
- Token er fortsatt gyldig men snart utløper

AO sender **ikke** ny cookie når:
- Token er fersk/nylig brukt
- Token allerede er utløpt (da feiler kallet)

## Implementasjonsdetaljer

### Server-side (src/api_handlers.py)

```python
# GetSitesGeoJson bruker curl med -i for å fange headers
cmd = ['curl', '-i', '-s', '-X', 'POST', url, ...]

# Parser Set-Cookie for ny auth cookie
if '< Set-Cookie:' in line or 'Set-Cookie:' in line:
    if '.ASPXAUTHNO=' in line:
        match = re.search(r'\.ASPXAUTHNO=([^;]+)', line)
        if match:
            refreshed_auth_cookie = f'.ASPXAUTHNO={match.group(1)}'
```

### Frontend (public/js/location.js)

```javascript
// Oppdater tokens hvis ny auth cookie mottatt
if (data.refreshed_auth_cookie) {
  const tokens = JSON.parse(localStorage.getItem('ao_tokens') || '{}');
  tokens.authCookie = data.refreshed_auth_cookie;
  localStorage.setItem('ao_tokens', JSON.stringify(tokens));
}
```

## Debugging

### Debug-logging i server.py
```
[DEBUG] ao-sites mottok auth: user_id=True, login_token=True, auth_cookie=True
GetSitesGeoJson: fant 4 private site-IDs
[DEBUG] ao-sites refresh resultat: refreshed_auth_cookie=False
```

### Tolkning av logger
- `refreshed_auth_cookie=False` er **normalt** når token fortsatt er gyldig
- `refreshed_auth_cookie=True` betyr AO sendte ny cookie (token var nær utløp)
- `fant X private site-IDs` bekrefter at autentisering fungerer

## Kjente begrensninger

1. ~~**Manuell innlogging:** Bruker må logge inn på artsobservasjoner.no og kopiere tokens manuelt~~
2. ~~**Sliding expiration:** Hvis bruker er inaktiv >15 min, må de logge inn på nytt~~
3. ~~**Ingen automatisk re-login:** Appen kan ikke automatisk logge inn brukeren~~

**LØST!** Se "Langvarig sesjon" under.

## Feilsøking

### "Mine lokaliteter" viser ikke stjerne (⭐)

1. **Sjekk at tokens er satt:**
   ```javascript
   localStorage.getItem('ao_tokens')
   ```

2. **Sjekk server-logger:**
   - `user_id=True` → userId mottatt
   - `auth_cookie=True` → auth cookie mottatt
   - `fant X private site-IDs` → autentisering fungerer

3. **Sjekk bbox-størrelse:**
   - GetSitesGeoJson bruker `max(size_m / 2, 100)` meter bbox
   - Hvis lokalitet er utenfor bbox, sjekkes ikke eierskap

### Tokens utløper for raskt

- Forventet oppførsel: `.ASPXAUTHNO` utløper etter ~15 min inaktivitet
- Løsning: Bruker må logge inn på nytt på ao-direct.html
- Fremtidig forbedring: Implementere aktiv token-refresh ved API-kall

## API-endepunkter

### `/api/ao-sites`
- **Metode:** GET
- **Parametere:**
  - `lat`, `lon` - Koordinater
  - `size` - Søkeradius i meter
  - `ao_tokens` - JSON-kodet token-objekt (valgfri)
- **Respons:**
  ```json
  {
    "sites": [...],
    "refreshed_auth_cookie": ".ASPXAUTHNO=..." | null
  }
  ```

### GetSitesGeoJson (intern)
- **URL:** `https://mobil.artsobservasjoner.no/api/Site/GetSitesGeoJson`
- **Headers:**
  - `Cookie: .ASPXAUTHNO=...; logintoken=...`
  - `X-CSRF: 1`
- **Body:** JSON med userId og bbox

### ByBoundingBox (intern)
- **URL:** `https://mobil.artsobservasjoner.no/api/Site/ByBoundingBox`
- **Headers:** `X-CSRF: 1`
- **Returnerer:** Offentlige lokaliteter (krever ikke auth)

## Langvarig sesjon - ❌ IKKE MULIG

### Mål (opprinnelig)
Oppnå en sesjon som varer 1 år – slik at bruker bare trenger å logge inn én gang årlig.

### ❌ Konklusjon (testet 2026-02-02)

**logintoken kan IKKE konverteres til .ASPXAUTHNO programmatisk.**

Etter grundig testing fant vi at:

1. **logintoken er KUN for "Remember Me"** - den pre-fyller brukernavn ved neste **manuelle** innlogging
2. **.ASPXAUTHNO er den faktiske auth-cookien** - kreves for API-tilgang
3. **Ingen automatisk utveksling** - det finnes ingen endpoint som konverterer logintoken → .ASPXAUTHNO

### Testbevis

```bash
# Test 1: Forsiden med bare logintoken
curl -s "https://www.artsobservasjoner.no/" \
  -H "Cookie: logintoken=290628:1b468755...; logintoken_ssl=1" \
  | grep -o "Logg inn\|Logg ut"
# Resultat: "Logg inn" (IKKE innlogget)

# Test 2: Beskyttet side med bare logintoken
curl -i -s -L "https://www.artsobservasjoner.no/SubmitSighting/Report" \
  -H "Cookie: logintoken=290628:1b468755...; logintoken_ssl=1" \
  | grep "set-cookie.*ASPXAUTH"
# Resultat: INGEN .ASPXAUTHNO returnert

# Test 3: Sletting av .ASPXAUTHNO i nettleser
# → Bruker ble umiddelbart logget ut
# → Refresh ga IKKE automatisk ny .ASPXAUTHNO fra logintoken
```

### Hvorfor "1-års innlogging" i nettleser?

Moderne nettlesere (Safari, Firefox, Chrome) har **session restore** som 
gjenoppretter sesjons-cookies når nettleseren åpnes igjen. Dette gir 
*illusjonen* av langvarig innlogging, men det er IKKE token-basert.

### Faktisk arkitektur

```
Bruker logger inn på AO → Mottar .ASPXAUTHNO (session) + logintoken (1 år)
                                    ↓
                        .ASPXAUTHNO = faktisk auth
                        logintoken = "husk meg" for neste login
                                    ↓
                        Nettleser session restore → beholder .ASPXAUTHNO
                                    ↓
                        Lukke nettleser helt → mister .ASPXAUTHNO
                        (med mindre session restore er aktivert)
```

### Konsekvenser for appen

| Aspekt | Status |
|--------|--------|
| Automatisk token-refresh | ❌ Ikke mulig |
| 1-års sesjon | ❌ Ikke mulig |
| Manuell .ASPXAUTHNO-kopi | ✅ Eneste løsning |
| Sliding expiration (~30 min) | ✅ Fungerer |

### Anbefalt UX

Siden automatisk token-refresh ikke er mulig, bør vi:

1. **Tydelig kommunisere** at tokens utløper etter ~30 min inaktivitet
2. **Forenkle kopiering** av .ASPXAUTHNO fra nettleser
3. **Vurdere OIDC** på mobil.artsobservasjoner.no som alternativ (støtter refresh_token)

### logintoken-format (for referanse)

```
<userId>:<hash>
Eksempel: 290628:1b468755c0676437272dbd42a0456cd1ca3d122915e6620d976720148f35a87c
```

- `userId` (før kolon): Bruker-ID i AO-systemet  
- `hash` (etter kolon): 64 tegn hex = 256-bit token
- **Funksjon:** Kun for "husk meg" ved manuell innlogging

---

## Appendiks: OIDC på mobil (for referanse)

> **Merk:** Dette er ikke relevant for www.artsobservasjoner.no-integrasjonen, 
> men dokumentert for eventuell fremtidig bruk av mobil-API.

mobil.artsobservasjoner.no bruker OpenID Connect med dedikert identitetsserver.

**Identitetsserver:** `https://login.artsobservasjoner.no`

**Discovery:** `/.well-known/openid-configuration`

**Støttede grant types:**
- `authorization_code` ✅
- `refresh_token` ✅
- `client_credentials`
- `password`

**Scopes:**
- `openid` - Basis OIDC
- `offline_access` - Gir refresh token
- `artsobservasjoner3_api` - API-tilgang
- `ids`, `roles` - Brukerinfo

**Mobil-appens client_id:** `343D29426248B57F26F51DDC2572FBFF`

---

## Relaterte filer

- [server.py](../server.py) - Hovedserver med /api/ao-sites endepunkt
- [src/api_handlers.py](../src/api_handlers.py) - AO API-integrasjon
- [public/js/location.js](../public/js/location.js) - Frontend token-håndtering
- [public/ao-direct.html](../public/ao-direct.html) - Manuell token-input side
