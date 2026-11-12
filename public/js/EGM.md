# public/js — frontend-moduler

## Overview

Hele klientlogikken til Enkel-AO: 38 rene ES6-moduler uten rammeverk, uten
byggesteg og uten transpilering. Filene lastes direkte av nettleseren slik de
ligger her. Katalogen har ingen underkataloger.

Modulene deler seg i fem lag:

- **Inngangsskript per side** — `main.js` (`index.html`), `map.js` (`map.html`),
  `fellestur.js` (`fellestur.html`). Disse eksporterer nesten ingenting; de eier
  tilstand og kobler DOM mot resten.
- **Lagring og tilstand** — `storage.js` er eneste eier av localStorage for
  arbeidslista, `offline-db.js` eier IndexedDB og nettverksmodus,
  `fellestur-sync.js` eier det delte turspeilet, `visits.js` modellerer begrepet
  *besøk*.
- **Eksterne kall** — `api.js` er eneste klient mot appens egen Python-backend
  (`/api/...`, som i sin tur proxyer Artsobservasjoner.no og Nominatim).
- **Ren logikk, dekket av enhetstester** — `species-matcher.js`,
  `kart-visning.js`, `bilde-editor.js`, `offline-area.js`, `datetime-helpers.js`,
  `header-plass.js`, `visits.js`, `utils.js`. Disse er framework- og DOM-frie og
  er stedet å legge ny regellogikk.
- **UI-komponenter** — `ui.js`, `observations.js`, `observation-commit.js`,
  `autocomplete.js`, `species-search.js`, `edit-modal.js`, `photo-picker.js`,
  `bilde-rediger-modal.js`, `share.js`, `export-operations.js`, `rarity.js`,
  `news-splash.js`, `first-run-hint.js`, `celebrate.js`, `coobserver-picker.js`,
  `form-state.js`, `ao-observer-autocomplete.js`, `migration-banner.js`,
  `theme.js`.

Appen er en PWA som skal virke i felt uten nett. Det preger nesten alle
avgjørelsene under: tre nettverksmodi, lokale cacher med eksplisitte TTL-er, og
en gjennomgående regel om at et degradert eller tomt eksternt svar aldri får
lov til å slette noe brukeren alt ser.

## Interface

### Inngangsskript (eksporterer nesten ingenting)

- `main.js` er inngangen for `index.html`. Eier `appState` og `dom`
  [main.js:appState], [main.js:dom], bygger callback-broen
  [main.js:callbacks] og kjører oppstartssekvensen [main.js:init] fra
  `DOMContentLoaded`. Eneste `export` er [main.js:updateOfflineModeUI]; i
  tillegg legges [main.js:updateMapBtnVisibility] på `window`.
- `map.js` er inngangen for `map.html`, et toppnivå imperativt skript uten
  eksporter. Sentrale lokale funksjoner: [map.js:startMapUI], [map.js:initMap],
  [map.js:renderSites], [map.js:handleMapMoveEnd], [map.js:anvendVisning],
  [map.js:setVisning], [map.js:createCachedTileLayer],
  [map.js:getDynamicFallbackTile], [map.js:recenterToGps],
  [map.js:updateUserPositionOnMap], [map.js:enterPinDropMode],
  [map.js:addNewSiteMarker], [map.js:startOfflineAreaDownload],
  [map.js:unionRectangles]. Kun [map.js:selectLocation] eksponeres globalt
  (kalles fra inline `onclick` i en Leaflet-popup).
- `fellestur.js` er inngangen for `fellestur.html` og har ingen `export` i det
  hele tatt — hele filen er et selvutførende skript. Sentrale funksjoner:
  [fellestur.js:hentTur], [fellestur.js:lastOgVisAktivTur],
  [fellestur.js:renderBliMedSkjema], [fellestur.js:renderObsListe],
  [fellestur.js:sendTilArbeidsliste], [fellestur.js:startPolling].

### Lagring og tilstand

- [storage.js:saveObservations] / [storage.js:loadObservations] — eneste
  godkjente vei inn og ut av arbeidslista. `save` returnerer `true`/`false`,
  detaljert feil i [storage.js:lastSaveError] (live binding).
- [storage.js:appendSentBatch] / [storage.js:loadSentBatches] — sendt-logg,
  avgrenset av [storage.js:SENT_MAX_DAYS] og [storage.js:SENT_MAX_OBS].
- [storage.js:loadMedobs], [storage.js:saveMedobs],
  [storage.js:defaultCoObservers] — medobservatører.
- [storage.js:saveActivityPills] / [storage.js:loadActivityPills] med
  [storage.js:ACTIVITY_SHORT_SUGGESTIONS] — konfigurerbare aktivitetspills.
- [storage.js:saveAoSearchRadius] / [storage.js:loadAoSearchRadius],
  [storage.js:saveLocationSortMode] / [storage.js:loadLocationSortMode],
  [storage.js:saveAoDirectAutoClear] / [storage.js:loadAoDirectAutoClear],
  [storage.js:saveNynorskArtsnavn] / [storage.js:loadNynorskArtsnavn] —
  innstillinger.
- [storage.js:saveLastKnownPosition] / [storage.js:loadLastKnownPosition] med
  [storage.js:LAST_KNOWN_POSITION_KEY] — siste kjente posisjon.
- [storage.js:speciesDisplayName] — visningsnavn på art (nynorsk/bokmål).
- [offline-db.js:getNetworkMode], [offline-db.js:setNetworkMode],
  [offline-db.js:cycleNetworkMode], [offline-db.js:normalizeNetworkMode],
  [offline-db.js:isOnlineMode], [offline-db.js:isHybridMode],
  [offline-db.js:isOfflineMode], [offline-db.js:setOfflineMode] — tre-veis
  nettverksmodus over [offline-db.js:NETWORK_MODES] og
  [offline-db.js:DEFAULT_NETWORK_MODE].
- [offline-db.js:initNetworkModeAndServiceWorker],
  [offline-db.js:syncNetworkModeToServiceWorker] — registrerer service
  workeren og holder modusen i synk med den.
- [offline-db.js:openOfflineDb], [offline-db.js:saveOfflineAreaLocations],
  [offline-db.js:saveOpportunisticOfflineLocations],
  [offline-db.js:getAllOfflineLocations],
  [offline-db.js:getOfflineLocationsInBounds],
  [offline-db.js:getOfflineLocationsNear],
  [offline-db.js:fetchLocationsWithNetworkMode],
  [offline-db.js:getOfflineAreas], [offline-db.js:deleteOfflineArea],
  [offline-db.js:getOfflineStorageStats], [offline-db.js:syncOfflineAreas],
  [offline-db.js:clearOfflineDatabase], [offline-db.js:clearAllOfflineData],
  [offline-db.js:clearAppCachesPreservingMapTiles],
  [offline-db.js:formatAreaId] — offline lokalitetslager.
