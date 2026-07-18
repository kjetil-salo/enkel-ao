# UX-forbedringer juli 2026 (v1.32.0)

*Iterasjon 18. juli 2026. Utløst av en sammenligning mot feltlogg.no/fl og et ønske om å utnytte bredden bedre i observasjonslista.*

## Bakgrunn og premiss

Sammenligning mot **feltlogg.no**: folk opplever feltlogg som «mer intuitiv», men den er
egentlig ikke raskere — den er *konvensjonell* (flatt topp-til-bunn-skjema, 50-valgs
aktivitetsdropdown, ingen skjulte moduser). Enkel-AO er raskere per registrering
(pill = lagring), men betaler med en liten læringskul (progressiv gating, modus-pill).

**Konklusjon:** ikke bli flatere som feltlogg (det ville gjort oss tregere). Gjør heller
vår egen fart *mer selvforklarende*, og lån kun selektivt fra feltlogg. Stemmestyring
ble vurdert som blindspor så lenge nettleserens talegjenkjenning ikke kjenner fuglenavn
(se `stemmestyring-vurdering.md`).

## Hva som ble gjort

### 1. Selvforklarende gating
- Låst art-felt viser nå **«Velg lokasjon først ↑»** i stedet for «Skriv artsnavn her …»
  (`form-state.js`), og teksten er **fet accent-farge** (`#search:disabled::placeholder`)
  så den skiller seg ut i den dempede seksjonen.
- Modus-pillen (Felt/Etterregistrering) fikk en tydelig **«⇄»** som signaliserer at den
  er en klikkbar bryter.

### 2. «Skjul funn til dato» synlig i lista (lånt fra feltlogg)
- Datamodellen (`hideUntil`) og edit-siden fantes fra før. Nytt: skjulte funn merkes med
  en diskret **`🔒 DD.MM`-badge** ved artsnavnet i lista, så man ser hvilke som holdes
  skjult. Selve settingen skjer fortsatt via ✏️ (edit) — bevisst, for å unngå rot per rad.

### 3. Sikkerhetskopi (backup/gjenoppretting)
- Ny «Sikkerhetskopi»-seksjon i `settings.html`: last ned observasjonene til JSON-fil og
  gjenopprett dem. Trygghet mot datatap (localStorage er eneste lagring). Godtar både
  vårt backup-format og rått `fugleobservasjoner_v1`-payload.

### 4. Rolig artssøk (dropdown uten layout-hopp)
- Trefflista (`#results`) flyter nå oppå innholdet (`position:absolute` i et 0-høyt anker
  `.results-anchor`) i stedet for å dytte alt nedover. Skjermen står stille under søk.

### 5. Bredere observasjonsliste (art – aktivitet på én linje)
- Art og aktivitet slås sammen til én bred primærlinje: **art (fet) – aktivitet (dempet)**.
  De to smale kolonnene (aktivitet + alder/kjønn) er fjernet; alder/kjønn + skjul-badge
  vises på en liten underlinje kun når de er satt.
- Kontrollene (`− N +` og `✏️ 🗑️`) klumper seg mot høyre; tomrommet til høyre er strammet
  inn.

### 6. Festet plass-linje ikke lenger gjennomsiktig
- `.loc-pinned` hadde bare 12 % bakgrunn. I lyst tema er `backdrop-filter` slått av, så
  innholdet bak skinte gjennom. Fikset med ugjennomsiktig lys-blå bakgrunn i lyst tema.

## Tekniske lærdommer (ikke-åpenbare feller)

Disse kostet tid — dokumentert så de ikke gjentas:

1. **Faste kolonneprosenter i tabell er skjøre på tvers av mobilbredder.**
   Antall-knappene er fikserte piksler; en `%`-kolonne som er for smal på en 320px-telefon
   gir horisontal overflow selv om den holder på 393px. Endte med **auto table-layout**:
   `td.obs-cell-primary { width: 100% }` (fyller), `td.obs-cell-count` og `td.action-td`
   `{ width: 1%; white-space: nowrap }` (krymper til innhold). Da wrapper art-linja i
   stedet for å overflowe, uansett skjermbredde. Fjernet `table-layout:fixed` + colgroup.
   E2E-testen `tests/e2e_playwright/tests/mobile-layout.spec.ts` (overflow-vokter på
   iPhone-15 + Samsung S23) fanget dette flere ganger.

2. **CSS `opacity` på en forelder kan ikke overstyres av barn.**
   `.dimmed { opacity: 0.5 }` på ②-seksjonen kapper alt inni til 50 %. Derfor kunne ikke
   den låste placeholderen gjøres «sterk» via opacity — løst med sterk farge/vekt + å
   lette dimmingen til 0.6.

3. **`backdrop-filter: blur()` maskerer gjennomsiktig bakgrunn — men er ofte av i lyst tema.**
   En sticky header med lav bakgrunns-opasitet ser fin ut i mørkt tema (frostet glass),
   men lekker innhold i lyst tema der bluren er av. Gi ugjennomsiktig bakgrunn.

4. **Nettleseren tillater linjebrudd ETTER en tankestrek (–), selv med nbsp etter.**
   «flaggspett – Næringssøkende» brøt som «flaggspett –» / «Næringssøkende» (foreldreløs
   bindestrek) tross nbsp, fordi tankestrek er et eget bruddpunkt. Løsning: bind
   **«– førsteord» i en `white-space: nowrap`-enhet**, mens resten av lange aktiviteter
   fortsatt kan brytes ved ord. Bruk `overflow-wrap` (ikke `word-break: break-word`) på
   primærlinja. Verifisert: ingen overflow selv med svært lang aktivitet.

## Berørte filer

- `public/js/form-state.js` — placeholder-logikk for låst art-felt
- `public/js/observations.js` — obs-liste redesign (primærlinje, auto-layout, dash-enhet, badge)
- `public/js/version.js` — v1.31.0 → v1.32.0
- `public/css/4-components.css` — modus-pill ⇄, skjul-badge, dropdown-overlay
- `public/css/7-page-specific.css` — kolonnebredder (auto-layout), placeholder, dimming, kant-padding, loc-pinned lys tema
- `public/settings.html` — Sikkerhetskopi-seksjon
- `public/index.html` — `.results-anchor`-wrapper
- `public/changelog.html` — v1.32.0-oppføring

## Verifisering

- 137 pytest · 125 vitest · 20/20 relevante mobile-layout E2E (den ene chromium-feilen
  «avrundede firkanter» er pre-eksisterende — antall-knappene er kvadratiske på desktop).
- Iterert med Playwright-skjermbilder på iPhone-bredde og overflow-måling på iPhone-15 +
  Samsung S23.

## Ikke gjort / videre

- Stemmestyring: parkert som idébank (egen branch), se `stemmestyring-vurdering.md`.
- Favoritt/nylige arter: droppet — for stor artsvariasjon til at få chips dekker noe.
- TODO lagt til: **staging-miljø på Pi** (Fly-deploy er for tregt for rask iterasjon),
  se `ENDRINGER_OG_TODO.md`.
