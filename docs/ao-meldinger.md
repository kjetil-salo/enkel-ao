# Meldinger fra Artsobservasjoner

**Status:** v1 implementert 19.11.2026, datainnhenting rettet og verifisert mot AO
20.11.2026 — tall + lenker ut, bevisst plassert bak profilsiden (ikke et eget
header-ikon ennå). Forhåndsvisning av selve
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