- [visits.js:getPlaceKey], [visits.js:createVisitId],
  [visits.js:getObservationPlaceKey], [visits.js:getObservationVisitKey],
  [visits.js:findOpenVisitId], [visits.js:resolveVisitIdForNewObservation],
  [visits.js:setVisitLocked], [visits.js:getVisitTimeSpan],
  [visits.js:isVisitLocked], [visits.js:visitExists] — besøksmodellen.
- [fellestur-client.js:hentAktivFellestur],
  [fellestur-client.js:settAktivFellestur],
  [fellestur-client.js:forlatFellestur], [fellestur-client.js:hentMittNavn],
  [fellestur-client.js:settMittNavn] — hvilken fellestur enheten er med i.
- [fellestur-sync.js:lastSpeil], [fellestur-sync.js:lagreSpeilOgSynk],
  [fellestur-sync.js:synk], [fellestur-sync.js:diffObservasjoner],
  [fellestur-sync.js:flettServerListe],
  [fellestur-sync.js:oppdaterSpeilFraServer],
  [fellestur-sync.js:hentSpeilVersjon],
  [fellestur-sync.js:hentTurMedobservatorer] — speil og diff-synk.

### Eksterne kall

- [api.js:fetchAoSites], [api.js:fetchAoSitesByBounds],
  [api.js:fetchAoSitesCached] — AO-lokaliteter, siste med lokal bbox-cache.
- [api.js:getCachedPrivateSites], [api.js:hasFreshPrivateSitesCache],
  [api.js:fetchAndCachePrivateSites], [api.js:createAoSite] — brukerens egne
  private lokaliteter.
- [api.js:hasActiveAoLogin], [api.js:ensureAoTokens],
  [api.js:loggInnMedLagretLegitimasjon] — AO-sesjon.
- [api.js:searchSpecies], [api.js:loadActivities], [api.js:logPageView].

### Ren logikk (hovedsakelig dekket av `tests/unit/`)

- [species-matcher.js:searchSpecies], [species-matcher.js:calculateSpeciesScore],
  [species-matcher.js:MATCH_SCORES], [species-matcher.js:sjeldenhetsgruppe],
  [species-matcher.js:funntall], [species-matcher.js:VANLIG_GRENSE],
  [species-matcher.js:UVANLIG_GRENSE], [species-matcher.js:isNynorskLanguage],
  [species-matcher.js:getSpeciesNameNno], [species-matcher.js:getSpeciesNameNob],
  [species-matcher.js:getSpeciesLatinName],
  [species-matcher.js:extractSubspeciesEpithet],
  [species-matcher.js:isGenericSubspeciesName],
  [species-matcher.js:translateDedicatedSubspeciesToNynorsk],
  [species-matcher.js:deriveSubspeciesNynorskName],
  [species-matcher.js:deriveSubspeciesBokmalName],
  [species-matcher.js:isSubspeciesItem], [species-matcher.js:isHybridItem].
- [kart-visning.js:VISNINGER], [kart-visning.js:nesteVisning],
  [kart-visning.js:knappetekst], [kart-visning.js:knappetittel],
  [kart-visning.js:visNavn], [kart-visning.js:visLokaliteter],
  [kart-visning.js:lesLagretVisning], [kart-visning.js:tilLagretVerdi] — ren
  tilstandsmaskin for kartets tre-trinns visningsknapp.
- [bilde-editor.js:lagBildeEditor] med metodene [bilde-editor.js:settBilde],
  [bilde-editor.js:settEksponering], [bilde-editor.js:settSkygger],
  [bilde-editor.js:settZoom], [bilde-editor.js:vedVisningsendring],
  [bilde-editor.js:tilbakestill], [bilde-editor.js:hentResultat],
  [bilde-editor.js:hentUtsnitt], [bilde-editor.js:harBilde]; rene funksjoner
  [bilde-editor.js:eksponeringsfaktor], [bilde-editor.js:skyggestyrke],
  [bilde-editor.js:skyggemaske], [bilde-editor.js:anvendJusteringer],
  [bilde-editor.js:anvendEksponering], [bilde-editor.js:zoomOmrade],
  [bilde-editor.js:klemUtsnitt], [bilde-editor.js:visningsmaal].
- [offline-area.js:boundsAreaKm2], [offline-area.js:clampTilAreal],
  [offline-area.js:latLonToTileXY], [offline-area.js:formatKartverketTileUrl],
  [offline-area.js:calculateTilesForBounds],
  [offline-area.js:downloadTilesInBatches],
  [offline-area.js:metersToLatDegrees], [offline-area.js:metersToLonDegrees],
  [offline-area.js:getBoundsDimensionsMeters],
  [offline-area.js:createCenteredBounds], [offline-area.js:createExtentBounds],
  [offline-area.js:moveBoundsToCenter],
  [offline-area.js:resizeBoundsFromCorner],
  [offline-area.js:filterSitesInBounds], [offline-area.js:determineAreaName],
  [offline-area.js:isOthersPrivateSite],
  [offline-area.js:dropOthersPrivateSites], [offline-area.js:mergeCachedSites],
  [offline-area.js:filterSitesForOfflineDownload],
  [offline-area.js:computeDynamicFetchBounds],
  [offline-area.js:fetchDynamicViewportSites], samt grensekonstantene
  [offline-area.js:MAX_OFFLINE_AREA_KM2],
  [offline-area.js:MAX_OFFLINE_AREA_SIDE_M],
  [offline-area.js:MIN_OFFLINE_AREA_SIDE_M],
  [offline-area.js:OFFLINE_ZOOM_LEVELS], [offline-area.js:MAX_TILE_BATCH_SIZE],
  [offline-area.js:MAP_TILE_CACHE_NAME],
  [offline-area.js:KARTVERKET_TOPO_URL_TEMPLATE].
- [utils.js:haversine], [utils.js:toLocalISOString].
- [datetime-helpers.js:isoToDate], [datetime-helpers.js:isoToTime],
  [datetime-helpers.js:toLocalIso], [datetime-helpers.js:updateDateTimeInIso].
- [header-plass.js:TRINN], [header-plass.js:finnTrinn], [header-plass.js:passer],
  [header-plass.js:tilpassHeader].
- [version.js:VERSION] — appens versjonsstreng.

### UI-komponenter

