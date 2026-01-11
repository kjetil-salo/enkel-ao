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

### Steg 3: Åpne porter i Security List (2 min)
1. På instance-siden → klikk VCN-navnet
2. **Security Lists → Default Security List**
3. **Add Ingress Rules:**

**Regel 1:**
- Source CIDR: `0.0.0.0/0`
- IP Protocol: `TCP`
- Destination Port: `3000`

**Regel 2:**
- Source CIDR: `0.0.0.0/0`
- IP Protocol: `TCP`
- Destination Port: `80`

4. Klikk **Add Ingress Rules**

---

## 🚀 Automatisk setup (1 kommando)

### SSH inn på VM:
```bash
# Fra din Mac (erstatt med din IP og path til SSH-nøkkelen du lastet ned)
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key opc@123.45.67.89
```

### Kjør setup-script:
```bash
# På VM-en, kjør denne ene kommandoen:
curl -fsSL https://raw.githubusercontent.com/kjetil-salo/bird-observations-made-simple/main/oracle-setup.sh | bash
```

**Dette scriptet gjør alt automatisk:**
- ✅ Oppdaterer system
- ✅ Installerer Docker
- ✅ Installerer Git
- ✅ Åpner nødvendige porter i OS firewall
- ✅ Kloner repoet
- ✅ Bygger Docker image
- ✅ Starter appen

**Vent ~5 minutter mens scriptet kjører.**

### Logg ut og inn igjen:
```bash
exit
ssh -i ~/Downloads/ssh-key-*.key opc@123.45.67.89
```

### Test at det virker:
Åpne i nettleser: `http://DITT-PUBLIC-IP:3000`

---

## 🔄 Oppdatere appen senere

Når du pusher nye endringer til GitHub:

```bash
# SSH inn på VM
ssh -i ~/Downloads/ssh-key-*.key opc@123.45.67.89

# Kjør update-script
~/bird-observations-made-simple/update-app.sh
```

Ferdig! ✨

---

## 🛠️ Nyttige kommandoer

```bash
# Se logger
docker logs -f fugleobservasjoner

# Restart app
docker restart fugleobservasjoner

# Se status
docker ps

# Sjekk ressursbruk
docker stats fugleobservasjoner
```

---

## ❓ Problemer?

**Kan ikke koble til port 3000:**
- Sjekk at du har åpnet port 3000 i Security List (Steg 3)
- Vent 1-2 minutter etter å ha lagt til regelen

**"Permission denied" ved Docker-kommandoer:**
- Logg ut og inn igjen: `exit` → ssh inn på nytt

**App svarer ikke:**
- Sjekk logs: `docker logs fugleobservasjoner`
- Restart: `docker restart fugleobservasjoner`

---

## 📚 For mer info

Se fullstendig guide: [ORACLE_CLOUD_SETUP.md](ORACLE_CLOUD_SETUP.md)

Inkluderer:
- SSL/HTTPS setup med Let's Encrypt
- Nginx reverse proxy
- Backup-strategier
- Detaljert feilsøking
