# Raskere førstegangsinnlasting av forsiden

**Dato:** 2026-11-26
**Status:** Kørettelsen er godkjent av eieren, implementert og testet på
Pi-staging og rullet ut til produksjon sammen med hele v1.66.0 den 2026-11-26.

## Måling

Forsiden til Enkel-AO (`https://ao.efugl.no/`, v1.65.4) ble sammenlignet med
Feltlogg (`https://feltlogg.no/fl/`) i samme Chromium, 390 × 844 piksler.
Fem førstegangsbesøk og fem gjenbesøk per app, uten innlogging, GPS,
nettverks-/CPU-struping eller service worker. Bare forsiden ble besøkt.

Median første besøk:

| Måling | Enkel-AO | Feltlogg |
|---|---:|---:|
| Første HTML-byte | 166 ms | 87 ms |
| Første synlige innhold | 344 ms | 188 ms |
| Nettleserens load-hendelse | 1442 ms | 332 ms |
| Ressurser | 63 | 13 |
| Overført | 387 KiB | 528 KiB |

Enkel-AOs load-hendelse varierte fra 569 til 1526 ms. I tre av fem forsøk
ventet enkelte JavaScript-filer rundt 1,1 sekund på svar. Seks moduler ble
lastet som både versjonert og uversjonert URL. Lite langvarig JavaScript-arbeid
ble observert; mye av forskjellen var venting på ressursene.

En midlertidig nettleservariant med tolv `modulepreload`-lenker ble prøvd uten
serverendring. Tre forsøk per variant ga median load 1451 ms uten og 763 ms
med forhåndslasting. Varianten med forhåndslasting hadde likevel ett forsøk
på 1833 ms. Dette er et lite eksperiment, ikke et løfte om forventet gevinst.

## Forbindelseskø: sterk kandidat til de lange pausene

Produksjonscontaineren rapporterte `ThreadingHTTPServer.request_queue_size = 5`.
Den eksisterende `server.py` setter ikke en større kø for serverinstansen.

Ved kontroll 2026-11-26 kl. 12:47 norsk tid ble tellerne i containerens eget
nettverksnavnerom lest før og etter to vanlige, sekvensielle førstegangsbesøk:

| Måling | Før | Etter |
|---|---:|---:|
| ListenOverflows | 10245 | 10253 |
| ListenDrops | 10245 | 10253 |

Besøkene lastet på henholdsvis 516 og 1379 ms. I det trege besøket ventet
flere JS-filer 1067–1077 ms på første svar. Ingen innlogging, GPS eller
eksterne AO-kall ble startet. Dette støtter hypotesen om at den lille
forbindelseskøen bidrar til forsinkelsen. Vanlig annen trafikk var ikke
isolert bort. Tellerne gjelder nettverksnavnerommet og identifiserer ikke
enkeltkall eller lyttesocket, så sammenhengen må bekreftes ved før/etter-test.

Køen gjelder innkommende TCP-forbindelser som venter på å bli akseptert.
Det er ikke en AO-kvote, en publiseringskø eller et ønske om flere AO-kall.
En større kø endrer ikke antallet ressurser nettleseren ber om.

## Anbefaling

Start med én avgrenset backend-rettelse: en lokal underklasse av
`ThreadingHTTPServer` med `request_queue_size = 128`, brukt der serveren
opprettes. Behold ruting, HTTP-versjon, trådhåndtering og eksterne kall.
Dette glatter ut en kort bølge av forbindelser; det endrer ikke appens
eksisterende begrensninger for eksterne API-er.

128 er et valgt forsøksnivå, ikke en målt dimensjonering. Køen øker ikke
behandlingsevnen. Under en bølge kan flere forbindelser slippe gjennom,
og momentan belastning kan derfor endre seg selv uten flere kall per side.

Denne endringen er mindre og mer direkte knyttet til de observerte pausene
enn en omlegging av frontendens moduler. En større kø løser ikke vedvarende
overbelastning. Hvis målingene ikke forbedres, skal hypotesen revurderes.

### Første leveranse og kontroll

- K1: Kontroller i runtime at den faktiske serverinstansen i `run()` bruker
  den større forbindelseskøen. Kontroller effektiv lyttekø hvis tilgjengelig.
  Eksisterende tester som oppretter standardserveren direkte beviser ikke dette.
