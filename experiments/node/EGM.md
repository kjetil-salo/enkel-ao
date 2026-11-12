# experiments/node

## Overview

Arkivert Node.js-prototyp av en artssøk-proxy, ikke en del av appen som
kjører i produksjon. Produksjonsbackenden i dette repoet er Python
(`server.py`, `http.server.ThreadingHTTPServer`), og `server.js` sier dette
selv i toppkommentaren: «Archived Node.js prototype server. The supported
backend entrypoint for this project is server.py.»

Katalogen inneholder én fil, `server.js` (80 linjer). Den setter opp en
Express-app som gjør to ting: serverer statiske filer og eksponerer
`GET /api/species`, som proxyer artssøk mot `artsobservasjoner.no` ved å
skrape HTML med `cheerio` og plukke JSON ut av `span.itemjson`-elementer.
Samme funksjonalitet finnes i dag i Python-backenden
(`/api/species` i `server.py`).

Prototypen er ikke kjørbar slik repoet står nå, og det er verdt å vite før
noen prøver: `experiments/node` har ingen egen `package.json`, og
rot-`package.json` oppgir verken `express`, `node-fetch` eller `cheerio`
som avhengighet — devDependencies der er kun Playwright, vitest, jsdom og
`@vitest/ui`. Rot-`package.json` mangler dessuten `"type": "module"`, som
`import`-syntaksen i fila forutsetter. Både `npm start` og `npm run dev`
peker på `python3 server.py`.

Behandle derfor fila som historikk. Skal artssøket endres, hører endringen
hjemme i `server.py` / `src/api_handlers.py` — ikke her.

## Interface

- `GET /api/species?search=<tekst>` — returnerer et JSON-array med
  `taxonId`, `taxonName`, `scientificNameHtml`, `speciesGroupId`,
  `protectionLevelId` og `leaf` per treff. Tom eller manglende `search`
  svarer `[]`. [server.js:app.get('/api/species')]
- Statisk filtjeneste montert på rot-stien, fra `public/`-mappen ved siden
  av `server.js` selv. [server.js:express.static]
- HTTP-lytter startet på `process.env.PORT`, med 3000 som standard.
  [server.js:app.listen], [server.js:PORT]
- Ingen underkataloger, og dermed ingen barnekontrakter å lenke til.

## Invariants

- Oppstrøms-URL og spørringsparametere er hardkodet mot
  `https://www.artsobservasjoner.no/Taxon/PickerSearch` med
  `speciesGroup=8` (fugler) og `language=4` (norsk), samt
  `returnformat=html`, `onlyReportable=true` og
  `dontIncludeSubSpecies=true`. Prototypen leser altså ingen `AO_URL`-env-var,
  i motsetning til produksjonsbackenden. [server.js:url]
- Kallet ut setter eksplisitt `User-Agent`
  (`FugleobservasjonerBot/0.1`) sammen med `Accept`, `X-Requested-With` og
  `Referer` — i tråd med repo-konvensjonen om at eksterne API-kall skal
  identifisere seg. [server.js:fetch]
- Svarformen er avhengig av at AO leverer HTML der hvert treff ligger som
  JSON i et `span.itemjson`-element; parsingen er bygget rundt nettopp den
  selektoren. [server.js:cheerio.load],
  [server.js:$('span.itemjson')]
- Et enkelt treff som ikke lar seg JSON-parse hoppes over og logges, uten at
  resten av svaret faller. [server.js:JSON.parse]
- `leaf` normaliseres fra strengen `'true'` til boolsk verdi.
  [server.js:leaf]
- **Avvik fra repo-konvensjonen:** feil mot det eksterne APIet gir her
  HTTP 502, og intern feil gir HTTP 500. Produksjonsbackenden degraderer
  bevisst til tomt svar med status 200 i stedet (se «External API Error
  Handling» i `CLAUDE.md`). Prototypen følger ikke den regelen.
  [server.js:res.status(502)], [server.js:res.status(500)]

## Side Effects

- Utgående HTTP-kall til `https://www.artsobservasjoner.no` ved hvert
  `/api/species`-kall. Ingen caching i denne fila.
  [server.js:fetch]
- Binder en TCP-port og lytter på den. [server.js:app.listen]
- Leser filsystemet for statiske filer under
  `path.join(__dirname, 'public')`. Merk at den mappen ikke finnes i
  `experiments/node` — katalogen inneholder bare `server.js` — så
  mellomvaren treffer en sti som ikke eksisterer. Den finner ikke repoets
  egen `public/` i rota. [server.js:express.static],
  [server.js:__dirname]
- Leser miljøvariabelen `PORT`. [server.js:PORT]
- Skriver til stdout/stderr: oppstartsmelding samt feillogg ved
  AO-feil, parse-feil og uventet unntak. [server.js:console.log],
  [server.js:console.error]
- Ingen skriving til database, disk eller annen vedvarende lagring.

## Verification

- Ingen testkommando dekker denne katalogen. Repoets testsuiter er
  `python3 -m pytest` (Python) og `npm test` → `vitest run` (JS-enhetstester
  i `tests/unit/`), og ingen av dem har `experiments/` i omfanget.
  `experiments/node` har heller ingen egen `package.json` med et
  `test`-script.
