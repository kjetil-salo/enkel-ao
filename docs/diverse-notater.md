# Diverse notater

Samlested for korte tekniske notater som ikke er store nok til å fortjene et eget dokument,
men som er verdt å ha skriftlig for senere referanse. Nyeste øverst.

## 2026-08-06 — Hvorfor «bare bumpe versjonen» ikke alltid oppdaterer PWA-en

Standard PWA-oppdatering (bumpe `CACHE_NAME` i `sw.js` + `VERSION` i `public/js/version.js`)
skal i teorien holde: spec sier at browseren sammenligner sw.js byte-for-byte og installerer
ny versjon automatisk hvis noe er endret. Vi har likevel sett at det ikke alltid slår gjennom —
se changelog v1.43.1: *«Oppdateringer kom fram for sent... Nå hentes filene ferskt ved hver
utgivelse»*. Grunner:

1. **Browseren sjekker kun ved navigasjon.** En PWA som bare ligger åpen i bakgrunnen
   (typisk mobil-app som ikke lukkes) trigger sjelden en reell «sidelasting» — og da sjekkes
   ikke sw.js på nytt. Ren `skipWaiting()`/`clients.claim()` hjelper ikke hvis sjekken aldri skjer.
2. **CDN-cache i veien for selve oppdagelsen.** Cloudflare setter 4 timers `max-age` på JS.
   For at browseren i det hele tatt skal *se* at sw.js er endret, må forespørselen om sw.js selv
   unngå både HTTP-cache og CDN-edge — derfor cache-buster appen sw.js-URLen med `?v=VERSION`.
   Men da må selve siden (index.html/version.js) i sin tur være fersk nok til å inneholde riktig
   VERSION — ellers spør browseren fortsatt etter gammel sw.js-URL og finner «ingenting nytt».
3. **Ny SW ≠ oppdatert kjørende side.** Selv når ny SW faktisk installeres og tar over, er det
   kun *nye* nettverkskall som går gjennom den. JS som allerede er lastet og kjører i minnet i en
   åpen fane/PWA-vindu blir stående til det skjer en ekte reload.
4. **iOS/Safari er notorisk dårligere** på å sjekke og bytte SW for installerte PWA-er enn
   Chrome/Android.

Konklusjon: ren versjonsbump fungerer stort sett greit for brukere på Android/Chrome som
lukker/åpner appen ofte nok til at browseren rekker å sjekke. Vårt tilfelle har trolig vært en
kombinasjon av CDN-cache-laget og PWA-er som blir stående åpne lenge uten ekte reload.

**Tiltak (v1.43.4):** Lagt til knapp «🔄 Hent nyeste versjon» i innstillinger
(`public/settings.html`) som avregistrerer service worker, tømmer all Cache Storage, og laster
siden på nytt med et cache-bustet URL (`_fresh=<timestamp>`). Dette tvinger fram en reell fersk
henting uansett CDN-cache og uansett hvor lenge appen har stått åpen, uten at brukeren må
lukke/gjenåpne appen manuelt.
