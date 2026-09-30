# Kartets hente-radius og lokale cache

Hvorfor panorering på kartet (`map.html`) henter en fast, trygg maksradius i
stedet for én som skalerer med kartutsnittet, hvorfor et tomt AO-svar aldri
får lov til å tømme kartet, og hvordan den lokale 7-dagers cachen fungerer.

Innført i v1.53.19 (viewport-avhengig radius), forenklet i v1.53.22 (fast
radius) — begge ganger på bakgrunn av feedback fra betatester Espen
(Messenger) og felttesting sammen med Kjetil, 2026-09-28/29.

**Status:** Verifisert i felt av Kjetil på staging (aos.efugl.no) 2026-09-29
etter v1.53.22-deploy — gjenbesøk til samme sted oppleves nå raskt uavhengig
av zoom-nivå, det opprinnelige problemet («føles sakte selv med cache») er
løst.

## Bakgrunnen: hva Espen meldte inn

Etter å ha brukt kart-funksjonen i felt meldte Espen tre ting:

1. Lokaliteter som allerede var lastet inn burde ikke forsvinne ved panorering.
2. Det burde lastes inn automatisk «alt i kartutsnittet», ikke bare et fast,
   lite område rundt senteret.
3. Lokaliteter viste seg ikke på alle zoom-nivå.

Kjetils motkrav (avgjørende for hele designet): å faktisk hente «alt i
kartutsnittet» er farlig hvis brukeren zoomer langt ut — zoomer man ut til hele
Norge, må appen likevel aldri prøve å hente et helt land. Løsningen måtte derfor
kombinere «hent mer når det er naturlig» med en grense som aldri kan brytes,
uansett zoom.

## Radius: en fast maksverdi, uansett zoom (v1.53.22)

`AUTO_FETCH_RADIUS_M = Math.max(3000, sizeMeters)` i `public/js/map.js` — en
**fast** verdi som brukes for hvert AO-kall panorer-og-oppdater gjør, uansett
hvilket zoom-nivå kartet står på:

- **Gulv:** `sizeMeters` — brukerens eksplisitt valgte søkeradius fra
  registreringssiden. Panorering skal aldri vise FÆRRE lokaliteter enn det
  man selv ba om.
- **Tak (og i praksis alltid den reelle verdien):** `3000` m — satt lik den
  eksisterende maks-verdien på søkeradius-slideren i `public/index.html`
  (500 m – 3 km). Bevisst valg: en allerede utprøvd, trygg grense i stedet
  for en ny, uprøvd terskel. En høyere verdi ville også gjort det lettere å
  treffe AOs harde `maxSites: 1000`-tak i tette områder (f.eks. Oslo
  sentrum), som trunkerer resultatet stille uten varsel til klienten.

Ingen egen **nedre zoom-sperre** finnes. Zoomer man ut til hele Norge, blir
det synlige kartutsnittet stort, men AO-forespørselen strekker seg likevel
aldri lenger enn 3 km rundt kartsenteret — resten av det synlige kartet vises
bare tomt. Enklere enn en egen terskel, og løser produkteierens krav uten noen
UI for «zoom inn for å laste mer».

### Hvorfor ikke viewport-avhengig? (v1.53.19–21, erstattet)

De tre første versjonene av denne featuren beregnet i stedet en radius ut fra
hvor mye kartutsnittet faktisk dekket (`computeEffectiveFetchRadiusMeters()`:
Web Mercator meter-per-piksel × halve viewport-diagonalen, klippet til
samme gulv/tak som over) — jo mer utzoomet, jo større radius, inntil taket.
Tanken var å komme nærmere Espens «alt i kartutsnittet»-ønske.

I felttesting med Kjetil (2026-09-29) viste dette seg å ha en alvorlig
bieffekt: `fetchAoSitesCached()` sin cache (se under) krever at en tidligere
cachet radius er **minst like stor** som det som nå trengs. Siden radiusen nå
varierte med zoom, ble et **lite zoom-skifte mellom to besøk på nøyaktig
samme sted** — noe som skjer hele tiden i vanlig, naturlig kartbruk — en
cache-miss. «Jeg var jo nettopp her» stemte da ikke lenger for cachen, og
appen gjorde et nytt, ekte AO-kall. Målt direkte på staging: 1,5–2,3 sekunder
per slikt bomtreff, akkurat den forsinkelsen Kjetil rapporterte («føles
fortsatt sakte selv etter cache-fiksen»).

Løsningen: dropp viewport-avhengigheten helt. Radiusen er allerede låst til
et trygt tak (3 km) — det er ingen grunn til at et INNZOOMET besøk skal be om
mindre enn det taket tillater. Ved alltid å hente (og cache) den samme faste
verdien blir ethvert gjenbesøk innenfor `BBOX_CACHE_MATCH_DISTANCE_M` et
cache-treff, helt uavhengig av zoom-nivå — samtidig som selve sikkerhetstaket
(aldri mer enn 3 km / 1000 sites) er helt uendret. Dette fjernet også behovet
for å spore zoom separat (se under).

## Zoom uten panorering trigger ikke lenger noe eget forsøk