- [ui.js:showToast], [ui.js:flashButton], [ui.js:setStatus],
  [ui.js:setLocationStatus], [ui.js:showOfflineNotAvailableDialog],
  [ui.js:DEFAULT_TOAST_DURATION_MS], [ui.js:MODE_SPLASH_DURATION_MS]; `ui.js`
  re-eksporterer også [utils.js:haversine] for bakoverkompatibilitet.
- [observations.js:renderObservations], [observations.js:toCsv].
- [observation-commit.js:commitObservation],
  [observation-commit.js:renderActivityPills],
  [observation-commit.js:setupPillsDragToScroll].
- [location.js:initLocation], [location.js:setAoSiteSuggestions],
  [location.js:mergeAoSitesWithPrivateCache], [location.js:openMapPage],
  [location.js:openMap], [location.js:openMapWithTwoPoints],
  [location.js:initCreateSite], [location.js:updateCreateSiteBtnVisibility],
  [location.js:isAoLoggedIn], [location.js:isPrivateSite],
  [location.js:getSiteLabel], [location.js:getSiteMunicipality],
  [location.js:shouldShowOthersPrivateSites], [location.js:DEFAULT_MAP_CENTER].
- [autocomplete.js:initAutocomplete],
  [autocomplete.js:sortLocationAutocompleteResults].
- [species-search.js:fetchResults], [species-search.js:renderResults],
  [species-search.js:chooseItem], [species-search.js:enrichAoSpeciesResults],
  [species-search.js:updateSubtaxaCheckboxState].
- [species_offline.js:loadOfflineSpecies],
  [species_offline.js:searchOfflineSpecies],
  [species_offline.js:getNynorskByLatin], [species_offline.js:getSpeciesMeta],
  [species_offline.js:findBokmalByNynorskTerm] (pluss re-eksport av hele
  matcher-API-et).
- [export-operations.js:handleDirectSend], [export-operations.js:handleExport],
  [export-operations.js:handleCopy], [export-operations.js:handleCopyAndOpen],
  [export-operations.js:handleClear], [export-operations.js:oppdaterAoKoHint];
  [export-operations.js:_parseSseEvents] og
  [export-operations.js:_visOfflineInnsendingBekreftelse] er eksportert for
  enhetstester.
- [share.js:openShareDialog], [share.js:nyesteDagsObservasjoner],
  [share.js:hentMineDelinger], [share.js:glemDeling].
- [rarity.js:checkRarity], [rarity.js:getCachedRarity],
  [rarity.js:setCachedRarity].
- [edit-modal.js:openEditModal].
- [photo-picker.js:initPhotoPicker], [photo-picker.js:downscaleImage].
- [bilde-rediger-modal.js:apneBildeRedigering].
- [ao-observer-autocomplete.js:attachAoObserverAutocomplete].
- [coobserver-picker.js:initCoObserverPicker].
- [form-state.js:updateSectionStates], [form-state.js:updateFieldHighlights],
  [form-state.js:pulseSearchFieldAndFocus].
- [celebrate.js:celebrateRareFind].
- [news-splash.js:initNewsSplash], [news-splash.js:CURRENT_NEWS_SPLASH],
  [news-splash.js:hasReadNews], [news-splash.js:markNewsRead],
  [news-splash.js:STORAGE_KEY].
- [first-run-hint.js:initFirstRunHint], [first-run-hint.js:shouldShowHint],
  [first-run-hint.js:HINT_ID], [first-run-hint.js:STORAGE_KEY].
- `theme.js` og `migration-banner.js` eksporterer ingenting; de kjører som
  IIFE-er ved innlasting. `theme.js` setter temaklasser fra
  [theme.js:THEMES], `migration-banner.js` setter inn et migreringsbanner
  [migration-banner.js:bar].

### Søskenkataloger

`public/js` har ingen underkataloger. Modulene her leser data fra
`public/data/` (bl.a. `norske_arter.json` og `activities.json`) og bilder fra
`public/img/`; ingen av de to katalogene har egen kontraktfil, siden de ikke
inneholder kildekode.

## Invariants

### Versjonering og cache-busting

- **Interne imports med `?v=` er en hard avhengighet, ikke pynt.** `main.js`
  importerer de fleste nabomodulene med en eksplisitt versjonsstreng
  (`'./api.js?v=v1.60.12'`, se [main.js:appState]-filens importblokk), det samme
  gjør [map.js:startMapUI]-filens importer. Grunnen: Cloudflare kan holde en
  gammel kopi i opptil fire timer, og mangler den en nylig lagt til navngitt
  eksport, kaster modullastingen `SyntaxError` som stopper HELE det importerende
  skriptet — ikke bare den ene funksjonen. Legges en ny eksport til i en modul,
  må alle versjonerte importer av den bumpes i samme slengen. `visits.js` og
  `share.js` importeres bevisst uten versjon.
- [version.js:VERSION] er `'v1.60.12'`, men `index.html` har egne inline
  versjonskonstanter som ikke leser denne — begge må oppdateres.

### Lagring: nøkler, TTL-er og tak

- Arbeidslista ligger under nøyaktig `fugleobservasjoner_v1`
  [storage.js:saveObservations], pakket som `{version: 1, observations}`.
- [storage.js:saveObservations] er **ikke-kastende**: den returnerer `true` ved
  vellykket `setItem` og `false` ved ethvert unntak (typisk full kvote på iOS
  Safari med store bilder). Teknisk årsak leses fra
  [storage.js:lastSaveError] rett etter en `false`-retur. Hver side som lagrer
  observasjoner må importere nettopp denne funksjonen — en lokal kopi med samme
  navn ga en kritisk regresjon der returverdien alltid var `undefined`.
- Sendt-loggen ligger under `sent_observations_v1` og beskjæres på BÅDE
  [storage.js:SENT_MAX_DAYS] (7) og [storage.js:SENT_MAX_OBS] (200).
- Øvrige eksakte nøkler: `medobs_list_v1` [storage.js:saveMedobs],
  `ao_search_radius_v1` (lest verdi klemmes til 500–3000 m)
  [storage.js:loadAoSearchRadius], `activityPills_v1` med maks 8 pills og
  `short` trimmet til 5 tegn [storage.js:saveActivityPills],
  `location_sort_mode_v1` (kun `'standard'`/`'avstand'`)
  [storage.js:loadLocationSortMode], `ao_direct_auto_clear_v1`
  [storage.js:saveAoDirectAutoClear], `nynorsk_artsnavn_v1`
  [storage.js:saveNynorskArtsnavn], `ao_last_known_position_v1`
  [storage.js:LAST_KNOWN_POSITION_KEY], `fellesturMirror_v1`
  [fellestur-sync.js:lastSpeil], `aktivFellestur_v1` og `fellesturMittNavn_v1`
  [fellestur-client.js:hentAktivFellestur], `ao_rarity_cache_v1` med 180 dagers
  TTL [rarity.js:setCachedRarity], `myShares_v1` og `shareDisplayName_v1`
  [share.js:hentMineDelinger], `mapShowLabels_v1` [map.js:setVisning].
