# Meldinger fra Artsobservasjoner

**Status:** v1 implementert 19.11.2026, datainnhenting rettet og verifisert mot AO
20.11.2026. v2 (20.11.2026) la til et eget header-ikon med telleboble — se
«Hvor det vises» under. Kjetil bekreftet samme dag at ikonet viser korrekt
antall (1) mot sin egen, ekte AO-konto — logget inn selv i egen nettleser,
ikke håndtert av Claude (se samtalen 20.11.2026 for begrunnelsen: regelen om
å aldri bruke eierens egen konto til AO-testing gjelder uavhengig av om
operasjonen er lesende). v3 (20.11.2026) la til en EKSPLISITT
«Vis forhåndsvisning»-knapp for Innboks — se «Hva som er bygget» og «Hva som
gjenstår» under. v4 (20.11.2026, samme dag) la til SELVE meldingsteksten:
Kjetil testet v3 og påpekte at raden bare lenket videre til AO («men når jeg
trykker på meldingen er det bare en lenke til ao??») — v3 viste kun emnet AO
selv lister, ikke det noen faktisk skrev. «Vis siste melding» henter nå det
siste innlegget i tråden og viser det i appen. v5 (20.11.2026, samme dag)
la til forhåndsvisning for Driftsmeldinger også — Kjetil testet v4 med en
driftsmelding (ikke en innboks-melding) og fant samme gamle oppførsel
(«her ser jeg at det fremdeles er en lenke til ao»). Driftsmeldinger har en
HELT ANNEN markup enn Innboks (se under) og viser ULIKT Innboks hele
meldingsteksten allerede på selve lista — ingen egen tråd-side å hente i
tillegg, men med en bekreftet bieffekt: å vise dem markerer dem som lest
hos AO (se under).

## Hvorfor

De fleste Enkel-AO-brukere er sjelden innom artsobservasjoner.no lenger —
appen dekker hele feltarbeidet. Ulempen: en admin som ber om å rette et funn,
eller en validator som kommenterer et bilde, blir lett oversett i ukevis, fordi
ingenting i Enkel-AO varsler om det.

## Hva som finnes hos AO

Research 19.11.2026 (innlogget med testkontoen `kjetil-test`, se
`CLAUDE.md` «Testkonto på Artsobservasjoner»), radoppsett verifisert
20.11.2026 mot Kjetils egen, ekte konto (han logget inn selv i egen
nettleser — Claude leste kun strukturen, ikke selve meldingsinnholdet):

- `https://www.artsobservasjoner.no/Communication/Inbox` («Innboks») —
  inneholder IKKE bare private admin-til-bruker-samtaler, men også
  automatiske valideringsstatus-varsler («Valideringsstatus for ditt funn er
  endret: [art] ([dato] [lokalitet])») — begge typer ligger om hverandre i
  samme liste, filtrert med radioknappene «Alle meldinger» / «Meldinger med
  funn» / «Meldinger uten funn».

  Rendres server-side i HTML, ingen JSON-grid. Tabellen har
  `id="conversationTable"` og klasse `conversation conversationInbox`,
  kolonneoverskrifter `Meldinger` / `Mottatt` / `Bruker`. Per rad (`tbody tr`):
  - `td` 1: avkrysningsboks (`input.selectedConversations`)
  - `td.comment.fullwidth`: `a.messagelink` (mangler klassen `read` på
    ULESTE rader — det er selve ulest-markøren) + `div.subjectsighting` med
    emne/artstekst
  - `td.commentdate-read`: mottatt-dato
  - `td.commentedby`: `a.ap2-ui-link-viewprofile` (avsender)

