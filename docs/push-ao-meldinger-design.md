# Push ved nye meldinger på Artsobservasjoner — designutkast

Status 2026-11-25: utkast, ikke bygget. Bygger på push-infrastrukturen fra
v1.66.0 (`docs/push-varsler.md`) og meldingstellingen fra v1.62
(`docs/ao-meldinger.md`).

## Målet

En bruker som har slått på «Meldinger fra Artsobservasjoner» på `/varsler.html`,
får et push-varsel når det kommer en ny melding eller et nytt varsel hos AO, også
når appen er lukket. Varselet åpner `/artsobservasjoner.html`, der meldingene
allerede vises.

## Det vi har fra før

- **Telle-kallet** `GET /Notification/NewNotifications` (`fetch_new_notifications`
  i `src/ao_import_httpx.py`). Det er billig, rent JSON, uten CSRF, og AO kaller
  det selv på hver side. Det har **ingen bieffekt**. Det gjør derimot
  `/Notification/History`, som markerer varsler som lest, og som en
  bakgrunnsjobb aldri skal røre.
- **Push** med emner per abonnement. En ny type er `ao-meldinger` i
  `KJENTE_EMNER` og `VARSELTYPER`.

## Det vanskelige: serveren trenger en AO-sesjon per bruker, uten brukeren

Telle-kallet krever en gyldig `.ASPXAUTHNO`. I dag har serveren bare en sesjon
mens brukeren selv bruker appen.

**Fella: logintokenet roterer.** AO gir ett logintoken nøyaktig én stille
gjenoppliving (korreksjon 6 i `docs/ao-token-autentisering.md`). Lar vi
bakgrunnsjobben gjenopplive med *enhetens* logintoken, bruker serveren opp
enhetens billett. Neste gang enheten selv trenger den, feiler det, og den faller
tilbake til passord. Jobben ville altså ødelagt innloggingen på telefonen i det
stille. **Bakgrunnsjobben kan ikke dele token-kjede med noen enhet.**

### Anbefaling: en egen AO-sesjon for vaktjobben

1. Når brukeren slår på «Meldinger fra AO», gjør serveren **én egen innlogging**
   for vaktjobben, mens brukeren er til stede og har samtykket. AO gir da et eget
   logintoken og en egen `.ASPXAUTHNO`, uavhengig av enhetene.
2. Vaktjobben lagrer **sin egen** token-kjede per abonnent: `authCookie`,
   `loginToken` og sist sette tellinger.
3. Hver runde kaller telle-kallet med sin egen cookie. Svarer AO med en fornyet
   cookie (sliding expiration), lagres den. Er sesjonen død, gjenopplives den med
   **vaktjobbens eget** logintoken, og det roterte tokenet lagres.
4. Ryker kjeden likevel, sendes **ett** push: «Logg inn på nytt for fortsatt å få
   varsel om meldinger». Vakten settes på pause til brukeren slår den på igjen.
   Passordet brukes **aldri** uten at brukeren er til stede.

Alternativet er å la jobben logge inn med det lagrede passordet hver gang
sesjonen dør. Det er enklere og mer robust, men serveren bruker da passord helt
på egen hånd. `credentials.json` er bevisst bygget slik at passordet *bare*
utleveres til en klient som viser fram sitt eget token (korreksjon 4), og dette
alternativet ville brutt med den tanken. Det anbefales ikke.

## Når varsles det

- Vakten lagrer sist sette `nyeMeldinger` og `nyeVarsler` per abonnent.
- Det sendes push bare når summen **øker**. Uendret gir ingenting. Synker den
  (brukeren har lest), oppdateres bare grunnlinjen.
- Første runde etter påslag setter bare grunnlinjen. Gamle uleste meldinger gir
  ikke et varsel i det man slår funksjonen på.
- Teksten er bare en telling, for eksempel «2 nye meldinger på
  Artsobservasjoner». Innholdet hentes ikke i bakgrunnen.
- `tag: 'ao-meldinger'`, så et nytt varsel erstatter det forrige på telefonen i
  stedet for å stable dem.

## Hvor ofte, og hvem kjører det

- **Bakgrunnstråd i serverprosessen.** Samme mønster som
  `arbeidsliste-rydding` i `server.py`. Den deler database og kode, og trenger
  verken en ny container eller en vertscron. Den startes bare når
  `AO_MELDINGSVAKT=1`, slik at staging og lokal utvikling ikke poller AO uten
  at vi vil det.
