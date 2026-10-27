# AO-redigering: presis feltmåling fra ren tilstand

**Målt 26.10.2026** mot ekte innlogget konto, testfunn **42030658** (gråspurv, 3,
Stasjonær, Hylkje, 25.10.2026 15:52). Funnet ble åpnet for redigering tre ganger og
publisert tilbake hver gang med scoped `Publish`. Verifisert uendret etterpå
(gråspurv / 3 Individer / Stasjonær) og kø = 0.

**Ingenting ble lagret via `/ReviewSighting/Save`.** Målingen er ren lesing av
skjemaet; den eneste skriveeffekten er av/på-publisering av testfunnet.

> ## Dette dokumentet motbeviser `ao-mine-funn-api.md` punkt 3b
>
> 3b konkluderte: «Det er nøyaktig **de redigerbare verdiene** som bygges av
> JavaScript» — `Quantity`, `StartDate` og `Activity` skulle mangle i rå HTML, og
> gapet var oppgitt til 36 felt.
>
> **Det er feil.** `Quantity`, `StartDate`, `StartTime`, `EndDate`, `EndTime` og
> `Taxon` ligger alle i rå HTML med korrekt `value`. Gapet er ikke 36 vilkårlige
> felt, det følger **elementtypen**: `<input>` har verdiene sine, `<select>` har
> ingen `selected`-option.
>
> 3b-målingen oppgav 113 `SightingViewModel.*`-felt i et 319 KB-svar. Den riktige
> målingen gir **145** i et 312 KB-svar. 3b advarte selv mot å måle fra uren
> tilstand, men traff tilsynelatende en annen degradert variant.

---

## Kortversjon

| | |
|---|---|
| Rå HTML fra ren tilstand | **312 KB**, `#report` finnes |
| `[name]`-elementer i `#report` (rå HTML) | **203** (178 unike) |
| `SightingViewModel.*` i rå HTML | **145** |
| Nettleserens `FormData` på `#report` | **149 entries / 141 unike** |
| Felt med lesbar verdi i rå HTML | **134** |
| Felt uten lesbar verdi | **69** — hvorav 16 `<select>` og 53 genuint tomme |

**Konklusjonen snus: et round-trip er forsvarlig.** Det som må syntetiseres er
en kort, kjent liste — ikke 36 ukjente felt.

## Den eneste reelle mangelen: 6 nedtrekkslister

`<select>` rendres med alle sine options, men **uten** `selected`. En
serverside-parser ser derfor valglista, men ikke valget.

| Felt | Options | Sendt av nettleseren? | Verdi i fangsten |
|---|---|---|---|
| `S.Activity` | 104 | **ja** | `23` |
| `S.Stage` | 59 | **ja** | `0` (= ikke angitt) |
| `S.Gender` | 8 | **ja** | `0` (= ikke angitt) |
| `S.DeterminationMethod` | 4 | **ja** | tom |
| `S.Unit` | 22 | **nei** | — AO defaulter |
| `S.DiscoveryMethod` | 76 | **nei** | — AO defaulter |

De ti øvrige selectene uten `selected` hører til kart-/ny-lokalitet-/samlings-widgetene
(`V.NewSite.*`, `SiteViewModel.*`, `SpeciesCollection*`) og er irrelevante for et
vanlig funn.

**`Unit` og `DiscoveryMethod` sendes ikke i det hele tatt** av nettleseren. Det er
viktig: å «fylle inn» dem fordi de ser tomme ut, ville endre funnet.

### Aktivitet kan rekonstrueres eksakt — ikke gjettes

Options-lista ligger i samme HTML vi allerede parser, med både `value` og tekst:

```
0 → ""                     1 → "Reir med egg eller unger"
4 → "Rugende"             23 → "Stasjonær"
```

`BindSightingsGrid` gir `ActivityName` (`"Stasjonær"`). Oppslag i options-lista gir
`23` — verifisert identisk med det nettleseren sendte. **Ingen hardkodet tabell, ingen
gjetting, og den følger AO automatisk hvis de legger til aktiviteter.**

## De 53 andre uten verdi er genuint tomme

Fordelingen viser at dette ikke er datatap:

- `V.NewSite.*` (10) + `SiteViewModel.NewSite.*` (2) — felt for å opprette *ny*
  lokalitet. Skal være tomme på et eksisterende funn.
- `S.Substrate*`, `S.BiotopeNiN2*`, `S.MinDepth`/`MaxDepth`/`MinHeight`/`MaxHeight`,
  `S.Length`, `S.Weight`, `S.QuantityOfSubstrate` — ikke i bruk for fugleobs.