- `https://www.artsobservasjoner.no/Notification/History` («Driftsmeldinger») —
  **NB: å åpne denne siden markerer varsler som lest hos AO** (bekreftet
  20.11.2026 — Claudes researchbesøk her konsumerte Kjetils eneste ulesete
  varsel, og header-badgen gikk korrekt til 0 etterpå). Enhver kode som
  henter denne siden (nettleser ELLER backend) må behandles som om den har
  samme bieffekt — ikke noe å gjøre i bakgrunnen uten at brukeren ber om det.

  HELT ANNEN markup enn Innboks, ikke en tabell: `ul.notifications > li`,
  med klasse `messagetypeN` per type (observert `messagetype2` og
  `messagetype7` = bildekommentar/opplasting), og **`unread`-klassen på selve
  `<li>`** når uleset (verifisert 20.11.2026 — motsatt retning av Innboks sin
  manglende `read`-klasse, men samme idé). Filtreres med «Bilde Kommentarer
  (egne/andres bilder)», «Funnkommentarer (egne/andres funn)», «Meldinger».
  Per `li`:
  - `abbr.timeago` — relativ tid i teksten, absolutt tid (`DD.MM.ÅÅÅÅ TT:MM`,
    IKKE ISO 8601 her, ulikt Innboks-tråden) i `title`-attributtet
  - `span.UI-Icon-16-*` — ikon per meldingstype
  - `strong.notification-header`: `a.ap2-ui-link-viewprofile` (avsender) +
    en TRAILING TEKSTNODE i samme element («har lastet opp et bilde til
    ditt funn. ») — handlingsteksten, ikke bare avsendernavnet
  - **Rett etter `</strong>`, en BAR tekstnode uten noen wrapper i det hele
    tatt** («(sildemåke 18.11.2026, Bispevika, Oslo, Os)») — art/sted-
    detaljen. Lett å overse ved DOM-inspeksjon (`.children`-traversering
    hopper over den fullstendig, kun `.textContent`/rå HTML viser den)
  - `div.notification-message` — som regel KUN `div.thumbnailwrapper`
    (bildeminiatyr), ikke selve meldingsteksten (den ligger som over). Ikke
    bekreftet om en «Funnkommentar»-type (menneskeskrevet kommentar, ulikt
    den observerte auto-genererte «har lastet opp»-typen) legger fritekst
    HER i stedet — ingen slik melding fantes å teste mot 20.11.2026
  - Egen «Fjern»-knapp (`a.removebutton`, `href="/Notification/Delete/<id>"`)
    per rad — denne listen lar brukeren slette enkeltvarsler, ulikt Innboks

- `https://www.artsobservasjoner.no/Communication/Conversation/<id>`
  (samtaletråden bak hver Innboks-rad, `rad.href`/`rad.samtaleId`) — det
  Innboks-LISTA ikke viser: selve meldingsteksten noen skrev, ikke bare
  emnet. Verifisert 20.11.2026 mot en ekte tråd med 6 innlegg, blandet
  menneskeskrevet og automatisk innhold (f.eks. en reell admin-beskjed: «Hei.
  Husk alltid å føre på kjønn og aktivitet når du vet dette. [...] FF»).

  Meldingstabellen identifiseres via wrapperen **`div#messageScrollDiv`**,
  IKKE radantall eller CSS-klasse alene — siden har opptil to ANDRE tabeller
  med nøyaktig samme klasse (`conversation conversationInbox`) andre steder,
  og en tråd med kun ett innlegg ville gitt samme radantall som dem. Tråden
  er kronologisk **eldst først** — siste `tr` er nyeste innlegg. Per `tr`:
  - `td.messageCol1.commentedby`: `a.ap2-ui-link-viewprofile` (avsender)
  - `td.messageCol2.comment > div.commentcontainer`: selve teksten, `<br>`
    som linjeskift (ingen avsnitts-markup utover det)
  - `td.messageCol3`: `abbr.timeago[title]` — `title` er absolutt tid som
    ISO 8601 (`2025-11-02T23:12:29`), selve tekstinnholdet er relativ tid
    («for ca. et år siden»)

## Den billige tellingen (det som faktisk er bygget)

AOs eget sideskall gjør selv dette kallet på **hver eneste side** (sett i
nettverkstrafikk):

```
GET https://www.artsobservasjoner.no/Notification/NewNotifications
→ {"stringNotifications":[],"numberOfNewMessages":0,"numberOfUnreadNotifications":0}
```

- `numberOfNewMessages` ↔ Innboks
- `numberOfUnreadNotifications` ↔ Driftsmeldinger
- Rent GET med `Content-Type: application/json; charset=UTF-8`, ingen CSRF-token
  nødvendig. AO cacher svaret server-side i 20 sek
  (`cache-control: private, max-age=20`).