- **Hvert 15. minutt, kl. 06–23.** Med 50 abonnenter blir det ~200 lette
  GET-kall i timen, spredd jevnt med litt tilfeldig forskyvning per bruker. Det
  er mindre enn én aktiv bruker gjør i AOs eget grensesnitt («External API
  Ethics»).
- Én runde om gangen, sekvensielt, med pause mellom brukerne. Feil hos AO gir
  «vet ikke» (`None`). Da endres hverken grunnlinjen eller noe varsles.

## Data som lagres (nytt, sensitivt)

Ny tabell `ao_meldingsvakt` i `stats.db`: `endepunkt` (kobling til
push-abonnementet), `ao_brukernavn`, `auth_cookie`, `login_token`,
`sist_meldinger`, `sist_varsler`, `sist_sjekket_ts`, `pause_grunn`.

Sesjonscookie og logintoken gir tilgang til brukerens AO-konto. De ligger i
samme volum som `credentials.json` (der passordene allerede ligger), så
risikonivået på disk endres ikke vesentlig. Raden slettes når brukeren slår av,
og når push-tjenesten svarer 410.

## Det som må måles før koding (med testkontoen `kjetil-test`)

**Målt 2026-11-25 (måling 3 + utløp):** to innlogginger etter hverandre gir to
ulike `.ASPXAUTHNO` og to ulike logintokens. Den første sesjonen svarer fortsatt
gyldig på telle-kallet etter at den andre er laget. **En ekstra innlogging
påvirker altså ikke en eksisterende sesjon.** Kontroll: en ugyldig cookie gir
`None`, ikke 0/0, så et 0/0-svar betyr faktisk «innlogget». `.ASPXAUTHNO` er en
sesjonscookie uten `expires`, så levetiden styres av AOs server og må måles
over tid. Logintokenet har `expires` ett år fram. Måling 1 og 2 (C pinges hvert
15. min, D1–D4 står urørt 30/60/120/240 min) ble startet samme dag.


1. **Fornyer telle-kallet sesjonen?** Kommer `Set-Cookie: .ASPXAUTHNO` på
   `NewNotifications` når cookien nærmer seg utløp? Hvis ja, holder 15-minutters
   polling sesjonen i live for alltid, og gjenoppliving blir et sjeldent unntak.
2. **Hvor lenge lever en `.ASPXAUTHNO` uten bruk?** Det avgjør om 15 minutter er
   innenfor.
3. **Påvirker en ekstra innlogging enhetenes sesjoner?** Antakelsen er at AO
   tillater flere samtidige sesjoner per konto. Det må bekreftes, ellers kaster
   vaktjobben brukeren ut av telefonen.

## Besluttet (Kjetil, 2026-11-25)

- **A: Egen sesjon for vaktjobben.** Passordet brukes aldri uten at brukeren er
  til stede.
- **Grunnregel: vanlig bruk av Enkel-AO skal ikke merke noe til vakten.**
  Vakten deler ikke tokens, cache eller localStorage med appen. En feil i vakten
  skal aldri gi en feilmelding, en utlogging eller en forsinkelse i
  registrering, kart eller sending. Viser måling 3 at en ekstra innlogging
  påvirker enhetens sesjon, stopper designet der.
- B og C: anbefalingene ble valgt, altså én varseltype og 15 min kl. 06–23.
  Det kan endres.

## Forklaringen til brukeren

Påslag krever en egen innlogging, og brukeren må forstå hvorfor. Det skal stå
rett ved bryteren på `/varsler.html` og vises før noe skjer:

> **✉️ Meldinger fra Artsobservasjoner**
> Få beskjed når noen skriver til deg på Artsobservasjoner, når valideringsstatus
> endres, eller når noen kommenterer funnene dine.
>
> *Slik virker det:* Artsobservasjoner sender ikke varsler selv. Enkel-AO sjekker
> derfor om du har noe nytt, omtrent hvert kvarter mellom 06 og 23. For å kunne
> gjøre det også når appen er lukket, logger Enkel-AO inn på din konto én ekstra
> gang, med en egen innlogging som ikke påvirker den du bruker i appen. Vi leser
> bare *antallet* uleste, aldri innholdet, og ingenting blir markert som lest.
>
> Du kan slå det av når som helst. Da slettes innloggingen fra serveren.

