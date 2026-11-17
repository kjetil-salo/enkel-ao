# Ukjent antall og uoppgitt aktivitet (v1.60.23)

## Bakgrunn

En bruker som legger inn gamle funn kjenner ofte ikke antall eller aktivitet
på det tidspunktet. Et nesten identisk behov («ukjent antall» for automatiske
lyttestasjoner) var designet 23.10.2026 men aldri bygget. Denne versjonen
bygger antall-delen av det designet, generalisert til å dekke begge
scenarioene, og legger til en enklere løsning for aktivitet.

AO tillater selv tomt antall og tom aktivitet i sitt eget registreringsskjema
— se «Feltverifisering» nederst for hva som fortsatt må bekreftes mot ekte
import.

## Antall: to separate innstillingsbrytere

**«Tillat ukjent antall»** i `settings.html` (av som standard, lagret via
`saveAllowUnknownCount()`/`loadAllowUnknownCount()` i `storage.js`). Av som
standard fordi moderatorer historisk har klaget på antallsløse funn — bryteren
er en bevisst friksjon, ikke en forglemmelse.

**«Tillat estimert antall»** (v1.60.23, `saveAllowEstimatedCount()`/
`loadAllowEstimatedCount()`) styrer den ELDRE «ca»-avkrysningsboksen
(`#count-estimated`, legger «Estimert antal» i kommentarfeltet), som fram til
nå alltid var synlig uten noen bryter. To SEPARATE brytere — bevisst valg
(ikke én felles «vis flere antall-valg») — siden de to funksjonene er
uavhengige av hverandre.

Begge avkrysningsboksene (`#count-estimated-row`, `#count-unknown-row`) ligger
rett under selve antall-feltet i samme 80px-brede høyrekolonne som antallet,
ikke lenger spredt mellom venstre/høyre kolonne. Hver rad er skjult
(`display:none`) helt til `main.js` ved sideinit viser den basert på sin egen
innstilling — ingen av dem krever at den andre er på.

Når «ukjent antall» er på: en skjult rad (`#count-unknown-row`) i
hovedskjemaet blir synlig, med avkrysningsboksen `#count-unknown`. Huket av:
- `species-search.js` sin `chooseItem()` lar antall-feltet stå tomt og
  deaktivert i stedet for å forhåndsfylle `'1'`.
- `form-state.js` sin `updateSectionStates()` behandler avkrysningen som
  likeverdig med et utfylt antall-felt når den avgjør om aktivitet/✓ skal
  være tilgjengelig.
- `observation-commit.js` lagrer `count: null` i stedet for å avvise
  registreringen.

**Sticky gjennom sesjonen** — i motsetning til «ca»
(`count-estimated`, som nullstilles per observasjon): reset-blokken i
`commitObservation()` lar avkrysningen stå påkrysset etter en registrering.
Det ER hele sticky-mekanismen; det finnes ingen egen lagring av
avkrysningstilstanden. Et sideopplasting nullstiller den (ren DOM-tilstand).

**③-lista** (`observations.js`) viser `–` for `count == null`. Steppknappene
tåler null: «+»/«+10» setter 1/10 (regner null som 0), «−»/«−10» er no-op.
Klikk-til-rediger (`showInput()`/`save()`) tillater å tømme feltet til `null`
når innstillingen er på, ellers revert + toast som ved vanlig registrering.

**Rediger-modalen** (`edit-modal.js`) og **Fellestur** sin antall-quick-edit
(`fellestur.js`, linje ~487) har samme på/av-sjekk, men INGEN egen
avkrysningsboks — en direkte redigeringshandling på en enkelt, allerede
eksisterende rad er i seg selv eksplisitt nok uten en ekstra bekreftelse.

**Fellestur sin OPPRETTELSE** av observasjoner går allerede gjennom
hovedskjemaet (se toppkommentaren i `fellestur.js`) og krevde derfor ingen
egen endring for selve registreringen.

## Aktivitet: alltid et «Ikke oppgitt»-valg

Ingen bryter — samme mønster som alder/kjønn, som allerede har «Ikke
oppgitt» (`value=""`). Lagt til som første `<option>` i:
- `main.js` sin aktivitet-populering (hovedskjema).
- `edit-modal.js` sin `populateActivitySelect()` (rediger-modal) — her velges
  den også EKSPLISITT når observasjonen genuint mangler aktivitet (`!currentActivity`),
  i stedet for å falle stille tilbake til «Stasjonær» via `activities.json`
  sitt `selected`-flagg.

**Kritisk detalj:** når `opt.value === ''` lagres `activity: ''` DIREKTE —
ALDRI kjørt gjennom `activityBokmalName()`. Den funksjonen oversetter en
nynorsk aktivitetstekst tilbake til AOs bokmål-navn, og uten denne sjekken
ville den returnert den oversatte UI-teksten («Ikke oppgitt»/«Ikkje
oppgjeve») som om det var et ekte AO-aktivitetsnavn — og det ville blitt
sendt til AO som om fuglen faktisk hadde aktiviteten «Ikke oppgitt».

Ingen sticky-mekanisme for aktivitet (bevisst, enklere valg): neste
registrering følger vanlig `lastActivity`-gjenbruk, ikke «Ikke oppgitt».

## «Ikke oppgitt» som hurtigpill (v1.60.24)

