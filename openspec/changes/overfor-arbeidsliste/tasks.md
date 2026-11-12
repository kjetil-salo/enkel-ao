# Oppgaver for første leveranse

## 1. Avklar kontonøkkel og datakontrakt

- [x] 1.1 Bekreft eiernøkkel med lesing av kontoinformasjon fra to uavhengige innlogginger for samme AO-testkonto uten tidligere funn. Verifiser isolasjon mot en annen konto i AO-mocken. Dokumenter hvordan alias og kontonavn håndteres (K2).
- [x] 1.2 Kartlegg observasjonsfeltene fra registrering, redigering, fellestur-til-privat og eksport. Lag representative testlister for nyere og eldre data og mål hvilke grenser som rommer en realistisk arbeidsliste med bilder (K5, K9).

## 2. Bygg lokalt lager og privat API

- [x] 2.1 Utsted en lokal sesjon fra vellykket AO-innlogging med utløp og revokering. Test at klientstyrt identitet, en annen konto, manglende og utløpt sesjon avvises, og tell AO-kall på de lokale rutene (K2, K9).
- [x] 2.2 Bygg SQLite-lager med én aktiv kopi per konto, transaksjoner, vilkårsbasert oppdatering/sletting, forsøkskvitteringer og utløpsrydding. Test gjenforsøk etter tapt kvittering, to samtidige skrivere, sletting og omstart (K1, K7, K8).
- [x] 2.3 Koble rutene for metadata, innhold, lagring og sletting til skjema- og ressursvalidering. Test gyldige testlister, ugyldig skjema, størrelsesgrense, kvoter, CORS, cachevern og at logger utelater private data (K5, K8, K9).
- [x] 2.4 Koble til periodisk utløpsrydding og dokumenter rutene, avhengigheten til `DB_PATH` og hvordan tilgangen kan slås av i `CLAUDE.md`. Bekreft opprydding uten trafikk og forventede svar når lageret er frakoblet (K7, K8).

## 3. Bygg flyten på mobil og Mac

- [x] 3.1 Legg overføringshandlingene i ⋯-menyen på mobil og Mac. Bruk AO-innlogging og håndter kontobytte, utlogging, tomtilstand og offline-modus. Test forsinket svar og kontobytte i en annen fane (K2, K3, K7).
- [x] 3.2 Vis mottakerkonto, lagringskvittering, tidligere kopi og konfliktbeskjed. Test at lista som ble sendt beholdes som øyeblikksbilde når kildeenheten redigerer videre (K1, K7).
- [x] 3.3 Lag forhåndsvisning, innhenting i verifisert tom privat liste og sletting av serverkopi. Test full lagring, aktiv fellestur og at en slettet, utløpt eller erstattet kopi avvises ved innhenting (K3, K4, K8).
- [x] 3.4 Koordiner privat innhenting med relevante lokale skrivere og utsatt tømming. Test direkte skriving til ordinær nøkkel fra en eldre fane og utsatt tømming etter at lagret liste er endret (K4).
- [x] 3.5 Bevar kopitid og eier ved redigering og omlasting. Test at vanlig redigering bevarer observasjonsfeltene, at feil konto sperres før AO-import og at sending bekreftes også uten `sentTs` (K2, K5, K6).
- [x] 3.6 Oppdater hjelpetekst og registrer nye frontend-ressurser i service worker. Verifiser at overføringshandlingene lastes offline fra lokal service worker (K1, K3, K7).

## 4. Verifiser hele forløpet

- [x] 4.1 Kjør Playwright-forløp med separat mobil- og Mac-kontekst, samme konto og en annen konto. Kontroller innhold og kilde, og verifiser null AO-import/publiseringskall før eksplisitt publisering mot mock (K1–K8).
- [x] 4.2 Kjør pytest og vitest fra rota. Sammenlign registrering, dublettvern og lagringskvote i Playwright mot baseline. Test offline-registrering med ekte service worker og lokal mock (K7).
- [ ] 4.3 Verifiser flyten med fysisk mobil/PWA og Mac inkludert oppgradering fra eldre PWA, bilder, nettbrudd og omstart. Denne oppfølgingen står åpen ved produksjonsutrulling av v1.60.15.

Lokalt besto 603 Python-tester og 499 Vitest-tester. Chromium besto de 17
eksisterende testene i baseline, seks nye overføringstester og tre offline-
tester med lokal service worker. WebKit besto de seks nye overføringstestene.
To ekte AO-innlogginger med testkontoen fant samme kopi i en midlertidig lokal
database. AO-import og publisering ble testet mot mock.

Staging på Pi ble oppdatert 2026-11-11 med `v1.60.14-staging-d88cbdf684`.
Helsesjekk, tilgangskontroll og overføring med bilde og privat kommentar
bestod med to ekte AO-innlogginger. Den midlertidige serverkopien ble slettet.

Staging ble oppdatert 2026-11-12 med overføringshandlingene i ⋯-menyen på
mobil og Mac (`v1.60.14-staging-d00763c36c`).

## Oppfølging av OpenSpec-piloten

- Arkiver endringen når første leveranse er ferdig. Kontroller at arkivet viser
  hva som ble implementert og verifisert. Vurder nytteverdien av piloten i TODO 32.
- Vurder trinn 2 med engangskode ut fra erfaring med første leveranse. Ved
  prioritering får den en egen endring med krav til tilgang og engangsinnløsning.
