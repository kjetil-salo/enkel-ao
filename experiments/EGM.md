# experiments

## Overview

Oppsamlingssted for utforskende kode som ikke er del av appen i drift.
Katalogen inneholder ingen kildefiler direkte — alt ligger i
underkatalogen `node/`.

Produksjonsbackenden i dette repoet er Python: `server.py` med
`http.server.ThreadingHTTPServer`, startet via `npm start` / `npm run dev`
(som begge kjører `python3 server.py`). Det som ligger under `experiments/`
er alternativer som er prøvd ut og lagt bort, og skal ikke forveksles med
levende komponenter. Ingen av repoets testsuiter (`python3 -m pytest`,
`npm test` → vitest) dekker denne katalogen.

Skal du endre funksjonalitet, gjør det i `server.py` og `src/` — ikke her.

## Subdirectories & Boundaries

- **node**: [./node/EGM.md](./node/EGM.md) — Arkivert Express-prototyp
  (`server.js`, 80 linjer) som proxyer artssøk mot `artsobservasjoner.no`
  via HTML-skraping, og eksponerer `GET /api/species` på `PORT` (standard
  3000). Samme funksjon finnes i dag i Python-backenden. Ikke kjørbar slik
  repoet står: avhengighetene `express`, `node-fetch` og `cheerio` er ikke
  oppgitt i rot-`package.json`, og katalogen har ingen egen `package.json`.
