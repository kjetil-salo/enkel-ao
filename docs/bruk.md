# Bruk av fugleobservasjoner-prototypen

Kort oppsummert flyt slik den fungerer nå.

> **💡 Trenger du rask hjelp?** Det finnes også en enkel hjelpeside tilgjengelig fra hovedsiden (📖-ikonet øverst til høyre) med oversiktlig brukerveiledning.

## 1. Start server og åpne siden

1. I prosjektmappen:
   - `python3 server.py`
2. Åpne `http://localhost:3000` i nettleseren.

## 2. Oppdater posisjon og søkeområde

1. Når du kommer til en lokalitet, trykk knappen **«Oppdater posisjon»**.
2. Godta posisjonstilgang i nettleseren.
3. Statuslinjen viser «Posisjon oppdatert», og kart-ikonet kan brukes til å åpne posisjonen i OpenStreetMap.
4. I feltet **«Søkeområde (meter)**» kan du styre hvor stort kvadrat vi spør Artsobservasjoner om lokasjoner innenfor. GPS-posisjonen er midtpunktet, og tallet er kantlengden i meter (f.eks. 600 = 600 × 600 m kvadrat).
5. **Stedsnavn-feltet** fylles automatisk med nærmeste lokalitet fra Artsobservasjoner hvis den finnes. Du kan alltid overstyre manuelt.

> 🔥 **Lokasjonsfinneren er gull verdt!** Spesielt på nye og ukjente steder. Tidligere måtte du gjerne gjette stedsnavn når du kom hjem og kikket på kartet. Nå får du riktig lokalitet automatisk.

Det er anbefalt å oppdatere posisjon, men du kan også registrere observasjoner uten at posisjon er tilgjengelig (da brukes bare stedsnavnet i eksporten).

> **Personvern og lagring:** Serveren lagrer ingen observasjoner eller brukerdata. Alt du legger inn lagres kun midlertidig i nettleseren din (localStorage) til du eksporterer eller tømmer lista.

## 3. Registrere arter raskt


For hver art du vil registrere:

1. **Søk etter art**
   - Skriv inn i **Art**-feltet til du ser riktig art i listen.
   - Bruk piltaster (↑/↓) og **Enter** for å velge, eller klikk med mus.
   - <b>Vis underarter</b>-boksen er kun tilgjengelig når du er online. I offline-modus er boksen deaktivert og du får en diskret advarsel med gult ikon under boksen: <span style="color:#eab308;font-size:0.95em;">&#9888;&#65039; Underarter støttes ikke i offline-modus.</span>
   - Dette er for å sikre at eksporten alltid matcher AO sitt importformat og for å unngå feil navn.
2. **Angi antall**
   - Når art er valgt flyttes fokus til **Antall**.
   - Skriv inn antall og trykk **Enter**.
   - Fokus flyttes videre til **Aktivitet**.
3. **Velg aktivitet og lagre**
   - Standardverdi er **Stasjonær**.
   - Du kan velge en annen aktivitet i nedtrekksmenyen.
   - For å lagre observasjonen kan du enten:
     - trykke **Enter** mens du står i aktivitet-feltet (desktop),
     - eller trykke på den **grønne ✓‑knappen** til høyre for aktivitetsfeltet (spesielt praktisk på mobil),
     - eller bare endre verdien i aktivitetsfeltet på mobil, som også utløser lagring.
   - Etter lagring nullstilles art/antall/aktivitet, søkefeltet tømmes, og fokus flyttes tilbake til **Art**-feltet, klar for neste art.
4. **Stedsnavn (valgfritt, men anbefalt)**
   - Ligger under lokasjonsseksjonen.
   - Kan komme fra automatisk oppslag, men du kan skrive inn ditt eget (f.eks. "Vikstranda, Østensjøvannet").
   - Verdien som står her når du trykker Enter i antall-feltet, brukes for den observasjonen.

## 4. Observasjonsliste og eksport

- Nederst vises **Liste over valgte arter**, gruppert per sted:
   - Hver blokk har en liten overskrift med stedsnavnet (f.eks. `Hylkje`, `Knarvik` eller `Uten stedsnavn`).
   - Under overskriften vises en tabell med kolonnene **Art**, **Antall**, **Aktivitet** og en 🗑️-knapp.
   - Du kan slette én observasjon ved å trykke på 🗑️-ikonet til høyre for raden.
