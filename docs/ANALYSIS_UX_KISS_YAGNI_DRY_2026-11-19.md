# Periodisk gjennomgang: UX, KISS, YAGNI og DRY

**Dato:** 2026-11-19  
**Kodegrunnlag:** `6f26e79` på gjeldende arbeidskopi, uten lokale kodeendringer ved oppstart.  
**Status:** Ferdig analyse og forslag til gjennomføring. Ingen implementering eller utrulling er utført.

## Anbefaling

Prioriter pålitelig lagring og redigering, deretter tilgjengelighet og konsekvent oppførsel. Gjør små, avgrensede endringer i den eksisterende løsningen. Behold vanilla JavaScript, Python-serveren, SQLite, lokal registrering og CSV-import til AO.

KISS og YAGNI er godt ivaretatt i teknologivalgene. Svakheten er at enkle brukerhandlinger nå går gjennom flere tilstander og gjentatte regler. DRY er delvis fulgt: lagring, besøksmodell, bildevelger og kartvisning har felles moduler, men moduladresser, observatørsøk, datoformatering, innlogging og eksport har parallelle implementeringer som allerede oppfører seg ulikt.

De viktigste forbedringene er konkrete feil, ikke et behov for å tegne om appen. Ta F01–F03, eksportfeilen i F08 og korrekt innloggingsinformasjon fra F04 først. Deretter F05–F06, F07 og F09, og til slutt F10. Resten av F04 er et eget innloggingsspor med måling før passordlagringen avvikles. F11 er et lite UX-eksperiment etter feilrettingene.

## Grunnlag og avgrensning

- Lest `CLAUDE.md`, `CONTRIBUTING.md`, relevant frontend/backend og eksisterende UX- og arkitekturanalyser.
- Lest prosjektoversikten i Obsidian og notatene om tokenfornyelse, UX, ytelsesgjennomgangen fra 2026-11-13, CSV kontra formvei og tidligere problemer med bildelagring.
- Undersøkt oppstart, stedsvalg, artssøk, registrering, liste, antallsendring, redigering, innstillinger, profil og offline-navigasjon i en isolert Chromium-kontekst med syntetiske data. Alle `/api/`-kall ble erstattet med lokale svar; eksterne nettverkskall var blokkert. Service worker var blokkert i disse funksjonsprøvene.
- Målt hovedsiden på 320, 360, 390, 768 og 1280 px. Ingen horisontal sideoverflyt i den prøvde tilstanden. Trykkflater er målt på 390 px med touchprofil.
- Dette er kodeanalyse og ekspertgjennomgang av UX, ikke brukertesting, full tilgjengelighetsrevisjon eller test mot produksjon. Kartets virkelige fliser, AO-publisering, fysisk iPhone og installert PWA er ikke verifisert her.
- Gamle notater er historikk. Eksempel: AO-kontoopprettelse står som et åpent UX-punkt i juli-notatet, men lenken finnes nå i `profil.html`. Det tas ikke med som en ny mangel.

## Det som bør beholdes

- Lokal artsliste som førstevalg, med synkronisering gjennom verktøy fremfor AO-kall per bruker og tastetrykk.
- Rask registrering via aktivitetsknappene, progressiv aktivering og kollapset lokasjonsseksjon.
- Eksplisitt besøksmodell og synlig tidsspenn ved ↩ tilbake til et tidligere besøk.
- Felles `saveObservations()`, bildevelger, medobservatørvelger og rene hjelpemoduler.
- Skille mellom privat arbeidsliste, fellestur, delingslenke og sendt-kvittering. De har ulike eierskap og levetider; ett universelt synklag ville gjort løsningen mer komplisert.
- SQLite og eksisterende CSV-vei. Tidligere vurdering av AOs skjema viser en betydelig vedlikeholdskostnad ved å erstatte bulkimporten.
- Separate hvitelister for deling og fellestur. Lik kode er ikke nødvendigvis samme regel når personvern og tillatte felt er forskjellige.

## Prioriterte funn

P1 = feil som kan gi tapte eller feilaktige funn, eller vesentlig feil informasjon. P2 = tydelig brukerfriksjon eller vedlikeholdsproblem. P3 = avgrenset opprydding eller et forslag som må prøves med brukere. Dette er planprioritet, ikke en påstand om produksjonshendelser.

