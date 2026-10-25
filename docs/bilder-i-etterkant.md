# Bilder i etterkant, og «Tidligere sendt» som AO-speil

**Bygget 25.10.2026, v1.54.0–v1.54.4.** Samledokument. De tekniske detaljene om
AOs endepunkter ligger i `docs/ao-mine-funn-api.md`; dette dokumentet forklarer
hvorfor løsningen ser ut som den gjør, hva som er verifisert mot ekte AO, og hva
som ble gjort feil underveis.

---

## 1. Hva som ble bedt om

Fire ønsker, formulert av produkteier:

1. Har hver sendte observasjon fått med seg en unik AO-ID?
2. Kunne berike med bilder etter at funnet er sendt — registrere med mobilen i
   felt, legge på kamerabildene hjemme.
3. Se feil i etterkant.
4. Synkronisere observasjoner mellom enheter.

Alle fire er løst, men tre av dem på en annen måte enn planlagt.

## 2. Hovedfunnet: AO kan lese våre egne funn som JSON

Utgangspunktet var at appen måtte holde rede på dette selv — fange `SightingId`
ved sending, lagre det lokalt, og bygge et synk-lag for å få det mellom enheter.
`docs/server-lagring-innstillinger-plan.md` hadde mønsteret klart.

Det viste seg unødvendig. AO eksponerer brukerens egne publiserte funn som rent
JSON (`/ViewSighting/BindSightingsGrid`), med `SightingId`, art, antall, tid,
lokalitet, om funnet har bilde, og AOs egne merknader.

Konsekvensen for hvert av de fire ønskene:

| Ønske | Løsning |
|---|---|
| AO-ID per obs | Leses fra AO. Ingen markør i privat kommentar, ingen lokal bokføring |
| Bilder i etterkant | Opplasting mot `SightingId` på et publisert funn |
| Se feil | `ValidationStatusLabel` + `TriggeredValidationRulesText` per funn |
| Synk mellom enheter | **Trengs ikke.** AO *er* det delte lageret |

Den siste er verdt å dvele ved: en egen synk-server var planlagt og ble
overflødig. Lista dekker også funn registrert utenom appen, og overlever bytte
av telefon.

## 3. To antakelser i eksisterende dokumentasjon som var feil

Begge er rettet der de sto, men er verdt å gjenta samlet:

**«Dyplenking til ett funn er umulig»** (`rediger-sendte-obs-plan.md`). Det
stemmer at redigering åpnes med POST, men funnsiden har sin egen GET-URL:
`/Sighting/<SightingId>`. Også redigering har en: `/Edit/<SightingId>`.

**«Bilder kan bare lastes opp mens funnet ligger i gjennomgangskøen»**
(`ao-bilder-api.md`). Opplastingsskjemaet rendres også på funnsiden til et
publisert funn, og opplasting mot et publisert `SightingId` er verifisert.

## 4. Arkitektur

```
sendt.html
  ├─ «Mine funn på Artsobservasjoner»  → POST /api/ao-my-sightings
  │                                        └─ src/ao_sightings.py
  ├─ «Legg til bilde» → modal
  │     ├─ photo-picker.js   (fil / utklippstavle / dra-og-slipp)
  │     ├─ bilde-editor.js   (beskjæring + eksponering)
  │     └─ POST /api/ao-upload-image
  │            └─ ao_import_httpx.upload_photo_to_published_sighting()
  └─ «Sendt fra denne enheten»  → sent_observations_v1 (localStorage, uendret)
```

### Hvorfor den lokale sendt-loggen beholdes

AO-lista er primær når man er innlogget, men den krever nett og innlogging. Den
lokale kvitteringen virker offline, og den eier «Del disse» og «Kopier til
lista». To kilder er her riktigere enn én.

### Hvorfor bilderedigering ble egen modul

`bilde-editor.js` er bevisst smal: beskjæring og eksponering, ingenting annet.
Det er de to grepene som trengs mellom kamera og AO. Tre valg verdt å kjenne:

- **Beskjæringsrammen tegnes på samme lerret som bildet**, ikke som DOM-elementer
  over. Da oppfører mus og finger seg likt, uten to sett hendelser å holde i synk.
- **Eksponering er fotografisk** (`2^(trinn/100)`), ikke lineær. Forhåndsvisningen
  bruker samme pikselløkke som eksporten, ikke et CSS-filter — ellers ville
  forhåndsvisningen kunne lyve om resultatet.
- **Eksporten regnes alltid fra originalen**, aldri fra visningslerretet.

## 5. Hvem kan gjøre hva

Verifisert mot et funn rapportert av en annen bruker, med vår bruker som
observatør:

