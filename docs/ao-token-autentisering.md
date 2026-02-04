# Oppsummering (2026-02-03, oppdatert)

## NY LØSNING: Innlogging med brukernavn/passord (2026-02-03)

Vi har nå implementert innlogging via brukernavn/passord som gir oss:
- **Automatisk token-fornyelse**: Backend logger automatisk inn på nytt når session utløper
- **Ingen manuell token-kopiering**: Brukeren trenger bare oppgi brukernavn/passord én gang
- **Langtidsvarende sesjon**: Så lenge credentials er lagret, fornyes sesjonen automatisk

### Ny flyt
1. Bruker oppgir brukernavn + passord på ao-direct.html
2. Backend (`/api/ao-login`) logger inn mot AO og returnerer:
   - `.ASPXAUTHNO` (auth cookie, session-scope)
   - `loginToken` (session-scope, kun for "husk meg")
   - `userId`
3. Tokens lagres i localStorage
4. Ved API-kall som krever auth, brukes tokens automatisk
5. Hvis auth feiler, logger backend automatisk inn på nytt (auto-relogin)

### Sikkerhet
- Credentials lagres kun i minnet på backend (ikke på disk)
- Credentials fjernes ved server-restart
- For produksjon med flere brukere: bør vurdere kryptering av localStorage

---

## Hvordan AO fungerer (2026-02-03, testet)
- AO bruker ASP.NET Forms Authentication med sliding expiration for autentisering.
- `.ASPXAUTHNO` er en kryptert session-cookie, ikke lesbar eller base64-dekoderbar for klienten.
- `logintoken` er kun for "Husk meg"-funksjon ved manuell innlogging, ikke for API-autentisering.
- **Sliding expiration:** AO fornyer kun `.ASPXAUTHNO` hvis den fortsatt er gyldig og nær utløp, og kun ved API-kall eller besøk på AO-sider. Hvis cookien er utløpt, hjelper det IKKE å sende logintoken – AO gir ikke ny session.
- **Utløpt/invalidert cookie kan ikke fornyes** – da kreves ny innlogging via /LogOn (enten manuelt eller med POST mot AO).
- **logintoken kan ikke konverteres til .ASPXAUTHNO programmatisk** – det finnes ingen endpoint eller API som gir ny session basert på logintoken alene. Probing med logintoken (også sammen med .ASPXAUTHNO) gir aldri ny session etter utløp.
- **Session restore i nettleser** gir illusjon av langvarig innlogging, men er ikke token-basert. Dette er kun fordi nettleseren husker session-cookies hvis den ikke lukkes helt.

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
- Sliding expiration fungerer **kun** for gyldige sessions. Hvis `.ASPXAUTHNO` er utløpt, hjelper det ikke å sende logintoken + logintoken_ssl – AO gir ikke ny session.
- **logintoken kan IKKE konverteres til .ASPXAUTHNO programmatisk** – selv med logintoken_ssl=1.
- Frontend og backend håndterer oppdatering av tokens i localStorage automatisk når ny cookie mottas.
- logintoken og .ASPXAUTHNO er ikke lesbare eller base64-dekodet – de er kun "nøkler" mot AO.
- **Langvarig sesjon er NÅ mulig** via brukernavn/passord auto-relogin (implementert 2026-02-03).

## Oppsummert
- Vi har implementert **brukernavn/passord auto-relogin** som gir langvarig sesjon uten manuell token-kopiering.
- Sliding expiration fungerer kun for gyldige sessions – logintoken alene kan ikke fornye utløpt session.
- Når cookien er utløpt, logger appen automatisk inn på nytt med lagrede credentials.
- Manuell token-kopi er fortsatt tilgjengelig som backup-løsning.

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
- **Levetid:** Session-scope (forsvinner når nettleser lukkes helt)
- **Expires-header:** Settes til ~1 år frem i tid, MEN dette er misvisende
- **Funksjon:** Kun "Husk meg" – pre-fyller brukernavn ved neste manuelle innlogging
- **Viktig:** Kan IKKE brukes til å gjenopprette `.ASPXAUTHNO` programmatisk
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

- Forventet oppførsel: `.ASPXAUTHNO` utløper etter ~15-30 min inaktivitet
- **Løsning (implementert):** Auto-relogin med lagrede credentials
- Fallback: Bruker kan manuelt logge inn på nytt på ao-direct.html

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

