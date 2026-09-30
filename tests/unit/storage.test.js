import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage før import av storage-modulen
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, value) => { store[key] = String(value); }),
  removeItem: vi.fn((key) => { delete store[key]; }),
};
vi.stubGlobal('localStorage', localStorageMock);

// Dynamisk import etter mock er satt opp
const { loadMedobs, saveMedobs, defaultCoObservers, saveObservations, loadObservations, saveAoDirectAutoClear, loadAoDirectAutoClear, saveNynorskArtsnavn, loadNynorskArtsnavn, speciesDisplayName } = await import('../../public/js/storage.js');

// Speiler todayStr() i storage.js — medobs lagres med dagens dato.
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  vi.clearAllMocks();
});

describe('loadMedobs', () => {
  it('should return empty array when nothing stored', () => {
    expect(loadMedobs()).toEqual([]);
  });

  it('should return empty array for null value', () => {
    store['medobs_list_v1'] = 'null';
    expect(loadMedobs()).toEqual([]);
  });

  it('should load object format correctly and keep active state same day', () => {
    const list = [
      { name: 'Ola', active: true },
      { name: 'Kari', active: false }
    ];
    store['medobs_list_v1'] = JSON.stringify({ date: todayStr(), list });
    expect(loadMedobs()).toEqual(list);
  });

  it('should deactivate all co-observers on a new day', () => {
    const list = [
      { name: 'Ola', active: true },
      { name: 'Kari', active: true }
    ];
    store['medobs_list_v1'] = JSON.stringify({ date: '2000-01-01', list });
    expect(loadMedobs()).toEqual([
      { name: 'Ola', active: false },
      { name: 'Kari', active: false }
    ]);
  });

  it('should migrate old string format to inactive object format', () => {
    store['medobs_list_v1'] = JSON.stringify(['Ola', 'Kari']);
    expect(loadMedobs()).toEqual([
      { name: 'Ola', active: false },
      { name: 'Kari', active: false }
    ]);
  });

  it('should limit migrated list to 10 entries', () => {
    const old = Array.from({ length: 15 }, (_, i) => `Person${i}`);
    store['medobs_list_v1'] = JSON.stringify(old);
    expect(loadMedobs()).toHaveLength(10);
  });

  it('should return empty array for invalid JSON', () => {
    store['medobs_list_v1'] = '{ugyldig json';
    expect(loadMedobs()).toEqual([]);
  });

  it('should return empty array for non-array value', () => {
    store['medobs_list_v1'] = JSON.stringify('bare en streng');
    expect(loadMedobs()).toEqual([]);
  });
});

describe('saveMedobs', () => {
  it('should save list wrapped with today\'s date', () => {
    const list = [{ name: 'Ola', active: true }];
    saveMedobs(list);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'medobs_list_v1',
      JSON.stringify({ date: todayStr(), list })
    );
  });

  it('should overwrite existing data', () => {
    saveMedobs([{ name: 'Ola', active: true }]);
    saveMedobs([{ name: 'Kari', active: false }]);
    expect(JSON.parse(store['medobs_list_v1']).list).toEqual([
      { name: 'Kari', active: false }
    ]);
  });
});

describe('defaultCoObservers', () => {
  it('should return array of 10 empty strings when no medobs', () => {
    const result = defaultCoObservers();
    expect(result).toHaveLength(10);
    expect(result.every(s => s === '')).toBe(true);
  });

  it('should include only active co-observers', () => {
    store['medobs_list_v1'] = JSON.stringify({ date: todayStr(), list: [
      { name: 'Ola', active: true },
      { name: 'Kari', active: false },
      { name: 'Per', active: true }
    ] });

    const result = defaultCoObservers();
    expect(result[0]).toBe('Ola');
    expect(result[1]).toBe('Per');
    expect(result[2]).toBe('');
    expect(result).toHaveLength(10);
  });

  it('should skip entries without name', () => {
    store['medobs_list_v1'] = JSON.stringify({ date: todayStr(), list: [
      { name: '', active: true },
      { name: 'Ola', active: true },
      { active: true },
      null
    ] });

    const result = defaultCoObservers();
    expect(result[0]).toBe('Ola');
    expect(result[1]).toBe('');
  });

  it('should cap at 10 co-observers', () => {
    const list = Array.from({ length: 12 }, (_, i) => ({ name: `P${i}`, active: true }));
    store['medobs_list_v1'] = JSON.stringify({ date: todayStr(), list });

    const result = defaultCoObservers();
    expect(result).toHaveLength(10);
    expect(result[0]).toBe('P0');
    expect(result[9]).toBe('P9');
  });
});