- `nynorsk_artsnavn_v1` påvirker KUN [storage.js:speciesDisplayName], aldri hva
  som sendes til AO — [observations.js:toCsv] bruker alltid `taxonName`.
- En posisjon med `isFallback === true` eller ikke-finite koordinater lagres
  aldri [storage.js:saveLastKnownPosition].
- [storage.js:defaultCoObservers] returnerer alltid eksakt 10 elementer.

### Degraderte svar får aldri slette noe

Dette er det gjennomgående mønsteret i hele katalogen, og den enkeltregelen det
er lettest å bryte ved uhell:

- Et tomt AO-svar tømmer ALDRI de tegnede lokalitetene på kartet:
  `if (bboxSites.length === 0) return;` står FØR `renderSites()` kalles, både i
  oppstartshentingen og i panorer-oppdateringen [map.js:handleMapMoveEnd]. Et
  tomt svar er umulig å skille fra en forbigående AO-feil, siden backend
  degraderer eksterne feil til en tom HTTP 200-liste.
- Et tomt resultat caches ALDRI i bbox-cachen [api.js:fetchAoSitesCached] — det
  ville låst fast glippen i opptil syv dager.
- Et svar med `needsLogin` eller `degradert` skrives ALDRI til
  `ao_private_sites` [api.js:fetchAndCachePrivateSites].
- Et kø-antall på `null` betyr «vet ikke», ikke «tom»: det caches aldri og vises
  aldri [export-operations.js:oppdaterAoKoHint].
- Brytes SSE-strømmen uten et bekreftet `done`-event, beholdes lista alltid
  [export-operations.js:handleDirectSend].

### Cacher: eksakte TTL-er og treffkrav

- `ao_private_sites`: 24 timer for et ikke-tomt resultat, men bare 10 minutter
  når lista er tom [api.js:PRIVATE_SITES_EMPTY_TTL] — ellers ville ett degradert
  svar stengt brukeren ute av egne lokaliteter i et døgn.
- [api.js:hasFreshPrivateSitesCache] finnes nettopp for å skille «aldri hentet»
  fra «hentet, brukeren har faktisk null private lokaliteter». Begge gir tom
  liste fra [api.js:getCachedPrivateSites], så en `.length === 0`-sjekk var sann
  for alltid og ga et ekte ekstra nettverkskall ved hvert
  [api.js:ensureAoTokens]-kall — altså ved hver panorering på kartet.
- `ao_bbox_cache_v1`: 7 dager, maks 5 innslag [api.js:fetchAoSitesCached].
  Et treff krever at den cachede radiusen er MINST like stor som den som nå
  trengs, og at avstanden er under 300 m. Cachen er partisjonert på innlogget
  AO-brukernavn, med `'__anon__'` som anonym partisjon — uten det kunne en
  innlogging gjenbrukt et svar med feil `isMine`-merking.
- [api.js:createAoSite] skriver den nye lokasjonen rett inn i
  `ao_private_sites` fra opprettelsessvaret, uten refetch fra AO. Uten dette var
  nyopprettede private lokasjoner usynlige i opptil et døgn.
- Artssøk-cache: prefiks `species_`, TTL 1 år [api.js:searchSpecies].
- Flis-cachen heter nøyaktig `enkel-ao-kartverket-tiles-v1`
  [offline-area.js:MAP_TILE_CACHE_NAME] og er den ENESTE cachen
  [offline-db.js:clearAppCachesPreservingMapTiles] bevarer.

### Kart

- Visningsknappens tilstandsmaskin er ren og bor i `kart-visning.js`; `map.js`
  eier bare koblingen mot Leaflet. Sykelen er fast Alt → Skjul navn → Skjul alt
  → Alt [kart-visning.js:nesteVisning], og en ukjent lagret verdi faller ALLTID
  til `'alt'`, aldri til et tomt kart.
- Tilstanden `'ingen'` lagres ALDRI — [kart-visning.js:tilLagretVerdi] svarer
  `null`. Den er et zoom-hjelpemiddel, ikke en innstilling; åpnet kartet seg
  tomt neste gang, ville det lest som en feil.
- [kart-visning.js:lesLagretVisning] er bakoverkompatibel med den gamle
  to-tilstands-verdien `'0'`.
- [kart-visning.js:visNavn] er sann KUN i `'alt'`;
  [kart-visning.js:visLokaliteter] er usann KUN i `'ingen'` — to uavhengige
  grader, ikke samme bit.
- [map.js:anvendVisning] setter tooltip-tilstanden ETTER at laggruppa er lagt
  tilbake på kartet: Leaflet åpner en permanent tooltip på nytt av seg selv ved
  `addTo`, så motsatt rekkefølge fikk navnene til å dukke opp uoppfordret.
- [map.js:anvendVisning] løfter polygonene (`sistePolygonLag`) på nytt HVER gang
  gruppa legges tilbake, ikke bare i [map.js:renderSites] — `removeLayer` river
  SVG-ene ut av DOM-en, og `addTo` legger dem tilbake i innsettingsrekkefølge.
- Auto-hentingsradiusen er FAST per kartsesjon:
  `AUTO_FETCH_RADIUS_M = max(3000, sizeMeters)` [map.js:AUTO_FETCH_RADIUS_M].
  En tidligere viewport-avhengig radius gjorde et lite zoom-skifte til en
  cache-miss, så et gjenbesøk «der man nettopp var» likevel ga et ekte AO-kall.
- [map.js:handleMapMoveEnd] setter `lastFetchedCenter` OPTIMISTISK før kallet og
  reverterer kun ved ekte feil og kun hvis forsøket fortsatt er det nyeste.
  `fetchSeq`-telleren forkaster i tillegg svar fra et eldre, tregere kall.
  Debounce er 600 ms og minsteavstand `max(150, AUTO_FETCH_RADIUS_M / 4)`.
- Lokaliteter brukeren selv har pin-droppet i økten ligger utenfor
  `siteLayerGroup`, hoppes over i [map.js:renderSites] via
  `manuallyPlacedSiteIds`, og blir stående gjennom «skjul alt» — de er svaret på
  en handling han nettopp gjorde.
- [map.js:START_VIEW_GUARD_MS] (5000 ms) tvinger kartet tilbake til zoom 15 så
  lenge brukeren ikke har rørt det; `userHasMovedMap` settes én gang og slår av
  all automatisk re-sentrering permanent for resten av økten.
