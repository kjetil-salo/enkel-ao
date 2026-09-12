# Analyse: Kryss-app Fellestur mellom Enkel AO og Feltlogg

**Opprettet:** 2026-09-11

## Bakgrunn

Feltlogg (feltlogg.no) og Enkel AO (ao.efugl.no) har uavhengig av hverandre bygget en
nesten identisk funksjon: en delt, skrivbar loggbok for en gruppe i felt, låst opp med en
kort kode. Produkteier har bestemt at appene skal samarbeide: en bruker på Enkel AO og en
bruker på Feltlogg skal kunne bli med i samme fellestur og se hverandres oppføringer i
sanntid — konkret eksempel: Kjetil (Enkel AO) og Feltlogg-utvikleren går på tur sammen,
hver med sin egen app.

Feltlogg har levert en detaljert, bekreftet spesifikasjon (`COOPERATE_PLAN.md`, mottatt via
delt lenke) som inkluderer en normativ peer-til-peer-kontrakt (Appendix A) for at ulike
apper skal kunne føderere en gruppesesjon. Spesifikasjonen er ikke implementert på deres
side ennå heller.

Denne analysen dekker *hvordan* enkel-ao bør bygge dette — ikke *om*.

## Nåsituasjon

### Enkel AO — Fellestur (i produksjon)

- `src/fellestur_store.py`, `server.py` (`/api/fellestur`, `/api/fellestur-oppdater`,
  `/api/fellestur-sync`), `public/js/fellestur.js` + `fellestur-client.js` +
  `fellestur-sync.js`.
- 6-tegns alfanumerisk kode (entydig alfabet, unngår 0/O/1/I/L).
- Poll hvert 12. sek. Klienten holder et lokalt "speil" (`fellesturMirror_v1`) med et
  "sist bekreftet"-øyeblikksbilde, regner ut en diff (upserts/deletes) og sender denne som
  batch til `/api/fellestur-sync`. Race-beskyttelse mot polling-vs-lokal-endring er allerede
  nøye håndtert (versjonstelling, "ventende endringer vinner over server-svar til bekreftet").
  Se `apply_sync()`/`diffObservasjoner()`.
- Serverens sannhet: full-objekt upsert per `obs_id` (klientgenerert), siste skriving vinner
  **på hele raden**. Ingen delta-begrep for antall — `+/-`-knappene går gjennom akkurat
  samme full-objekt-diff som alt annet.
- Lagring: SQLite (`stats.db`), 48t TTL, rydder utløpte turer ved hver skriving.
- Personvern: hviteliste i `sanitize_observasjon()` — koordinater og bilde er aldri med.
- Ingen føderasjon. Kun én server kjenner til en gitt kode.

### Feltloggs forslag (ikke bygget)

- 5-sifret kode, poll hvert 5. sek.
- **Event-logg**, ikke snapshot: hver mutasjon er et eget event (`add`/`update`/`count`/
  `delete`) med server-tildelt `seq` og klientgenerert idempotent `id`. `count` er en delta
  (`±1`), ikke en verdi — løser nettopp problemet enkel-ao *ikke* har i dag fordi det bare
  finnes én autoritativ server: to uavhengige servere som begge mottar et `+1` samtidig, må
  konvergere uten en sentral lås.
- **Mesh-føderasjon**: hver server poster *sine egne klienters* hendelser til *alle*
  konfigurerte providere, uansett om koden er kjent der (peer svarer 404 hvis ikke — det er
  forventet, ikke en feil).
- Bearer-token-auth, én hemmelighet per server-par, retry med backoff, idempotens på `id`.

## Analyse

### Alternativ A — Bygg om Fellestur til å matche Feltloggs kontrakt fullt ut

Erstatt snapshot/diff-modellen med en ekte event-logg (seq, delta-count, osv.), bytt
kodeformat, omdesign server- og klientlag.

- **Fordel:** Ett enhetlig system, ingen oversettelseslag, 1:1 spec-samsvar.
- **Ulempe:** Kaster en velfungerende, godt uttestet synk-motor (se de fintfølte
  race-kommentarene i `fellestur-sync.js`) for å bygge en ny fra bunnen — for en funksjon som
  i dag har null kjente bugs i produksjon. Uforholdsmessig innsats for et hobbyprosjekt med
  få brukere. Rammer også alle eksisterende Fellestur-brukere med en full re-arkitektur for
  en use case (kryss-app) de færreste av dem bruker.

### Alternativ B — Tynn oversettelsesbro (adapter)

Behold eksisterende lagring (`fellestur_obs`-tabellen), synk-motor og UI helt urørt. Legg til
ett nytt modul (`fellestur_peer.py`) som:

- eksponerer **ett** nytt endepunkt, `POST /api/fellestur-peer/<kode>/events`, som følger
  Appendix A ord for ord (request/response-form, feilkoder),
