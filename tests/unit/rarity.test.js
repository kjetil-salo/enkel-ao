import { beforeEach, afterEach, it, expect, vi } from 'vitest';

let rarity;
let dom;
const date = '2026-06-01';
const state = (taxonId) => ({ selectedSpecies: { taxonId }, currentPlaceId: 200, observations: [] });

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${date}T12:00:00`));
  localStorage.clear();
  localStorage.setItem('ao_tokens', JSON.stringify({ loginToken: 'test' }));
  rarity = await import('../../public/js/rarity.js');
  dom = Object.fromEntries(['rarityWarning', 'rarityWarningHeader', 'rarityWarningBody'].map(key => [key, document.createElement('div')]));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('skiller observasjonsdatoer og ignorerer gamle udaterte cachetreff', () => {
  rarity.setCachedRarity(100, 200, date, '12,34', { Header: 'Juni' });
  expect(rarity.getCachedRarity(100, 200, date).warning.Header).toBe('Juni');
  expect(rarity.getCachedRarity(100, 200, '2026-11-01')).toBeNull();
  localStorage.setItem('ao_rarity_cache_v1', JSON.stringify({ 'site:200::100': { warning: null, ts: Date.now() } }));
  expect(rarity.getCachedRarity(100, 200, date)).toBeNull();
});

it('følger appens modus: hybrid bruker datert cache, online oppdaterer og offline bruker ikke nett', async () => {
  rarity.setCachedRarity(100, 200, date, '12,34', { Header: 'Cachet' });
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ warning: null, areas: '12,34' }) });
  localStorage.setItem('network_mode_v1', 'hybrid');
  rarity.checkRarity(state(100), dom);
  await vi.advanceTimersByTimeAsync(500);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(dom.rarityWarningHeader.textContent).toBe('Cachet');
  localStorage.setItem('network_mode_v1', 'online');
  rarity.checkRarity(state(100), dom);
  await vi.advanceTimersByTimeAsync(500);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  localStorage.setItem('network_mode_v1', 'offline');
  rarity.checkRarity(state(101), dom);
  await vi.advanceTimersByTimeAsync(500);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

it('henter nytt svar når observasjonsdatoen endres', async () => {
  rarity.setCachedRarity(100, 200, date, '12,34', { Header: 'Juni' });
  vi.setSystemTime(new Date('2026-11-01T12:00:00'));
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ warning: null }) });
  rarity.checkRarity(state(100), dom);
  await vi.advanceTimersByTimeAsync(500);
  expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('date=2026-11-01'), expect.anything());
});

it('forkaster forsinket svar for A etter bytte til cachet B', async () => {
  let complete;
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  rarity.checkRarity(state(301), dom);
  await vi.advanceTimersByTimeAsync(500);
  rarity.setCachedRarity(302, 200, date, '12,34', { Header: 'Art B' });
  rarity.checkRarity(state(302), dom);
  complete({ ok: true, json: async () => ({ warning: { Header: 'Art A' }, areas: '12,34' }) });
  await vi.advanceTimersByTimeAsync(1);
  expect(dom.rarityWarningHeader.textContent).toBe('Art B');
});

it('starter ikke kølagt nettverksjobb etter overgang til offline', async () => {
  let complete;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  rarity.checkRarity(state(401), dom);
  await vi.advanceTimersByTimeAsync(500);
  rarity.checkRarity(state(402), dom);
  await vi.advanceTimersByTimeAsync(500);
  localStorage.setItem('network_mode_v1', 'offline');
  complete({ ok: true, json: async () => ({ warning: null }) });
  await vi.advanceTimersByTimeAsync(1);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