- `V.Search*_Name`, `V.ProjectToAdd*` — søkewidgetenes egne tekstfelt.
- `S.HiddenByProvider` — tom fordi funnet ikke er skjult.
- `S.Taxon_Name` — tom, mens `S.Taxon` har `4397`. Navnet er dekorasjon.

Tomt inn → tomt ut er riktig for alle disse.

## Lokalitet må settes eksplisitt

| Felt | Rå HTML | FormData |
|---|---|---|
| `V.SelectedSite.Id` | ingen `value` | `362858` |
| `selectedSite` | ingen `value` | satt |
| `selectedSiteName` | `"false"` ⚠️ | `"Hylkje"` |

`selectedSiteName` har en **misvisende** verdi i rå HTML (`"false"`), ikke en tom.
Et round-trip som stoler på value-attributtet sender altså lokalitetsnavnet `false`.
Verdiene finnes i grid-et (`SiteId`, `SiteName`) og må overstyres derfra.

## `SelectedTempSightings` er ny for hver økt

Tre åpninger av samme funn ga `30826136` → `30826448` → `30826454`
(og `30004844` i juli-fangsten). Den **må** leses ut av det nyåpnede skjemaet.
Caching av den ville skrevet til et håndtak som ikke lenger finnes.

## Checkbox-dublettene, nøyaktig

ASP.NET sender avhukede checkboxer som `true&false`-par. Fra fangsten:

```
S.Taxon                                 = 4397, 4397     ← art sendes TO ganger
E.Gender.IsEditable                     = True, True
V.NewSite.NewSiteCoordinate.Accuracy    = 0, 0
ap2-ui_input_includeoldaccounts         = false, false, false   (tre ganger)
V.Observers[0].IsSelected               = true, false
SightingRelationTemplate[0].IsSelected  = true, false
ap2-ui_input_includecurrentuser         = true, true
```

8 dubletter forklarer differansen 149 entries − 141 unike. **Må reproduseres, ikke
dedupliseres** — og `S.Taxon` må faktisk sendes to ganger.

`#report` har 203 `[name]`-elementer men gir 149 FormData-entries; differansen er
`disabled` felt og uavhukede checkboxer/radioer, som nettleseren utelater.

## Du har ett forsøk per funn

Dette er den praktiske fellen, og den er nå bekreftet to ganger:

| Tilstand | `/Edit/<id>` svarer |
|---|---|
| Funnet publisert (ren) | **312 KB**, `#report`, 203 felt |
| Funnet i gjennomgangskøen | **34 KB**, 6 felt, **`#report` finnes ikke** |

Å bare åpne skjemaet gjør funnet upublisert. Andre måling på samme funn gir derfor
det korte skjemaet, og *ser ut* som om feltene mangler. Det er nesten sikkert slik
3b-tallene oppsto.

**Ved all måling:** bekreft kø = 0 først, hent rå HTML og les ut verdiene i
**samme** operasjon, publiser så tilbake med scoped `Publish`.

## Publisering tilbake

`/PublishSighting` finnes **ikke** som GET (404). `#PublishForm` står på
`/ReviewSighting`, og CSRF må hentes derfra:

```
POST /PublishSighting/Publish
__RequestVerificationToken=<fra #PublishForm på /ReviewSighting>
ReviewSightingViewModel.PublicationName=
ReviewSightingViewModel.PublicationComment=
ReviewSightingViewModel.SightingsToPublishIds=<TemporarySightingId>
```

Scoped `Publish` med utfylt ID framfor `PublishAll`, slik at en redigering aldri
drar med andre ventende funn. Verifiser med `BindReviewSightingsGrid` → `total: 0`.

Det finnes også et `#cancelForm` → `/ReviewSighting/CancelEdit`. **Ikke verifisert
om den publiserer tilbake** — 3b observerte at «Avbryt» *ikke* gjør det, så anta
at den ikke gjør det.

## Hva som gjenstår før skriving

1. **No-op round-trip** på et testfunn: parse, send alt uendret tilbake til
   `/ReviewSighting/Save`, publiser, og verifiser mot `BindSightingsGrid` at funnet
   er bit for bit identisk. Dette er fortsatt den ufravikelige milepælen.
2. Fail-closed parser: kaster hvis et felt i en kjent påkrevd-liste mangler, framfor
   å sende et tomt felt til den nasjonale databasen.
3. Først deretter: endre ett felt.

---

## Rekonstruksjonen er bevist — uten å skrive til AO

Bodyen ble bygget fra rå HTML med reglene under og sammenlignet, felt for felt og
verdi for verdi, mot nettleserens egen `FormData` på det **samme åpne skjemaet**:

