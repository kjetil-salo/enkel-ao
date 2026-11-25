# Nytt lokalitetsuttrekk

Dato: 2026-11-23. Plan og kjørebeskrivelse for et separat uttrekk. Produksjonsdatabasen skal fortsatt være reserve når AO feiler.

## Beslutninger

- Fellesuttrekket skal inneholde offentlige lokaliteter. Egne private lokaliteter hører fortsatt til den innloggede brukerens eksisterende flyt.
- Oppdag offentlige steder gjennom AO3s `Sites/ByBoundingBox`. Forkast rader med `isPrivate: true`; manglende privatstatus er en ukjent respons, ikke offentlig.
- Kontroller de offentlige kandidatene med AO2s innloggede `SubmitSighting/GetSite`. Bare eksplisitt `IsNotBirdSite: false`, `SiteSpeciesGroupId: 8` og `SiteIsPrivate: false` gir bekreftet offentlig fuglelokalitet.
- Lagre andre offentlige lokaliteter som undersøkte kandidater i arbeidsdatabasen, men eksporter bare bekreftede fuglelokaliteter til appens nye reservebase.
- Bygg en egen arbeidsdatabase og en ny eksportfil. Programmet erstatter eller endrer aldri eksisterende produksjonsdatabase.
- Behold Dagens Funn som løpende tilvekst. En ny import må ikke nullstilles av mangelfulle opplysninger fra denne skriveren.

## Verifisert grunnlag

Nåværende database hadde 522 748 rader, og 766 rader var lagt til siste uke. Alle hadde `is_private=0`, selv om fire av fem kontrollerte AO-private ID-er fantes blant dem. Ingen rad hadde `is_super=1`. `updated_at` er siste lokale skriving, ikke AOs endringstid.

AO3s råsvar mangler artsgruppe. Begge offentlige Revejordene-punktene, 2046694 og 2347042, finnes i dette svaret, men AO2 svarer `IsNotBirdSite: true`. For kontrollen 378818 svarer AO2 med artsgruppe 8 og offentlig status.

I kontrollområdet ga AO2s kartuttrekk de samme 18 unike offentlige fuglelokalitetene med og uten innlogging. Ett innlogget kartendepunkt returnerte duplikater. Innlogging gir derfor ikke dokumentert flere offentlige steder; fordelen er den uttrykkelige klassifiseringen og detaljene i `GetSite`.

Ingen verifisert delta basert på AOs endringstid er funnet. Maksimal lokalitets-ID og observasjonsdato er ikke pålitelige erstatninger.

## Alternativer

| Retning | Vurdering |
|---|---|
| Kjør gammel import på nytt | Viderefører feil privatmerking, mangler artsgruppe og kan miste steder ved resultatgrensen. |
| Bruk bare gammelt fuglekart | Færre kandidatoppslag, men landsdekning, grensebehandling og stille avkorting er ikke tilstrekkelig verifisert. |
| Ny oppdagelse og uttrykkelig kontroll av hver offentlig kandidat | Anbefalt. Flere kall, men tydelig skille mellom fugl, annen gruppe og ukjent. Gjenopptakbar Python-jobb gjør at den kan gå langsomt uten en aktiv AI-samtale. |

## Faser og krav

### F1: Separat og gjenopptakbar innhenting

Ny fil `tools/extract_ao_locations.py`. SQLite lagrer rutenett, fremdrift, offentlig rådata, bekreftelsestid og detaljrespons. Ingen nye pakker; bruk httpx og standardbiblioteket.

- Initialisering gjør ingen nettverkskall. Geografisk dekning velges uttrykkelig: fastlandet, Svalbard, Jan Mayen, alle tre eller en avgrenset pilotboks. Dekningen rapporteres som rektangler, ikke som en garanti om alle norske lokaliteter.
- Ett nettverkskall om gangen, standard minst to sekunders mellomrom, begrenset antall kall per kjøring og prosesslås mot overlappende cron.
- Del kartboksen når råsvaret treffer 1 000 rader, før private forkastes. Del også ved AOs uttrykkelige «bounding box too large»-feil. Er boksen fortsatt full ved minste tillatte størrelse (≈25 × 22 m), lagres det AO ga og boksen merkes `truncated` — i første runde var det én privat lokalitet lagt inn 1 000 ganger på samme punkt (Nordre Follo), og deling hjelper ikke da. Endret 24.11.2026; første versjon stoppet hele uttrekket.
- Fullført boks og kandidatdata lagres atomisk. Et avbrudd kan gjentas uten å miste eller dobbelttelle steder.
- Initialisering oppretter arbeidsfilen eksklusivt. Gjenopptak krever riktig skjema og samme lagrede dekning, endepunkter og klassifiseringsversjon. `LOCATION_DB_PATH` brukes aldri automatisk. Ingen `LocationDB`-konstruktør åpner en eksisterende fil.
- HTTP-feil, ugyldig JSON eller ukjent skjema er ikke et tomt område. Arbeidet står igjen til neste kjøring. Ved 429/5xx brukes en lagret pause før nye forsøk.
- En oppdaget rad uten eksplisitt privatstatus blokkerer fullføring av boksen; den hoppes ikke stille over. Ikke lagre steddata fra denne raden.
- Manglende passord eller utløpt innlogging kan ikke føre til at uinnlogget HTML registreres som fraværende lokalitet. Passord og cookies skal ikke inn i arbeidsdatabase, kommandolinje eller logger.

