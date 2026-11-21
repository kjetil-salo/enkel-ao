/**
 * Tester for henting/caching av brukerens egne arts-tall
 * (public/js/ao-species-stats.js), brukt av public/artsobservasjoner.html.
 * Samme mønster som ao-messages.test.js: tokens-mangel skal aldri utløse et
 * nettverkskall, og cachen skal nøkles på brukernavn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, value) => { store[key] = String(value); }),
  removeItem: vi.fn((key) => { delete store[key]; }),
});

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { hentAoArtstall } = await import('../../public/js/ao-species-stats.js');

function svarMed(data) {
  fetchMock.mockResolvedValue({ json: async () => data });
}

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  vi.clearAllMocks();
  store['ao_tokens'] = JSON.stringify({ loginToken: 'L', authCookie: 'A' });
  store['ao_username'] = 'kjetil-test';
  // Nullstill modulens interne cache ved å la klokka gå forbi TTL-en (30 min)
  vi.setSystemTime(new Date(Date.now() + 2000000));
});

describe('hentAoArtstall', () => {
  it('spør ikke AO uten lagrede tokens', async () => {
    delete store['ao_tokens'];

    const data = await hentAoArtstall();

    expect(data).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('henter og returnerer tallene fra AO', async () => {
    svarMed({ fuglerTotalt: 337, fuglerIAr: 220 });

    const data = await hentAoArtstall();

    expect(data).toEqual({ fuglerTotalt: 337, fuglerIAr: 220 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bruker cache innenfor TTL i stedet for å spørre AO på nytt', async () => {
    svarMed({ fuglerTotalt: 10, fuglerIAr: 5 });
    await hentAoArtstall();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const data = await hentAoArtstall();

    expect(data).toEqual({ fuglerTotalt: 10, fuglerIAr: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('force:true hopper over cachen', async () => {
    svarMed({ fuglerTotalt: 10, fuglerIAr: 5 });
    await hentAoArtstall();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    svarMed({ fuglerTotalt: 11, fuglerIAr: 6 });
    const data = await hentAoArtstall({ force: true });

    expect(data).toEqual({ fuglerTotalt: 11, fuglerIAr: 6 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('feiler stille når kallet kaster', async () => {
    fetchMock.mockRejectedValue(new Error('nettverk nede'));

    await expect(hentAoArtstall()).resolves.toBeNull();
  });

  it('cacher nøkkelet på brukernavn — kontobytte spør AO på nytt', async () => {
    svarMed({ fuglerTotalt: 42, fuglerIAr: 1 });
    await hentAoArtstall();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    store['ao_username'] = 'en-annen-konto';
    svarMed({ fuglerTotalt: 0, fuglerIAr: 0 });
    const data = await hentAoArtstall();

    expect(data).toEqual({ fuglerTotalt: 0, fuglerIAr: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('to samtidige kall deler ett nettverkskall', async () => {
    let resolveFetch;
    fetchMock.mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const p1 = hentAoArtstall();
    const p2 = hentAoArtstall();
    resolveFetch({ json: async () => ({ fuglerTotalt: 7, fuglerIAr: 2 }) });

    const [d1, d2] = await Promise.all([p1, p2]);

    expect(d1).toEqual({ fuglerTotalt: 7, fuglerIAr: 2 });
    expect(d2).toEqual({ fuglerTotalt: 7, fuglerIAr: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
