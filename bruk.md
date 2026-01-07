# Bruk av fugleobservasjoner-prototypen

Kort oppsummert flyt slik den fungerer nå.

## 1. Start server og åpne siden

1. I prosjektmappen:
   - `python3 server.py`
2. Åpne `http://localhost:3000` i nettleseren.

## 2. Oppdater posisjon

1. Når du kommer til en lokalitet, trykk knappen **«Oppdater posisjon»**.
2. Godta posisjonstilgang i nettleseren.
3. Statuslinjen viser «Posisjon oppdatert», og kart-ikonet kan brukes til å åpne posisjonen i OpenStreetMap.
4. Stedsnavn-feltet under antall kan bli forhåndsutfylt (kan alltid overstyres manuelt).

Du må ha en gyldig posisjon før du kan lagre observasjoner.

## 3. Registrere arter raskt

For hver art du vil registrere:

1. **Søk etter art**
   - Skriv inn i **Art**-feltet til du ser riktig art i listen.
   - Bruk piltaster (↑/↓) og **Enter** for å velge, eller klikk med mus.
2. **Angi antall**
   - Når art er valgt flyttes fokus til **Antall**.
   - Skriv inn antall og trykk **Enter**.
   - Observasjonen (art + antall + posisjon + stedsnavn) legges til i listen nederst.
   - Fokus flyttes tilbake til **Art**-feltet, klar for neste art.
3. **Stedsnavn (valgfritt)**
   - Ligger under antall-feltet.
   - Kan komme fra automatisk oppslag, men du kan skrive inn ditt eget (f.eks. "Vikstranda, Østensjøvannet").
   - Verdien som står her når du trykker Enter i antall-feltet, brukes for den observasjonen.

## 4. Observasjonsliste og eksport

- Nederst vises **Liste over valgte arter**, gruppert per sted:
    - Hver blokk har en liten overskrift med stedsnavnet (f.eks. `Hylkje`, `Knarvik` eller `Uten stedsnavn`).
    - Under overskriften listes observasjoner som linjer på formen `antall × art`.
- Når det finnes minst én observasjon blir knappene **«Tøm liste»**, **«Kopier CSV»** og **«Last ned CSV»** aktive.
- Begge bruker samme format: en TSV/«CSV» som er tilpasset **Artsobservasjoner.no sitt importformat for fugl (versjon 2.20)**, med overskriftsrad (kolonner separert med TAB, slik Excel gjør):
   - `Artsnavn;Lokalitetsnavn;Superlokalitet;Nord;Øst;Nøyaktighet;Fra dato;Til dato;Fra klokkeslett;Til klokkeslett;Antall;Alder;Kjønn;Aktivitet;Kommentar (synlig for alle);Privat kommentar (kun synlig for deg selv);Skjul funn til dato;Medobservatør;Medobservatør;Medobservatør;Medobservatør;Medobservatør;Medobservatør;Medobservatør;Medobservatør;Medobservatør;Medobservatør;Bestemmelsesmetode;Natursystem;Beskriv natursystem;Livsmedium;Beskriv livsmedium;Art som livsmedium;Beskriv art som livsmedium;Dybde min;Dybde maks;Høyde min;Høyde maks;Andrehånds;Usikker artsbestemming;Ikke spontan;Interessant observasjon;Ikke gjenfunnet;Ikke funnet;Offentlig samling;Privat samling;Referansenummer i samling;Beskrivelse artsbestemming;Bestemt av;Bestemt av (fritekst);Bestemmelsesår;Bekreftet av;Bekreftet av (fritekst);Bekreftelsesår`
- I radene fylles automatisk inn:
   - **Artsnavn** (fra Artsobservasjoner-autocomplete)
   - **Lokalitetsnavn** (stedsnavnet du har satt)
   - **Fra dato** og **Til dato** (dagen observasjonen ble registrert)
   - **Antall**
   - Alle andre kolonner (inkludert koordinater) står tomme, slik at du kan fylle på koordinater, aktivitet, kommentarer m.m. i Excel/Sheets før du importerer i Artsobservasjoner.

Etter at du har eksportert og kontrollert at importen i Artsobservasjoner er ok, kan du bruke **«Tøm liste»** for å slette alle observasjonene fra denne økten (både i listen og i localStorage).

## 5. Lagring (localStorage)

- Hver gang du legger til en observasjon lagres hele observasjonslisten i nettleserens **localStorage**.
- Det betyr at:
   - Refresh av siden eller utilsiktet navigering bort (tilbake/forover) ikke sletter observasjonene.
   - Når du åpner siden på nytt i samme nettleser/enhet, lastes tidligere observasjoner inn igjen automatisk.
- Merk: localStorage er per nettleser/enhet, så observasjoner synkroniseres ikke mellom telefoner/PC-er.
