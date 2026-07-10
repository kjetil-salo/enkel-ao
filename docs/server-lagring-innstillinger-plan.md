# Plan: Server-lagring av brukerinnstillinger (multi-enhet)

**Status:** 📋 Planlagt (ikke startet) — neste større feature etter v1.30.0
**Skrevet:** 2026-07-10

## Mål

La en innlogget bruker få innstillingene sine synket på tvers av enheter (mobil i felt + PC hjemme), uten ekstra pålogging utover AO-innloggingen som allerede finnes. localStorage forblir primærlager; server er et synk-/backup-lag. Appen skal fungere 100 % offline som i dag.

## Stabilitet (kritisk krav — appen brukes av mange)

Synk er et **rent additivt lag**. Dagens offline-first-flyt skal være uendret hvis synk feiler, er av, eller brukeren ikke er innlogget.

- **Fail-safe by design:** All synk-kode pakkes i `try/catch`. En feil i synk skal *aldri* boble opp og forstyrre registrering, kartet, eller innstillinger. Feil logges stille (`console.warn`) og svelges.
- **localStorage er alltid sannheten lokalt.** Server er backup/synk. Appen leser aldri innstillinger *direkte* fra server i en kritisk sti — den henter i bakgrunnen og skriver til localStorage, som resten av appen allerede bruker.
- **Ingen blokkering:** Ingen `await` på synk i oppstart/UI-render. Pull skjer i bakgrunnen; når svaret kommer, oppdateres localStorage + re-render. Treg/nede server merkes ikke av brukeren.
- **Kill switch:** Feature-flagg (f.eks. env/`window`-flagg eller server-styrt) som kan skru av all synk uten ny deploy hvis noe oppfører seg galt i prod.
- **Bakoverkompatibelt:** Eksisterende brukere uten server-data får tom første-pull → ingen endring. Ingen breaking migrering av localStorage.
- **Additive endepunkter:** Nye `/api/settings`-ruter rører ikke eksisterende endepunkter. Ingen endring i registrerings-/publiseringsflyt.
- **Staged utrulling:** staging → verifiser på to reelle enheter → Fly først → Pi. Overvåk før full utrulling. Rull tilbake ved tvil (kun nye filer/ruter, lett å reversere).
- **Test non-regresjon:** Eksisterende pytest + Playwright skal være grønne *med synk både på og av*. Egen test på at appen fungerer fullt ut når `/api/settings` returnerer feil/timeout.

## Nøkkelbeslutninger

- **Synk-nøkkel:** AO `userId` (finnes i `localStorage.ao_tokens.userId` etter innlogging, sendes allerede som `X-AO-User-Id`-header).
- **Supabase-tilgang går alltid via server** (`server.py` → `src/`), aldri direkte fra frontend. Service-key blir værende server-side (samme mønster som `supabase_log.py`).
- **Synk-strategi v1:** Hele innstillings-blobben lagres som én JSON per bruker. **Siste-skriver-vinner** på `updated_at`. Feltvis fletting er en senere forbedring.
- **Whitelist, ikke blacklist:** Kun eksplisitt godkjente nøkler synkes. Hemmeligheter og transient state kan aldri lekke ved uhell.
- **Graceful degradering:** Ikke innlogget eller Supabase ikke konfigurert → endepunktene no-op-er (200, tom), appen fungerer uendret.

## Hva synkes (whitelist)

| Nøkkel | Innhold |
|---|---|
| `activityPills_v1` | Aktivitets-pills + forkortelser (`short`) |
| `ao_theme` | Lyst/mørkt tema |
| `showPrivateSitesOnMap` | Vis private lokasjoner på kart |
| `forceOfflineSpecies` | Tving offline artssøk |
| `afterRegistrationMode` | Etterregistreringsmodus |
| `ao_search_radius_v1` | Søkeradius for AO-lokaliteter |
| `medobs_list_v1` | Medobservatører — **kun navnelista**, ikke daglig aktiv-status |

## Hva synkes ALDRI (håndheves i whitelist + test)

- `ao_username`, `ao_password` — hemmeligheter
- `ao_tokens` — sesjonstokens, enhets-spesifikke
- `fugleobservasjoner_v1` — pågående obs-utkast (transient, enhets-lokalt)
- `mapData`, `selectedLocation`, `selectedLocationId`, `locationStatus`, `lastActivity` — transient sesjonsstate
- `activityPillCount` — legacy (migrert)

## Autentisering / integritet (viktig)

