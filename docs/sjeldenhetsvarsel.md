# Sjeldenhetsvarsel

AO sin egen sanntidsvurdering av art×lokalitet×dato, vist i skjemaet **før**
publisering — ikke bare etter, slik Dagens Funn sin raritet-badge gjør.

Innført i v1.52.0 (⚠️-boks i skjemaet), v1.52.1 (merke i observasjonslista).

## Hvorfor

Boksen er nyttig på flere måter, ikke bare én:

1. **Fanger feiltrykk.** Trykker man feil art i lista ved et uhell, ser man det
   med en gang hvis arten er uvanlig på stedet — før hele Norge rykker ut for
   ingenting.
2. **Varsler om et ekte sjeldent funn.** Man vet ikke alltid selv at det man så
   var uvanlig.
3. **Hjelper ved reise mellom landsdeler.** En art som er triviell hjemme kan
   være sjelden der man står nå — boksen sier ifra uavhengig av hva man selv
   tar for gitt.

## AOs API — verifisert live

Funnet ved nettverksinstrumentering mot AOs eget rapporteringsskjema
(`SubmitSighting/Report`), innlogget med ekte konto. To kall, begge krever
gyldig AO-sesjon:

**1. Hent Areas-ID-er for en lokalitet**

```
POST /SubmitSighting/GetSite
Body: {"SiteId": <int>}
```

Responsen inneholder `"Areas": "2,201,453,643,51765,84626,94125,94227,95044"`
— en kommaseparert streng med AOs interne område-ID-er (fylke, kommune,
regioner). Dette er samme kall AOs Report-side selv gjør når en lokalitet
velges.

**2. Sjeldenhetsvurdering for art × areas × dato**

```
POST /SubmitSighting/ValidateTaxonAndArea
Body: {
  "Taxon": "<taxonId>",
  "Areas": ["2", "201", ...],
  "fromDate": "<UTC-ISO av norsk lokal midnatt>",
  "toDate": "<samme>"
}
```

`fromDate`/`toDate` er ikke UTC-midnatt for datoen, men **norsk lokal
midnatt** konvertert til UTC — f.eks. `12.09.2026` sommertid ble observert
som `"2026-09-11T22:00:00.000Z"`. `_oslo_midnight_utc_iso()` i
`src/api_handlers.py` reproduserer dette med `zoneinfo.ZoneInfo('Europe/Oslo')`.
Docker-imaget (`python:3.12-slim`) mangler OS-tzdata, derfor `tzdata` i
`requirements.txt`.

Respons:

```json
{ "Warning": {"Header": "...", "Body": "..."} | null,
  "Information": {"Header": "...", "Body": "..."} | null }
```

**Warning** = alvorlig sjeldenhet (⚠️ i AOs egen visning). **Information** =
mildere merknad (sesong, screening, lavere kategori — ℹ️ hos AO). De kan
begge være satt, én av dem, eller ingen.

**v1-terskel (bevisst valg):** kun `Warning` vises i enkel-ao. `Information`
alene (f.eks. en sesongmerknad) holdes tilbake — for mye støy for lite
signal i v1.

## Backend (`/api/ao-rarity`)

`GET /api/ao-rarity?taxonId=X&siteId=Y&date=YYYY-MM-DD`, samme
auth-header-mønster som `/api/ao-sites` (`X-AO-Login-Token` mv., lest via
`_read_ao_auth_headers()` i `server.py`).

`get_ao_rarity()` i `src/api_handlers.py` orkestrerer:

1. Uinnlogget bruker (mangler `login_token` + (`auth_cookie` eller
   `user_id`)) → stille `(None, None)`, ikke noe AO-kall i det hele tatt.
2. `_ensure_auth()` (samme sliding-expiration/relogin-mønster som resten av
   AO-integrasjonen).