- Bryteren er bare aktiv når man er innlogget i appen. Ellers står det «Logg inn
  på Artsobservasjoner først», med lenke til profilsiden.
- Påslag ber om passordet på nytt i en liten dialog: «Bekreft med passordet ditt
  for å slå på». Da er samtykket tydelig, og vi slipper å lese et lagret passord
  i bakgrunnen.
- Ryker innloggingen, kommer det ett varsel: «Varsler om meldinger er satt på
  pause. Trykk for å slå på igjen.» Det sendes bare én gang, aldri en serie.

## Åpne valg for Kjetil (besvart over)

- A. Egen token-kjede for vakten (anbefalt) eller passordbasert innlogging?
- B. Én varseltype for både Innboks og Driftsmeldinger, eller to?
- C. Intervall og tidsvindu: 15 min, 06–23?

## Intervall: revidert av Kjetil (2026-11-25)

Erstatter «hvert 15. minutt» over. **Jobben kjører hvert 10. minutt (6 runder i
timen), men hver bruker sjekkes bare i én av tre runder. Det gir 2 sjekker per
time per bruker.**

- Hver bruker får et fast spor: `spor = sha256(ao_brukernavn) % 3`. Runde *n*
  (teller fra midnatt, `ZoneInfo('Europe/Oslo')`) sjekker brukerne med
  `spor == n % 3`. Hash i stedet for løpenummer, slik at sporet er stabilt
  uten lagring og fordeler seg jevnt.
- Innenfor runden spres kallene over de første ~5 minuttene i stedet for å
  gå rett etter hverandre.
- Lasten blir ~100 kall/time ved 50 brukere (~17 per runde), mot ~200 med
  15-minuttersforslaget. Lengste ventetid på et varsel er 30 min.
- **Forutsetning:** en urørt `.ASPXAUTHNO` må leve minst 30 min, ellers blir
  hver sjekk en revival. D30/D60 i levetidsmålingen avgjør det.

## Levetidsmåling (2026-11-25, 16:37–23:42, testkontoen)

Telle-kallet ble sendt med KUN `.ASPXAUTHNO` (uten `logintoken`, se punkt 1 under).

| Sesjon | Urørt i | Resultat |
|---|---|---|
| D30 | 30 min | 200, gyldig |
| D60 | 60 min | 200, gyldig |
| D120 | 120 min | 200, gyldig, **ny `.ASPXAUTHNO` i svaret** |
| D240 | 240 min | 302 → død |
| D420 | 420 min | 302 → død |
| C | pinget hvert 15. min i 7 t | gyldig hele veien. Ny `.ASPXAUTHNO` etter 90, 183, 285 og 376 min |

- **AOs inaktivitetsgrense er mellom 2 og 4 timer**, trolig ~3 t. ASP.NET-sliding
  fornyer etter halve levetiden, og det stemmer med fornyelse hvert ~90 min.
- **Telle-kallet fornyer sesjonen.** Vakten MÅ lese `Set-Cookie: .ASPXAUTHNO`
  og lagre den nye verdien. Da trengs revival med logintoken nesten aldri.
- **En død sesjon svarer 302** (ikke 200 med tomt innhold). Det er signalet vakten
  bruker for «død sesjon» (punkt 2 under).
- **Natt uten kall dreper sesjonen.** Revidert: vakten kjører hele døgnet med
  2 sjekker per time per bruker, men **sender push bare kl. 06–23**. Økning
  funnet om natta sendes i første runde etter 06. Forslag fra Claude, ikke
  bekreftet av Kjetil ennå.

## Gullfisk-review (2026-11-25) og hva den endrer

En fersk agent uten samtalekontekst leste designet og koden. Den fant tolv
funn. Under står de som er sjekket, og hva de endrer.

**Bekreftet og innarbeidet i designet:**

1. **Telle-kallet må ikke sende `logintoken`.** `fetch_new_notifications`
   sender `logintoken` + `logintoken_ssl` sammen med `.ASPXAUTHNO`. Med en
   utløpt cookie er det nøyaktig kombinasjonen som brenner tokenets ene revival
   (korreksjon 5). **Målt 2026-11-25:** telle-kallet svarer 200 med gyldige tall
   med KUN `.ASPXAUTHNO`. Vakten bruker derfor et eget kall uten `logintoken`.
   - **Det samme gjelder appens eksisterende ✉️-sjekk** (`/api/ao-messages`).
     Den sender telefonens logintoken sammen med en kanskje utløpt cookie, og kan
     dermed bruke opp telefonens revival. Det er en mulig, ubevist medårsak til
     at token-revival i prod bare lykkes ~55 %. Rettingen er den samme, men den
     er ikke gjort ennå (avklares med Kjetil).
   - Første levetidsmåling sendte også `logintoken`, ble forkastet og er
     startet på nytt med rent kall (C hvert 15. min, D urørt i
     30/60/120/240/420 min).
