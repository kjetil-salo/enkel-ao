import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, value) => { store[key] = String(value); }),
  removeItem: vi.fn((key) => { delete store[key]; }),
};
vi.stubGlobal('localStorage', localStorageMock);

// Mock fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { searchSpecies, fetchAoSites, logPageView, loadActivities } = await import('../../public/js/api.js');

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// ─── searchSpecies ────────────────────────────────────────────

describe('searchSpecies', () => {
  it('should return empty array for short search term', async () => {
    expect(await searchSpecies('a')).toEqual([]);
    expect(await searchSpecies('')).toEqual([]);
    expect(await searchSpecies(' ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should fetch species from API', async () => {
    const species = [{ taxonName: 'Toppand' }, { taxonName: 'Toppmeis' }];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(species),
    });

    const result = await searchSpecies('topp');
    expect(result).toEqual(species);
    expect(fetchMock).toHaveBeenCalledOnce();

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('/api/species?search=topp');
    expect(url).toContain('dontIncludeSubSpecies=true');
  });

  it('should include subspecies when flag is set', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await searchSpecies('meis', true);

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('dontIncludeSubSpecies=false');
  });

  it('should throw on HTTP error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(searchSpecies('meis')).rejects.toThrow('HTTP 500');
  });

  it('should return empty array for non-array response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ error: 'noe gikk galt' }),
    });

    const result = await searchSpecies('meis');
    expect(result).toEqual([]);
  });

  it('should trim search term', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await searchSpecies('  meis  ');

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('search=meis');
  });

  it('should encode special characters', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await searchSpecies('blå');

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('search=bl%C3%A5');
  });

  // ─── Caching ────────────────────────────────────────────────

  it('should cache results in localStorage', async () => {
    const species = [{ taxonName: 'Toppand' }];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(species),
    });

    await searchSpecies('topp');

    expect(localStorageMock.setItem).toHaveBeenCalled();
    const setItemCall = localStorageMock.setItem.mock.calls.find(
      c => c[0].startsWith('species_')
    );
    expect(setItemCall).toBeTruthy();

    const cached = JSON.parse(setItemCall[1]);
    expect(cached.data).toEqual(species);
    expect(cached.ts).toBeGreaterThan(0);
  });

  it('should return cached result without fetching', async () => {
    const species = [{ taxonName: 'Blåmeis' }];
    const cacheKey = 'species_blåmeis::nosub';
    store[cacheKey] = JSON.stringify({ data: species, ts: Date.now() });

    const result = await searchSpecies('Blåmeis');

    expect(result).toEqual(species);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should use case-insensitive cache key', async () => {
    const species = [{ taxonName: 'Blåmeis' }];
    const cacheKey = 'species_blåmeis::nosub';
    store[cacheKey] = JSON.stringify({ data: species, ts: Date.now() });

    // Søk med store bokstaver skal treffe cache
    const result = await searchSpecies('BLÅMEIS');
    expect(result).toEqual(species);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should separate cache for sub/nosub', async () => {
    const noSub = [{ taxonName: 'Blåmeis' }];
    store['species_meis::nosub'] = JSON.stringify({ data: noSub, ts: Date.now() });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ taxonName: 'Blåmeis ssp.' }]),
    });

    // Med subspecies skal IKKE treffe nosub-cache
    const result = await searchSpecies('meis', true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('should expire cache after TTL', async () => {
    const species = [{ taxonName: 'Gammel' }];
    const expired = Date.now() - (366 * 24 * 60 * 60 * 1000); // Over 1 år
    store['species_meis::nosub'] = JSON.stringify({ data: species, ts: expired });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ taxonName: 'Ny' }]),
    });

    const result = await searchSpecies('meis');
    expect(result).toEqual([{ taxonName: 'Ny' }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    // Utgått cache skal fjernes
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('species_meis::nosub');
  });

  it('should handle corrupted cache gracefully', async () => {
    store['species_meis::nosub'] = '{korrupt json!!!';

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ taxonName: 'Blåmeis' }]),
    });

    const result = await searchSpecies('meis');
    expect(result).toEqual([{ taxonName: 'Blåmeis' }]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

// ─── fetchAoSites ─────────────────────────────────────────────

describe('fetchAoSites', () => {
  it('should fetch sites from API', async () => {
    const sites = [{ name: 'Østensjøvannet', lat: 59.9, lon: 10.8 }];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ sites }),
    });

    const result = await fetchAoSites(59.9, 10.7);
    expect(result).toEqual(sites);

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('/api/ao-sites');
    expect(url).toContain('lat=59.9');
    expect(url).toContain('lon=10.7');
    expect(url).toContain('size=1000');
  });

  it('should use custom size parameter', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ sites: [] }),
    });

    await fetchAoSites(59.9, 10.7, 5000);

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('size=5000');
  });

  it('should return empty array on HTTP error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await fetchAoSites(59.9, 10.7);
    expect(result).toEqual([]);
  });

  it('should return empty array for invalid response format', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ error: 'noe gikk galt' }),
    });

    const result = await fetchAoSites(59.9, 10.7);
    expect(result).toEqual([]);
  });

  it('should return empty array for null response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(null),
    });

    const result = await fetchAoSites(59.9, 10.7);
    expect(result).toEqual([]);
  });

  it('should filter out sites without valid name', async () => {
    const sites = [
      { name: 'Gyldig', lat: 59.9, lon: 10.8 },
      { name: '', lat: 59.91, lon: 10.81 },
      { name: '   ', lat: 59.92, lon: 10.82 },
      { lat: 59.93, lon: 10.83 },
      null
    ];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ sites }),
    });

    const result = await fetchAoSites(59.9, 10.7);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Gyldig');
  });
});

// ─── logPageView ──────────────────────────────────────────────

describe('logPageView', () => {
  it('should POST to /api/logview', () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    logPageView();

    expect(fetchMock).toHaveBeenCalledWith('/api/logview', { method: 'POST' });
  });

  it('should not throw on network error', () => {
    fetchMock.mockRejectedValueOnce(new Error('Nettverksfeil'));

    // Skal ikke kaste feil
    expect(() => logPageView()).not.toThrow();
  });
});

// ─── loadActivities ───────────────────────────────────────────

describe('loadActivities', () => {
  it('should fetch activities from JSON file', async () => {
    const activities = ['Rastende', 'Flygende', 'Svømmende'];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(activities),
    });

    const result = await loadActivities();
    expect(result).toEqual(activities);
    expect(fetchMock).toHaveBeenCalledWith('/data/activities.json');
  });
});
