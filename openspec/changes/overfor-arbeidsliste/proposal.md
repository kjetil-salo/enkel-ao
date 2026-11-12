# Overfør arbeidslista mellom enheter

Opprettet 2026-11-11. Status er planlagt og klar for gjennomgang.
Prioritet er øverst i TODO, punkt 42.

## Why

En observatør kommer hjem med observasjoner på mobilen og vil kontrollere og
rette lista på Mac før publisering. Arbeidslista ligger i dag i nettleserens
localStorage, og AO-innlogging gir ingen tilgang til den fra en annen enhet.

## What Changes

- I ⋯-menyen får brukeren handlingen «Fortsett på en annen enhet».
- Innlogget bruker kan lagre hele arbeidslista som en privat serverkopi.
  Handlingen viser når kopien er bekreftet lagret.
- På Mac finner samme bruker «Hent liste fra en annen enhet». Her vises siste
  lagrede kopi med tidspunkt, observasjonsperiode, steder og antall.
- Forhåndsvisningen lar brukeren kontrollere lista. «Hent inn i Lista di» åpner
  den i den vanlige redigeringsflyten. Første versjon krever tom lokal liste
  ved innhenting. Serverkopien kan forhåndsvises også på en enhet med en lokal
  liste, og brukeren får veiledning om «Sikkerhetskopi» i Innstillinger.
- Observasjoner, bilder, koordinater, private felt, besøk og sendemarkeringer
  følger med. Innlogging på mottakeren skjer med mottakerens egen sesjon.
- Lagre tidspunkt og enhetsnavn, eksempelvis «Mobil». Brukeren velger aktivt
  å oppdatere serverkopien etter nye endringer. Kildeenheten beholder lista.
- Foreslå én aktiv kopi per konto med sju dagers levetid og eksplisitt sletting.
- Som trinn 2 foreslås overføring uten innlogging med en tidsbegrenset
  engangskode. Kontrakten for denne utvidelsen beskrives i designet.

### Produkteiervurdering

Anbefalingen er BYGG. Dette løser et konkret hinder mellom feltregistrering og
AO-publisering. Brukerverdien er høy. Kostnaden vurderes som middels, med størst
risiko i kontotilknytning og bevaring av arbeidslista ved nettverks- og lagringsfeil.

Manuell overføring gir en enkel første leveranse. Automatisk bakgrunnslagring
krever også valg om parallelle endringer, sletting og nettbruk. Den vurderes
etter erfaring med første leveranse. Dagens «Sikkerhetskopi» i Innstillinger
kan allerede flytte lista som JSON-fil, med manuell filflytting og gjenoppretting.

## Capabilities

### New Capabilities

- `arbeidsliste-overforing` dekker privat lagring, forhåndsvisning, trygg
  innhenting og sletting av en arbeidsliste mellom enheter.

### Modified Capabilities

Ingen eksisterende OpenSpec-spesifikasjoner er registrert i piloten.

## Impact

Berører `server.py`, ny SQLite-modul og lokal sesjonshåndtering i `src/`,
`public/index.html`, `public/js/main.js`, `public/js/storage.js`,
`public/js/api.js`, innloggings-/utloggingspunktene i `public/settings.html`
og `public/ao-direct.html`, øvrige lokale skrivere og en ny frontend-modul
for overføring.
`public/sw.js` får eventuelle nye statiske ressurser. Publisering gjenbruker
`public/js/export-operations.js` med kontosjekk for innhentede lister.

Lagring foreslås i eksisterende `DB_PATH` på vedvarende volum. Løsningen bruker
Python-standardbiblioteket og dagens frontend. Kontoen bindes til en
serververifisert identitet ved vellykket AO-innlogging. Kontoidentiteten må
verifiseres før implementering, fordi AO `userId` varierer mellom innlogginger.

Dette starter OpenSpec-piloten beskrevet i TODO punkt 32. Eksisterende
arkitekturdokumentasjon finnes i `CLAUDE.md` og `docs/`. Planens beslutninger
må avklares før implementering. Oppgavelista viser gjenstående arbeid.
