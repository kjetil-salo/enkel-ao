# Plan: Migrering til Quarkus Backend

## Bakgrunn
Nåværende stack bruker Python `http.server.ThreadingHTTPServer` som er minimalistisk men lite robust. Quarkus gir bedre struktur, type safety og native compilation.

## Fase 1: Quarkus Backend

### 1.1 Opprett prosjekt
```bash
quarkus create app no.fugleobs:fugleobs-api \
  --extension=rest,rest-jackson,smallrye-health
```

### 1.2 REST Endpoints å implementere
| Endpoint | Beskrivelse |
|----------|-------------|
| `GET /api/species?search=X` | Proxy til artsobservasjoner.no |
| `GET /api/ao-sites?lat=X&lon=Y&size=Z` | Hent lokaliteter fra AO |
| `GET /api/reverse?lat=X&lon=Y` | Proxy til Nominatim |
| `POST /api/logview` | Logg sidevisning (valgfritt, Supabase) |
| `GET /health` | Health check (innebygd i Quarkus) |

### 1.3 Konfigurer
- CORS for frontend
- HTTP client for eksterne APIer (RestClient)
- User-Agent headers (etikk mot Nominatim/AO)
- Environment variabler: `NOMINATIM_URL`, `SUPABASE_*`

## Fase 2: Deploy til Fly.io

### 2.1 Dockerfile (native)
```dockerfile
FROM quay.io/quarkus/ubi-quarkus-mandrel-builder-image:jdk-21 AS build
COPY --chown=quarkus:quarkus . /code
WORKDIR /code
RUN ./mvnw package -Dnative

FROM quay.io/quarkus/quarkus-micro-image:2.0
COPY --from=build /code/target/*-runner /application
EXPOSE 3000
CMD ["./application", "-Dquarkus.http.port=3000"]
```

### 2.2 Oppdater fly.toml
- Endre build-kommando eller bruk pre-built image
- Behold samme porter og env vars

### 2.3 Test
1. Deploy til staging først
2. Verifiser alle endpoints
3. Kjør E2E-tester mot staging

## Fase 3: Frontend (valgfritt)

Frontend (vanilla JS) fungerer bra. Mulige forbedringer:
- **htmx**: Enklere server-side rendering for deler av UI
- **Qute templates**: Quarkus sin template engine hvis du vil flytte mer til backend

## Filstruktur etter migrering

```
fugleobservasjoner/
├── src/main/java/no/fugleobs/
│   ├── api/
│   │   ├── SpeciesResource.java
│   │   ├── AoSitesResource.java
│   │   └── ReverseGeoResource.java
│   └── client/
│       ├── ArtsobservasjonerClient.java
│       └── NominatimClient.java
├── src/main/resources/
│   ├── META-INF/resources/  # Frontend filer her
│   │   ├── index.html
│   │   ├── style.css
│   │   └── js/
│   └── application.properties
├── Dockerfile
└── fly.toml
```

## Tidsestimat
- Fase 1: Grunnleggende backend
- Fase 2: Deploy-oppsett
- Fase 3: Valgfritt

## Notater
- Behold Python-versjonen som backup/referanse
- Kjør parallelt på staging til Quarkus er verifisert
- Native build gir ~50ms oppstartstid vs ~2s for JVM
