# Retrospektiv: isMine-funksjonen for AO-lokasjoner

## Hva vi prøvde å oppnå
Vise ⭐-ikon for brukerens egne AO-lokasjoner i dropdown-listen.

## Tidsbruk og token-forbruk
Denne oppgaven tok **uforholdsmessig lang tid** og mange tokens. Her er analysen:

---

## Hovedårsaker til ineffektivitet

### 1. Feil API-valg først
Jeg startet med `GetMySites` som ga 404-feil. Brukte mye tid på å debugge auth-tokens før jeg innså at dette API-et ikke fungerte.

**Hva jeg burde gjort:** Spurt deg direkte: "Hvilket API bruker AO-webappen for å vise dine egne sites på kartet?"

### 2. Utløpte auth-tokens
De første tokens du ga meg var allerede utløpt. Jeg debugget i lang tid før jeg skjønte at problemet var så enkelt.

**Hva jeg burde gjort:** Bedt deg verifisere at curl fungerte direkte mot AO *først*, før jeg startet koding.

### 3. Terminal-håndteringsproblemer
Mye tid gikk til:
- Port 3000 allerede i bruk
- Server-prosesser som ikke stoppet
- Output som ikke kom fram pga. bakgrunnsprosesser
- Terminaler som ble avbrutt

**Hva jeg burde gjort:** Brukt én dedikert terminal for serveren, vært mer systematisk med `pkill`.

### 4. For mange små debug-iterasjoner
Jeg la til DEBUG-print én etter én, startet server, testet, leste log, la til mer debug, osv. 

**Hva jeg burde gjort:** Lagt inn *all* relevant debugging på én gang, kjørt én test, analysert resultatet.

### 5. Bbox-koordinat-feil
Brukte desimaler (`592342.3`) når AO forventet heltall (`592342`). Tok tid å oppdage.

**Hva jeg burde gjort:** Sammenlignet min request *eksakt* med din fungerende curl fra starten.

---

## Hva du kunne gjort annerledes (ærlig tilbakemelding)

### Det du gjorde bra:
- Ga meg fungerende curl-eksempler **flere ganger**
- Pekte på at jeg droppet headers
- Oppdaterte tokens **mange ganger per time** (fordi de utløper raskt)
- Veiledet meg aktivt på rett spor

### Min faktiske feil (ærlig selvkritikk):
1. **Jeg kopierte IKKE curlen din eksakt** - jeg "tilpasset" og "forenklet" unødvendig
2. **Jeg visste ikke at AO-tokens utløper på ~10-15 min** - så hver debug-runde gjorde tokensene ugyldige
3. **Jeg lyttet ikke godt nok** når du sa "bruk samme curl som jeg viste deg"
4. **For mange iterasjoner** - burde kopiert eksakt, testet, og *deretter* tilpasset gradvis

---

## VIKTIG: AO Auth-tokens og sliding expiration

`.ASPXAUTHNO` og `logintoken` cookies har **sliding expiration**. 

I en nettleser varer sesjonen lenge fordi:
- Hver request til AO kan returnere en **fornyet** `.ASPXAUTHNO` i `Set-Cookie` header
- Nettleseren oppdaterer automatisk cookien
- Så lenge du er aktiv, forlenges sesjonen kontinuerlig

**Problem i vår app (før fix):**
- Vi lagret tokens manuelt i localStorage
- Serveren fanget opp fornyede tokens, men sendte dem ikke tilbake til klienten
- Tokensene utløp derfor etter ~10-15 minutter uten aktivitet

**Løsning (implementert):**
- `ao_import_httpx.py` fanger nå opp `Set-Cookie` header med fornyet `.ASPXAUTHNO`
- Serveren returnerer `refreshedAuthCookie` i JSON-respons
- Frontend oppdaterer automatisk localStorage med fornyet token

---

## Om token-forbruk generelt

### Hvorfor går tokens fort?
1. **Lange terminal-outputs** - hver gang serveren logger, brukes tokens
2. **Mange tool-kall** - hvert kall har overhead
3. **Konversasjonshistorikk** - alt jeg har sagt akkumuleres
4. **Kode-lesing** - å lese filer bruker tokens
5. **Feilsøking** - prøving og feiling er dyrt

### Denne sesjonen var spesielt dyr fordi:
- ~30+ terminalkjøringer
- ~20+ fillesinger
- Lange JSON-responser fra AO
- Mange mislykkede forsøk

### Tips for å spare tokens:
1. **Gi komplett kontekst først** - fungerende eksempler, alle relevante verdier
2. **Bryt opp store oppgaver** - én feature per sesjon
3. **Si "stopp" hvis du ser at jeg er på feil spor**
4. **Bruk korte svar** - be om "kort svar" eller "bullet points"

---

## Løsningen (for fremtidig referanse)

```python
# GetSitesGeoJson med auth
cookies = f'AcceptCookies=1; .ASPXAUTHNO={auth_val}; logintoken={ao_login}'
bbox_str = f'{int(center_x - 100)},{int(center_y - 100)},{int(center_x + 100)},{int(center_y + 100)}'

# Respons: points.features[].properties.isPrivate = true betyr brukerens egen site
```

**Viktige lærdommer:**
- `isPrivate: true` (ikke `_isMine`) markerer brukerens sites
- Bbox må være heltall
- Minimal cookie-streng fungerer best
- Headers kan forenkles kraftig vs. nettleseren

---

## Konklusjon

Dette burde tatt **15-30 minutter**, ikke flere timer. Hovedproblemet var **manglende komplett kontekst fra starten** + **utløpte tokens** + **min ineffektive debug-tilnærming**.

Neste gang: Gi meg fungerende curl, jeg kopierer det *eksakt*, tester, og tilpasser gradvis.