- Når det finnes minst én observasjon blir knappene **«Tøm liste»**, **«Kopier CSV»**, **«Kopier og åpne AO»** og **«Last ned CSV»** aktive.
- Alle eksportknappene bruker samme format: en TSV/«CSV» som er tilpasset **Artsobservasjoner.no sitt importformat for fugl (versjon 2.20)**, med overskriftsrad (kolonner separert med TAB, slik Excel gjør):
- **«Kopier og åpne AO»** kopierer CSV-dataene til utklippstavlen og åpner Artsobservasjoner-importskjemaet i en ny fane, så du kan lime inn direkte.
   - `Artsnavn;Lokalitetsnavn;Superlokalitet;Nord;Øst;Nøyaktighet;Fra dato;Til dato;Fra klokkeslett;Til klokkeslett;Antall;Alder;Kjønn;Aktivitet;Kommentar (synlig for alle);Privat kommentar (kun synlig for deg selv);Skjul funn til dato;Medobservatør;Medobservatør;Medobservatør;Medobservatør;Medobservatør;Medobservatør;Medobservatør;Medobservatør;Medobservatør;Medobservatør;Bestemmelsesmetode;Natursystem;Beskriv natursystem;Livsmedium;Beskriv livsmedium;Art som livsmedium;Beskriv art som livsmedium;Dybde min;Dybde maks;Høyde min;Høyde maks;Andrehånds;Usikker artsbestemming;Ikke spontan;Interessant observasjon;Ikke gjenfunnet;Ikke funnet;Offentlig samling;Privat samling;Referansenummer i samling;Beskrivelse artsbestemming;Bestemt av;Bestemt av (fritekst);Bestemmelsesår;Bekreftet av;Bekreftet av (fritekst);Bekreftelsesår`
- I radene fylles automatisk inn:
   - **Artsnavn** (fra Artsobservasjoner-autocomplete)
   - **Lokalitetsnavn** (stedsnavnet du har satt)
   - **Fra dato** og **Til dato** (dagen observasjonen ble registrert)
   - **Fra klokkeslett** og **Til klokkeslett** (format `HH:MM`, f.eks. `08:30`)
   - **Antall**
   - **Aktivitet** (tekstetiketten fra aktivitetsfeltet, f.eks. «Stasjonær», «Rastende» osv.)
- Alle andre kolonner (inkludert koordinater) står tomme, slik at du kan fylle på koordinater, kommentarer m.m. i Excel/Sheets før du importerer i Artsobservasjoner.

Etter at du har eksportert og kontrollert at importen i Artsobservasjoner er ok, kan du bruke **«Tøm liste»** for å slette alle observasjonene fra denne økten (både i listen og i localStorage).

## 5. Lagring (localStorage)

- Hver gang du legger til en observasjon lagres hele observasjonslisten i nettleserens **localStorage**.
- Det betyr at:
   - Refresh av siden eller utilsiktet navigering bort (tilbake/forover) ikke sletter observasjonene.
   - Når du åpner siden på nytt i samme nettleser/enhet, lastes tidligere observasjoner inn igjen automatisk.
- Merk: localStorage er per nettleser/enhet, så observasjoner synkroniseres ikke mellom telefoner/PC-er.

## 6. Lokaliteter fra Artsobservasjoner (AO-sites)

Når du trykker **«Oppdater posisjon»** hentes også lokale **lokaliteter** fra Artsobservasjoner sitt mobil-API:

- Under stedsnavn-feltet vises en linje med **«Forslag fra Artsobservasjoner»** og opptil 5 forslag.
- Hvert forslag er en liten «pill» med lokalitetsnavn (AO sitt `name`-felt).
- Klikk på en pill for å bruke dette navnet som **Lokalitetsnavn** for senere observasjoner.
- Private lokaliteter (AO sitt `isPrivate == true`) vises til slutt i lista og er nedtonet/deaktivert; offentlige lokaliteter vises først og kan velges.

### Viktig: navnekollisjoner og favorittplasser

Artsobservasjoner har mange lokaliteter med samme **name** innenfor et område. Eksempel: «Byparken» finnes flere steder i Bergen-området, med litt ulike koordinater og presisjon.

Når du limer inn eksporten vår i importskjemaet til Artsobservasjoner, vil AO forsøke å matche kolonnen **Lokalitetsnavn** mot eksisterende lokaliteter. Dersom det finnes flere lokaliteter med samme navn, er det i praksis litt tilfeldig hvilken som blir valgt – *med mindre* du har definert favorittplasser.

**Anbefaling:**

- Logg inn på **Artsobservasjoner.no** og gå til lokalitetssiden din.
- Legg til de lokalitetene du faktisk bruker i felt som **favoritter**.
- Når du senere importerer TSV/CSV med lokalitetsnavn som matcher en av favorittplassene dine, vil Artsobservasjoner typisk velge *den* varianten først.

