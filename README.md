

# Enkel AO (Artsobservasjoner.no)

En lynrask, superenkel webapp for å registrere fugleobservasjoner direkte til Artsobservasjoner.no – alt fokus på minst mulig klikk og tastetrykk. Alt lagres kun i nettleseren din og eksporteres enkelt til AO-importskjemaet.

**Live:**
- https://ao.efugl.no – stabil produksjon (kjører på Raspberry Pi)
- https://enkel-ao-staging.fly.dev – siste endringer og eksperimenter (kan være ustabil)

> `enkel-ao.fly.dev` er under avvikling — flytt bokmerke/hjemskjerm-ikon til `ao.efugl.no`.

## Hovedfunksjoner
- 📍 Automatisk lokalitetsfinner (AO-integrasjon)
- 🗺️ **Interaktivt kart** med alle AO-lokaliteter (Leaflet + OpenStreetMap)
  - Klikk på lokalitet i kart for å velge den automatisk
  - Grønne/oransje markører med navn og avstand
  - Private lokaliteter filtreres bort
- 🔍 Artssøk med autocomplete
   - Underarter kan vises ("Vis underarter") kun når du er online. I offline-modus får du kun hovedarter, og en tydelig advarsel vises under boksen.
   - **Valgt art vises direkte i søkefeltet** (ikke som separat "pill").
   - **All tekst i søkefeltet markeres ved klikk** når art er valgt, for rask overskriving.
- ⚡ Lynrask og enkel registrering (art, antall, aktivitet, sted)
- 🎯 **Konfigurerbare aktivitetspills** (v1.18.0+)
  - Velg fritt fra alle 75 aktiviteter som hurtigknapper (0-6 pills)
  - Tilpass basert på sesong/lokasjon (f.eks. "Trekkende mot N" for høst, "Sang/spill" for vår)
  - Konfigurer i innstillinger med enkle +/- knapper
- 🕐 **Feltmodus vs Etterregistrering**
  - **Felt** (grønn pill): Timestamp settes automatisk til "nå"
  - **Etterreg** (rød pill): Velg egen dato + valgfri tid for tidligere observasjoner
  - Bytt modus ved å klikke på pill i header eller via innstillinger
- 👥 Medobservatører (AO-import)
- 🗑️ Redigering og sletting
- 🚀 Direkte eksport til AO-importskjema
- 📖 Innebygd hjelpeside
- 🔒 100% personvern (ingen data på server)
- 🟦 Kompakt layout for iPad og store skjermer
- 📱 Full offline-støtte med lokal artsliste

Se også fersk [brukervurdering](docs/brukervurdering.md) for styrker, svakheter og forslag.

## Kom i gang
1. Sørg for at du har Python 3 installert.
2. I prosjektmappen:
   - `python3 server.py`
3. Åpne `http://localhost:3000` i nettleseren.

For mer detaljert brukerbeskrivelse, se [docs/bruk.md](docs/bruk.md).

## Testing

Prosjektet har både unit-tester og end-to-end-tester:

### Unit-tester (JavaScript)
```bash
npm test                 # Kjør alle unit-tester
npm run test:watch       # Watch-modus
npm run test:coverage    # Med coverage-rapport
```

Tester for:
- `haversine()` - Avstandsberegning mellom koordinater
- `toCsv()` - CSV-eksport av observasjoner

Se [tests/unit/README.md](tests/unit/README.md) for detaljer.

### E2E-tester (Playwright)
```bash
cd tests/e2e_playwright
npm test                 # Kjør mot live server
npm run test:mock        # Kjør mot mock server
```

Tester hele brukerflyt fra lokasjon til eksport.

### Python backend-tester
```bash
pytest --maxfail=3       # Kjør Python unit-tester
```

Tester API-endepunkter og backend-logikk.


## Personvern
- **Ingen data lagres på server.** Alt lagres kun i nettleseren din (localStorage) til du eksporterer eller tømmer lista.
- Ingen tracking, ingen analytics, ingen skylagring.

## 🆕 Nytt i v1.15.0
- **Interaktivt kart**: Se alle AO-lokaliteter på et OpenStreetMap-basert kart (Leaflet)
- **Velg lokalitet fra kart**: Klikk på lokalitet i kart → sendes tilbake med stedsnavn fylt ut → art-feltet får fokus
- **Fargekodede markører**: Grønne for vanlige lokaliteter, oransje for superlokasjon
- **Permanent labels**: Navn og avstand vises alltid på kartet
- **Smart filtrering**: Private lokaliteter vises ikke på kartet
- Always-on: Appen er alltid våken (min_machines_running = 1 i fly.toml).
- Eksport av periode: "Til klokkeslett" (AO-periode) oppdateres alltid når antall endres i artslisten.
- Redigeringsside: `public/edit.html` gir mulighet for å endre registrerte observasjoner og legge til en kommentar. Kommentarer inkluderes i CSV-eksporten under kolonne 15 ("Kommentar (synlig for alle)").

## Versjon
Appversjon: **1.9.1**
Se også CHANGELOG.md og release-notes/v1.9.0.md for detaljer.

## Deploy og teknisk

Appen er satt opp med `min_machines_running = 1` i fly.toml, som gjør at den alltid er våken og svarer umiddelbart – ingen dvale. Health check-endpointet `/health` overvåkes av Fly.io for stabil drift.

Se [fly.toml](fly.toml) og [docs/deploy_strategy.md](docs/deploy_strategy.md) for detaljer om deploy og drift.

## Videre utvikling
- Ytterligere forbedringer for mobil og desktop
- Mulighet for å vise/skjule valgfrie felt (kjønn, alder, kommentar)
- Batch-operasjoner (endre lokalitet på flere observasjoner samtidig)
- Ytelsesforbedringer og flere eksportmuligheter
- Mulig støtte for underarter i offline-modus hvis AO åpner for bedre import av slike navn.

Forslag? Send en e-post til [k@vikebo.com](mailto:k@vikebo.com)!

## Lisens
Dette prosjektet er lisensiert under MIT-lisensen. Se [LICENSE](LICENSE) for detaljer.

---

**Utviklet av Kjetil Salomonsen** | [k@vikebo.com](mailto:k@vikebo.com) | © 2026