Implementert i `src/ao_import_httpx.py` → `fetch_new_notifications(login_token,
auth_cookie)`, samme cookie-/header-mønster som `_post_count()` i samme fil
(bevist i produksjon via `/api/ao-queue-count`). Eksponert som
`/api/ao-messages` (POST, body `{loginToken, authCookie}`) i `server.py`, som
følger ekstern-API-konvensjonen: AO-feil eller manglende innlogging gir
`{'nyeMeldinger': None, 'nyeVarsler': None}` med status 200, aldri 500.

### Årsaken til 400 og rettingen (20.11.2026)

GET-kallet manglet **Content-Type**, som AOs egen `Artportalen.ajaxGet` setter
til `application/json; charset=UTF-8` også på GET. Hjelperen finnes i AOs
`/Content/MasterFrontPageJs` og brukes av `ExecuteAjaxNotifications`.
`fetch_new_notifications` sender nå samme header. `logintoken_ssl=1` beholdes;
fjerning av denne cookien i en innlogget nettleser ga også 400 under tidligere
testing, men cookien alene løste ikke feilen.

Kontroll med testkontoen, **ny httpx-klient og identiske startcookies for hvert
kall**, uten andre endringer i forespørselen:

| JSON Content-Type | AO-svar |
|---|---|
| Uten | 400 `Bad Request` |
| Med | 200 med korrekte tellefelter |
| Uten, gjentatt | 400 `Bad Request` |

Deretter returnerte den rettede funksjonen `{'nyeMeldinger': 0, 'nyeVarsler': 0}`
fra ekte AO. Den tidligere forklaringen om bot-/IP-beskyttelse var en antakelse
og er trukket tilbake. HTML-parsing er ikke nødvendig.

Regresjonstester i `tests/test_ao_import.py` bruker `httpx.MockTransport` og
kontrollerer URL, metode, headere og cookies, samt null og positive tellinger.
HTTP 400, HTML i stedet for JSON og timeout skal fortsatt gi `None` («vet ikke»).
Testkontoen hadde ingen uleste meldinger eller varsler; positive tellinger er
derfor verifisert med mock, ikke med ekte meldinger.

Utrullet med `deploy-staging-pi.sh` og kontrollert på `https://aos.efugl.no`
20.11.2026: `/api/ao-messages` ga HTTP 200 med 0/0 for testkontoen og HTTP 200
med `null`/`null` uten innlogging. Full pytest: 813 bestått. Vitest: 542 bestått.

## Hvor det vises

**v1 (19.11.2026):** bak profilsiden (`profil.html`), `settings.ao_messages.*`-
seksjonen rett under AO-innlogging. Kun synlig når brukeren har lagrede
AO-tokens. Henter ved sideåpning og etter vellykket innlogging. Null-funn
vises som en rolig bekreftelse («Ingen nye meldinger»); et AO-kall som feiler
vises som en nøytral «kunne ikke sjekke», aldri en feilmelding brukeren må
reagere på. Hver linje lenker rett ut til AOs egen side (`target="_blank"`) —
selve meldingsinnholdet leses og besvares fortsatt hos Artsobservasjoner.

**v2 (20.11.2026):** et `✉️`-ikon med blå telleboble i toppmenyen
(`#ao-mail-link`/`#ao-mail-badge-count` i `index.html`), **i tillegg til**
profilsiden, ikke i stedet for den. Skjult helt når summen er 0 (eller ukjent/
uinnlogget) — det er selve hint-funksjonen: brukeren skal se at det finnes
noe, ikke sjekke en tallverdi. Lenker til `profil.html#ao-messages-section`,
der innholdet over fortsatt eies. Blå, ikke rød — rødt er reservert for
feiltilstander andre steder i appen, og dette er en nøytral opplysning.

Unntatt fra mobilvarianten av toppmenyens vanlige opprydding (ikonlenker
skjules der til fordel for ⋯-menyen, se `3-layout.css`) — nettopp fordi dette
er et hint som skal synes i felt på telefon, ikke gjemmes bak et ekstra trykk.

