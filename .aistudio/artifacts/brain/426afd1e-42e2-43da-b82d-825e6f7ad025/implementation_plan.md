# Søk, relasjonskobling og nynorskvisning for underartar

Denne planen løyser feila der underartar forsvinn ved søk på nynorske artsnamn (t.d. `raudvengtrast`) når «Vis underarter» er aktivert, og der underartar vert viste på bokmål i staden for nynorsk når appen står på nynorsk.

## User Review & Critical Decisions

> [!IMPORTANT]
> Vala under er oppdaterte etter tilbakemeldinga di:

- **Bekrefta val 1 – Relasjonskobling via ID (`parentId` / `taxonId`)**: Underartar knyttast eksplisitt til hovudarten sin `taxonId` via feltet `parentId`. Når ein hovudart får treff i søket (enten på nynorsk, bokmål eller vitskapleg namn), vert alle tilhøyrande underartar henta ut via `parentId === hovudart.id`, utan å vere avhengige av tekstmatch i underarten sitt namn.
- **Bekrefta val 2 – Nynorsk-fallback for underartsnamn (`[artsnamn på nynorsk], underarten [underartsnamn]`)**: Når ein underart manglar dedikert nynorsknamn (inkludert når kjelda har `nan`, `ssp.`, `nominat-...` eller bokmålsform), skal det nynorske visningsnamnet **alltid** formaterast som `[artsnamn på nynorsk], underarten [underartsnamn]` (t.d. `raudvengtrast, underarten iliacus` og `raudvengtrast, underarten coburni` — **aldri** `nominat-raudvengtrast`).
- **Bekrefta val 3 – Gruppert plassering i resultatlista**: Når ein hovudart får treff og «Vis underarter» er på, vert underartane grupperte direkte under sin tilhøyrande hovudart (sortert internt etter `antallFunn` og alfabetisk). Dersom berre underarten sjølv treff søkeordet, visast underarten som eige treff.
- **Bevaring av AO-innsending (`taxonName`)**: Visningskomponenten viser alltid `nameNno` / `nynorsk` når nynorsk er valt, medan det underliggjande `taxonName`-feltet held på bokmålsverdien som Artsobservasjonar krev ved eksport/innsending.

---

## 1. Overview & Core Concept

- **Kva løysinga gjer**: Sikrar at søk med «Vis underarter» fungerer identisk uansett om brukaren søkjer på nynorsk (`raudvengtrast`), bokmål (`rødvingetrost`) eller latin (`Turdus iliacus`), og at alle underartar alltid visast på språket brukaren har valt i appen (`userLanguage`).
- **Kvifor feilen oppstod**:
  1. **Problem 1 (Ingen underartar ved nynorsksøk)**: Etter at hovudart og underartar vart henta, filtrerte `searchSpecies(query, ...)` kvar kandidat individuelt mot søketermen. Sidan underartane mangla nynorsknamn (`nynorsk: null`) og ikkje var kobla via `parentId` i `searchSpecies()`, fekk underartane `0 poeng` på søketermen `raudvengtrast` og vart filtrerte bort.
  2. **Problem 2 (Bokmålsvisning av underartar på nynorsk)**: Ved søk på `rødvingetrost` fekk underartane treff på bokmålsstrengen (`200 poeng`), men fordi `nameNno` / `nynorsk` var `null` på underartane i både offline-data og berika AO-data, falt `speciesDisplayName()` tilbake på bokmålsnamnet.

---

## 2. User Experience & Visual Design

- **Søkeoppleving med «Vis underarter» aktivert**:
  1. Brukaren har nynorsk aktivert og «Vis underarter» hukka av.
  2. Brukaren skriv `raudvengtrast` (eller `rødvingetrost`).
  3. Øvst i resultatlista visast hovudarten **raudvengtrast** (*Turdus iliacus*).
  4. Direkte under hovudarten visast dei tilhøyrande underartane på nynorsk med formatet `[artsnamn på nynorsk], underarten [underartsnamn]`, t.d.:
     - **raudvengtrast, underarten iliacus** (*Turdus iliacus iliacus*)
     - **raudvengtrast, underarten coburni** (*Turdus iliacus coburni*)
  5. Når brukaren vel ein underart, visast det nynorske namnet i søkefeltet, i observasjonslista (③) og i registreringstoasten, medan `taxonName` i bakgrunnen bevarer bokmålsnamnet for AO-import.

---

## 3. Key Product Decisions & Trade-Offs

- **Beslutning 1: Relasjonskobling via `parentId` i både datamodell og søkemotor**
  - *Valt tilnærming*: Kvar underart får `parentId` sett til hovudarten sin `taxonId` (t.d. `4555` for `Turdus iliacus`). `searchSpecies()` sjekkar først kva hovudartar som får `score > 0`, og inkluderer og grupperer deretter alle underartar i `speciesList` som har `parentId` lik ein matchende hovudart-ID.
  - *Kvifor*: Eliminerer avhengigheit av at underarten sitt tekstnamn må innehalde søkeordet, og fungerer likt for både nynorsk-, bokmål- og latinsøk.
