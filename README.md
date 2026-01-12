# Hosting

Denne appen er best drevet på moderne PaaS som Fly.io. Fly.io håndterer bygg, distribusjon og skalering på en enkel måte og er brukt i produksjon for dette prosjektet.

Rask deploy (lokalt):

1. Installer `flyctl` fra https://fly.io/docs/hands-on/install/
2. Logg inn: `fly auth login`
3. Deploy: `flyctl deploy`

Fly.io gir deg en URL etter deploy og enkel overvåkning.

# Se https://fly.io/docs/ for mer info.

## Enkel lagring av statistikk med Supabase

For enkel og gratis lagring av IP-adresse og geolokasjon kan du bruke Supabase:

1. Opprett gratis konto og prosjekt på [https://supabase.com/](https://supabase.com/)
2. Lag en tabell `stats` med feltene:
   - `id` (auto-increment)
   - `ip` (text)
   - `lat` (float)
   - `lon` (float)
   - `timestamp` (timestamp, default: now())
3. Installer Supabase Python-klient:
   ```
   pip install supabase
   ```
4. Legg inn Supabase-URL og API-nøkkel som miljøvariabler på Fly.io:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
5. Eksempel på enkel lagring i Python:
   ```python
   from supabase import create_client, Client
   import os

   SUPABASE_URL = os.environ.get("SUPABASE_URL")
   SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
   supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

   def log_stat(ip, lat, lon):
      data = {
         "ip": ip,
         "lat": lat,
         "lon": lon
      }
      supabase.table("stats").insert(data).execute()
   ```

Se README for mer info og oppdatering av statistikkfunksjon.
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

For mer detaljert brukerbeskrivelse (inkludert tips om AO-lokaliteter og import), se [bruk.md](bruk.md).


## Versjon

Appversjon: **1.1.3**

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

For historiske Oracle-notater, se ORACLE_CLOUD_SETUP.md.
