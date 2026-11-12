# Overføring av arbeidsliste

## Purpose

La en observatør ta med hele arbeidslista fra felt til en annen enhet,
kontrollere den og fortsette redigeringen før publisering til Artsobservasjoner.

## ADDED Requirements

### Requirement: K1 Eksplisitt lagring av privat serverkopi

Appen SHALL la en innlogget bruker lagre en kopi av hele den private
arbeidslista. Bekreftelsen SHALL inneholde serverens lagringstidspunkt og
antall observasjoner. Kildelista SHALL være tilgjengelig lokalt etter lagring.

#### Scenario: Observatøren kommer hjem

- **WHEN** brukeren velger «Fortsett på en annen enhet» og serveren bekrefter lagringen
- **THEN** appen viser «Lagret for henting på en annen enhet» med tidspunkt og antall
- **AND** kildelista kan fortsatt åpnes og redigeres lokalt

#### Scenario: Lista endres under opplasting

- **WHEN** brukeren endrer lista mens serveren lagrer den påbegynte kopien
- **THEN** bekreftelsen gjelder den overførte versjonen
- **AND** appen viser at nyere lokale endringer venter på ny lagring

#### Scenario: Tidligere lokal lagring feilet

- **WHEN** appen ser synlige observasjoner som mangler i den lokalt lagrede lista
- **THEN** den forklarer avviket og lar brukeren sikre arbeidet før overføring
- **AND** den gir ingen kvittering for en ufullstendig kopi

### Requirement: K2 Kontobundet tilgang

Serveren MUST binde kopien til en identitet verifisert ved innlogging.
Lesing, skriving og sletting MUST kreve gyldig tilgang til denne kontoen.
Kontobytte og utlogging MUST fjerne den tidligere kontoens overføringstilgang
fra klienten og lukke eventuell forhåndsvisning. En innhentet liste MUST
beholde eiertilknytning ved redigering og omlasting.

#### Scenario: Samme konto på to enheter

- **WHEN** to enheter logger inn på samme AO-konto med samme verifiserte kontonøkkel
- **THEN** begge kan finne kontoens sist lagrede arbeidsliste
- **AND** ulike AO-loginToken og userId påvirker ikke tilgangen til kopien

#### Scenario: En annen bruker forsøker tilgang

- **WHEN** en bruker sender et annet brukernavn, userId eller en fremmed kopi-ID
- **THEN** serveren avviser tilgang uten å eksponere kopiens innhold eller metadata

#### Scenario: Gammelt svar kommer etter kontobytte

- **WHEN** en forespørsel fra konto A fullføres etter bytte til konto B
- **THEN** klienten forkaster svaret
- **AND** konto Bs skjerm og arbeidsliste bevares

#### Scenario: Kontobytte etter innhenting

- **WHEN** konto A har hentet inn lista og konto B prøver å sende den etter omlasting
- **THEN** appen ber brukeren bytte tilbake til eierkontoen før den starter AO-import
- **AND** den lokale lista bevares

### Requirement: K3 Finn og forhåndsvis siste lagrede kopi

Appen SHALL vise kontoens aktive serverkopi med lagringstidspunkt,
enhetsnavn, antall og observasjonsperiode. Brukeren SHALL kunne forhåndsvise
alle observasjonene med steder, tider og bilder før innhenting.

#### Scenario: Mac-en har allerede observasjoner

- **WHEN** brukeren åpner serverkopien på en enhet med en eksisterende lokal liste
- **THEN** appen viser serverkopien i en separat forhåndsvisning
- **AND** viser veiledning om å ta vare på den lokale lista før innhenting

#### Scenario: Kopi mangler eller er utløpt

- **WHEN** kontoen har ingen gyldig serverkopi
- **THEN** appen viser en forståelig tomtilstand med veiledning om lagring fra kildeenheten

### Requirement: K4 Innhenting bevarer eksisterende arbeid

