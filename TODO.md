# TODO

## 15. Fjern kråke-unntak i toCsv (~juli 2026)

AO slo sammen kråke og svartkråke – begge fikk norsk navn "kråke" i navnebasen, noe som gir feil ved Excel-import.
Midlertidig workaround i `observations.js` `toCsv()`: når taxonName er "kråke" brukes latinsk navn (scientificNameHtml) i stedet.

Fjern unntaket når AO har fikset navnekonflikten. Se kommentar i kode (`TODO: Fjern dette unntaket...`).
Melding fra AO-support (2026-06-01, sak #11532): *"Det vil nok bli fikset snart."*

## ~~1. Oppdater dokumentasjon for v1.18.5 og v1.18.6~~ ✅
- ~~Changelog/docs mangler for de to siste patchene~~ → Oppdatert
- ~~Legg til instruksjon i CLAUDE.md~~ → Lagt til versjoneringsrutine

## 12. Utvid Playwright-tester til å dekke Galaxy-viewports

Playwright kan **ikke** se om en knapp er utenfor skjermen via `toBeVisible()` alene —
det sjekker bare CSS-synlighet (display/opacity/visibility), ikke viewport-plassering.
Det vi må gjøre er `boundingBox()` + sammenligne med `viewportSize().width`.

Det gjør vi allerede i `mobile-layout.spec.ts`, men kun for iphone-15-prosjektet.

**Hva som mangler:**
- Legg til `samsung-galaxy-412` i `playwright.config.ts` (412px, dpr 3.5, Android UA) — dette er S21/S24 Ultra-klassen
- Kjør de eksisterende boundingBox-testene mot dette prosjektet også
- Vurder: beholder vi 360px-prosjektet, eller bytter vi til 412px som er mer representativt for flaggskip?

**Merk:** 360px (nåværende) og 412px gir ulike feil — behold begge for å fange regresjoner på tvers.

## 10. Oppdater hjelpesiden (help.html)

- Layout-endringer siden sist: alder/kjønn flyttet inn i obs-seksjonen, section-optional fjernet, knapper omstrukturert i Send inn
- Gjennomgå help.html og oppdater skjermbilder/beskrivelser som ikke lenger stemmer
- Sjekk spesielt: beskrivelse av registreringsflyt og eksport-seksjonen

## 2. Medobservatører – nullstilling og avkryssing

**Auto-nullstilling ved ny dag:**
- Medobservatører skal automatisk fjernes/nullstilles hvis forrige observasjon ble registrert en annen dag enn i dag
- Hensikt: det er lett å glemme å ta bort medobservatør – en medobservatør satt i går skal ikke følge med videre
- Implementering: ved oppstart / first interaction, sjekk dato på siste lagrede observasjon. Hvis dato ≠ i dag → nullstill medobservatørfeltet

**Avkryssing:**
- Ved registrering av observasjon med medobservatører: legg til mulighet for å avkrysse disse
- Enten ved eksport (CSV) eller ved visning neste dag
- Gjelder enkel-ao / fugleobservasjoner-appen

## ~~6. Alder og kjønn – tilbake i obs-seksjonen~~ ✅

Implementert: alder og kjønn ligger nå som to kompakte dropdowns side om side under aktivitets-raden, inne i obs-seksjonen. Den separate "Tilleggsinfo"-seksjonen er fjernet.

## 11. Logging på Pi – loggvisning og rotasjon

- Når appen flyttes til Pi mister vi Fly.io sin innebygde logg-visning
- **Vurder loggvisning:** [Dozzle](https://dozzle.dev/) er et lettvekts Docker-basert loggvisningsverktøy (én container, web-UI, leser Docker-logger live, ingen lagring). Alternativ: Loki + Grafana (mye tyngre, men kjent grensesnitt).
- **Loggrotasjon er obligatorisk** – uten rotasjon kan logger fylle opp Pi-disken. Løsning: Docker sin innebygde `json-file`-driver med `max-size` og `max-file`:
  ```yaml
  logging:
    driver: "json-file"
    options:
      max-size: "10m"
      max-file: "3"
  ```
- Legg dette inn i `docker-compose.yml` på Pi før produksjonsmigrasjon
- Avklar om Supabase-logging (logview) erstattes, suppleres eller droppes

## 7. Flytte enkel-ao til Raspberry Pi

- I dag kjører appen på Fly.io (enkel-ao.fly.dev)
- Målet er å flytte den til Pi-en (samme infrastruktur som dagens-funn og efugl.no)
- Lage en konkret migrasjonsplan:
  - Docker Compose på Pi + Cloudflare Tunnel (samme mønster som dagens-funn)
  - DNS-peker (ny subdomain under efugl.no, f.eks. ao.efugl.no?)
  - Avklar om Supabase-logging skal beholdes eller droppes
  - Avklar hva som skjer med Fly.io-appen etter migrering (slett eller behold som backup)
  - Lag deploy-script tilsvarende dagens-funn (rsync + docker compose)

## 8. Settings-siden – responsivt design for desktop

- Settings-siden ser ut til å ha fast bredde og ser ikke bra ut på desktop
- Bør ha samme responsive layout som index.html (maks-bredde, sentrert, skalerer pent)
- Gjennomgå CSS og HTML-struktur for settings.html og juster

## 3. "Skjul funn til dato" (AO-felt)
- AO har et felt for å skjule observasjoner frem til en dato
- Brukes sjelden, bør IKKE ligge på index.html
- Plassering: Settings-siden
- Alternativer å vurdere:
  - **Alt A:** Enkel checkboks "Skjul funn i 1 uke" (hardkodet 7 dager fra registrering)
  - **Alt B:** Checkboks + datofelt for egendefinert dato
- Verdien lagres i localStorage og brukes automatisk i CSV-eksport (kolonne 16: "Skjul funn til dato")

## 9. Gjennomgang av testdekning (etter layout-endringer)

- Flere layout-endringer nylig: alder/kjønn flyttet inn i obs-seksjonen, section-optional fjernet, knapp-HTML omstrukturert
- Sjekk om eksisterende tester fortsatt dekker disse elementene korrekt
- Vurder om nye tester trengs for de endrede komponentene

## 4. Gjennomgang av testdekning
- Sjekk om eksisterende tester dekker alle scenarier etter nyere endringer
- Vurder om nye tester trengs for: AO-import, aktivitetspills, visuell layout, curl-baserte API-kall
- Identifiser eventuelle hull i test-coverage

## ~~6. Private lokasjoner – hente alle på én gang (ikke bare bbox)~~ ✅

Implementert i v1.23.0. `BindUserSitesGrid` henter alle private lokasjoner, cachet i `localStorage['ao_private_sites']` (24t TTL). Sammenslåing med bbox-sites skjer i `location.js`.

**Kjent begrensning:** Race condition ved kald start — hvis bruker åpner dropdown før bakgrunnshenting er ferdig, vises ikke fjerne private lokasjoner. Vurdert som uproblematisk i praksis (skjer bare aller første gang etter innlogging).

**Neste:** Sortering innen privat-bolken — egne private (⭐ `isMine`) skal sorteres før andre private (👤) innen privat-gruppen, men fortsatt på avstand innen hver undergruppe. Altså: super → public → mine private (avstand) → andre private (avstand).

---

## 13. Gjennomgang av fargebruk og visuelt theme

En bruker ga tilbakemelding om at appen har for mange forskjellige farger. Vi er ikke nødvendigvis enig, men det er verdt å vurdere:
- Kartlegg alle farger som brukes i appen (knapper, badges, statusfarger, header, bakgrunner)
- Vurder om fargepaletten er konsistent og om alle farger har en tydelig semantisk rolle
- Sjekk spesielt: er det farger som brukes i lignende kontekster men ser ulike ut?
- Bestem om noe skal harmoniseres, eller om vi aktivt forsvarer variasjonen

## 14. Verifiser auth-relogin-logging i prod

- Sjekk logger (Dozzle/Fly.io) for `AUTH-RELOGIN-REQUIRED` og `AUTH-RELOGIN-RESULT` etter noen dagers drift
- Verifiser at sliding expiration fungerer (få eller ingen relogin-events)
- Verifiser at credentials overlever restart (ingen "ingen lagrede credentials"-meldinger)
- Deployet 2026-03-22 med error-logging i `_full_relogin`

## 12. Jevnlig logg-gjennomgang

- Se gjennom Fly.io-loggene (eller Pi-logger etter migrering) jevnlig
- Se etter: feilmeldinger, warnings, timeout-mønstre, uventede statuskoder
- Bruk loggen aktivt som kilde til forbedringer (slik som med dagens-funn 2026-03-12 der logganalyse avdekket parallellitets-timeout, HTML-i-stedet-for-JSON og ugyldig push-subscription)

---

## 15. Eksport feiler for observasjoner på private lokasjoner som ikke er mine

- Observasjoner gjort på andres private lokasjoner forsvinner/mistes ved eksport
- Skjedde i felt 2026-03-22 – har skjedd flere ganger
- Undersøk: er det CSV-genereringen, AO-import, eller lagringen som mister disse?
- Sjekk om locationId/stedsnavn mangler eller blir filtrert bort for ikke-egne private steder
- Kritisk bug – tap av data i felt er uakseptabelt

---

## 16. ksalo.no — landingsside for mine apper

Kjøpt domenet ksalo.no. Skal være en enkel statisk landingsside med tiles/kort som lenker til appene som allerede kjører på Pi-en.

**Apper som skal med:**
- Dagens funn (fugleobservasjoner)
- Enkel AO (fugleregistrering)
- Drivstoff
- Keycloak
- Simple-auth

**Hva som trengs:**
- Enkel statisk HTML/CSS-side med tiles som peker til eksisterende URL-er
- DNS: pek ksalo.no til Pi via Cloudflare Tunnel
- Serve landingssiden via enkel webserver (Caddy/Nginx) på Pi
- Ingen reverse proxy nødvendig — tilene lenker direkte til appene der de allerede kjører

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