| | |
|---|---|
| Legge til bilde | **ja** — opplastingsskjemaet rendres, bildelista svarer |
| Endre funnet | **nei** — AO skjuler selv «Endre»-lenka |

Appen speiler regelen: kameraknapp på alt brukeren er med på, «Endre» kun der
`isReporter` er sann. Hvem som rapporterte vises når det ikke var brukeren selv.

## 6. Det som ikke er bygget: endre antall i appen

Etterspurt, og bevisst ikke gjort. Måling fra ren tilstand:

| | Felt |
|---|---|
| Nettleserens `FormData` på redigeringsskjemaet | 149 |
| `SightingViewModel.*` i rå HTML | 113 |

De 36 som mangler er nettopp de redigerbare verdiene — `Quantity`, `StartDate`,
`Activity` finnes ikke i HTML-en, bare deres skjulte `IsEditable`-partnere. En
serverside-parse ville postet et skjema uten startdato og aktivitet, og ASP.NET
binder det som tomt. Funnet ville mistet tid og aktivitet i den nasjonale
artsdatabasen, uten feilmelding.

Full måling, rekkefølgen for å gjøre det trygt, og den kortere delete-og-send-på-nytt-
veien: `docs/ao-mine-funn-api.md` punkt 3b.

I mellomtiden lenker appen til `/Edit/<id>` med en advarsel om at AO gjør funnet
upublisert i det man åpner det.

## 7. Feilhåndtering som er bygget inn med vilje

Hver av disse kommer av noe som faktisk gikk galt:

- **Cookies settes på httpx-klienten, ikke per request.** Søket svarer 302, og
  httpx bygger Cookie-headeren på nytt fra klientens jar ved redirect.
  Per-request-cookies ga en uinnlogget resultatside og en permanent tom liste.
- **Utløpt sesjon gjenkjennes i to former:** 200 med den anonyme søkesiden, og
  302 til innloggingssiden. Begge gir `needsLogin`, og `sendt.html` fornyer
  sesjonen selv og prøver på nytt.
- **Bildelista telles før og etter opplasting.** Kan vi ikke telle før,
  rapporteres resultatet som ubekreftet i stedet for å gjette.
- **Ett nytt opplastingsforsøk ved feil**, og AOs egen feiltekst logges. AO har
  svart HTTP 500 på et bilde mot et funn som tok imot et annet seks minutter før.
- **`_override` er fail-closed** på feltene som styrer hvem funnene tilhører.
- **`hasImage` feiler mot «ingen bilde»**, som er den synlige retningen.

## 8. Hva som gikk galt underveis

Alle feilene hadde samme form: **antakelser om AO skrevet ned som fakta.**

1. Cookies per request — advarselen sto allerede tre linjer unna i
   `ao_import_httpx.py`. Fanget av code-review.
2. `FromDate`/`ToDate` overstyrt, men de finnes ikke i AOs rå HTML — de lages av
   datovelgeren i nettleseren. Fanget da produkteier kjørte testen.
3. Redigeringsskjemaet målt til «6 felt» — målingen var tatt mot en allerede
   åpen redigeringsøkt. Riktig tall er 113 av 149.
4. Medobservasjoner filtrert bort på en utestet antakelse om at de ikke kunne få
   bilder. Kostet 83 av 100 funn i lista. Fanget av produkteiers erfaring.
5. «Sesjonen er utløpt»-meldingen pekte til «Test innlogging» i Innstillinger,
   som ikke lagret tokenene. Brukeren satt i en løkke, og kom ut ved å gå innom
   kartet — som logger inn som bieffekt.

**Testene fanget ingen av dem.** Suiten var grønn gjennom hver eneste en, fordi
den mocker nøyaktig det som var feil. En test som mocker AO verifiserer vår
forståelse av AO, ikke AO.

Det som fanget dem: code-review, produkteier som kjørte testen, produkteiers
domenekunnskap, og staging. Lærdommen for neste gang man rører AO-integrasjonen:
**verifiser mot ekte AO før konklusjonen skrives ned**, og mål alltid fra ren
tilstand.

## 9. Testdekning

- `tests/test_ao_sightings.py` — skjema-parsing, normalisering, paginering,
  degradering, utløpt sesjon i begge former, medobservasjon vs. egen rapport
- `tests/test_ao_photo_upload.py` — opplasting, verifisering mot bildelista,
  AOs bildegrense, retry ved 500
- `tests/unit/bilde-editor.test.js` — eksponeringsmatematikk, klemming av
  utsnitt, pikseloverløp

Manuelt verifisert mot ekte AO: henting av 100 funn, opplasting til eget og til
medobservert funn, flere bilder på samme funn, beskjæring og eksponering, og
automatisk fornyelse fra bevisst ødelagte tokens.