> **149 av 149 entries identiske. Null avvik.**

Bare `__RequestVerificationToken` og `SelectedTempSightings` ble holdt utenfor, siden
de er nye per økt. Ingenting ble postet til AO for å bevise dette.

### De 47 reglene

| Kategori | Antall | Hva |
|---|---|---|
| Utelatt | 23 | felt AOs JS deaktiverer (+ hele `SiteViewModel.*`-prefikset) |
| Select-defaults | 7 | nedtrekkslister uten `selected` som JS likevel fyller ut |
| Overstyrt | 16 | felt der rå HTML har en ubrukelig verdi |
| Tillegg | 1 | `base=on` — finnes ikke i rå HTML i det hele tatt |

**`base`** fortjener en merknad: JS lager sju radioknapper for kartlagsvelgeren, og
den første er avhuket. Feltet finnes ikke i serverens HTML, så det må legges til
blindt. Rent kosmetisk for kartet, men nettleseren sender det.

## Implementert

- **`src/ao_edit.py`** — `parse_edit_form()`, `bygg_save_body()`, `finn_option_id()`,
  pluss nettverksdelen (`aapne_skjema`, `lagre`, `publiser`, `publiser_tilbake`).
- **`tests/test_ao_edit.py`** — 42 tester, én per målt felle.
- **`tests/fixtures/ao_edit_form.py`** — håndlaget skjema-fixture som gjengir
  særegenhetene. Ingen personopplysninger, ingen ekte CSRF.
- **`tools/ao_noop_roundtrip.py`** — porten. `--dry-run` som standard.

### Hvorfor `ao_sightings._FormParser` ikke kunne gjenbrukes

Den har en fallback som er riktig for søkeskjemaet og ødeleggende her:

```python
# Ingen opsjon markert valgt? Nettleseren sender den første.
if chosen is None and self._select_options:
    chosen = self._select_options[0]
```

`Activity`s første opsjon er `value="0"` (tom tekst). Gjenbruk ville sendt
`Activity=0` og **slettet aktiviteten** fra funnet. `_EditFormParser` skiller derfor
`select` fra `select-uvalgt` i stedet for å gjette, og `bygg_save_body()` kaster
hvis en aktivitets-ID ikke kan slås opp.

---

## ⚠️ Rettelse 27.10.2026: den første «grønne» porten var falsk

Kjøringen under rapporterte `Save: HTTP 200` og tolket det som suksess. **Det var
feil.** ASP.NET MVC svarer 200 på en POST når modellbinding eller validering
feilet — skjemaet re-rendres med feilmeldinger og ingenting lagres. Suksess er
**302** til `/ReviewSighting`.

Funnet var derfor uendret etterpå fordi *ingenting skjedde*, ikke fordi
round-trippet bevarte det. Sammenligningen av 13 felt kunne ikke skille de to.

Den ekte årsaken til avvisningen var `Taxon` — se under. Logg og tall i avsnittet
under er likevel korrekte som måling av bodyens innhold.

## No-op round-trip kjørt mot ekte AO (27.10.2026)

Første kjøring, med feiltolket statuskode. Testfunn 42030658, fra verifisert ren tilstand (kø = 0).

```
FØR: art=4397 antall=3 akt=Stasjonær sted=Hylkje
skjema: 312 KB
aktivitet: Stasjonær → 23
body: 149 entries, 141 unike
Save: HTTP 200
publisering: HTTP 200
kø etter: 0
```

13 felt sammenlignet før/etter — `TaxonId`, `Quantity`, `ActivityName`,
`UniversalDate`, `FormattedTime`, `SiteId`, `StageName`, `GenderName`, `UnitName`,
`PublicComment`, `PrivateComment`, `DiscoveryMethodName`, `ValidationStatusLabel`.

> **Null avvik.** Funnet er bit for bit identisk etter en full
> `Save` + `Publish`-runde. Verifisert både i grid-dataene og på funnsiden
> (`gråspurv / 3 Individer / Stasjonær`), og funnet er publisert.

Bodyen ble 149 entries / 141 unike — nøyaktig samme tall som nettleserens egen
`FormData`. Reglene i `ao_edit.py` holder altså mot live AO, ikke bare mot fixturen.

Sammen med at `StageName`, `GenderName`, `UnitName` og `DiscoveryMethodName` er
uendret, betyr dette at de feltene vi *utelater* heller ikke blir tømt — AO
beholder dem når de ikke sendes. Det var den største gjenværende usikkerheten.

### Lærdom: hent alt FØR skjemaet åpnes

