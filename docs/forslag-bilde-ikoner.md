# Forslag til bildeikoner for Enkel-AO

Begge ikonene bruker samme enkle kameraform med avrundede linjer og en
strektykkelse på 1,9. Indikatoren er et rent kamera: rolig og lett å kjenne
igjen i listen over tidligere sendte funn. Handlingsikonet har en tydelig,
utfylt pluss-badge nederst til høyre. Kamerakonturen stopper før badgen, slik
at de to formene ikke flyter sammen ved 18–22 px.

Kameraet og badgen arver tekstfargen gjennom `currentColor`. Plusstegnet er
skåret ut av sirkelen med `fill-rule="evenodd"`, slik at bakgrunnen synes
gjennom og gir kontrast i både lyst og mørkt tema. Ingen ekstra DOM-elementer,
posisjonering, masker eller unike SVG-ID-er er nødvendig.

## Ikon 1: har-bilde-indikator

SVG-en har et tilgjengelig navn og skal vises uten knapp eller klikkhandling.

```svg
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 24 24" width="20" height="20"
     fill="none" stroke="currentColor" stroke-width="1.9"
     stroke-linecap="round" stroke-linejoin="round"
     role="img" aria-label="Har bilde" focusable="false">
  <path d="M9 4h6l2 3h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3z"/>
  <circle cx="12" cy="13" r="3.5"/>
</svg>
```

## Ikon 2: legg-til-bilde-knapp

SVG-en plasseres i knappen som åpner opplastingsdialogen. Knappen får
`aria-label="Legg til bilde"`; selve SVG-en er derfor skjult for skjermlesere.
Ikonet kan være 20 px selv om knappens trykkflate er minst 44 × 44 px.

```svg
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 24 24" width="20" height="20"
     fill="none" stroke="currentColor" stroke-width="1.9"
     stroke-linecap="round" stroke-linejoin="round"
     aria-hidden="true" focusable="false">
  <path d="M22 11.5V9a2 2 0 0 0-2-2h-3l-2-3H9L7 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7.5"/>
  <circle cx="12" cy="13" r="3.5"/>
  <path fill="currentColor" stroke="none" fill-rule="evenodd"
        d="M23 18.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 1 1 9 0Z
           M17.75 16.25h1.5v1.5h1.5v1.5h-1.5v1.5h-1.5v-1.5h-1.5v-1.5h1.5Z"/>
</svg>
```
