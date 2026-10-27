# Endringsside v1 — forenklet retting av publisert funn

**Dato:** 26.10.2026. Bygger på `docs/ao-rediger-maling-2026-10-26.md`.
**Status:** plan, ikke implementert.

## Omfang: tre felt

| Felt | Hvorfor | AO-felt | Kilde til nåverdi |
|---|---|---|---|
| **Antall** | vanligste retting | `S.Quantity` | rå HTML (`value`) |
| **Aktivitet** | nesten like vanlig | `S.Activity` | options-oppslag på `ActivityName` fra grid |
| **Art** | «det var løvsanger, ikke gransanger» | `S.Taxon` ×2 | rå HTML (`value`) |

Alt annet — dato, tid, lokalitet, kommentarer, skjuling — er **utenfor v1**. De
round-trippes uendret. Brukeren sendes til AO for dem.

### Hvorfor art er med, tross høyere risiko

Etterbestemmelse er en reell og hyppig hendelse i felt-ornitologi, og det er den
rettingen som betyr mest for datakvaliteten — en feilbestemt art er verre enn et feil
antall. Teknisk er den også billig her: `S.Taxon` *har* verdi i rå HTML, og
løvsanger/gransanger er samme artsgruppe, så `S.Taxon_speciesgroupid` (8 = fugler) er
uendret. Vi har allerede artssøk og `taxonId` i appen.

**To forbehold:**
- `S.Taxon` sendes **to ganger** i skjemaet. Begge må settes.
- Artsendring kan utløse en sjeldenhetsregel. Vi har `/api/ao-rarity` — kjør den på
  den *nye* arten før lagring, og vis varselet før brukeren bekrefter.

## Flyt

```
sendt.html, rad med funn
        │  «✏️ Endre»
        ▼
┌─────────────────────────────────────────┐
│  Du endrer et publisert funn            │
│  ⚠️ Funnet blir usynlig for andre mens  │
│     du endrer, og publiseres på nytt    │
│     når du lagrer.                      │
│                                          │
│  Art       [gråspurv          ▾]        │
│  Antall    [3                  ]        │
│  Aktivitet [Stasjonær         ▾]        │
│                                          │
│  Hylkje · 25.10.2026 15:52              │
│  (dato, tid og lokalitet endres på AO)  │
│                                          │
│       [Avbryt]  [Lagre og publiser]     │
└─────────────────────────────────────────┘
```

Aktivitetslista fylles fra `S.Activity`-options i skjemaet AO sendte — ikke fra en
hardkodet liste. Da følger den AO automatisk.

## Serverendepunkter

### `POST /api/ao-sighting-form`
Åpner redigeringsskjemaet og returnerer nåværende verdier + valglister.

```json
{ "ok": true, "sightingId": 42030658, "tempSightingId": 30826454,
  "taxon": {"id": "4397", "navn": "gråspurv"},
  "quantity": "3",
  "activity": {"id": "23", "navn": "Stasjonær"},
  "activityOptions": [{"id":"23","navn":"Stasjonær"}, …],
  "lest": "25.10.2026 15:52 · Hylkje",
  "formToken": "<opakt håndtak til den åpne økta>" }
```

**Bieffekt:** funnet er nå upublisert. Svaret må si det, og klienten må vise det.

### `POST /api/ao-sighting-save`
Tar `sightingId` + de tre feltene, round-tripper resten, lagrer, publiserer scoped.

```
POST /ReviewSighting/Save                  → 302 /ReviewSighting
POST /PublishSighting/Publish              → scoped på TemporarySightingId
POST /ReviewSighting/BindReviewSightingsGrid → verifiser total: 0
```

### `POST /api/ao-sighting-abort`
Publiserer funnet tilbake uendret. **Kritisk** — se under.

### Bekreftelse: les endringen tilbake fra AO

Etter publisering hentes funnet på nytt fra `BindSightingsGrid` og sammenlignes
med det brukeren ba om. Dette er samme mekanisme som no-op-porten bruker, og den
er verifisert å virke (27.10.2026).

```json
{ "ok": true,
  "bekreftet": true,
  "ao": {"quantity": "4", "activityName": "Næringssøkende", "taxonId": "4330"} }
```

