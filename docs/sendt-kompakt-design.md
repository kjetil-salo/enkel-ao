# Kompakt visning av tidligere sendte funn

Godkjent retning 2026-11-18: behold dato → sted, la steder foldes inn og ut,
og erstatt separate funnkort med kompakte rader i en felles flate per sted.

- Datoen er synlig og klebrig. Nyeste sted er åpent ved første lasting.
- Stedsoverskriften viser antall funn, funn uten bilde og eventuelle AO-merknader.
- «Vis alle» og «Skjul alle» gjelder stedene i den viste lista. Åpne/lukkede
  steder huskes under oppdatering, filtrering og språkbytte på siden.
- Artsnavn, antall og rolle beholdes. Tid, aktivitet og eventuell rapportør står
  på en dempet linje under. Bildeknapp er direkte tilgjengelig for funn uten bilde.
- En meny med «Flere handlinger» samler AO-lenke, redigering for egne funn,
  flere bilder og «Fjern meg som observatør» for funn der rollen er medobservatør.
- Fjerning krever bekreftelse med art, sted og dato. Knappen deaktiveres under
  sending. Backend må verifisere rolle fra AO, kun fjerne gjeldende bruker og
  kontrollere resultatet. Ved feil eller usikkert resultat beholdes raden.
- AO sin mekanisme er en toggle: ingen automatisk gjentakelse av mutasjonen.
  Tester bruker bare mockede svar og endrer aldri ekte AO-funn.
- Lokale kvitteringer er sammenfoldet nederst og viser antall i overskriften.
- Alle trykkflater er minst 44 px, med fungerende tastatur og smal mobilvisning.

Alternativet med mindre padding alene reduserer ikke gjentatte knapper og gir
fortsatt en lang liste. Flere nivåer av trær gir unødvendige klikk på mobil.
Native `details`/`summary` gir folding og tastaturstøtte uten nytt bibliotek.

Verifisering: backend-mocker for rettigheter, feil og bekreftelse; Playwright
med mockede API-svar for folding, filter, bilde/endre-meny, fjerning og mobilbredde;
eksisterende pytest og Vitest.

## Handlinger per funn og sted

Godkjent utvidelse 2026-11-18:

- Blyant og `AO ↗` vises direkte på funnraden, med tilgjengelige navn og 44 px
  trykkflater. Flere bilder, avmelding og sletting ligger i funnets meny.
- Stedet har en separat handlingsknapp ved siden av foldingen. Den åpner en
  modal for dato + steds-ID; knappen er ikke en del av `summary`.
- Modalens utvalg fryses ved åpning og omfatter alle innlastede funn i denne
  gruppen, også dem bildefilteret skjuler. Antall egne, med-funn og eventuelle
  ukjente roller vises. Ved avkortet AO-liste står det at bare innlastede funn
  er med. Dette er ikke sletting eller redigering av selve AO-lokaliteten.
- Aktivitet og tidsrom endres bare på egne funn. Tid gjelder samme dato,
  begge klokkeslett kreves og slutt kan ikke være før start.
- «Fjern meg» gjelder bare positivt bekreftede medobservatørroller. Sletting
  gjelder egne funn og krever separat bekreftelse med dato, sted og antall.
- Operasjoner sendes sekvensielt, ett funn av gangen. Ingen automatisk retry.
  Progresjon og resultat per funn vises; stopp ved feil, uavklart resultat eller
  avvik i AOs bekreftelse. Resultat kan være delvis, aldri presentert som atomisk.
- Vellykkede slettinger/avmeldinger filtreres også fra senere, eldre hentesvar.
  Bekreftede redigeringer oppdaterer lokal cache. Modalen kan ikke lukkes eller
  startes på nytt mens en operasjon pågår. Fokus returneres ved lukking.
- Ekte AO-funn endres aldri av automatiserte tester. Sletting og tidsfelt
  baseres på verifisert AO-markup og testes med mocker.

## Medobservatører direkte i handlingsvinduet

Godkjent 2026-11-18: Velg én liste med medobservatører som skal erstatte dagens
medobservatører på alle egne funn i sted/dato-gruppen. Gjenbruk eksisterende
velger med lagrede personer og AO-søk. Bare entydige AO-aliaser sendes til backend.
Fritekst uten verifiserbart alias avvises; personer med samme navn må ikke blandes.

- Brukeren bekrefter antall funn, sted/dato og den konkrete listen før sending.
  Tom liste krever uttrykkelig bekreftelse på at medobservatørene fjernes.
- Innlogget hovedobservatør beholdes. Funn rapportert av andre endres ikke.
- Backend validerer aliaser, løser bruker-ID-er og kontrollerer kjent skjemastruktur
  før endring, uten å stole på klientens bruker-ID eller rolle.
- Andre funnfelt bevares, og komplett observatørsett bekreftes fra AO etter lagring.
- Ingen ekte funn åpnes for redigering eller lagres under kartlegging/testing.
  Den nødvendige feltstrukturen skal verifiseres mot AOs skjema/JavaScript.

## Status

Utrullet i v1.60.28 (18.11.2026) til staging og produksjon. «Utfør»-knappen for
medobs-massehandlingen var opprinnelig bare deaktivert mens AO-bekreftelsen lastet
— den er nå SKJULT til bekreftelsen er klar (`hidden`, ikke bare `disabled`),
slik at ingen kan trykke gjennom en masseendring som aldri ble kontrollert.