2. **«Død sesjon» og «AO hikker» må skilles.** Vakten leser statuskoden selv:
   302 til `/LogOn` eller 401 betyr død sesjon og gir revival. 5xx, timeout og
   rart innhold betyr «vet ikke»: ingenting endres, og det gjøres ingen revival.
   Ellers ville hver driftsforstyrrelse hos AO brent et token.
5. **Påslag må bruke `login_to_ao(..., bind_token=False, diskret=True)`.**
   Standard er `bind_token=True`. Det lagrer passordet og binder vaktens token i
   `credentials.json`, slik at vakten får en implisitt passordvei og tar en av de
   25 tokenplassene. Det skal være en test for det.
7. **Vakten nøkles på AO-brukernavn, ikke på enhet.** Én AO-sesjon og én polling
   per bruker, med en liste av push-endepunkter. Påslag på enhet nummer to
   gjenbruker vakten. Det gir færre samtidige sesjoner (se 3).
8. **Avslag må faktisk rydde opp.** Hver runde sjekker vakten at minst ett av
   brukerens endepunkter fortsatt har `ao-meldinger` i `emner`. Hvis ingen har
   det, slettes vakt-raden med tokens. Fallbacken i `aktiveEmner()` og
   `fornyHosServer()` (`['nyheter']` når localStorage er tom) må ta vare på
   serverens emner, ikke overskrive dem.
10. **Varslene må synes.** Hver kategori sammenlignes for seg («økte Innboks
    eller Driftsmeldinger?»), ikke summen. Service workeren skal sette
    `renotify: true` når `tag` gjenbrukes, ellers kommer et nytt varsel stille.
    AO-varsler sendes med `Urgency: normal` og kortere TTL (f.eks. 6 t), ikke
    nyhetsinnstillingene.
11. **Tidsvinduet regnes i `ZoneInfo('Europe/Oslo')`.** Containeren går på UTC
    (ingen `TZ` i compose). Rundetiden logges. En runde som tar lenger enn
    intervallet, hopper over neste i stedet for å stable dem.

**Må måles med testkontoen før koding:**

3. **Overlever enhetens logintoken at vakten roterer sin kjede?** Målt så langt
   er bare at en eksisterende `.ASPXAUTHNO` lever videre. Testen: innlogging A
   (enhet), innlogging B (vakt), og B roterer to ganger. A skal fortsatt kunne
   gjøre en ren revival. **Dette er grunnregelens viktigste test.**
   **Målt 2026-11-25, bestått:** A (enhet) og B (vakt) ble logget inn. B gjorde
   to vellykkede revivals, og tokenet roterte begge gangene. Etterpå var
   A-cookien fortsatt gyldig, og A sin egen revival lyktes med et rotert token.
   Vaktens kjede er altså uavhengig av enhetens.
4. **Overlever sesjonen natta?** Med 06–23 står den urørt i sju timer. D420 i
   måling 2 svarer på det. Dør den, er alternativene ett lett kall i timen også
   om natta (anbefales: billigere enn en revival-støt kl. 06) eller en spredt
   revival om morgenen.
6. **Fornyer telle-kallet cookien?** Målingen logger navnene på alle
   `Set-Cookie`. Første kall ga bare `ReleaseNumber` og `TempUserId`, ingen
   ny `.ASPXAUTHNO`.

**Åpne spørsmål til Kjetil:**

9. **Avslag sletter innloggingen hos oss, men ikke hos AO.** Logintokenet varer
   et år hos AO. Skal avslag også logge ut hos AO (`/LogOff` med vaktens
   cookie)? Må måles. Det samme gjelder hva et passordbytte gjør med tokens.
12. **Ser AO eller brukeren aktiviteten?** Én IP med mange kontoer hvert kvarter
    kan se ut som misbruk for AO. Bør AO informeres før dette rulles ut til
    flere enn testkontoen? Det er en reell risiko for grunnregelen: blir Pi-ens
    IP sperret, rammer det all vanlig bruk av appen.