| ID | Prioritet | Funn | Prinsipp | Bevis |
|---|---|---|---|---|
| F01 | P1 | «Registrert» vises selv om lagring feiler | UX, KISS | Reprodusert med kvotefeil |
| F02 | P1 | Avbrutt redigering lekker endringer; navn og lokalitets-ID kan skilles | UX, KISS | Begge reprodusert |
| F03 | P1 | Antallsendring utvider også et låst, gammelt besøks tid til nå | UX, DRY | Reprodusert |
| F04 | P1/P2 | Tokenfornyelse finnes, men publisering og lagring krever fortsatt passord | UX, KISS, YAGNI, DRY | Bekreftet i kode; flertrinns tokenlevetid må måles |
| F05 | P2 | Viktige kontroller og modaler mangler tilgjengelig betjening | UX | Målt i nettleser og bekreftet i kode |
| F06 | P2 | Offline-reglene følger bare én av to innganger til Fellestur | UX, DRY | Reprodusert |
| F07 | P2 | Seks moduler lastes under både versjonert og uversjonert URL | KISS, DRY | Målt i nettleser |
| F08 | P1 | Eksportveiene har ulike regler; tabulator i kommentar forskyver backend-kolonner | UX, DRY | Begge eksportører kjørt med samme syntetiske data |
| F09 | P2/P3 | Parallelle komponenter og tekststyrt toast-logikk øker endringskostnaden | KISS, DRY | Konkrete kodekopier og kallesteder |
| F10 | P3 | Ubrukte knappekoblinger og eldre sider gir unødvendig vedlikehold | YAGNI | Knappekoblinger bekreftet; sidebruk ikke målt |
| F11 | P3 | Ett trykk på aktivitet lagrer, men handlingen er lite selvforklarende | UX | Ekspertvurdering; må prøves med brukere |

### F01 — Bekreft først når observasjonen er lagret

**Kilder:** `public/js/observation-commit.js:235`, `public/js/main.js:187`, `public/js/storage.js:136`, samt lagringskall i `observations.js`.

`commitObservation()` endrer lista, tegner den, kaller `saveState()` og viser suksess uten å kontrollere returverdien. `saveState()` varsler om feil bare for en innhentet liste. I prøven ga en simulert `QuotaExceededError` telleren «2» og «svarttrost registrert», mens lagringen bare inneholdt den første observasjonen. Etter omlasting viste telleren «1».

**Tiltak:** Gjør «bygg kandidat → lagre → oppdater aktiv liste og vis kvittering» til den tydelige flyten. Ved feil beholdes utfylte felt og bilde, og brukeren får en vedvarende forklaring med nytt forsøk. Flytt også sjeldenhetsfeiringen etter vellykket lagring; den er allerede en suksessmarkering. Kontroller antall, sletting, Angre, besøkslås, gruppetid og kopiering fra fellestur: de må respektere lagringsresultatet. Hold dette som noen få funksjoner og en klar returverdi, ikke en generell transaksjonsmotor. Behold fellesturens eksisterende skille mellom lokalt lagret og ferdig synkronisert.

Lagring har allerede et viktig kontekstskifte: sletting av siste rad i en innhentet liste lukker den, og `main.js:193` laster privatlisten. Kandidaten må knyttes til listen som ble endret. Den må ikke erstatte privatlisten som nettopp ble lastet inn etter en vellykket tømming.

**Akseptanse K1:** Ved avvist lagringsskriving vises aldri «registrert», feiring eller annen suksess. Ingen lagrede funn overskrives, og utkastet kan prøves igjen uten dublett. Registrering uten feil krever like mange trykk som i dag. Kvoteprøver dekker vanlig arbeidsliste, innhentet liste, lokalt fellestur-speil og lås/lås opp. Sletting av siste rad i innhentet liste viser privatlisten korrekt og lar innholdet i den være urørt.

### F02 — Rediger et utkast og bevar identiteten

**Kilder:** `public/js/edit-modal.js:174–260`, `public/js/observations.js:658`.

Skjemaet skriver direkte til objektet i den aktive lista før all validering er ferdig. Prøve: lagret antall 2 → skriv 9 og dato i 2099 → lagring avvises → Avbryt → åpne igjen. Antallet er nå 9 i minnet, men 2 på disk. Et senere +1 lagrer 10. «Avbryt» har dermed ikke avbrutt endringen.

En annen prøve endret stedsnavn fra «Gammelt sted» til «Nytt sted». `placeId` var fortsatt 123 og `visitId` fortsatt det gamle besøket. Eksporten prioriterer ID-en, så det viste navnet og publiseringsmålet kan være forskjellige. Art redigeres også som fritekst uten å velge tilsvarende artsobjekt.

**Tiltak:** La modalen eie et separat utkast, inkludert kopier av de underordnede feltene som faktisk kan endres. Valider hele kandidaten og lagre før den erstatter originalen. Lever denne rettingen først, og konsistente arts-/stedsvalg som neste avgrensede endring. Gjenbruk eksisterende lokalitets- og artsvalg for identitetsbærende felt. Ved manuelt endret navn må en tidligere ID ikke bli hengende. Anbefalt besøksregel ved reelt lokalitetsbytte: behold observasjonens dato/tid og legg den i et eget besøk på det nye stedet; ikke slå den automatisk sammen med et annet åpent besøk eller flytt resten av den gamle gruppa. Valg av samme lokalitets-ID bevarer besøket. Unngå en ny alternativ oppslagskomponent.

