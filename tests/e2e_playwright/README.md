# Playwright E2E-tester for Fugleobservasjoner

## Installasjon

```bash
cd tests/e2e_playwright
npm install
npx playwright install --with-deps
```

## Kjøre tester

### Mot live server (krever at appen kjører)

```bash
# Start appen først (i annet terminalvindu)
python3 ../../server.py

# Kjør alle tester
npm test

# Kun smoke-test
npm test -- --grep @smoke

# Med synlig browser
npm test -- --headed
```

### Med mock-server (anbefalt for utvikling)

Mock-serveren simulerer alle API-kall lokalt uten eksterne avhengigheter:

```bash
# Kjør tester med automatisk mock-server
npm run test:mock

# Eller start mock-server manuelt
npm run mock
# I annet vindu:
BASE_URL=http://localhost:3333 npm test
```

## Testscenarier

### Smoke-test (`@smoke`)
- Verifiserer at siden laster
- Sjekker at hovedelementer er synlige

### Artssøk
- Søk med autocomplete

Running the super-site test
---------------------------

Start the mock server and run Playwright tests (from this folder):

```bash
npm install
npm run test:with-mock
```

The new test `super-site.spec.ts` verifies that mock parent-site appears first and has the `Superlokalitet` badge.
- Velge art fra liste (klikk eller Enter)
- Piltast-navigering
- Melding ved for kort søkestreng

### Brukergrensesnitt
- Loading-status
- Antall-felt

## Mock-server

Mock-serveren ([mock-server.ts](mock-server.ts)) tilbyr:

- `/api/species?search=<query>` - Artssøk med forhåndsdefinerte arter
- `/api/reverse?lat=X&lon=Y` - Geokoding (returnerer Oslo)
- `/api/ao-sites?lat=X&lon=Y` - Lokaliteter

**Mock-arter:** gråspurv, blåmeis, meis (3 treff), trost (3 treff), ørn (2 treff)

## Miljøvariabler

| Variabel | Beskrivelse | Standard |
|----------|-------------|----------|
| `BASE_URL` | URL til appen | `http://localhost:3000` |
| `MOCK_PORT` | Port for mock-server | `3333` |
| `CI` | Kjører i CI-miljø (headless) | - |
