# Bruk offisiell Python 3.12 slim image
FROM python:3.12-slim

# Sett working directory
WORKDIR /app

# Kopier server og public folder
COPY server.py .
COPY public/ ./public/

# Eksponer port 3000
EXPOSE 3000

# Kjør serveren
CMD ["python3", "server.py"]
