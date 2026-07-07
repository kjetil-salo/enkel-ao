# Direkte publisering til AO med ekte fremdrift (v1.28.0)

Referanse for hvordan «📡 Publiser til AO» fungerer, og hvordan fremdriftslinja
drives av AOs egne endepunkter. Se `docs/ao-import-fremdrift.md` sitt opphav i
`docs/ao-progress-capture.md` (capture-runbooken som avdekket endepunktene).

## Oversikt

Publiseringen skjer i tre serverside-steg mot Artsobservasjoner, og strømmes til
nettleseren som fremdrift:

```
Nettleser                     server.py                    Artsobservasjoner.no
   │  POST /api/ao-login ─────────►                              
   │  ◄──── loginToken, authCookie                              
   │                                                            
   │  POST /api/ao-import-stream ──►  post_with_curl():         
   │                                  1. ParseObservations ────► (laster opp CSV)
   │  ◄─ SSE: importing {m/n} ──────  2. poll NumberOfSightings  
   │                                     Importing til 0 ───────► {"Count":k}
   │  ◄─ SSE: publishing ───────────  3. ReviewSighting +        
   │                                     PublishAll ────────────► (publiserer alt i kø)
   │  ◄─ SSE: done {count} ─────────                             
```

## AOs progress-endepunkter (avdekket via F12/HAR 07.07.2026)

AOs egen web-UI poller disse mens en import behandles:

| Endepunkt | Metode | Body | Respons | Betydning |
|-----------|--------|------|---------|-----------|
| `/ImportSighting/NumberOfSightingsImporting` | POST | `null` | `{"Count":N}` | Antall som **fortsatt behandles** — teller N→0 (0 = ferdig parset) |
| `/ReviewSighting/NumberOfSightingsSubmitted` | POST | `null` | `{"Count":N}` | Antall i **review-køen** (nye + evt. gamle) |

Headers: `Content-Type: application/json; charset=UTF-8`, `X-Requested-With: XMLHttpRequest`,
vanlige sesjons-cookies (`logintoken`, `.ASPXAUTHNO`). Etter publisering returnerer begge `{"Count":0}`.

## Backend — `src/ao_import_httpx.py`

- `number_of_sightings_importing(login_token, auth_cookie)` → int eller `None` (ved feil/nedetid)
- `number_of_sightings_submitted(login_token, auth_cookie)` → int eller `None`
- `_poll_importing_done(...)` — poller `NumberOfSightingsImporting` (interval 0.7 s, timeout 30 s)
  til Count == 0. Krever to påfølgende avlesninger før 0 aksepteres (unngår å publisere før AO
  har startet). Faller tilbake til kort blind venting hvis endepunktet ikke svarer.
- `post_with_curl(observations, login_token, auth_cookie, area_id='', progress_cb=None)`
  - `progress_cb` kalles med `{'phase': 'importing', 'remaining', 'total'}` og
    `{'phase': 'publishing', 'total'}`. Bakoverkompatibel: uten callback fungerer den som før.
  - Erstatter tidligere blind `time.sleep(3)` med reell polling.

## Server — `server.py`

- `/api/ao-import` (uendret): enkelt JSON-svar. Beholdt for bakoverkompatibilitet.
- `/api/ao-import-stream`: validerer request (returnerer vanlig 400 JSON ved feil **før**
  strømmen starter), deretter `text/event-stream`. Sender `data: {json}\n\n` per event:
  `importing` → `publishing` → `done {..result}` / `error`. `progress_cb` skriver rett til
  `self.wfile` og `flush()`. Server er HTTP/1.0 (close-delimitert) — SSE fungerer uten
  Content-Length/chunked.

## Frontend — `public/js/export-operations.js`

`handleDirectSend()` i tre steg (1/3 login → 2/3 importing → 3/3 publishing):
- Leser SSE-strømmen med `response.body.getReader()`, splitter på `\n\n`, parser `data:`-linjer.
- `importing` → determinat framdriftslinje: «Behandler M av N …» (M = total − remaining).
- `publishing` → indeterminert animert linje: «Publiserer N observasjoner …».
- `done` → ✅-melding + tilbud om å tømme lista.
- `_renderProgress(dom, step, totalSteps, text, pct)` — `pct === null` gir animert linje,
  ellers determinat bredde. CSS: `.ao-progress-bar` (animert) / `.ao-progress-bar-det` (determinat)
  i `public/css/6-animations.css`.

## Kjente forhold

- `PublishAll` publiserer **alt** i review-køen — også funn som lå der fra før. Uendret oppførsel.
- `NumberOfSightingsSubmitted` teller nye + eksisterende funn i køen; brukes ikke som nevner
  for prosenten (den baseres på `total` = antall vi selv sendte).
- Ekte per-observasjon-progresjon finnes ikke (AO tar hele CSV-en som én batch); fremdriften
  er basert på hvor mange AO fortsatt behandler.

## Testing

`tests/test_ao_import.py`:
- Poll-funksjoner (parser `Count`, `None` ved feil/non-200)
- `post_with_curl` sender riktige `progress_cb`-faser
- SSE-endepunktet streamer events ende-til-ende + validerer før strøm starter