Fellesturpollingen erstatter samtidig objektene i den aktive lista (`main.js:503`), mens modalen i dag husker en arrayindeks. Et utkast må derfor knyttes til eksisterende `obsId` i fellestur og originalen som ble åpnet i privatlisten. Ved lagring finnes samme observasjon igjen og sammenlignes med åpningsgrunnlaget. Er den endret eller slettet i mellomtiden, beholdes utkastet og brukeren får beskjed med mulighet til å laste siste versjon; ingenting overskrives automatisk. Dette krever ingen universell ID-migrering av privatlisten eller generell konfliktmotor.

**Akseptanse K2:** Avbryt, valideringsfeil og lagringsfeil lar originalen være uendret i minnet og på disk. Senere handlinger kan ikke lagre avbrutte verdier. Art, lokalitetsnavn, AO-ID og besøk henger sammen etter redigering. Test også at sjeldenhetsmerket nullstilles når identiteten eller datoen endres. Polling som flytter, endrer eller sletter en fellesturobservasjon mens modalen er åpen, kan aldri få Lagre til å endre en annen observasjon eller overskrive en samtidig endring i stillhet.

### F03 — Rett antall uten å flytte et avsluttet besøk til nå

**Kilder:** `public/js/observations.js:514–632`, `public/js/visits.js`, [tidsregelen for besøk](besok-og-tilbake-til-besok.md).

Alle antallsendringer setter `tilKlokkeslett` til nå, også på låste besøk. Et låst funn med tid 2026-11-01 kl. 10–11 fikk `tilKlokkeslett` 2026-11-19 etter +1. Låsen ble stående. Dette strider mot den dokumenterte hensikten om at korrigering av gamle besøk skal bevare deres tidsspenn.

**Anbefalt regel:** Hurtigtelling i et aktivt feltbesøk kan fortsatt utvide tiden som i dag. Ren korrigering av låste eller historiske besøk bevarer fra/til. Om brukeren vil endre tid, brukes den eksisterende tidsdialogen. Én liten, ren funksjon avgjør dette for −1, +1, ±10 og direkte antallsinntasting.

«Aktivt» må utledes eksplisitt; `findOpenVisitId()` ser ikke på dato. Følgende beslutningstabell er anbefalingen, ikke en beskrivelse av dagens kode:

| Situasjon ved antallsendring | Anbefalt håndtering av fra/til |
|---|---|
| Feltmodus, ulåst besøk fra inneværende lokale kalenderdag, samme besøk som nåværende registreringskontekst, uten ↩ | Behold fra; utvid til-tid til nå som ved dagens hurtigtelling |
| Annet besøk, også tidligere samme dag og på samme lokalitet | Behold begge tider |
| ↩ tilbake til et besøk, også et ulåst besøk | Behold begge tider |
| Etterregistreringsmodus | Behold begge tider |
| Låst besøk eller startdato før inneværende lokale dag | Behold begge tider |
| Eldre observasjon uten `visitId` | Behold begge tider; ikke gjett aktivt besøk fra stedsnavnet |
| Besøk som går over midnatt | Behold tider ved antallskorrigering etter dagsskiftet; eventuell utvidelse settes eksplisitt i tidsdialogen |

La hovedsiden sende eksisterende registreringskontekst til antallsregelen. Ikke innfør et nytt lagret «historisk»-flagg. Midnattsvalget er en bevisst forenkling som skal godkjennes sammen med resten av tabellen.

**Akseptanse K3:** Ingen av antallskontrollene endrer tid i et låst eller historisk besøk. Vanlig feltregistrering beholder forventet løpende tidsføring. Test i begge registreringsmodi og med eldre observasjoner uten `visitId`. Denne produktregelen godkjennes før implementering.

### F04 — Fullfør overgangen til tokenbasert innlogging

**Kilder:** `src/api_handlers.py:153–259, 348–585`, `server.py:1662`, `public/js/api.js:545`, `public/js/main.js:293`, `public/js/export-operations.js:441, 606`, `public/profil.html:58`, `public/js/i18n/nb.js:243`, [tokenhistorikken](ao-token-autentisering.md), [AO3-reserven](ao3-reserve.md).

Brukerens presisering er målbildet: gjenbruk AOs langtidstoken fremfor å lagre passord. Den undersøkte koden har allerede `logintoken` med oppgitt levetid rundt ett år og rettingen fra 2026-11-18 som hindrer at utløpssjekker bruker det opp før selve fornyelsen.

Overgangen er likevel ikke fullført i denne arbeidskopien:

- `login_to_ao()` kaller fortsatt `_save_credentials()`, som skriver brukernavn og passord til serverfil.
- Profilsiden lagrer fortsatt `ao_password` ved skriving i feltet. Hovedsidens publiserknapp og innloggingsmerke bruker tilstedeværelsen av brukernavn og passord som kriterium.
- `handleDirectSend()` krever passord og gjør ny passordinnlogging før sending. AO3-reserven bruker også passord.
- Arbeidslisteoverføringen krever passord i `arbeidsliste-overforing.js:236` og gjør egen passordinnlogging i `server.py:1565`. Før sending av innhentet liste kontrollerer dagens innloggingskall listeeieren mot AO-kontoen som faktisk skal sende (`server.py:1612`). Denne kontrollen må bevares når nyinnloggingen tas bort.
- Henting av egne private lokaliteter kan også falle tilbake på passordinnlogging via AO3 (`api.js:158`). En vellykket AO3-innlogging kan i dag gi lokalitetscache uten å etablere AO2-token.
- Backendens `_refresh_with_logintoken()` returnerer bare ny sesjonscookie; et eventuelt nytt langtidstoken følger ikke denne kjeden tilbake til klienten. Den separate `/api/ao-refresh`-implementeringen har et eget svarfelt for nytt token.
- Profilteksten sier at passord aldri lagres på serveren. Det samsvarer ikke med den undersøkte koden. Det er P1-delen av funnet; selve forenklingen er et avhengig arbeidsspor.

**Viktig usikkerhet:** Nyeste repo-notat beskriver én vellykket fornyelse per uendret tokenverdi. Eldre vault-notater har tidligere, delvis avkreftede forklaringer og fraråder passordfjerning. Ingen av dem beviser alene at hele innloggingsflyten nå kan gjentas gjennom et år. Dette skal avklares empirisk; ett års cookieutløp er ikke en garanti for ett års ubrutt sesjon.

**Gjennomfør i tre deler:**

1. Rett brukerforklaringen straks slik at den beskriver faktisk lagring. Lag én gjeldende teknisk beskrivelse med historikken tydelig atskilt.
2. Samle tokenfornyelsen om ett resultat som kan bære både sesjonscookie og eventuelt nytt langtidstoken. La klienten lagre det samlet med kontroll mot kontobytte og parallelle svar. Samordne også fornyelsen på serveren: to kall med samme utløpte sesjon må ikke uavhengig konsumere samme token. Kjør gjentatte utløp → fornyelse → autentisert lesing, og kartlegg hva som faktisk skjer med langtidstokenet. Bruk mock for parallelle kall fra flere API-endepunkter og to faner, og eierens testkonto for en liten, kontrollert måling uten publisering. Velg den minste nødvendige samordningen etter målingen, ikke en ny generell sesjonstjeneste. Mål også eksisterende produksjonsadferd lesende hvis slike data finnes; ikke anta utrullingsstatus fra en datert note.
3. La normal publisering og opprettelse/fornyelse av arbeidslisteoverføringens egen sesjon bruke den autentiserte AO-kontoen uten lagret passord. Bevar eiersjekken før publisering av innhentet liste: sammenlign listeeier med kontoen bak sesjonen som faktisk sender, gjenbruk `hent_ao_konto()`. Prefikset i `loginToken` / `userId` er ikke stabil kontoidentitet. Deretter fjernes vedvarende passordlagring og passordfallback. Avklar AO3-reserven for både sending og private lokaliteter: anbefal ny passordinntasting ved behov, uten varig lagring, og bruk eksisterende lokalitetscache videre. Passordet lever bare under den uttrykkelig valgte operasjonen og fjernes fra skjema/minne etterpå. Forklar at «innlogget via AO3» gjelder det bekreftede oppslaget/operasjonen, ikke en etablert AO2-sesjon. Et AO2-token må ikke antas å fungere mot AO3, og et nytt AO3-sesjonslager innføres bare hvis et målt behov krever det. Fjern gamle server- og klientlagrede passord gjennom en avgrenset migrering, med håndtering av enheter som ikke åpnes før senere. Behold brukernavn som visnings-/kontokontekst der det trengs.

**Akseptanse K4:** Normal lesing, arbeidslisteoverføring og publisering virker med token og uten lagret passord, også etter flere fornyelser og serveromstart. Publisering av innhentet liste krever bekreftet samsvar mellom listeeier og den autentiserte AO-kontoen som sender; kontobytte gir avvisning. Ugyldig eller tilbakekalt token gir forståelig ny innlogging og bevarer arbeidslista. Parallelle serverkall starter ikke uavhengige fornyelser av samme token, og parallelle svar eller kontobytte kan ikke lagre en annen sesjon. AO3 har en definert flyt for sending og private lokaliteter uten varig passordlagring. Ved ferdig migrering finnes ikke appens vedvarende passordlagring, og brukerforklaringen er sann. Faktisk publisering mot AO testes bare etter særskilt godkjenning etter repoets regler.

### F05 — Gjør eksisterende kontroller tilgjengelige og lettere å treffe

**Kilder:** `public/js/observation-commit.js:359`, `public/settings.html:56,202`, `public/index.html:600,1033`, `public/js/edit-modal.js:72–114`, `public/js/observations.js:460–490`, `public/css/4-components.css`, `public/css/7-page-specific.css`.

