---
name: app-reklame-plansje
description: Lag Facebook/Instagram-reklameplansjer, karuseller og annonsetekster for Kjetils egne apper, spesielt Enkel-AO. Bruk når brukeren ber om reklamebilde, annonsebilde, Facebook-annonse, plansje, karusell-annonse, markedsføringsbilde, egenreklame eller reklamecopy for appen, inkludert Enkel-AO-reklame for bildeopplasting og deling før AO-publisering. Bygger på etablert mønster med ekte skjermbilder komponert inn i SVG/PNG-plansjer, korte norske budskap og personlig/lavmælt tone.
---

# App-reklameplansje

Lag reklamebilder og annonsetekst for Kjetils apper i samme gjenkjennbare stil
som tidligere er brukt for MinListe, Enkel-AO og Dagens Funn.

## Grunnprinsipp

Bruk alltid ekte skjermbilder fra den faktiske appen. Ikke finn opp UI-mockups
eller tegn falske skjermer. Ta skjermbilder av kjørende app i mobil viewport
eller bruk skjermbilder fra Kjetils egen telefon. Sjekk visuelt at kart, bilder
og annet asynkront innhold faktisk er lastet.

Hold tonen personlig, konkret og lavmælt. Dette skal høres ut som Kjetil som
viser noe nyttig han har laget, ikke en markedsavdeling. Unngå å snakke ned
Artsobservasjoner.no; presenter Enkel-AO som et praktisk hjelpemiddel oppå AO.

## Enkel-AO: nåværende hovedvinkel

Enkel-AO skal fortsatt selges med den originale grunnteksten først:

**Enklere vei inn i Artsobservasjoner**

**Enkel-AO erstatter ikke AO. Det er bare et enklere lag oppå, laget for rask
registrering og riktig lokalitet.**

Denne teksten er sterk og skal beholdes som toppbudskap på hovedplansjer. Nye
features skal legges inn under dette, ikke erstatte det.

Enkel-AO er ikke lenger bare "GPS inn, riktig lokalitet ut". Den nye
feature-vinkelen er:

**Registrer observasjoner i felt, legg ved bilder, og del en statusoppdatering
med venner før observasjonene publiseres til Artsobservasjoner.**

Dette er spesielt nyttig på lange feltdager, for eksempel flere timer på Herdla:
brukeren kan bygge opp en lokal observasjonsliste underveis, legge ved bilder
og sende en foreløpig oppdatering til fuglevenner uten at alt må være ferdig
publisert i AO først.

Fortsett å bruke GPS/lokalitet som viktig støttepunkt:
- GPS foreslår aktuelle AO-lokaliteter.
- Kart og lokalitetsliste reduserer gjetting på stedsnavn.
- Feltmodus og etterregistrering dekker ulike arbeidsmåter.
- Observasjoner lagres lokalt til brukeren selv eksporterer eller publiserer.

Nye reklamepoenger som bør vurderes først:
- "GPS finner lokalitetene for deg" + "Se aktuelle steder på kart eller som enkel liste."
- "Bilder rett inn på observasjonen" + "I redigervinduet kan du ta bilde, laste opp eller lime inn."
- "Del funn med venner" + "Lag en lenke til dagens status før alt er sendt inn til AO."
- "Herdla i mange timer?" + "Hold fuglevennene oppdatert mens turen fortsatt pågår."

## Enkel-AO: august 2026-plansje med bilder og deling

Ferdig godkjent arbeidsfil fra denne runden:
- `docs/facebook-reklame-assets/enkel-ao-plansje-deling-bilder-2026.svg`
- `docs/facebook-reklame-assets/enkel-ao-plansje-deling-bilder-2026.png`
- hjemkopi: `/Users/kjetil/enkel-ao-reklame-deling-bilder-2026.png`

Bruk denne som nærmeste mal for neste Enkel-AO-reklame.

Lærdom:
- Behold original topptekst: "Enklere vei inn i Artsobservasjoner" + forklaring om at appen er et enklere lag oppå AO.
- Ikke la "deling" ta over hele budskapet. Deling er en kul feature, men hovedsiden/observasjonssiden er viktigst.
- Det største skjermbildet skal vise hovedsiden med observasjonsliste og send inn-del. Delingsdialogen kan være en liten støttefeature.
- Bruk lyse appskjermbilder når appen nå presenteres i lys versjon.
- Ikke prøv å presse inn autocomplete, kart, bilder og deling som likeverdige screenshots på samme flate. Bruk tekstkort for GPS/kart/liste, og vis de nye feature-skjermbildene.
- Den gamle plansjen med mange små skjermbilder er god for generell introduksjon. Den nye med større hovedside er bedre for en oppdateringspost.
- Hvis målgruppen ikke kjenner appen, vurder karusell: ny oppdateringsplansje først, gammel introduksjonsplansje etterpå.
- Plasser "Bygger på Artsobservasjoner.no" diskret, sentrert over CTA-en. Ikke la kildeangivelsen henge ute ved et skjermbilde.
- Beskjær små screenshots hvis de viser scrollbar eller rare browserkanter. I SVG kan `<image>` gjøres litt større og forskyves innenfor samme `clipPath`.
- Når Kjetil skal navigere i browseren selv, ikke lås viewport til mobilstørrelse. Åpne/claim fanen synlig uten viewport override, la Kjetil resize/navigere, og ta screenshot uten å endre størrelsen først.

