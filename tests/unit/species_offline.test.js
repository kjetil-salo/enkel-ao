import { describe, it, expect, vi, beforeEach } from 'vitest';

// Testdata: forenklet artsliste
const testSpecies = [
  {
    norwegian: 'Blåmeis',
    latin: 'Cyanistes caeruleus',
    subspecies: [
      { norwegian: 'Blåmeis ssp. caeruleus', latin: 'Cyanistes caeruleus caeruleus' },
      { norwegian: 'nan', latin: 'Cyanistes caeruleus obscurus' },
    ]
  },
  {
    norwegian: 'Kjøttmeis',
    latin: 'Parus major',
    nynorsk: 'kjøtmeis',
    subspecies: []
  },
  {
    norwegian: 'Toppmeis',
    latin: 'Lophophanes cristatus',
    subspecies: [
      { norwegian: 'Toppmeis ssp. cristatus', latin: 'Lophophanes cristatus cristatus' }
    ]
  },
  {
    norwegian: 'Svartmeis',
    latin: 'Periparus ater',
    subspecies: []
  },
  {
    norwegian: 'nan',
    latin: 'Utennavnart testus',
    subspecies: []
  },
  {
    norwegian: 'Løvmeis',
    latin: 'Poecile palustris',
    subspecies: [
      { norwegian: 'Nordlig løvmeis', latin: 'Poecile palustris borealis' }
    ]
  },
  {
    id: 4547,
    taxonId: 4547,
    norwegian: 'rødvingetrost',
    nameNob: 'rødvingetrost',
    nynorsk: 'raudvengtrast',
    nameNno: 'raudvengtrast',
    latin: 'Turdus iliacus',
    latinName: 'Turdus iliacus',
    antallFunn: 310000,
    subspecies: [
      {
        parentId: 4547,
        isSub: true,
        norwegian: 'rødvingetrost, nominat-rødvingetrost',
        nameNob: 'rødvingetrost, underarten iliacus',
        nynorsk: 'raudvengtrast, underarten iliacus',
        nameNno: 'raudvengtrast, underarten iliacus',
        latin: 'iliacus',
        latinName: 'Turdus iliacus iliacus'
      },
      {
        parentId: 4547,
        isSub: true,
        norwegian: 'rødvingetrost, underarten coburni',
        nameNob: 'rødvingetrost, underarten coburni',
        nynorsk: 'raudvengtrast, underarten coburni',
        nameNno: 'raudvengtrast, underarten coburni',
        latin: 'coburni',
        latinName: 'Turdus iliacus coburni'
      }
    ]
  },
  {
    id: 186469,
    taxonId: 186469,
    norwegian: 'østgulerle',
    nameNob: 'østgulerle',
    nynorsk: 'austgulerle',
    nameNno: 'austgulerle',
    latin: 'Motacilla tschutschensis',
    latinName: 'Motacilla tschutschensis',
    antallFunn: 75,
    subspecies: [
      {
        id: 186470,
        taxonId: 186470,
        parentId: 186469,
        isSub: true,
        norwegian: 'nan',
        nameNob: 'østgulerle, underarten plexa/tschutschensis',
        nynorsk: 'austgulerle, underarten plexa/tschutschensis',
        nameNno: 'austgulerle, underarten plexa/tschutschensis',
        latin: 'M. t. plexa/tschutschensis',
        latinName: 'Motacilla tschutschensis plexa/tschutschensis',
        antallFunn: 0,
      }
    ]
  }
];

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// Importer etter mock. Modulen cacher internt, så vi må re-importere per test.
let searchOfflineSpecies, loadOfflineSpecies, getNynorskByLatin, findBokmalByNynorskTerm;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  fetchMock.mockResolvedValue({
    json: () => Promise.resolve(testSpecies),
  });

  const mod = await import('../../public/js/species_offline.js');
  searchOfflineSpecies = mod.searchOfflineSpecies;
  loadOfflineSpecies = mod.loadOfflineSpecies;
  getNynorskByLatin = mod.getNynorskByLatin;
  findBokmalByNynorskTerm = mod.findBokmalByNynorskTerm;
});

// ─── loadOfflineSpecies ───────────────────────────────────────

