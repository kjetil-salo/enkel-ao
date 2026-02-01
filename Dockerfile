# Bruk offisiell Python 3.12 slim image
FROM python:3.12-slim

# Installer curl (brukes av ao_import)
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Sett working directory
WORKDIR /app

# Kopier requirements og installer avhengigheter
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Kopier server, src-moduler og public folder
COPY server.py .
COPY src/ ./src/
COPY public/ ./public/

# Eksponer port 3000
EXPOSE 3000

# Kjør serveren
CMD ["python3", "server.py"]