- Aktivitetsknapper er `div` med `role="button"`, `tabIndex=-1` og bare klikkhåndtering. De kan ikke nås og aktiveres som knapper med tastatur.
- Fire innstillingsbrytere bruker `display:none` på selve inputen. De har heller ikke tekstlig navn i labelen eller `aria-label`; teksten ved siden av er en separat span.
- Redigeringsmodalen mangler dialogsemantikk, initialt fokus, fokusavgrensning og tilbakeføring av fokus. I prøven forble fokus utenfor modalen. Medobservatørmodalen har tilsvarende håndlaget overlay.
- På 390 px målte antallsknappene 34×32 px, rediger/slett 28×30 px og ✓ / flere felt 32×32 px. Flere er dermed under prosjektets krav om minst 44 px trykkflater.

**Tiltak:** Bruk native `button`, synlig fokus og korrekt disabled-tilstand for aktivitetsknappene. Behold bryterens input tastaturtilgjengelig og koble den til teksten med label. Utvid faktiske trykkflater til minst 44×44 px for hovedhandlingene uten overlapp. Prøv først om mellomrom/padding er nok; behold kompakt visuell symbolstørrelse. Dersom mobilraden ikke får plass, prioriter ± og samle sjeldnere handlinger fremfor å krympe trefflatene.

For modaler: sammenlign små rettelser i overlayene med native `<dialog>`, som appen allerede bruker i `sendt-handlinger.js`. Anbefalt er native dialog for redigering og medobservatører, én av gangen, hvis den verifiseres sammen med bildeeditoren. Ikke lag et generelt modalrammeverk.

**Akseptanse K5:** Hovedflyten og innstillingsbryterne virker med Tab, Shift+Tab, Enter og mellomrom. En skjermleser får riktig navn, rolle og tilstand. Fokus forblir i åpen modal og går tilbake til utløseren ved lukking. Escape i bildeeditoren lukker bare øverste lag. Hovedhandlinger har minst 44×44 px trefflate på 320–430 px uten horisontal sideoverflyt eller overlapp. Kontroller også økt tekststørrelse og alle tre temaer.

### F06 — La offline-reglene følge handlingen

**Kilder:** `public/index.html:125–133`, `public/js/main.js:1495–1575`.

Fellestur finnes både som eget headerikon og som lenke i ⋯-menyen. Offline-merking og avskjæring er koblet til ikonets ID. Menylenken går rett til `fellestur.html` i samme modus. Dette ble reprodusert. Funnets omfang er ulik navigasjon; det er ikke målt at denne lenken alene fører til et eksternt kall når service workeren er aktiv.

**Tiltak:** Merk handlingen likt i begge innganger og bruk én liten oppdaterings-/klikkregel. Vurder samtidig den lokale delen av «Tidligere sendt»: den inneholder en kvittering som er ment å fungere offline, men hele inngangen sperres nå. Anbefal å vise lokale kvitteringer og forklare at AO-lista krever nett. Behold streng offline-policy for nye nettverkskall og den særskilte bekreftelsen ved eksplisitt AO-sending.

**Akseptanse K6:** Samme handling gir samme resultat uansett inngang. Lokale kvitteringer kan leses offline. Tester med aktiv service worker viser null uautoriserte nettverkskall i streng offline. Avklar hva «Mine delinger» kan gjøre lokalt før eventuell åpning av den inngangen; ikke løs dette bare ved å fjerne sperrer.

### F07 — Én moduladresse og ett sted for service worker-registrering

**Kilder:** `public/js/main.js:13–72`, `public/index.html:585`, `public/js/offline-db.js:153,1107`, `public/sw.js`. Tidligere identifisert i vaultets ytelsesgjennomgang 2026-11-13; fortsatt til stede.

Nettleseren hentet seks filer både med og uten `?v=v1.60.30`: `api.js`, `ui.js`, `storage.js`, `i18n.js`, `observations.js` og `offline-db.js`. Dette er forskjellige ES-modulidentiteter, også når filinnholdet er likt. Modulinterne cacher, lyttere og oppstart kan dermed finnes i flere instanser. Service worker registreres både inline og fra `offline-db.js`.

**Alternativer:** A) konsekvent versjonerte moduladresser, støttet av et lite releaseverktøy og en importgrafkontroll; B) byggesteg med innholdshash på alle ressurser. **Anbefal A** for dagens prosjekt. B gir større endring enn problemet trenger. Ikke fjern versjonsparametrene uten en verifisert erstatning; Cloudflare-historikken viser hvorfor de finnes.

**Tiltak:** Velg én konsistent URL per modul, inkludert inline imports og dynamiske imports. Bruk eksisterende `offline-db.js` som eier av worker-registreringen. Samle oppdatering og kontroll av versjonsreferanser i ett lite releaseverktøy som bare endrer avtalte referanser. Behold eierstyrt versjonsbump ved release og separate kartcacher.

**Akseptanse K7:** Importgraf og nettlesermåling viser én URL per modul per side. Registrering har én eier. Gammel installert PWA kan oppgraderes og deretter åpnes uten nett; appmoduler, språk og kartkontroller virker. Nedlastede kart beholdes. Oppgraderingen verifiseres også på Pi-staging med eksisterende Cloudflare-cache.

### F08 — Felles eksportkontrakt, også når språkene er forskjellige

