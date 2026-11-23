# AO-prosjekt på funn (v1.65.0)

Et funn kan knyttes til et prosjekt på Artsobservasjoner. Feltet ligger i
«✎ Flere felt» (neste registrering) og i «✎ Rediger observasjon». Funnet bærer
`obs.project = {id, name}`.

## Hvordan AO gjør det

Kartlagt i en innlogget nettleser 23.11.2026. Kun lesing, ingen import eller publisering.

- **Prosjekt settes per import, ikke per rad.** Importskjemaet på `/ImportSighting` har
  ett felt, «Knytt funnene til følgende prosjekt»: `ImportSightingViewModel.ProjectToAdd`
  (ID) og `…ProjectToAdd_Name` (visningsnavn). CSV-formatet har ingen prosjektkolonne.
- **Prosjektsøk:** `GET /SimplePicker/SearchUserProject?search=…&returnformat=html&onlyReportable=false&dontIncludeSubSpecies=true`.
- **Brukerens egne prosjekter:** `GET /SimplePicker/RenderUserProjects?parentId=0&onlyReportable=false&dontIncludeSubSpecies=true`.
- Begge svarer HTML. Hvert treff har `<span class="itemjson">{"name":"…","id":"…"}</span>`.
  `returnformat=json` gir også HTML.
- **Utløpt sesjon gir 200 og tom liste**, ikke en omdirigering. Derfor sjekkes `/Project`
  («Mine prosjekter», 302 til `/LogOn` når man er uinnlogget) når «Mine prosjekt» kommer tomt
  tilbake. Uten den sjekken så en utløpt sesjon ut som «du har ingen prosjekter» (målt lokalt).
- **Prosjektparametere:** `POST /ImportSighting/GetProjectParameters/` med
  `{"projectId":"…"}`. Enkelte prosjekter har egne felt, som importskjemaet tar som ekstra
  CSV-kolonner med parameternavnet som overskrift. Ingen av elleve prosjekter vi sjekket hadde
  noen. **Ikke støttet i v1.** Et prosjekt med parametere får funnet uten parameterverdiene.
- **Hvem som helst kan lage prosjekter** under «Mine prosjekter» (`/Project/Add`). Bare et
  *allment* prosjekt krever administrator. Egne prosjekter kommer under «Mine prosjekt» i
  velgeren og merkes 👤 i appen.

## Sending

`post_with_curl()` (src/ao_import_httpx.py) grupperer funnene med `_grupper_etter_prosjekt()`
og POST-er én `ParseObservations` per prosjekt, med nytt skjema-token for hver. Alle gruppene
havner i gjennomgangskøen FØR det publiseres én gang, som før. Venting på køen er kumulativ:
etter gruppe *n* skal køen inneholde alle funn fra gruppe 1…*n*.

- Uten prosjekt på noen funn: nøyaktig ett kall med tomt `ProjectToAdd`, identisk med før.
- Prosjekt-ID må være et rent tall (`_prosjekt_id()`), ellers ignoreres prosjektet.
- **Feiler gruppe 2 etter at gruppe 1 er importert**, ligger gruppe 1 upublisert i
  gjennomgangskøen, og brukeren får «kunne ikke bekreftes». Det er samme feiltilstand som
  en avbrutt import med én gruppe.

**Prosjekt følger ikke med:**
- AO3-reserven (`/api/ao3-import`)
- manuell kopiering til AOs importside («📋 Kopier & åpne AO-import»), fordi CSV-en
  ikke har noen prosjektkolonne. Prosjektet må da velges på AOs importside.

## Huskes til neste funn

`aoProject_v1` i localStorage (`public/js/project-picker.js`). I motsetning til de andre
«Flere felt»-feltene nullstilles prosjektet **ikke** ved ✓. Et prosjekt endret i
redigeringsvinduet blir også stående for neste funn, men bare hvis feltet faktisk ble endret.
Å lagre et gammelt funn uten å røre prosjektet overstyrer ikke det som gjelder.

Prikken på ⋯-knappen lyser så lenge et prosjekt er husket, og funn med prosjekt får 📁 i lista.
Ellers er det lett å glemme at en hel rekke funn havner i et prosjekt.

## Velgeren

- Fokus i tomt felt viser egne prosjekter. Skriving søker etter 300 ms.
- Å skrive i feltet opphever valget. Fritekst som ikke ble valgt fra lista, blir ikke et
  prosjekt.
- `needsLogin` fra serveren: én ny innlogging med lagret brukernavn og passord
  (`loggInnMedLagretLegitimasjon`), så ett nytt forsøk.
- Ikke-OK svar, f.eks. 503 i offline-modus, gir «Fikk ikke kontakt med AO», ikke
  «ingen prosjekter».

## Verifisert mot AO (23.11.2026, `kjetil-test`)

Ett funn ble sendt til gjennomgangskøen, aldri publisert:

1. Testprosjektet «Enkel-AO test» (ID 4045) og den private testlokaliteten
   «Enkel-AO testpunkt (slettes)» (ID 3654379) ble opprettet på testkontoen. Begge er
   beholdt til senere tester.
2. CSV-raden ble laget med appens egen `observations_to_csv()`. Den gikk inn via AOs
   importskjema med `ProjectToAdd=4045`, de samme feltene `_post_parse_observations()` sender.
3. Detaljvisningen av raden på «Kontrollér og publisér» viste **Prosjekt: Enkel-AO test**.
   Køtabellen (`BindReviewSightingsGrid`) har ikke noe prosjektfelt. Prosjektet synes bare
   i den utvidede detaljvisningen.
4. Raden ble fjernet fra køen («Fjern» + AOs egen ja/nei-dialog). Køen gikk 0 → 1 → 0.

Ikke testet ende-til-ende: hele `post_with_curl()` med flere prosjektgrupper, siden den
publiserer. Grupperingen og at det publiseres én gang er dekket av `tests/test_ao_prosjekt.py`.
