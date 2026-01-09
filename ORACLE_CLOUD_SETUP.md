# Oracle Cloud Always Free - Setup Guide

## Oversikt
Oracle Cloud Always Free tier gir deg:
- 2 VMs med 1GB RAM hver (AMD eller ARM)
- 10GB block storage
- 100% gratis for alltid (ingen kredittkort nødvendig etter verifisering)

## Del 1: Opprett Oracle Cloud konto

1. Gå til: https://www.oracle.com/cloud/free/
2. Klikk "Start for free"
3. Fyll ut skjema (e-post, land, etc.)
4. Verifiser e-post og telefonnummer
5. Oppgi betalingsinformasjon (BARE for verifisering - du blir ikke belastet)
6. Vent på konto-aktivering (kan ta noen minutter)

## Del 2: Opprett VM Instance

1. **Logg inn** på Oracle Cloud Console
2. Naviger til: **Compute → Instances**
3. Klikk **"Create Instance"**

**Konfigurer instance:**
- **Name:** `fugleobservasjoner` (eller ønsket navn)
- **Compartment:** Behold default (root)
- **Placement:** Velg region nærmest deg (f.eks. Frankfurt, Stockholm)
- **Image:** `Oracle Linux 9` (eller Ubuntu 22.04 hvis du foretrekker det)
- **Shape:** 
  - Klikk "Change Shape"
  - Velg **VM.Standard.E2.1.Micro** (Always Free eligible)
  - 1 OCPU, 1GB RAM
- **Networking:**
  - Velg default VCN (Virtual Cloud Network)
  - Assign public IP: **JA** (huk av)
- **Add SSH Keys:**
  - Velg "Generate SSH key pair" ELLER
  - Last opp din egen public key (`.ssh/id_rsa.pub`)
  - **VIKTIG:** Last ned private key hvis du genererer - du får den bare én gang!

4. Klikk **"Create"**
5. Vent 1-2 minutter til status er "Running"
6. **Kopier Public IP-adressen** (f.eks. `123.45.67.89`)

## Tildel offentlig IP (anbefalt metode)

Hvis instansen ikke har fått tildelt en offentlig IP (Public IP address = `-`), gjør dette for å få en stabil ekstern IP:

1. Gå til **Networking → IP Management → Public IPs**
2. Klikk **Create Public IP**
  - Velg **Reserved**
  - Gi navn, f.eks. `fugleobservasjoner-public-ip`
  - Velg compartment og region
  - Klikk **Create**
3. Gå til **Compute → Instances → (din instance) → Attached VNICs → Primary VNIC**
4. Klikk på **IP administration**-fanen
5. På raden med private IP (f.eks. `10.0.0.196`), klikk **⋯** → **Edit**
6. Under **Public IP type**, velg **Reserved public IP**
7. Velg den reserverte IP-en du nettopp opprettet
8. Klikk **Save/Update**

Nå får du en offentlig, stabil IP-adresse (f.eks. `79.76.45.250`) som alltid peker til denne instansen.

**Fordeler:**
- Reserved IP endres ikke selv om du stopper/start VM
- Mer robust enn ephemeral IP

**SSH-tilkobling:**
```bash
chmod 600 ssh-key-2026-01-08.key
ssh -i ssh-key-2026-01-08.key opc@79.76.45.250
```

**Tips:**
- "channel XX: open failed"-meldinger i SSH er ufarlige og kan ignoreres
- Oracle UI kan være inkonsekvent – denne metoden virker alltid

Nå kan du fortsette med portåpning, Docker, deploy osv. som beskrevet under.

### Hvis "Public IP address" er `-`

Det betyr at instansen ikke har fått tildelt en offentlig IPv4-adresse (enda). Du kan normalt tildele dette i etterkant, men subnett/VCN må tillate det.

1. Gå til **Compute → Instances → (din instance)**
2. Åpne **Resources → Attached VNICs** → klikk på **Primary VNIC**
3. Åpne **Resources → IP addresses**
4. På raden med den private IP-en (f.eks. `10.0.0.x`), åpne menyen (⋯) og velg **Assign public IP** / **Edit** og velg **Ephemeral public IP**

Hvis du ikke får opp valg for public IP, sjekk dette:
- Subnettet må være et **Public subnet** (route table med `0.0.0.0/0` til **Internet Gateway**)
- **Prohibit public IP on VNIC** må være **av** for subnettet