describe('saveObservations', () => {
  it('should save observations wrapped in versioned payload', () => {
    const obs = [{ species: { taxonName: 'Toppand' }, count: 3 }];
    saveObservations(obs);

    const stored = JSON.parse(store['fugleobservasjoner_v1']);
    expect(stored.version).toBe(1);
    expect(stored.observations).toEqual(obs);
  });

  it('should save empty array', () => {
    saveObservations([]);

    const stored = JSON.parse(store['fugleobservasjoner_v1']);
    expect(stored.version).toBe(1);
    expect(stored.observations).toEqual([]);
  });

  it('should overwrite previous observations', () => {
    saveObservations([{ species: { taxonName: 'Toppand' } }]);
    saveObservations([{ species: { taxonName: 'Stokkand' } }]);

    const stored = JSON.parse(store['fugleobservasjoner_v1']);
    expect(stored.observations).toHaveLength(1);
    expect(stored.observations[0].species.taxonName).toBe('Stokkand');
  });
});

describe('loadAoDirectAutoClear / saveAoDirectAutoClear', () => {
  it('should default to false when nothing stored', () => {
    expect(loadAoDirectAutoClear()).toBe(false);
  });

  it('should round-trip true', () => {
    saveAoDirectAutoClear(true);
    expect(loadAoDirectAutoClear()).toBe(true);
  });

  it('should round-trip false after being true', () => {
    saveAoDirectAutoClear(true);
    saveAoDirectAutoClear(false);
    expect(loadAoDirectAutoClear()).toBe(false);
  });
});

describe('loadNynorskArtsnavn / saveNynorskArtsnavn', () => {
  it('should default to false when nothing stored', () => {
    expect(loadNynorskArtsnavn()).toBe(false);
  });

  it('should round-trip true', () => {
    saveNynorskArtsnavn(true);
    expect(loadNynorskArtsnavn()).toBe(true);
  });

  it('should round-trip false after being true', () => {
    saveNynorskArtsnavn(true);
    saveNynorskArtsnavn(false);
    expect(loadNynorskArtsnavn()).toBe(false);
  });
});

describe('speciesDisplayName', () => {
  it('should return empty string for null/undefined species', () => {
    expect(speciesDisplayName(null)).toBe('');
    expect(speciesDisplayName(undefined)).toBe('');
  });

  it('should return bokmål (taxonName) when nynorsk setting is off, even if nynorsk field exists', () => {
    saveNynorskArtsnavn(false);
    expect(speciesDisplayName({ taxonName: 'fiskemåke', nynorsk: 'fiskemåse' })).toBe('fiskemåke');
  });

  it('should return nynorsk when setting is on and species has a nynorsk name', () => {
    saveNynorskArtsnavn(true);
    expect(speciesDisplayName({ taxonName: 'fiskemåke', nynorsk: 'fiskemåse' })).toBe('fiskemåse');
  });

  it('should fall back to bokmål when setting is on but species has no nynorsk name', () => {
    // Typisk et online AO-søkeresultat, som aldri har et nynorsk-felt
    saveNynorskArtsnavn(true);
    expect(speciesDisplayName({ taxonName: 'kjøttmeis' })).toBe('kjøttmeis');
  });

  it('should never leak nynorsk into the underlying taxonName field itself', () => {
    saveNynorskArtsnavn(true);
    const species = { taxonName: 'fiskemåke', nynorsk: 'fiskemåse' };
    speciesDisplayName(species);
    // Kallet må aldri mutere objektet - taxonName er det som til slutt
    // sendes til AO og skal forbli urørt uansett innstilling.
    expect(species.taxonName).toBe('fiskemåke');
  });
});

describe('loadObservations', () => {
  it('should return empty array when nothing stored', () => {
    expect(loadObservations()).toEqual([]);
  });

  it('should load saved observations', () => {
    const obs = [
      { species: { taxonName: 'Toppand' }, count: 3, placeName: 'Østensjøvannet' }
    ];
    saveObservations(obs);
    expect(loadObservations()).toEqual(obs);
  });

  it('should return empty array for invalid JSON', () => {
    store['fugleobservasjoner_v1'] = '{ødelagt';
    expect(loadObservations()).toEqual([]);
  });

  it('should return empty array if payload has no observations array', () => {
    store['fugleobservasjoner_v1'] = JSON.stringify({ version: 1 });
    expect(loadObservations()).toEqual([]);
  });

  it('should return empty array for non-object payload', () => {
    store['fugleobservasjoner_v1'] = JSON.stringify('bare tekst');
    expect(loadObservations()).toEqual([]);
  });

  it('should roundtrip complex observations', () => {
    const obs = [
      {
        species: { taxonName: 'Grågås' },
        count: 12,
        placeName: 'Østensjøvannet',
        timestamp: '2026-01-22T14:00:00Z',
        coObservers: [{ name: 'Ola' }, { name: 'Kari' }],
        comment: 'Kommentar med spesialtegn: æøå'
      },
      {
        species: { taxonName: 'Stokkand' },
        count: 5,
        placeName: 'Sognsvann',
        timestamp: '2026-01-22T15:00:00Z',
        activity: 'Svømmende',
        coObservers: []
      }
    ];
    saveObservations(obs);
    expect(loadObservations()).toEqual(obs);
  });
});
