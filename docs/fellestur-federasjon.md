# Fellestur — kryss-app-føderasjon

## Oversikt

Fra v1.51.0 kan en Fellestur i Enkel AO deles på tvers av apper: en bruker på
Enkel AO og en bruker på en samarbeidende app (først ut: **Feltlogg**,
feltlogg.no) kan bli med i samme fellestur-kode og se hverandres
oppføringer, uten at noen av appene endrer sin egen lagring eller UI.

Dette er en **tynn oversettelsesbro**, ikke en ombygging av Fellestur:
`src/fellestur_peer.py` oversetter til/fra en delt event-kontrakt og
anvender alt mot den samme `fellestur_obs`-tabellen som
`/api/fellestur-sync` allerede bruker. Se
[docs/ANALYSIS_FELLESTUR_FODERASJON.md](ANALYSIS_FELLESTUR_FODERASJON.md)
for den fulle analysen og designvalgene bak dette (alternativ B: adapter,
ikke full ombygging).

## Status (2026-10-28)

- ✅ v1.58.3 er deployet til [produksjon på Pi](https://ao.efugl.no) etter staging-kontroll.
- ✅ Enkel AO sin egen inbound-secret er generert.
- ✅ Feltlogg er konfigurert som mottaker på Pi. Nøkkelen ligger kun på data-volumet.
- ✅ Sending begge veier er verifisert mot produksjon, inkludert Feltloggs mottakskvittering.
- ✅ Påmelding via PIN, oppdagelse fra innkommende hendelser og gult varsel for
  ubekreftede koder er tilgjengelig i produksjon. Ingen liste over aktive turer.

### Verifisering av v1.58.3

- 541 Python-tester og 295 JavaScript-tester passerer. Kodegjennomgang godkjent.
- Lokal nettlesertest på 320 pikslers mobilbredde dekker hele flyten:
  ukjent kode → varsel → «Bli med likevel» → ubekreftet tur → simulert,
  autentisert peer-hendelse → bekreftet tur med observasjon. En annen deltaker
  får fortsatt varsel så lenge koden er ubekreftet.
- Fly.io-staging er kontrollert med ekte påmelding til et tomt testspeil og
  påmelding fra en annen nettleser. Ingen JavaScript-feil.
- Produksjonskontroll gjennom offentlig URL bekrefter riktig versjon,
  helsesjekk 200, den nye påmeldingsruten og gult varsel i mobilnettleser.
  Påmeldingskontrollen i produksjon opprettet ingen tur eller observasjon.
- Databasen besto `PRAGMA quick_check`. Ingen observasjoner fra backupen
  manglet etter deploy, og Feltlogg-oppsettet var identisk med backupen.

Før deploy ble det tatt konsistent SQLite-backup og kopi av peer-oppsettet
i en beskyttet katalog under `/data/backups/before-fellestur-v1.58.3-<tid>`.
Forrige Docker-image ble bevart med tilsvarende `before-fellestur-v1.58.3`-tag.

## Kodeformat

Fellestur-koder er **5 sifre** (endret fra 6-tegns alfanumerisk i v1.51.0),
for å matche Feltloggs kontrakt uten oversettelse. Se
`_KODE_LENGTH`/`_KODE_ALPHABET` i `src/fellestur_store.py`.

## Oppdage og bli med på eksterne turer (v1.58.3)

Brukeren skriver alltid inn en kode. Vi har ingen rute eller brukerflate
som lister aktive turer, og spør ikke Feltlogg om en slik oversikt.

- `GET /api/fellestur?kode=…` slår opp én kode lokalt. Autentiserte,
  validerte peer-hendelser gjør nå også tidligere ukjente koder kjent hos oss
  og lagrer funnene. Ingen tilbakesending av innkommende hendelser.
- Turen har `opprinnelse` (`enkel-ao` eller `ekstern`) og `eksternBekreftet`.
  Lokal opprettelse, påmelding og registrering bekrefter aldri ekstern eksistens.
  Bekreftelse krever en ny, validert hendelse fra en autentisert peer.
- Påmeldingen viser om turen ble funnet lokalt eller er kjent fra eksterne
  hendelser. Dette er kunnskap om mottatte hendelser, ingen sanntidskontroll
  av om turen fortsatt finnes hos Feltlogg.
- Ukjent kode gir gult varsel: Turen kan finnes i Feltlogg uten funn, eller
  koden kan være feil, utløpt eller ubrukt. Brukeren må kontrollere koden selv.
  «Bli med likevel» sender `POST /api/fellestur-bli-med` med
  `{kode, godtaUbekreftet: true}` og oppretter et ubekreftet lokalt speil.
  Uten eksplisitt bekreftelse svarer dette endepunktet 409 for ukjente koder.
- Nye deltakere får fortsatt varselet selv om andre har koblet seg på samme
  ubekreftede kode. Det vedvarende varselet forsvinner ved neste oppdatering
  etter at en ekstern hendelse er mottatt.
- Nettverksfeil og serverfeil gir en egen feilmelding, aldri tilbud om å
  opprette et ubekreftet speil på grunnlag av en mislykket sjekk.

Speilet lever i 48 timer fra lokal opprettelse. Påmelding og oppdagelse
forlenger ikke turen og nullstiller ikke eksisterende navn, medobservatører
eller lokale funn. Vanlige oppdateringshendelser endrer fortsatt observasjonen
med samme ID. Migreringen bevarer tidligere ekstern bekreftelse fra
`fellestur_peer_seen`, men bare når hendelsen er mottatt etter gjeldende turs
opprettelse. Aktivitet fra en eldre tur med gjenbrukt PIN bekrefter ikke den nye.
Duplikatbeskyttelsen for hendelser gjelder i sju døgn;
duplikater innen dette vinduet gjenoppretter ikke en utløpt tur.
Tidligere avviste hendelser og eldre turhistorikk hentes ikke automatisk inn.

## Hvordan legge til en provider

1. Utveksle info utenom koden (Slack/epost/tekstmelding, IKKE commit):
   - Din egen secret: `docker exec enkel-ao-enkel-ao-1 cat /data/fellestur_peer_secret.txt`
     på Pi (genereres automatisk ved første auth-forsøk hvis den ikke finnes —
     trigger den manuelt med en dummy `Authorization: Bearer x`-forespørsel
     mot `/api/fellestur-peer/12345/events` hvis filen ikke finnes ennå).
   - Deres navn, base-URL og inbound-secret.
2. Skriv `/data/fellestur_peer_providers.json` på Pi (docker-volum, ikke i repoet):
   ```json
   [
     { "name": "feltlogg", "url": "https://feltlogg.no/fl/api/group-session", "secret": "<deres secret>" }
   ]
   ```
3. Ingen restart nødvendig — filen leses på hver forwarding (`load_providers()`
   cacher ingenting).

Manglende fil = ingen providere konfigurert = funksjonen er et rent no-op.
Alle andre deler av Fellestur virker uendret uansett.

## Automatisk forwarding (bevisst valg)

**Alle** fellesturer forwardes automatisk til konfigurerte providere i v1 —
ingen opt-in-bryter. Bevisst besluttet av produkteier: Feltlogg-utvikleren er
en betrodd venn, og innhold i en fellestur har uansett ingen
"skjul denne hekkeplassen"-mekanisme (`hideUntil` er aldri med i
`sanitize_observasjon()`) — alt er allerede skrevet med sikte på offentlig
AO-publisering.

Avgjørelsen sitter i **én** funksjon, `skal_forwardes(tur)` i
`src/fellestur_peer.py` (v1: alltid `True`). Skal dette bli betinget senere
(f.eks. et eksplisitt "del med tilkoblede apper"-valg), er det den eneste
funksjonen som trenger å endres.

## Kontrakt-sammendrag

- Endepunkt: `POST /api/fellestur-peer/<kode>/events`
- Auth: `Authorization: Bearer <mottakers secret>`, sammenlignet med
  `hmac.compare_digest`
- Batch: 1–50 events, hver med `id` (idempotensnøkkel), `type`
  (`add`/`update`/`count`/`delete`), `origin`, `sighting`
- Svar: `200 {accepted: [id...], seq}` — duplikate id-er telles ikke med i
  `accepted`, men er ikke en feil. `400` ved ugyldig batch (hele batchen
  forkastes), `401` ved feil token, `413`
  ved for mange events.
- `count`-events fra en peer anvendes som delta: `count = max(1, lokal + delta)`.
- Utgående fra Enkel AO er alltid `add`/`update`/`delete` — vi genererer
  aldri en ekte `count`-delta selv (se Kjente begrensninger).

Full normativ kontrakt (Appendix A, mottatt fra Feltlogg) er ikke lagret i
dette repoet — kun sammendraget over og det som faktisk er implementert i
`src/fellestur_peer.py`.

## Feilsøking av utgående sending

En konfigurert mottaker betyr at sending er aktivert; det beviser ikke at
Feltlogg har godtatt observasjonen. Kontroller både HTTP-status og at den
sendte hendelsens ID er med i mottakerens `accepted`-liste. HTTP 200 med en
tom `accepted`-liste kan være en allerede mottatt hendelse.

- `[fellestur-peer] … avviste batch (401)` betyr at Feltlogg avviser
  autentiseringen. Bruk Feltloggs **egen inbound-secret** i mottakerfilen,
  ikke Enkel-AOs nøkkel for mottak. Lim nøkkelen fra tekst fremfor å skrive
  den av fra et bilde. En manglende bokstav var årsaken til 401-feilen som
  ble rettet 2026-10-28. Selve nøkkelen skal aldri inn i dokumentasjon eller logg.
- 400, 401, 404 og 413 gir ingen nytt forsøk. En ekstern mottaker kan fortsatt
  svare 404 hvis den ikke kjenner koden, selv om Enkel-AO nå speiler ukjente
  koder ved innkommende hendelser.
- Nettverksfeil og øvrige feilstatuser forsøkes på nytt etter 2, 10 og
  60 sekunder, inntil fire forsøk totalt. Avviste batcher ligger ikke i en
  varig kø og ettersendes ikke automatisk når oppsettet rettes.
- Vellykkede utgående kall har ingen egen bekreftelseslogg i dagens kode.
  Ved manuell ettersending må mottakskvitteringen kontrolleres direkte.

Manuell ettersending skal bruke samme observasjons-ID, slik at det samme
funnet ikke får en ny identitet i partnerappen. Ikke videresend mottatte
peer-hendelser tilbake til avsenderen som nye lokale funn.

## Feilsøking av innkommende kall

Fra 2026-10-27 logges innkommende peer-kall på INFO-nivå med
`[FELLESTUR-PEER]`: turkode, klient-IP, HTTP-status, antall hendelser,
antall godkjente hendelser og avvisningsgrunn. Duplikater gir status 200,
men telles ikke som godkjente på nytt. Token og observasjonsinnhold logges ikke.

`[FELLESTUR-HTTP]` viser metode, sti uten query-parametere og HTTP-status
for fellestur-endepunktene, også ved feil sti eller metode. Loggen ligger
varig i `/data/logs/fugleobs.log` og vises også i Docker/Dozzle.

## Kjente begrensninger (akseptert for v1)

- **Count-race mellom apper.** Enkel AO sender alltid `update` (full
  erstatning) ved en antall-endring, aldri en ekte `count`-delta — laget
  vårt skiller ikke "antall-knapp" fra annen redigering. To brukere på hver
  sin app som øker akkurat samme oppføring i samme vindu kan i sjeldne
  tilfeller tape én telling. Vi *mottar* derimot delta-events korrekt fra en
  peer (se `_apply_count_delta`).
- **Kodekollisjon på tvers av servere** er en akseptert risiko arvet fra
  Feltloggs egen spec (D13) — to urelaterte grupper kan i teorien få samme
  5-sifrede kode på hver sin server.
- **Ingen strict Appendix-A-lengdevalidering.** `_validate_event()` i
  `fellestur_peer.py` sjekker bare det som ellers ville fått
  `apply_sync()` til å hoppe stille over en rad (manglende artsnavn/sted/
  dato/antall). Lengdebegrensninger på andre felt håndteres av den
  eksisterende `sanitize_observasjon()` (kapper stille i stedet for å
  avvise med 400).

## Se også

- [docs/ANALYSIS_FELLESTUR_FODERASJON.md](ANALYSIS_FELLESTUR_FODERASJON.md) — full analyse og designvalg
- `src/fellestur_peer.py` — implementasjon
- `tests/test_fellestur_peer.py` — testdekning
- `CLAUDE.md` — endepunkter, env-variabler, backend-modul-oversikt