Alternativ: Lag en **Reserved public IP** under **Networking → IP Management → Public IPs**, og assosier den til instansens private IP.

## Del 3: Åpne nødvendige porter

1. På instance-siden, klikk på **VCN-navnet** (under Primary VNIC)
2. Klikk på **Security Lists** → **Default Security List**
3. Klikk **"Add Ingress Rules"**

**Legg til følgende regler:**

**Regel 1: HTTP (port 80)**
- Source CIDR: `0.0.0.0/0`
- IP Protocol: `TCP`
- Destination Port Range: `80`

**Regel 2: HTTPS (port 443)**
- Source CIDR: `0.0.0.0/0`
- IP Protocol: `TCP`
- Destination Port Range: `443`

**Regel 3: Custom app port (port 3000 - midlertidig testing)**
- Source CIDR: `0.0.0.0/0`
- IP Protocol: `TCP`
- Destination Port Range: `3000`

4. Klikk **"Add Ingress Rules"**

## Del 4: Koble til VM via SSH

```bash
# Fra din lokale maskin (erstatt IP og path til SSH key)
ssh -i ~/.ssh/oracle_cloud_key opc@123.45.67.89

# Hvis du bruker Ubuntu image:
ssh -i ~/.ssh/oracle_cloud_key ubuntu@123.45.67.89
```

**Første gang du kobler til:**
- Svar "yes" når du spørres om fingerprint

## Del 5: Installer Docker på VM

**For Oracle Linux 8:**
```bash
# Oppdater system
sudo dnf update -y

# Installer Docker
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install docker-ce docker-ce-cli containerd.io docker-compose-plugin -y

# Start Docker
sudo systemctl start docker
sudo systemctl enable docker

# Legg til bruker i docker group (unngå sudo)
sudo usermod -aG docker $USER

# Logg ut og inn igjen for at group membership skal tre i kraft
exit
# SSH inn på nytt
ssh -i ~/.ssh/oracle_cloud_key opc@123.45.67.89

# Verifiser Docker
docker --version
docker run hello-world
```

**For Ubuntu 22.04:**
```bash
# Oppdater system
sudo apt update && sudo apt upgrade -y

# Installer Docker
sudo apt install -y docker.io docker-compose
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER

# Logg ut og inn igjen
exit
ssh -i ~/.ssh/oracle_cloud_key ubuntu@123.45.67.89

# Verifiser
docker --version
```

## Del 6: Åpne port 3000 i OS firewall

**Oracle Linux (firewalld):**
```bash
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload
```

**Ubuntu (ufw):**
```bash
sudo ufw allow 3000/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## Del 7: Deploy appen

### Alternativ A: Fra GitHub (anbefalt)

```bash
# Installer git hvis ikke allerede installert
sudo dnf install git -y  # Oracle Linux
# eller
sudo apt install git -y  # Ubuntu

# Klon repoet
git clone https://github.com/kjetil-salo/bird-observations-made-simple.git
cd bird-observations-made-simple

# Bygg Docker image
docker build -t fugleobservasjoner:latest .

# Kjør container
docker run -d \
  --name fugleobservasjoner \
  --restart unless-stopped \
  -p 3000:3000 \
  fugleobservasjoner:latest

# Sjekk at det kjører
docker ps
docker logs fugleobservasjoner
```

### Alternativ B: Fra lokalt (hvis repo er private)

**På din lokale maskin:**
```bash
cd /Users/kjetil/git/fugleobservasjoner

# Bygg image
docker build -t fugleobservasjoner:latest .

# Lagre til tar-fil
docker save fugleobservasjoner:latest | gzip > fugleobservasjoner.tar.gz

# Kopier til Oracle Cloud VM
scp -i ~/.ssh/oracle_cloud_key fugleobservasjoner.tar.gz opc@123.45.67.89:~
```

**På Oracle Cloud VM:**
```bash
# Last inn image
gunzip -c fugleobservasjoner.tar.gz | docker load

# Kjør container
docker run -d \
  --name fugleobservasjoner \
  --restart unless-stopped \
  -p 3000:3000 \
  fugleobservasjoner:latest

# Verifiser
docker ps
docker logs fugleobservasjoner
```

## Del 8: Test appen

```bash
# Fra VM
curl http://localhost:3000