Appen MUST verifisere at den private arbeidslista er tom og lesbar før
innhenting. Innhenting MUST bekreftes etter vellykket lokal lagring. En
foreldet lokal skrive- eller tømmeoperasjon MUST bevare den nye lista og
eventuelle usikrede endringer. Gjentatt klikk MUST gi samme liste én gang.
En aktiv fellestur MUST vise veien til den etablerte flyten for privat liste.

#### Scenario: Vellykket innhenting

- **WHEN** brukeren henter en kopi inn i en tom privat arbeidsliste
- **THEN** appen bekrefter innhentingen etter at lista er lagret lokalt
- **AND** brukeren kan rette observasjonene i «Lista di»

#### Scenario: Lokal liste fylles mens forhåndsvisningen er åpen

- **WHEN** en lokal observasjon registreres før innhentingen gjennomføres
- **THEN** appen ber brukeren ta vare på den eksisterende lista
- **AND** begge listene er tilgjengelige gjennom lokal liste og forhåndsvisning

#### Scenario: Full lagringsplass

- **WHEN** mottakerens lokale lagring avviser kopien
- **THEN** appen viser at innhentingen feilet og beholder forhåndsvisningen
- **AND** serverkopien og mottakerens tidligere tilstand bevares

#### Scenario: Uleselig lokal liste eller observasjoner som bare ligger i minnet

- **WHEN** lagringen er uleselig eller den åpne lista har usikrede endringer
- **THEN** innhenting avbrytes med forklaring
- **AND** appen bevarer de lokale dataene

#### Scenario: Eldre fane skriver etter vellykket innhenting

- **WHEN** en eldre fane prøver å lagre et nytt funn eller kjører en utsatt tømming fra en AO-sending
- **THEN** appen oppdager at operasjonen gjelder en foreldet liste
- **AND** innhentet liste og eventuelle usikrede nye funn bevares

### Requirement: K5 Hele observasjonsinnholdet følger med

Overføringen SHALL bevare alle støttede observasjonsfelt, rekkefølge,
artsinformasjon, koordinater, bilder, private kommentarer, skjuling, besøk,
medobservatører og sendemarkeringer. Validerings- og størrelsesfeil MUST
avvise hele lagringen med forståelig feilmelding.

#### Scenario: Observasjon med alle utfylte felt

- **WHEN** en liste med bilder, private felt, besøk og sendemarkeringer overføres
- **THEN** verdiene er bevart når lista åpnes på mottakeren
- **AND** et bilde kan redigeres og observasjonens vanlige AO-data kan eksporteres

#### Scenario: For stor eller inkompatibel kopi

- **WHEN** innholdet overskrider en grense eller bruker en nyere ukjent skjemaversjon
- **THEN** appen viser årsaken til avvisningen
- **AND** den forrige gyldige serverkopien bevares

#### Scenario: Eldre lokal liste

- **WHEN** lista mangler valgfrie felt og har to identiske observasjonsrader
- **THEN** begge radene og deres rekkefølge bevares ved overføring

### Requirement: K6 Kontroll før publisering

Overføringshandlingene SHALL bruke appens private lager. AO-publisering
SHALL kreve brukerens egen handling i den vanlige publiseringsflyten.
Appen MUST vise at kilden har sin egen kopi og at innholdet kan være endret
der etter lagring. Eksisterende sendemarkeringer SHALL vises i gjennomgangen.
Ved AO-sending fra en innhentet liste MUST appen be om bekreftelse med
kopitidspunkt og oppfordring til å kontrollere tidligere sendinger.

#### Scenario: Gjennomgang hjemme

- **WHEN** brukeren lagrer, forhåndsviser eller henter inn en kopi
- **THEN** AO har mottatt null import- og publiseringskall fra disse handlingene
- **AND** brukeren ser tidspunktet for kopien og beskjed om å publisere fra én enhet

#### Scenario: Lista inneholder allerede sendte funn

- **WHEN** en kopi inneholder observasjoner med sendemarkering
- **THEN** markeringen er synlig og følger med til vanlig publiseringsflyt

#### Scenario: Tidligere AO-sending fremgår ikke av kopien

