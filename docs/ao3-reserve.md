# AO3 som reserve ved avbrutt sending

Når AO2 svarer 502, 503 eller 504 under innlogging eller i ett av oppslagene før
første importkall, tilbyr Enkel-AO å fortsette via AO3. Har brukeren lagret e-post
som AO-brukernavn, viser appen et varsel med **Publiser via AO3**. Etter
bekreftelse sender appen direkte med den samme innloggingen. Appen
verifiserer arten og lokalitets-ID-en i utkastene, publiserer bare ID-ene fra den
aktuelle sendingen og kontrollerer kvitteringen for alle funnene.
Appen tilbyr også direkte AO3-publisering når AO2-innloggingen blir avvist og
AO3 godkjenner den samme e-posten og passordet.

Under **Innstillinger → AO-innlogging** prøver **Logg inn** først AO2.
Hvis AO2-innloggingen feiler, prøver appen AO3 med den lagrede e-postadressen.
Siden viser da **Innlogging bekreftet via AO3** hvis AO3 godkjenner innloggingen.
Kartet og lokalitetssøket bruker også AO3 som reserve for egne private
lokaliteter når AO2-innlogging eller oppslag feiler. Appen leser alle sidene
med lokaliteter fra den innloggede AO3-kontoen. Resultatet mellomlagres for
denne kontoen i nettleseren.

Ved direkte AO3-publisering settes den innloggede AO-brukeren som observatør
i tillegg til rapportør. Appen kontrollerer at observatøren står i utkastet
før den publiserer.

Ved aliasinnlogging viser appen **Gå til AO-innlogging**, der brukeren kan bytte
til e-postadressen på samme konto og prøve å publisere igjen.

Ved innhentet arbeidsliste, bilder eller felter som krever manuell kontroll,
viser appen **Kopier og åpne AO3**. Knappen kopierer de valgte observasjonene
i formatet for AO3s fuglemal og åpner importen.

1. Velg **Kopier og åpne AO3** for å åpne [AO3-importen](https://mobil.artsobservasjoner.no/contribute/import).
2. Logg inn med e-postadressen til den samme Artsobservasjoner-kontoen. AO2
   tillater brukeralias ved innlogging. AO3 krever e-postadresse.
3. Lim inn funnene og velg **Importer**. Velg kommune under importinnstillingene
   hvis flere lokaliteter har samme navn.
4. Sjekk art, lokalitet og medobservatører under **Mine upubliserte funn** før du
   publiserer hos AO3. Legg eventuelt til bilder og markeringer for interessante
   funn der.

Kopiering beholder arbeidslista i Enkel-AO. Sjekk både publiserte og upubliserte
funn hos Artsobservasjoner før du sender de samme observasjonene på nytt.

## Feil etter at innsending har startet

En 503 etter importkallet kan bety at AO2 mottok hele eller deler av lista.
Enkel-AO beholder derfor lista og ber brukeren kontrollere AO før et nytt forsøk.
Appen lagrer at sendingen er uavklart før nettverkskallet, slik at kontrollspørsmålet
også vises etter omlasting. Publisering av hele AO2-køen krever at appen har
bekreftet at hele den innsendte lista ligger der.

Serverloggen viser driftsfeil før AO2-import, direkte sending via AO3 og kopiering
med prefikset `[AO3-RESERVE]`. Kopiering regnes ikke som publisering i statistikken.

## Kontroller utført

- Byparken i Bergen har lokalitets-ID `349566` både i Enkel-AOs lokalitetstabell
  og i AO3s lokalitetssøk. AO2 svarte 502 ved direkte kontroll.
- AO3s Excel-import fant flere steder kalt Byparken og avviste en tall-ID i
  navnefeltet. Med Bergen kommune valgt havnet én kjøttmeis på riktig sted i
  testkontoens upubliserte kø. Testutkastet ble slettet, og køen ble kontrollert.
- Direkte AO3-innlogging, lagring med takson-ID `4372` og lokalitets-ID `349566`,
  og sletting av det upubliserte testutkastet er verifisert med testkontoen.
- Automatiske tester dekker byttet til AO3, publisering av verifiserte ID-er,
  feil under opprettelse, manglende publiseringskvittering og omlasting under
  innsending. Publisering er testet mot mock. Livekontrollen brukte upubliserte
  testutkast.
