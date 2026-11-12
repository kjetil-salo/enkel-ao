# Design for overføring av arbeidslista

## Nåsituasjon

`public/js/storage.js` lagrer den private arbeidslista i `fugleobservasjoner_v1`.
Ved aktiv fellestur peker de samme funksjonene på turens delte speil.
`public/js/observation-commit.js` og redigeringsmodalen bygger observasjonsdata,
og `public/js/export-operations.js` bruker den lokale lista for AO-publisering.

`/api/ao-login` verifiserer brukernavn og passord mot AO og returnerer AO-tokens.
Prefikset som klienten kaller `userId` kan variere ved ny innlogging. Se
korreksjon 3 i `docs/ao-token-autentisering.md`. Planen for synk av innstillinger
fra juli 2026 bygger på den eldre antakelsen om at dette prefikset er stabilt.

## Beslutninger

### 1. Overfør én privat kopi med et bevisst valg

Legg handlingene «Fortsett på en annen enhet» og «Hent liste fra en annen enhet»
i ⋯-menyen på både mobil og Mac. Når brukeren åpner overføring, hent metadata for kontoen.
Lagring viser en kvittering og neste steg på den andre enheten. Hvis en kopi
finnes, vis lagringstid og antall før brukeren bekrefter erstatning. Dersom
overføringen skjer etter registrering over flere dager, viser perioden hvilke
dager som følger med. «Siste» betyr den sist lagrede kopien av hele lista.
Vis hvilken verifisert konto som mottar kopien, også for lister registrert
offline uten kontotilknytning. Sammenlign den synlige lista med lokalt lagret
liste før opplasting og forklar et avvik før brukeren går videre.

Mac viser en lesbar forhåndsvisning med samme besøk og felt som arbeidslista.
Brukeren kan deretter hente kopien inn i den vanlige redigeringen. Vis kildens
enhetsnavn, lagringstid og teksten «Lista finnes fortsatt på den andre enheten.
Publiser bare fra én enhet.» Ved lokal innhenting anbefales det å slette
serverkopien når den er ferdig brukt. Lagring på kilden eller AO-publisering
oppdaterer kun sine egne data. Forhåndsvisningen viser et øyeblikksbilde.

Valget gir et enkelt startpunkt for offline-appen. Automatisk lagring ville
også kreve regler for når en enhet kan erstatte en annens kopi. Filflytting
finnes allerede under «Sikkerhetskopi» i Innstillinger. Henvis dit når
brukeren trenger å ta vare på mottakerens eksisterende liste.

### 2. Bind overføringstilgang ved verifisert AO-innlogging

Start med å bekrefte hvilken kontoidentitet AO kan gi i en autentisert sesjon.
Foretrekk en stabil AO-kontonøkkel hentet på serveren fra den verifiserte
sesjonen. Det første forsøket kan bruke verifisert innloggingsnavn dersom
undersøkelsen bekrefter at navnet er unikt, kanonisk og egnet som eiernøkkel.
Kontroller med to separate innlogginger for samme konto og en annen konto.
Vurder aliaser, store/små bokstaver og hva som skjer ved navnebytte eller
gjenbruk av innloggingsnavn. Prøv også en konto uten tidligere funn, siden
aliasoppslaget i `src/ao_sightings.py` trenger en observasjonsrad. Funnene
avgjør nøkkelen før lagring bygges.

AO viste samme `EditUser.User.Id` fra `GET /User/EditMyProfile` ved to
separate innlogginger med den aktiverte testkontoen 2026-11-11. Prefikset i
AO-tokenet endret seg. Feltet hentes med cookien fra den ferske innloggingen,
og aliaset fra samme profilside brukes som visningsnavn. Isolasjon mot annen
konto testes med en separat profil i den lokale AO-mocken.

Gjenbruk den eksisterende AO-innloggingen fra `/api/arbeidsliste-overforing/innlogging`
til å utstede et eget tilfeldig overføringstoken med 24 timers levetid.
Lagre hash, kontonøkkel og utløp server-side.
Overføringsrutene leser eier utelukkende fra den validerte sesjonen og avgrenser
alle databaseoperasjoner til eieren. Klienten sender tokenet i
`Authorization`-headeren. Lagring og henting med en gyldig lokal sesjon gir
null AO-kall. Tilgang via AO-tokens kopiert inn manuelt krever bekreftet
AO-innlogging før et overføringstoken kan utstedes.

