# TODO

## ~~1. Oppdater dokumentasjon for v1.18.5 og v1.18.6~~ ✅
- ~~Changelog/docs mangler for de to siste patchene~~ → Oppdatert
- ~~Legg til instruksjon i CLAUDE.md~~ → Lagt til versjoneringsrutine

## 2. "Skjul funn til dato" (AO-felt)
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
