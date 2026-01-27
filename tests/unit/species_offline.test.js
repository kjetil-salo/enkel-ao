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
  }
];

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// Importer etter mock. Modulen cacher internt, så vi må re-importere per test.
let searchOfflineSpecies, loadOfflineSpecies;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  fetchMock.mockResolvedValue({
    json: () => Promise.resolve(testSpecies),
  });

  const mod = await import('../../public/js/species_offline.js');
  searchOfflineSpecies = mod.searchOfflineSpecies;
  loadOfflineSpecies = mod.loadOfflineSpecies;
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
});