Klienten lagrer tokenet for enheten separat fra arbeidslista. Ved kontobytte
eller utlogging fjernes lokal tilgang, åpne forhåndsvisninger og pågående
forespørsler. Revoker sesjonen server-side når nett er tilgjengelig. Forkast
svar fra en tidligere kontokontekst, også svar fra innlogging som ble startet
før utlogging. Brukernavnredigering og bytte av manuelle AO-tokens teller som
kontokontekstendring. Synkroniser sperren mellom faner og sjekk konteksten
ved gjenåpning fra nettleserens tilbakebuffer. Ved manglende sesjon kan
overføringsflyten gjenbruke eksplisitt AO-innlogging. Serverens lagrede
AO-passord inngår kun i eksisterende flyt.

Et oppslag mot AO for hver overføring ville gjøre privat lagring avhengig av
AOs tilgjengelighet og øke trafikken. Serverutstedt tilgang kan utløpe og
trekkes tilbake lokalt. `X-AO-Username`, `X-AO-User-Id`, prefikset i tokenet og
manuelt oppgitte konto-ID-er er klientdata og kan aldri gi tilgang.

### 3. Versjonert payload i SQLite

Bruk egne tabeller i eksisterende `DB_PATH` på det vedvarende volumet.
Kopitabellen har én rad per eier med servergenerert kopi-ID, versjon,
skjemaversjon, lagrings- og utløpstid, kort kildeetikett og payload. Beregn
antall og periode fra det godkjente innholdet. Bruk parameterisert SQL og
transaksjoner for skriving og sletting. Legg inn en indeks for utløpsrydding.

Bruk `GET /api/arbeidsliste-overforing` for metadata og en egen GET for
innhold ved åpning. Bruk POST for lagring og sletting etter dagens ruting.
Sjekk kopi-ID-en mot serveren når brukeren velger innhenting. Bare kopien som
er aktiv ved den sjekken kan skrives til lokal lagring. Lukk forhåndsvisningen
ved slettet, utløpt eller erstattet kopi og vis gjeldende serverstatus.
Bruk kopi-ID/versjon som vilkår for erstatning og sletting. Ved opprettelse
gjelder vilkåret at kontoen mangler aktiv kopi. Sjekk vilkåret og endre raden i
samme transaksjon. En klientgenerert forsøksnøkkel knytter en gjentakelse til
samme lagringskvittering. Behold små kvitteringsrader med utløp også etter at
kopien er erstattet eller slettet. En gammel kvittering viser at forsøket ble
bekreftet da, og klienten henter gjeldende status på nytt.

Valider skjema og versjon rekursivt. Lag en eksplisitt liste over støttede
felter etter gjennomgang av commit, redigering, fellestur-til-privat,
lokalitetsmodell og eksport. Bevar rekkefølge, gamle valgfrie felt, lokal
tidsrepresentasjon, `position`, `placeId`, `visitId`, `visitLocked`,
medobservatører, `hideUntil`, `privateComment`, `photo` og `sentTs`. Nytt eller
uventet observasjonsinnhold som ikke kan overføres tapsfritt gir avvisning med
forklaring. Eksporter fra observasjonsmodellen. Klientinnstillinger, kartcache,
innloggingsdata, klientens historikk over AO-sendinger og delinger ligger
utenfor payloaden. Deling- og fellesturfiltrene utelater flere felt denne
overføringen trenger, blant annet koordinater og bilder.

Fastsett grenser etter å ha målt de største listene som dagens app kan lagre
med bilder og prøvd samtidige forespørsler lokalt. Ta med base64-kostnad og
minneforbruk på Pi. Sett egen body-grense i `_MAX_BODY_PER_PATH` før lesing,
valider antall, bildeformat, bilde- og tekststørrelse og sett kvoter per konto
og globalt. Vis grensen før opplasting der det er mulig. Feil beholder hele
forrige kopi. Gjør en lesesjekk på utløp og rydd utløpte rader periodisk, også
ved lav trafikk. Avklar levetid for eventuelle sikkerhetskopier av volumet.

Lagerfasen bruker foreløpige grenser på 2 000 rader, 2 MiB observasjonstekst,
4 MiB base64 per JPEG og 8 MiB samlet payload. Aktivt innhold har en samlet
servergrense på 256 MiB. En måling med 300 testrader og to JPEG-er med mye
syntetisk støy på 1600 × 1067 ga 5,43 MB JSON. Test mot reell mobil og Mac må
fortsatt bekrefte lagringsgrensene. Serveren kontrollerer JPEG-struktur og
dimensjoner. Forhåndsvisningen i nettleseren må også håndtere dekodingsfeil.

API-svar for denne flyten får `Cache-Control: no-store`. Service worker og
mellomlagring må respektere dette. Bruk ingen private payloads, koordinater
eller tokens i URL-er, logger eller statistikk. Forhåndsvis brukerdata som
tekst og valider bildeformat før visning. Test at globale CORS- og cachevalg
i `server.py` ikke åpner de private rutene for andre origins.