**Kilder:** `public/js/observations.js:738–926`, `src/ao_import.py:14–176`, `tests/test_ao_import.py`, `tests/unit/observations.test.js`.

Samme syntetiske AO2-observasjon ble sendt gjennom begge eksportørene: en kommentar med tabulator ga 54 kolonner i frontend, men 55 datakolonner mot 54 overskrifter i Python. Python skrev rå fritekst mellom tab-separatorene. Frontend byttet tabulatoren til komma. For kråke med latinsk navn i artsobjektet brukte frontend `Corvus cornix`, mens Python brukte `kråke`.

**Tiltak:** Definer en liten delt samling av innganger og forventede eksportverdier som begge testsuitene bruker. Rett først fritekstnormalisering og de dokumenterte navneunntakene. Behold JS-eksport for offline-kopiering og Python-eksport for serversending; det er ikke nødvendig å tvinge én av dem gjennom nettverk. Del eventuelt kolonnebeskrivelsen som data når det forenkler begge. Hold AOs private importmarkør og AO3-forskjellene eksplisitte.

**Akseptanse K8:** AO2-eksportene gir samme feltverdier for samme inngang, med avtalte unntak for serverens importmarkør og linjeskiftformat. Alle rader har korrekt kolonnetall. Dekk tabulator, CR/LF, ukjent antall, tom aktivitet, kråke, medobservatøralias, skjul-dato og lokal tid/eldre UTC-data. AO3 har egen forventet mal. Ikke avgjør AOs nåværende navnebehov fra en gammel TODO; behold en dokumentert regel til den eventuelt måles på nytt.

### F09 — Fjern påvist duplisering og tekststyrt oppførsel

**Kilder:** `public/index.html:665–767`, `public/js/ao-observer-autocomplete.js:19–134`, `public/js/datetime-helpers.js:27`, `public/js/utils.js:9`, `public/js/ui.js:39–100`, kall fra `observations.js:102,109,124`.

**Tre avgrensede tiltak:**

1. Medobservatørmodalen har egen tokenlesing, AO-søk, debounce, trefftegning og tastaturnavigasjon, samtidig som `attachAoObserverAutocomplete()` finnes. Gjenbruk komponenten med en liten kontrakt for valgt verdi, alias og om feltet skal beholdes eller tømmes. Bevar automatisk lagring i radene. Samle også håndtering av forsinkede svar; den må ikke velge treff fra et eldre søk.
2. `toLocalIso()` og `toLocalISOString()` gjør samme lokale datoformatering. Behold én ren funksjon og oppdater brukerne. Bevar bevisst forskjell mellom lokal klokketid og UTC; dette er ikke anledning til å endre datamodellen.
3. `showToast()` gjetter betydning fra tekstprefiks og legger ellers til «registrert». Gruppetidsmeldinger og andre feilmeldinger kan derfor få registreringssuffix og grønn ramme. Erstatt tekstgjettingen med eksplisitt meldingstype og komplett melding. Behold en enkel registreringssnarvei ved behov. Sørg for at en ny toast avbryter den gamles timer, så raske registreringer får forutsigbar varighet.

**Akseptanse K9:** Én observatør-autocomplete brukes der mønsteret er det samme; alias og manuelt navn bevares. Én formatter gir uendrede datoresultater. Feilmeldinger får aldri «registrert»-suffix eller suksessutseende, uavhengig av UI-språk. Raske etterfølgende meldinger vises i avtalt varighet.

### F10 — Fjern det som faktisk er uten bruk, og avklar resten

**Kilder:** `public/js/main.js:127–128,1168–1169`, `public/js/export-operations.js:139–184`, `public/sw.js:19–20`, `public/ao-direct.html`, `public/medobs.html`.

`export-btn` og `copy-btn` finnes ikke i noen av de nåværende HTML-filene, men referanser, nullvakter og hendelseskoblinger står igjen. `handleExport` og `handleCopy` har bare disse produksjonskallestedene; «Kopier & åpne AO-import» har en egen, fortsatt aktiv flyt.

**Tiltak:** Fjern de ubrukte knappekoblingene og funksjonene i en liten opprydding. Behold den aktive kopieringsflyten og dens clipboard-reserve. De eldre frittstående AO-/medobservatørsidene har egen kode og står i workerens forhåndslasting. Det er ikke dokumentert at de er uten bruk: medobservatørsiden har egne E2E-tester, og sider kan være bokmerket. Avklar med eieren og eventuelle eksisterende sidevisningsdata før de fjernes eller videresendes. Ikke legg til ny sporing bare for å begrunne oppryddingen.

**Akseptanse K10:** Ingen referanser til de to bortfalte knappene gjenstår i aktiv kode, og kopier/åpne-flyten virker. Hver eldre side får en eksplisitt beslutning: behold med formål, gjenbruk felles komponenter eller avvikle med fungerende videresending. Offlinesidenes assetliste følger beslutningen.

### F11 — Forklar hurtigregistreringen med én kort tekst

**Kilder:** `public/index.html:438–467`, `public/js/observation-commit.js:359`, tidligere UX-analyse fra juli 2026.