### F2: Innlogget klassifisering og eksport

- Innlogging begrenses til AO2 på HTTPS. Bruk miljøvariabler eller en uttrykkelig valgt lokal miljøfil. Interaktivt passord kan leses med getpass.
- Privat kandidat forkastes før lagring. Hvis AO2 senere sier privat, fjernes kandidatens lagrede steddata fra arbeidsbasen.
- `IsNotBirdSite: true` er bekreftet annen lokalitet. Feil, manglende felt eller motsigelser gir uavklart status, aldri fugl.
- Statusene er `pending`, `bird`, `other`, `unknown` og `private`. Transportfeil og autentiseringsfeil lar raden stå ventende. Et forståelig JSON-svar som ikke kan klassifiseres, blir `unknown` og kan prøves på nytt uttrykkelig. Eksport tillater ferdig undersøkte `unknown`-rader, men utelater dem og rapporterer antallet.
- Privatstatus fra detaljkontrollen har forrang: behold bare ID og status som sperre mot gjeninnsetting i samme runde; slett navn, koordinater og begge råsvar fra kandidaten.
- Behold AOs geografiske koordinater fra oppdagelsen; ikke tolk AO2s interne kartkoordinater som GPS. Ta vare på nøyaktighet, forelder, kommune/fylke, områder og kontrolltid der de finnes.
- Eksport krever fullført rutenett og ferdig behandling av kandidatene. Ingen tom eksport, ingen overskriving av en eksisterende eksportfil. Eksporten følger appens `locations`-skjema og har en separat metadatatabell.
- Metadatatabellen er per `ao_id` og inneholder bekreftet fugletilknytning, kontrolltid, nøyaktighet, kilde for superstatus og de offentlige kildeopplysningene. En egen tabell beskriver dekning og uttrekksversjon.
- Superstatus kan utledes fra dokumenterte forelderreferanser, men skal merkes som utledet. Et offentlig punkt uten forelder er ikke automatisk en fuglesuperlokalitet.

### F3: Pilot, kontroll og senere innfasing

Kjør først et lite område med Revtangen, Revejordene og kjente kontrollsteder. Mål antall kandidater, fordeling offentlig/privat, fugl/annen/ukjent og faktisk tidsbruk. Bruk dette til et realistisk estimat før landsuttrekket. Avkorting og grensepunkter skal også kontrolleres mot mindre, overlappende bokser; dedupliser på ID. At API-et godtar `maxSites=1000`, er ikke et bevis på at enhver stille avkorting kan oppdages.

Kjør mocktester for avkorting, private og ukjente rader, gjenopptak, endret privatstatus, utløpt innlogging, 429 og feil midt i en transaksjon. Kjør backend-suiten. Ingen frontendendring eller SW-/versjonsbump er nødvendig for selve verktøyet.

**Den eksisterende lokalitetsbasen skal ALDRI slettes** (eierens beslutning 2026-11-23). Den bevares som referanse også etter en innfasing, og innfasing betyr å bytte hvilken fil appen peker på, ikke å slette den gamle. **Private lokaliteter hentes, men eksponeres ikke** (eierens beslutning 2026-11-23, endret underveis i runden): datasettet skal ikke høstes flere ganger, så alt AO3 returnerer tas vare på. Private rader lagres i en egen tabell, `private_sites`, i arbeidsbasen, med `source='ao3'`, eller `'ao2-detail'` når AO2-kontrollen viser at en antatt offentlig lokalitet er privat. De blir aldri kandidater og aldri med i eksporten, og tester håndhever det. Om de skal brukes senere, for eksempel som navneforslag ut fra navn flere har valgt, er en egen beslutning. Arbeidsbasen inneholder dermed personopplysninger og skal behandles deretter: den har filrettighet 0600, ligger utenfor git, og skal ikke deles eller deployes som den er. Boksene som var ferdige før endringen, ble satt tilbake og hentet på nytt for å få med de private.

Produksjonsinnfasing er en egen operasjon etter kontroll av eksporten og godkjenning fra eieren. Før innfasing må begge appenes skrivere bevare bekreftet metadata. Ikke bytt ut en aktiv WAL-databasefil mens appene skriver, og ikke mist Dagens Funn-rader som kom under uttrekket. Ta SQLite-backup og sammenlign gammel og ny base først. Fravær i ett uttrekk betyr ikke automatisk sletting.