Henting og 10-minutters localStorage-cache (`ao_messages_cache_v1`, nøklet på
brukernavn) ligger i `public/js/ao-messages.js` — delt modul mellom
profilsiden og header-ikonet, så begge viser samme tall og ingen av dem
belaster AO oftere enn nødvendig. `oppdaterAoMeldingBadge()` i `main.js`
kjøres fra `updateAoDirectVisibility()` (samme sted som innloggingsbadgen og
kø-hintet oppdateres), og hopper over nettverkskall i streng Offline-modus —
samme konvensjon som `oppdaterAoKoHint()`.

## Hva som er bygget (v3, 20.11.2026)

Forhåndsvisning av Innboks, bevisst avgrenset til kun denne ene siden (ikke
Driftsmeldinger — se begrunnelse under «Hva som gjenstår»):

- `src/ao_import_httpx.py` → `_InnboksParser` (HTMLParser, samme mønster som
  `_Observatoerer` i `ao_coobserver.py` o.l. — ingen ny avhengighet) +
  `fetch_ao_inbox_preview(login_token, auth_cookie, limit=5)`. Henter emnet
  fra selve lenketeksten i `a.messagelink` (allerede en komplett setning hos
  AO), ikke fra den sekundære `div.subjectsighting`-detaljlinja — halverer
  parsing-overflaten for lite tapt informasjon. Skiller eksplisitt «tabellen
  ble ikke funnet» (markup endret seg → `None`) fra «tabellen var tom»
  (ekte, tom innboks → `[]`).
- `/api/ao-messages-preview` (POST) i `server.py`, samme ekstern-API-
  konvensjon som resten av appen: aldri 500, degraderer til
  `{'meldinger': None}`.
- `hentAoInnboksForhandsvisning()` i `public/js/ao-messages.js` — **bevisst
  IKKE cachet** og **IKKE kalt automatisk**, ulikt `hentAoMeldinger()` i
  samme fil. Kalles KUN fra en eksplisitt knapp («👀 Vis forhåndsvisning») i
  `profil.html`, som vises når `nyeMeldinger > 0`. Begrunnelse: selve det å
  hente/vise innhold kan ha bieffekter hos AO (se advarselen under
  Driftsmeldinger over) — det skal være en bevisst handling brukeren ber om,
  aldri noe som skjer i bakgrunnen av et sidebesøk eller en
  badge-oppdatering.
- Regresjonstester (`tests/test_ao_import.py`): parser-oppsett, `limit`,
  tom-men-funnet-tabell, markup-endret/http-feil/timeout → `None`, samt
  endepunktets degradering. `tests/unit/ao-messages.test.js` dekker
  JS-siden (ingen tokens, ingen caching, feiler stille til `null`).

## Hva som er bygget (v4, 20.11.2026 — selve meldingsteksten)

- `src/ao_import_httpx.py` → `_SisteMeldingParser` (samme HTMLParser-mønster
  som `_InnboksParser`) + `fetch_ao_conversation_latest_message(login_token,
  auth_cookie, samtale_id)`. Henter KUN siste `tr` i tråden (se radoppsett
  over) — hele historikken er ikke interessant for en kort forhåndsvisning.
- **Sikkerhet:** `samtale_id` er et rent, positivt heltall gjennom HELE
  kjeden — ALDRI en URL fra klienten. Serveren bygger
  `https://www.artsobservasjoner.no/Communication/Conversation/{id}` selv.
  Hadde endepunktet akseptert en vilkårlig URL fra klienten, ville det vært
  en åpen SSRF-proxy som sender brukerens EKTE AO-cookies dit en angriper
  ber om. Validert i TO lag: `_handle_ao_conversation_latest_post` i
  `server.py` (FØR fetch-funksjonen kalles) og i
  `fetch_ao_conversation_latest_message` selv (`isinstance(..., int)`,
  ikke `bool`, `>= 1`) — se egen test
  `test_ao_conversation_latest_avviser_ugyldig_samtale_id`.
- `/api/ao-conversation-latest` (POST, body `{loginToken, authCookie,
  samtaleId}`) i `server.py`. Samme ekstern-API-konvensjon: aldri 500,
  degraderer til `{'melding': None}`.
