# i18n-arkitektur: analyse (13.11.2026)

Bakgrunn: PR #9 («feat: add Nynorsk language support») og PR #10 («Fix/nynorsk
meldinger») fra Espen (aifiks) legger til nynorsk i hele appen. Dette
dokumentet vurderer om vi skal ta inn et i18n-bibliotek eller bygge en egen,
enkel løsning — med mål om at et tredje språk (engelsk) skal være en liten,
trygg endring senere, ikke en ny runde med samme type diff.

**Konklusjon: egen, liten i18n-modul. Ikke bibliotek.** Se begrunnelse under.

## Hva PR #9/#10 faktisk gjør

Mønsteret er gjennomgående en boolsk sjekk + ternary, spredt i ~15 JS-filer:

```js
const nn = typeof window.__isNynorsk === 'function' ? window.__isNynorsk() : false;
tekst = nn ? 'Ingen lagt til enno' : 'Ingen satt ennå';
```

Konkrete problemer, ikke bare stilvalg:

1. **`isNynorsk()`/`window.__isNynorsk()` er redefinert flere ganger** med
   litt forskjellig fallback-logikk i forskjellige filer (observations.js,
   export-operations.js, coobserver-picker.js m.fl.) — ingen single source of
   truth for «hvilket språk er aktivt».
2. **Boolsk modell.** Språket er `true`/`false` (nynorsk eller ikke), ikke en
   kode. Hver av titalls `nn ? A : B` må bli en 3-5 veis switch den dagen
   engelsk (eller samisk, osv.) kommer — samme store, risikable diff en gang
   til, for hvert nytt språk.
3. **`data-bokmalLabel`/`data-bokmal` på `<option>`-elementer.** Når
   `<select>`-tekst oversettes, må AO-eksporten fortsatt ha den kanoniske
   bokmål-verdien. PR-en løser det ved å lese den OVERSATTE teksten ut av DOM-en
   og slå den opp mot en data-attributt for å finne tilbake til bokmål. Det er
   et symptom-fiks — riktig løsning er at `value` ALLTID er den kanoniske
   nøkkelen, uavhengig av hva som vises.
4. **Ingen oppdagelse av manglende oversettelse.** Mangler en nøkkel for
   nynorsk, er fallback stille `false` → bokmål-gren. Virker i dag, men gir
   ingen varsling når streng #200 legges til uten nynorsk-tekst.
