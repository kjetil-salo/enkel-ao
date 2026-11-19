import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_MAMMAL_ACTIVITY_PILLS,
  loadActivityPills,
  saveActivityPills,
} from '../../public/js/storage.js';

describe('aktivitetspills per artsgruppe', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returnerer de 6 standard-pillene for pattedyr i riktig rekkefølge', () => {
    const pills = loadActivityPills('11');
    expect(pills).toEqual(DEFAULT_MAMMAL_ACTIVITY_PILLS);
    expect(pills.map(p => p.label)).toEqual([
      'Svømmende',
      'Hvilende',
      'Næringssøkende',
      'Drektig hunn',
      'Hunn med unge(r)',
      'Lokkelyd, øvrige lyder',
    ]);
  });

  it('lagrer fugle- og pattedyrpills helt atskilt', () => {
    saveActivityPills([{ label: 'Stasjonær', value: '23' }], '8');
    saveActivityPills([{ label: 'Dvale', value: '60' }, { label: 'Hvilende', value: '86' }], '11');

    expect(loadActivityPills('8')).toEqual([{ label: 'Stasjonær', value: '23' }]);
    expect(loadActivityPills('11')).toEqual([
      { label: 'Dvale', value: '60' },
      { label: 'Hvilende', value: '86' },
    ]);
  });
});