### 4. Bruk den lokale lista til redigering og publisering

Sjekk aktiv fellestur, kontokontekst, lagret liste og eventuelle ulagrede
endringer i visningen rett før innhenting. En uleselig liste er en egen
tilstand. Bruk en eksplisitt privat lagringsoperasjon med revidert tilstand
som vilkår. Fellestur-speilet har egen lagringsvei. Ved aktiv fellestur viser
handlingen veien via «kopier til privat liste» i dagens app.

Behandle innhenting og andre lokale listeendringer med samme revisjonssjekk
og koordinering mellom faner. Kartlegg både `saveObservations` og direkte
skriving fra Innstillinger, medobservatør-sidene og `ao-direct.html`. Bind
utsatt tømming til revisjonen som ble sendt. Ved konflikt skal appen ta vare
på både gjeldende liste og endringen i fanen som prøvde å lagre. Vis ny liste
først etter bekreftet lagring. Verifiser også overgangen fra en eldre PWA-fane
som mangler revisjonssjekken. Hvis gjeldende nøkkel ikke kan beskyttes i
overgangen, må innhentet innhold ligge på en egen lagringsnøkkel til fanen er
oppdatert.

Implementasjonen lagrer innhentet liste under en egen nettlesernøkkel og
bruker Web Locks for å gi én fane om gangen skrivetilgang. Eldre faner kan
fortsatt skrive til den ordinære lista, som kan åpnes fra samme meny.
På en nettleser uten Web Locks er serverkopien tilgjengelig i forhåndsvisning.

Lagre kontonøkkel, kopi-ID og kopitid som lokal metadata sammen med innhentet
liste. Metadata følger lista ved redigering, omlasting og gjenoppretting.
Vis før innhenting at lista lagres i den aktuelle nettleserprofilen og kan
åpnes der offline. Ved kontobytte bevares lokale data. Hver direkte AO-
inngang må bekrefte at kontoen for sesjonen som faktisk skal sende, er samme
eier. Ved en annen eller ubekreftet konto vises veien tilbake til eierens
innlogging.

Vis en egen bekreftelse før direkte sending fra en innhentet liste, gjerne
sammen med eksisterende dublettadvarsel. Vis kopitid og be brukeren sjekke AO
hvis funn kan ha vært sendt fra kilden eller en tidligere sending manglet full
kvittering. Dagens delvise AO-svar kan returnere før `sentTs` settes. Nye
sendemarkeringer på kilden finnes bare der. Bekreftelsen reduserer risikoen
for dobbel innsending. En automatisk sperre på tvers av enheter ville kreve
felles sendehistorikk.

### Trinn 2 – overføring med engangskode

Prøv innlogget flyt først. Hvis det er vanlig å ville overføre før AO-innlogging,
kan «Lag engangskode» opprette en separat midlertidig kopi. På Mac skriver
brukeren koden i «Hent med kode» og får samme forhåndsvisning og lokal innhenting.
Foreslå tilfeldig kode på 12 tegn fra et entydig alfabet, vist i grupper,
med 24 timers levetid. Koden sendes i request-body, lagres som hash og
gir tilgang kun til den ene kopien. Alle med koden kan bruke den mens den er
aktiv. Kvote per klient og globalt, grenser for samlet lagring, generisk svar
for feil/utløpt/brukt kode og opprydding må være på plass før den åpnes.

Sikre én innløsning med en kort reservasjon og en kvittering etter vellykket
lokal lagring. Samme klient må kunne gjenta bekreftelsen hvis svaret forsvinner.
Ved lokal lagringsfeil utløper reservasjonen slik at brukeren kan prøve igjen.
En kort numerisk PIN krever et ekstra hemmelig element, som en QR- eller
kopierbar lenke. Avklar levetid, metode og den anonyme tilgangsmodellen i en
egen spesifikasjon når trinn 2 prioriteres.

## Verifisering og innføring

Start med en identitetsprøve som bare leser kontoinformasjon. Bruk en lokal
AO-mock for automatiserte tester og to separate nettleserkontekster for E2E.
Prøv deretter en reell mobil/PWA og Mac mot staging med egen testliste.
Verifiser lagring, forhåndsvisning, innhenting, bilder og tilgjengelighet
etter omstart. Staging og produksjon bruker hvert sitt lagringsvolum.

Konfigurasjonsflagget `ARBEIDSLISTE_OVERFORING=0` deaktiverer private ruter
og skjuler overføringshandlinger i dialogen. Ved tilbakeføring bevares lokale lister. Følg
repoets vanlige releaseflyt for service worker og frontend-cache. Eieren
styrer utrulling.
