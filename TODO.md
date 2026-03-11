# TODO

## ~~1. Oppdater dokumentasjon for v1.18.5 og v1.18.6~~ ✅
- ~~Changelog/docs mangler for de to siste patchene~~ → Oppdatert
- ~~Legg til instruksjon i CLAUDE.md~~ → Lagt til versjoneringsrutine

## 2. Avkryss medobservatører
- Ved registrering av observasjon med medobservatører: legg til mulighet for å avkrysse disse
- Enten ved eksport (CSV) eller ved visning neste dag
- Gjelder enkel-ao / fugleobservasjoner-appen

## 3. "Skjul funn til dato" (AO-felt)
- AO har et felt for å skjule observasjoner frem til en dato
- Brukes sjelden, bør IKKE ligge på index.html
- Plassering: Settings-siden
- Alternativer å vurdere:
  - **Alt A:** Enkel checkboks "Skjul funn i 1 uke" (hardkodet 7 dager fra registrering)
  - **Alt B:** Checkboks + datofelt for egendefinert dato
- Verdien lagres i localStorage og brukes automatisk i CSV-eksport (kolonne 16: "Skjul funn til dato")

## 3. Sikkerhet: pycurl og input-sanitering
- Vi bruker `pycurl` i stedet for `requests`/`urllib` for bedre kontroll over HTTP-headere (spesielt casing)
- Vurder:
  - Trenger vi input-sanitering på data som sendes via curl? (potensielt header injection, SSRF)
  - Finnes det andre Python-bibliotek som gir header-casing-kontroll uten curl? (f.eks. `httpx`, `hyper`)
  - Gjennomgå alle steder pycurl brukes og vurder angrepsflater

## 4. Gjennomgang av testdekning
- Sjekk om eksisterende tester dekker alle scenarier etter nyere endringer
- Vurder om nye tester trengs for: AO-import, aktivitetspills, visuell layout, curl-baserte API-kall
- Identifiser eventuelle hull i test-coverage

## 6. Private lokasjoner – hente alle på én gang (ikke bare bbox)

**Status etter undersøkelse:**

Appen har allerede `login_to_ao(username, password)` i `api_handlers.py` – map-id via F12 er allerede unødvendig for innloggede brukere. Det eksisterende kallet `/Map/GetSitesGeoJson` henter private lokasjoner, men **kun innenfor gjeldende bbox** (nær GPS-posisjon).

**Nøkkelfunn (bekreftet, 92 lokasjoner):**

Endepunktet **`/Site/BindUserSitesGrid`** (POST, www.artsobservasjoner.no) returnerer ALLE brukerens egne lokasjoner. Krever kun `.ASPXAUTHNO` cookie. Testet og bekreftet: returnerer nøyaktig 92 lokasjoner, matcher "Mine lokaliteter"-fanen i AO.

```
POST /Site/BindUserSitesGrid?UserSitesGrid-size=500
Content-Type: application/x-www-form-urlencoded

page=1&size=500
```

Respons-format (JSON, gzip-komprimert):
```json
{
  "data": [
    { "SiteId": 696744, "Name": "Baugtveit", "Description": "Baugtveit, Bergen, Ve",
      "SiteXCoord": 589514, "SiteYCoord": 8510509,  ← Web Mercator (EPSG:3857)
      "Accuracy": 300, "IsFavoriteSite": 1 },
    ...
  ]
}
```

Koordinater (`SiteXCoord`/`SiteYCoord`) må konverteres fra EPSG:3857 til WGS84 (lat/lon).

Undersøkt og avvist:
- `GetEditableSitesGeoJson` – bbox-begrenset, returnerte bare 58 av 92
- `GetPrivateAndPublicSitesGeoJson` – private drukner i 200-grensen mot offentlige
- `mobil.../core/Sites/ByUser` – 403, krever BFF/OIDC-auth vi ikke har

**Forslag til implementasjon:**

1. Etter innlogging: kall `BindUserSitesGrid` med `size=500` → hent alle 92 private lokasjoner
2. Konverter koordinater EPSG:3857 → WGS84
3. Cache i localStorage (eller serverside)
4. Ved GPS-søk: inkluder cachet liste direkte – dropp det gamle `GetSitesGeoJson`-kallet med bbox

**Designvalg for lagring:**
- **Alt A – localStorage:** Enkel, ingen brukertabell, ikke synkronisert mellom enheter
- **Alt B – serverside DB:** Krever brukertabell – nyttig til andre ting på sikt
- Anbefaling: Start med Alt A – enklest for privat app

---

## 5. Omfattende analyse av brukervennlighet
- Fokus på reell brukervennlighet for målgruppen: fuglekikkere i felt med mobil
- WCAG er IKKE relevant – dette er en privat app for folk med normalt syn (fuglekikking krever godt syn)
- Vurder:
  - Er flyten fra lokasjon → art → antall → registrer rask og intuitiv?
  - Fungerer det godt med kalde/våte fingre og hansker?
  - Er knapper og touch-targets store nok i felt?
  - Er informasjonshierarkiet tydelig – ser man det viktigste først?
  - Er det unødvendige steg eller klikk som kan fjernes?
  - Fungerer appen godt i sterkt sollys (kontrast)?
  - Er feilmeldinger og feedback tydelige nok i stressede situasjoner (fuglen flyr snart!)?
