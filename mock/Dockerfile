FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir flask
COPY nominatim_app.py .
EXPOSE 8080
CMD ["python3", "nominatim_app.py"]
