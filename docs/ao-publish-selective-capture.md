# Capture: selektiv publisering mot AO

**Status: implementert v1.53.32** (13.10.2026). Kartleggingen under er utført 04.10.2026 og
beholdt som den var; implementasjonen ligger i `publish_all(..., temp_sighting_ids=...)` og
`post_with_curl` i `src/ao_import_httpx.py`, med testdekning i `tests/test_ao_import.py`.
Avvik mellom «Implementasjonsskisse» under og det som faktisk ble bygget: skissen foreslo å
sende både `SelectedTempSightingsToPublishIds` og søsterfeltet `SelectedTempSightings` —
begge viste seg å være feil feltnavn (AO svarte HTTP 500). Det eneste ID-feltet i
`#PublishForm` er `SightingsToPublishIds`, og det er det implementasjonen bruker. Se
korreksjonsboksen lenger ned.

**Mål:** Bekrefte det eksakte feltformatet AO bruker når brukeren publiserer et UTVALG av
funn i gjennomgangskøen («Publisere valgt»), i motsetning til «Publiser alle funn» (som
dagens `publish_all()` i `ao_import_httpx.py` bruker). Bakgrunn: brukerhenvendelse fra
Espen (02.10.2026) — EAO publiserer alt i AOs gjennomgangskø, ikke bare det som ble sendt
fra appen. Se `docs/rediger-sendte-obs-plan.md` for tidligere (ufullførte) vurdering av
samme rotårsak.

**Metode:** Utført direkte av Claude via nettleseren (claude-in-chrome), på ekte, innlogget
AO-sesjon — ingen HAR-eksport av bruker nødvendig denne gangen. To ekte, trygge
observasjoner (vanlige hagefugler på Hylkjesvingen 49, brukerens egen adresse) ble lagt inn
direkte på AO sin egen rapporteringsside, publisert selektivt via «Publisere valgt», og
AOs inline JavaScript ble lest rett fra siden (`document.scripts`) for å finne nøyaktig
hvilke skjemafelt knappen faktisk setter før innsending.

## Testdata (04.10.2026, Hylkjesvingen 49)

1. Skjære + Gråspurv lagt inn direkte på artsobservasjoner.no (simulerer «noe i køen fra
   før, ikke fra appen» + «det som skal publiseres»)
2. I gjennomgangskøen: kun gråspurv-raden avkrysset, «Publisere valgt (1)» klikket
3. Resultat: **«1 Funn publisert»** — skjære ble liggende urørt i køen. Bekrefter at AO
   støtter ekte selektiv publisering via UI-et.
4. Gjentatt med en tredje observasjon (svarttrost) alene i køen, for å fange det reelle
   skjemafeltet via instrumentering av siden (se under).

Alle tre observasjonene er nå korrekt publisert på Kjetils egen, ekte AO-konto.

## Hovedfunn: feil endepunkt OG feil feltnavn i dagens kode

Dagens `publish_all()` poster til `/PublishSighting/PublishAll` med
`ReviewSightingViewModel.SightingsToPublishIds=` (tom = alt). Det stemmer for
«Publiser alle funn»-knappen. Men **«Publisere valgt» bruker et helt annet endepunkt og
helt andre feltnavn** — bekreftet ved å lese AOs egen inline JS (`ReviewSighting`-sidens
`<script>`-innhold) direkte:

```js
function setSelectedSightingsId() {
    var _selectedSightings = [];
    $("#selectedSightingsForm").find(":checkbox[name='checkedRecords']:checked").each(function() {
        _selectedSightings.push($(this).val());
    });
    $("#ReviewSightingViewModel_SelectedTempSightings").val(_selectedSightings);
    $("#ReviewSightingViewModel_SelectedTempSightingsToPublishIds").val(_selectedSightings);
    return _selectedSightings.length;
}
// ... ved klikk på "Publisere valgt":
$("#PublishForm").attr("action", "" + "/PublishSighting/Publish");
$("#PublishForm").submit();
```

| | «Publiser alle funn» | «Publisere valgt» |
|---|---|---|
| Endepunkt | `POST /PublishSighting/PublishAll` | `POST /PublishSighting/Publish` |
| Feltnavn | `ReviewSightingViewModel.SightingsToPublishIds` (tom) | **samme felt**, utfylt |
| Verdityper i feltet | — | `TemporarySightingId`, **ikke** permanent `SightingId` |
| Format | — | Kommaseparert streng (jQuery `.val(array)` på et hidden-felt → `Array.prototype.toString()`, altså `"30655382,30655383"`, ikke gjentatte feltnavn) |

**Bodyen er altså identisk i begge tilfeller** — kun ID-feltets innhold og URL-en skiller.
`#PublishForm` har nøyaktig fire felt, lest direkte fra DOM-en på gjennomgangssiden:

```
__RequestVerificationToken
ReviewSightingViewModel.PublicationName
ReviewSightingViewModel.PublicationComment
ReviewSightingViewModel.SightingsToPublishIds
```

> ⚠️ **Korrigert 04.10.2026.** Første gjennomgang av AOs inline-JS leste feltnavnet som
> `SelectedTempSightingsToPublishIds`, og la i tillegg til et ikke-eksisterende
> `SelectedTempSightings`-felt. Begge deler er feil — AO svarte **HTTP 500** på den
> bodyen i staging-test mot ekte AO. Lærdommen: les skjemaets faktiske `name`-attributter
> fra DOM-en (`#PublishForm`), ikke avkodet JavaScript. `checkedRecords`-verdiene er
> bekreftet å være `TemporarySightingId` ved å sammenligne mot `BindReviewSightingsGrid`.

