# Fugleobservasjoner

En lynrask app for å registrere fugleobservasjoner i felt – designet for å la deg bruke mer tid på å se på fuglene og mindre tid på å trykke på små skjermknapper.

> **📢 Om prosjektet:** Dette er et personlig prosjekt utviklet for eget bruk og delt åpent for transparens. Koden er tilgjengelig under MIT-lisens. Issues og pull requests mottas gjerne, men uten garanti for rask respons. Se [CONTRIBUTING.md](CONTRIBUTING.md) for mer info.

## Hvorfor denne appen?

🔥 **Lokasjonsfinneren er gull verdt:** På nye og ukjente steder får du automatisk riktig lokalitetsnavn fra Artsobservasjoner med étt knappetrykk. Slutt på å gjette stedsnavn når du kommer hjem.

⚡ **Sekunder fra fugl til lagret observasjon:** Autocomplete finner arten mens du skriver, Enter-tasten tar deg videre, og du er klar for neste art.

📱 **Designet for felt:** Glem å navigere gjennom menyer med kalde fingre. Her er alt på én side, optimalisert for mobil.

🏠 **Valider hjemme på stor skjerm:** Du kan lime inn i Artsobservasjoner direkte fra mobilen, men de fleste foretrekker å gjøre det hjemme – der er det enklere å se gjennom alt før publisering.

## Hovedfunksjoner

## Hovedfunksjoner

- 📍 **Automatisk lokalitetsfinner** – henter nærmeste lokaliteter fra Artsobservasjoner (inkludert private hvis de er dine egne)
- 🔍 **Artssøk med autocomplete** – slår opp mot Artsobservasjoner for korrekte artsnavn
- ⚡ **Lynrask registrering** – art, antall, aktivitet, stedsnavn på sekunder
- 📋 **Tabelloversikt** – alle observasjoner gruppert per lokalitet
- 🗑️ **Redigering** – slett enkeltobservasjoner med ett trykk
- 🚀 **Direkte eksport** – «Kopier og åpne AO»-knapp som kopierer data og åpner importskjemaet
- 📖 **Innebygd hjelpeside** med brukerveiledning
- 🔒 **100% personvern** – ingen data lagres på server

## Personvern

- **Ingen data lagres på server.** Python-serveren er kun et proxy-mellomledd mot Artsobservasjoner.
- Alle observasjoner lagres bare i nettleseren din (localStorage) til du selv eksporterer eller tømmer lista.
- Ingen tracking, ingen analytics, ingen skylagring.

**Logging:** Ved hver sidevisning logges kun IP-adresse og nettleser (User-Agent) til serverens logg for enkel besøksstatistikk. Ingen søkestrenger, observasjonsdata eller annen sensitiv informasjon logges.

## Kom i gang (for den som kjører lokalt)

1. Sørg for at du har Python 3 installert.
2. I prosjektmappen:
   - `python3 server.py`
3. Åpne `http://localhost:3000` i nettleseren.

For mer detaljert brukerbeskrivelse (inkludert tips om AO-lokaliteter og import), se [bruk.md](bruk.md).

## Versjon

**v1.0** (januar 2026) – Første stabile versjon med alle kjernefunksjoner.

## Videre utvikling

Planlagte funksjoner for fremtidige versjoner:

- **Valgfrie felt** (kjønn, alder, kommentar) som kan vises/skjules etter brukerens ønske (default: skjult)
- Mulighet for å redigere eksisterende observasjoner
- Batch-operasjoner (endre lokalitet på flere observasjoner samtidig)

Forslag? Send en e-post til [k@vikebo.com](mailto:k@vikebo.com)!

## Lisens

Dette prosjektet er lisensiert under MIT-lisensen. Se [LICENSE](LICENSE) for detaljer.

---

**Utviklet av Kjetil Salomonsen** | [k@vikebo.com](mailto:k@vikebo.com) | © 2026
