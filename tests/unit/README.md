# Unit Tests for JavaScript Modules

Denne mappen inneholder unit-tester for frontend JavaScript-moduler.

## Hvordan kjøre testene

```bash
# Kjør alle tester én gang
npm test

# Kjør tester i watch-modus (auto-rerun ved endringer)
npm run test:watch

# Kjør tester med UI
npm run test:ui

# Kjør tester med coverage-rapport
npm run test:coverage
```

## Test-struktur

### `ui.test.js` - UI-hjelpefunksjoner

Tester for `haversine()` funksjonen som beregner avstand mellom koordinater:
- ✅ Avstand Oslo-Bergen (~308 km)
- ✅ Identiske koordinater (0 meter)
- ✅ Korte avstander (~1 km)
- ✅ Ekvatorovergang
- ✅ Nollmeridianovergangtest

**5 tester totalt**

### `observations.test.js` - Observasjonshåndtering

Tester for `toCsv()` funksjonen som konverterer observasjoner til CSV-format:
- ✅ Tom array returnerer tom streng
- ✅ Korrekt CSV-header genereres
- ✅ Enkelt observasjon formateres korrekt
- ✅ Manglende species håndteres
- ✅ coObservers array (objekter og strings)
- ✅ Spesialtegn (; , tab) erstattes med komma
- ✅ Dagens dato brukes hvis timestamp mangler
- ✅ Multiple observasjoner
- ✅ Tom coObservers array
- ✅ tilKlokkeslett som sluttid

**10 tester totalt**

## Teknologi

- **Test runner:** [Vitest](https://vitest.dev/) v4
- **DOM-miljø:** JSDOM (for å simulere nettleser-miljø)
- **Coverage:** V8

## Hva testes ikke med unit-tester

Følgende funksjoner testes via E2E-tester (Playwright):
- `renderObservations()` - Kompleks DOM-manipulering, bedre egnet for E2E
- `main.js` - Integrasjonstesting av hele applikasjonen
- Event handlers og brukerinteraksjon
- API-kall og nettverkshåndtering

## Legge til nye tester

1. Opprett en ny `.test.js`-fil i `tests/unit/`
2. Importer funksjoner fra `public/js/`
3. Bruk Vitest `describe`, `it`, og `expect`
4. Kjør `npm test` for å verifisere

### Eksempel

```javascript
import { describe, it, expect } from 'vitest';
import { minFunksjon } from '../../public/js/min-modul.js';

describe('minFunksjon', () => {
  it('should do something', () => {
    const result = minFunksjon('input');
    expect(result).toBe('expected output');
  });
});
```

## Best practices

- **En funksjon per test-fil:** Lettere å vedlikeholde
- **Deskriptive test-navn:** Beskriv hva som testes og forventet resultat
- **Test edge cases:** Tomme arrays, null-verdier, spesialtegn
- **Isolerte tester:** Hver test skal kunne kjøre uavhengig
- **Ingen side-effects:** Tester skal ikke påvirke hverandre

## Coverage

Kjør `npm run test:coverage` for å se testdekningsgrad.

Målet er:
- ✅ **Functions:** > 80%
- ✅ **Lines:** > 80%
- ✅ **Branches:** > 70%

Filer ekskludert fra coverage:
- `main.js` (testes via E2E)
- Konfigurasjonsfiler
- node_modules
- E2E-tester