I v1.53.19–21 sammenlignet `handleMapMoveEnd()` både *avstand* fra forrige
hentepunkt OG zoom-nivå (`lastFetchedZoom`/`zoomChanged`), fordi en ren zoom
(samme senter) med en viewport-avhengig radius trengte et nytt kall for å
hente riktig mengde data. Med en FAST radius (v1.53.22) endrer ikke zoom hva
som skal hentes fra et gitt senter i det hele tatt — det som allerede er
hentet der dekker uansett hele den faste radiusen. `lastFetchedZoom`/
`zoomChanged` er derfor fjernet; kun avstand fra forrige hentepunkt
(`MIN_REFETCH_DISTANCE_M`, nå en fast verdi siden radiusen er det) avgjør om
et nytt kall er verdt det.

## Race-tilstand ved rask panorering

`lastFetchedCenter` settes **optimistisk** til det nye målet FØR selve
AO-kallet starter, ikke først ved suksess. Uten dette kunne en rask
panorering til sted A og rett tilbake til sted B (før As kall er ferdig) latt
Bs eget `moveend` se ut som «ingenting nytt» (fortsatt sammenlignet mot det
gamle, ikke-oppdaterte punktet), hoppe over sitt eget kall, og siden la As
forsinkede, nå utdaterte svar bli tegnet og markert som gjeldende for B.

Ved en ekte feil (kastet exception — nettverksbrudd, `ensureAoTokens()` som
feiler) reverteres bokføringen til forrige kjente sted via
`revertFetchBookkeepingIfStillCurrent()`, slik at et senere besøk på nøyaktig
samme sted fortsatt trigger et nytt forsøk. Reverten skjer kun hvis dette
fortsatt er den gjeldende hentingen (sjekket via `fetchSeq`) — en nyere,
allerede fullført/pågående henting skal ikke få bokføringen sin overskrevet av
et eldre forsøks feil.

**Kjent, akseptert restrisiko:** hvis et eldre forsøk (mot sted A, fortsatt i
flight) skulle lykkes ETTER at et nyere forsøk (mot B) har feilet og reversert
til A, blir As eget vellykkede svar likevel forkastet av `fetchSeq`-sjekken (et
enda nyere B-forsøk «eier» sekvensen) — og bokføringen sier da feilaktig at A
er ferdig hentet helt til brukeren beveger seg langt nok bort og tilbake.
Selvkorrigerende innen én ekstra bevegelse, og for usannsynlig (krever treg
nettverk + feil i akkurat denne rekkefølgen) til å rettferdiggjøre
per-forsøk-sporing i et hobbyprosjekt.

## Den viktigste fiksen: tomt svar tømmer ikke lenger kartet

Backend degraderer **alltid** eksterne AO-feil til en tom, men HTTP 200-liste
(se CLAUDE.md, «External API Error Handling») — en forbigående dekningsglipp i
felt (som appen er laget for) er derfor **umulig å skille** fra et genuint tomt
område, sett fra frontend.

Før denne fiksen kalte `handleMapMoveEnd()` `renderSites()` med resultatet
uansett, også når det var tomt — som tømte `siteLayerGroup` for allerede viste,
gyldige lokaliteter. Dette er trolig (deler av) forklaringen på Espens punkt 1.

Nå: `if (bboxSites.length === 0) return;` — selve visningen røres ikke ved et
tomt svar. Bokføringen (`lastFetchedCenter`) reverteres **bevisst ikke** her
(i motsetning til ved en ekte feil): et tomt svar behandles som et gyldig,
«ferdig sjekket» resultat for akkurat dette punktet, på samme måte som resten
av appen allerede stoler på en degradert-men-200 respons som sannheten. Et
første forsøk med revert her hamret et nytt AO-kall for hver ~150 m
panorering over et genuint tomt område (kyst, hav, fjell) — stikk i strid med
prosjektets «External API Ethics»-prinsipp om aldri å hamre på
artsobservasjoner.no. Prisen: en maskert, forbigående AO-feil hentes ikke på
nytt før brukeren beveger seg vekk og tilbake — samme forsinkelse enhver
annen degradert-men-200-respons i appen allerede har.

**Akseptert bieffekt:** `mergeAoSitesWithPrivateCache()` (som også later som om
en håndfull nærmeste EGNE private lokasjoner utenfor selve bbox-treffet skal
vises — se «extraPrivate» der) kjøres ikke når vi returnerer tidlig her. En egen
privat lokasjon nær et sted der kun det offentlige bbox-svaret var tomt, vises
derfor ikke før en senere panorering treffer et ikke-tomt offentlig svar. Denne
fallbacken er uansett kun et sikkerhetsnett for sites bbox-kallet skulle ha
misset (selve bbox-svaret inneholder normalt allerede alle brukerens sites
innenfor `AUTO_FETCH_RADIUS_M`) — for smalt et hjørnetilfelle til å
rettferdiggjøre en egen, atskilt render-vei for offentlige vs. private
lokasjoner.

## `mergeAoSitesWithPrivateCache` kalles bevisst med `sizeMeters`, ikke `AUTO_FETCH_RADIUS_M`

