# Oracle Free Tier: Kjør med Docker fra registry

1. Bygg og push image på Mac:
   ```sh
   docker build -t brukernavn/appnavn:latest .
   docker push brukernavn/appnavn:latest
   ```
2. På Oracle:
   ```sh
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   # Logg ut og inn igjen
   docker login
   docker pull brukernavn/appnavn:latest
   docker run -d -p 80:3000 brukernavn/appnavn:latest
   ```

Se README.md for swap og flere detaljer.
# Oracle Cloud - Hurtigguide (5 minutter)

Dette er en forenklet guide som kun dekker det essensielle. For detaljer, se [ORACLE_CLOUD_SETUP.md](ORACLE_CLOUD_SETUP.md).

## 🎯 Hva du må gjøre manuelt (10 minutter)

### Steg 1: Opprett Oracle Cloud konto (5 min)
1. Gå til: https://www.oracle.com/cloud/free/
2. Fyll ut skjema og verifiser e-post
3. Oppgi betalingskort (kun for verifisering - du belastes IKKE)
4. Vent på aktivering

### Steg 2: Opprett VM (3 min)
1. Logg inn på Oracle Cloud Console
2. **Compute → Instances → Create Instance**
3. Konfigurer:
   - **Name:** `fugleobservasjoner`
   - **Image:** `Oracle Linux 8` (default)
   - **Shape:** `VM.Standard.E2.1.Micro` (Always Free)
   - **SSH Keys:** Velg "Generate SSH key pair" og **LAST NED PRIVATE KEY**
   - **Public IP:** Huk av for "Assign public IP"
4. Klikk **Create**
5. Vent til status = "Running"
6. **Kopier Public IP-adressen** (f.eks. `123.45.67.89`)
````markdown
# Quick Start

Dette er en kort og direkte guide for å kjøre og deploye appen. For detaljer og alternative hosting-oppsett, se resten av repoet.

## Lokal kjøring

1. Installer avhengigheter:
```bash
python3 -m pip install -r requirements.txt
```

2. Start lokalt:
```bash
python3 server.py
```

Åpne `http://localhost:3000` i nettleseren.

## Deploy med Fly.io (anbefalt)

1. Installer `flyctl`: https://fly.io/docs/hands-on/install/
2. Logg inn: `fly auth login`
3. Deploy: `flyctl deploy`

Fly.io vil bygge image, deploye og gi deg en URL (f.eks. `https://enkel-ao.fly.dev/`).

## Supabase (valgfritt)

For enkel statistikk kan du koble Supabase og sette secrets i Fly:
```bash
flyctl secrets set SUPABASE_URL=... SUPABASE_KEY=...
```

## Legg til mer info
For historiske eller alternative oppsett (inkludert Oracle-eksperimenter), se ORACLE_NOTES.md.
````
- ✅ Installerer Docker