- oversetter innkommende peer-events til kall mot eksisterende `apply_sync()`-logikk (samme
  tabell, samme rader — en Feltlogg-bruker og en Enkel AO-bruker på samme kode ser bokstavelig
  talt samme SQLite-rader),
- fanger utgående hendelser **i `apply_sync()`**, der vi allerede vet om en `obs_id` er ny
  (→ `add`) eller kjent (→ `update`/`delete`) — ingen ny instrumentering av UI-laget trengs —
  og poster dem til konfigurerte providere fra en bakgrunnstråd.

- **Fordel:** Null risiko for regresjon i eksisterende Fellestur. Liten, isolert diff. Passer
  mønsteret appen allerede bruker overalt (`share_store.py`, `feedback_store.py`: eget modul,
  egen fil, whitelisting).
- **Ulempe:** To kodeveier å holde i hodet (lokal apply_sync + peer-oversettelse) — akseptabelt
  fordi peer-laget er tynt og har én jobb.

### Sammenligning

| Egenskap | A: Full ombygging | B: Adapter |
|---|---|---|
| Risiko for eksisterende brukere | Høy (rører alt) | Ingen (nytt, isolert modul) |
| Innsats | Stor (ny synk-motor + UI) | Liten–middels (ett nytt modul + hooks i `apply_sync`) |
| Spec-samsvar for peers | Perfekt | Perfekt på peer-grensesnittet (det som teller for Feltlogg) |
| Vedlikeholdbarhet | Én modell, men alt nytt | To modeller, men klart atskilt ansvar |
| Pi-egnet | Ja | Ja — enda mer, mindre kode totalt |

## Anbefaling

**Alternativ B — tynn adapter.** Eksisterende Fellestur er produksjonssterk og har ingen
grunn til å endres for de som ikke bruker kryss-app. Bygg peer-laget som et nytt, lite modul
som snakker Feltloggs språk utad og enkel-ao sitt eget språk innad.

**Kodeformat:** bytt *hele* enkel-ao sin kodegenerering til 5 sifre (matcher Feltlogg
nøyaktig), ikke en dobbel kode-alfabet eller oversettelse. Bekreftet av produkteier: lengden
er uviktig, bare den er stor nok til at få brukere ikke kolliderer — 6 tegn var i overkant,
5 sifre holder fint (900 000 mulige koder er rikelig for en håndfull samtidige turer). Én
kode-vei å holde i hodet, og enkel-ao sine koder blir dermed *syntaktisk* gyldige
Feltlogg-koder uten oversettelse.

**Personvern/deling — avklart med produkteier: automatisk for alle turer.** Feltloggs D11
sier en server poster *alle* sine klienters fellestur-hendelser til *alle* konfigurerte
providere, uansett kode; peer svarer 404 hvis den ikke kjenner koden (spec-forventet).
Vurdert og bevisst akseptert av produkteier, av to grunner:

1. Feltlogg-utvikleren er en betrodd venn av produkteier — ikke en fremmed tredjepart.
2. `sanitize_observasjon()` i `fellestur_store.py` har aldri inkludert `hideUntil` i
   hvitelisten sin. Alt innhold i en fellestur er dermed allerede skrevet med sikte på
   offentlig AO-publisering — det finnes ingen "skjul denne hekkeplassen"-mekanisme å lekke
   forbi. Å forwarde det til Feltlogg øker ikke reell eksponering utover det som uansett skjer
   ved AO-import.

**Ingen opt-in-flagg.** Alle fellesturer forwardes til konfigurerte providere med en gang de
har innhold, present i tråd med Feltloggs egen D11. Enklest for brukeren — ingen bryter å
tenke på, ingen risiko for at noen glemmer å huke av for den ene turen det faktisk gjaldt.

## Krav