`renderSites`-kallet bruker `mergeAoSitesWithPrivateCache(bboxSites, center,
sizeMeters)` — IKKE den faste `AUTO_FETCH_RADIUS_M`. Dette tredje argumentet
styrer kun et lite ekstra fallback-søk («egne private lokasjoner bbox-treffet
måtte ha misset», maks 5 nærmeste). Å bruke `AUTO_FETCH_RADIUS_M` her ville
latt dette ekstra søket strekke seg langt utover det brukeren faktisk ba om
på registreringssiden — og ville uansett ikke gitt merverdi, siden `bboxSites`
allerede dekker HELE `AUTO_FETCH_RADIUS_M` for både private og offentlige
lokaliteter (AO returnerer begge deler, se `/api/ao-sites` i CLAUDE.md).

## Lokal cache for bbox-lokaliteter (Espens punkt 4)

`fetchAoSitesCached(lat, lon, radiusMeters)` i `public/js/api.js` legger en
7-dagers localStorage-cache (`ao_bbox_cache_v1`) foran selve AO-kallet, brukt
kun av kartets panorer-og-oppdater.

- **TTL 7 dager**: matcher Espens eget bruksmønster («95 % av tiden på
  Bømlo»). Helt nye OFFENTLIGE AO-lokaliteter er ekstremt sjeldne i en app som
  har eksistert i 15 år — nedsiden ved en lang TTL er derfor liten.
- **Maks 5 innslag** (`BBOX_CACHE_MAX_ENTRIES`): holdt lavt med vilje. Hver
  AO-respons kan inneholde opptil 1000 sites (`maxSites`, se
  `src/api_handlers.py`) med fullt `raw`-objekt hver (polygoner m.m.) — i en
  tett by kan én eneste slik respons bli flere hundre KB. Et par
  favorittsteder er det reelle målet, ikke en flate-cache over hele landet, og
  5 unngår å presse localStorage-kvoten (delt med appens andre cacher).
- **Treffkrav**: et tidligere hentet punkt må ligge innenfor
  `BBOX_CACHE_MATCH_DISTANCE_M` (300 m) fra det nye senteret, OG ha dekket
  minst like stor radius som nå trengs. Siden `map.js` fra v1.53.22 alltid ber
  om samme faste `AUTO_FETCH_RADIUS_M`, er radius-kravet i praksis alltid
  oppfylt for et gjenbesøk — det er kun avstands-kravet (300 m) som avgjør
  cache-treff nå. (Radius-sjekken i seg selv er ikke fjernet — den er fortsatt
  riktig og nødvendig hvis noen andre skulle kalle `fetchAoSitesCached()` med
  varierende radius i fremtiden.)
- **Partisjonert på innlogget AO-brukernavn** (`ao_username`, eller
  `'__anon__'` uten innlogging): selve AO-svaret markerer `isMine` ut fra HVEM
  som spør, ikke bare hvor. Uten dette kunne en innlogging/utlogging eller
  brukerbytte gjenbrukt et cachet svar beregnet for en annen identitet.
- **Cacher aldri et tomt resultat**: av nøyaktig samme grunn som
  render-fiksen over — et tomt svar kan være en maskert, forbigående AO-feil,
  og å cache det ville låst fast en tilfeldig glipp som «bekreftet tomt» i
  opptil 7 dager.

Brukerens EGNE nyopprettede lokasjoner er upåvirket av hele denne cachen,
uansett hvor gammelt et bbox-treff er: `createAoSite()` skriver rett inn i en
helt separat, alltid fersk 24-timers cache (`ao_private_sites`), som slås
sammen med bbox-resultatet ved hver visning.

## En annen, urelatert treghets-kilde: `ensureAoTokens()` (v1.53.20)

Under samme felttesting ble en helt separat, allerede eksisterende bug
oppdaget: `ensureAoTokens()` i `api.js` brukte
`getCachedPrivateSites().length === 0` for å avgjøre om private lokasjoner
trengte å hentes på nytt. Denne sjekken klarer ikke å skille «aldri hentet»
fra «hentet, brukeren har faktisk null private lokasjoner» — for en bruker i
sistnevnte kategori var betingelsen sann FOR ALLTID, og ga et ekte,
ekstra nettverkskall til `/api/ao-private-sites` ved HVER eneste panorering,
uavhengig av bbox-cachen over. Fikset med `hasFreshPrivateSitesCache()`, som
sjekker cache-alder i stedet for listelengde. Se `api.js`.

## Testdekning

- `tests/e2e_playwright/tests/map-viewport-radius.spec.ts` — gulv/tak på
  hente-radius, race-fiksen ved rask A→B-panorering, ingen krasj ved et AO
  500-svar midt i panorering.
- `tests/e2e_playwright/tests/map-bbox-cache.spec.ts` — panorering til samme
  sted to ganger gir kun ett nettverkskall; et tomt AO-svar midt i panorering
  tømmer ikke allerede synlige lokaliteter (regresjonstest for hovedfiksen,
  verifisert til faktisk å feile mot koden fra før denne featuren).
