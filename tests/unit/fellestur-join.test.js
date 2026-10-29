import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../public/js/storage.js', () => ({ loadObservations: vi.fn(), saveObservations: vi.fn() }));
vi.mock('../../public/js/visits.js', () => ({ resolveVisitIdForNewObservation: vi.fn() }));
vi.mock('../../public/js/ui.js', () => ({ showToast: vi.fn() }));
vi.mock('../../public/js/ao-observer-autocomplete.js', () => ({ attachAoObserverAutocomplete: vi.fn() }));

function tur(overrides = {}) {
  return {
    ok: true, kode: '00123', navn: '', medobservatorer: [], observasjoner: [],
    opprinnelse: 'enkel-ao', eksternBekreftet: false, ...overrides,
  };
}

function svar(data, status = 200) {
  return { ok: status === 200, status, json: async () => data };
}

async function start(kode = '') {
  history.replaceState(null, '', `/fellestur.html${kode ? `?kode=${kode}` : ''}`);
  await import('../../public/js/fellestur.js');
  await vi.dynamicImportSettled();
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Fellestur – bli med via kode', () => {
  it('viser kun kodefelt og oppretter ingen liste over aktive turer', async () => {
    await start();
    document.getElementById('btn-bli-med').click();
    expect(document.getElementById('tur-kode')).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('forteller at en lokal tur ble funnet og beholder ledende nuller', async () => {
    fetch.mockResolvedValue(svar(tur()));
    await start('00123');
    expect(document.getElementById('tur-kilde-status').textContent).toContain('Fant turen i Enkel-AO');
    expect(JSON.parse(localStorage.getItem('aktivFellestur_v1')).kode).toBe('00123');
    expect(fetch).toHaveBeenCalledWith('/api/fellestur?kode=00123');
  });

  it('forteller at en ekstern tur er kjent fra mottatte hendelser', async () => {
    fetch.mockResolvedValue(svar(tur({ opprinnelse: 'ekstern', eksternBekreftet: true })));
    await start('00123');
    expect(document.getElementById('tur-kilde-status').textContent).toContain('Fant en ekstern tur');
    expect(document.getElementById('btn-bli-med-likevel')).toBeNull();
  });

  it('advarer om begge forklaringene på ukjent kode før noe opprettes', async () => {
    fetch.mockResolvedValue(svar({}, 404));
    await start('00123');
    const varsel = document.querySelector('.tur-advarsel');
    expect(varsel.getAttribute('role')).toBe('alert');
    expect(varsel.textContent).toContain('uten at noen funn er sendt');
    expect(varsel.textContent).toContain('ikke i bruk noe sted');
    expect(varsel.textContent).toContain('Kontroller selv koden');
    expect(localStorage.getItem('aktivFellestur_v1')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('kobler først til ubekreftet tur etter Bli med likevel', async () => {
    fetch.mockResolvedValueOnce(svar({}, 404))
      .mockResolvedValueOnce(svar(tur({ opprinnelse: 'ekstern' })));
    await start('00123');
    document.getElementById('btn-bli-med-likevel').click();
    await vi.waitFor(() => expect(document.getElementById('tur-kilde-status')).not.toBeNull());
    const [, request] = fetch.mock.calls[1];
    expect(JSON.parse(request.body)).toEqual({ kode: '00123', godtaUbekreftet: true });
    expect(document.getElementById('tur-kilde-status').textContent).toContain('Ekstern tur er ikke bekreftet');
    expect(JSON.parse(localStorage.getItem('aktivFellestur_v1')).kode).toBe('00123');
  });

  it('advarer også neste deltaker når noen allerede har valgt en ubekreftet kode', async () => {
    fetch.mockResolvedValue(svar(tur({ opprinnelse: 'ekstern' })));
    await start('00123');
    expect(document.getElementById('btn-bli-med-likevel')).not.toBeNull();
    expect(localStorage.getItem('aktivFellestur_v1')).toBeNull();
  });

  it('sperrer bytte av kode mens påmeldingen venter på serveren', async () => {
    let fullfor;
    fetch.mockResolvedValueOnce(svar({}, 404))
      .mockImplementationOnce(() => new Promise((resolve) => { fullfor = resolve; }));
    await start('00123');
    document.getElementById('btn-bli-med-likevel').click();
    expect(document.getElementById('btn-tilbake').disabled).toBe(true);
    document.getElementById('btn-tilbake').click();
    expect(document.getElementById('tur-kode')).toBeNull();
    fullfor(svar(tur({ opprinnelse: 'ekstern' })));
    await vi.waitFor(() => expect(document.getElementById('tur-kilde-status')).not.toBeNull());
    expect(JSON.parse(localStorage.getItem('aktivFellestur_v1')).kode).toBe('00123');
  });

  it('lar en deltaker gjenåpne sin ubekreftede tur med fortsatt synlig advarsel', async () => {
    localStorage.setItem('aktivFellestur_v1', JSON.stringify({ kode: '00123', navn: '' }));
    fetch.mockResolvedValue(svar(tur({ opprinnelse: 'ekstern' })));
    await start('00123');
    expect(document.getElementById('tur-kilde-status').textContent).toContain('Ekstern tur er ikke bekreftet');
    expect(document.getElementById('btn-bli-med-likevel')).toBeNull();
  });

  it('fjerner advarselen når en peer senere bekrefter turen', async () => {
    localStorage.setItem('aktivFellestur_v1', JSON.stringify({ kode: '00123', navn: '' }));
    fetch.mockResolvedValueOnce(svar(tur({ opprinnelse: 'ekstern' })))
      .mockResolvedValueOnce(svar(tur({ opprinnelse: 'ekstern', eksternBekreftet: true })));
    await start('00123');
    document.getElementById('btn-oppdater-na').click();
    await vi.waitFor(() => expect(document.getElementById('tur-kilde-status').textContent).toContain('Fant en ekstern tur'));
    expect(document.querySelector('.tur-advarsel')).toBeNull();
  });

  it.each([500, 429])('tolker ikke HTTP %s som ukjent kode', async (status) => {
    fetch.mockResolvedValue(svar({}, status));
    await start('00123');
    expect(document.body.textContent).toContain('Kunne ikke sjekke turkoden');
    expect(document.getElementById('btn-bli-med-likevel')).toBeNull();
    expect(localStorage.getItem('aktivFellestur_v1')).toBeNull();
  });

  it('tolker ikke nettverksfeil som ukjent kode', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await start('00123');
    expect(document.getElementById('btn-prov-igjen')).not.toBeNull();
    expect(document.getElementById('btn-bli-med-likevel')).toBeNull();
  });

  it.each(['svar', 'feil'])('ignorerer gammelt retry-%s etter at brukeren har valgt Endre kode', async (type) => {
    let fullfor;
    let avvis;
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementationOnce(() => new Promise((resolve, reject) => { fullfor = resolve; avvis = reject; }));
    await start('00123');
    document.getElementById('btn-prov-igjen').click();
    document.getElementById('btn-tilbake').click();
    if (type === 'svar') fullfor(svar(tur()));
    else avvis(new TypeError('Failed to fetch'));
    await vi.dynamicImportSettled();
    expect(document.getElementById('tur-kode')).not.toBeNull();
    expect(document.getElementById('tur-kilde-status')).toBeNull();
    expect(localStorage.getItem('aktivFellestur_v1')).toBeNull();
  });

  it('aktiverer ikke turen når påmeldingen feiler og lar brukeren prøve igjen', async () => {
    fetch.mockResolvedValueOnce(svar({}, 404)).mockResolvedValueOnce(svar({ error: 'Prøv igjen senere' }, 429));
    await start('00123');
    document.getElementById('btn-bli-med-likevel').click();
    await vi.waitFor(() => expect(document.getElementById('feil').hidden).toBe(false));
    expect(document.getElementById('feil').textContent).toBe('Prøv igjen senere');
    expect(document.getElementById('btn-bli-med-likevel').disabled).toBe(false);
    expect(document.getElementById('btn-tilbake').disabled).toBe(false);
    expect(localStorage.getItem('aktivFellestur_v1')).toBeNull();
  });

  it('krever fem siffer og sjekker ingen tur ved ugyldig kode', async () => {
    await start();
    document.getElementById('btn-bli-med').click();
    document.getElementById('tur-kode').value = '123ab';
    document.getElementById('btn-bli-med-send').click();
    expect(document.getElementById('feil').textContent).toBe('Koden skal være 5 siffer.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lar brukeren endre kode uten å opprette eller aktivere turen', async () => {
    fetch.mockResolvedValue(svar({}, 404));
    await start('00123');
    document.getElementById('btn-tilbake').click();
    expect(document.getElementById('tur-kode')).not.toBeNull();
    expect(location.search).toBe('');
    expect(localStorage.getItem('aktivFellestur_v1')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