Select-valget alene krevde fortsatt et ekstra steg (åpne dropdown, bla til
toppen) hver gang. `availableActivities` i `settings.html` sin
pill-konfigurator kom utelukkende fra `activities.json`, som aldri har hatt
«Ikke oppgitt» — den legges manuelt til i selve skjemaet
(`main.js`/`edit-modal.js`), ikke i den delte dataen. `addPillRow()` i
`settings.html` setter nå inn samme `value=""`-opsjon FØRST i
pill-konfiguratorens dropdown, slik main.js/edit-modal.js allerede gjør i
selve skjemaet — brukeren kan dermed konfigurere den som en av sine 0-8
hurtigpiller på vanlig måte, helt likt enhver annen aktivitet.

**Feltet fanget en reell matchingsbug i `renderActivityPills()`** (ikke bare
en mangel): klikk-håndtereren i `observation-commit.js` matchet pillen mot
`<select>`-opsjonen med `(p.value && opt.value === p.value) || ...`.
`p.value` er `''` for nettopp denne pillen — en sannhets-sjekk på en tom
streng er alltid falsk, så verdi-matchingen ble ALLTID hoppet over for «Ikke
oppgitt», uansett. Falt tilbake til tekst-sammenligning
(`activityBokmalName(opt.text) === label`), som i praksis traff i bokmål
(samme ustranslaterte streng på begge sider), men brøt sammen i nynorsk: en
pill lagret mens siden sto i nynorsk fikk `label` satt til den nynorske
UI-teksten («Ikkje oppgjeve»), siden «Ikke oppgitt» manglet i
`ACTIVITY_NYNORSK_MAP`/`ACTIVITY_BOKMAL_MAP` i `storage.js` — et klikk i
bokmål-modus traff da aldri treffet, og valgte aktivitet ble stille stående
uendret (feil aktivitet committet). Fikset ved å (1) fjerne
sannhets-sjekken — matching skjer nå alltid først på verdi, likt alle andre
piller — og (2) legge «Ikke oppgitt» → «Ikkje oppgjeve» inn i
`ACTIVITY_NYNORSK_MAP`, slik at både lagret `label` og selve
pille-visningsteksten oversettes riktig uavhengig av språk.

`ACTIVITY_SHORT_SUGGESTIONS` fikk `'': 'Ingen'` som forslag til kortnavn
(«Foreslå forkortelser»-knappen), og `relabelActivityPillOptions()` håndterer
`value === ''` som spesialtilfelle ved språkbytte (samme årsak: finnes ikke
i `activities.json`, som er kilden den funksjonen ellers slår opp i).

## AO3-reserveimport (`src/ao3_import.py`)

`_prepare()` sin `antall = int(funn['count'])` kastet `TypeError` på
`None` — fanget tilfeldig av et for bredt `except`-ledd i `send_via_ao3()`
og degraderte (utilsiktet riktig) til `ao3_manual`. Nå en uttrykt sjekk:
`int(funn['count']) if funn.get('count') is not None else 0`, som lar den
eksisterende `min(takson, sted, antall) < 1`-sjekken fange tilfellet med sin
allerede eksisterende feilmelding. Aktivitet trengte ingen tilsvarende fiks —
løypa som setter `activityId` hopper allerede over et tomt/falsy aktivitetsfelt.

## Allerede trygt — ingen endring (bekreftet ved lesing)

`observations.js` sin `toCsv()`, `src/share_store.py`, `src/fellestur_store.py`
og `src/arbeidsliste_store.py` tolererte `count: null`/`activity: ''` allerede
før denne versjonen.

## Feltverifisert bug: `str(obs.get('count', ''))` sendte teksten «None» (16.11.2026)

**Den opprinnelige «allerede trygt»-vurderingen av `src/ao_import.py` sin
`observations_to_csv()` var FEIL** — lest for raskt, ikke faktisk testet mot
AO. `obs.get('count', '')` returnerer kun fallbacken `''` når NØKKELEN
mangler — ved ukjent antall er `count` satt til `None` (ikke fjernet), så
`.get()` returnerte `None`, og `str(None)` ble til teksten `"None"` i
Antall-kolonnen.

Feltverifisert direkte mot AOs ekte import (gråspurv, Hylkjebukta, 16.11.2026):
AO avviste raden med «Ugyldig verdi: ikke et heltall. Vennligst oppgi et tall
mellom 1 og 100000000.» — en FORMAT-feil, ikke en «feltet er påkrevd»-feil,
som indikerer at en faktisk tom streng ville vært godtatt. Testen ble kjørt på
en ekte AO-konto (ikke testkontoen `kjetil-test`) — raden ble liggende i
gjennomgangskøen og må slettes derfra manuelt.

**Fikset:** linje 132 er nå `'' if obs.get('count') is None else str(obs['count'])`.
Regresjonstest lagt til i `tests/test_ao_import.py`
(`test_observations_to_csv_count_none_gir_tom_kolonne_ikke_strengen_none`).

**Gjenstår:** bekrefte at den FIKSEDE koden (faktisk tom Antall-kolonne) blir
godtatt av AO uten avvisning — selve fiksen er ikke feltverifisert ennå, kun
den opprinnelige bug-oppdagelsen. Bruk `kjetil-test`-kontoen, ikke eierens
egen, og slett raden fra gjennomgangskøen etterpå (se testkonto-reglene i
`CLAUDE.md`). Tom aktivitet er heller aldri feltverifisert isolert.
