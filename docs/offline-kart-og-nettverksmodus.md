# Offline-kart og nettverksmodus

Funksjonell beskrivelse av offline-laget som kom i v1.60.0. Koden ligger i
`public/js/offline-db.js` (lagring og modus), `public/js/offline-area.js`
(områder og kartfliser) og `public/js/map.js` (flis-henting i kartet).

> **Om dette dokumentet:** oppførselen under er lest ut av koden og verifisert
> ved måling. Tre designvalg er merket **(uavklart)** — der beskriver
> dokumentet hva koden gjør, men begrunnelsen er ikke kjent for den som skrev
> dette. De bør fylles ut av den som tok valgene.
>
> **Oppdatert 06.11.2026:** 10 km-grensen var ett av dem. Den er nå erstattet
> av et arealtak på 250 km² med fri form — se «Hvorfor areal og ikke side ×
> side» under.

## Tre nettverksmodi

Knappen i toppraden sykler `Online → Hybrid → Offline → Online`. Valget ligger
i `localStorage` under `network_mode_v1`, og **standard er Hybrid**
(`DEFAULT_NETWORK_MODE`).

| Modus | Kartfliser | Lokaliteter |
|---|---|---|
| 🌐 Online | Alltid fra nett | Alltid fra AO |
| 🔄 Hybrid | Nett først, cache når det feiler | AO, med lokal cache som fallback |
| 📴 Offline | Kun cache — **null nettverkskall** | Kun lokalt lagrede |

Målt i kartet: Online og Hybrid gjør begge 12 flis-forespørsler for et
standardutsnitt, Offline gjør **0**.

Modusen deles med service workeren gjennom en egen cache-oppføring
(`NETWORK_MODE_CACHE_URL`), så den kan håndheve det samme for forespørsler som
går utenom JS-en.

### Hva offline-modus sperrer

`main.js` deaktiverer de nettverksavhengige inngangene og viser «Ikke
tilgjengelig i offline-modus!» ved klikk: **Fellestur**, **Tidligere sendt** og
**Mine delinger**. Kartknappen for å hente nye lokaliteter er også av.

**Sending til AO er ikke sperret, men krever et bevisst valg.** Trykker du
«Send til AO» i offline-modus, spør appen først om nettverket likevel skal
brukes (`_visOfflineInnsendingBekreftelse`). Sier du ja, sendes forespørselen
med headeren `X-Allow-Offline-Network: 1`. Det er riktig prioritering: en
observasjon som står usendt er verdt mer enn et prinsipp om null trafikk.

### Blankt kart er forventet, men forklares

I offline-modus settes fliser som mangler i cachen til en gjennomsiktig
1×1-PNG. Står du i et område du ikke har lastet ned, blir kartet derfor helt
blankt mens lokalitetspinnene fortsatt vises — de kommer fra den lokale
databasen. Det leste som en feil i felt (05.11.2026), og
`#tomt-kart-varsel` forklarer det nå. Se CLAUDE.md under `map.js`.

## Nedlasting av områder

Fra kartsiden: «📦 Offline-område» åpner et rektangelvalg du kan flytte og
endre størrelse på.

| Grense | Verdi |
|---|---|
| Minste side | 250 m |
| Standard | 2 500 × 2 500 m |
| **Største areal** | **250 km²** |
| Største side | 50 km (ren fornuftssperre) |
| Zoom-nivåer som lastes | 12 og 15 **(uavklart hvorfor nettopp disse)** |
| Fliser per batch | 10 |

### Hvorfor areal og ikke side × side

Fram til v1.60.6 var taket 10 km på **hver side**, clampet hver for seg. Det
forbød former som koster nøyaktig det samme, men som felt-bruk trenger: en
kystlinje øst–vest, en dal, en fjord.

Nedlastingskostnaden er antall fliser, og det følger arealet. Målt mot
Kartverket Topo på 60° nord, zoom 12 + 15:

| Form | Areal | Fliser |
|---|---|---|
| 10 × 10 km | 100 km² | 298 |
| 20 × 5 km | 100 km² | 316 |
| 40 × 2,5 km | 100 km² | 344 |

