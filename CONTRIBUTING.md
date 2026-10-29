# Bidrag til Fugleobservasjoner

Takk for at du vurderer å bidra til dette prosjektet!

## Om prosjektet

Dette er et **personlig prosjekt** utviklet primært for egen bruk og delt for transparens. Prosjektet er åpen kildekode under MIT-lisens, men det er viktig å ha realistiske forventninger.

## Hvordan bidra

### 🐛 Rapporter bugs
- Åpne en GitHub Issue med beskrivelse av problemet
- Inkluder gjerne:
  - Hvilken nettleser du bruker
  - Hva du forventet skulle skje
  - Hva som faktisk skjedde
  - Skjermbilder hvis relevant

### 💡 Foreslå funksjoner
- Åpne en GitHub Issue med "Feature Request" i tittelen
- Beskriv hva du ønsker og hvorfor det ville være nyttig
- Vær gjerne detaljert!

### 🔧 Pull Requests
- Pull requests mottas gjerne, men uten garanti for når de blir gjennomgått
- Før du investerer mye tid i en stor endring, åpne gjerne en issue først for å diskutere
- Sørg for at koden din:
  - Følger eksisterende kodestil
  - Fungerer på mobil (mobile-first design)
  - Ikke bryter eksisterende funksjonalitet

## Forventninger

⚠️ **Viktig å vite:**
- Dette er et hobbyprosjekt jeg vedlikeholder i min fritid
- Det er **ingen garanti** for svar på issues eller review av PRs
- Jeg kan velge å ikke implementere foreslåtte funksjoner
- Prosjektet utvikles først og fremst etter mine egne behov

Men jeg setter pris på all tilbakemelding! Selv om jeg ikke alltid rekker å svare eller implementere alt, leser jeg det som kommer inn.

## Teknisk

- **Backend:** Python 3.12, `http.server.ThreadingHTTPServer` — ingen web-rammeverk.
  Noen få eksterne pakker (`httpx`, `supabase`, `python-dotenv`, `user-agents`),
  se `requirements.txt`
- **Frontend:** Vanilla JavaScript (ES6-moduler), HTML, CSS — ingen rammeverk,
  ingen byggesteg
- **Design:** Mobile-first — appen brukes på telefon ute i felt
- **API:** Proxyer Artsobservasjoner.no og OpenStreetMap Nominatim
- **Drift:** Docker på en Raspberry Pi

---

# For deg som skal bidra med kode

Denne delen er for deg som er invitert inn, eller som vil jobbe mer enn en
enkelt liten PR.

## Bruker du Claude Code? Start her

Dette er den raskeste veien inn, og du trenger ikke kjenne kodebasen fra før.

Repoet er satt opp for det: `CLAUDE.md` i rota beskriver hele arkitekturen,
og tre skills i `.claude/` dekker konvensjoner, arkitekturvurderinger og
teststrategi. Alt dette leses automatisk når du starter Claude Code i
prosjektmappa — du trenger ikke gjøre noe for å aktivere det.

```bash
npm install -g @anthropic-ai/claude-code   # eller se claude.com/claude-code
cd enkel-ao
claude
```

Et fornuftig første oppdrag er bokstavelig talt å be om hjelp til å få appen
til å kjøre: *«Få denne appen til å kjøre lokalt og si fra når den svarer.»*
Den kan også ta git-biten for deg — branch, commit og pull request — hvis det
er den delen som er fremmed.

To ting er verdt å si eksplisitt til den:

- **Den skal ikke deploye.** Skillsene sier det, men si det gjerne selv også
- **Be om små, avgrensede endringer.** Store omskrivinger i `observations.js`,
  `server.py` eller AO-importen er risikable selv for den som kjenner koden

Du er fortsatt ansvarlig for det du sender inn: les gjennom endringen, og kjør
testene før du åpner PR. Begge ting står beskrevet under.

## Oppsett

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
npm install                 # kun testverktøy (vitest, Playwright)

