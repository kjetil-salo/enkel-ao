/**
 * Tester for den delte hentingen/cachingen av AO-meldinger (innboks +
 * driftsvarsler), brukt av både profil.html og header-badgen i main.js.
 *
 * Samme fallgruve som kø-hintet (ao-queue-hint.test.js): et AO-svar med
 * nullfelt («vet ikke») må IKKE caches om det var tomt («0 meldinger») —
 * her er det ikke aktuelt siden AO alltid svarer med tall eller feiler helt,
 * men tokens-mangel skal uansett aldri utløse noe nettverkskall.
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

const { hentAoMeldinger, totalAoMeldinger, hentAoInnboksForhandsvisning, hentAoSamtaleSisteMelding, hentAoDriftsmeldingerForhandsvisning } = await import('../../public/js/ao-messages.js');

function svarMed(data) {
  fetchMock.mockResolvedValue({ json: async () => data });
}

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  vi.clearAllMocks();
  store['ao_tokens'] = JSON.stringify({ loginToken: 'L', authCookie: 'A' });
  store['ao_username'] = 'kjetil-test';
  // Nullstill modulens interne cache ved å la klokka gå forbi TTL-en (10 min)
  vi.setSystemTime(new Date(Date.now() + 700000));
});

describe('hentAoMeldinger', () => {
  it('spør ikke AO uten lagrede tokens', async () => {
    delete store['ao_tokens'];

    const data = await hentAoMeldinger();

    expect(data).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('henter og returnerer tellingene fra AO', async () => {
    svarMed({ nyeMeldinger: 2, nyeVarsler: 1 });

    const data = await hentAoMeldinger();

    expect(data).toEqual({ nyeMeldinger: 2, nyeVarsler: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bruker cache innenfor TTL i stedet for å spørre AO på nytt', async () => {
    svarMed({ nyeMeldinger: 3, nyeVarsler: 0 });
    await hentAoMeldinger();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const data = await hentAoMeldinger();

    expect(data).toEqual({ nyeMeldinger: 3, nyeVarsler: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('force:true hopper over cachen', async () => {
    svarMed({ nyeMeldinger: 1, nyeVarsler: 0 });
    await hentAoMeldinger();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    svarMed({ nyeMeldinger: 2, nyeVarsler: 0 });
    const data = await hentAoMeldinger({ force: true });

    expect(data).toEqual({ nyeMeldinger: 2, nyeVarsler: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('feiler stille når kallet kaster', async () => {
    fetchMock.mockRejectedValue(new Error('nettverk nede'));

    await expect(hentAoMeldinger()).resolves.toBeNull();
  });

  it('cacher nøkkelet på brukernavn — kontobytte spør AO på nytt', async () => {
    svarMed({ nyeMeldinger: 5, nyeVarsler: 0 });
    await hentAoMeldinger();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    store['ao_username'] = 'en-annen-konto';
    svarMed({ nyeMeldinger: 0, nyeVarsler: 0 });
    const data = await hentAoMeldinger();

    expect(data).toEqual({ nyeMeldinger: 0, nyeVarsler: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('totalAoMeldinger', () => {
  it('summerer innboks og varsler', () => {
    expect(totalAoMeldinger({ nyeMeldinger: 2, nyeVarsler: 3 })).toBe(5);
  });

  it('gir 0 for null-data eller nullfelt («vet ikke»)', () => {
    expect(totalAoMeldinger(null)).toBe(0);
    expect(totalAoMeldinger({ nyeMeldinger: null, nyeVarsler: null })).toBe(0);
  });
});

describe('hentAoInnboksForhandsvisning', () => {
  it('spør ikke AO uten lagrede tokens', async () => {
    delete store['ao_tokens'];

    const data = await hentAoInnboksForhandsvisning();

    expect(data).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('henter radene fra endepunktet', async () => {
    const rader = [{ ulest: true, tittel: 'X', avsender: 'Y', dato: 'Z', href: 'https://x' }];
    svarMed({ meldinger: rader });

    const data = await hentAoInnboksForhandsvisning();

    expect(data).toEqual(rader);
  });

  it('ignorerer cachen fra hentAoMeldinger — spør AO på nytt hver gang', async () => {
    svarMed({ meldinger: [{ tittel: 'A' }] });
    await hentAoInnboksForhandsvisning();
    svarMed({ meldinger: [{ tittel: 'B' }] });

    const data = await hentAoInnboksForhandsvisning();

    expect(data).toEqual([{ tittel: 'B' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('feiler stille til null når kallet kaster', async () => {
    fetchMock.mockRejectedValue(new Error('nettverk nede'));

    await expect(hentAoInnboksForhandsvisning()).resolves.toBeNull();
  });

  it('gir null når AO ikke kunne tolkes (meldinger: null fra serveren)', async () => {
    svarMed({ meldinger: null });

    expect(await hentAoInnboksForhandsvisning()).toBeNull();
  });
});

describe('hentAoSamtaleSisteMelding', () => {
  it('spør ikke AO uten lagrede tokens', async () => {
    delete store['ao_tokens'];

    const data = await hentAoSamtaleSisteMelding(74752);

    expect(data).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sender samtaleId videre og returnerer meldingen', async () => {
    const melding = { avsender: 'X', tekst: 'Y', tidIso: 'Z', tidTekst: 'W' };
    svarMed({ melding });

    const data = await hentAoSamtaleSisteMelding(74752);

    expect(data).toEqual(melding);
    const [, opts] = fetchMock.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ loginToken: 'L', authCookie: 'A', samtaleId: 74752 });
  });

  it('feiler stille til null når kallet kaster', async () => {
    fetchMock.mockRejectedValue(new Error('nettverk nede'));

    await expect(hentAoSamtaleSisteMelding(1)).resolves.toBeNull();
  });

  it('gir null når AO ikke kunne tolkes (melding: null fra serveren)', async () => {
    svarMed({ melding: null });

    expect(await hentAoSamtaleSisteMelding(1)).toBeNull();
  });
});

describe('hentAoDriftsmeldingerForhandsvisning', () => {
  it('spør ikke AO uten lagrede tokens', async () => {
    delete store['ao_tokens'];

    const data = await hentAoDriftsmeldingerForhandsvisning();

    expect(data).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('henter radene fra endepunktet', async () => {
    const rader = [{ ulest: true, avsender: 'X', tekst: 'Y', tidIso: null, tidTekst: 'Z' }];
    svarMed({ meldinger: rader });

    const data = await hentAoDriftsmeldingerForhandsvisning();

    expect(data).toEqual(rader);
  });

  it('feiler stille til null når kallet kaster', async () => {
    fetchMock.mockRejectedValue(new Error('nettverk nede'));

    await expect(hentAoDriftsmeldingerForhandsvisning()).resolves.toBeNull();
  });

  it('gir null når AO ikke kunne tolkes (meldinger: null fra serveren)', async () => {
    svarMed({ meldinger: null });

    expect(await hentAoDriftsmeldingerForhandsvisning()).toBeNull();
  });
});
