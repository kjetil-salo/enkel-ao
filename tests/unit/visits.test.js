import { describe, expect, it, vi } from 'vitest';

import {
  findOpenVisitId,
  getObservationVisitKey,
  resolveVisitIdForNewObservation,
  setVisitLocked,
} from '../../public/js/visits.js';

describe('besøk', () => {
  it('gjenbruker åpent besøk for samme lokalitet', () => {
    const observations = [
      { placeName: 'Herdla', placeId: 42, visitId: 'visit-a', visitLocked: false },
      { placeName: 'Bøneset', placeId: 7, visitId: 'visit-b', visitLocked: false },
    ];

    expect(findOpenVisitId(observations, 'Herdla', 42)).toBe('visit-a');
    expect(resolveVisitIdForNewObservation(observations, 'Herdla', 42)).toBe('visit-a');
  });

  it('starter nytt besøk når eksisterende besøk er låst', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);

    const observations = [
      { placeName: 'Herdla', placeId: 42, visitId: 'visit-a', visitLocked: true },
    ];
    const visitId = resolveVisitIdForNewObservation(
      observations,
      'Herdla',
      42,
      new Date('2026-07-03T10:00:00')
    );

    expect(visitId).not.toBe('visit-a');
    expect(visitId).toContain('visit:id:42:');

    Math.random.mockRestore();
  });

  it('kan låse eldre observasjoner uten visitId som ett legacy-besøk', () => {
    const observations = [
      { placeName: 'Herdla', species: { taxonName: 'Heilo' } },
      { placeName: 'Herdla', species: { taxonName: 'Sandlo' } },
      { placeName: 'Bøneset', species: { taxonName: 'Kråke' } },
    ];
    const visitKey = getObservationVisitKey(observations[0]);

    expect(setVisitLocked(observations, visitKey, true)).toBe(2);
    expect(observations[0].visitLocked).toBe(true);
    expect(observations[1].visitLocked).toBe(true);
    expect(observations[2].visitLocked).toBeUndefined();
  });
});