- [map.js:rememberBounded] holder flis-cachene i minnet bundet; bare
  FULLSTENDIGE fallback-fliser huskes, en flis med hull regnes alltid ut på nytt.
- [map.js:oppdaterTomtKartVarsel] viser «tomt kart»-varselet KUN når null ekte
  fliser kom inn — delvis dekning er ikke en feil.
- [map.js:unionRectangles] må kjøres på lagrede områder før det mørke overlayet
  tegnes, fordi Leaflets `evenodd`-fyllregel ellers teller overlappende hull to
  ganger.
- Pin-drop og offline-områdevalg er gjensidig utelukkende
  [map.js:enterPinDropMode].

### Nettverksmodus og offline

- Gyldige modi er nøyaktig `['online', 'hybrid', 'offline']` med `'hybrid'` som
  standard; alt annet normaliseres [offline-db.js:normalizeNetworkMode].
- [offline-db.js:getNetworkMode] migrerer den gamle `offline_mode_v1`-verdien
  `'1'` til `network_mode_v1`, slik at alle sider og service workeren leser
  samme lagrede verdi.
- Service workeren må ALLTID registreres med nøyaktig
  [offline-db.js:SERVICE_WORKER_URL] (samme streng som `index.html` bruker) — en
  avvikende URL får nettleseren til å bytte ut workeren og miste modusen.
- I `'offline'` gjøres ALDRI nettverkskall: strengt cache-only i
  [offline-db.js:fetchLocationsWithNetworkMode] og i
  [offline-area.js:fetchDynamicViewportSites]. I `'hybrid'` beviser et
  enkelttreff nær et punkt IKKE at hele den nye radiusen er dekket.
- Andres private lokasjoner lagres aldri uten at `showPrivateSitesOnMap` er
  `'1'`; [offline-area.js:dropOthersPrivateSites] er siste skanse uansett
  kallvei [offline-db.js:saveOfflineAreaLocations].
- IndexedDB heter nøyaktig `enkel_ao_offline_db` v1 med store-ene `areas`
  (keyPath `areaId`) og `locations` (keyPath `key`, indekser `areaId`/`siteId`)
  [offline-db.js:openOfflineDb]. Cachen har ingen TTL — bare en eksplisitt
  brukerhandling tømmer den [offline-db.js:clearOfflineDatabase].
- Offline-områdets reelle tak er AREAL, ikke sidelengde:
  [offline-area.js:MAX_OFFLINE_AREA_KM2] = 250 km², med sidene mellom 250 m og
  50 000 m. [offline-area.js:clampTilAreal] krymper bredde og høyde
  PROPORSJONALT, så formen brukeren dro opp beholdes.
- Kun [offline-area.js:OFFLINE_ZOOM_LEVELS] (`[12, 15]`) lastes faktisk ned.
  [offline-area.js:downloadTilesInBatches] venter på hver pulje før neste —
  ingen ubegrenset parallellitet, batch klemt til maks 10.
- [offline-area.js:KARTVERKET_TOPO_URL_TEMPLATE] bruker rekkefølgen
  `/{z}/{y}/{x}.png` (Kartverket WMTS), ikke standard `{z}/{x}/{y}`.
- [offline-area.js:computeDynamicFetchBounds]: er synlig bredde eller høyde
  ≥ 20 km, avbrytes henting helt; over 10 km hentes en streng 10×10 km-boks.
- Nedlasting er sperret i streng offline-modus
  [map.js:startOfflineAreaDownload], og `isDownloadingArea` hindrer
  dobbeltkjøring.

### Besøk («visit») og etterregistrering

- [visits.js:getPlaceKey] gir `placeId` forrang over stedsnavn; manglende navn
  gir den faste nøkkelen `'name:uten-stedsnavn'`.
- Observasjoner uten eksplisitt `visitId` får en `'legacy:'`-prefikset nøkkel
  [visits.js:getObservationVisitKey], så gamle data fortsatt grupperes riktig.
- Et besøk er låst kun når det har minst én observasjon OG samtlige har
  `visitLocked` [visits.js:isVisitLocked] — et tomt besøk er aldri låst.
- [visits.js:findOpenVisitId] vurderer kun det NYESTE besøket per sted.
- ↩-knappen i gruppeoverskriften muterer ikke `appState`; den dispatcher
  `CustomEvent('obs:bruk-lokalitet')` på `document`
  [observations.js:renderObservations], og lytteren i
  [main.js:setupEventListeners] setter `appState.etterregVisitKey`.
- Så lenge `etterregVisitKey` er satt, arver en ny observasjon besøkets
  tidsspenn OG dets `visitLocked` [observation-commit.js:commitObservation] —
  uten arvet lås ville et låst besøk stille låst seg opp igjen.
- **Fremtids-valideringen kjører ETTER tidsoverstyringen**, ikke før: det er
  tidene som faktisk lagres som skal valideres
  [observation-commit.js:commitObservation].
- `etterregVisitKey` nullstilles kun av [main.js:avsluttEtterregistrering], og
  implisitt hvis besøket ikke lenger finnes.

### Publisering til AO

- Eksakte endepunkt: `POST /api/ao-login`, `POST /api/ao-import-stream`,
  `POST /api/ao-queue-count`, `POST /api/log-export`
  [export-operations.js:handleDirectSend].
- SSE-fasene som gjenkjennes er nøyaktig `importing`, `uploading-images`,
  `publishing`, `done`, `error` [export-operations.js:handleDirectSend].
- Sendt-loggen skrives FØR «tøm lista»-spørsmålet: `appendSentBatch` kalles
  synkront, og først deretter planlegges tømme-dialogen
  [export-operations.js:handleDirectSend]. Motsatt rekkefølge mistet kvitteringen.
- En observasjon med tidspunkt frem i tid blokkerer HELE sendingen før noe
  nettverkskall gjøres [export-operations.js:handleDirectSend] — AO ville
  importert, men aldri publisert den.
- Allerede sendte observasjoner (`sentTs`) utløser en dublettadvarsel med
  valgene «kun nye», «alt» og «avbryt».
- Kø-cachens levetid er nøyaktig 120 000 ms, og i streng offline-modus gjøres
  ingen bakgrunnskall [export-operations.js:oppdaterAoKoHint].
- [observations.js:toCsv] har fast kolonnerekkefølge (54 datakolonner), og eneste
  AO-godkjente koding for boolske felt er den eksakte strengen `'true'` —
  `'1'`/`'X'`/`'Ja'` virker ikke konsekvent. `';'` og tab i tekstfelt erstattes
  med `','` for ikke å knekke det tab-separerte formatet. Klokkeslett skrives
  kun når det er forskjellig fra `00:00`.

