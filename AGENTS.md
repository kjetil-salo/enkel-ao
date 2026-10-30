# Instruksjoner for AI-agenter

Denne fila er inngangen for AI-kodeverktøy som leser `AGENTS.md` fra rota —
Codex, Cursor, Gemini CLI, Jules, Copilot-agenter, Aider og andre.
Claude Code leser `CLAUDE.md` direkte.

## Les disse to først

1. **`CLAUDE.md`** — autoritativ beskrivelse av arkitekturen: ruting i
   `server.py`, hver backend-modul i `src/`, hver frontend-modul i
   `public/js/`, miljøvariabler og versjoneringsrutinen. Den er detaljert med
   vilje, og mye av den er kjøpt dyrt gjennom feil i produksjon. Les den før
   du endrer kode, uansett hvor liten endringen ser ut.
2. **`CONTRIBUTING.md`** — lokalt oppsett, de tre testsuitene, konvensjoner og
   arbeidsflyt for pull requests.

Det som står der, gjelder også for deg. Denne fila gjentar bare det som
erfaringsmessig går galt når en agent jobber i repoet.

I tillegg ligger det ferdige arbeidsbeskrivelser i `.agents/skills/` —
produkteiervurdering, arkitektur, utvikling, teststrategi og
feature-livssyklus. Leser verktøyet ditt skills derfra, bruker det dem
automatisk. Gjør det ikke det, er de verdt å lese som ren dokumentasjon av
hvordan arbeidet er ment å gå.

**Denne fila skal ikke bli nok en kopi av `CLAUDE.md`.** Både `AGENTS.md` og
`.github/copilot-instructions.md` var tidligere fulle duplikater av den, og
begge rakk å bli år utdaterte — de beskrev endepunkter og en frontend som
ikke lenger fantes. Skal noe arkitekturstoff endres, endres det i `CLAUDE.md`,
og her står bare en peker.

## Harde regler

- **Norsk bokmål** i kode-kommentarer, commit-meldinger, dokumentasjon og all
  UI-tekst. Aldri nynorsk i koden — appen *viser* nynorske artsnavn som en
  funksjon, men er selv skrevet på bokmål.
- **Ingen `Co-Authored-By`** i commit-meldinger.
- **Hold diffen så liten som oppgaven tillater.** Én PR løser én ting. Rør
  ikke filer oppgaven ikke handler om.
- **Ikke kjør deploy-skriptene** (`update-ao-pi.sh`, `deploy-staging-pi.sh`,
  `update-app.sh`). Utrulling gjøres av eieren.
- **Ikke bump versjonsnummer i en PR.** Versjonen ligger på fire steder og
  kolliderer i parallelle PR-er. Eieren bumper ved release — nevn bare i
  PR-beskrivelsen at du har endret frontend.

## Dette skal aldri følge med i en commit

Verktøyet ditt lager arbeidsfiler. De hører hjemme hos deg, ikke i appen:

- `.pytest_cache/`, `__pycache__/`, `.coverage`, `node_modules/`
- `.aistudio/`, `.cursor/`, `.gemini/`, `.codex/` — planer, mellomnotater og
  «brain»-artefakter fra et AI-verktøy
- `tests/e2e_playwright/test-results/`, `playwright-report/`

Alt dette står i `.gitignore`. Bruker du `git add -A`, får du likevel med deg
ting som allerede er sporet, eller som en global gitignore skjuler for deg —
**se gjennom `git status` og `git diff --cached` før du commiter.**

## Ikke rør disse

- **`.claude/`** — de tre sporede filene (`agents/test.md`,
  `skills/agent-software-developer/`, `skills/agent-solution-architect/`)
  er en delt del av repoet og beskriver appens egne konvensjoner. Resten av
  `.claude/` er lokal og ignorert. Har ditt verktøy ryddet bort de sporede
  filene lokalt, skal den slettingen **ikke** commites. Fikk du dem likevel
  med:

  ```bash
  git checkout main -- .claude/          # hent dem tilbake i en PR
  git update-index --skip-worktree .claude/agents/test.md \
      .claude/skills/agent-software-developer/SKILL.md \
      .claude/skills/agent-solution-architect/SKILL.md
  ```

  Den siste kommandoen gjør at git slutter å se lokale endringer i filene, så
  de ikke sniker seg inn i en senere commit. (`.gitignore` hjelper ikke her —
  den gjelder bare filer som ikke allerede er sporet.)

- **Filrettigheter på skript.** `*.sh` i rota skal være kjørbare (`100755`).
  Noen verktøy og filoverføringer nullstiller dette til `100644`, og da feiler
  `./update-ao-pi.sh` med «permission denied» hos eieren. Sjekk med
  `git diff --summary` at det ikke står `mode change` i diffen din.

## Eksterne API-er — vær forsiktig

Appen snakker med Artsobservasjoner.no, Artsdatabanken og OpenStreetMap
Nominatim. Dette er gratis tjenester vi er gjester hos.

- **Aldri lastetesting** mot de ekte tjenestene. Bruk `docker-compose`-mocken.
- **Ikke legg inn kall som skalerer med antall brukere.** Et kall per
  brukerøkt mot et eksternt API er ikke en liten detalj — det er trafikken
  vår ganget med brukermassen. Data som er like for alle brukere skal hentes
  én gang av en cron-jobb eller et verktøy i `tools/`, ikke av hver klient.
  `tools/import_ao_locations.py` er mønsteret.
- **Eksterne feil skal gi degradert svar** — status 200 med tom liste, aldri
  en 500. AO og Nominatim feiler jevnlig, og appen skal overleve det.
- **Ikke skriv til filer i `public/data/` under kjøring.** De er en del av
  docker-imaget og forsvinner ved neste rebuild.

## Før du åpner PR

```bash
python3 -m pytest --maxfail=3   # backend
npm test                        # vitest — MÅ kjøres fra repo-roten
```

`npm test` betyr vitest fra rota og Playwright inne i
`tests/e2e_playwright/`. Playwright-suiten har kjente, pre-eksisterende feil
og ingen «alt grønt»-tilstand — kjør den før endringen din også, og
sammenlign, ellers jakter du på feil du ikke har innført.

Beskriv i PR-en: **hva** er endret, **hvorfor**, og **hvordan er det testet.**