Variasjonen er kantsløsing mot flisgridet — lange tynne områder spiser litt
mer kant. Arealet er altså den riktige størrelsen å begrense, og formen kan
være fri.

Taket er satt til **250 km²**, 2,5 ganger det gamle. Det gir rom for
25 × 10 km eller 50 × 5 km. Sidetaket på 50 km står igjen som en sperre mot
absurde strimler (100 × 2,5 km er 250 km², men strekker seg over et halvt
fylke og er nesten bare kantsløsing).

Overskrides arealet, skaleres bredde og høyde ned **proporsjonalt**, så formen
brukeren dro opp beholdes og bare blir mindre. Clampet vi sidene hver for seg,
ville et langt område blitt kvadratisk i stedet. Skaleringen itereres: krymper
boksen, flytter midtbreddegraden seg, og meter per lengdegrad avhenger av den
— én runde bommer med en halv prosent på store områder.

### Kostnaden vises før nedlasting

En kartflis fra Kartverket Topo veier rundt 46 KB (målt 06.11.2026), så
250 km² er ~750 fliser, altså rundt 34 MB. Områdevelgeren viser derfor
`bredde × høyde · areal · ~MB` mens du drar, og ikke bare målene. Det skal
ikke oppdages etterpå, på mobildata i felt.

Kartflisene hentes fra **Kartverket Topo** (gratis WMTS uten nøkkel) og lagres
i Cache API under `enkel-ao-kartverket-tiles-v1`. Lokalitetene lagres i
IndexedDB (`enkel_ao_offline_db`), i egne lagre for områder og lokaliteter.

At bare to zoom-nivåer lastes er grunnen til at et nedlastet område ikke ser
skarpt ut på alle zoom-trinn. `map.js` dekker hullene med over- og underzoom
fra de nivåene som finnes i cachen, og faller tilbake på andre kartlag
(Kartverket Topo → OpenStreetMap → Kartverket Gråtone) før den gir opp og
viser en tom flis.

### Opportunistisk lagring **(uavklart)**

`saveOpportunisticOfflineLocations()` lagrer lokaliteter i bakgrunnen mens du
er online, uten at du ber om det — de havner i et eget område med id
`opportunistic`. Andres private lokaliteter tas ikke med med mindre
innstillingen for å vise dem er på.

Hva som utløser den og hvor aggressiv den er ment å være, er ikke beskrevet
noe sted. Funksjonelt betyr det at du kan ha lokaliteter lagret for steder du
har besøkt i appen, selv om du aldri lastet ned et område der.

## Administrasjon

**I innstillinger:**
- Lagringsstatistikk: antall lokaliteter, antall områder og antall cachede fliser
- «Synkroniser offline-områder» — henter ferske lokaliteter for alle lagrede
  områder på nytt. Krever innlogging for å få med private lokaliteter
- «🗑️ Slett offline-data» — tømmer alt, med bekreftelsesdialog

**På kartsiden:**
- Listeikonet viser nedlastede områder, og enkeltområder kan slettes derfra

`clearAppCachesPreservingMapTiles()` finnes for å rydde appens egne cacher uten
å kaste kartflisene — nedlastede fliser er dyre å hente igjen, og skal
overleve en vanlig opprydding.

## Avhengigheter å kjenne til

- **Artssøket virker offline uansett modus.** Den lokale artslista
  (`public/data/norske_arter.json`) precaches av service workeren og er
  primærkilde i alle modi. Se `docs/artssok-rangering.md`.
- **Stedssøk på navn** går mot serverens LocationDB og krever nett. I offline
  faller det tilbake på lokalt lagrede lokaliteter
  (`getAllOfflineLocations()`).
- **`SERVICE_WORKER_URL` i `offline-db.js`** er versjonert (`/sw.js?v=…`) og
  må bumpes sammen med resten ved ny versjon. Den ligger utenfor enhver
  HTML-fil og er lett å overse — se versjoneringsrutinen i CLAUDE.md.
