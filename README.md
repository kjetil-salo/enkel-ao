# Fugleobservasjoner v1.6.0

En norsk fugleobservasjons-app med intuitivt design, avanserte feltregistreringsmuligheter og valgfri Supabase-logging.

## 🚀 Live-apper
- **Production**: https://enkel-ao.fly.dev
- **Staging**: https://enkel-ao-staging.fly.dev


## 🆕 Nytt i v1.6.0
- **AO-lokasjonsdropdown**: Egen custom dropdown for Artsobservasjoner-lokaliteter med avstand, sortering og mobilvennlig visning
- **Pluss/minus-knapper**: Rask endring av antall direkte i listen, optimalisert for mobil (touch-vennlig)
- **Bugfixes**: Fikset lasting/visning av observasjoner, feil ved tom liste, og flere småfeil
- **Mobilforbedringer**: Mindre og mer diskrete knapper, bedre layout for små skjermer
- **Ytelse**: Raskere og mer robust initialisering av event listeners og state

## Tidligere versjoner
- **Avanserte felter**: Valgfrie alder- og kjønnsfelt kompatible med Artsobservasjoner.no import
- **Utvidet CSV-eksport**: Inkluderer alder/kjønn for sømløs AO-import
- **Responsiv design**: Optimalisert for mobile enheter

Dette repoet inneholder en liten Python HTTP-server som serverer en enkel web-app og noen API-endepunkter. Nedenfor finner du raske instruksjoner for å bygge og kjøre lokalt, starte en mock for eksterne tjenester med `docker-compose`, og kjøre forsiktige last-tester.

**Bygg image lokalt:**

```bash
cd /Users/kjetil/git/fugleobservasjoner
docker build -t fugleobservasjoner:local .
```

**Kjør enkelt container (treffer ekte eksterne tjenester):**

```bash
# Starter containeren og binder port 3000
docker run --name fugle-real -d -p 3000:3000 fugleobservasjoner:local

# Se logs
docker logs fugle-real --tail 200

# Memory snapshot
docker stats --no-stream --format "table {{.Container}}\t{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}" fugle-real
```

Vær oppmerksom på at dette vil la serveren treffe eksterne tjenester som Nominatim og Artsobservasjoner. Kjør kun forsiktige tester mot dem.

**Kjør med lokal mock for eksterne kall (trygt for load-testing):**

```bash
# Starter både appen og en liten lokal mock for Nominatim (docker-compose bygger bilder)
docker-compose up --build -d

# Se hvilke containere som kjører
docker ps

# Se logs for app
docker logs $(docker ps --filter "ancestor=fugleobservasjoner:local" --format "{{.Names}}") --tail 200

# Stoppe
docker-compose down
```

Mocken ligger i `mock/nominatim_app.py`.

**Load-testing (lokalt)**

Et enkelt testskript ligger i `tools/load_test.py`. Det har tre modi:
- `static` — kun `/` (statisk innhold)
- `mixed` — standard: `['/', '/api/species', '/api/reverse']`
- `gentle` — som `mixed`, men med liten jitter/delay for å unngå å treffe eksterne tjenester hardt

Nyere modi for testing:
- `ramp`  - gradvis økning i trafikk (enkel implementasjon; bruk for å finne når problemer starter)
- `soak`  - lav-rate kontinuerlig test over N sekunder (angi `--requests` som antall sekunder)
- `spike` - flere korte bursts for å teste burst-adferd
- `smoke` - noen få raske sanity-forespørsler (trygt å kjøre ofte)

Eksempler:

```bash
# Gentle mixed mot MOCK (safest for load testing)
python3 tools/load_test.py --mode gentle --requests 1000 --concurrency 50 --delay 0.05

# Ramp test (enkel):
python3 tools/load_test.py --mode ramp --requests 1000 --concurrency 50

# Soak test (kjører i 60 sekunder, lav rate):
python3 tools/load_test.py --mode soak --requests 60 --concurrency 10

# Spike test (korte bursts):
python3 tools/load_test.py --mode spike --requests 500 --concurrency 100
```

## 🚀 Deploy til Fly.io

**Deploy til staging (for testing):**
```bash
./update-app.sh staging
# Deployer til https://enkel-ao-staging.fly.dev
```

**Deploy til production:**
```bash
./update-app.sh production
# Deployer til https://enkel-ao.fly.dev
```

**Anbefalt workflow:**
1. Test lokalt: `python3 server.py`
2. Deploy til staging: `./update-app.sh staging`
3. Test på staging-URL
4. Deploy til prod: `./update-app.sh production`

# Smoke test (rask sanity):
python3 tools/load_test.py --mode smoke --requests 10 --concurrency 2
```

Eksempler:

```bash
# Statisk test (1000 req, concurrency 50)
python3 tools/load_test.py --mode static

# Gentle mixed mot MOCK (safest for load testing)
python3 tools/load_test.py --mode gentle --requests 1000 --concurrency 50 --delay 0.05

