# Meldinger fra Artsobservasjoner

**Status:** v1 implementert 19.11.2026 — tall + lenker ut, bevisst plassert bak
profilsiden (ikke et eget header-ikon ennå). Forhåndsvisning av selve
meldingsinnholdet er IKKE bygget, se «Hva som gjenstår» under.

## Hvorfor

De fleste Enkel-AO-brukere er sjelden innom artsobservasjoner.no lenger —
appen dekker hele feltarbeidet. Ulempen: en admin som ber om å rette et funn,
eller en validator som kommenterer et bilde, blir lett oversett i ukevis, fordi
ingenting i Enkel-AO varsler om det.

## Hva som finnes hos AO

Research 19.11.2026 (innlogget med testkontoen `kjetil-test`, se
`CLAUDE.md` «Testkonto på Artsobservasjoner»):

- `https://www.artsobservasjoner.no/Communication/Inbox` («Innboks») — private
  samtaler. Her havner trolig admin-til-bruker-meldinger.
- `https://www.artsobservasjoner.no/Notification/History` («Driftsmeldinger») —
  automatiske varsler: endret valideringsstatus, nye kommentarer på funn/bilder.

Begge sider **rendrer meldingslisten server-side i HTML** — det finnes ingen
egen JSON-grid slik `/ViewSighting/BindSightingsGrid` gir for søk i funn.
`conversationTable`/`<tbody>` er tom når det ikke er meldinger, så eksakt
radoppsett (kolonner, lenkestruktur per melding) er **ikke verifisert** — bare
kolonneoverskriftene (`Meldinger`, `Mottatt`, `Bruker` for Innboks).

## Den billige tellingen (det som faktisk er bygget)

AOs eget sideskall gjør selv dette kallet på **hver eneste side** (sett i
nettverkstrafikk):

```
GET https://www.artsobservasjoner.no/Notification/NewNotifications
→ {"stringNotifications":[],"numberOfNewMessages":0,"numberOfUnreadNotifications":0}
```

- `numberOfNewMessages` ↔ Innboks
- `numberOfUnreadNotifications` ↔ Driftsmeldinger
- Rent GET, ingen CSRF-token nødvendig. AO cacher svaret server-side i 20 sek
  (`cache-control: private, max-age=20`).

Implementert i `src/ao_import_httpx.py` → `fetch_new_notifications(login_token,
auth_cookie)`, samme cookie-/header-mønster som `_post_count()` i samme fil
(bevist i produksjon via `/api/ao-queue-count`). Eksponert som
`/api/ao-messages` (POST, body `{loginToken, authCookie}`) i `server.py`, som
følger ekstern-API-konvensjonen: AO-feil eller manglende innlogging gir
`{'nyeMeldinger': None, 'nyeVarsler': None}` med status 200, aldri 500.

**Viktig fallgruve ved testing fra denne sandkassen (19.11.2026):** selv det
allerede produksjonsbekreftede `_post_count()`-kallet
(`/ReviewSighting/NumberOfSightingsSubmitted`) ga 400 Bad Request når det ble
kjørt fra Claude Code-sandkassens nettverk, mens vanlige sidevisninger
(`/User/MyPages`, `/Communication/Inbox`, `/Notification/History`) ga 200 fra
samme sted. Mest sannsynlig forklaring: AOs bot-beskyttelse behandler
AJAX/JSON-endepunkter strengere enn vanlige sidevisninger, og sandkassens
utgående IP (datasenter, ikke en vanlig nettleser-IP) blir filtrert der. Selve
funnet (endepunkt + responsform) er likevel bekreftet ekte, via nettleseren
(Claude in Chrome, ekte 200-svar). **Verifiser derfor `/api/ao-messages` på
Pi-staging ved deploy**, ikke bare lokalt/i sandkasse — samme føre-var som alle
andre AO-integrasjoner i dette prosjektet.

## Hvor det vises (v1)

Bevisst **bak profilsiden** (`profil.html`), ikke et header-ikon — usikker på
hvor synlig dette bør være, se `settings.ao_messages.*`-seksjonen rett under
AO-innlogging. Kun synlig når brukeren har lagrede AO-tokens. Henter ved
sideåpning og etter vellykket innlogging, med en 10-minutters localStorage-cache
(`ao_messages_cache_v1`, nøklet på brukernavn) for å ikke belaste AO ved hver
eneste sidevisning. Null-funn vises som en rolig bekreftelse («Ingen nye
meldinger»); et AO-kall som feiler vises som en nøytral «kunne ikke sjekke»,
aldri en feilmelding brukeren må reagere på.

Hver linje lenker rett ut til AOs egen side (`target="_blank"`) — selve
meldingsinnholdet leses og besvares fortsatt hos Artsobservasjoner.

## Hva som gjenstår

Et fullverdig designforslag med forhåndsvisning (avsender, utdrag, ulest-prikk,
header-ikon med badge i stedet for profilsiden) finnes som en visuell skisse
— se samtalen 19.11.2026 for artifact-lenken, ikke lagret i repoet. For å bygge
selve forhåndsvisningen trengs:

1. En ekte melding på en testkonto (eller lesetilgang til en reell konto med
   meldinger) for å se faktisk radoppsett i `conversationTable`/`<tbody>` og i
   driftsmeldingenes filtrerte liste — HTML-parsing kan ikke skrives blindt.
2. En avgjørelse om ikonet skal flyttes fra profilsiden til et synlig
   header-ikon (se research-notatene for fargevalg: blå badge, ikke rød —
   rødt er reservert for feiltilstander andre steder i appen).