Dette er spesielt viktig for vanlige navn som «Byparken», «Skoleplassen», «Kirkegård» osv., der det finnes flere varianter med samme navn innenfor samme kommune.

---

# Kort brukerveiledning for observatører

Dette er en kort, praktisk veiledning ment for deg som bare skal bruke siden til å registrere fugler (ikke installere eller drifte den).

## Hva siden gjør

- Hjelper deg å **notere fugleobservasjoner raskt i felt**.
- Slår opp arter mot **Artsobservasjoner** slik at navnene blir riktige.
- Samler observasjonene dine i en liste som du kan **kopiere/eksportere** til Artsobservasjoner sitt importskjema.

## Steg 1: Gå til siden

- Du får en lenke (for eksempel `http://…/fugleobservasjoner`).
- Åpne lenken i nettleseren på mobil eller PC.

## Steg 2: Oppdater posisjon

1. Når du kommer til et nytt sted, trykk **«Oppdater posisjon»**.
2. Godta at nettleseren får bruke posisjon.
3. Prikken ved «Lokasjon» blir grønn når posisjonen er oppdatert.
4. Under lokasjon ser du:
   - **Søkeområde (meter)** – størrelsen på området vi leter etter lokaliteter i (kan du la stå som den er).
   - **Stedsnavn** – navnet på stedet. Dette kan foreslås automatisk, men du kan alltid skrive det du selv ønsker.
5. Under stedsnavn kan det dukke opp **forslag fra Artsobservasjoner**. Klikk på et forslag for å bruke navnet derfra.

Tips: Bruk et stedsnavn du også kjenner igjen når du seinere ser lista i Artsobservasjoner (for eksempel «Byparken, Bergen sentrum»).

## Steg 3: Registrer arter, antall og aktivitet

For hver art du vil registrere:

1. **Søk etter art**
   - Skriv i feltet **Art** (for eksempel «blåmeis», «gråmåke» …).
   - Bruk piltaster (↑/↓) og **Enter** for å velge riktig art, eller trykk på den med fingeren/musa.
2. **Angi antall**
   - Når art er valgt, hopper fokus til feltet **Antall**.
   - Skriv hvor mange du ser, og trykk **Enter**.
   - Fokus flyttes videre til **Aktivitet**, men ingenting er lagret ennå.
3. **Velg aktivitet og lagre**
   - Standard er **Stasjonær**, men du kan velge hvilken som helst aktivitet i nedtrekksmenyen.
   - For å lagre observasjonen kan du:
     - trykke **Enter** mens du står i aktivitetsfeltet (på PC),
     - eller trykke på den **grønne ✓‑knappen** til høyre for aktivitetsfeltet (anbefalt på mobil).
   - Når observasjonen er lagret, dukker den opp i tabellen nederst under riktig stedsnavn, og art/antall/aktivitet nullstilles. Fokus går tilbake til **Art**.

Du kan gjenta dette så mange ganger du vil på samme sted. Når du flytter deg til en ny lokalitet, trykk **«Oppdater posisjon»** igjen og eventuelt endre stedsnavn.

## Steg 4: Se over lista og eksportere

- Nederst ser du en liste gruppert per **stedsnavn**.
- Under hvert stedsnavn vises en tabell med kolonnene **Art**, **Antall** og **Aktivitet**.
- Når du har registrert alt på turen/økten kan du:
  - Bruke **«Kopier CSV»** for å kopiere alt til utklippstavla.
  - Eller **«Last ned CSV»** for å få en fil.

### Videre inn i Artsobservasjoner

1. Gå til Artsobservasjoner sitt **importskjema for fugl**.
2. Lim inn eller last opp fila fra denne siden.
3. Sjekk at kolonnene stemmer (artsnavn, lokalitetsnavn, dato, antall).
4. Fyll eventuelt inn flere detaljer (aktivitet, kommentarer, osv.) der.

## Viktig tips om lokaliteter i Artsobservasjoner

- Mange lokaliteter har **samme navn** (for eksempel «Byparken» på flere forskjellige steder).
- Når du importerer, kan Artsobservasjoner velge «feil» lokalitet hvis navnet finnes flere ganger.
- For å få mer forutsigbar oppførsel:
  - Logg inn på Artsobservasjoner.no.
  - Finn lokalitetene du bruker ofte, og merk dem som **favoritter**.
  - Da vil Artsobservasjoner oftere velge «din» variant når navnet kolliderer med andre.

Selve felt-appen her vet ikke hvilken av flere like navn som er «din» plass – den sender bare med navnet. Hvordan dette tolkes bestemmes av Artsobservasjoner.
