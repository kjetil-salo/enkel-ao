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
- Når det finnes minst én observasjon blir knappen **«Last ned CSV»** aktiv.
- Ved klikk lastes en fil `fugleobservasjoner.csv` ned med kolonnene:
  - `taxonid;navn;antall;sted;lat;lon`
\
CSV-en er ment som et mellomformat som senere kan tilpasses direkte til Artsobservasjoner sitt importformat.

## 5. Lagring (localStorage)

- Hver gang du legger til en observasjon lagres hele observasjonslisten i nettleserens **localStorage**.
- Det betyr at:
   - Refresh av siden eller utilsiktet navigering bort (tilbake/forover) ikke sletter observasjonene.
   - Når du åpner siden på nytt i samme nettleser/enhet, lastes tidligere observasjoner inn igjen automatisk.
- Merk: localStorage er per nettleser/enhet, så observasjoner synkroniseres ikke mellom telefoner/PC-er.