Første forsøk feilet med `Cannot read properties of undefined` fordi et
lokalitetsnavn ble hentet med et nytt nettverkskall *inne i* den kritiske
seksjonen, etter at skjemaet var åpnet. Funnet lå da upublisert mens kallet feilet.

Nødutgangen fungerte — funnet ble publisert tilbake (HTTP 200), og ingenting ble
postet til `Save`. Men lærdommen står: **alt funnet trenger skal være hentet før
`aapne_skjema()` kalles.** `bygg_save_body()` i `ao_edit.py` tar derfor `funn` som
parameter og gjør ingen nettverkskall selv — den egenskapen er ikke tilfeldig og
må bevares.


---

## Tre feil funnet ved å kjøre endepunktene mot ekte AO (27.10.2026)

Alle tre var stille: ingen av dem ville vist seg i enhetstestene, og to av dem
så ut som suksess.

### 1. Dupliserte `name`-attributter — parseren mistet prefikset

AO rendrer hvert felt med **to** navn:

```html
<input Id="…" Name="SightingViewModel.TemporarySighting.Sighting.Quantity"
       id="…"  name="TemporarySighting.Sighting.Quantity" value="3" />
```

Python lowercaser attributtnavn, så `dict(attrs)` lar den **siste** vinne — det
korte navnet uten `SightingViewModel`-prefikset. Nettleserens DOM tar den
**første**. Derfor stemte alt i Chrome og ingenting i Python.

Utslaget: `/api/ao-sighting-form` svarte `ok: true` med `quantity: null`,
`activityId: null` og en tom aktivitetsliste. `_EditFormParser._attrs()` tar nå
første forekomst, som nettleseren.

**Lærdom:** fail-closed-sjekken lå bare i `bygg_save_body()`, ikke i åpningen.
Den er nå i begge — en parser-feil skal gi en feilmelding, ikke et tomt skjema.

### 2. Antiforgery-cookien fulgte ikke med

Skjemaet hentes i ett HTTP-kall og postes i et annet, med hver sin httpx-klient.
ASP.NET krever at form-tokenet og **cookie-tokenet** er et par fra samme request.
Uten cookien svarer `/ReviewSighting/Save` **HTTP 500** uten forklaring.

`aapne_skjema()` returnerer nå cookie-tokenet, og det bæres via klienten
(`csrfCookie`) tilbake til lagringen. Samme mekanisme `ao_import_httpx` har
håndtert eksplisitt hele tiden.

### 3. `Taxon` må sendes ÉN gang, ikke to ⭐

Dette er den viktigste, og den som skjulte seg bak feiltolkningen av 200.

AO rendrer **to** elementer med navnet `Taxon`:

| | `class` | `type` | verdi i rå HTML |
|---|---|---|---|
| artsvelgerens felt | `ap2picker_value required` | text | `Artportalen.ObjectModel…Taxon` |
| serverens verdi | — | hidden | `4397` |

Nettleserens `FormData` inneholder begge (`4397, 4397` etter at JS har fylt det
første). Men sender vi begge, binder ASP.NET `«4397,4397»` til én `int`, feiler,
og svarer:

```
HTTP 200 — Feltet er obligatorisk [Taxon]
```

**Verifisert mot ekte AO:** to verdier → 200 og ingenting lagret. Én verdi → 302
og funnet lagret. AOs eget JS gjør altså noe mer ved submit enn det `FormData`
viser; vi matcher resultatet, ikke mellomregningen.

### Konsekvens for feilhåndteringen

`lagre()` godtar nå **bare 3xx** som suksess, og plukker AOs egne feilmeldinger
ut av et 200-svar — inkludert `data-valmsg-for`, så meldingen sier *hvilket* felt
som er problemet. «Feltet er obligatorisk» uten feltnavn er ubrukelig når bodyen
har 149 felt.

---

## ✅ Ekte verifisering (27.10.2026)

Etter alle tre fiksene, mot ekte AO gjennom appens egne endepunkter:

| Test | Resultat |
|---|---|
| No-op (ingen endringer) | Save 302, funnet lagret og publisert, `gråspurv / 3 Individer / Stasjonær` uendret |
| Ekte endring 3 → 4 | `bekreftet: true`, AO svarer `Quantity: "4"` |
| Tilbakestilling 4 → 3 | `bekreftet: true`, AO svarer `Quantity: "3"` |

I begge endringene var art, aktivitet, tid, lokalitet og dato uendret. Køen var
tom etterpå hver gang.

**Bekreftelsessteget beviste seg underveis:** da `Taxon`-feilen fortsatt var der,
svarte `save` med `bekreftet: false` og «Antall: ba om 4, AO har 3». Uten det
hadde vi meldt suksess på en endring som aldri skjedde.
