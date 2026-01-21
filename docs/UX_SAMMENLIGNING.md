# UX-sammenligning: Enkel AO vs Artsobservasjoner.no

En analyse av brukervennlighet mellom den offisielle Artsobservasjoner.no og Enkel AO.

## Artsobservasjoner.no

### Styrker
- Komplett funksjonalitet - alle felt tilgjengelig
- Kart integrert direkte i skjemaet
- Bildeopplasting
- Offisiell database - data publiseres direkte

### Svakheter
- **Overveldende grensesnitt**: 20+ synlige felt på én gang
- **Desktop-fokusert**: Lite egnet for mobil i felt
- **Mye klikking**: Dato/tid krever mange interaksjoner
- **Kognitiv last**: Brukeren må ignorere irrelevante felt (dybde, vekt, lengde for fugleobservasjoner)
- **Ingen smarte defaults**: Må fylle ut dato/tid manuelt for hver observasjon

## Enkel AO

### Styrker
- **Fokusert**: Kun det du trenger i felt (art, antall, aktivitet)
- **Mobil-først**: Fungerer med én hånd, store touch-targets
- **Smarte defaults**: Tid settes automatisk, oppdateres ved endring av antall
- **Rask workflow**: Søk art → velg → ferdig
- **Batch-registrering**: Samle flere observasjoner, eksporter samlet til AO
- **Progressiv avsløring**: Kommentarer og detaljer tilgjengelig via edit, men skjult fra hovedflyten

### Svakheter
- Ingen bildestøtte (planlagt)
- Krever manuell overføring til AO for publisering
- Begrenset metadata (ingen alder/kjønn per nå)

## Designfilosofi

### AO-tilnærming
> "Her er 25 felt, fyll ut det du trenger"

Viser alt samtidig. Brukeren må selv filtrere ut irrelevant informasjon.

### Enkel AO-tilnærming
> "Her er det du trenger. Vil du ha mer? Trykk edit."

Strømlinjeformet hovedflyt med detaljer tilgjengelig ved behov.

## Konklusjon

Enkel AO løser **80/20-problemet**: De fleste feltobservasjoner trenger bare art + antall + sted + tid. Artsobservasjoner.no tvinger brukeren gjennom et skjema designet for edge cases (dybde, vekt, substrat, natursystem).

**Enkel AO er en feltnotisblokk. Artsobservasjoner.no er et arkivsystem.**

Begge har sin plass, men for rask registrering i felt - med kalde fingre og dårlig tid - er Enkel AO betydelig mer effektiv.

## Brukerscenario

**Typisk feltdag med 15 arter:**

| Handling | Artsobservasjoner.no | Enkel AO |
|----------|---------------------|----------|
| Registrer art | ~30 sek/art | ~5 sek/art |
| Total tid (15 arter) | ~8 minutter | ~75 sekunder |
| Klikk/taps per art | ~10-15 | ~3-4 |
| Mobilbruk | Vanskelig | Optimalisert |

*Tidsbesparelser er estimater basert på typisk bruk.*