### Fellestur

- Koden valideres med `/^[0-9]{5}$/` — nøyaktig fem siffer
  [fellestur.js:renderBliMedSkjema].
- En avsluttet tur er KUN et varsel, ikke en lås: turen forblir åpen og skrivbar
  [fellestur.js:oppdaterAvsluttetVarsel].
- [fellestur.js:sendTilArbeidsliste] varsler gruppa FØR `forlatFellestur()`
  kalles, slik at lagringsbryteren fortsatt peker på turens speil mens varselet
  sendes.
- [fellestur-sync.js:oppdaterSpeilFraServer] har en versjonsvakt: er versjonen
  endret siden forespørselen gikk ut, forkastes serversvaret stille.
- [fellestur-sync.js:synk] kjører aldri parallelt med seg selv; en ny runde køes.
- Pollingintervallet er 12 000 ms både i [fellestur.js:startPolling] og
  [main.js:pollFellestur], og pollingen hopper over når `document.hidden`.
- Publiser/kopier/del/tøm-knappene sperres når en fellestur er aktiv, uavhengig
  av antall observasjoner, fordi lista er delt
  [main.js:oppdaterInnsendingssperreForFellestur].

### Bilderedigering

- Eksponeringen er fotografisk, ikke lineær: `2^(trinn/100)`
  [bilde-editor.js:eksponeringsfaktor] — ±100 er ett blenderstrinn.
- Forhåndsvisningen og eksporten kjører SAMME pikselløkke
  [bilde-editor.js:anvendJusteringer], så forhåndsvisningen lyver ikke om hva
  som faktisk lastes opp.
- [bilde-editor.js:hentResultat] regner ALLTID fra originalbildet, aldri fra
  visningslerretet, så oppløsningen er uavhengig av modalens størrelse.
- Skyggeløftet bruker masken `(1 − L)³` med Rec. 601-luminans
  [bilde-editor.js:skyggemaske], multiplikativt og kun oppover
  ([bilde-editor.js:MAKS_SKYGGELOFT] = 1,2). En helt svart piksel forblir svart
  med vilje — et løftet svartpunkt er nettopp det som gråvasker et bilde.
- Lerretet får ALDRI en fast pikselhøyde; [bilde-editor.js:settVisning] setter
  `style.height = 'auto'`, ellers forvrenges bildet når CSS krymper bredden.
- Koordinatmappingen kompenserer for CSS-nedskalering
  [bilde-editor.js:bildePerCss] — uten den glir beskjæringsrammen fra fingeren
  på smal skjerm.
- Zoom inn på utsnittet skjer KUN ved `pointerup`
  [bilde-editor.js:sluttDra], aldri underveis i et dra: endret skala midt i et
  dra ville flyttet bildet under en finger som står stille.
- Redigering skjer alltid på det ALLEREDE nedskalerte bildet (1600 px langside,
  JPEG q0,85) [photo-picker.js:downscaleImage], så en tur innom redigeringen er
  ikke et skjult kvalitetstap.
- [bilde-rediger-modal.js:apneBildeRedigering] bygger DOM-laget kun én gang i
  `document.body`, i stedet for å kreve markup på hver side.
- Escape håndteres med `stopPropagation` i CAPTURE-fasen
  [bilde-rediger-modal.js:apneBildeRedigering] — uten det ville ETT
  Escape-trykk lukket både redigeringslaget og modalen under.
- [photo-picker.js:initPhotoPicker] svelger `dragover`/`drop` på HELE
  dokumentet mens velgeren er aktiv; bommer brukeren på sonen, ville nettleseren
  ellers åpnet bildet i fanen, og han mistet både siden og bildet.

### Deling

- «Dagens funn» betyr nyeste observasjonsdato i lista, ikke kalenderdagen
  [share.js:nyesteDagsObservasjoner] — viktig ved etterregistrering.
- Observasjoner med `hideUntil` filtreres ut og kan aldri deles
  [share.js:openShareDialog].
- Nedskaleringstrinnene er i eksakt rekkefølge 800 px/q0,55 → 640/0,4 →
  480/0,32 → 400/0,28, og stopper ved første resultat under
  [share.js:SHARE_PHOTO_TARGET_CHARS] (68 000 tegn, ~50 KB rådata).
- Samme `slug` flyttes til toppen og overskrives i `myShares_v1` i stedet for å
  dupliseres [share.js:huskDeling]; lista trimmes til 20.
- Endepunkter: `POST /api/share`, `POST /api/share-update`,
  `POST /api/share-delete` [share.js:openShareDialog].

### Artssøk

- [species-matcher.js:MATCH_SCORES] er `Object.freeze`-t. Et latinsk treff gir
  alltid lavere poeng (maks 150) enn ethvert norsk navnetreff (minst 200).
- Sjeldenhetsgrensene er [species-matcher.js:VANLIG_GRENSE] = 1000 og
  [species-matcher.js:UVANLIG_GRENSE] = 100; ukjent funntall regnes som vanlig
  [species-matcher.js:sjeldenhetsgruppe].
- [species-search.js:fetchResults] spør ALLTID den lokale offline-lista først og
  går til AO bare hvis den gir null treff. AO-søket har hard timeout 10 000 ms.
- **Merk en reell inkonsistens:** uten eksplisitt språkargument defaulter
  [species-matcher.js:isNynorskLanguage] til nynorsk (`true`), mens
  [species_offline.js:getDefaultUserLanguage] defaulter til bokmål (`'nb'`) når
  `nynorsk_artsnavn_v1` ikke er satt.
- [species-matcher.js:searchSpecies] MUTERER input-objektene i `speciesList`
  (setter `nameNno`/`nynorsk`/`nameNob` der de mangler) — den er altså ikke en
  ren funksjon, tross navnet.
- Offline-lista mangler AOs `taxonId` [species_offline.js:buildCandidateEntry].
  Derfor kan sjeldenhetsvarselet aldri virke med den: [rarity.js:checkRarity]
  kaller `resetRarity` og hopper over sjekken når `taxonId` mangler.

### Sjeldenhetsvarsel

- Endepunktet er `GET /api/ao-rarity?taxonId=…&siteId=…&date=…`
  [rarity.js:checkRarity].
- Kun et svar med feltet `warning` gir synlig boks; `information` alene holdes
  tilbake [rarity.js:showRarityBox].
- Debounce er 400 ms, og hver sjekk får et sekvensnummer som forkaster svar hvis
  art, sted eller modus er endret i mellomtiden [rarity.js:checkRarity]. Alle
  AO-kall køes sekvensielt [rarity.js:enqueueRarityFetch].