describe('loadOfflineSpecies', () => {
  it('should fetch species list from JSON file', async () => {
    const result = await loadOfflineSpecies();
    expect(fetchMock).toHaveBeenCalledWith('/data/norske_arter.json');
    expect(result).toEqual(testSpecies);
  });

  it('should cache result and not fetch twice', async () => {
    await loadOfflineSpecies();
    await loadOfflineSpecies();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

// ─── searchOfflineSpecies ─────────────────────────────────────

describe('searchOfflineSpecies', () => {
  // Grunnleggende
  it('should return empty array for short term', async () => {
    expect(await searchOfflineSpecies('a')).toEqual([]);
    expect(await searchOfflineSpecies('')).toEqual([]);
    expect(await searchOfflineSpecies(' ')).toEqual([]);
  });

  it('should find species by Norwegian name', async () => {
    const result = await searchOfflineSpecies('Blåmeis');
    expect(result.some(r => r.taxonName === 'Blåmeis')).toBe(true);
  });

  it('should find species by Latin name', async () => {
    const result = await searchOfflineSpecies('Cyanistes');
    expect(result.some(r => r.scientificName === 'Cyanistes caeruleus')).toBe(true);
  });

  it('should be case-insensitive', async () => {
    const result = await searchOfflineSpecies('blåmeis');
    expect(result.some(r => r.taxonName === 'Blåmeis')).toBe(true);
  });

  it('should trim search term', async () => {
    const result = await searchOfflineSpecies('  Blåmeis  ');
    expect(result.some(r => r.taxonName === 'Blåmeis')).toBe(true);
  });

  it('should mark results as offline source', async () => {
    const result = await searchOfflineSpecies('Blåmeis');
    expect(result.every(r => r.source === 'offline')).toBe(true);
  });

  // Søk med "meis" treffer flere arter
  it('should find multiple species matching term', async () => {
    const result = await searchOfflineSpecies('meis');
    const names = result.map(r => r.taxonName);
    expect(names).toContain('Blåmeis');
    expect(names).toContain('Kjøttmeis');
    expect(names).toContain('Toppmeis');
    expect(names).toContain('Svartmeis');
    expect(names).toContain('Løvmeis');
  });

  // Filtrering
  it('should filter out entries with nan as Norwegian name', async () => {
    const result = await searchOfflineSpecies('testus');
    expect(result).toEqual([]);
  });

  // Underarter
  it('should not include subspecies by default', async () => {
    const result = await searchOfflineSpecies('Blåmeis', false);
    expect(result.every(r => !r.isSub)).toBe(true);
  });

  it('should include subspecies when flag is set and main art matches', async () => {
    const result = await searchOfflineSpecies('Blåmeis', true);
    expect(result.some(r => r.isSub)).toBe(true);
    expect(result.some(r => r.scientificName === 'Cyanistes caeruleus caeruleus')).toBe(true);
  });

  it('should filter out subspecies with nan Norwegian name', async () => {
    const result = await searchOfflineSpecies('Blåmeis', true);
    // obscurus-underarten har nan som norsk navn, men skal falle tilbake til hovedartens navn
    const obscurus = result.find(r => r.scientificName === 'Cyanistes caeruleus obscurus');
    expect(obscurus).toBeTruthy();
    expect(obscurus.taxonName).toBe('Blåmeis'); // Fallback til hovedart
  });

  it('should find subspecies by their own name when includeSubtaxa', async () => {
    // Søk etter "Nordlig" matcher kun underarten av Løvmeis
    const result = await searchOfflineSpecies('Nordlig', true);
    expect(result).toHaveLength(1);
    expect(result[0].taxonName).toBe('Nordlig løvmeis');
    expect(result[0].isSub).toBe(true);
  });

  it('should not find subspecies by their own name when includeSubtaxa is false', async () => {
    const result = await searchOfflineSpecies('Nordlig', false);
    expect(result).toHaveLength(0);
  });

  it('Problem 1 & 2: Søk på "raudvengtrast" og "rødvingetrost" med includeSubtaxa=true og userLanguage="nn" returnerer underartar på nynorsk', async () => {
    const storageMod = await import('../../public/js/storage.js');

    const resNno = await searchOfflineSpecies('raudvengtrast', true, 'nn');
    expect(resNno).toHaveLength(3);
    expect(resNno[0].isSub).toBe(false);
    expect(storageMod.speciesDisplayName(resNno[0], 'nn')).toBe('raudvengtrast');

    const subNamesNno = resNno.slice(1).map((r) => storageMod.speciesDisplayName(r, 'nn'));
    expect(subNamesNno).toEqual([
      'raudvengtrast, underarten coburni',
      'raudvengtrast, underarten iliacus',
    ]);

    const resNob = await searchOfflineSpecies('rødvingetrost', true, 'nn');
    expect(resNob).toHaveLength(3);
    const subNamesFromNob = resNob.slice(1).map((r) => storageMod.speciesDisplayName(r, 'nn'));
    expect(subNamesFromNob).toEqual([
      'raudvengtrast, underarten coburni',
      'raudvengtrast, underarten iliacus',
    ]);
  });

  // Sortering
  it('should sort: starts with > contains > other', async () => {
    const result = await searchOfflineSpecies('meis');
    const names = result.map(r => r.taxonName);

    // Ingen arter starter med "meis", men alle inneholder det
    // Sjekk at de er sortert alfabetisk i norsk
    for (let i = 1; i < names.length; i++) {
      expect(names[i - 1].localeCompare(names[i], 'nb')).toBeLessThanOrEqual(0);
    }
  });

  it('should prioritize startsWith over contains', async () => {
    const result = await searchOfflineSpecies('topp');
    const names = result.map(r => r.taxonName);
    // "Toppmeis" starter med "topp", skal komme først
    expect(names[0]).toBe('Toppmeis');
  });

  it('should find species by partial Latin name', async () => {
    const result = await searchOfflineSpecies('Parus');
    expect(result.some(r => r.taxonName === 'Kjøttmeis')).toBe(true);
  });

  // Nynorsk-hint (kosmetisk - se docs for hvorfor dette aldri erstatter taxonName)
  it('should include nynorsk field when present in source data', async () => {
    const result = await searchOfflineSpecies('Kjøttmeis');
    const hit = result.find(r => r.taxonName === 'Kjøttmeis');
    expect(hit.nynorsk).toBe('kjøtmeis');
  });

  it('should keep taxonName as bokmål regardless of nynorsk field', async () => {
    // Kjøttmeis har et annet nynorsk-navn enn bokmål - taxonName skal likevel
    // forbli bokmål, siden det er dette som faktisk sendes til AO ved publisering
    const result = await searchOfflineSpecies('Kjøttmeis');
    const hit = result.find(r => r.nynorsk === 'kjøtmeis');
    expect(hit.taxonName).toBe('Kjøttmeis');
  });

  it('should return null nynorsk when not present in source data', async () => {
    const result = await searchOfflineSpecies('Svartmeis');
    const hit = result.find(r => r.taxonName === 'Svartmeis');
    expect(hit.nynorsk).toBeNull();
  });

  // Søk på nynorsk-navnet skal FINNE arten, ikke bare vise nynorsk etter man
  // fant den via bokmål. "kjøtmeis" er bevisst valgt fordi det IKKE er en
  // delstreng av bokmål "Kjøttmeis" (ekstra "t") - kun nynorsk-matching kan
  // finne treffet her.
  it('should find species by nynorsk name even when it does not substring-match the bokmål name', async () => {
    expect('Kjøttmeis'.toLowerCase().includes('kjøtmeis')).toBe(false); // forutsetning for testen
    const result = await searchOfflineSpecies('kjøtmeis');
    expect(result.some(r => r.taxonName === 'Kjøttmeis')).toBe(true);
  });

  it('should find species by nynorsk name prefix', async () => {
    const result = await searchOfflineSpecies('kjøt');
    expect(result.some(r => r.taxonName === 'Kjøttmeis')).toBe(true);
  });
});

// ─── findBokmalByNynorskTerm ──────────────────────────────────
// Oversetter en nynorsk søketerm til bokmål, brukt til å søke AO på nytt
// siden AO selv ikke forstår nynorsk-termer i det hele tatt.

describe('findBokmalByNynorskTerm', () => {
  it('should find bokmål name from exact nynorsk term', async () => {
    expect(await findBokmalByNynorskTerm('kjøtmeis')).toContain('Kjøttmeis');
  });

  it('should find bokmål name from nynorsk prefix', async () => {
    expect(await findBokmalByNynorskTerm('kjøt')).toContain('Kjøttmeis');
  });

  it('should return empty array for a term with no nynorsk match', async () => {
    expect(await findBokmalByNynorskTerm('helturistisk')).toEqual([]);
  });

  it('should return empty array for short terms', async () => {
    expect(await findBokmalByNynorskTerm('k')).toEqual([]);
    expect(await findBokmalByNynorskTerm('')).toEqual([]);
  });

  it('should not return duplicates', async () => {
    const result = await findBokmalByNynorskTerm('kjøtmeis');
    expect(result.length).toBe(new Set(result).size);
  });
});

// ─── getNynorskByLatin ────────────────────────────────────────
// Brukt til å berike AOs egne (alltid bokmål) søkeresultater med nynorsk,
// slik at nynorsk-innstillingen virker i vanlig, online søk - se species-search.js

describe('getNynorskByLatin', () => {
  it('should find nynorsk by exact scientific name', async () => {
    expect(await getNynorskByLatin('Parus major')).toBe('kjøtmeis');
  });

  it('should be case-insensitive', async () => {
    expect(await getNynorskByLatin('parus MAJOR')).toBe('kjøtmeis');
  });

  it('should trim whitespace', async () => {
    expect(await getNynorskByLatin('  Parus major  ')).toBe('kjøtmeis');
  });

  it('should return null for species without a nynorsk name', async () => {
    expect(await getNynorskByLatin('Periparus ater')).toBeNull();
  });

  it('should return null for unknown scientific name', async () => {
    expect(await getNynorskByLatin('Ukjentus artus')).toBeNull();
  });

  it('should return null for empty/missing input', async () => {
    expect(await getNynorskByLatin('')).toBeNull();
    expect(await getNynorskByLatin(null)).toBeNull();
  });

  it('should resolve nynorsk subspecies name for AO scientificName format "Turdus iliacus subsp. iliacus"', async () => {
    expect(await getNynorskByLatin('Turdus iliacus subsp. iliacus')).toBe(
      'raudvengtrast, underarten iliacus'
    );
    expect(await getNynorskByLatin('Turdus iliacus subsp. coburni')).toBe(
      'raudvengtrast, underarten coburni'
    );
  });
});

// ─── enrichAoSpeciesResults (Online AO PickerSearch med underarter) ───

describe('enrichAoSpeciesResults', () => {
  it('knyter AO-underartar til hovudart via parentId og set nynorsk underartsnamn', async () => {
    const { enrichAoSpeciesResults } = await import('../../public/js/species-search.js');
    const { searchSpecies } = await import('../../public/js/species-matcher.js');
    const { speciesDisplayName } = await import('../../public/js/storage.js');

    const rawAoPayload = [
      {
        taxonId: '4547',
        taxonName: 'rødvingetrost',
        scientificName: 'Turdus iliacus',
      },
      {
        taxonId: '4548',
        taxonName: 'rødvingetrost, underarten coburni',
        scientificName: 'Turdus iliacus subsp. coburni',
      },
      {
        taxonId: '4549',
        taxonName: 'rødvingetrost, underarten iliacus',
        scientificName: 'Turdus iliacus subsp. iliacus',
      },
    ];

    const enriched = await enrichAoSpeciesResults(rawAoPayload);
    expect(enriched[1].isSub).toBe(true);
    expect(String(enriched[1].parentId)).toBe('4547');
    expect(enriched[1].nameNno).toBe('raudvengtrast, underarten coburni');
    expect(enriched[2].isSub).toBe(true);
    expect(String(enriched[2].parentId)).toBe('4547');
    expect(enriched[2].nameNno).toBe('raudvengtrast, underarten iliacus');

    // Søk både på nynorsk ("raudvengtrast") og bokmål ("rødvingetrost") skal gi alle 3 på nynorsk
    const rankedNno = searchSpecies('raudvengtrast', enriched, 'nn');
    expect(rankedNno.map((s) => speciesDisplayName(s, 'nn'))).toEqual([
      'raudvengtrast',
      'raudvengtrast, underarten coburni',
      'raudvengtrast, underarten iliacus',
    ]);

    const rankedNob = searchSpecies('rødvingetrost', enriched, 'nn');
    expect(rankedNob.map((s) => speciesDisplayName(s, 'nn'))).toEqual([
      'raudvengtrast',
      'raudvengtrast, underarten coburni',
      'raudvengtrast, underarten iliacus',
    ]);

    // Sjekk også søk på prefiks "raudveng"
    const rankedPrefix = searchSpecies('raudveng', enriched, 'nn');
    expect(rankedPrefix.map((s) => speciesDisplayName(s, 'nn'))).toEqual([
      'raudvengtrast',
      'raudvengtrast, underarten coburni',
      'raudvengtrast, underarten iliacus',
    ]);
  });

  it('beheld dedikerte underartsnamn (svartryggerle, såerle) og omset "sørlig gulerle" til "sørleg gulerle"', async () => {
    const { enrichAoSpeciesResults } = await import('../../public/js/species-search.js');
    const { searchSpecies } = await import('../../public/js/species-matcher.js');
    const { speciesDisplayName } = await import('../../public/js/storage.js');

    const aoSubspeciesPayload = [
      {
        taxonId: '4335',
        taxonName: 'svartryggerle',
        scientificNameHtml: '<i>Motacilla alba </i>subsp.<i> yarrellii</i>',
      },
      {
        taxonId: '1100902',
        taxonName: 'svartryggerle x linerle',
        scientificNameHtml: 'Motacilla a. yarellii x M. a. alba',
      },
      {
        taxonId: '4344',
        taxonName: 'såerle',
        scientificNameHtml: '<i>Motacilla flava </i>subsp.<i> thunbergi</i>',
      },
      {
        taxonId: '4342',
        taxonName: 'sørlig gulerle',
        scientificNameHtml: '<i>Motacilla flava </i>subsp.<i> flava</i>',
      },
    ];

    const enriched = await enrichAoSpeciesResults(aoSubspeciesPayload);
    const rankedSvartry = searchSpecies('svartry', enriched, 'nn');
    expect(rankedSvartry.map((s) => speciesDisplayName(s, 'nn'))).toEqual([
      'svartryggerle',
      'svartryggerle x linerle',
    ]);

    const rankedSaerle = searchSpecies('såerle', enriched, 'nn');
    expect(rankedSaerle.map((s) => speciesDisplayName(s, 'nn'))).toEqual(['såerle']);

    const rankedSorlig = searchSpecies('sørlig gulerle', enriched, 'nn');
    expect(rankedSorlig.map((s) => speciesDisplayName(s, 'nn'))).toEqual(['sørleg gulerle']);
  });

  it('berikar og søkjer spesialtilfella østgulerle -> austgulerle, østempid -> austempid og ub- gul-/østgulerle -> ub- gul-/austgulerle', async () => {
    const { enrichAoSpeciesResults } = await import('../../public/js/species-search.js');
    const { searchSpecies } = await import('../../public/js/species-matcher.js');
    const { speciesDisplayName } = await import('../../public/js/storage.js');
    const { findBokmalByNynorskTerm, getSpeciesMeta } = await import('../../public/js/species_offline.js');

    // 1. Sjekk getSpeciesMeta for spesialtilfella
    const metaOstgulerle = await getSpeciesMeta('Motacilla tschutschensis', 'østgulerle');
    expect(metaOstgulerle.nynorsk).toBe('austgulerle');

    const metaOstempid = await getSpeciesMeta('Empidonax virescens', 'østempid');
    expect(metaOstempid.nynorsk).toBe('austempid');

    const metaUb = await getSpeciesMeta('', 'ub- gul-/østgulerle');
    expect(metaUb.nynorsk).toBe('ub- gul-/austgulerle');

    // 2. Beriking av AO-respons
    const aoPayload = [
      {
        taxonId: '186469',
        taxonName: 'østgulerle',
        scientificNameHtml: '<i>Motacilla tschutschensis</i>',
      },
      {
        taxonId: '186470',
        taxonName: 'østgulerle, underarten plexa/tschutschensis',
        scientificNameHtml: '<i>Motacilla tschutschensis </i>subsp.<i> plexa/tschutschensis</i>',
      },
      {
        taxonId: '9991',
        taxonName: 'østempid',
        scientificNameHtml: '<i>Empidonax virescens</i>',
      },
      {
        taxonId: '9992',
        taxonName: 'ub- gul-/østgulerle',
        scientificNameHtml: '<i>Motacilla flava / tschutschensis</i>',
      },
    ];

    const enriched = await enrichAoSpeciesResults(aoPayload);
    const rankedAustgulerle = searchSpecies('austgulerle', enriched, 'nn');
    expect(rankedAustgulerle.map((s) => speciesDisplayName(s, 'nn'))).toEqual([
      'austgulerle',
      'austgulerle, underarten plexa/tschutschensis',
      'ub- gul-/austgulerle',
    ]);

    const rankedAustempid = searchSpecies('austempid', enriched, 'nn');
    expect(rankedAustempid.map((s) => speciesDisplayName(s, 'nn'))).toEqual(['austempid']);

    const rankedUb = searchSpecies('ub- gul-/austgulerle', enriched, 'nn');
    expect(rankedUb.map((s) => speciesDisplayName(s, 'nn'))).toEqual(['ub- gul-/austgulerle']);

    // 3. findBokmalByNynorskTerm skal omsette nynorske søkeord til bokmål for oppslag mot AO
    const bokmalForAustgul = await findBokmalByNynorskTerm('austgulerle');
    expect(bokmalForAustgul).toContain('østgulerle');

    const bokmalForAustemp = await findBokmalByNynorskTerm('austempid');
    expect(bokmalForAustemp).toContain('østempid');

    const bokmalForUb = await findBokmalByNynorskTerm('ub- gul-/austgulerle');
    expect(bokmalForUb).toContain('ub- gul-/østgulerle');
  });
});

// ─── SpeciesSyncService & syncSpeciesData (Steg 2) ────────────

describe('SpeciesSyncService & syncSpeciesData', () => {
  it('har rødstrupetrost / raudstrupetrast i INITIAL_SPECIES_SEED fallback', async () => {
    const mod = await import('../../public/js/species_offline.js');
    const ruficollis = mod.INITIAL_SPECIES_SEED.find((s) => s.latinName === 'Turdus ruficollis');
    expect(ruficollis).toBeTruthy();
    expect(ruficollis.nameNob).toBe('rødstrupetrost');
    expect(ruficollis.nameNno).toBe('raudstrupetrast');
    expect(typeof ruficollis.antallFunn).toBe('number');
  });

  it('oppdaterer antallFunn og artsnamn via syncSpeciesData() og sorterer etter nye funntal', async () => {
    const mod = await import('../../public/js/species_offline.js');
    mod.clearSpeciesSyncCache();

    const syncFetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          updatedCount: 3,
          namesUpdated: 1,
          totalSpecies: 3,
          overrides: {
            'periparus ater': {
              id: 4585,
              taxonId: 4585,
              nameNob: 'Svartmeis',
              nameNno: 'svartmeis',
              latinName: 'Periparus ater',
              antallFunn: 999999,
            },
            'cyanistes caeruleus': {
              id: 4587,
              taxonId: 4587,
              nameNob: 'Blåmeis',
              nameNno: 'blåmeis',
              latinName: 'Cyanistes caeruleus',
              antallFunn: 50000,
            },
            'turdus ruficollis': {
              id: 4560,
              taxonId: 4560,
              nameNob: 'rødstrupetrost',
              nameNno: 'raudstrupetrast',
              latinName: 'Turdus ruficollis',
              antallFunn: 3,
            },
          },
        }),
    });

    const syncResult = await mod.syncSpeciesData({ fetchFn: syncFetchMock });
    expect(syncResult.success).toBe(true);
    expect(syncResult.updatedCount).toBe(3);

    // Nå skal søk på "meis" rangere Svartmeis (999 999 funn) føre Blåmeis (50 000 funn)
    const results = await mod.searchOfflineSpecies('meis', false, 'nn');
    expect(results[0].taxonName).toBe('Svartmeis');
    expect(results[0].antallFunn).toBe(999999);
    expect(results[0].nynorsk).toBe('svartmeis');

    // Og ny art frå sync (raudstrupetrast / rødstrupetrost) skal finnast i søk
    const ruficollisSearch = await mod.searchOfflineSpecies('raudstrupetrast', false, 'nn');
    expect(ruficollisSearch).toHaveLength(1);
    expect(ruficollisSearch[0].taxonName).toBe('rødstrupetrost');
    expect(ruficollisSearch[0].nynorsk).toBe('raudstrupetrast');
    expect(ruficollisSearch[0].antallFunn).toBe(3);

    mod.clearSpeciesSyncCache();
  });
});