- **WHEN** kilden har sendt etter at kopien ble lagret, eller en tidligere sending mangler full kvittering
- **THEN** mottakeren får fortsatt bekreftelsen om kopitidspunkt og tidligere sendinger før AO-import

### Requirement: K7 Nettverksfeil og gjentakelse håndteres trygt

Appen SHALL bevare lokalt arbeid ved nettverksfeil, manglende serverlager og
utløpt sesjon. Gjentakelse av samme lagringsforsøk SHALL gi én logisk
serverkopi. Konkurrerende oppdatering eller sletting MUST oppdages og
presenteres for brukeren før en nyere serverkopi kan erstattes eller slettes.

#### Scenario: Serveren lagrer, men svaret blir borte

- **WHEN** klienten prøver samme lagringsforsøk på nytt
- **THEN** serveren gjenkjenner forsøket og returnerer den opprinnelige kvitteringen
- **AND** en eventuell nyere kopi bevares

#### Scenario: To enheter oppdaterer samme kopi

- **WHEN** begge skriver med utgangspunkt i samme bekreftede serverversjon
- **THEN** én oppdatering lykkes og den andre får en forståelig konfliktmelding
- **AND** brukeren kan forhåndsvise gjeldende kopi før et nytt valg

#### Scenario: Streng offline-modus

- **WHEN** brukeren forsøker overføring i streng offline-modus
- **THEN** appen forklarer at handlingen krever nett og lar brukeren velge nettverksmodus
- **AND** overføringsforsøket bevarer lokal registrering og lagring

### Requirement: K8 Privat lagring med utløp

Serverkopien SHALL utløpe sju døgn etter siste bekreftede lagring og kunne
slettes av eieren. Utløpt innhold MUST være utilgjengelig ved lesing.
Innhenting MUST sjekke at den viste kopien fortsatt er aktiv. Overføringen
MUST bare inneholde godkjente observasjonsdata og kopimetadata. Private
API-svar MUST ha cachevern, og logger MUST utelate innhold og tilgangsbevis.

#### Scenario: Gjeninnhenting og sletting

- **WHEN** eieren sletter en kopi med gjeldende versjon
- **THEN** kopien blir utilgjengelig på begge enheter
- **AND** allerede lagrede lokale lister bevares

#### Scenario: Forhåndsvisning av en slettet eller erstattet kopi er fortsatt åpen

- **WHEN** brukeren velger innhenting etter at den viste kopien er slettet, utløpt eller erstattet
- **THEN** appen avslutter den utdaterte forhåndsvisningen og viser gjeldende status
- **AND** den lokale lista bevares

#### Scenario: Hemmeligheter på kildeenheten

- **WHEN** kildeenheten har lagrede AO-passord, sesjonstokens og kartdata
- **THEN** serverkopien inneholder bare observasjonsdata og kopimetadata
- **AND** mottakerens egen innlogging brukes for senere AO-sending

#### Scenario: Serveren har vært inaktiv etter utløp

- **WHEN** en klient ber om en utløpt kopi før neste opprydding
- **THEN** serveren svarer med tomtilstanden for manglende kopi

### Requirement: K9 Avgrenset ressursbruk

Serveren MUST håndheve grenser for oppføringsantall, tekst, bilder,
samlet request-størrelse og forespørselsfrekvens før kostbar behandling.
Appen SHALL opplyse om overskredet grense. Autoriserte lokale
overføringsoperasjoner SHALL gjennomføres med lokal kontoverifikasjon.

#### Scenario: Stor eller hyppig opplasting

- **WHEN** en forespørsel overskrider en dokumentert ressursgrense
- **THEN** serveren avviser forespørselen med en forståelig årsak
- **AND** forrige serverkopi og kildeenhetens observasjoner bevares

#### Scenario: Gyldig lokal sesjon

- **WHEN** brukeren lagrer eller henter med en gyldig lokal overføringssesjon
- **THEN** operasjonen bruker serverens lokale tilgangskontroll og lager
- **AND** antall AO-kall for operasjonen er null
