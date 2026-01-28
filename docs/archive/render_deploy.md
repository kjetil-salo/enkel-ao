## Deploy til Render.com

Følg disse stegene for å deploye applikasjonen til Render ved bruk av Dockerfile og `render.yaml`.

- **1. Koble repo til Render**: Logg inn på Render, velg "New" → "Web Service" → "Connect a repository" og velg dette repoet.
- **2. Branch**: Velg `main` (eller den branch du ønsker å deploye fra).
- **3. Build**: Render bruker `Dockerfile` i rotkatalogen (konfigurert i `render.yaml`).
- **4. Miljøvariabler**: Sett de hemmelige variablene i Render Dashboard (Environment).
  - `PORT` — vanligvis `3000` (appens default).
  - `NOMINATIM_URL` — standard: `https://nominatim.openstreetmap.org/reverse`. For testing med mock, sett til `http://<host>:8080/reverse`.
  - `SUPABASE_URL` og `SUPABASE_KEY` — valgfrie; hvis ikke satt, logging til Supabase er deaktivert.
  - `STATS_KEY` — passord for `/stats`-siden; default `salo`.

- **5. Secrets**: Legg inn `SUPABASE_KEY` som et secret i Render (ikke commit til repo).
- **6. Auto-deploys**: Slå på `Auto-Deploy` for å bygge ved push til `main`.

- **7. Verifisering**: Når build er ferdig, besøk Render-URLen (f.eks. `https://fugleobservasjoner.onrender.com`). Se også i `Logs` for å feilsøke.

Tips:
- Ikke kjør store loadtests mot `nominatim.openstreetmap.org`. Bruk mock i `mock/nominatim_app.py` eller sett `NOMINATIM_URL` til en intern mock-tjeneste.
- Sørg for at `User-Agent`-headeren i koden fortsatt sendes ved eksterne kall (OSM-krav).

Feilsøking
- Hvis build feiler: sjekk at Dockerfile bygger lokalt: `make build` eller `docker build -t fugleobservasjoner:local .`.
- Hvis app starter men API-kall feiler: sjekk `NOMINATIM_URL` og nettverkstilgang.