## Langvarig sesjon - ✅ LØST (brukernavn/passord)

### Mål (opprinnelig)
Oppnå en sesjon som varer 1 år – slik at bruker bare trenger å logge inn én gang årlig.

### ❌ Konklusjon (testet 2026-02-02 og 2026-02-03)

**logintoken + logintoken_ssl kan IKKE brukes til å fornye eller gjenopprette .ASPXAUTHNO programmatisk.**

Etter grundig testing fant vi at:

1. **logintoken er KUN for "Remember Me"** – den pre-fyller brukernavn ved neste **manuelle** innlogging (via /LogOn)
2. **.ASPXAUTHNO er den faktiske auth-cookien** – kreves for API-tilgang
3. **Ingen automatisk utveksling** – det finnes ingen endpoint som konverterer logintoken → .ASPXAUTHNO
4. **Probing med logintoken + logintoken_ssl (også sammen med ugyldig .ASPXAUTHNO) gir aldri ny session etter utløp.** Kun eksplisitt POST til /LogOn (med brukernavn/passord) gir ny session.
5. **Sliding expiration returnerer ny .ASPXAUTHNO KUN når eksisterende cookie er gyldig** – ikke når den er utløpt eller mangler.

#### Testbevis

```bash
# Test 1: Forsiden med bare logintoken + logintoken_ssl
curl -s "https://www.artsobservasjoner.no/" \
  -H "Cookie: logintoken=290628:1b468755...; logintoken_ssl=1" \
  | grep -o "Logg inn\|Logg ut"
# Resultat: "Logg inn" (IKKE innlogget)

# Test 2: Beskyttet side med bare logintoken + logintoken_ssl
curl -i -s -L "https://www.artsobservasjoner.no/SubmitSighting/Report" \
  -H "Cookie: logintoken=290745:...; logintoken_ssl=1" \
  | grep "set-cookie.*ASPXAUTH"
# Resultat: INGEN .ASPXAUTHNO returnert, kun redirect til /LogOn

# Test 3: Dagens observasjoner med bare logintoken + logintoken_ssl
curl -s "https://www.artsobservasjoner.no/TodaysSightings/..." \
  -H "Cookie: AcceptCookies=1; logintoken=290745:...; logintoken_ssl=1" \
  | grep -o "Logg inn\|Logg ut"
# Resultat: "Logg inn" (IKKE innlogget)

# Test 4: Probing med ugyldig .ASPXAUTHNO + logintoken
curl -i -s -L "https://www.artsobservasjoner.no/TodaysSightings/..." \
  -H "Cookie: .ASPXAUTHNO=GAMMEL_UGYLDIG_VERDI; logintoken=290745:...; logintoken_ssl=1" \
  | grep "set-cookie.*ASPXAUTH"
# Resultat: INGEN .ASPXAUTHNO returnert

# Test 5: Sliding expiration MED gyldig .ASPXAUTHNO (fungerer!)
curl -i -s "https://www.artsobservasjoner.no/TodaysSightings/..." \
  -H "Cookie: logintoken=290745:...; logintoken_ssl=1; .ASPXAUTHNO=GYLDIG_VERDI" \
  | grep "set-cookie.*ASPXAUTH"
# Resultat: NY .ASPXAUTHNO returnert (sliding expiration fungerer)
```

#### Observasjon fra ekstern testing

En ekstern tester rapporterte at han fikk ny .ASPXAUTHNO med kun logintoken + logintoken_ssl.
Vår hypotese er at dette skyldes **server-side session caching**:
- ASP.NET kan beholde session-state på serveren etter at cookie er slettet client-side
- Hvis logintoken matcher en nylig aktiv (men ikke garbage-collected) server-session, kan AO returnere ny .ASPXAUTHNO
- Dette er et "race condition"-vindu og er **upålitelig** for produksjonsbruk

**Konklusjon:** logintoken alene gir ikke pålitelig session-fornyelse. Brukernavn/passord auto-relogin er den eneste robuste løsningen.

### Hvorfor "1-års innlogging" i nettleser?

Det ser ut som AO gir 1-års innlogging, men dette er en **illusjon** skapt av to mekanismer:

#### De to cookiene

| Cookie | Expires-header | Faktisk scope | Funksjon |
|--------|----------------|---------------|----------|
| `.ASPXAUTHNO` | Session | Session | Faktisk autentisering |
| `logintoken` | ~1 år | Session* | "Husk meg" (pre-fyller brukernavn) |

*`logintoken` har `Expires` satt til ~1 år, men oppfører seg som session-cookie i praksis.

#### Nettleserens session restore

Moderne nettlesere (Safari, Firefox, Chrome) har **session restore** som gjenoppretter
sesjons-cookies når nettleseren åpnes igjen (selv uten `Expires`-header). Dette betyr:

1. Bruker logger inn → mottar `.ASPXAUTHNO` (session) + `logintoken`
2. Bruker "lukker" nettleseren (men ikke helt – tabs gjenopprettes ved neste start)
3. Nettleser session restore → `.ASPXAUTHNO` er fortsatt der
4. Bruker er fortsatt innlogget → *illusjon* av langvarig sesjon

#### Når illusjonen brytes

- **Tving-lukking av nettleser** (kill process) → session-cookies forsvinner
- **Privat/inkognito-modus** → ingen session restore
- **Sletting av cookies** → må logge inn på nytt
- **Server-side timeout** → `.ASPXAUTHNO` invalideres selv om cookie finnes

#### Testet hypotese (forkastet)

Vi testet om `logintoken` kunne brukes til automatisk session-fornyelse på `/LogOn`:
- Sendte `logintoken` + `logintoken_ssl` til beskyttede sider → **ingen ny `.ASPXAUTHNO`**
- Sendte ugyldig `.ASPXAUTHNO` + `logintoken` → **ingen ny session**
- Konklusjon: `logintoken` gir kun pre-fylt brukernavn, ikke automatisk innlogging

### Faktisk arkitektur

```
Bruker logger inn på AO → Mottar .ASPXAUTHNO (session) + logintoken (session*)
                                    ↓
                        .ASPXAUTHNO = faktisk auth (sliding expiration ~30 min)
                        logintoken = "husk meg" (pre-fyller brukernavn ved neste login)
                                    ↓
                        Nettleser session restore → beholder begge cookies
                                    ↓
                        Sliding expiration → .ASPXAUTHNO fornyes ved aktivitet
                                    ↓
                        Lukke nettleser HELT → mister session-cookies
                        (med mindre session restore er aktivert)

* logintoken har Expires ~1 år, men dette er kun for "husk meg"-funksjon
```

### Konsekvenser for appen

| Aspekt | Status |
|--------|--------|
| Automatisk token-refresh etter utløp | ✅ Via auto-relogin med credentials |
| Langvarig sesjon | ✅ Så lenge credentials er lagret |
| Manuell .ASPXAUTHNO-kopi | ✅ Fortsatt mulig (backup) |
| Sliding expiration (~30 min) | ✅ Fungerer, men kun for gyldig session |

### Anbefalt UX (oppdatert 2026-02-03)

Med brukernavn/passord auto-relogin har vi nå en robust løsning:

1. **Engangs-innlogging:** Bruker oppgir brukernavn/passord på ao-direct.html
2. **Automatisk fornyelse:** Når session utløper, logger appen automatisk inn på nytt
3. **Fallback:** Manuell token-kopi er fortsatt tilgjengelig som backup
4. **Fremtidig:** OIDC på mobil.artsobservasjoner.no kan vurderes (støtter refresh_token)

### logintoken-format (for referanse)

```
<userId>:<hash>
Eksempel: 290628:1b468755c0676437272dbd42a0456cd1ca3d122915e6620d976720148f35a87c
```

- `userId` (før kolon): Bruker-ID i AO-systemet
- `hash` (etter kolon): 64 tegn hex = 256-bit token
- **Expires-header:** ~1 år (men dette er misvisende – cookien oppfører seg som session)
- **Faktisk scope:** Session (forsvinner ved full nettleserlukking)
- **Funksjon:** Kun for "husk meg" – pre-fyller brukernavn ved neste manuelle innlogging
- **Kan IKKE:** Gjenopprette `.ASPXAUTHNO` automatisk eller programmatisk

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
