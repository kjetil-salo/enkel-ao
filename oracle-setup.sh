#!/bin/bash
# Oracle Cloud VM Setup Script - Automatisk installasjon
# Kjør dette på VM-en etter første SSH-innlogging

set -e  # Stopp ved feil

echo "🚀 Starter automatisk setup av Fugleobservasjoner..."

# Detect OS
if [ -f /etc/oracle-release ]; then
    OS="oracle"
    PKG_MGR="dnf"
    USER="opc"
elif [ -f /etc/lsb-release ]; then
    OS="ubuntu"
    PKG_MGR="apt"
    USER="ubuntu"
else
    echo "❌ Ukjent OS. Dette scriptet støtter Oracle Linux 8 eller Ubuntu."
    exit 1
fi

echo "📦 Detekterte OS: $OS"

# 1. Oppdater system
echo "📦 Oppdaterer system..."
if [ "$OS" = "oracle" ]; then
    sudo dnf update -y
elif [ "$OS" = "ubuntu" ]; then
    sudo apt update && sudo apt upgrade -y
fi

# 2. Installer Docker
echo "🐳 Installerer Docker..."
if [ "$OS" = "oracle" ]; then
    sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
elif [ "$OS" = "ubuntu" ]; then
    sudo apt install -y docker.io docker-compose
fi

# Start Docker
sudo systemctl start docker
sudo systemctl enable docker

# Legg bruker til docker group
sudo usermod -aG docker $USER

# 3. Installer Git
echo "📦 Installerer Git..."
if [ "$OS" = "oracle" ]; then
    sudo dnf install -y git
elif [ "$OS" = "ubuntu" ]; then
    sudo apt install -y git
fi

# 4. Åpne port 3000 i OS firewall
echo "🔥 Konfigurerer firewall..."
if [ "$OS" = "oracle" ]; then
    sudo firewall-cmd --permanent --add-port=3000/tcp
    sudo firewall-cmd --permanent --add-port=80/tcp
    sudo firewall-cmd --permanent --add-port=443/tcp
    sudo firewall-cmd --reload
elif [ "$OS" = "ubuntu" ]; then
    sudo ufw allow 3000/tcp
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    sudo ufw --force enable
fi

# 5. Klon repo
echo "📥 Kloner repository..."
cd ~
if [ -d "bird-observations-made-simple" ]; then
    echo "⚠️  Repository finnes allerede, oppdaterer..."
    cd bird-observations-made-simple
    git pull
else
    git clone https://github.com/kjetil-salo/bird-observations-made-simple.git
    cd bird-observations-made-simple
fi

# 6. Bygg Docker image
echo "🏗️  Bygger Docker image..."
docker build -t fugleobservasjoner:latest .

# 7. Stopp gammel container hvis den kjører
if docker ps -a | grep -q fugleobservasjoner; then
    echo "🛑 Stopper gammel container..."
    docker stop fugleobservasjoner 2>/dev/null || true
    docker rm fugleobservasjoner 2>/dev/null || true
fi

# 8. Kjør ny container
echo "🚀 Starter container..."
docker run -d \
  --name fugleobservasjoner \
  --restart unless-stopped \
  -p 3000:3000 \
  fugleobservasjoner:latest

# 9. Vent litt og sjekk status
sleep 3
if docker ps | grep -q fugleobservasjoner; then
    echo "✅ Container kjører!"
    docker ps | grep fugleobservasjoner
else
    echo "❌ Container startet ikke. Sjekk logs:"
    docker logs fugleobservasjoner
    exit 1
fi

# 10. Test at det fungerer
echo "🧪 Tester appen..."
sleep 2
if curl -s http://localhost:3000 > /dev/null; then
    echo "✅ Appen svarer på http://localhost:3000"
else
    echo "⚠️  Appen svarer ikke ennå, men containeren kjører. Sjekk logs:"
    docker logs fugleobservasjoner
fi

# 11. Finn public IP
PUBLIC_IP=$(curl -s ifconfig.me || echo "kunne-ikke-hente-ip")

echo ""
echo "========================================="
echo "✨ Setup fullført!"
echo "========================================="
echo ""
echo "📍 Appen kjører på:"
echo "   http://$PUBLIC_IP:3000"
echo ""
echo "📝 Nyttige kommandoer:"
echo "   docker logs -f fugleobservasjoner    # Se logger"
echo "   docker restart fugleobservasjoner    # Restart app"
echo "   docker ps                            # Se kjørende containers"
echo "   ~/bird-observations-made-simple/update-app.sh  # Oppdater app"
echo ""
echo "⚠️  VIKTIG: Logg ut og inn igjen for at Docker-rettigheter skal tre i kraft:"
echo "   exit"
echo "   ssh $USER@$PUBLIC_IP"
echo ""
echo "🔒 Husk å åpne port 3000 i Oracle Cloud Security List!"
echo "    (Se QUICK_START.md steg 3)"
echo ""