# Forsiktig test mot ekte tjenester (hold count lav!)
python3 tools/load_test.py --mode gentle --requests 10 --concurrency 2 --delay 0.1
```

**Etiske retningslinjer for eksterne APIer**
- Ikke kjør store, aggressive load-tester mot offentlige APIer (f.eks. Nominatim, Artsobservasjoner).
- Bruk caching for svar fra eksterne tjenester.
- Angi en klar `User-Agent` for applikasjonen (serveren setter en user-agent for utgående kall).

**Vanlige nyttige kommandoer**
- Se app-logs: `docker logs <container-name> --tail 200`
- Ta snapshot av ressursbruk: `docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}"`

**Hva jeg har gjort for deg i repoet**
- La til `docs/deploy_strategy.md` (deploy-strategi)
- Byttet til `ThreadingHTTPServer` for bedre enkel samtidighet
- Laget `tools/load_test.py` med `static`, `mixed` og `gentle` modi
- Laget `mock/nominatim_app.py` + `mock/Dockerfile` og `docker-compose.yml`

Hvis du vil kan jeg også legge til en liten `Makefile` for disse kommandoene, eller en kort `Procfile`/`gunicorn`-kommando for en fremtidig WSGI-migrasjon.
# Hosting

Denne appen er best drevet på moderne PaaS som Fly.io. Fly.io håndterer bygg, distribusjon og skalering på en enkel måte og er brukt i produksjon for dette prosjektet.

Rask deploy (lokalt):

1. Installer `flyctl` fra https://fly.io/docs/hands-on/install/
2. Logg inn: `fly auth login`
3. Deploy: `flyctl deploy`

Fly.io gir deg en URL etter deploy og enkel overvåkning.

# Se https://fly.io/docs/ for mer info.

## Enkel logging av statistikk (valgfritt med Supabase)

Appen fungerer fullstendig uten eksterne avhengigheter og bruker in-memory statistikk som standard. For persistent lagring av sidevisninger kan du valgfritt bruke Supabase:

### Supabase-oppsett (valgfritt)

