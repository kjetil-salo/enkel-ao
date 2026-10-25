# AO: lese egne publiserte funn, og legge bilde på dem

**Bekreftet 25.10.2026** mot ekte innlogget AO-konto (kun lesekall, ingen skriving).
Fangsten ble gjort direkte i nettleseren, ikke via HAR-eksport.

Dette dokumentet erstatter to antakelser som viste seg å være feil:

- `rediger-sendte-obs-plan.md` konkluderte med at **dyplenking til ett funn er umulig**,
  fordi redigering åpnes med `POST /ReviewSighting/EditPublishedSightings`. Både funnsiden
  (`/Sighting/<id>`) og redigering (`/Edit/<id>`) har sine egne GET-URL-er — se punkt 3 og 3b.
- `ao-bilder-api.md` konkluderte med at **bilder bare kan lastes opp mens funnet ligger i
  gjennomgangskøen, før publisering**. Opplastingsskjemaet rendres også på funnsiden til
  et publisert funn, og `/Media/EditableImagesForSightingId/` svarer for publiserte funn —
  se punkt 4.

---

## Kortversjon

```
GET  /ViewSighting/SearchSighting       → søkeskjemaet (143 felt + CSRF)
POST /ViewSighting/ViewSightingAsTable  → 302, URL-en har ?storedSearchCriterias=<ID>
                                           HTML-en har TotalPageCount=<N>
POST /ViewSighting/BindSightingsGrid    → ren JSON, én rad per funn
     ?TotalPageCount=<N>&StoredSearchCriterias=<ID>&size=50
     Body: page=1&size=50
```

Implementert i `src/ao_sightings.py`, eksponert som `POST /api/ao-my-sightings`.

## 1. Søkeskjemaet

`/ViewSighting/SearchSighting` inneholder ett skjema, `id="ViewSightingForm"`, med
**143 felt** inkludert `__RequestVerificationToken`. Strategien er å sende skjemaet
tilbake slik det kom, og kun overstyre søkekriteriene vi bryr oss om:

| Felt (prefiks `SearchViewModel.StoredSearchCriterias.SearchCriterias.`) | Vår verdi |
|---|---|
| `LastNumberOfDays` | antall dager bakover (default 14) |
| `MyReportedSightings` | `true` |
| `MyObservedSightings` | `false` |

Merk at `FromDate`/`ToDate` **ikke** finnes som skjemafelt i rå HTML — de lages av
AOs datovelger-widget i nettleseren. Å overstyre dem feilet derfor fail-closed-sjekken i
`_override` og ga tom liste for alle. De utelates nå; utelatt periode er det samme som tom.

**`MyReportedSightings` filtrerer serverside hos AO.** Det er viktigere enn det ser ut:
alternativet var å hente alt og filtrere på brukeralias selv, og da måtte vi først finne
ut hvilket alias som er «meg». Med `MyObservedSightings=true` (AOs standard) kommer det
også med funn **andre har rapportert** der du står som medobservatør — bekreftet i
fangsten, der rapportør `bert` dukket opp blant «mine» funn. Slike funn kan vi verken
redigere eller legge bilde på, så de skal ikke vises som om vi kan det.

**Kritisk detalj:** skjemaet må postes med cookies satt på **klienten**, ikke på hver
enkelt request. Søket svarer med en 302, og httpx bygger `Cookie`-headeren på nytt fra
klientens egen jar ved redirect — cookies som bare lå på requesten forsvinner. Resultatet
blir en uinnlogget resultatside uten `TotalPageCount`, og dermed en permanent tom liste.
Samme felle er dokumentert i `ao_import_httpx.fetch_csrf_tokens`.

### Hvorfor et 143-felts round-trip er greit her, men ikke ved redigering

`ao-rediger-api.md` avviste round-trip-strategien for redigeringsskjemaet (149 felt),
fordi et felt vi reproduserer feil blir **tomt i den nasjonale artsdatabasen**. Her er
konsekvensen av samme feil et dårlig søk. Forskjellen er lesing mot skriving, ikke
antall felt.

Overstyringen er likevel **fail-closed** (`_override` kaster hvis et felt mangler):
endrer AO navnet på `MyReportedSightings`, ville en stille ignorert parameter fått søket
til å falle tilbake til skjemaets egne standardvalg — og vi hadde vist funn andre har
rapportert, uten en eneste feilmelding.

## 2. Grid-endepunktet

```
POST /ViewSighting/BindSightingsGrid?TotalPageCount=13&StoredSearchCriterias=17088787&size=50
X-Requested-With: XMLHttpRequest
Body: page=1&size=50
```

