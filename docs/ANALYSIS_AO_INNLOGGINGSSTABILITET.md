# Stabil innloggingsvisning og sesjonsfornyelse

**Opprettet:** 2026-11-20
**Status:** Forslag til gjennomgang. Ingen funksjonell endring er implementert.

## Bakgrunn og avgrensning

Innlogging på profilsiden kan lykkes mens hovedsiden fortsatt ser utlogget ut.
Refresh kan få riktig status tilbake. Under samme økt ble også manglende CSS
observert. Servermålingene etter hendelsen viste friske containere og komplette
stilark; årsaken til CSS-hendelsen er fortsatt ukjent. Den inngår ikke i denne
innloggingsrettelsen.

Integrasjonen bruker AOs ordinære innloggingsskjema, sesjonscookie og roterende
«husk meg»-token. Serveren prøver cookie-forlengelse, token-fornyelse og deretter
lagret passord med tokenbinding. Dette er ikke en egen OIDC-innlogging for appen.
Tidligere sikkerhetsrettelser og rotasjonsregler i `ao-token-autentisering.md`
skal beholdes. Ingen endring i selve publiseringen av observasjoner.

## Bekreftede funn

Funnene er gjenskapt med eksisterende kode og lokale mock-data. De beviser
svakheter i koden, men fastslår ikke hvilken som utløste den opprinnelige hendelsen.

1. **Gammel status i en annen fane.** Playwright: åpne hovedsiden, logg inn på
   profilsiden i en annen fane og gå tilbake. Hovedsiden viser fortsatt «Logg inn».
   Refresh viser initialene. `main.js` lytter til `storage`, men oppdaterer bare
   nettverksmodus, ikke AO-status. `pageshow` er allerede håndtert; den håndteringen
   skal beholdes og testes.
2. **Midlertidig feil sletter sesjonen.** Et kartsvar med `authRequired` etterfulgt
   av simulert nettbrudd under gjeninnlogging gjør at `fetchAoSites()` sletter
   `ao_tokens`. Samme sletting finnes i `fetchAoSitesByBounds()`. Innloggingens
   boolske resultat skiller ikke avvist passord fra nettfeil.
3. **Forsinket svar overskriver nyere sesjon.** Start et kartkall, lagre en nyere
   sesjon for samme konto og lever deretter det gamle svaret med fornyede tokens.
   De nyere tokenene overskrives. Kontobyttevern finnes enkelte steder, men verner
   ikke mot en nyere innlogging for samme konto. Felles tokenhjelper mangler
   kilde-sesjon. `rarity.js` og `createAoSite()` har også tokenlagring som mangler
   det eksisterende kontobyttevernet.
4. **Parallelle fornyelser samordnes ikke.** Tre samtidige kall til
   `loggInnMedLagretLegitimasjon()` starter tre HTTP-kall. To samtidige kall til
   backendens `_ensure_auth()` kan begge starte `_full_relogin()` med samme token.
   Cachelåsen beskytter ordboktilgang, ikke hele fornyelsen.
5. **Nettfeil tolkes som utløpt.** `_is_cookie_expired()` returnerer `True` ved
   tidsavbrudd. En ukjent tilstand kan dermed starte full gjeninnlogging.
6. **Refresh opphever en lokal feilpause.** Ett mislykket oppslag på private
   lokaliteter sperrer nye oppslag i fem minutter i modulminnet. Det gjelder også
   et kort nettbrudd; refresh nullstiller pausen. Dette påvirker lokaliteter,
   ikke selve innloggingsmerket, og må beskrives som det.

Statusmerket i `main.js` bygger på lagret brukernavn og passord, mens
`hasActiveAoLogin()` også godtar tokenpar. Ingen av disse beviser at AO-sesjonen
fortsatt er gyldig. Et nytt AO-kall ved hvert sidebesøk vil gi mer trafikk og er
ikke anbefalt; bruk siste kjente resultat fra kall appen allerede gjør.

`updateAoDirectVisibility()` henter også meldingsteller og kø-hint. Den må ikke
kobles direkte til flere hendelser som om den bare tegnet lokal status. Ren
visningsoppdatering må skilles fra disse nettverksbivirkningene.

HTTP 401 fra vår egen innloggingsrute er heller ikke entydig passordavvisning:
manglende CSRF-token gir `ValueError`, og alle slike feil mappes til 401. En
endelig utloggingsbeslutning krever derfor en mer presis feilkontrakt.

Passordfallbacket krever et tidligere bundet tokenavtrykk. Roterte tokens og
tokenet fra backendens passordfallback bindes ikke automatisk til dette oppslaget.
Hele fallbackkjeden er derfor ikke alltid tilgjengelig etter rotasjon. Dette er
en eksisterende begrensning; sikkerhetsbindingen skal ikke svekkes i rettelsen.

## Alternativer og anbefaling

**Bare flere forsøk:** liten endring, men løser ikke gammel visning, sletting eller
overskriving. Kan forsterke parallelle innlogginger og bruke samme roterende token
flere ganger.

**Rett visning og bevar data først, samordne fornyelse deretter:** anbefalt.
Første leveranse oppdaterer visningen lokalt når lagret innlogging endres og
bevarer sesjonen ved usikker feil. Den endrer ikke AOs fornyelsesmekanisme.
Neste leveranse kan skille bekreftet avvisning fra midlertidig feil, dele
fornyelsesresultater og avvise gamle svar før lagring. Ekstra forsøk vurderes
først etter dette: også et lesekall til vår backend kan fornye tokenet hos AO.
Det skal ikke innføres periodisk polling, automatisk ny publisering eller blind
gjentakelse av brukt token.