Dette er et forbedringsforslag, ikke en bekreftet brukerfeil. Aktivitetspills ser ut som valg, men lagrer med én gang; dropdownen krever ✓. Farten er verdifull og skal beholdes.

**Tiltak:** Prøv en kort forklaring ved aktivitetsraden: «Trykk på en aktivitet for å registrere». Gi ✓ et tilgjengelig navn som beskriver handlingen. Vurder om samme forklaring kan være synlig bare før første vellykkede registrering, uten en ny modal eller veiviser. Ikke flytt alder/kjønn eller legg til nye innstillinger uten observert behov.

**Akseptanse K11:** To–tre personer som ikke kjenner flyten, kan registrere ett funn og forklare hva aktivitetsknappen gjorde uten muntlig instruksjon. Erfarne brukere bruker ikke flere trykk. Prøven må også omfatte etterregistrering med dato/tid og ukjent antall.

## Gjennomføringsplan

Estimatene er grove arbeidsdager for utvikling, gjennomgang og lokale tester. De er ikke kalenderløfter. Arbeid mot AO, fysisk mobil og tilbakemelding fra brukere kommer i tillegg. Hver rad er en separat, avgrenset endring; ikke én samlet refaktorerings-PR.

| Trinn | Leveranse | Avhengighet | Grov innsats | Ferdig når |
|---|---|---|---|---|
| 1 | F01: lagring før kvittering | Ingen | 1–2 dager | K1 |
| 2a | F02: utkast i redigering, riktig mål ved polling | F01s lagringsregel | 0,5–1 dag | Avbryt-/lagrings-/pollingdelen av K2 |
| 2b | F02: konsistente arts-/stedsvalg og besøksplassering | 2a og godkjent besøksregel | 1–2 dager | Resten av K2 |
| 3 | F03: felles regel for antall og besøkstid | Godkjent produktregel | 0,5–1 dag | K3 |
| 4 | F08: rett eksportavvik og legg inn felles eksempler | Ingen; kan tas tidlig | 0,5–1,5 dager | K8 |
| 5 | F05a: knapper, brytere og trykkflater | Ingen | 1–2 dager | Kontrolldelen av K5 |
| 6 | F05b: redigeringsmodal, så medobservatørmodal | F02 | 1–2 dager | Modaldelen av K5 |
| 7 | F06: konsekvent offline-navigasjon og lokal kvittering | Ingen | 0,5–1 dag | K6 |
| 8 | F07: konsekvent modulgraf og releasekontroll | Egen cache-/PWA-prøve | 1–2 dager | K7 |
| 9 | F09: observatørsøk, dato og toast i tre små endringer | F05b for modaltilpasning; F07 for stabile instanser | 1–2 dager | K9 |
| 10 | F10: død kode; separat beslutning om eldre sider | Sideformål avklart før avvikling | 0,25–0,5 dag, pluss evt. sidearbeid | K10 |
| 11 | F11: forklaring og liten brukstest | Feilrettinger og tilgjengelige knapper | 0,25–0,5 dag, pluss brukstest | K11 |
| A1 | F04: korrekt tekst og dokumentasjon | Ingen | 0,25–0,5 dag | Sann lagringsbeskrivelse |
| A2 | F04: gjentatt tokenfornyelse og felles sesjonsresultat | Måleoppsett/testkonto; F07 før klientdelen samles | 1–2 dager, med usikkerhet | Gjentatte fornyelser verifisert |
| A3 | F04: tokenbasert sending/overføring, eiersjekk, AO3 og passordmigrering | A2 og valgt AO3-løsning | 3–5 dager, med usikkerhet | K4 |

**Første leveransepakke:** Trinn 1–4 og A1. Den retter påviste feil i data, lagring og informasjon uten å endre hoveddesignet. Deretter tilgjengelighet/offline, så teknisk opprydding. Tokenarbeidet kan undersøkes tidlig, men passordfjerning kommer etter dokumentert fungerende erstatning.

## Verifisering og utrulling

Gjennomgangen fant grønne testbaseliner, men også feil som disse testene ikke fanget:

- `npm test` fra repo-roten: **537 tester, 30 filer, alle bestått**.
- `.venv/bin/python -m pytest --maxfail=3`: **800 tester, alle bestått**. Det lokale miljøet brukte Python 3.13; appens dokumenterte mål er 3.12. Midlertidig database og credential-sti ble brukt. Et første forsøk i sandkassen ble stoppet av manglende rettighet til lokale testporter; ny kjøring fullførte.
- Isolerte Chromium-prøver bekreftet F01, begge delene av F02, F03, offline-menyavviket og de doble moduladressene. Trykkflater og brytere ble målt. Ingen JavaScript-sidefeil i den første funksjonsprøven. F08 ble sammenlignet direkte med Python-eksportøren.
- Hele Playwright-suiten ble ikke kjørt; service worker, ekte AO og fysisk mobil inngikk ikke i funksjonsprøvene.
- En fersk, uavhengig agent gjennomgikk planen mot kildekoden etter utkastet. Hovedfunnene ble bekreftet. Påpekte avhengigheter rundt fellesturpolling, listebytte ved tømming, tokenfornyelse, AO3 og eiersjekk ble kontrollert i koden og innarbeidet. Disse tilleggene er kildekodebekreftede risikoforhold, ikke nye nettleserreproduksjoner.

