# Bruk offisiell Python 3.12 slim image
FROM python:3.12-slim

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

# Helsesjekk mot /health - PORT-en varierer per miljø (satt via env, se .env)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python3 -c "import os,sys,urllib.request; p=os.environ.get('PORT','3000'); sys.exit(0 if urllib.request.urlopen(f'http://localhost:{p}/health', timeout=3).status==200 else 1)"

# Kjør serveren
CMD ["python3", "server.py"]