**Konsekvens for F2 (scoped publish):** `_find_row_for_marker()`/matching-logikken må
hente `TemporarySightingId` fra `review_queue_rows()` (feltet finnes allerede der, se
`docs/ao-rediger-api.md`) — ikke `SightingId` som brukes andre steder (bildeopplasting,
held-back-verifisering). To forskjellige ID-typer for to forskjellige formål:

- `SightingId` → permanent, brukt til bildeopplasting og til å identifisere PUBLISERTE
  funn i etterkant (held-back-sjekk leser dette feltet FØR publisering for å vite hva som
  fortsatt er i køen)
- `TemporarySightingId` → midlertidig, brukes KUN i selve publish-kallet for å si «publiser
  nøyaktig disse radene»

## Implementasjonsskisse for `publish_all(login_token, auth_cookie, temp_sighting_ids=None)`

- `temp_sighting_ids=None` → uendret oppførsel: `POST /PublishSighting/PublishAll` med tom
  `SightingsToPublishIds` (publiser alt — dagens standardvei, ingen endring for de fleste)
- `temp_sighting_ids=[...]` (ikke-tom liste) → `POST /PublishSighting/Publish` med
  `ReviewSightingViewModel.SelectedTempSightingsToPublishIds=<kommaseparert liste>` (og
  trolig også søsterfeltet `SelectedTempSightings` — begge settes identisk av AOs egen UI,
  tryggest å reprodusere begge siden vi ikke vet hvilket som faktisk leses server-side)
- CSRF-token og cookies: samme mønster som i dag (ingen endring observert der)

## Fallgruver håndtert i implementasjonen

Fire ting som ikke er åpenbare, og som alle ville gitt stille feil i felt:

1. **Fail-safe-retningen når kø-sjekken ikke svarer.** `number_of_sightings_submitted()`
   returnerer `None` ved nettverksfeil. Å tolke det som «tom kø» ville falt tilbake til
   `PublishAll` — altså nøyaktig buggen. Derfor: kun en BEKREFTET `0` slår av scoped
   publisering; `None` ⇒ scoped.
2. **Ferdig-gaten kan ikke være et absolutt tall i scoped modus.** Når køen ikke var tom
   (eller størrelsen er ukjent), finnes det ingen riktig terskel for
   «NumberOfSightingsSubmitted». Gaten sjekker i stedet at hver enkelt markør faktisk
   finnes igjen i køen — den eksakte betingelsen. Den tyngre grid-lesingen gjøres kun
   når den billige «importing»-telleren allerede melder ferdig.
3. **Et unntak fra `publish_all` betyr ikke at AO lot være å publisere.** Timer responsen
   ut på vei hjem, er radene likevel borte fra køen. Ved retry tolkes «radene er nå
   borte» derfor som vellykket publisering — ikke som feil. Alternativet var å melde
   «feilet» og få brukeren til å sende på nytt og duplisere funnet.
4. **Held-back-sjekken må telle VÅRE rader, ikke køen.** Ved scoped publisering kan
   fremmede funn ligge igjen i køen uten at vår publisering feilet.

## Ikke undersøkt / gjenstår

- ~~Om `SelectedTempSightingsToPublishIds` alene (uten søsterfeltet) er nok.~~ Avklart:
  ingen av de to feltnavnene finnes. `SightingsToPublishIds` er det eneste ID-feltet.
- Om formatet tåler mellomrom rundt komma, eller andre skilletegn — reprodusert eksakt som
  observert (ingen mellomrom).
- Om `TemporarySightingId` kan gjenbrukes på tvers av flere sekvensielle
  `review_queue_rows()`-kall, eller om den endrer seg hvis AO re-parser raden (f.eks. ved
  en avvist/rettet observasjon). Antas stabil innenfor én økt, ikke verifisert over tid.
  **Dempet i implementasjonen:** ID-ene slås opp på nytt før hvert retry-forsøk (ikke bare
  det første), så et nytt forsøk bruker aldri en ID fra 5–15 sekunder tilbake. Ikke det
  samme som verifisert — gjenstår å bekrefte i felt at scoped publisering faktisk treffer
  riktige rader over tid.

## Synlighet for brukeren (v1.53.33)

Scoped publisering er bevisst stille i selve mekanikken, men ikke overfor brukeren:

- **Før sending:** `POST /api/ao-queue-count` → `number_of_sightings_submitted()`. Er køen
  ikke tom, viser `oppdaterAoKoHint()` i `export-operations.js` en nøytral info-linje over
  «Publiser til AO» med antall og at de ikke blir berørt. `count: null` («kunne ikke spørre
  AO») viser ingenting og caches ikke — en forbigående feil skal ikke skjule et reelt
  kø-innhold i hele TTL-en (2 min).
- **Etter sending:** `notPublished` (vår fail-safe: fant ikke raden igjen) og `heldBack`
  (AO underkjente raden) vises i ÉN samlet gul boks med artsnavn og lenke til
  gjennomgangssiden. De kan opptre samtidig, og en tidligere variant viste bare den første.

## Gjenstår å verifisere i felt (etter deploy v1.53.32)

Scoped publisering er bekreftet mot ekte AO manuelt i nettleseren (tre observasjoner,
04.10.2026), men den korrigerte bodyen er så langt kun kjørt mot mocks i testene. Første
reelle gjennomkjøring bør gjøres bevisst: legg ett funn direkte på artsobservasjoner.no
uten å publisere det, send deretter ett funn fra appen, og bekreft at kun appens funn ble
publisert og at det andre fortsatt ligger i køen.