# DB_PATH bør settes lokalt — se under
DB_PATH=./stats.db python3 server.py     # http://localhost:3000
```

**Sett `DB_PATH`.** Standardverdien er `/data/stats.db`, som er et
docker-volum i drift og ikke finnes på en vanlig Mac eller Linux-maskin.
Uten den starter serveren helt fint og kjerneflyten virker, men alt som
lagrer serverside er dødt: **fellestur, deling av funn, tilbakemeldings-
skjemaet og statistikk**. Du ser det som `[WARNING] ... Read-only file
system: '/data'` i oppstartsloggen. `stats.db` er allerede i `.gitignore`.

**Appen kjører fint uten noe som helst oppsett utover dette.** Disse er alle
valgfrie, og mangler de, degraderer appen pent i stedet for å feile:

| Mangler | Konsekvens lokalt |
|---|---|
| `DB_PATH` | Se over — bør settes. Uten den virker ikke fellestur, deling, tilbakemelding eller statistikk |
| `LOCATION_DB_PATH` | Stedssøk uten AO-innlogging gir ingen treff. DB-en er ~78 MB og ligger ikke i repoet |
| `SUPABASE_URL` / `_KEY` | Ingen analytics-logging. Alt annet virker |
| AO-innlogging | Artssøk og kart virker; direktesending til AO gjør ikke |
| SMTP-variabler | Tilbakemeldingsskjemaet lagrer, men varsler ingen |

Ser noe tomt ut lokalt, er det altså oftest dette — ikke en bug du har innført.

## Tester

Tre suiter. Kjør de to første før hver PR:

```bash
python3 -m pytest --maxfail=3        # backend
npm test                            # vitest — MÅ kjøres fra repo-roten
cd tests/e2e_playwright && npm test  # E2E, krever server på :3000
```

⚠️ `npm test` betyr **vitest** fra repo-roten og **Playwright** inne i
`tests/e2e_playwright/`. Lett å blande.

⚠️ Playwright-suiten har en god del kjente, pre-eksisterende feil og ingen
«alt grønt»-tilstand. Kjør den før endringen din også, og sammenlign — ellers
jakter du på feil du ikke har innført.

## Konvensjoner

- **Norsk bokmål** i kode-kommentarer, commit-meldinger, dokumentasjon og all
  UI-tekst. Dette er en norsk app for norske fuglekikkere
- **Ingen `Co-Authored-By`** i commit-meldinger
- Hold diffen så liten som oppgaven tillater
- Eksterne API-feil skal gi **degradert svar** (status 200, tom liste) — aldri
  en 500. AO og Nominatim feiler jevnlig, og appen skal overleve det
- SQL alltid parameterisert (`?`) — aldri f-strings
- Input `font-size` minimum 16px, ellers zoomer iOS inn ved fokus
- Farger fra `public/css/1-tokens.css` — aldri hardkodet hex
- Touch-targets minst 44px

## Arbeidsflyt

1. Jobb på en egen branch — ikke commit direkte på `main`
2. Kjør pytest + vitest
3. Åpne PR med kort beskrivelse: hva er endret, og hvordan er det testet
4. **Ikke bump versjonsnummer i PR-en.** Versjon ligger på fire steder
   (`version.js`, tre inline-konstanter i `index.html`, `CACHE_NAME` i `sw.js`,
   `changelog.html`), og parallelle PR-er ville kollidert i alle. Eieren bumper
   ved release — nevn det bare i PR-en hvis du har endret frontend, så det ikke
   glemmes
5. **Ikke kjør deploy-skriptene** (`update-ao-pi.sh`, `deploy-staging-pi.sh`,
   `update-app.sh`). Utrulling krever tilgang til infrastruktur som ikke ligger
   i repoet, og gjøres av eieren. Trenger endringen verifisering i et ekte
   miljø, si det i PR-en

## Et par feller som har bitt før

- **Service Worker-cache:** frontend-endringer når ikke installerte PWA-er før
  `CACHE_NAME` i `public/sw.js` bumpes. Nye JS-filer og bilder må i tillegg
  legges i `STATIC_ASSETS`
- **Cloudflare cacher JS i fire timer:** legger du til en ny navngitt eksport i
  en modul andre importerer, kan brukere få en gammel kopi og en `SyntaxError`
  som dreper hele siden. Importen må da versjoneres med `?v=`. Dette har brutt
  staging mer enn én gang
- **AO-direkteimporten er skjør** — den snakker med et skjema vi ikke eier.
  Endringer der er høy risiko; spør før du går inn i den


## Spørsmål?

Send en e-post til [k@vikebo.com](mailto:k@vikebo.com)

Takk! 🐦