1. Opprett gratis konto og prosjekt på [https://supabase.com/](https://supabase.com/)
2. Lag en tabell `stats` med feltene:
   - `id` (auto-increment)
   - `ip` (text)
   - `user_agent` (text)
   - `timestamp` (timestamp, default: now())
3. Installer Supabase Python-klient:
   ```
   pip install supabase
   ```
4. Legg inn Supabase-URL og API-nøkkel som miljøvariabler:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`

### Automatisk deteksjon
- **Med Supabase**: Hvis miljøvariabler er satt, brukes full persistent statistikk
- **Uten Supabase**: Automatisk fallback til in-memory statistikk (kun denne økt)
- **GitHub Codespaces**: Fungerer ut av boksen uten konfigurasjon

Statistikk-siden (`/stats?key=salo`) viser hvilken datakilde som brukes.
# Oracle Free Tier: Kjør appen med Docker fra eksternt registry

## Forberedelser på din egen maskin (Mac/PC)

1. Bygg Docker-image lokalt:
   ```sh
   docker build -t brukernavn/appnavn:latest .
   ```
2. Push til Docker Hub (eller annet registry):
   ```sh
   docker login
   docker push brukernavn/appnavn:latest
   ```

## På Oracle Free Tier VM

1. (Anbefalt) Opprett swap for å unngå at prosesser dør:
   ```sh
   sudo fallocate -l 2G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
2. Installer Docker:
   ```sh
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   # Logg ut og inn igjen for at gruppen skal tre i kraft
   ```
3. Logg inn på Docker og hent image:
   ```sh
   docker login
   docker pull brukernavn/appnavn:latest
   ```
4. Start appen:
   ```sh
   docker run -d -p 80:3000 brukernavn/appnavn:latest
   ```

Nå kan du bygge og pushe nye versjoner fra Mac, og bare pull+restart på Oracle.
# Fugleobservasjoner

En lynrask app for å registrere fugleobservasjoner i felt – designet for å la deg bruke mer tid på å se på fuglene og mindre tid på å trykke på små skjermknapper.

> **📢 Om prosjektet:** Dette er et personlig prosjekt utviklet for eget bruk og delt åpent for transparens. Koden er tilgjengelig under MIT-lisens. Issues og pull requests mottas gjerne, men uten garanti for rask respons. Se [CONTRIBUTING.md](CONTRIBUTING.md) for mer info.

## Hvorfor denne appen?

🔥 **Lokasjonsfinneren er gull verdt:** På nye og ukjente steder får du automatisk riktig lokalitetsnavn fra Artsobservasjoner med étt knappetrykk. Slutt på å gjette stedsnavn når du kommer hjem. **Du kan søke etter art selv om lokasjonsfeltet er tomt.**

⚡ **Sekunder fra fugl til lagret observasjon:** Autocomplete finner arten mens du skriver, Enter-tasten tar deg videre, og du er klar for neste art.

📱 **Designet for felt:** Glem å navigere gjennom menyer med kalde fingre. Her er alt på én side, optimalisert for mobil.

🏠 **Valider hjemme på stor skjerm:** Du kan lime inn i Artsobservasjoner direkte fra mobilen, men de fleste foretrekker å gjøre det hjemme – der er det enklere å se gjennom alt før publisering.

## Hovedfunksjoner

- 📍 **Automatisk lokalitetsfinner** – henter nærmeste lokaliteter fra Artsobservasjoner (inkludert private hvis de er dine egne)
- 🔍 **Artssøk med autocomplete** – slår opp mot Artsobservasjoner for korrekte artsnavn (lokasjon er valgfritt)
- ⚡ **Lynrask registrering** – art, antall, aktivitet, stedsnavn på sekunder
- 📋 **Tabelloversikt** – alle observasjoner gruppert per lokalitet
- 🗑️ **Redigering** – slett enkeltobservasjoner med ett trykk
- 🚀 **Direkte eksport** – «Kopier og åpne AO»-knapp som kopierer data og åpner importskjemaet
- 📖 **Innebygd hjelpeside** med brukerveiledning
- 🔒 **100% personvern** – ingen data lagres på server

## Personvern

- **Ingen data lagres på server.** Python-serveren er kun et proxy-mellomledd mot Artsobservasjoner.
- Alle observasjoner lagres bare i nettleseren din (localStorage) til du selv eksporterer eller tømmer lista.
- Ingen tracking, ingen analytics, ingen skylagring.

**Logging:** Ved hver sidevisning logges kun IP-adresse og nettleser (User-Agent) til serverens logg for enkel besøksstatistikk. Ingen søkestrenger, observasjonsdata eller annen sensitiv informasjon logges.

## Kom i gang (for den som kjører lokalt)

1. Sørg for at du har Python 3 installert.
2. I prosjektmappen:
   - `python3 server.py`
3. Åpne `http://localhost:3000` i nettleseren.

For mer detaljert brukerbeskrivelse (inkludert tips om AO-lokaliteter og import), se [bruk.md](docs/bruk.md).


## Versjon

Appversjon: **1.7.0**

Se også CHANGELOG.md for detaljer.

## Videre utvikling

Planlagte funksjoner for fremtidige versjoner:

- **Valgfrie felt** (kjønn, alder, kommentar) som kan vises/skjules etter brukerens ønske (default: skjult)
- Mulighet for å redigere eksisterende observasjoner
- Batch-operasjoner (endre lokalitet på flere observasjoner samtidig)

Forslag? Send en e-post til [k@vikebo.com](mailto:k@vikebo.com)!

## Lisens

Dette prosjektet er lisensiert under MIT-lisensen. Se [LICENSE](LICENSE) for detaljer.

---

**Utviklet av Kjetil Salomonsen** | [k@vikebo.com](mailto:k@vikebo.com) | © 2026

## Supabase logging

For enkel lagring av statistikk og anonymisert sidevisningsdata kan du bruke Supabase. Sett `SUPABASE_URL` og `SUPABASE_KEY` som Fly secrets eller miljøvariabler lokalt.

Eksempel (lokalt):
```
export SUPABASE_URL='https://...'
export SUPABASE_KEY='din_anon_nøkkel'
python3 server.py
```

I produksjon: bruk `flyctl secrets set SUPABASE_URL=... SUPABASE_KEY=...`.

## Deploy til Fly.io med Supabase

1. Sett Supabase-verdier som secrets på Fly.io (ikke bare i .env):
   ```
   flyctl secrets set SUPABASE_URL=https://znqbpzyfmiogxayaayrv.supabase.co
   flyctl secrets set SUPABASE_KEY=din_anon_nøkkel
   ```
2. Deploy med:
   ```
   flyctl deploy
   ```

3. Dockerfile må kopiere både server.py, supabase_log.py, requirements.txt og public/.

4. Alle Python-avhengigheter installeres automatisk fra requirements.txt.

5. .env brukes kun lokalt – i produksjon brukes Fly.io secrets.

6. Statistikk-siden finnes på `/stats` og viser data direkte fra Supabase.

## Deploy fra GitHub Actions (tag)

Repoet er satt opp slik at push til `main` kjører tester, men **ikke** deployer. Deploy til Fly skjer kun når du pusher en tag som starter med `v` (f.eks. `v1.1.3`).

Krav (GitHub Secrets):
- `FLY_API_TOKEN`
- `SUPABASE_URL` (valgfritt, kun hvis du skrur på “Set Fly secrets”-steget i workflowen)
- `SUPABASE_KEY` (valgfritt, kun hvis du skrur på “Set Fly secrets”-steget i workflowen)

## Viktig sikkerhet
- Ikke legg .env eller nøkler i git.
- Bruk kun "anon public"-nøkkel som SUPABASE_KEY.
- Service role-nøkkel skal aldri brukes i klient eller offentlig miljø.

## Oppsummering av endringer
- Supabase-logging og statistikk er tilgjengelig og konfigurert for Fly.io.
- Dockerfile og deploy-prosess er oppdatert for sikker og stabil drift.

For historiske Oracle-notater, se [ORACLE_CLOUD_SETUP.md](docs/ORACLE_CLOUD_SETUP.md).