For implementeringen:

1. Skriv atferdstester for de konkrete reproduksjonene i K1–K9, ikke tester som bare leter etter bestemte kildekodestrenger. Ta lagringsfeil, Avbryt og gamle/låste besøk først.
2. Kjør pytest og vitest per PR. Ved frontend-endringer kjøres relevant E2E og repoets påkrevde suiter. Kjør eksisterende Playwright-baseline før endringen og sammenlign, siden suiten har kjente feil.
3. For K5: Chromium og WebKit, 320/360/390/430 px, tastatur og skjermleserprøve, større tekst og bildeeditor oppå modal. Kontroller også nettbrettvisningen.
4. For K6–K7: aktiv service worker, kald og varm cache, gammel installasjon → oppdatering, frakoblet nett, streng Offline/Hybrid/Online og bevarte kartnedlastinger. Test både meny og headerinngang.
5. For K4: mockede utløp, rotasjon, parallelle serverkall fra to faner/flere endepunkter, kontobytte, omstart og AO2/AO3-feil. Dekk overføring av arbeidsliste og avvisning ved feil eier, samt AO3-henting av private lokaliteter. Kontrollert lesende test med testkonto før passordmigrering. Ingen ekte observasjoner opprettes av ordinære tester.
6. Deploy hver ferdige endring til Pi-staging ved behov. Versjonsbump gjøres av eieren ved release, ikke i PR-ene. Produksjonsutrulling og publisering av testfunn følger de eksisterende eksplisitte godkjenningskravene.

## Risiko og avgrensede valg

- **Lagring:** En felles lagringsregel må bevare routingen mellom privat liste, innhentet liste og fellestur. «Lokalt lagret» må ikke loves som «synkronisert med server».
- **Redigering:** Unngå delte nested objekter mellom utkast og original. Lokalitetsskifte må håndtere både ID og besøk, ikke bare teksten.
- **Tid:** Skillet mellom aktiv telling og etterfølgende korrigering er et produktvalg. Anbefalingen i F03 er konkret, men skal bekreftes før kode endres.
- **Token:** Ettårsutløp, engangsfornyelse og mulig rotasjon er ulike forhold. AO3 kan kreve en annen innlogging. Ikke slett fallbacken før erstatningen er verifisert; ikke behold den på ubestemt tid av gammel vane.
- **Cache:** En oppryddet modulgraf må testes gjennom en ekte oppgradering. En ren ny nettleser alene fanger ikke gamle installerte PWA-er.
- **Trykkflater:** Store trefflater kan gi bredere rader. Bruk plass og prioritering; ikke innfør overlappende usynlige treffområder.
- **DRY:** Del konkrete regler og komponenter. Ikke bygg generisk repository-lag, universell skjemamotor eller et felles rammeverk for alle modalene og API-ene.

## Det som utsettes

- Ingen omskriving til React, annet frontend-rammeverk, Flask/Quarkus eller mikrotjenester.
- Ingen full oppdeling av `main.js`, `map.js` eller `server.py` bare fordi filene er store. Flytt kun ansvar som de konkrete endringene gjør klart.
- Ingen ny sentral synkplattform eller automatisk sammenslåing mellom enheter. Den eksisterende private overføringen løser et avgrenset behov.
- Ingen overgang fra CSV til AOs webskjema i dette arbeidet.
- Ingen nye favorittarter, innstillingsbrytere, onboarding-veiviser eller brukersporing uten et påvist behov.
- Ingen generell ytelsesrefaktorering av kart/listetegning. Vaultets målinger fra 2026-11-13 kan brukes som grunnlag hvis faktiske feltproblemer gir grunn til å prioritere dem.

## Beslutninger før implementering

Planen er ferdig; punktene under er produktvalg ved oppstart av de berørte endringene, ikke manglende analyse:

1. Godkjenn F03-tabellen for når antallskorrigering kan utvide tid, inkludert ↩, legacy og midnatt.
2. Godkjenn F04-målet: tokenbasert normalflyt, ingen vedvarende passordlagring, og eventuell ny passordinntasting for AO3. Avviklingen skjer etter målingen i A2.
3. Avklar formålet med `ao-direct.html` og `medobs.html` før eventuell avvikling. Døde knappekoblinger kan fjernes uavhengig av dette.
4. Godkjenn F02-regelen for reelt lokalitetsbytte: behold dato/tid og gi observasjonen eget besøk på den nye lokaliteten. Utkast-/Avbryt-fiksen i 2a kan gjennomføres uavhengig av dette valget.

Etter disse valgene kan oppgavene gjennomføres i angitt rekkefølge uten en ny, overordnet arkitekturrunde.
