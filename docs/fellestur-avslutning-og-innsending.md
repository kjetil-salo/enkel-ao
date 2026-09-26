# Fellestur: avslutning og innsending

Hvordan en fellestur faktisk avsluttes og sendes til AO, hvorfor det er delt i
to steg, og hvilke feller vi fant (og lukket) kvelden før første ordentlige
bruk i felt — en BirdLife Bergen-tur for nybegynnere, 2026-09-26.

Innført/endret i v1.53.9–v1.53.12 (2026-09-25/26). Se `CLAUDE.md` for
endepunkt- og modul-oversikt; dette dokumentet er «hvorfor», ikke «hva».

## Bakgrunn: gjennomgangen som fant problemet

Fellestur var ferdig bygget og manuelt testet, men aldri brukt i en ekte
gruppe. Kvelden før BirdLife-turen ble funksjonen gjennomgått for UX og
teknisk kvalitet (Claude + uavhengig Codex-review av samme kode). Det
viktigste funnet handlet ikke om synk-logikken — den var allerede solid — men
om **hva som skjer når turen er over**:

- Det finnes ingen server-side «lukket»-status på en fellestur i det hele
  tatt. Den lever til 48-timers TTL-en løper ut, uansett hva noen gjør lokalt.
- **To uavhengige «forlat»-knapper** kunne begge kopiere hele den delte
  loggen inn i en privat arbeidsliste: banneret på hovedsiden
  (`forlatFellesturMedValg()` i `main.js`) og «Hent inn og forlat» på
  `fellestur.html` (`sendTilArbeidsliste()` i `fellestur.js`). Ingen av dem sa
  fra til de andre, og ingen markerte noe som «allerede hentet» på serveren.
- **Verre:** mens en fellestur er aktiv, ruter `storage.js` sin
  `loadObservations()`/`saveObservations()` til den delte loggen — men
  hovedsidens helt vanlige knapper (`Publiser til AO`, `Kopier & åpne
  AO-import`, `Del funnene`, `Tøm liste`) visste ingenting om dette. En hvilken
  som helst deltaker kunne trykke «Publiser til AO» og bekrefte «tøm lista» og
  dermed sende og **slette den delte loggen for hele gruppa** — ikke bare sin
  egen kopi. Dette var det klart alvorligste funnet (Codex sitt bidrag).

Konklusjon: uten endring var risikoen for dobbeltsending til AO — eller enda
verre, at noen utilsiktet tømmer gruppas felles logg — reell og sannsynlig i
en gruppe med flere aktive medlemmer.

## Løsningen: varsel, ikke lås

To beslektede, men bevisst forskjellige tiltak:

1. **Sperr de fire delings-/innsendingsknappene på hovedsiden** så lenge en
   fellestur er aktiv (`oppdaterInnsendingssperreForFellestur()` i
   `main.js`). Dette er en **hard sperre** — knappene er faktisk
   `disabled`, ikke bare en advarsel. Trygt å gjøre hardt fordi det bare
   berører UI-tilstand på klienten, ingen data kan gå tapt av det.
2. **`avsluttetAv`/`avsluttetTs` på selve turen** (nye kolonner i
   `fellesturer`-tabellen, `src/fellestur_store.py`) — satt når noen trykker
   «Send inn listen og avslutt fellestur». Dette er et **rent
   informasjonsvarsel**, IKKE en lås:
   - Turen forblir fullt skrivbar. `apply_sync()` bryr seg ikke om feltet.
   - De andre klientene ser varselet på neste poll (12 sek) — en tydelig rød
     varselboks på `fellestur.html`, et rødt banner + et engangs-toast midt på
     skjermen på hovedsiden (v1.53.12, se under).
   - Hensikten er sosial koordinering («noen har allerede tatt ansvar for
     sendingen»), ikke teknisk håndheving.

