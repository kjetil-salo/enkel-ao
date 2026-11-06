# Rangering i artssøket

Hvordan treffene i artssøket sorteres, og hvorfor. Koden ligger i
`public/js/species-matcher.js` (`compareScoredEntries`), med enhetstester i
`tests/unit/species-matcher.test.js`.

## Problemet: poengsummen vet ikke hvilken fugl du kan se

Søket gir hvert treff en **Match Score** etter hvor godt bokstavene passer:

| Treff | Poeng |
|---|---|
| Eksakt, primærnavn | 1000 |
| Eksakt, alternativt navn | 900 |
| Prefiks, primærnavn | 800 |
| Prefiks, alternativt navn | 600 |
| Ordgrense/delord, primærnavn | 400 |
| Ordgrense/delord, alternativt navn | 200 |
| Latinsk prefiks | 150 |
| Latinsk delstreng | 100 |

Fram til 06.11.2026 lå poengsummen øverst i rangeringen, og sjeldenhet var
bare en tie-breaker ved **helt lik** score. I praksis slo den derfor nesten
aldri inn. Søk på «me» ga:

| Art | Poeng | Funn i Norge |
|---|---|---|
| mestersanger | 800 (prefiks) | 2 |
| mellomspett | 600 (prefiks) | 1 |
| kjøttmeis | 400 (ordgrense) | 646 041 |

En streiffugl med to funn lå øverst, kjøttmeisen på tredjeplass.

Det som gjorde dette vanskelig å få øye på, er at sorteringen virket
utmerket for en hel klasse søk: står søkeordet **først** i navnet, har alle
treffene samme poengsum, og da fikk sjeldenheten bestemme. «grå», «snø» og
«hav» ga alle 800 poeng over hele linja og traff perfekt (gråmåke 595 150,
gråtrost 417 766, grågås 371 211 …). Funksjonen så derfor riktig ut i bruk i
ukevis. Den sviktet bare når søkeordet lå **inne** i navnet.

## Rangeringen i dag

Prinsippet: **har du skrevet artsnavnet ferdig, vinner det alltid. Har du ikke
det, vil du ha den vanligste arten som matcher** — uansett om en sjelden art
tilfeldigvis begynner med de samme bokstavene.

Rekkefølgen i `compareScoredEntries`:

1. **Eksakt treff** (≥ 900 poeng) slår alt annet.
2. Mellom to eksakte treff avgjør poengsummen — primærnavn før alternativt navn.
3. **Gruppe-takson nederst** (se under).
4. Rene arter og underarter før hybrider («… x …»).
5. **Treff i et norsk navn** før treff som bare finnes i det latinske.
6. **Navn som slutter på søkeordet** først — etterleddet er artsgruppa.
7. Sjeldenhetsgruppe: vanlig (≥ 1000 funn) → uvanlig (≥ 100) → sjelden.
8. Innenfor samme gruppe: flest funn først.
9. **Først her** teller poengsummen for ikke-eksakte treff.
10. Hovedart før underart.
11. Alfabetisk på visningsnavnet.

### Hvorfor norske navn før latinske (trinn 5)

Uten dette klatret svarttrost til andreplass på «me», fordi *Turdus **me**rula*
treffer og arten er vanlig. De aller fleste brukerne skriver ikke latinske
navn i det hele tatt. Latinske treff beholdes, men kan ikke gå forbi et norsk.

### Hvorfor etterleddet teller (trinn 6)

Norske fuglenavn er sammensatte, og etterleddet er gruppa: kattugle, blåmeis,
gråmåke, løvsanger. Skriver man «ugle», er det ugler man leter etter — ikke
fuglekonge, selv om bokstavene står der (f-**ugle**-konge) og arten er nær tre
ganger så vanlig som kattugle. Poengmodellen kan ikke skille dem: begge får
400.

Bare **hoveddelen** av navnet teller, altså det som står før et komma. En
underart som heter «rødvingetrost, nominat-rødvingetrost» slutter teknisk på
søket «rødvingetrost» uten at det sier noe om artsgruppe, og ville ellers
klatret forbi søsknene sine helt vilkårlig.

### Hvorfor sjeldenhet er grupper og ikke tallet direkte (trinn 7)

Problemet som skal løses er ikke å rangere etter sjeldenhet — det er å hindre
at en art med ett eneste norsk funn ligger øverst der man lett bommer.
Innenfor en gruppe spiller rekkefølgen liten rolle.

Gruppene gjør dessuten at nasjonale tall holder regionalt. En art som er
hverdagsfugl et sted i Norge har alltid et høyt nasjonalt tall — lappmeis
(2 836), polarsvømmesnipe (3 939) og stellerand (4 085) ligger alle trygt i
«vanlig». Artene under terskelen er sjeldne overalt (snøugle 180, kornspurv
170, dvergterne 184), ikke bare utenfor sin egen landsdel. Hadde vi sortert på
tallet direkte, ville en finnmarking fått lappspurv langt nede bak sørlige
hagefugler.

