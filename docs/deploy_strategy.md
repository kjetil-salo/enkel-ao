# Deploy-strategi for fugleobservasjoner

Dette dokumentet beskriver en enkel, sikker og gjentakbar strategi for å deploye applikasjonen til to miljøer: `staging` og `production`.

**Mål**
- Ha to separate miljøer hvor `staging` brukes til validering og QA, og `production` er live.
- Automatisere bygg, test og deploy via GitHub Actions.
- Ha en enkel lokal deploy-rutine for utvikling og nød-rollback.

**Navnekonvensjoner**
- Branch -> miljø:
  - `staging` branch deployer til `enkel-ao-staging` miljø
  - `main` branch deployer til `enkel-ao` (production)
- Fly-app navn:
  - Production: `enkel-ao` (https://enkel-ao.fly.dev)
  - Staging: `enkel-ao-staging` (https://enkel-ao-staging.fly.dev)

CI/CD (høy-nivå)
- Når commits pushes til `staging` branch: kjør testene, bygg image, deploy til `fugle-staging`.
- Når commits pushes til `main`: kjør testene, bygg image, deploy til `fugle-prod`.
- Bruk GitHub Secrets for sensitive verdier (`FLY_API_TOKEN`, `DOCKER_USERNAME`, `DOCKER_PASSWORD` om nødvendig).

Forslag til GitHub Actions workflow:
- Sjekk ut koden
- Sett opp Python (eller build-miljøet)
- Kjør tests (f.eks. `pytest`)
- Bygg Docker image (eller bruk Fly CLI direkte)
- Deploy til Fly med `flyctl deploy --app <app-name>` eller push image til registry og bruk Fly config

Secrets og konfigurasjon
- Oppbevar API-tokens og credentials i GitHub Secrets.
- I Fly, lag separate apps for hver miljø og sett miljøvariabler per app med `flyctl secrets set`.
- Database: bruk separate databaser per miljø. Unngå å peke staging mot produksjonsdatabase.

Migrasjoner
- For database-migrasjoner: vurder å kjøre migrasjoner som en del av deploy-jobben (CI kjører migrasjoner mot staging automatisk). For `production`, vurder manuell godkjenning eller en egen jobb som kjører migrasjoner etter deploy.

Rollback
- Fly gjør det enkelt å rulle tilbake ved å bruke tidligere image eller `flyctl releases` dersom dere bruker Fly releases.
- Som fallback: deploy en kjent god tag (f.eks. `git checkout v1.2.3 && flyctl deploy`).

Lokale deploy-kommandoer
- En enkel wrapper `update-app.sh` kan ta en argument `staging|production` og kalle `flyctl deploy --app <app-name>` med riktig app navn.

✅ Implementerte kommandoer
- Deploy staging:

```bash
./update-app.sh staging
# Deployer til https://enkel-ao-staging.fly.dev
```

- Deploy production:

```bash
./update-app.sh production
# Deployer til https://enkel-ao.fly.dev
```

- Lokal utvikling:

```bash
./update-app.sh
# Kjører Docker lokalt på port 3000
```

```
./update-app.sh production
```

Vedlegg: neste steg
- Implementere GitHub Actions workflow (`.github/workflows/deploy.yml`).
- Endre `update-app.sh` til å akseptere miljø-argument.
- Lage dokumentasjon for database og migrasjons-prosess.

## Vurdering av Flask

- **Kort oppsummering:** Flask er et moden og veletablert Python-webrammeverk med gode verktøy for routing, blueprints, og utvidelser (migrations, auth, admin-UI). Migrasjon til Flask gir bedre struktur og enklere videreutvikling dersom applikasjonen vokser.
- **Hvorfor vurdere nå:** Hvis dere planlegger å legge til flere ruter, brukerautentisering, eller modulære komponenter (f.eks. admin-panel, API og web front-end samtidig), vil Flask gjøre det enklere å holde koden ryddig.
- **Hvorfor vente:** Siden dette var et miniprosjekt og du tror appen snart er ferdig, en full migrasjon nå vil påføre ekstra arbeid (portering av logikk i `server.py`, oppdatering av tester og CI, oppdatere Dockerfile/startkommando). For en ferdig eller nesten ferdig liten app gir gevinstene ved å vente seg ikke nødvendigvis.

**Min anbefaling:** Ikke migrer umiddelbart hvis målet er å ferdigstille og lansere raskt. Prioriter å få stabild deploy og CI på plass. Hvis dere etter lansering bestemmer dere for å videreutvikle funksjonalitet betydelig, planlegg en gradvis migrasjon:

- Start med å lage en liten Flask-wrapper som importerer eksisterende funksjoner, slik at dere kan flytte en rute av gangen.
- Oppdater `requirements.txt` med `Flask` og legg til en enkel `app/__init__.py` og `app/routes.py`.
- Hold tests og Dockerfile oppdatert under overgangen.

## Docker-build: hvor bør bygget skje?

- **Alternativ 1 — Lokal bygg:** Kjør `docker build` på din Mac for lokal testing. Bra for rask iterasjon, men ikke ideelt for CI/deploy.
- **Alternativ 2 — CI (anbefalt for staging/prod):** Bygg image i GitHub Actions og push til en container registry (GitHub Container Registry eller Docker Hub). CI gir repeterbarhet, tag-historikk og enklere rollback.
- **Alternativ 3 — Fly remote build:** Kjør `flyctl deploy --remote-only` og la Fly bygge fra repoet i skyen. Enkelt, men mindre kontroll og vanskeligere å debugge byggfeil lokalt.

**Min anbefaling:** Bruk CI for å bygge og tagge images for `staging` og `production`. Bruk lokal bygg for utvikling og `flyctl deploy --remote-only` som fallback når dere vil unngå å sette opp registry.

Eksempel - lokalt bygg og kjøring:

```bash
docker build -t fugleobservasjoner:local .
docker run -p 5000:5000 fugleobservasjoner:local
```

Eksempel - CI (konsept):

```yaml
# .github/workflows/deploy.yml (utdrag)
name: CI Build & Deploy

on:
  push:
    branches: [ staging, main ]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - name: Run tests
        run: pip install -r requirements.txt && pytest -q
      - name: Build and push image
        run: |
          docker build -t ghcr.io/${{ github.repository }}/fugle:${{ github.sha }} .
          echo "push to registry..."
```

Legg gjerne merke til at detaljene må tilpasses deres registry og `flyctl`-bruk.