Forskjellen i UI er stor:

> ❌ «Endringen er sendt.»
> ✅ «Artsobservasjoner bekrefter: 4 individer, næringssøkende.»

Den andre varianten er lest tilbake fra AOs egen database. Stemmer den ikke med
det brukeren ba om, settes `bekreftet: false` og brukeren får beskjed med én gang —
framfor å tro at det gikk bra.

**`bekreftet: false` er ikke det samme som at noe gikk galt.** AO kan ha avvist
endringen med en valideringsregel, eller grid-et kan henge etter. Teksten må derfor
si hva AO faktisk svarte, ikke bare «noe feilet», og lenke til `/Sighting/<id>`.

## Fem regler implementeringen må følge

1. **Fail-closed parser.** Kast hvis et felt i påkrevd-lista mangler, framfor å sende
   et tomt felt til den nasjonale databasen. Samme prinsipp som `_override` i
   `ao_sightings.py`.

2. **Les skjemaet og verdiene i ÉN operasjon.** Andre forsøk på samme funn gir det
   korte 34 KB-skjemaet uten `#report`. Du har ett forsøk.

3. **Reproduser dublettene.** 8 felt sendes flere ganger, `S.Taxon` inkludert. Ikke
   dedupliser.

4. **Overstyr `selectedSiteName`.** Rå HTML har `"false"`, ikke tomt. Stoler du på
   value-attributtet, sender du lokalitetsnavnet `false`.

5. **Publiser alltid tilbake, også på feilstier.** Dette er den farligste delen.

### Den upubliserte tilstanden er v1s reelle risiko

Å åpne skjemaet gjør funnet usynlig for alle andre **umiddelbart**. Hvis brukeren
lukker fanen, mister dekning eller appen kræsjer mellom `form` og `save`, blir funnet
liggende usynlig — og plukkes opp av neste `PublishAll` fra appen som en tilfeldig
bieffekt.

#### Brukeren må få vite det, tydelig

Teksten står i selve dialogen, ikke i en hjelpetekst, og den skal være rød og
vedvarende — ikke en toast som forsvinner:

> 🔴 **Funnet er nå usynlig for andre**
> Artsobservasjoner tar funnet ut av visning mens du endrer det. Det blir synlig
> igjen når du lagrer.
> **Lukker du siden nå, blir funnet liggende skjult.** Bruk «Avbryt» hvis du
> ombestemmer deg — da publiseres det tilbake med én gang.

Tre krav til hvordan den oppfører seg:

1. **Vises fra det øyeblikket skjemaet er åpnet**, ikke ved første tastetrykk.
   Tilstanden inntreffer ved åpning, så advarselen må gjøre det også.
2. **«Avbryt» er en handling, ikke en lukkeknapp.** Den kaller `abort` og venter på
   svar før dialogen lukkes. En «×» i hjørnet må gjøre det samme.
3. **`beforeunload`** gir nettleserens egen «vil du forlate siden?» i tillegg.
   Den er et sikkerhetsnett, ikke hovedadvarselen — teksten kan vi ikke styre, og
   den vises ikke alltid.

#### Og en vei tilbake hvis det likevel skjer

Advarsel alene er ikke nok — strømmen går, telefonen dør. `sendt.html` bør ved
lasting sjekke `/api/ao-queue-count`, og vise en rød linje hvis køen ikke er tom:

> 🔴 **Du har N funn som ikke er publisert hos Artsobservasjoner.**
> De er usynlige for andre inntil de publiseres. [Publiser nå]

Dette gjenbruker et endepunkt som allerede finnes, og dekker også etterlatte funn
fra helt andre årsaker — f.eks. at brukeren har redigert noe på AOs egne sider.

Tiltak, i prioritert rekkefølge:

- `abort`-endepunktet kalles på `beforeunload` **og** på «Avbryt».
- Hvis `save` feiler på noe punkt: publiser tilbake uendret, og si det.
- `oppdaterAoKoHint()` finnes alt i `export-operations.js` og varsler om funn i køen
  før sending. Den er sikkerhetsnettet hvis alt annet svikter — verifiser at den også
  dekker rader som kommer fra redigering, ikke bare fra import.
