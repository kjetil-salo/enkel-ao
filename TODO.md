# TODO

## 1. Oppdater dokumentasjon for v1.18.5 og v1.18.6
- Changelog/docs mangler for de to siste patchene
- Legg til instruksjon i CLAUDE.md om at dokumentasjon alltid skal oppdateres ved ny versjon (changelog, evt. docs/)

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