- Uinnlogget bruker gir stille no-op — ingen fetch [rarity.js:checkRarity].
- [edit-modal.js:openEditModal] sletter `obs.rarityWarning` hvis art, lokasjon
  eller dato er endret ved lagring — det gamle AO-svaret er da ikke lenger til å
  stole på.

### Øvrige

- [celebrate.js:celebrateRareFind] kalles fra
  [observation-commit.js:commitObservation] i try/catch, og har selv try/catch
  rundt lyden: en kosmetisk feil skal aldri kunne ta med seg lagringen av
  observasjonen. Flagget `celebratedRareFind` undertrykker samtidig den vanlige
  registreringstoasten, som kolliderte visuelt med banneret. `prefers-reduced-motion`
  gir banner uten konfetti.
- [main.js:harHattLokalitetsforslag] er et enveis-flagg som aldri settes tilbake
  til `false` — ellers blinket radius- og sorteringsradene bort ved et tomt
  AO-svar.
- [main.js:setupOfflineDisabledInterceptors] sjekker `isOfflineMode()` LIVE ved
  hvert klikk, ikke en verdi cachet ved registreringstidspunktet.
- [main.js:hentLokaliteterForRadius] fanger radiusen i en lokal variabel FØR det
  asynkrone kallet og bruker `radiusHentSeq` til å forkaste utdaterte svar.
- Tredje argument til `onPositionUpdate(position, sites, radiusUsed)` i
  [location.js:initLocation] er radiusen som FAKTISK ble brukt i nettopp det
  kallet, ikke en senere lest live-verdi — [main.js:handlePositionUpdate] cacher
  resultatet sammen med den, og fallbacken krever at radius, alder (2 min) og
  avstand alle stemmer.
- Dropdown-sorteringen i [location.js:setAoSiteSuggestions] er fast: egne
  private (`isMine`) → superlokasjon → offentlig før privat → nærmest først.
  Maks 40 rader. `showPrivateSitesOnMap` er av som standard
  [location.js:shouldShowOthersPrivateSites].
- Autocomplete-ikonene betyr ⭐ = egen lokasjon, 👤 = andres private;
  superlokasjon vises uten ikon men i fet skrift
  [autocomplete.js:initAutocomplete]. Sortering `isMine` → `isSuper` →
  ikke-privat → avstand [autocomplete.js:sortLocationAutocompleteResults].
- [header-plass.js:TRINN]-rekkefølgen er en bevisst prioritering: appnavnet
  ofres FØR nettverksordet, fordi nettverksmodus er driftsinformasjon.
  [header-plass.js:passer] bruker 1 px toleranse for avrunding ved zoom/DPR.
- [datetime-helpers.js:isoToTime] tolker eksakt `00:00` som «tid ikke satt» og
  returnerer tom streng.
- [coobserver-picker.js:initCoObserverPicker] håndhever maks 10 medobservatører
  per observasjon.
- [news-splash.js:CURRENT_NEWS_SPLASH] har id
  `'november-2026-sikkerhet-og-offline-v1'` og viser maks fire punkter
  [news-splash.js:MAX_VISIBLE]. Et bilde må ligge i `public/img/` OG i
  `STATIC_ASSETS` i `../sw.js`, ellers er nyheten uten bilde offline. En
  `error`-lytter fjerner `<img>` hvis fila mangler.
- [first-run-hint.js:initFirstRunHint] venter via `MutationObserver` til en
  synlig `.news-splash` er fjernet, og viser hintet kun når det ikke er lest OG
  brukeren har null observasjoner [first-run-hint.js:shouldShowHint].
- `theme.js` faller tilbake til `'light'` ved ukjent verdi, ikke `'dark'`
  [theme.js:THEMES]. `migration-banner.js` kjører KUN på `*.fly.dev`
  [migration-banner.js:bar].

## Side Effects

### localStorage (eksakte nøkler)

- Skriver/leser: `fugleobservasjoner_v1`, `sent_observations_v1`,
  `medobs_list_v1`, `ao_search_radius_v1`, `location_sort_mode_v1`,
  `ao_direct_auto_clear_v1`, `nynorsk_artsnavn_v1`, `activityPills_v1`,
  `ao_last_known_position_v1` [storage.js:saveObservations]; leser også
  legacy-nøklene `activityPillCount` og `mapData`
  [storage.js:loadLastKnownPosition].
- `ao_tokens`, `ao_private_sites`, `ao_bbox_cache_v1`, `species_*`, `ao_username`
  [api.js:fetchAoSitesCached]; `ao_username`/`ao_password` leses også av
  [location.js:isAoLoggedIn], [map.js:hasAoCredentials] og
  [fellestur.js:erInnloggetMotAo].
- `network_mode_v1`, `offline_mode_v1`, `showPrivateSitesOnMap`
  [offline-db.js:setNetworkMode], [offline-db.js:readShowOthersPrivate].
- `aktivFellestur_v1`, `fellesturMittNavn_v1`
  [fellestur-client.js:settAktivFellestur]; `fellesturMirror_v1`
  [fellestur-sync.js:skrivSpeil].
- `myShares_v1`, `shareDisplayName_v1` [share.js:huskDeling].
- `ao_rarity_cache_v1`, `ao_site_areas_v1` [rarity.js:saveRarityCache].
- `mapData`, `lastMapCenter_v1`, `mapShowLabels_v1`, `selectedLocation`,
  `selectedLocationId` [map.js:selectLocation], [map.js:updateUserPositionOnMap];
  `mapData` skrives av [location.js:openMapPage].
- `afterRegistrationMode` [main.js:updateModeUI], `lastActivity`
  [observation-commit.js:commitObservation], `locationStatus`
  [ui.js:setLocationStatus], `ao_theme` [theme.js:THEMES],
  `migrationBannerDismissedUntil` [migration-banner.js:bar],
  `forceOfflineSpecies` [species-search.js:fetchResults], `ao_area`
  [export-operations.js:handleDirectSend].
- Cookies: `enkelAoNewsRead` [news-splash.js:markNewsRead] og
  `enkelAoHintRead` [first-run-hint.js:markHintSeen], begge `Max-Age=31536000`,
  `Path=/`, `SameSite=Lax`, med localStorage som fallback.

### Nettverk (eksakte stier)