Tersklene følger et reelt skille i dataene: 292 arter har under 100 funn, 208
har over 10 000, og dalen mellom er tynn.

## Gruppe-takson (familier, ordener og «ub.»)

Den lokale artslista var generert fra Norgeslisten med bare art og underart.
Søk på «måke» ga gråmåke og fiskemåke, men ikke «måkefamilien» og ikke
«ub. grå-/sildemåke». Fikk du ikke artsbestemt fuglen, fantes ikke valget —
selv om AO tillater å rapportere på gruppenivå.

Den som **allerede visste** at gruppene fantes, kom til dem: «måkefam» gir 0
lokale treff, og da spørres AO. Det synken løser er oppdagelsen — står gruppa
nederst i lista den dagen du trenger den, har du lært at den finnes.

132 grupper er hentet inn av `tools/sync_species_groups.py`: 107 «ub.»-takson
og 25 familier/ordener. De ligger i `public/data/norske_arter.json` merket
`erGruppe: true` og `gruppeType: 'ubestemt' | 'familie'`.

### Hala nederst

`searchOfflineSpecies()` i `public/js/species_offline.js` teller artene og
gruppene **hver for seg**: 15 artstreff, så inntil 2 «ub.» og 1 familie.

To grunner til at det ikke er én felles grense:

- En rå `slice(0, 15)` kappet gruppene bort nettopp når lista er lang — og
  lang er den når søket treffer en hel artsgruppe («måke», «ugle»), altså
  akkurat da man kan trenge dem.
- De to gruppetypene dekker hvert sitt behov. «ub. grå-/sildemåke» er for den
  som vet det var en av to arter; «måkefamilien» for den som ikke aner. Uten
  delingen fylte «ub.»-taksonene alle plassene på «måke», og familien falt ut
  — den ene gruppa som treffer når du ikke fikk bestemt fuglen i det hele tatt.

Resultatet for «måke»:

```
gråmåke, fiskemåke, hettemåke … rosenmåke      ← 15 arter
[ubestemt] ub. grå-/sildemåke
[ubestemt] ub. krykkje/dvergmåke
[familie]  måkefamilien
```

### Gruppene har bevisst ikke `antallFunn`

De skal ikke rangeres på hvor vanlige de er — «ub. måke» er ingen fugl man
teller — og et tall ville latt dem konkurrere med artene i trinn 7–8 i stedet
for å ligge nederst. `tests/test_offline_species_data.py` vokter at feltet
mangler.

## Høstingen av gruppene

`tools/sync_species_groups.py`, kjøres ved behov. Tre ting var ikke åpenbare:

**AOs `leaf`-felt duger ikke** til å skille gruppe fra art. Det betyr «har
underliggende takson», så vanlige arter med underarter er merket der også
(«skjære — *Pica pica*» har `leaf: false`), mens enkelte «ub.»-takson har
`leaf: true`. Navnet er den pålitelige kilden: `… familien`, `…fugler`,
`ub. …`.

**AO har ikke et endepunkt som lister gruppene**, bare et søkefelt
(`/Taxon/PickerSearch`) som prefiks-matcher. Søkeordene utledes derfor fra
etterleddene i de norske artsnavnene vi allerede har — familiene heter nettopp
etter dem (måke → måkefamilien).

**Ordgrensen kan finnes uten ordliste.** AO prefiks-matcher, så søkeordet må
være hele etterleddet: «åke» treffer ikke «måkefamilien». Suffikset utvides
derfor så lenge det ikke koster treff — «åke» og «måke» deles av de samme
artene, mens «åmåke» bare deles av to. Der antallet stuper, går ordgrensen.

Rene slektsnavn uten norsk navn («*Mareca*») er bevisst **ute**: de sier
ingenting til en norsk bruker og ville bare fylt opp bunnen av lista.

**AO-etikk:** ett kall per søkeord med ett sekunds pause, typisk ~31 kall for
en full kjøring, og bare når noen kjører verktøyet. Samme mønster som
`tools/sync_species.py` og `tools/import_ao_locations.py`: data som er like
for alle brukere hentes én gang og følger med i docker-imaget, framfor ett
AO-kall per bruker per tastetrykk.

## Hva konkurrentene gjør

Et søk på «måke» mot AOs eget API returnerer **bare to treff**:
`måkefamilien (Laridae)` og `vade-, måke- og alkefugler (Charadriiformes)` —
ingen arter. Grunnen er den rene prefiks-matchingen: «gråmåke» begynner ikke
på «måke». En app som viser AO-responsen rått, gir altså to taksonomiske
kategorier og ingen fugl på et av de mest nærliggende søkene en fuglekikker
gjør. Verdien i vårt artssøk ligger i den lokale lista og rangeringen over,
ikke i selve AO-kallet.

## Kostnad

Artslista vokste fra 307 KB til 345 KB med gruppene. Den precaches av service
workeren, så det er én nedlasting per oppdatering, ikke per søk.