**`TotalPageCount` er påkrevd** — uten den svarer endepunktet HTTP 500. Verdien leses ut
av resultatsidens HTML. `size` i bodyen er den som styrer antall rader; `total` i svaret
er AOs eget treffantall, og brukes til å si fra når lista er avkortet.

Rundt 70 felt per rad. De vi bruker:

| Felt | Eksempel | Merknad |
|---|---|---|
| `SightingId` | `42022329` | Permanent ID. Nøkkelen til alt annet |
| `TaxonId` / `TaxonName` | `4173` / `<span data-taxonid='4173'>spettmeis</span>` | Navnet er pakket i markup |
| `ScientificTaxonName` | `<i>Sitta europaea</i>` | |
| `Quantity` / `ActivityName` | `1` / `Næringssøkende` | |
| `UniversalDate` | `2026-10-24` | Ren ISO-dato — bruk denne, ikke `StartDate` |
| `FormattedTime` | `kl. 12:54-12:56` | Prefikset «kl. » strippes |
| `SiteName` / `SiteId` | `Hatten` / `1523333` | |
| `MediaLinkHtml` | `<a href='/Sighting/42022329#SightingDetailImages'>…` | **Tom når funnet ikke har media** |
| `ValidationStatusLabel` | `Ikke validert (funnet er ikke kvalitetssikret)` | |
| `TriggeredValidationRulesText` | `` | AOs egen innvending mot funnet |

### `hasImage` utledes av ankeret, ikke av om feltet er tomt

`MediaLinkHtml` dekker også **lydopptak**, og AO kan tenkes å rendre et tomt
wrapper-element. Derfor sjekkes innholdet mot `SightingDetailImages` i stedet for ren
truthiness. Endrer AO markupen, feiler dette mot «ingen bilde» — da dukker «Legg til
bilde» opp på et funn som allerede har ett, og brukeren ser det med en gang. Motsatt vei
ville knappen stille forsvunnet, og funksjonen vært ubrukelig uten at noen skjønte hvorfor.

## 3. Dyplenke til ett funn ⭐

```
GET https://www.artsobservasjoner.no/Sighting/<SightingId>     → 200, «Funninformasjon»
GET https://www.artsobservasjoner.no/Sighting/<SightingId>#SightingDetailImages
```

Bekreftet med `/Sighting/41252560` (tårnseileren fra `ao-rediger-api.md`). Testede
varianter som **ikke** finnes: `/ViewSighting/Sighting/<id>`, `/Sighting/Details/<id>`,
`/ViewSighting/SightingDetails/<id>` — alle 404.

Dette gjør at «Tidligere sendt» kan lenke rett til funnet i stedet for til Mine sider.
Redigering har sin egen GET-URL, men den har en bieffekt man må kjenne til — se 3b.

## 3b. Redigering: `/Edit/<id>` finnes, men er en felle å dyplenke blindt

Funnsiden har knappen «Endre», som peker på **`GET /Edit/<SightingId>`** og redirigerer til
`/ReviewSighting/EditPublishedSightings?sightingIds=<id>`. Også dette motbeviser
`ao-rediger-api.md`, som sa at redigering kun åpnes med POST.

**Men: å åpne skjemaet gjør funnet upublisert.** AO sier det selv på siden:

> «Når du endrer ett eller flere funn som er publisert så endres de til å være upubliserte.
> Dette skjer så snart du kommer til denne siden. Selv om du ikke endrer noe så må du
> publisere funnet igjen for at det skal være synlig for andre.»

Verifisert 25.10.2026 på testfunnet 42030658: etter å ha åpnet `/Edit/<id>` svarte
`NumberOfSightingsSubmitted` `{"Count":1}`, og funnet lå i gjennomgangskøen. «Avbryt»
publiserer det **ikke** tilbake — det måtte publiseres manuelt på nytt.

To konsekvenser:

1. En «Endre»-lenke i appen MÅ si fra om dette. Gjør den ikke det, kan brukeren åpne
   skjemaet, ombestemme seg, og sitte igjen med et usynlig funn uten å vite det.
2. Et slikt etterlatt funn blir plukket opp av `PublishAll` ved neste sending fra appen —
   samme mekanisme som `docs/ao-publish-selective-capture.md` beskriver.

### Hvorfor vi IKKE kan endre antall fra appen

Redigeringsskjemaet poster **149 felt** til `/ReviewSighting/Save`. Målt på samme funn:

| Kilde | Antall feltnavn |
|---|---|
| Nettleserens `FormData` (etter at AOs JS har kjørt) | **149** |
| `name="..."` i rå HTML fra en GET | **6** |

Skjemaet bygges altså nesten i sin helhet av JavaScript. En serverside-parser som vår
`_FormParser` ville sett 6 felt og postet 6 felt — og de resterende 143 ville blitt tomme
på et publisert funn i den nasjonale artsdatabasen.

Dette er ikke en teoretisk bekymring: nøyaktig den feilklassen traff oss allerede på
søkeskjemaet, der `FromDate`/`ToDate` fantes i nettleserens `FormData` men ikke i rå HTML.
Der var konsekvensen et dårlig søk. Her ville den vært ødelagte data hos andre.

**Konklusjon:** fase C (redigering i appen) krever en ekte nettlesermotor, ikke
HTML-parsing. Vurderingen i `rediger-sendte-obs-plan.md` står — og er nå underbygget med
tall i stedet for antakelser. Appen lenker i stedet til `/Edit/<id>` med en tydelig advarsel
om at funnet må publiseres på nytt.

## 4. Bilder på et PUBLISERT funn

Funnsiden til et publisert funn inneholder AOs eget opplastingsskjema:

```html
<form action="/Media/UploadImageAction" id="uploadForm" method="post">
  <input name="__RequestVerificationToken" type="hidden" value="…" />
  <input type="hidden" id="MediaFilePerSightingRestriction" value="10"/>
  <input type="hidden" class="newimage-sightingid" name="UploadImageViewModel.Sighting.Id"/>
  <input type="file" name="UploadImageViewModel.Image" class="fileupload"/>
</form>
```

Og bildelista svarer for publiserte funn man eier:

```
POST /Media/EditableImagesForSightingId/   Body: {"sightingId": 42022329}
→ [{"id":3687666,"sightingid":42022329,"fileurl":"/MediaLibrary/2026/10/….jpg",
    "thumbnail":"…_thumbnail.jpg","comment":"","imageposition":0}]
```

Tomt funn gir `[]`, ikke feil. Det gir oss to ting:

1. **Vakt mot AOs grense** på 10 bilder per funn (`MediaFilePerSightingRestriction`).
2. **Ærlig kvittering.** Opplastingsresponsen er ikke til å stole på alene — AOs eget UI
   bruker en iframe-postback, og svaret kommer av og til som HTML (`ao-bilder-api.md`).
   Derfor telles bildelista før og etter: uendret antall betyr at AO ikke tok imot.
   Samme tanke som `_remaining_after_publish` ved publisering.

CSRF-tokenet hentes fra `/Sighting/<id>`, **ikke** fra `/ReviewSighting`. Gjennomgangskøen
kan være helt tom for en bruker uten ventende funn, og da finnes ikke skjemaet der.

Implementert som `upload_photo_to_published_sighting()` i `src/ao_import_httpx.py`,
eksponert som `POST /api/ao-upload-image`.

## 5. Hva dette løser

| Behov | Løsning |
|---|---|
| Unik AO-ID per sendt obs | Leses fra AO. Ingen markør i privat kommentar nødvendig |
| Berike med bilder hjemmefra | Opplasting mot `SightingId` på et publisert funn |
| Se feil i etterkant | `ValidationStatusLabel` + `TriggeredValidationRulesText` |
| Synk mellom enheter | Trengs ikke — AO *er* det delte lageret. Begge enheter er innlogget der |

Den siste er verdt å dvele ved: en egen synk-server for sendt-loggen var planlagt
(`server-lagring-innstillinger-plan.md`-mønsteret), og ble unødvendig. Lista bor hos AO,
dekker også funn registrert utenom appen, og overlever bytte av telefon.

## 6. Vedlikeholdsrisiko

Samme som resten av AO-integrasjonen: dette er reverse-engineerte ASP.NET MVC-skjemaer,
og AO bumper `ReleaseNumber` jevnlig. Det som vil knekke først, i synkende sannsynlighet:

1. Feltnavn i søkeskjemaet (fanges av fail-closed `_override` → tom liste, logget)
2. `TotalPageCount` forsvinner fra resultatsiden (fanges → tom liste, logget)
3. Markupen i `MediaLinkHtml` (feiler mot «ingen bilde», som er den synlige retningen)
4. Feltnavn i grid-raden (gir tomme verdier, ikke krasj — normaliseringen er en hviteliste)

Alle fire degraderer til noe synlig eller harmløst. Ingen av dem kan skrive feil data
til AO.
