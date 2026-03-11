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

## ~~6. Private lokasjoner – hente alle på én gang (ikke bare bbox)~~ ✅

Implementert i v1.23.0. `BindUserSitesGrid` henter alle private lokasjoner, cachet i `localStorage['ao_private_sites']` (24t TTL). Sammenslåing med bbox-sites skjer i `location.js`.

**Kjent begrensning:** Race condition ved kald start — hvis bruker åpner dropdown før bakgrunnshenting er ferdig, vises ikke fjerne private lokasjoner. Vurdert som uproblematisk i praksis (skjer bare aller første gang etter innlogging).

**Neste:** Avstandsfiltrering — ikke vis lokasjoner som er mer enn X km unna (f.eks. ikke Finnmark-lokasjoner når man er i Bergen).

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