- K2: Eksisterende pytest og vitest består.
- K3: Kontroller på Pi-staging med samme kildegrunnlag, frontend og Python-/
  containergrunnlag; bare køinnstillingen skal være forskjellig. Mål fem vanlige
  førstegangsbesøk før og etter, enkelttider, median, antall ettsekundspauser og
  differanse i ListenOverflows/ListenDrops. Produksjon v1.65.4 er ikke direkte
  kontroll for arbeidskopi v1.66.0. Ingen lasttesting mot AO eller Feltlogg.
- K4: Målet er bortfall av gjentatte pauser på rundt ett sekund og ingen
  økning i køtap under prøven. Et bestemt millisekundtall loves ikke.
- K5: Produksjon endres først etter egen godkjenning av resultatet.

Hvis staging-baseline ikke viser forsinkelsen eller køtap, er forsøket
uavklart. Raske besøk etter endringen alene dokumenterer da ingen gevinst.

**Filer:** `server.py`. Ingen frontendendring, versjonsbump eller SW-bump er
nødvendig for denne backend-rettelsen.

## Mulig videre arbeid

Når forbindelseskøen er kontrollert, vurder konsekvente modul-URL-er for å
unngå dobbeltlasting, og forhåndslasting av den kritiske modulkjeden.
Det krever egen vurdering av cache-busting, offlinebruk, delt modul-tilstand
og installerte PWA-er. Det er ikke en del av første leveranse.

## Uavhengig gjennomgang

En fersk reviewer vurderte forslaget som et forsvarlig, lite staging-eksperiment.
Presiseringene om årsakssammenheng, valgt kønivå, identisk sammenligningsgrunnlag,
runtime-kontroll og symptomfri baseline er innarbeidet. Ingen dokumentert gevinst
fra en større kø forelå før forsøket under. Kodeendringen ble deretter gjennomgått
og godkjent for staging uten ytterligere kodefunn.

## Resultat av første leveranse på Pi-staging

Forsøket brukte et fast uttrekk fra commit `d4c0618`, først uendret, deretter med
bare kørettelsen og logging av konfigurert kø. Frontendens filhash, kravfil,
installerte Python-pakker og Python-versjon (3.12.16) var identiske før og etter.
Ingen frontend- eller service worker-endring ble gjort.

Effektiv lyttekø ble lest fra Linux via INET_DIAG i containerens nettverksnavnerom,
ikke bare fra Python-klassens innstilling.

| Måling, fem vanlige førstegangsbesøk | Før | Etter |
|---|---:|---:|
| Effektiv lyttekø | 5 | 128 |
| Median load | 1820 ms | 444 ms |
| Laveste–høyeste load | 1376–1908 ms | 405–751 ms |
| Besøk med ressursventing over 900 ms | 5 av 5 | 0 av 5 |
| Økning i ListenOverflows | 46 | 0 |
| Økning i ListenDrops | 46 | 0 |
| Vellykkede HTML-svar | 5 av 5 | 5 av 5 |
| JavaScript-feil | 0 | 0 |

Enkelttider før: 1908, 1820, 1901, 1439, 1376 ms.
Enkelttider etter: 751, 434, 405, 444, 522 ms.

Medianen sank omtrent 76 prosent i denne prøven. Sammen med bortfallet av
køtap gir resultatet betydelig sterkere støtte til køhypotesen. Fem besøk per
variant er et lite kontrollert driftsforsøk, ikke en garanti for alle nettverk
eller trafikknivåer. Cloudflares cache og vanlig annen trafikk ble ikke isolert.

Begge staging-utrullinger kjørte eksisterende tester: 959 pytest og 624 vitest
bestått. Oppstartsloggen på staging viser konfigurert kø på 128.

## Produksjonsutrulling

Eieren godkjente full utrulling av v1.66.0 og kørettelsen 2026-11-26.
Utrullingen brukte samme faste kodegrunnlag som den vellykkede staging-prøven.
Serverkode, frontend, kravfil, installerte Python-pakker og Python-versjon ble
kontrollert identiske med staging etter utrulling. Produksjonens effektive
lyttekø og oppstartslogg viser begge 128.

Fem vanlige førstegangsbesøk på produksjonsforsiden ga load 790, 457, 551,
463 og 454 ms, median 463 ms. Alle svarte HTTP 200 med v1.66.0, uten
JavaScript-feil eller ressursventing over 900 ms. ListenDrops økte ikke under
målingen. Containeren var frisk uten uventede omstarter, og `/health` svarte
normalt.