## Erfaringer fra første kjøring (23.11.2026)

**Pilot (Revtangen/Revejordene/Orre, 5.48–5.62 Ø / 58.72–58.80 N):** 158 offentlige kandidater, 144 fugl og 14 annen, 0 ukjent. Kontrollstedene stemte: Revejordene 2046694/2347042 er `other`, og 378818 er `bird`. Om lag 95 % av radene AO3 returnerte var private.

**Kontroll med overlappende bokser:** samme område med 36 bokser omtrent 1/6 så store, med forskjøvne kanter, ga nøyaktig de samme 158 ID-ene. Inndelingen mister ingenting på grensene.

**`maxSites` er ikke et fast tak:** AO3 returnerte 1058 og 1011 rader med `maxSites=1000`. Inndelingen ved ≥1000 fanget det, men taket kan ikke brukes som bevis på avkorting.

**«BoundingBox too large» avhenger av breddegraden:** AO avviser 0,4 × 0,2 grader nord for ~63,5° N, trolig fordi arealet måles i Web Mercator. Oppdelingen løser det automatisk, men koster ett avvist kall per startboks. Svalbard ville trengt to oppdelinger, ca. 47 000 kall. **Forbedring til neste runde:** gjør startboksene mindre mot nord i `initialize()`.

**Tempo (`run --adaptive`):** starter på 1,0 s mellom kall og trappes ned til gulvet på 0,25 s. Et svar på over 1,5 s gjør pausen 50 % lengre, og 429/5xx dobler den og gir 15 minutters pause. Tempoet lagres i arbeidsbasen. Målt: ~3,9 kall/s, gjennomsnittlig svartid 0,05–0,08 s, og ingen 429 etter flere tusen kall. Løkken `data/uttrekk/kjor.sh` kjører porsjoner på 1000 kall til alt er ferdig.

**Fastlandsrektangelet dekker også Sverige og Finland.** Det koster noen tusen kall som gir tomme svar, men lite tid.

## Utsatt: Svalbard

Svalbard (10.0–35.0 Ø / 74.0–81.1 N) er **tatt ut av runden 2026-11** for å spare ~47 000 kall i et område med få lokaliteter. Boksene ligger i arbeidsbasen med `state='skipped'`, og `metadata.skipped_regions` forklarer hvorfor. Når det skal tas senere: kjør en egen runde med `init --region svalbard`, helst med mindre startbokser mot nord (se over), og slå eksporten sammen med fastlandseksporten på `ao_id`. Jan Mayen er med i denne runden.

## Senere vedlikehold

Anbefalt: en langsom jobb i avgrensede porsjoner. Målet kan være en ny runde omtrent månedlig, men budsjettet må først beregnes som (oppdagelseskall + antall offentlige kandidater + innloggingskall) / tilgjengelige dager. Dagens 522 748 rader er ikke et kjent antall offentlige kandidater, siden den gamle importen overskrev privatstatus. Noen hundre kall daglig kan være altfor lite; månedlig ferdigstillelse loves ikke før omfanget er målt. En månedlig kjøring og en langsom jobb gjør det samme arbeidet totalt; den langsomme fordeler belastningen og tåler AO-nedetid bedre.

En ny runde skal opprette ny arbeidsdatabase og eksportfil. Den gamle ferdige eksporten bevares mens den nye runden kjører. Dagens Funn legger fortsatt til nye steder mellom rundene; nye steder er uavklarte til metadata er kontrollert.

Ingen cron, automatisk produksjonsbytte eller landsdekkende kjøring installeres som del av programleveransen.

## Drift etter første runde (25.11.2026)

Eksporten (`fugl-2026-11.db`, 77 747 bekreftede fuglelokaliteter) ble grunnlaget for egne baser i
staging (`data/staging-locations.db`) og prod (`/data/locations-fugl.db`), utvidet med steder Dagens
Funn har sett i åpne funn (`is_private=1`, vises bak «andres private»). AO3-rådata (polygon,
nøyaktighet) ligger i `location_metadata`. Med `KART_FRA_LOKAL_DB=1` svarer `/api/ao-sites` fra basen
(≈0,3 s mot 1,7–3,7 s); brukerens egne lokaliteter hentes fra AO i bakgrunnen (`kilde=egne`) og
polygonene huskes i nettleseren.

`tools/vask_lokaliteter.py` holder basene ferske hver natt: nye steder fra Dagens Funn sjekkes med
`GetSite`, og 2 000 private i rotasjon fanger steder komiteen senere gjør offentlige. Den gamle
`/shared/locations.db` er urørt og beholdes som referanse. Prosessen er forklart steg for steg i
Obsidian: `02-projects/enkel-ao/lokalitetsuttrekk-prosess.md`. Gjenstående: TODO #49.
