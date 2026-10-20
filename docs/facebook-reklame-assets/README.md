# Facebook-reklame for Enkel-AO

Markedsføringsmateriell. Ligger bevisst utenfor det som deployes.

## Gjeldende sett — oktober 2026 (v1.53.38)

Laget for **Artsobservasjoner-brukerforum**, derfor saklig og litt ydmuk
tone: appen presenteres som et hjelpemiddel for AO-brukere, ikke som en
kritikk av AO.

**Én samlet plansje:**

- `enkel-ao-plansje-fellestur-2026.svg` / `.png` (1080×1315)
- `enkel-ao-plansje-fellestur-2026-tekst.md`

**Karusell, tre bilder (1080×1350):**

1. `enkel-ao-karusell-2026-1-fellestur.svg` / `.png`
2. `enkel-ao-karusell-2026-2-registrering.svg` / `.png`
3. `enkel-ao-karusell-2026-3-sjeldenhet.svg` / `.png`
- `enkel-ao-karusell-2026-tekst.md`

Plansjen og karusellen er to alternativer for samme budskap — velg én.

### Skjermbilder (`screens/`, prefiks `enkel-ao-v15338-`)

| Fil | Mål | Viser |
|---|---|---|
| `hovedskjerm.png` | 500×1210 | Hele hovedsiden, lyst tema |
| `fellestur-kode.png` | 460×245 | Delingskoden og turnavnet |
| `fellestur-logg.png` | 500×372 | Den delte loggen, fem rader |
| `fellestur-logg3.png` | 500×198 | Tre rader, tre ulike personer |
| `sjeldenhetsvarsel.png` | 500×592 | Ekte AO-varsel for rosenstare |

Alle er tatt mot den kjørende appen i mobilvisning. `hovedskjerm.png` er sydd
sammen av to fangster fordi Chrome ikke gir vindusbredde under 500 px — den
festede lokasjonslinja måtte settes til `position: static` før nedre fangst,
ellers kom den med i begge.

### To ting som må bevares ved neste oppdatering

**Navnene i fellestur-loggen må være lesbare.** At Heilo, Sandlo og
Lappspove er registrert av tre ulike personer er hele poenget med
funksjonen. I et tidlig utkast lå loggen som et lite støttebilde og navnene
forsvant — da sier bildet ingenting.

**Sjeldenhetsvarselet er et ekte AO-svar.** «Meget sjelden (11-100) i
Hordaland» for rosenstare på Herdla kom fra Artsobservasjoner, ikke fra
appen. Ikke bytt det mot en oppdiktet art.

## Eldre sett

- `enkel-ao-plansje-deling-bilder-2026.*` — august 2026, bilder og deling
- `enkel-ao-plansje-sommer-2026.*` — juni 2026
- `enkel-ao-karusell-1-lokalitet.svg`, `-2-kart.svg`, `-3-moduser.svg` — juni 2026

Skjermbildene i disse viser et eldre UI («② Observasjon», «Bytt plass») og
bør ikke gjenbrukes.

## Rendre på nytt

```bash
rsvg-convert -o fil.png fil.svg
```

`<image href>` peker på absolutte lokale filstier — `rsvg-convert` leser dem
rett fra disk, ingen webserver nødvendig. Flyttes mappa, må stiene oppdateres.