## Faser og akseptansekriterier

### F1: Minste første rettelse — lokal visning og bevarte sesjonsdata

**Filer:** `public/js/api.js`, `public/js/main.js` og relevante tester.

- K1: Innlogging og utlogging i en annen fane oppdaterer hovedsidens status uten
  refresh. Tilbakeknapp og gjenopptakelse av en fane dekkes også. Denne lokale
  visningsoppdateringen starter ingen kall til AO, meldingsteller eller kø-hint.
- K2: Nettfeil, 502/503/504 og uforståelig svar sletter aldri lagret sesjon.
  Dagens generelle 401 er heller ikke tilstrekkelig grunnlag for sletting.
- K5: Behold dagens betydning av lagret innlogging; ikke innfør nye tilstander
  som lover fersk AO-bekreftelse. AO3-bekreftelse krever ikke AO2-tokenpar.
  Offline-modus starter ingen nye automatiske nettverkskall. Brukerens eksplisitte
  utlogging og kontobytte skal fortsatt fjerne gammel sesjon.

**Tester:** vitest for bevarte sesjonsdata ved feil i begge kartfunksjonene;
Playwright med mock for profil → hovedside, tilbakeknapp, autofyll og to faner,
inkludert utlogging og fravær av ekstra AO-kall ved ren visningsoppdatering.
Eventuell ny UI-tekst legges i begge eksisterende språkfiler.

### F2: Vern alle tokenlagringer og samordne fornyelse

**Filer:** `src/api_handlers.py`, relevante eksisterende svar i `server.py`,
`public/js/api.js`, `public/profil.html` og alle kallsteder som lagrer fornyede
tokens, inkludert autocomplete, sjeldenhetsvarsel og opprettelse av lokalitet.

- K3: Et gammelt svar kan verken overskrive eller slette en nyere sesjon, også
  ved ny innlogging med samme brukernavn. Kontobytte og utlogging vernes fortsatt.
- K4: Samtidige fornyelsesbehov i samme side deler ett pågående forsøk. Samordningen
  må ikke omgås av at `api.js` importeres med forskjellige URL-er.
- K6: Backend skiller gyldig, bekreftet utløpt og ukjent sesjon. Tidsavbrudd alene
  utløser ikke passordinnlogging eller utloggingsbeskjed.
- K7: Samtidige kall med identiske sesjonsbevis deler fornyelsen og resultatet.
  Nøkkelen må inkludere sesjonsbevis, aldri bare brukernavn eller bruker-ID.
  Venting, levetid og antall oppføringer begrenses; feil cacher ikke en varig
  utlogging. Ingen global lås holdes under nettverkskall. Resultatet må også kunne
  gjenbrukes av et senere kall etter tapt HTTP-svar, ikke bare av samtidige kall.

**Tester:** mockede timeout-/HTTP-svar, samtidige backend-kall, forsinkede svar,
tokenrotasjon, konto-/sesjonsisolasjon og tapt svar etter vellykket fornyelse.
Regresjonstester skal bevare tokenbinding og eksisterende AO3-reserve.

### F3: Vurder avgrensede ekstra forsøk etter F2

Denne fasen anbefales ikke som første leveranse og krever egen vurdering av
trafikk og usikre utfall.

- K8: Egnede kall får høyst ett kontrollert ekstra forsøk ved forbigående
  nettfeil/502/503/504. Bekreftet avvist legitimasjon, 403 og 429 gir ingen
  automatisk løkke. Dagens generelle 401 skal ikke automatisk gjentas eller
  tolkes som sikkert utløpt sesjon; presis klassifisering må komme først.
  Token-fornyelse gjentas ikke blindt etter et usikkert utfall; et brukt token
  må aldri behandles som om det fortsatt er ubrukt. Dette gjelder også et
  lesekall som internt fornyer sesjonen: F2s gjenbruk etter tapt svar må være
  verifisert før automatisk gjentakelse. Publisering gjentas ikke.
- K9: Feilpause for private lokaliteter skiller kortvarig transportfeil fra
  vedvarende feil. Ny vellykket innlogging eller gjenopprettet nett kan oppheve
  pausen, med samordning og frekvensbegrensning.

**Tester:** mockede feilsekvenser med kontroll av antall kall, samlet venting og
at publisering aldri gjentas. Ingen lasttest mot AO.

## Uavhengig gjennomgang

En fersk reviewer kontrollerte forslaget mot koden. Gjennomgangen avdekket
nettverksbivirkningene ved statusoppdatering, den tvetydige 401-kontrakten,
manglende vern ved flere tokenlagringer og risikoen ved å gjenta lesekall som
roterer tokens. Funnene ble kontrollert mot kildekoden og innarbeidet.
Anbefalingen er derfor avgrenset til F1 som første leveranse.

## Utrulling og observasjon

Alle faser krever testing på Pi-staging. Frontend krever ny service worker-cache
og konsekvent cache-busting ved release; versjonsnummer bumpes av eieren etter
prosjektets PR-regel. En endring av cache-URL må ikke lage to uavhengige
sesjonskoordinatorer i samme side.

Kjør pytest, vitest og relevante mockede Playwright-tester før utrulling.
Logger skal kunne skille midlertidig feil, avvist innlogging, delt fornyelse og
forkastet gammelt svar uten å logge passord eller rå tokens. Produksjon krever
godkjenning av denne nye rettelsen; tidligere deploygodkjenning gjaldt changeloggen.
