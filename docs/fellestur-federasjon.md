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

## Status (2026-09-12)

- ✅ Implementert, testet (pytest + vitest) og deployet på Pi (prod).
- ✅ Enkel AO sin egen inbound-secret er generert.
- ⏳ Venter på at Feltlogg (Stein Rune) sender sin tilsvarende
  navn/URL/secret tilbake, og at vi legger dem inn som provider.
- ⏳ Ingen ekte kryss-app-test kjørt ennå — kun verifisert mot egen server.

## Kodeformat

Fellestur-koder er **5 sifre** (endret fra 6-tegns alfanumerisk i v1.51.0),
for å matche Feltloggs kontrakt uten oversettelse. Se
`_KODE_LENGTH`/`_KODE_ALPHABET` i `src/fellestur_store.py`.

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
  forkastes), `401` ved feil token, `404` ved ukjent/utløpt kode her, `413`
  ved for mange events.
- `count`-events fra en peer anvendes som delta: `count = max(1, lokal + delta)`.
- Utgående fra Enkel AO er alltid `add`/`update`/`delete` — vi genererer
  aldri en ekte `count`-delta selv (se Kjente begrensninger).

Full normativ kontrakt (Appendix A, mottatt fra Feltlogg) er ikke lagret i
dette repoet — kun sammendraget over og det som faktisk er implementert i
`src/fellestur_peer.py`.

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