| ID | Krav | Verifiseringsmetode |
|----|------|---------------------|
| K1 | En bruker på Feltlogg og en bruker på Enkel AO kan bli med i samme 5-sifrede kode og se hverandres add/edit/delete innen ett pollintervall på hver side | Manuell test: to enheter, to apper, samme kode |
| K2 | Enkel AO sin kodegenerering endres til 5 sifre for **alle** nye fellesturer, ikke bare federerte | Enhetstest på `_generate_kode()`/`_gyldig_kode_format()` |
| K3 | Nytt endepunkt `POST /api/fellestur-peer/<kode>/events` følger Appendix A presist: request/respons-form, statuskoder 200/400/401/404/413/429 | Integrasjonstest mot spec-eksemplene i Appendix A.9 |
| K4 | Inbound peer-kall autentiseres med `Authorization: Bearer <eget inbound-secret>`, sammenlignet med `hmac.compare_digest` | Enhetstest: feil/manglende token → 401 |
| K5 | Peer-events anvendes på **samme** `fellestur_obs`-tabell som brukes av eksisterende `apply_sync()` — ingen egen, parallell datamodell | Kodeinspeksjon + integrasjonstest: peer-add er synlig i vanlig `GET /api/fellestur?kode=` |
| K6 | `count`-events fra en peer anvendes som delta (`max(1, lokal + delta)`), ikke full-objekt-erstatning | Enhetstest jf. Appendix A.7 |
| K7 | Utgående events genereres i `apply_sync()` (ikke i UI-laget): ny `obs_id` → `add`, kjent → `update`, sletting → `delete`; sendes til alle konfigurerte providere på en bakgrunnstråd uten å blokkere klientens forespørsel | Integrasjonstest med en mock-provider som teller mottatte kall |
| K8 | Forwarding-avgjørelsen ("skal denne turen sendes til providere?") sitter i **én** funksjon i `fellestur_peer.py` (v1: returnerer alltid True) — fremtidig opt-in/filtrering krever kun å endre denne ene funksjonen, ikke kalleren eller resten av modulen | Kodeinspeksjon: ett kallsted, én funksjon å endre |
| K9 | Manglende `fellestur_peer_providers.json` gir null forwarding og ingen feil — eksisterende Fellestur-brukere upåvirket | Kjør uten fil, verifiser vanlig `/api/fellestur-sync` fungerer identisk |
| K10 | Eget inbound-secret genereres automatisk ved første oppstart (samme mønster som `.secret_key`), lagres gitignoret, aldri logget | Kodeinspeksjon + `.gitignore`-sjekk |
| K11 | Retry på 5xx/nettverksfeil (inntil 3 forsøk, backoff), **ingen** retry på 400/401/404 | Enhetstest på retry-logikken med mock-respons |
| K12 | Duplikate `id` fra en peer lagres kun én gang (idempotens) | Integrasjonstest: send samme event to ganger, verifiser én rad |
| K13 | Eksisterende `/api/fellestur`, `/api/fellestur-oppdater`, `/api/fellestur-sync` er uendret i request/respons-kontrakt | Kjør eksisterende `tests/test_fellestur.py` uendret og grønt |

## Berørte filer og integrasjonspunkter

| Fil | Endring |
|---|---|
| `src/fellestur_store.py` | `_KODE_LENGTH`/`_KODE_ALPHABET` → 5 sifre. `apply_sync()` returnerer også hvilke rader som var nye vs oppdatert, til bruk for event-generering (eller: ny tynn wrapper rundt den som gjør dette uten å røre signaturen brukt av eksisterende endepunkter). |
| `src/fellestur_peer.py` (ny) | Secret-håndtering, provider-config, oversettelse begge veier, inbound-handler, utgående fan-out-tråd m/ retry, idempotens-tabell for mottatte peer-event-ider, **`skal_forwardes(tur)`** som ett samlet, lett-å-endre beslutningspunkt (v1: alltid True). |
| `server.py` | Nytt endepunkt `/api/fellestur-peer/<kode>/events` i eksisterende ruting (`do_POST`), egen rate-limit-bøtte (samme `_rate_ok`-mønster som `_fellestur_hits`). |
| `.gitignore` | `.fellestur_peer_secret`, `fellestur_peer_providers.json`. |
| `CLAUDE.md` | Nytt endepunkt, ny kolonne, peer-kontrakt-pekere. |
| `tests/test_fellestur.py` + nye peer-tester | Utvid. |

## Risiko

| Risiko | Konsekvens | Mottiltak |
|---|---|---|
| Peer-endepunkt er internett-eksponert uten kontoer | Brute-force-forsøk mot bearer-token, eller mot 5-sifrede koder | Rate-limit per IP (samme mønster som eksisterende fellestur-endepunkter), constant-time token-sammenligning, korte TTL-er som allerede finnes |
| Kodekollisjon på tvers av servere (D13, akseptert av Feltlogg selv) | To urelaterte grupper slås sammen hvis begge gir samme 5-sifrede kode til hver sin app | Akseptert risiko, arvet fra Feltloggs egen spec — lite sannsynlig ved fåtalls samtidige turer |
| Count-race mellom to *apper* på samme observasjon | Ett `+1` kan tapes hvis en Enkel AO- og en Feltlogg-bruker øker antallet på nøyaktig samme oppføring i samme vindu | Akseptert for v1 — krever at UI-laget i enkel-ao skiller "antall-knapp" fra "annen redigering" for å sende ekte delta-events utad; uforholdsmessig for reell bruk (få brukere, sjelden nøyaktig samtidig på samme rad) |
| Automatisk forwarding av alle turer | Innhold fra enhver fellestur sendes til konfigurerte providere, uansett om den var ment for kryss-app | Bevisst akseptert av produkteier (se Anbefaling). Beslutningen sitter likevel bak `skal_forwardes(tur)` — én funksjon å endre den dagen dette skal bli betinget, ikke en rearkitektering |
| Feltloggs hemmelighet i `COOPERATE_PLAN.md` | Havner i git-historikk hvis filen kopieres inn i repoet rått | Hemmeligheter går kun inn i `fellestur_peer_providers.json` (gitignoret), aldri i en committet fil eller dokumentasjon |