- **Beslutning 2: Konsekvent nynorsk-fallback (`[artsnamn på nynorsk], underarten [underartsnamn]`)**
  - *Valt tilnærming*: Vi oppdaterer alle underartar i `norske_arter.json` (og synkroniseringstenesta) med `parentId`, `nameNob` og `nameNno`, og legg i tillegg inn ein ren JS-hjelpefunksjon `deriveSubspeciesNynorskName()` som genererer `[artsnamn på nynorsk], underarten [underartsnamn]` (henta frå siste ledd i det vitskaplege namnet, t.d. `iliacus`) når eit dedikert nynorsk underartsnamn manglar eller kjelda har bokmåls-/nominat-form.
  - *Kvifor*: Gir eit reint, eintydig og konsekvent nynorsk visningsnamn i både offline- og online-søk utan konstruksjonar som `nominat-...`.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Arkitektur og dataflyt

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     Søk med «Vis underarter» aktivert                      │
│               (t.d. query = "raudvengtrast" / "rødvingetrost")             │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                   ┌──────────────────┴──────────────────┐
                   ▼                                     ▼
┌─────────────────────────────────────┐ ┌────────────────────────────────────┐
│     Offline-søk (norske_arter)      │ │     Online AO-søk + Beriking       │
│  - Hovudart har id / taxonId        │ │  - Hentar hovudart + underartar    │
│  - Underartar har parentId = art.id │ │  - Koblar underart til hovudart-ID │
│  - Har nameNno + nameNob            │ │    via taksonomi / lokal indeks    │
└──────────────────┬──────────────────┘ └────────────────┬───────────────────┘
                   │                                     │
                   └──────────────────┬──────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│            searchSpecies(query, speciesList, userLanguage)                 │
│  1. Poengsetter hovudartar (1000 / 900 / 800 / 600 / 400 / 200 / 150)      │
│  2. Samlar ID-ar (taxonId) for alle hovudartar med score > 0               │
│  3. Hentar alle underartar med parentId === matchende hovudart-ID          │
│  4. Sorterer hovudartar (Score -> antallFunn -> alfabetisk) og grupperer   │
│     tilhøyrande underartar direkte under kvar sin hovudart                 │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│               Visning i UI (speciesDisplayName & renderResults)            │
│  - userLanguage === 'nn' -> viser item.nameNno || item.nynorsk             │
│  - userLanguage === 'nb' -> viser item.nameNob || item.taxonName           │
│  - Ved registrering/eksport til AO -> bruker alltid item.taxonName         │
└────────────────────────────────────────────────────────────────────────────┘
```

### Datamodell for underartar (`Subspecies` / `Species`)
Kvar underart får følgjande struktur:
- `id` / `taxonId`: Unik takson-ID for underarten (der kjent frå AO)
- `parentId`: Hovudarten sin `id` / `taxonId` (t.d. `4555` for `Turdus iliacus`)
- `isSub`: `true`
- `nameNob`: Bokmålsnamn for visning (t.d. `rødvingetrost, underarten iliacus` eller eksisterande bokmålsnamn)
- `nameNno` (`nynorsk`): Nynorsknamn for visning (t.d. `raudvengtrast, underarten iliacus`)
- `taxonName`: Bokmålsnamnet som sendast til AO ved eksport/innsending
- `latinName` (`scientificName` / `latin`): Vitskapleg namn (t.d. `Turdus iliacus iliacus` / `T. i. iliacus`)
- `antallFunn`: Antall rapporterte funn (heiltal $\ge 0$)

### Reglar for automatisk nynorsk-fallback (`deriveSubspeciesNynorskName`)
Når ein underart ikkje har eit dedikert nynorsk underartsnamn frå før:
1. Hent hovudarten sitt nynorsknamn (`parentNameNno`, t.d. `raudvengtrast`) og underartsepitetet frå det vitskaplege namnet (siste ord i `latinName`, t.d. `iliacus` frå `Turdus iliacus iliacus` eller `T. i. iliacus`).
2. Generer visningsnamnet som:
   `[artsnamn på nynorsk], underarten [underartsnamn]`
   (t.d. `raudvengtrast, underarten iliacus`).
3. Bruk aldri konstruksjonen `nominat-[artsnamn]`.

### Verifisering og testar
1. **Enhetstestar i Vitest (`tests/unit/species-matcher.test.js` og `tests/unit/species_offline.test.js`)**:
   - Verifiser at søk på `raudvengtrast` med `includeSubtaxa = true` returnerer hovudarten `raudvengtrast` etterfølgt av underartane via `parentId`, med nynorske visningsnamn på formatet `raudvengtrast, underarten iliacus` / `raudvengtrast, underarten coburni`.
   - Verifiser at søk på `rødvingetrost` når `userLanguage = 'nn'` og `includeSubtaxa = true` returnerer underartane og at visningsnamnet (`speciesDisplayName` / `nameNno`) er på nynorsk (`raudvengtrast, underarten ...`).
   - Verifiser at både online-beriking (frå AO sitt svarformat) og offline-søk koblar underartar via `parentId` og utleier nynorsk underartsnamn.
2. **Python-testar (`tests/test_offline_species_data.py`)**:
   - Verifiser at alle underartar i `norske_arter.json` har `parentId` som peikar på hovudarten sin `taxonId`, samt utfylte `nameNob`- og `nameNno`-felt.