# Fra din lokale maskin (erstatt med din IP)
curl http://123.45.67.89:3000
```

Åpne i nettleser: `http://123.45.67.89:3000`

## Del 9: Sett opp Nginx reverse proxy (valgfritt, anbefalt)

Dette lar deg bruke port 80 (HTTP) og senere 443 (HTTPS med SSL):

```bash
# Installer Nginx
sudo dnf install nginx -y  # Oracle Linux
# eller
sudo apt install nginx -y  # Ubuntu

# Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# Lag Nginx config
sudo tee /etc/nginx/conf.d/fugleobservasjoner.conf > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;  # Eller ditt domenenavn hvis du har et

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# Test config
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

Nå kan du åpne: `http://123.45.67.89` (uten port 3000)

## Del 10: Automatisk oppdatering (valgfritt)

Lag et deploy-script:

```bash
# På VM
cat > ~/update-app.sh << 'EOF'
#!/bin/bash
cd ~/bird-observations-made-simple
git pull
docker build -t fugleobservasjoner:latest .
docker stop fugleobservasjoner
docker rm fugleobservasjoner
docker run -d \
  --name fugleobservasjoner \
  --restart unless-stopped \
  -p 3000:3000 \
  fugleobservasjoner:latest
docker image prune -f
echo "App oppdatert: $(date)"
EOF

chmod +x ~/update-app.sh
```

Kjør når du vil oppdatere: `./update-app.sh`

## Del 11: SSL/HTTPS med Let's Encrypt (valgfritt)

**Krever domenenavn** (f.eks. `fugleobs.dindom.no`)

```bash
# Installer Certbot
sudo dnf install certbot python3-certbot-nginx -y  # Oracle Linux
# eller
sudo apt install certbot python3-certbot-nginx -y  # Ubuntu

# Oppdater Nginx config med ditt domenenavn
sudo nano /etc/nginx/conf.d/fugleobservasjoner.conf
# Endre: server_name _; til server_name fugleobs.dindom.no;

# Få SSL-sertifikat
sudo certbot --nginx -d fugleobs.dindom.no

# Auto-fornyelse (Certbot setter dette opp automatisk)
sudo certbot renew --dry-run
```

## Vedlikehold

**Se logger:**
```bash
docker logs -f fugleobservasjoner
```

**Restart container:**
```bash
docker restart fugleobservasjoner
```

**Stopp og slett container:**
```bash
docker stop fugleobservasjoner
docker rm fugleobservasjoner
```

**Se ressursbruk:**
```bash
docker stats fugleobservasjoner
```

## Backup

**Backup hele VM-disken (Oracle Cloud Console):**
1. Gå til Compute → Instances
2. Klikk på instance-navnet
3. Resources → Boot Volumes
4. Klikk på boot volume
5. Resources → Boot Volume Backups
6. Create Boot Volume Backup

**Backup Docker volume/data (hvis du legger til database senere):**
```bash
docker run --rm \
  --volumes-from fugleobservasjoner \
  -v $(pwd):/backup \
  alpine tar czf /backup/backup.tar.gz /app
```

## Kostnader

- VM (Always Free): **$0**
- Utgående nettverk (Always Free inkluderer 10TB/mnd): **$0**
- Block storage (Always Free inkluderer 100GB): **$0**

**Total: $0/måned** 🎉

## Feilsøking

**Problem: Kan ikke koble til port 3000**
- Sjekk Security List i Oracle Cloud Console
- Sjekk firewall: `sudo firewall-cmd --list-all` eller `sudo ufw status`
- Sjekk at container kjører: `docker ps`

**Problem: "Permission denied" når du kjører Docker**
- Logg ut og inn igjen etter å ha lagt til bruker i docker group
- Eller bruk `sudo` foran docker-kommandoer

**Problem: VM er treg**
- 1GB RAM er lite, men nok for din app
- Sjekk ressursbruk: `docker stats`
- Vurder å bruke begge Always Free VMs hvis du får flere prosjekter

## Neste steg

1. Sett opp domenenavn (Cloudflare er gratis DNS)
2. Konfigurer SSL med Let's Encrypt
3. Sett opp monitoring (f.eks. Uptime Robot - gratis)
4. Vurder å legge til GitHub Actions for automatisk deploy

Lykke til! 🚀