- `hentAoSamtaleSisteMelding(samtaleId)` i `public/js/ao-messages.js` —
  samme forsiktighet som `hentAoInnboksForhandsvisning()`: IKKE cachet,
  IKKE kalt automatisk. `profil.html` viser en «👁 Vis siste melding»-knapp
  PER rad i forhåndsvisningen (kun når `rad.samtaleId` finnes); knappen
  fjernes etter vellykket henting, står igjen og kan trykkes på nytt ved
  feil (AO kan ha vært midlertidig nede). Selve raden er IKKE lenger lenket
  ut i sin helhet (det var hele problemet v3 hadde) — en egen «Åpne i AO ↗»
  lenke ved siden av knappen dekker det behovet.
- **Ubekreftet, samme usikkerhet som for Driftsmeldinger:** om selve det å
  hente en tråds siste innlegg via backend markerer samtalen som lest hos
  AO. Sannsynligvis ufarlig her (Innboks-meldinger forblir i lista uansett
  lest-status, ulikt Driftsmeldinger som kan fjernes), men ikke målt separat.
- Regresjonstester (`tests/test_ao_import.py`): henter siste (ikke første)
  rad, avviser ugyldig `samtale_id` (streng, flyttall, `bool`, negativ, 0,
  `None` — uten at `httpx.Client` i det hele tatt instansieres), degraderer
  ved http-feil/markup-endret/timeout, samt endepunktets to valideringslag.
  `tests/unit/ao-messages.test.js` dekker JS-siden.

## Hva som er bygget (v5, 20.11.2026 — Driftsmeldinger-forhåndsvisning)

- `src/ao_import_httpx.py` → `_DriftsmeldingerParser` + `_rens_driftsmelding_tekst`
  (egen fra `_rens_samtaletekst` — INGEN `<br>` her, så ALL whitespace,
  inkludert ekte linjeskift fra kilde-HTML-ens pretty-printing, er bare støy
  og kollapses til ett mellomrom; Innboks-renseren bevarer bevisst
  avsnittsskift siden `<br>` der betyr noe ekte) +
  `fetch_ao_notifications_preview(login_token, auth_cookie, limit=5)`.
  Samler ALL tekst i `<li>` som IKKE ligger inni en lenke (unngår
  avsendernavnet og «Fjern»-knappen, begge lenker) og ikke inni
  `abbr.timeago` — fanger dermed BÅDE `strong.notification-header`s
  trailing tekst OG den bare tekstnoden etter, uten å måtte vite nøyaktig
  hvor AO legger art/sted-detaljen.
- **ULIKT Innboks: ingen andre-lags-henting her.** Hele meldingsteksten
  ligger allerede på selve lista (se radoppsett over) — Driftsmeldinger
  trenger derfor bare ÉN parser og ÉN forespørsel, ikke to som Innboks
  (`_InnboksParser` + `_SisteMeldingParser`).
- `/api/ao-notifications-preview` (POST) i `server.py`, samme
  ekstern-API-konvensjon: aldri 500, degraderer til `{'meldinger': None}`.
- `hentAoDriftsmeldingerForhandsvisning()` i `public/js/ao-messages.js` —
  samme forsiktighet som de andre: IKKE cachet, IKKE kalt automatisk.
  `profil.html` viser en «👀 Vis driftsmeldinger»-knapp (kun når
  `nyeVarsler > 0`) med en **synlig advarselstekst rett under** om at dette
  markerer dem som lest hos AO — den bekreftede bieffekten over er ikke noe
  en knapp skal gjemme. Etter visning: knappen blir en
  «🔄 Oppdater forhåndsvisning»-knapp (samme mønster som Innboks), ikke
  fjernet, siden et nytt trykk uansett bare viser samme type innhold på
  nytt (ingen drill-down å miste tilgang til).
- Regresjonstester (`tests/test_ao_import.py`): radoppsett (avsender, FULL
  tekst sammensatt riktig, `Fjern`-tekst IKKE lekker inn), `limit`,
  tom-men-funnet-liste, markup-endret/http-feil/timeout → `None`, samt
  endepunktets degradering. `tests/unit/ao-messages.test.js` dekker
  JS-siden.

## Hva som er bygget (v6, 20.11.2026 — én knapp, alltid synlig)

