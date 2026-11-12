# Modal «legg til observasjon» — vurdering

Dato: 2026-11-12
Status: **Utforsket og lagt bort.** Ingen kode skrevet.

## Konklusjon

Ikke bygg modal registrering nå. Problemet som utløste ideen er ekte, men det
er i ferd med å bli løst et annet sted, og modalen koster nøyaktig det appen
selger seg på.

Notatet finnes for at ideen ikke skal tas opp igjen fra scratch. Tas den opp,
er «lagre og ny»-varianten under det eneste forslaget som er verdt å starte fra.

## Hva som ble vurdert

Feltlogg har en plussknapp på lokalitetsoverskriften som åpner registrering i
et eget lag. Spørsmålet var om Enkel-AO burde gjøre det samme, for å møte
observatører som kommer derfra.

Det uttalte målet var imidlertid ikke gjenkjennelighet, men layout:
**observasjonslista skal stå i ro, i stedet for å skyves nedover av
registreringsavsnittet.** `.section-observasjon` ligger i dag mellom
`.section-lokasjon` og `.section-liste` i `public/index.html`, og høyden
varierer med aktivitetspills, ekstrafelt og dato/tid i etterregistreringsmodus.

## Hvorfor det ble lagt bort

**1. Gevinsten uteblir på mobil, som er primærflaten.** En modal dekker
skjermen på en telefon. Man ser modalen, ikke lista. Den reelle gevinsten er
smalere enn målet som ble formulert: man mister ikke scroll-posisjonen mellom
registreringer. Det er verdt noe, men det er ikke «lista står der den står».

**2. Kostnaden treffer kjerneløftet.** README lover «minst mulig klikk og
tastetrykk». Én modal per observasjon er ett åpne- og ett lukketrykk per art.
På en rolig tur er det uvesentlig; på en dag med 60 arter er det 120 ekstra
trykk — mot en app hvis eksistensberettigelse er å være raskere enn AOs eget
skjema.

**3. Bred skjerm løser det allerede uten modal.** Arbeidet med
`.tablet-input-column` / `.tablet-list-column` (se
`tests/e2e_playwright/tests/bred-layout.spec.ts`) setter skjema og liste side
om side fra 1024 px. Der står lista i ro av seg selv. Modalen ville dermed vært
en ren mobilløsning — altså nettopp der den fungerer dårligst, jf. punkt 1.

## Det som likevel talte for

`observation-edit-modal` i `public/index.html` har allerede feltene en
registreringsmodal trenger: `em-species`, `em-count`, `em-activity`, `em-age`,
`em-gender`, `em-place`, `em-date`, `em-time-from`, `em-time-to`, `em-comment`,
`em-uncertain`, `em-not-spontaneous`. Appen har fire modaler fra før, så
mønsteret er etablert. En prototype ville i praksis vært den samme modalen i
tom tilstand. Terskelen for å teste er altså lav — det var ikke arbeidsmengden
som felte ideen.

## Hvis ideen tas opp igjen

Start fra denne varianten, ikke fra en rett Feltlogg-kopi:

**Modalen åpnes én gang per lokalitet, ikke én gang per art.** Plussknapp i den
festede lokasjonslinja åpner modalen; «Lagre og ny» tømmer feltene og beholder
modalen åpen med fokus i artsfeltet; «Lukk» avslutter lokaliteten. Da betales
ett åpnetrykk per lokalitet i stedet for per art, og rytmen inne i modalen er
identisk med dagens (art → antall → pill → enter).

Alternativ uten modal: la `.section-observasjon` kollapse til én kompakt linje
mellom registreringer og ekspandere ved fokus. Lista flytter seg ikke, fordi
kollapshøyden er konstant. Null ekstra trykk, men mer arbeid med fokus og
animasjon.

## Fallgruver som må planlegges for

Registreringsstien bærer mer logikk enn feltlista antyder:

- **Sjeldenhetsvarselet.** `rarity.js` tegner boksen når art og lokalitet begge
  er valgt. Følger den ikke med inn i modalen, forsvinner varselet stille — og
  `observation-commit.js` fanger `dom.rarityWarning` inn i `obs.rarityWarning`,
  så ⚠️-merket i lista forsvinner også.
- **Fyrverkeriet.** `celebrate.js` trigges fra samme sted og skal dekke hele
  skjermen. Over en modal må z-index stemme.
- **Etterregistrering og besøk.** ↩-knappen setter `etterregVisitKey`, og nye
  observasjoner arver besøkets tidsspenn *og* `visitLocked`. Fremtids-
  valideringen må fortsatt kjøre ETTER tidsoverstyringen, ellers avvises
  registreringer for et tidspunkt som aldri blir brukt. Se
  `docs/besok-og-tilbake-til-besok.md`.
- **Aktivitetspills** er brukerkonfigurerte 0–6 stk og må inn i modalen, ikke
  bare aktivitets-dropdownen.
- **Tastaturet på mobil** dekker halve skjermen når artsfeltet har fokus.
  Lagre-knappen må ikke havne under det. Dette er den vanligste grunnen til at
  slike modaler føles dårlige i felt.

## Hva en konsepttest må svare på

Ikke «ser det bra ut», men:

1. Hvor mange trykk tar 20 arter på samme lokalitet, før og etter?
2. Klarer man å se at tjelden allerede er registrert, uten å lukke modalen?

Er svaret på punkt 2 nei, har modalen ikke løst problemet — den har flyttet det.