`userId` sendt fra klient er ikke i seg selv bevis på eierskap — uten verifikasjon kunne hvem som helst lese/overskrive andres innstillinger (medobservatør-navn er personopplysning). Alternativer:

1. **Verifiser AO-sesjon ved skriving (anbefalt for v1):** Klienten sender allerede `authCookie`/`loginToken`. Server validerer sesjonen mot AO (gjenbruk eksisterende refresh-/sesjonslogikk) og bekrefter at `userId` matcher før skriving. Lesing kan valideres på samme måte. Skriving er sjelden (debounced), så ekstra AO-round-trip er akseptabelt.
2. **Server-utstedt HMAC-token ved innlogging:** Server signerer `userId` ved login; klient sender token ved synk. Ingen AO-round-trip per synk, men mer å bygge/rotere.

→ **Beslutning å ta før Fase 1:** velg (1) eller (2). Default anbefaling: (1) for enkelhet, oppgrader til (2) hvis synk-trafikken øker.

## Datamodell (Supabase)

```sql
create table user_settings (
  user_id    text primary key,
  settings   jsonb       not null,
  updated_at timestamptz not null default now()
);
```

RLS: nekt anon direkte tilgang; all tilgang mediert av server med service-key.

## API-endepunkter (server.py)

- `GET /api/settings` — headers `X-AO-User-Id` (+ sesjonsheaders for verifikasjon) → `{ settings, updated_at }` eller tom/`404`.
- `PUT /api/settings` — body `{ settings, updated_at }` → upsert. Siste-skriver-vinner: server tar imot hvis `updated_at` ≥ lagret, ellers returnerer gjeldende server-versjon (klient kan flette/overskrive).

Følger prosjektets feilhåndterings-etos: eksterne/uventede feil → degradert 200-svar, ikke 500.

## Synk-flyt (frontend)

Ny modul `public/js/settings-sync.js`:
- `collectLocalSettings()` — plukker kun whitelist-nøkler fra localStorage.
- `applySettings(remote)` — skriver whitelist-nøkler tilbake til localStorage + trigger re-render (pills, tema osv.).
- `pushSettings()` — debounced (~1–2 s) `PUT` ved endring.
- `pullSettings()` — `GET` ved app-load/innlogging; hvis server nyere enn lokal → `applySettings`.

Hooks:
- **Ved vellykket AO-innlogging** (`api.js` login-handler): `pullSettings()`.
- **Ved endring i innstillinger** (`settings.html` + setters i `storage.js`): debounced `pushSettings()`.
- **Ved app-load hvis innlogget:** `pullSettings()`.

Konflikt: siste-skriver-vinner på `updated_at`. Lokalt `updated_at` lagres sammen med innstillingene.

## Faseinndeling

- **Fase 0 — Beslutning:** velg auth-modell (1 vs 2).
- **Fase 1 — Backend:** Supabase-tabell, `src/settings_store.py` (get/upsert), `GET`/`PUT /api/settings` i `server.py`, sesjonsverifikasjon. Python-tester: upsert/last, whitelist håndheves, siste-skriver-vinner, graceful degradering uten Supabase.
- **Fase 2 — Frontend:** `settings-sync.js` med whitelist, pull-ved-login, debounced push-ved-endring, `updated_at`-håndtering. Ingen regresjon offline.
- **Fase 3 — UX-polish:** «Sist synket»-indikator i innstillinger, evt. «Synk nå»-knapp, tydelig status når ikke innlogget.
- **Fase 4 — Dokumentasjon + deploy:** oppdater `CLAUDE.md` + `docs/`, deploy staging → verifiser to-enheter → prod (Fly + Pi).

## Risiko / åpne punkter

- **Personvern:** medobservatør-navn er personopplysning → auth-verifikasjon er et krav, ikke valgfritt.
- **Cloudflare-cache (Pi):** nye JS-moduler (`settings-sync.js`) rammes av samme cache-lag som i v1.30.0 — se TODO om cache-flush i `update-ao-pi.sh`. Bør løses før/samtidig.
- **Medobs daglig nullstilling:** synk kun navnelista, behold lokal daglig aktiv-logikk.
- **Migrering:** ingen eksisterende server-data → første pull er tom, første push seeder. Ingen breaking migrering.

## Teststrategi

- Python unit: endepunkter (mock Supabase), whitelist-håndheving (secrets ekskludert), timestamp-konflikt, no-Supabase degradering.
- Playwright (valgfritt): to «enheter» (to storage-kontekster) → endre på A → pull på B viser endring.