- Egen backend: `GET /api/species` [api.js:searchSpecies],
  `GET /api/ao-sites` [api.js:fetchAoSites] (og med `north/south/east/west` i
  [api.js:fetchAoSitesByBounds]), `GET /api/ao-private-sites`
  [api.js:fetchAndCachePrivateSites], `POST /api/ao-login`
  [api.js:loggInnMedLagretLegitimasjon], `POST /api/ao-create-site`
  [api.js:createAoSite], `POST /api/logview` [api.js:logPageView],
  `GET /data/activities.json` [api.js:loadActivities] og
  [edit-modal.js:loadActivitiesOnce], `GET /data/norske_arter.json`
  [species_offline.js:loadOfflineSpecies], `GET /api/ao-autocomplete`
  [autocomplete.js:fetchAutocomplete], `POST /api/ao-search-observers`
  [ao-observer-autocomplete.js:searchObservers], `GET /api/ao-rarity`
  [rarity.js:checkRarity], `POST /api/ao-queue-count` og
  `POST /api/ao-import-stream` og `POST /api/log-export`
  [export-operations.js:handleDirectSend], `POST /api/share` /
  `/api/share-update` / `/api/share-delete` [share.js:openShareDialog],
  `GET|POST /api/fellestur`, `/api/fellestur-bli-med`,
  `/api/fellestur-oppdater` [fellestur.js:hentTur] og
  `POST /api/fellestur-sync` [fellestur-sync.js:utforSynk].
- Direkte eksterne kall: kartfliser fra
  `https://cache.kartverket.no/v1/wmts/1.0.0/{topo|topograatone}/...`
  [offline-area.js:KARTVERKET_TOPO_URL_TEMPLATE] og
  `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
  [map.js:OSM_URL_TEMPLATE], samt en enkelt OSM-flis som `<img src>` i
  [location.js:initCreateSite].
- AO-auth sendes som headerne `X-AO-Login-Token`, `X-AO-Auth-Cookie`,
  `X-AO-User-Id`, `X-AO-Username` [api.js:fetchAoSites]. Ved offline-godkjent
  sending settes i tillegg `X-Allow-Offline-Network: '1'`
  [export-operations.js:handleDirectSend].

### Nettleser-API-er

- **IndexedDB**: `enkel_ao_offline_db` v1, store-ene `areas` og `locations`
  [offline-db.js:openOfflineDb].
- **Cache API**: `enkel-ao-kartverket-tiles-v1`
  [offline-area.js:downloadTilesInBatches],
  [offline-db.js:getOfflineStorageStats]; alle andre cacher slettes av
  [offline-db.js:clearAppCachesPreservingMapTiles].
- **Service worker**: `navigator.serviceWorker.register(SERVICE_WORKER_URL)` og
  `postMessage({type: 'SET_NETWORK_MODE'})`
  [offline-db.js:syncNetworkModeToServiceWorker].
- **Geolocation**: `getCurrentPosition`/`watchPosition`/`clearWatch` i
  [location.js:initLocation] og [map.js:recenterToGps]; `watchPosition`
  ryddes automatisk når nøyaktigheten er ≤ 20 m og ved `beforeunload`.
- **Clipboard**: `writeText` i [export-operations.js:copyToClipboard],
  [share.js:visResultat], [fellestur.js:renderAktivTur]; `read()` i
  [photo-picker.js:initPhotoPicker].
- **Web Audio**: ny `AudioContext` som lukkes etter 1000 ms
  [celebrate.js:playChime].
- **Canvas / FileReader**: [photo-picker.js:downscaleImage],
  [bilde-editor.js:hentResultat], [share.js:downscaleForShare].
- **Filnedlasting**: Blob + `URL.createObjectURL` → `fugleobservasjoner.csv`
  [export-operations.js:handleExport].
- **Navigasjon**: `window.location.href = '/'` [map.js:selectLocation] og
  [fellestur.js:sendTilArbeidsliste], `'/map.html'` [location.js:openMapPage],
  `window.open` til Apple/Google Maps [location.js:openMap],
  [location.js:openMapWithTwoPoints] og til
  `https://www.artsobservasjoner.no/ImportSighting`
  [export-operations.js:handleCopyAndOpen], `history.replaceState`
  [fellestur.js:settKodeIUrl], `window.location.reload()` fra
  tomt-kart-varselet [map.js:hentFlisVarselEl].

### Egne hendelser

- Dispatcher: `CustomEvent('obs:bruk-lokalitet')`
  [observations.js:renderObservations], `CustomEvent('lokalitet:valgt')`
  [main.js:varsleLokalitetValgt], `CustomEvent('obs:extra-felt-nullstilt')`
  [observation-commit.js:commitObservation],
  `CustomEvent('network_mode_changed')` og `CustomEvent('offline_mode_changed')`
  [offline-db.js:setNetworkMode], `CustomEvent('ao_tokens_updated')`
  [api.js:fetchAoSites] og [autocomplete.js:fetchAutocomplete].
- Lytter: `'network_mode_changed'`, `'storage'`, `'pageshow'` og
  `'DOMContentLoaded'` i [main.js:updateOfflineModeUI]-filens
  modulnivå-lyttere; `'storage'` også i `offline-db.js` for å fange
  modusendringer fra andre faner [offline-db.js:initNetworkModeAndServiceWorker].
- Globale `document`-lyttere: `keydown` i capture-fasen
  [bilde-rediger-modal.js:apneBildeRedigering], `paste` og
  `dragenter`/`dragover`/`drop` [photo-picker.js:initPhotoPicker], `keydown`
  for Escape [edit-modal.js:ensureInit], [map.js:closeDownloadModal],
  `visibilitychange` [fellestur.js:startPolling].
- `MutationObserver` på `document.body` [first-run-hint.js:initFirstRunHint];
  `ResizeObserver` i [news-splash.js:createNewsSplash] og
  [first-run-hint.js:showHint].

### DOM

Alle UI-modulene muterer DOM direkte, uten virtuelt DOM-lag. De tyngste er
[observations.js:renderObservations] (bygger hele observasjonstabellen på nytt),
[map.js:renderSites] (tømmer og bygger Leaflet-laggruppene på nytt),
[fellestur.js:renderObsListe] (`app.innerHTML =` per render) og
[ui.js:showToast] (gjenbruker `#registered-toast`).

## Verification

- Kjør: `npm test`

`npm test` fra **repo-roten** kjører vitest-suiten i
`tests/unit/*.test.js` (jsdom-miljø, se
`vitest.config.js`). Samme kommando kjørt fra `tests/e2e_playwright/` betyr noe
helt annet (Playwright) — kjør den fra roten.

Full dekning for endringer her krever alle tre suitene:

```bash
npm test                                    # vitest, fra repo-roten
python3 -m pytest --maxfail=3               # backend
cd tests/e2e_playwright && npm test         # Playwright E2E
```
