import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { initAutocomplete, sortLocationAutocompleteResults } from '../../public/js/autocomplete.js';
import { clearOfflineDatabase, saveOpportunisticOfflineLocations } from '../../public/js/offline-db.js';

let input;
let cleanup;
let onSelect;
const cached = { id: 1, name: 'Teststed lokalt', lat: 60, lon: 5 };
const response = results => ({ ok: true, json: async () => ({ results }) });
const result = (id, value) => ({ id, value, presentationvalue: value });
async function type(text) {
  input.value = text;
  input.dispatchEvent(new Event('input'));
  await vi.advanceTimersByTimeAsync(301);
}
const items = () => [...document.querySelectorAll('.autocomplete-item')].map(el => el.textContent);

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  await clearOfflineDatabase();
  document.body.innerHTML = '<div><input id="sted"></div>';
  input = document.getElementById('sted');
  onSelect = vi.fn();
  cleanup = initAutocomplete(input, onSelect);
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('supplerer lokale teksttreff og bruker fersk versjon av samme id', async () => {
  await saveOpportunisticOfflineLocations([cached]);
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([result(1, 'Teststed oppdatert'), result(2, 'Teststed nytt')]));
  await type('Teststed');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(items()).toEqual(['Teststed oppdatert', 'Teststed nytt']);
});

it('beholder lokale treff ved nettverksfeil og bruker bare lokale treff offline', async () => {
  await saveOpportunisticOfflineLocations([cached]);
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('uten dekning'));
  await type('Teststed');
  expect(items()).toEqual(['Teststed lokalt']);
  localStorage.setItem('network_mode_v1', 'offline');
  fetchSpy.mockClear();
  await type('Teststed');
  expect(items()).toEqual(['Teststed lokalt']);
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('åpner ikke listen igjen når et lokalt treff velges før nettverket svarer', async () => {
  await saveOpportunisticOfflineLocations([cached]);
  let complete;
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  await type('Teststed');
  document.querySelector('.autocomplete-item').click();
  expect(onSelect).toHaveBeenCalledWith(cached.name, cached.id);
  complete(response([result(2, 'Nytt treff')]));
  await vi.advanceTimersByTimeAsync(1);
  expect(document.querySelector('.autocomplete-dropdown').style.display).toBe('none');
  expect(input.value).toBe(cached.name);
});

it('forkaster eldre søk og tømte felt før et sent svar tegnes', async () => {
  let completeOld;
  vi.spyOn(globalThis, 'fetch')
    .mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve; }))
    .mockResolvedValue(response([result(2, 'Nyeste søk')]));
  await type('Gammelt');
  await type('Nyeste');
  completeOld(response([result(1, 'Gammelt søk')]));
  await vi.advanceTimersByTimeAsync(1);
  expect(items()).toEqual(['Nyeste søk']);
  await type('');
  expect(document.querySelector('.autocomplete-dropdown').style.display).toBe('none');
});

describe('sortLocationAutocompleteResults', () => {
  it('sorterer egne private før superlokasjoner og offentlige treff', () => {
    const results = sortLocationAutocompleteResults([
      { value: 'Andres private', isPrivate: true },
      { value: 'Offentlig' },
      { value: 'Min private', isPrivate: true, ColorString: '#ffff00' },
      { value: 'Super', isSuper: true },
    ]);

    expect(results.map(r => r.value)).toEqual([
      'Min private',
      'Super',
      'Offentlig',
      'Andres private',
    ]);
  });

  it('sorterer på avstand innen samme gruppe', () => {
    const results = sortLocationAutocompleteResults([
      { value: 'Langt borte', _distance: 300 },
      { value: 'Nært', _distance: 20 },
    ]);

    expect(results.map(r => r.value)).toEqual(['Nært', 'Langt borte']);
  });
});