## Etablerte filer og referanser

For Enkel-AO finnes tidligere reklameutkast og assets her:
- `docs/facebook-reklame-enkel-ao-utkast-2026-06-30.md`
- `docs/facebook-reklame-assets/`
- `docs/facebook-reklame-assets/screens/`

Legg nye reklamefiler i `docs/facebook-reklame-assets/`. Bruk `screens/` for
rå skjermbilder. Reklamefiler skal ikke ligge i noe som deployes/serveres.

## Arbeidsflyt

1. Avklar hvor reklamen skal postes og om det skal være én plansje eller en
   karusell. Hvis posten skal i AO-relaterte fora, bruk ekstra ydmyk tone.
2. Skaff ekte mobilskjermbilder av funksjonene som støtter budskapet best.
   For den nye Enkel-AO-vinkelen er gode kandidater:
   - observasjonsliste med flere arter fra samme tur
   - bildeopplasting/visning på en observasjon
   - delingsflyt eller delt forhåndsstatus
   - kart/lokalitetsvalg som sekundært bilde
3. Bygg SVG-plansje/karusell med eksisterende stil fra
   `docs/facebook-reklame-assets/`.
4. Rendre til PNG med `rsvg-convert -o utfil.png infil.svg`.
5. Skriv annonsetekst i en `-tekst.md`-fil ved siden av PNG/SVG.
6. Vis PNG-en til brukeren for visuell godkjenning før du sier deg ferdig.

## Visuell stil

Format: 1080x1350 for Facebook-portrett, eller flere 1080x1350-bilder for
karusell.

Enkel-AO-palett:
- Bakgrunn: `#0f1b38 -> #15336b -> #0c5a58`
- Aksent/CTA: `#facc15`
- Panel: `#f8fbff -> #eef5ff`

Bruk én tydelig hovedoverskrift, korte poenger og ekte appskjerm. Ikke spre
samme budskap over mange bokser. Hver tekstflate skal si noe nytt.

Skjermbilde-rammer:
- Bruk synlig, slank aksentramme, omtrent 4-5 px.
- Ikke lag fysisk telefonbezel med notch/knapper.
- Match rammens sideforhold til skjermbildets faktiske pikselforhold.
- Bruk `preserveAspectRatio="xMidYMin meet"` på `<image>`.
- Bunnjuster flere skjermbilder mot hverandre.

For karusell:
- Bilde 1: originalt hovedløfte, "Enklere vei inn i Artsobservasjoner", med stor hovedside.
- Bilde 2: bildeopplasting/redigervindu.
- Bilde 3: deling av funn før innsending til AO.

## Tekststil

Skriv norsk med æ/ø/å. Hold plansjetekst ekstremt kort. Skriv mer forklaring i
Facebook-postteksten, ikke på bildet.

Gode hovedlinjer for ny Enkel-AO-reklame:
- "Enklere vei inn i Artsobservasjoner"
- "GPS finner lokalitetene for deg"
- "Bilder rett inn på observasjonen"
- "Del funn med venner"

Kort Facebook-post bør ha 3-5 linjer, gjerne i jeg-stemme:

```text
Jeg har lagt inn en ny ting i Enkel-AO:
Nå kan du samle observasjoner med bilder underveis, og dele en foreløpig
status med venner før du sender alt inn til Artsobservasjoner.

Veldig kjekt på lange feltdager, for eksempel når du blir gående på Herdla i
flere timer og vil sende en oppdatering mens dagen fortsatt pågår.
```

Ta med tillitsspråk når AO-innlogging nevnes:
- Innlogging er valgfri.
- Appen fungerer også uten innlogging.
- Innloggingsdata lagres ikke på serveren.

PWA-fotlinje kan brukes når det passer:

> Enkel-AO er en PWA-app. Den ligger ikke i noen appbutikk, men kan legges på
> hjemskjermen og oppfører seg som en app. Den fungerer også på PC.

## Kilde og kontekst

Hvis en plansje viser data hentet eller speilet fra Artsobservasjoner.no, legg
inn diskret kildeangivelse, for eksempel "Bygger på Artsobservasjoner.no".

Hvis annonsen sammenligner med AO, gjør det i tekst med respektfull framing:
"Artsobservasjoner er fantastisk, men mobilflyten i felt kan bli tung. Enkel-AO
gjør registreringen raskere når du står ute."

## Sjekkliste

- Skjermbilder er ekte og visuelt kontrollert.
- Bildeopplasting/deling vises hvis det er hovedbudskapet.
- Tekst og bilde handler ikke bare om gammel GPS/lokalitet-vinkel.
- Sideforhold og rammer gir ingen synlig zoom eller kutt.
- Flere skjermbilder er bunnjustert.
- PNG er rendret og vist til brukeren.
- Annonsetekst ligger ved siden av plansjen.
- Tone er tilpasset stedet posten skal deles.
