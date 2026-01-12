# Quick Start

Kort guide for å kjøre og deploye appen. For detaljer, se README.md.

## Lokal kjøring

1. Installer avhengigheter:
```bash
python3 -m pip install -r requirements.txt
```

2. Start server:
```bash
python3 server.py
```

Åpne `http://localhost:3000` i nettleseren.

## Tester (valgfritt)

Hvis du har installert dev-avhengigheter:
```bash
python3 -m pip install -r requirements-dev.txt
python3 -m pytest -q
```

## Deploy med Fly.io (lokalt)

1. Installer `flyctl`: https://fly.io/docs/hands-on/install/
2. Logg inn: `fly auth login`
3. Deploy: `flyctl deploy`

## Deploy via GitHub Actions (anbefalt)

Deploy skjer kun når du pusher en tag som starter med `v` (f.eks. `v1.1.3`). Push til `main` kjører tester, men deployer ikke.

## Supabase (valgfritt)

For enkel statistikk kan du koble Supabase og sette secrets i Fly:
```bash
flyctl secrets set SUPABASE_URL=... SUPABASE_KEY=...
```

## Oracle Cloud / Docker

Hvis du vil kjøre på Oracle Free Tier eller annet sted med Docker, se ORACLE_CLOUD_SETUP.md.
