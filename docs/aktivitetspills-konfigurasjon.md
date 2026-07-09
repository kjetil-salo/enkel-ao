# Konfigurerbare Aktivitetspills

## Oversikt

Fra versjon 1.18.0 kan brukere konfigurere hvilke aktiviteter som vises som hurtigknapper (pills) i registreringsgrensesnittet.

## Funksjonalitet

### Før (v1.17.x)
- **Hardkodet liste**: De 6 første aktivitetene var fast definert i kode
- **Kun antall konfigurerbart**: Bruker kunne velge 1-6 pills
- **Fast rekkefølge**: Alltid Stasjonær, Rastende, Overflygende, Næringssøkende, Trekkende, Sang/spill

### Etter (v1.18.0+)
- **Dynamisk liste**: Bruker velger fritt fra alle 75 aktiviteter
- **0-6 pills**: Kan ha ingen, få eller mange hurtigknapper
- **Egendefinert rekkefølge**: Brukeren bestemmer rekkefølgen
- **Kontekst-tilpasset**: Enkelt å endre basert på sesong/lokasjon

## Brukerveiledning

### Konfigurere Pills

1. Gå til **Innstillinger** (klikk ⚙️ eller `/settings.html`)
2. Se seksjonen **"Aktivitets-hurtigknapper (0-6)"**
3. For å endre en pill:
   - Klikk på dropdown-menyen
   - Velg ønsket aktivitet
4. For å legge til ny pill:
   - Klikk **"+ Legg til aktivitet"**
   - Velg aktivitet fra dropdown
5. For å fjerne pill:
   - Klikk 🗑️-knappen ved siden av pillen

### Tips

**Sommer-konfigurasjon:**
```
Sang/spill
Revirhevdende
Næringssøkende
Hekkefunn
```

**Vinter/trekk-konfigurasjon:**
```
Trekkende mot N
Trekkende mot S
Rastende
Overflygende
```

**Sjø-konfigurasjon:**
```
Svømmende
Dykkende
Overflygende
Rastende
```

## Teknisk Implementasjon

### localStorage Schema

**Nøkkel:** `activityPills_v1`

**Format:**
```json
{
  "version": 1,
  "pills": [
    { "label": "Stasjonær", "value": "23", "short": "Stasj" },
    { "label": "Rastende", "value": "22" },
    { "label": "Overflygende", "value": "24" }
  ]
}
```

**Felter:**
- `label`: Aktivitetens visningsnavn (brukes til matching mot `<select>`)
- `value`: Aktivitetens ID-verdi i activities.json (brukes til `<select>`)
- `short` *(valgfritt)*: Kort visningsnavn på pill-knappen (maks 5 tegn). Tomt/utelatt → vis fullt `label`. Gir mer kompakte knapper slik at flere får plass på skjermen.

### Forkortelser (hybrid, v1.30.0+)

Pill-knappene kan vise et kort navn i stedet for fullt aktivitetsnavn:
- Kortnavnet er **kun visning** – klikk matcher fortsatt på fullt `label` mot `<select>`.
- Ved forkortelse settes `title` = fullt navn (tooltip).
- I innstillinger finnes en **«Foreslå forkortelser»**-knapp som fyller inn kuraterte kortnavn for standard-aktivitetene (`ACTIVITY_SHORT_SUGGESTIONS` i `storage.js`, nøklet på `value`). Den fyller kun **tomme** felt, så egne kortnavn overskrives ikke.
- Brukeren kan når som helst redigere eller skrive egne kortnavn.

### Migrering

Brukere med gammelt format (`activityPillCount`) migreres automatisk:

**Gammelt format:**
```
activityPillCount = "4"
```

**Nytt format (etter migrasjon):**
```json
{
  "version": 1,
  "pills": [
    { "label": "Stasjonær", "value": "23" },
    { "label": "Rastende", "value": "22" },
    { "label": "Overflygende", "value": "24" },
    { "label": "Næringssøkende", "value": "25" }
  ]
}
```

### Endrede Filer

**Backend/Storage:**
- `public/js/storage.js` - Nye funksjoner: `saveActivityPills()`, `loadActivityPills()`, `migrateFromOldPillCount()`

**Frontend:**
- `public/js/observation-commit.js` - Fjernet hardkodet `ALL_ACTIVITY_PILLS`, bruker `loadActivityPills()`
- `public/settings.html` - Nytt UI med dynamisk liste og +/- knapper

**Data:**
- `public/data/activities.json` - Eksisterende (ingen endring)

### Testing

**Unit-tester:**
```bash
python3 -m pytest tests/test_activity_pills_feature.py -v
```

**E2E-tester:**
```bash
cd tests/e2e_playwright
npm test -- activity-pills.spec.ts
```

## Bakoverkompatibilitet

- ✅ Eksisterende brukere med `activityPillCount` migreres automatisk
- ✅ Ingen breaking changes - alle gamle features fungerer
- ✅ Standard er 4 pills (som før)
- ℹ️ `activityPillCount` leses ikke lenger, men slettes ikke fra localStorage

## Fremtidige Forbedringer

**Mulige tillegg:**
- Presets (f.eks. "Sommer", "Vinter", "Sjø")
- Drag-and-drop for å endre rekkefølge
- Automatisk bytte basert på måned/lokasjon
- Import/eksport av konfigurasjoner
