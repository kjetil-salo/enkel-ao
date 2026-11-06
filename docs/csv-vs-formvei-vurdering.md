# CSV-import eller «simulere AO»? Vurdering av skriveveien for nye funn

**Besluttet 31.10.2026.** Spørsmålet som ble stilt: er Excel/CSV-importen den mest
hensiktsmessige måten å sende funn til AO, når vi tross alt har vist at vi kan simulere
AOs eget registreringsskjema — altså måten AO selv gjør det, uten importfunksjonen?

**Konklusjon: behold CSV-importen som skrivevei for nye funn.** Formveien er ikke et
alternativ til importen; den er et alternativ til én av tre faser, og det er den fasen som
i dag fungerer best. Vurderingen bygger ikke på antakelser om formveien — vi har bygget
den (`src/ao_edit.py`) og kjørt den mot ekte AO, så kostnaden er målt.

---

## Sendingen har tre faser. Formveien bytter bare ut den første

| Fase | I dag (CSV) | Med formveien |
|---|---|---|
| **A.** Få funnet inn hos AO | 1 POST `ImportSighting/ParseObservations` for HELE batchen | 1 GET (312 KB) + 1 POST (149 felt) **per observasjon** |
| **B.** Finne igjen raden (bilde, scoped publisering) | markør i privat kommentar + polling + grid-matching | ID rett i svaret — **ekte forbedring** |
| **C.** Publisere | `PublishSighting/PublishAll` / scoped `Publish` | **nøyaktig det samme** |

Fase C forsvinner ikke, uansett vei inn: **gjennomgangskøen er AOs eneste vei til
publisering.** Det ser vi direkte i `ao_edit.py` — å endre et PUBLISERT funn gjør det
upublisert igjen og krever `Publish` tilbake. Hele komplekset rundt scoped publisering,
kø-telling, `heldBack` og `notPublished` (se `ao-publish-selective-capture.md`) blir altså
stående enten vi importerer eller poster skjemaet.

Den reelle gevinsten ved formveien er derfor **bare fase B**. Og fase B kan forbedres
betydelig billigere — se «Planen» under.

> Ikke målt: om `SubmitSighting`-skjemaets lagring returnerer `TemporarySightingId`
> direkte. Det er sannsynlig (redigeringsskjemaets `SelectedTempSightings` er et slikt
> håndtak), men det er en antakelse, og det er den ENESTE antakelsen gevinstsiden hviler
> på. Resten av dette dokumentet er målt.

## Hva formveien koster — fra `ao_edit.py`, ikke fra magefølelsen

`ao_edit.py` er formveien for **ett felt på ett funn**. Den er 842 linjer. Erfaringene fra
å få den grønn mot ekte AO (se `ao-rediger-maling-2026-10-26.md` og commit-historikken):

- **Tre stille feil som alle enhetstestene var grønne på**, funnet først mot ekte AO:
  dupliserte `name`-attributter (Python lowercaser attributtnavn, så prefikset ble mistet),
  antiforgery-cookie som ikke fulgte klienten (→ HTTP 500 uten forklaring), og `Taxon`
  sendt to ganger slik nettleseren gjør det — AO svarte «Feltet er obligatorisk [Taxon]»
  med **HTTP 200 og lagret ingenting**. To av de tre så ut som suksess.
- **23 felt deaktiveres av AOs JavaScript** etter at siden er lastet. `disabled` finnes
  ikke i rå HTML. Lista er MÅLT, ikke utledet: hypotesen om en strukturell regel ble testet
  og motbevist på 26 av 32 felt.
- **`<select>` rendres uten `selected`.** En naiv round-trip SLETTER aktiviteten, fordi
  `Activity` sin første option er `value="0"` (tom).
- **`selectedSiteName` har verdien `"false"`** i rå HTML. Stoler du på value-attributtet,
  sender du lokalitetsnavnet `false` til den nasjonale artsdatabasen.
- **Samme URL gir to forskjellige skjemaer.** `/Edit/<id>` svarer med 312 KB og `#report`
  fra ren tilstand, og 34 KB uten `#report` hvis funnet allerede ligger i køen. Du har ett
  forsøk.
- **Åpning tar 5–9 sekunder**, lagring mer.
- Bekreftelsessteget måtte senere endres fra `bekreftet: false` til `bekreftet: null`
  (v1.57.1), fordi AOs egen publiserte liste ikke er oppdatert i samme øyeblikk som
  publiseringen svarer. Et forbehold ble meldt som et avvik, på en endring som virket.

Feilmodusen er altså ikke «det feiler synlig». Den er **stille datatap i en nasjonal
database, med HTTP 200**. Ganger N observasjoner, per sending, i felt. Enhetstester fanger
det ikke — det er dokumentert at de ikke gjorde det.

## Tre ting CSV gir oss som formveien tar bort

