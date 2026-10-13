/**
 * Tester for kø-hintet som varsler FØR sending om at det allerede ligger funn til
 * gjennomgang hos AO (scoped publisering skal ikke være usynlig).
 *
 * Den subtile biten: `count: null` betyr «kunne ikke spørre AO», IKKE «køen er tom».
 * Et null må derfor ikke vise noe — og heller ikke caches som om det var et svar.
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

const { oppdaterAoKoHint } = await import('../../public/js/export-operations.js');

function lagDom() {
  const hint = document.createElement('div');
  hint.id = 'ao-queue-hint';
  hint.style.display = 'none';
  document.body.appendChild(hint);
  return { aoKoHint: hint };
}

function svarMed(count) {
  fetchMock.mockResolvedValue({ json: async () => ({ count }) });
}

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  document.body.innerHTML = '';
  vi.clearAllMocks();
  // Innlogget som standard — tokens finnes
  store['ao_tokens'] = JSON.stringify({ loginToken: 'L', authCookie: 'A' });
  // Nullstill modulens interne cache ved å la klokka gå forbi TTL-en (2 min)
  vi.setSystemTime(new Date(Date.now() + 300000));
});

describe('oppdaterAoKoHint', () => {
  it('viser antall og at funnene ikke blir publisert når køen har innhold', async () => {
    const dom = lagDom();
    svarMed(3);

    await oppdaterAoKoHint(dom);
    await vi.waitFor(() => expect(dom.aoKoHint.style.display).toBe('block'));

    expect(dom.aoKoHint.innerHTML).toContain('3 funn');
    expect(dom.aoKoHint.innerHTML).toContain('ikke publisert');
  });

  it('viser ingenting når køen er tom', async () => {
    const dom = lagDom();
    svarMed(0);

    await oppdaterAoKoHint(dom);
    await new Promise((r) => setTimeout(r, 0));

    expect(dom.aoKoHint.style.display).toBe('none');
  });

  it('viser ingenting når AO ikke kunne spørres (null ≠ tom kø)', async () => {
    const dom = lagDom();
    svarMed(null);

    await oppdaterAoKoHint(dom);
    await new Promise((r) => setTimeout(r, 0));

    expect(dom.aoKoHint.style.display).toBe('none');
    expect(dom.aoKoHint.innerHTML).toBe('');
  });

  it('cacher ikke et «vet ikke»-svar — neste kall spør AO på nytt', async () => {
    const dom = lagDom();
    svarMed(null);

    await oppdaterAoKoHint(dom);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Umiddelbart nytt kall. Hadde null blitt cachet som et gyldig svar, ville dette
    // blitt stilt i 2 minutter — og en forbigående AO-feil ville skjult et reelt
    // kø-innhold helt til TTL-en løp ut.
    svarMed(4);
    await oppdaterAoKoHint(dom);
    await vi.waitFor(() => expect(dom.aoKoHint.style.display).toBe('block'));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dom.aoKoHint.innerHTML).toContain('4 funn');
  });

  it('spør ikke AO i det hele tatt uten tokens', async () => {
    delete store['ao_tokens'];
    const dom = lagDom();

    await oppdaterAoKoHint(dom);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(dom.aoKoHint.style.display).toBe('none');
  });

  it('feiler stille når kallet kaster — hintet skal aldri stoppe sending', async () => {
    const dom = lagDom();
    fetchMock.mockRejectedValue(new Error('nettverk nede'));

    await expect(oppdaterAoKoHint(dom)).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));

    expect(dom.aoKoHint.style.display).toBe('none');
  });

  it('gjør seg uten AO-kall når svaret fortsatt er ferskt', async () => {
    const dom = lagDom();
    svarMed(2);

    await oppdaterAoKoHint(dom);
    await vi.waitFor(() => expect(dom.aoKoHint.style.display).toBe('block'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Umiddelbart nytt kall — innenfor TTL, skal bruke cachen
    dom.aoKoHint.style.display = 'none';
    await oppdaterAoKoHint(dom);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dom.aoKoHint.style.display).toBe('block');
  });

  it('gjør ingenting når hint-elementet ikke finnes på siden', async () => {
    await expect(oppdaterAoKoHint({})).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