**Hvorfor ikke en hard skrivesperre også her?** Vurdert og bevisst utsatt.
En ekte lås må endres i selve synk-kjernen — både hovedsidens automatiske
synk (`fellestur-sync.js`) og kontrollrommets direkte kall
(`fellestur.js`) — og må håndtere at noen har en observasjon liggende
usynket lokalt akkurat i det øyeblikket turen låses, uten at den forsvinner
sporløst. Det er nøyaktig den koden som må virke feilfritt under selve
arrangementet. Risikoen ved å innføre en ny, utestet kant-case i skrive-løypa
timer før bruk veide tyngre enn gevinsten av å gå fra «sterkt frarådet» til
«umulig». Kan vurderes senere, med bedre tid til å teste offline-scenarier.

## Hvorfor ikke sende direkte fra fellestur-siden?

Naturlig spørsmål: hvorfor ikke la «Send inn listen og avslutt fellestur»
faktisk publisere til AO med det samme, i stedet for en to-stegs handoff
(hent inn → gå til hovedsiden → trykk «Publiser til AO» der)?

Vurdert og avvist for denne runden:

- `handleDirectSend()` (den faktiske AO-publiseringen, i
  `export-operations.js`) er bygget rundt hovedsidens DOM
  (statusvisning, fremtids-validering, dublett-advarsel) — å gjenbruke den
  fra `fellestur.html` uten duplisering krever ny markup og wiring der også.
- Viktigere: **to-stegs-flyten gir gratis en gjennomgangsmulighet.** Etter
  «hent inn» havner alt i den vanlige ③-lista på hovedsiden, der man kan rette
  eller slette feil FØR noe sendes til AO. Går man rett fra fellestur-siden
  til AO, mister man det sikkerhetsnettet.

Konklusjon: behold to-stegs handoffen. Den er testet og virker (se
manuell browser-verifisering i git-historikken for v1.53.9–12).

## Innloggingskravet

Bruker ba eksplisitt om at den som sender til AO må være innlogget — «helt
naturlig». Implementert som to ting i `fellestur.js`:

- **«Ditt navn»** reflekterer nå ekte AO-identitet når enheten er innlogget
  (`erInnloggetMotAo()`, samme sjekk som `main.js`/`location.js`/`map.js`
  bruker: `ao_username` + `ao_password` i `localStorage`) — vises som
  «Innlogget på AO som **X**», ikke et fritekstfelt. Uten innlogging beholdes
  fritekstfeltet, slik at folk uten AO-konto fortsatt kan bidra med
  observasjoner i fellesturen (viktig for nybegynnere på en BirdLife-tur som
  ikke nødvendigvis har egen AO-konto).
- **«Send inn listen og avslutt fellestur»** krever nå innlogging — uten den
  vises en alert med beskjed om å logge inn (⚙️ Innstillinger) eller la en
  annen i gruppa gjøre det. Begrunnelse: denne handlingen ER starten på
  AO-innsendingen (arbeidslista sendes videre derfra), så den som gjør det må
  faktisk kunne fullføre det.

## UX-bug funnet i praksis: knapperekkefølge

Under faktisk gjennomprøving av flyten (produkteier, kvelden før turen) viste
det seg at «Forlat»-knappen — som bare forlater UTEN å kopiere noe — lå godt
synlig rett etter medobservatør-seksjonen, mens den faktiske
innsendingsknappen lå **under hele den delte loggen**, lett å overse hvis
loggen var lang. Dette forårsaket en reell feilklikk i praksis: brukeren
trodde «Forlat» var veien til å levere fra seg turen.

Fikset (v1.53.11) ved å:

- Flytte innsendingsknappen opp til rett etter medobservatør-/navn-seksjonen,
  som en tydelig `.btn.primar`-hovedhandling.
- Omdøpe den fra det mekaniske «Hent inn i min lokale liste og forlat» til
  det intensjonsdrevne «Send inn listen og avslutt fellestur» (brukerens eget
  forslag — «hente inn og forlate» ble opplevd som en merkelig sammensatt
  verbfrase).
- Gi «Forlat»-knappen en eksplisitt etikett: «Forlat uten å sende inn».

