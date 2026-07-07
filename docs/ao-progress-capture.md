# Capture-sesjon: AO import-progresjon

**Mål:** Fange det ekte GET-endepunktet som Artsobservasjoner sin egen web-UI poller
mens den *parser* en import, og se hvordan progresjonen er representert (prosent?
behandlet/totalt? statusstreng?). Skal erstatte den blinde `sleep(3)` + publish-retry
i `src/ao_import_httpx.py` med reell polling + streaming til nettleseren.

## Forberedelse
- [ ] Bruk **Chrome** (best HAR-eksport) eller Firefox.
- [ ] Ha **5–10 observasjoner** klare til import — *ikke bare én*. Én art parses for
      fort til at pollingen vises; flere rader gjør «parser»-fasen lang nok.

## DevTools-oppsett (før importen starter)
- [ ] Åpne **F12 → Network**.
- [ ] Huk av **«Preserve log»** ✅ — *kritisk* (importen redirecter; ellers mistes trafikk).
- [ ] Huk av **«Disable cache»** ✅.
- [ ] La filter stå på **«All»** (ikke bare Fetch/XHR — `ParseObservations` er et
      dokument-POST med redirect, og poll-kallet kan være hva som helst).
- [ ] Tøm loggen (🚫) rett før du begynner.

## Capture (behold F12 åpen hele veien)
- [ ] Gå til import-siden (`ImportSighting`) — start opptaket her.
- [ ] Lim inn / fyll ut de 5–10 observasjonene.
- [ ] Klikk **«Importer»**.
- [ ] **Ikke rør noe** mens AO behandler — la den stå til parsing er ferdig.
      *Det er her poll-kallene skjer.*
- [ ] Når gjennomgang vises, klikk **«Publiser»** som normalt.
- [ ] La den fullføre.

## Noter samtidig (peker på hvilket felt som driver progresjonen)
- [ ] Vises **framdriftslinje / prosent / «3 av 10»**? Skriv ned nøyaktig ordlyd:

      ____________________________________________

- [ ] Ca. varighet på «behandler»-fasen: ____ sekunder

## Eksport
- [ ] Høyreklikk i Network-lista → **«Save all as HAR with content»**.
- [ ] Gi Claude **stien** til HAR-fila.

## Sikkerhet
HAR-fila inneholder **cookies + tokens** (`.ASPXAUTHNO`, `logintoken`, CSRF).
Den blir liggende **lokalt** — deles ingensteds. For analysen trengs kun URL-er,
cadence og respons-struktur, *ikke* de faktiske cookie-verdiene.
- [ ] (Valgfritt) Søk/erstatt cookie-verdiene i HAR-en før deling — behold feltnavnene.
- [ ] (Valgfritt) Bytt AO-passord etterpå.

## Etter capture — Claude gjør
1. Finner det repeterende GET-et mellom `ParseObservations` og `ReviewSighting`
   → **poll-endepunktet**.
2. Kartlegger URL, params, respons-format og cadence.
3. Planlegger integrasjon: reell polling i `ao_import_httpx.py` + SSE-streaming til
   nettleseren → ekte framdriftslinje.

---

## Funn (bekreftet 07.07.2026, to HAR-fangster)

AOs egen web-UI poller to lette JSON-endepunkter for å drive importfremdriften:

| Endepunkt | Metode | Body | Respons | Betydning |
|-----------|--------|------|---------|-----------|
| `/ImportSighting/NumberOfSightingsImporting` | POST | `null` | `{"Count":N}` | Antall som **fortsatt behandles** — teller N→0 (0 = ferdig parset) |
| `/ReviewSighting/NumberOfSightingsSubmitted` | POST | `null` | `{"Count":N}` | Antall i **review-køen** (nye + evt. gamle) |

- Headers: `Content-Type: application/json; charset=UTF-8`, `X-Requested-With: XMLHttpRequest`,
  vanlige sesjons-cookies (`logintoken`, `.ASPXAUTHNO`).
- **Publisering:** `POST /PublishSighting/PublishAll`, `application/x-www-form-urlencoded`,
  body `__RequestVerificationToken=…&ReviewSightingViewModel.PublicationName=&…PublicationComment=&…SightingsToPublishIds=`
  (tom liste = publiser alt i køen). Matcher dagens `publish_all` byte-for-byte.
- **Etter publisering** returnerer begge poll-endepunktene `{"Count":0}`.

### Merknader
- `PublishAll` publiserer *alt* i review-køen — også funn som lå der fra før. Kjent
  oppførsel, ikke endret her.
- Fremdriftsflyt i appen: `login` → `importing {behandlet}/{total}` → `publishing` → `done`.

### Implementert (v1.28.0)
- `src/ao_import_httpx.py`: `number_of_sightings_importing/submitted`, `_poll_importing_done`
  (erstatter blind `sleep(3)`), `post_with_curl(..., progress_cb=…)`.
- `server.py`: `/api/ao-import-stream` (SSE) — streamer fase-events. `/api/ao-import` beholdt.
- `public/js/export-operations.js`: leser SSE-strømmen, viser determinat framdriftslinje
  med «Behandler M av N».