1. **Navneoppslag.** CSV sender `Artsnavn` og lokalitet som tekst (eller `placeId`), og AO
   gjør oppslaget. Formveien krever numerisk `S.Taxon` og `V.SelectedSite.Id`.
   Offline-artslista (`public/data/norske_arter.json`) har `taxonId` for 597 av 604 arter,
   men en manuelt skrevet lokalitet eller en underart utenfor lista har ingen ID — og da
   har formveien ingen vei videre. CSV har.
2. **En dokumentert kontrakt mot en udokumentert.** Importmalen er AOs eget brukerrettede
   format; endrer de kolonnene, brekker de regnearkene til alle brukerne sine.
   Feltnavnene i `#report` har ingen slik beskyttelse, og vi har allerede sett rendringen
   variere mellom to svar på samme URL.
3. **Ett kall mot N.** 10 obs = 1 POST i dag. Formveien: 10 × (312 KB GET + 149-felts
   POST). Det er på kant med vår egen regel om eksterne API-er i `CLAUDE.md`, og det er
   ti separate sjanser for stille feil der det nå er én.

## Planen — det som faktisk er verdt å gjøre

### Trinn 1: fjern markør-hacket uten å bytte skrivevei

Reell gevinst i fase B, liten risiko. Les settet av `TemporarySightingId` fra
`review_queue_rows()` FØR importen (vi henter allerede kø-telleren der), og diff mot settet
etter. Differansen ER vår batch. Da trengs ingen `#imp-xxxx` i brukerens private kommentar
for scoped publisering.

Markøren beholdes kun for observasjoner med bilde, der vi trenger rad-til-obs-mapping og
ikke bare mengden.

**Åpent, og det må løses fail-safe:** samtidig innsending fra brukerens egen nettleser.
Finner vi flere nye rader enn vi sendte, vet vi ikke hvilke som er våre — da må vi IKKE
publisere dem alle. Samme retning som dagens fail-safe (`pre_existing_count is None` ⇒
antatt ikke tom).

### Trinn 2: mål hva CSV faktisk IKKE klarer

Dette er det avgjørende, og vi vet det ikke i dag. Formveien er bare begrunnet hvis noe på
denne lista er en reell blokker. Testes mot ett testfunn på egen konto:

- **«Ukjent antall»** — headeren i `ao_import.py` har ingen `Enhet`-kolonne i det hele
  tatt. Relevant for lyttestasjon-planen.
- **Funnmetode / `DiscoveryMethod`** — sendes ikke av nettleseren engang; defaultes av AO.
- **Koordinater + nøyaktighet for ad-hoc-lokalitet** — kolonnene `Nord`/`Øst`/`Nøyaktighet`
  FINNES i headeren vår, men fylles aldri ut. Virker de?
- **Mer enn 10 medobservatører** — malen har nøyaktig 10 kolonner.

### Trinn 3: hent AOs importmal på nytt og diff mot headeren i `ao_import.py`

Billig. Vi vet ikke om kolonnelista vår er komplett, eller bare «komplett nok i 2026».

### Trinn 4: hvis trinn 2 avdekker en blokker — CSV + etterredigering, ikke formvei for alt

Send batchen som nå, og bruk `ao_edit.py` kirurgisk på de få funnene som trenger et felt
malen ikke dekker. Den veien er allerede bygget, verifisert mot ekte AO og har et
bekreftelsessteg. Dramatisk billigere enn å flytte hele innsendingen over på et 149-felts
skjema.

### Trinn 5: la formveien være det den er god til

Den eier allerede sjeldenhetsvarselet (`SubmitSighting/GetSite` +
`ValidateTaxonAndArea`), bildeopplasting (`Media/UploadImageAction`) og endring
(`ReviewSighting/Save`). Det er riktig arbeidsdeling: **formveien der vi trenger AOs
sanntidsvurdering av én rad, importen der vi trenger å få N rader inn.**

## Premisset som må korrigeres

«Vi kan simulere alt» er sant som kapabilitet, men formveien er ikke en mer *autentisk* vei
inn. Begge ender i samme gjennomgangskø og publiseres med samme fire-felts `#PublishForm`.
Importen er ikke en omvei rundt AO — den er AOs egen bulkvei inn. Det er formveien som er
omveien, straks man har mer enn ett funn.

## Når denne beslutningen bør tas opp igjen

- Trinn 2 viser at noe brukerne faktisk trenger er umulig i malen, OG trinn 4 (CSV +
  etterredigering) ikke dekker det.
- AO legger ned eller endrer importformatet. Da er formveien eneste vei, og dette
  dokumentet er kartet over hva det koster.
- AO tilbyr et ekte API. Da er begge disse veiene feil.

## Se også

- `ao-rediger-maling-2026-10-26.md` — feltmålingen formveiens kostnad er hentet fra
- `ao-publish-selective-capture.md` — fase C, som er felles for begge veier
- `ao-import-fremdrift.md` — fremdriftspollingen i fase A
- `ao-mine-funn-api.md` punkt 3b — den opprinnelige (og motbeviste) målingen