3. Areas: `location_db.get_cached_areas(site_id)` (30 dagers TTL) — cache
   bom → `fetch_site_areas()` mot AO, cachet med `set_areas()`.
   `set_areas()` oppdaterer kun en rad som **allerede finnes** i
   `locations`-tabellen; en helt ny AO-lokalitet (ikke importert fra før)
   hoppes stille over — å sette inn en rad med ukjent navn ville forurenset
   navnesøket i `search_by_name()`. Konsekvens: sjeldenhetsvarsel virker
   ikke på en lokalitet som verken finnes i lokal-DB-importen eller allerede
   er cachet — praktisk sett svært sjelden siden importen dekker ~487k
   norske lokaliteter.
4. `check_taxon_rarity()` mot AO. `fetch_site_areas()` godtar kun en
   non-empty **streng** som `Areas` — alt annet (AO skulle finne på å
   returnere en liste, `None`, tall) behandles som «ingen data» i stedet for
   å la det lekke inn i `.split(',')` og krasje.

Enhver feil (uinnlogget, AO nede, uventet respons) → tomt `{}`/200. **Aldri**
500 — jf. «External API Error Handling»-konvensjonen i `CLAUDE.md`.

## Frontend (`public/js/rarity.js`)

`checkRarity(state, dom)` kalles fra `updateSectionStates()` i
`form-state.js` — hooket som allerede kjører ved enhver art- eller
stedsendring, i begge modi (felt- og etterregistrering).

- **Dato:** dagens dato, eller besøkets fra-dato (`getVisitTimeSpan()`) ved
  etterregistrering (`state.etterregVisitKey` satt).
- **Memoisering:** en `lastKey` (`taxonId::siteId::dato`) hindrer re-sjekk
  når f.eks. bare «Antall» endres — unngår unødvendig fetch og flimring.
- **Debounce + race-sikkerhet:** 400ms debounce. Endres art/sted/dato før
  forrige fetch er ferdig, kanselleres den ventende timeren og en
  `requestSeq`-teller inkrementeres — et utdatert svar kan da aldri komme
  og vise en boks for en art/lokasjon brukeren har forlatt.
- **Uinnlogget:** sjekket helt til slutt i den debouncede callbacken (etter
  at `lastKey` er satt, slik at vi ikke prøver på nytt for samme
  art+sted+dato) — **ingen fetch i det hele tatt** hvis `ao_tokens` mangler
  `loginToken`.
- **Offline-artsliste:** `species_offline.js` sine resultater har aldri
  `taxonId` (kun `{taxonName, scientificName, source}`). Uten `taxonId`
  no-oper `checkRarity()` stille — samme fallback som uinnlogget. Varselet
  virker altså **kun** når artssøket går mot ekte Artsobservasjoner.

## Merke i observasjonslista

Boksen i skjemaet er transient — forsvinner så snart neste art velges.
`observation-commit.js` fanger derfor innholdet **på registreringstidspunktet**
inn i `obs.rarityWarning = {header, body}` (kun hvis boksen faktisk er
synlig — krever `header`-tekst ELLER `body`-tekst, siden AO ikke garanterer
at `Warning.Header` er populert).

`observations.js` viser et ⚠️-merke ved siden av arten i ③, med
header+body som verktøytips — samme mønster som 💬-kommentarmerket.

**Redigering:** `edit-modal.js` nullstiller `obs.rarityWarning` hvis
art, lokalitet eller dato endres via ✎-blyanten. Uten dette kunne et gammelt
AO-svar bli hengende på en korrigert art — feilaktig antydet at *den nye*
arten var uvanlig.

## Kjente begrensninger

- Krever nett og innlogget AO-konto (se «Offline-artsliste» over).
- Sjeldenhetsvurderingen er AOs egen — enkel-ao verifiserer den ikke, viser
  den bare frem.
- En helt ny, ikke-cachet AO-lokalitet (se areas-cache-punktet over) får
  ikke varsel første gang den brukes.