- Vurder en «du har et funn som ikke er publisert»-sjekk ved oppstart av `sendt.html`.

**`CancelEdit` er ikke verifisert** (`#cancelForm` → `/ReviewSighting/CancelEdit`).
3b observerte at AOs egen «Avbryt» *ikke* publiserer tilbake. Bruk vår egen scoped
`Publish` i `abort`, ikke `CancelEdit`.

## Rekkefølge

1. **No-op round-trip** på et testfunn — send alt uendret, verifiser bit for bit mot
   `BindSightingsGrid`. Ufravikelig port. Ingen UI før denne er grønn.
   - ✅ Rekonstruksjonen er bevist mot nettleserens `FormData`: 149/149 felt
     identiske, uten å skrive til AO. Se `docs/ao-rediger-maling-2026-10-26.md`.
   - ✅ `src/ao_edit.py` + 42 tester + `tools/ao_noop_roundtrip.py`.
   - ✅ **Kjørt mot ekte AO 27.10.2026 — GRØNN.** Full `Save` + `Publish` på
     funn 42030658, 13 felt sammenlignet, null avvik. Se måledokumentet.
2. `abort`-stien, inkludert `beforeunload`. Bygges *før* lagring, ikke etter.
3. Bekreftelsessteget (les tilbake fra `BindSightingsGrid`) — bygges sammen med
   lagringen, ikke etterpå. En lagring uten bekreftelse er en lagring vi ikke vet
   utfallet av.
4. Antall alene (enkleste felt, ingen følgevalidering).
5. Aktivitet (options-oppslag).
6. Art (+ `/api/ao-rarity` på ny art).

Punkt 1 og 2 er ikke valgfrie og ikke «kan gjøres etterpå». De er det som skiller
dette fra å skrive søppel inn i en database andre forsker på.


---

## Status 27.10.2026: v1 er komplett

Alle tre feltene er bygget, deployet til Pi-staging og verifisert mot ekte AO.

| Felt | Status |
|---|---|
| Antall | ✅ 3→5→3, bekreftet begge veier |
| Aktivitet | ✅ Stasjonær→Næringssøkende→Stasjonær, bekreftet |
| Art | ✅ gråspurv→skjære→gråspurv, bekreftet |

### Artsendring, som bygget

- **Artssøk** gjenbruker `/api/species` (samme endepunkt som registreringsskjemaet),
  med 250 ms debounce og en sekvensvakt så bare siste søk får tegne.
- **Søket filtreres til artsgruppe 8 (fugler).** `bygg_save_body()` setter
  `Taxon_speciesgroupid` fast til 8, så et treff fra en annen gruppe ville blitt
  sendt med feil gruppe-ID. Treff utenfor gruppa vises som «Bare fuglearter kan
  velges her» framfor å feile hos AO.
- **Sjeldenhetsvarsel på den NYE arten** via `/api/ao-rarity`, med samme
  race-vakt. Vises før brukeren bekrefter, ikke etterpå.
- **Den gamle arten står i parentes** («skjære (var gråspurv)»), så det er synlig
  hva man endrer fra.

### Lærdom fra felt

Første utrulling meldte «viser noe annet enn du ba om» på en endring som gikk
gjennom. AOs publiserte liste er ikke alltid oppdatert i samme øyeblikk som
publiseringen svarer, og «fant ikke funnet» ble feilaktig klassifisert som et
avvik. Planen sa det selv:

> `bekreftet: false` er ikke det samme som at noe gikk galt.

Regelen sto her og ble brutt i implementasjonen. Rettet i v1.57.1 med tre forsøk
og `bekreftet: null` som utfall. **Verdt å merke seg for neste felt som legges
til:** en bekreftelse som sår tvil om noe riktig er verre enn ingen bekreftelse.

### Ikke bygget

Dato, tid og lokalitet. De står synlig i dialogen som «endres ikke her», med
henvisning til Artsobservasjoner. Lokalitet er den dyreste av dem — den drar inn
kart- og koordinatfeltene som AOs JS deaktiverer, og som derfor må kartlegges på
nytt.
