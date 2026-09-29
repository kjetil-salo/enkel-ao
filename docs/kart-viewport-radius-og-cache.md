# Kartets viewport-radius og lokal cache

Hvorfor panorering/zooming på kartet (`map.html`) henter en radius som skalerer
med kartutsnittet i stedet for en fast verdi, hvorfor den likevel har et hardt
tak, og hvorfor et tomt AO-svar aldri får lov til å tømme kartet.

Innført i v1.53.19, på bakgrunn av feedback fra betatester Espen (Messenger,
2026-09-28) og en produkteier-avklaring om overbelastning samme dag.

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

## Radius: viewport-avhengig, men med hardt tak

`computeEffectiveFetchRadiusMeters(center, zoom)` i `public/js/map.js` erstatter
den gamle, faste `sizeMeters`-radiusen (brukerens søkeradius fra
registreringssiden) med en radius beregnet fra selve kartutsnittet:

```
metersPerPixel = 156543.03392 * cos(latitude) / 2^zoom   // Web Mercator, samme formel Leaflet/OSM bruker
radius         = halvDiagonalIPiksler * metersPerPixel
```

Halve **diagonalen** brukes (ikke halve bredden/høyden), slik at hele det
synlige utsnittet — inkludert hjørnene — dekkes av den kvadratiske boksen
`_compute_bbox()` bygger i `src/api_handlers.py`.

Resultatet klippes til:

- **Gulv:** `sizeMeters` — brukerens eksplisitt valgte søkeradius. Panorering
  skal aldri vise FÆRRE lokaliteter enn det man selv ba om.
- **Tak:** `MAX_AUTO_FETCH_RADIUS_M = 3000` — satt lik den eksisterende
  maks-verdien på søkeradius-slideren i `public/index.html` (500 m – 3 km).
  Bevisst valg: en allerede utprøvd, trygg grense i stedet for en ny, uprøvd
  terskel. En høyere verdi ville også gjort det lettere å treffe AOs harde
  `maxSites: 1000`-tak i tette områder (f.eks. Oslo sentrum), som trunkerer
  resultatet stille uten varsel til klienten.

Ingen egen **nedre zoom-sperre** finnes. Det ble vurdert og forkastet til fordel
for et rent tak på selve innhentingen: zoomer man ut til hele Norge, blir det
synlige kartutsnittet stort, men AO-forespørselen strekker seg likevel aldri
lenger enn 3 km rundt kartsenteret — resten av det synlige kartet vises bare
tomt. Enklere enn en egen terskel, og løser produkteierens krav uten noen
UI for «zoom inn for å laste mer».

## Zoom uten panorering teller også

Før v1.53.19 sammenlignet `handleMapMoveEnd()` kun *avstand* fra forrige
hentepunkt (`lastFetchedCenter`). En ren zoom (samme senter) ga avstand 0 og
trigget derfor aldri noe nytt kall — trolig hovedårsaken til Espens punkt 3.
`lastFetchedZoom` spores nå ved siden av senteret, og en endring i zoom
(`zoomChanged`) trigger refetch uavhengig av om senteret har flyttet seg.

Terskelen for hvor mye man må bevege seg før et nytt kall er verdt det
(`minRefetchDistance = max(150, effectiveRadius / 4)`) skalerer nå med den
faktiske radiusen i bruk, ikke lenger en fast verdi satt ved sideinnlasting.

## Race-tilstand ved rask panorering

`lastFetchedCenter`/`lastFetchedZoom` settes **optimistisk** til det nye målet
FØR selve AO-kallet starter, ikke først ved suksess. Uten dette kunne en rask
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
er ferdig hentet helt til brukeren beveger seg langt nok bort og tilbake, eller
zoomer. Selvkorrigerende innen én ekstra bevegelse, og for usannsynlig (krever
treg nettverk + feil i akkurat denne rekkefølgen) til å rettferdiggjøre
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
tomt svar. Bokføringen (`lastFetchedCenter`/`lastFetchedZoom`) reverteres
**bevisst ikke** her (i motsetning til ved en ekte feil): et tomt svar
behandles som et gyldig, «ferdig sjekket» resultat for akkurat dette punktet,
på samme måte som resten av appen allerede stoler på en degradert-men-200
respons som sannheten. Et første forsøk med revert her hamret et nytt AO-kall
for hver ~150 m panorering over et genuint tomt område (kyst, hav, fjell) —
stikk i strid med prosjektets «External API Ethics»-prinsipp om aldri å hamre
på artsobservasjoner.no. Prisen: en maskert, forbigående AO-feil hentes ikke på
nytt før brukeren beveger seg vekk og tilbake, eller zoomer — samme forsinkelse
enhver annen degradert-men-200-respons i appen allerede har.

**Akseptert bieffekt:** `mergeAoSitesWithPrivateCache()` (som også later som om
en håndfull nærmeste EGNE private lokasjoner utenfor selve bbox-treffet skal
vises — se «extraPrivate» der) kjøres ikke når vi returnerer tidlig her. En egen
privat lokasjon nær et sted der kun det offentlige bbox-svaret var tomt, vises
derfor ikke før en senere panorering treffer et ikke-tomt offentlig svar. Denne
fallbacken er uansett kun et sikkerhetsnett for sites bbox-kallet skulle ha
misset (selve bbox-svaret inneholder normalt allerede alle brukerens sites
innenfor `effectiveRadius`) — for smalt et hjørnetilfelle til å rettferdiggjøre
en egen, atskilt render-vei for offentlige vs. private lokasjoner.

## `mergeAoSitesWithPrivateCache` kalles bevisst med `sizeMeters`, ikke `effectiveRadius`

`renderSites`-kallet bruker `mergeAoSitesWithPrivateCache(bboxSites, center,
sizeMeters)` — IKKE den nye, viewport-avhengige `effectiveRadius`. Dette
tredje argumentet styrer kun et lite ekstra fallback-søk («egne private
lokasjoner bbox-treffet måtte ha misset», maks 5 nærmeste). Å bruke
`effectiveRadius` her ville latt dette ekstra søket vokse i takt med
utzooming, langt utover det brukeren faktisk ba om på registreringssiden — og
ville uansett ikke gitt merverdi, siden `bboxSites` allerede dekker HELE
`effectiveRadius` for både private og offentlige lokaliteter (AO returnerer
begge deler, se `/api/ao-sites` i CLAUDE.md).

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
  minst like stor radius som nå trengs. En cachet liste hentet med mindre
  radius enn det som nå kreves, inneholder ikke nødvendigvis alt som skal
  vises, og brukes derfor ikke.
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

## Testdekning

- `tests/e2e_playwright/tests/map-viewport-radius.spec.ts` — zoom uten
  panorering trigger refetch innenfor gulv/tak; race-fiksen ved rask A→B-
  panorering; ingen krasj ved et AO 500-svar midt i panorering.
- `tests/e2e_playwright/tests/map-bbox-cache.spec.ts` — panorering til samme
  sted to ganger gir kun ett nettverkskall; et tomt AO-svar midt i panorering
  tømmer ikke allerede synlige lokaliteter (regresjonstest for hovedfiksen,
  verifisert til faktisk å feile mot koden fra før denne featuren).