5. **En limt inn spesifikasjonsfil er committet**:
   `public/assets/aistudio/Paste_November_12__2026_-_7_17PM_f0392b2d` (919
   linjer) er et rått utkast/prompt ("Format: Konkret tekst som skal endrast ;
   nynorsk tekst"), ikke en fil appen bruker. Bør fjernes uavhengig av
   arkitekturvalg.
6. **Testene mocker implementasjonsdetaljen** (`window.__isNynorsk = () =>
   true`) i stedet for et stabilt API — testene må skrives om uansett hvilken
   vei vi velger videre.

## Krav løsningen må dekke

- Appen er **bygg-løs**: ren `<script type="module">`, ingen bundler for
  frontend (kun test-tooling i devDependencies). En løsning må virke uten
  byggsteg.
- **Service worker precacher eksplisitt** (`STATIC_ASSETS` i `sw.js`) og
  versjonerer hver modul med `?v=` (se CLAUDE.md "Versjonering"). Nye filer må
  inn i denne lista som alt annet — ingenting nytt å lære der.
- Appens tekstvolum er moderat (titalls–lavt hundretalls strenger), ingen
  pluralisering, ingen RTL, ingen locale-avhengig tall/dato-formatering utover
  det som allerede finnes.
- Kanonisk AO-verdi (art, aktivitet, lokalitet) må ALDRI avledes fra
  visningstekst — kun fra et stabilt `value`/ID-felt. Dette gjelder uavhengig
  av språkløsning, men en god i18n-arkitektur gjør feilen umulig i stedet for
  å reparere den etterpå (punkt 3 over).
- Må være utvidbar til engelsk (og i prinsippet flere språk) uten å røre
  eksisterende kode per streng.

## Alternativ A: bibliotek (i18next / FormatJS / Fluent / Polyglot.js …)

**Fordeler:** ICU-meldingsformat, pluralisering, interpolasjon,
lazy-loading av språkpakker, verktøy for oversettere, godt utprøvd.

**Ulemper i denne appen spesifikt:**

- Ekstra payload (i18next kjerne er typisk 15–20 KB min+gzip) for
  funksjonalitet appen ikke trenger (namespaces, backend-plugins,
  pluralregler) — norsk bokmål/nynorsk henter ingen nytte av bibliotekets
  locale-database.
- Et CDN-/npm-bibliotek må likevel precaches og versjoneres manuelt i
  `STATIC_ASSETS` akkurat som en egenskrevet fil — ingen besparelse i
  vedlikehold der, bare en ekstern avhengighet lagt til et prosjekt som
  bevisst er rammeverksfritt (jf. CLAUDE.md "vanilla HTML/CSS/JS").
- Løser ikke punkt 3 (kanonisk verdi) automatisk — det er et app-spesifikt
  mønsterproblem uavhengig av i18n-lag.

## Alternativ B: egen, liten i18n-modul (anbefalt)

Konsistent med eksisterende konvensjoner (ES6-moduler, localStorage-nøkler,
`?v=`-cache-busting, `docs/`-beslutningsdokumenter).

1. **Språkdata som ES-moduler**, ikke JSON (unngår en ekstra fetch, passer
   bygg-løs-stilen): `public/js/i18n/nb.js`, `public/js/i18n/nn.js`, senere
   `en.js`. Hver eksporterer et flatt `{ 'nøkkel': 'streng' }`-objekt. Bokmål
   er master og fallback.
2. **`public/js/i18n.js`**:
   - `setLanguage(code)` / `getLanguage()` — erstatter `isNynorsk()` og
     `window.__isNynorsk()` fullstendig. Lagres under samme type nøkkel PR #9
     allerede innførte, bakoverkompatibel med dagens `nynorsk_artsnavn_v1`.
   - `t(key, vars?)` — slår opp i aktivt språks dict, faller tilbake til `nb`
     ved manglende nøkkel OG logger en advarsel (synlig i dev/test, ikke en
     stille `false`-gren som i dag).
   - Enkel `{navn}`-interpolasjon via `String.replace` — ingen
     ICU/pluralisering, fordi appen ikke trenger det (YAGNI).
3. **Statisk HTML-tekst**: `data-i18n="nøkkel"` på elementet, satt av en
   `anvendOversettelser(root)` kjørt ved sideinnlasting og ved språkbytte —
   samme mønster som `tilpassHeader()` i `header-plass.js` (synkron første
   kjøring, så reaktiv ved endring).
4. **Dynamisk JS-tekst**: `t('toast.slettet', { art })` direkte i koden i
   stedet for `nn ? A : B`.
5. **Kanonisk verdi vs. visningstekst løses strukturelt**: `<option value="…">`
   holder alltid den kanoniske AO-nøkkelen; kun `textContent` settes via
   `t()`. `data-bokmalLabel`-hacket i PR #10 blir overflødig — man leser aldri
   oversatt tekst for å utlede en kanonisk verdi.
6. **Testbarhet**: `setLanguage('nn')` i stedet for å sette
   `window.__isNynorsk` — ett sted å style i tester.
7. **SW/versjonering**: `i18n/*.js`-filene legges i `STATIC_ASSETS` og får
   `?v=` nøyaktig som alle andre moduler — ingen ny mekanisme.
8. **Engelsk senere**: legg til `en.js` + ett valg i settings-dropdownen.
   Ingen eksisterende kallsted røres, fordi ingenting lenger er en boolean.

## Migreringsplan hvis vi går videre

PR #9/#10 bør **ikke merges som de står** — ikke fordi nynorsk-arbeidet i seg
selv er feil, men fordi mønsteret må byttes ut før et tredje språk kommer, og
det er billigere å bytte ut nå (få strenger) enn etter enda en PR-runde.

1. Hent ut alle nb/nn-strengpar fra PR-diffen (de ligger klare både i
   `Paste_November_12…`-fila og i selve ternary-grenene) → fyll `nb.js`/`nn.js`.
2. Fjern `window.__isNynorsk`, alle lokale `erNynorsk()`-redefinisjoner og
   `data-bokmalLabel` fra koden.
3. Bytt hver `nn ? A : B` med `t('nøkkel')`; bytt hver `data-bokmalLabel`-
   tilgang med vanlig `value`-lesing.
4. Fjern den limte AI Studio-fila fra repoet.
5. Kjør full testsuite (pytest + vitest + Playwright). Testene som i dag
   setter `window.__isNynorsk` må skrives om til `setLanguage()`.
6. Oppdater `STATIC_ASSETS` i `sw.js` og versjoner alle berørte moduler, jf.
   CLAUDE.md "Versjonering".

Estimat: samme størrelsesorden diff som PR #10 selv (dvs. ikke en liten jobb),
men gjort ÉN gang nå i stedet for på nytt for hvert fremtidige språk.