v3/v5 hadde to separate forhåndsvisnings-knapper, hver kun synlig når
respektive teller (`nyeMeldinger`/`nyeVarsler`) var over 0. Erstattet etter
eksplisitt beslutning fra Kjetil (ikke en bug — begge varianter fungerte):

- `profil.html` har nå ÉN statisk knapp («📨 Hent meldinger fra AO») i selve
  HTML-markupen, ikke generert betinget av tellerne i `renderAoMessages()`.
  Den er alltid synlig så lenge `ao-messages-section` vises (dvs. brukeren
  har lagrede AO-tokens) — uavhengig av om det er uleste meldinger/varsler.
  Begrunnelse: å måtte ha noe ulest for å få se forhåndsvisningen var en
  unødvendig begrensning — brukeren skal kunne sjekke selv uten at det
  finnes et nytt tall først.
- Ett trykk henter BEGGE forhåndsvisningene samtidig
  (`hentOgVisForhandsvisninger()`, `Promise.all` av
  `hentAoInnboksForhandsvisning()` og `hentAoDriftsmeldingerForhandsvisning()`),
  i stedet for to uavhengige knapper. Bevisst valgt over to knapper: enklere
  for brukeren, med den aksepterte kostnaden at ethvert trykk nå alltid også
  trigger Driftsmeldinger-bieffekten (markerer dem som lest hos AO) — selv
  om man egentlig bare ville se Innboksen. Advarselsteksten
  (`notif_preview_warning`) står derfor alltid synlig under knappen, ikke
  lenger betinget av `nyeVarsler > 0`.
- Hver av de to resultatboksene (`ao-messages-preview-body` /
  `ao-notifications-preview-body`) får nå en statisk overskrift
  («📥 Innboks» / «🔔 Driftsmeldinger») FØR innholdet, satt inne i
  `renderForhandsvisning()`/`renderDriftsmeldingerForhandsvisning()` selv —
  nødvendig fordi begge nå alltid rendres sammen (før var det underforstått
  hvilken boks man nettopp trykket for).
- Tellingen (`renderAoMessages()`, lenkene til AOs Innboks/Driftsmeldinger
  med antall) er UENDRET — fortsatt per kategori, fortsatt skjult helt når
  `total === 0` (viser «✅ Ingen nye meldinger» i stedet). Kun
  forhåndsvisnings-knappene ble konsolidert og løsrevet fra telleren.
  Header-badgen i `main.js`/`index.html` (✉️-ikonet på hovedsiden) er også
  UENDRET — vises fortsatt kun ved uleste, en bevisst beholdt forskjell fra
  forhåndsvisnings-knappen.
- i18n: `preview_btn`/`notif_preview_btn` fjernet, erstattet av
  `fetch_preview_btn` (den nye, enkelte knappen) og to nye overskrift-nøkler
  `preview_inbox_heading`/`preview_notifications_heading`, i `nb.js` og
  `nn.js`.

## Hva som gjenstår

1. **Fortsatt ubekreftet:** om selve HTTP-kallet fra backend (ikke en
   nettleservisning) til `Communication/Conversation/<id>` (Innboks' «vis
   siste melding») markerer SAMTALEN som lest hos AO. Trolig ufarlig der
   (Innboks-meldinger forblir i lista uansett lest-status, ulikt
   Driftsmeldinger), men ikke målt separat. For Driftsmeldinger ER
   bieffekten derimot bekreftet og synlig varslet i UI-et (se v5 over).
2. Driftsmeldinger-parseren er IKKE testet mot en ekte «Funnkommentar»
   (menneskeskrevet kommentar) — kun mot den auto-genererte «har lastet opp
   et bilde»-typen. Parseren samler ALL tekst utenfor lenker generisk, så
   den bør håndtere det også, men det er ikke verifisert mot ekte data.
3. AOs markup er **ikke en dokumentert, stabil kontrakt** for noen av
   sidene — en fremtidig AO-redesign kan endre klassenavnene over uten
   varsel. Alle tre parserne feiler allerede stille til «vet ikke»/tom liste
   ved uforventet markup (se `tabell_funnet`/`wrapper_funnet`/`liste_funnet`-
   skillene), men det er verdt å huske ved neste endring her.
