# Stemmestyring - vurdering av prototypebranch

Dato: 2026-07-03  
Branch: `codex/stemmestyring`

## Konklusjon

Ikke merge branchen slik den står. La den leve som idebank, men hent inn ideene selektivt senere.

Hovedideen er fortsatt interessant: styrt taleinput kan være nyttig i felt når brukeren har lokalitet klar og vil registrere art, antall og aktivitet raskt. Prototypen viser en fornuftig retning ved å bruke en styrt flyt i stedet for fri diktat.

Samtidig er treffsikkerheten og UI-plasseringen ikke god nok for produksjon. På liten skjerm konkurrerer panelet med kjerneflyten, og artsmatchingen er for villig til å gjette.

## Viktigste funn

### 1. Branchen inneholder urelaterte regresjoner

Branchen endrer også AO-auth, dokumentasjon, Fly-konfigurasjon og migreringsbanner. Det er ikke del av stemmestyringsfunksjonen.

Spesielt problematisk: endringene i `server.py` og `src/api_handlers.py` går tilbake mot en eldre AO-refresh-strategi. Dette kolliderer med `main` sin ferske fiks for å gjenopprette AO-sesjon via `logintoken` mot forsiden `/`.

Før ideer fra branchen hentes inn, må taleendringene skilles fra auth/deploy/docs-endringer.

### 2. Artsmatching er for optimistisk

`voice-helpers.js` velger beste art ved lav nok fuzzy-score uten å kreve tydelig margin til nest beste kandidat.

Risiko:

- Feil art kan velges automatisk.
- Norske fuglenavn er ofte korte eller like.
- Talegjenkjenning på mobil påvirkes av vind, dialekt, bakgrunnslyd og artsnavn som ikke finnes i vanlig språkmodell.

Neste versjon bør være konservativ:

- Auto-velg bare ved eksakt eller svært trygg match.
- Ved usikkerhet: vis 2-3 forslag som brukeren kan trykke på.
- Krev god margin mellom beste og nest beste kandidat.
- Registrer aldri automatisk uten tydelig bekreftelse.

### 3. Panelet tar for mye plass

Prototypen legger et permanent `voice-panel` rett i observasjonsseksjonen. På mobil blir dette dyrt i vertikal plass, særlig fordi taleinput er en nisjefunksjon og ikke alltid ønsket.

Tale bør være valgfritt:

- Default: skjult.
- Aktiveres via innstilling eller mikrofonknapp.
- Når aktiv: kompakt panel, ekspanderbar seksjon eller bottom sheet.
- Ikke legg store status-/oppsummeringsblokker fast inn i hovedflyten.

### 4. Bra ideer å ta med videre

- Styrt sekvens: art -> antall -> aktivitet.
- Støtte for hele fraser, f.eks. "kråke to overflygende".
- Gjenbruk av eksisterende `fetchResults()` og `chooseItem()`.
- Flere talealternativer fra nettleseren (`maxAlternatives`) brukes i matchingen.
- Tydelig bekreftelse før registrering.
- Mulighet for å legge antall til eksisterende observasjon når art/lokalitet/aktivitet matcher entydig.

## Anbefalt neste forsøk

Lag en ny, smal branch fra oppdatert `main`.

Scope:

1. Ingen auth-, deploy- eller dokumentasjonsendringer utenom relevant taledokumentasjon.
2. Legg tale bak en innstilling, f.eks. `voiceInputEnabled`.
3. Vis bare en liten mikrofonknapp i hovedflyten når funksjonen er aktivert.
4. Bruk konservativ matching med usikkerhetsvalg.
5. Legg til unit-tester for tvetydige artsnavn, ikke bare glade stier.
6. Legg til mobil layout-test som verifiserer at talekontroller ikke skyver kjerneflyten for langt ned.

## Produktvurdering

Taleinput bør behandles som en eksperimentell hjelpefunksjon, ikke som en ny primærflyt.

Kjerneflyten i Enkel-AO er allerede rask og plassfølsom. En talefunksjon er bare verdt det hvis den gir netto mindre friksjon for en liten gruppe brukere uten å forstyrre alle andre.

Foreløpig anbefaling:

- Ikke synlig som standard.
- Ikke auto-registrer basert på usikker tale.
- Ikke la taleinput styre layouten på små skjermer.
- Bruk prototypen som inspirasjon, men bygg neste versjon rent og smalt.