**Lærdom:** knapperekkefølge og -etikett er ikke kosmetikk her — det avgjorde
faktisk om testeren fant riktig vei gjennom flyten eller ikke, selv med
korrekt underliggende logikk.

## Andre robusthetsfikser samme kveld

- **404/utløpt-fellestur-bug** (v1.53.9): `pollFellestur()` i `main.js`
  håndterte en utløpt/slettet tur ved å stoppe pollingen og vise en toast,
  men ryddet aldri `aktivFellestur_v1` i `localStorage`. Enheten ble stående
  fast i fellestur-modus mot en død tur — nye registreringer sluttet stille å
  synke. Fikset: enheten faller nå automatisk tilbake til den private listen
  (samme trygge vei som «Forlat» bruker), med et forklarende varsel.
- **Feilhåndtering i kontrollrommet** (v1.53.9): retting av antall og
  sletting i `fellestur.html` feilet stille ved dårlig dekning. Viser nå
  samme røde synk-feil-toast som resten av appen.
- **Cache-busting manglet på `fellestur.html`** (v1.53.10, oppdaget ved at
  staging viste gammel kode rett etter en deploy): siden lastet
  `/js/fellestur.js` uten `?v=`-versjonering, i motsetning til `main.js` i
  `index.html` og `map.js` i `map.html` (se v1.53.7-fiksen for kartsiden).
  Cloudflare (`max-age=14400`) kunne dermed holde fast på en utdatert
  `fellestur.js` i opptil 4 timer etter enhver deploy. Se punkt 4 i
  «Versjonering»-sjekklisten i `CLAUDE.md`.

## Teknisk referanse

`src/fellestur_store.py`:
- `fellesturer`-tabellen har nå `avsluttet_av TEXT` og `avsluttet_ts REAL`,
  migrert via `PRAGMA table_info` + `ALTER TABLE` i `init_db()` (samme
  mønster som `obs_id`-migreringen for `fellestur_obs`).
- `update_fellestur(kode, navn=None, medobservatorer=None,
  avsluttet_av=None)` — utvidet, ikke ny funksjon.
- `get_fellestur()` returnerer `avsluttetAv`/`avsluttetTs` i JSON-svaret.

`server.py`: `/api/fellestur-oppdater` tar nå imot valgfri `avsluttetAv` i
body og sender videre til `update_fellestur()`. Ingen nye endepunkter.

`public/js/ao-observer-autocomplete.js` (ny fil, v1.53.10): autocomplete mot
`/api/ao-search-observers`, trukket ut av `coobserver-picker.js` og delt med
`fellestur.js` sin medobservatør-liste — samme søk, samme UI, ett sted å
vedlikeholde.

## Testdekning

`tests/test_fellestur.py` dekker `avsluttet_av`/`avsluttetTs`-lagring og at
det ikke påvirker `apply_sync()` (rent varsel, se testnavn
`test_avsluttet_av_er_rent_varsel_stopper_ikke_videre_synk`). Det som
**mangler** E2E-dekning for (bevisst utsatt, ikke glemt):

- Hovedsidens knappesperre og avsluttet-varsel (`main.js`) — ren
  frontend-logikk uten Python-tester, kun manuelt browser-verifisert.
- Offline/429-oppførsel i kontrollrommet under faktisk dårlig feltdekning.
- Fullt scenario med flere samtidige klienter som registrerer, redigerer og
  avslutter i den delte loggen.

## Versjonsoversikt

| Versjon | Innhold |
|---|---|
| v1.53.9 | Sperret hovedside-knapper under fellestur; fikset 404-bug; feilvarsel i kontrollrommet |
| v1.53.10 | AO-observatør-autocomplete for medobservatører; «Ditt navn» = AO-innlogging; innloggingskrav for å avslutte; cache-busting for `fellestur.html` |
| v1.53.11 | Flyttet/omdøpt innsendingsknapp (UX-bug funnet i praksis); oppdatert `help.html` |
| v1.53.12 | Kraftigere avsluttet-varsel (varselboks, rødt banner, engangs-toast) |
