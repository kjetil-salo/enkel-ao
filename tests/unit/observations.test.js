import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderObservations, toCsv } from '../../public/js/observations.js';
import { saveLanguage } from '../../public/js/storage.js';

beforeEach(() => {
  document.body.innerHTML = '';
  saveLanguage('nb');
  delete window.__isNynorsk;
  window.matchMedia = window.matchMedia || (() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

describe('toCsv', () => {
  it('should return empty string for empty observations array', () => {
    const csv = toCsv([]);
    expect(csv).toBe('');
  });

  it('should generate correct CSV header', () => {
    const observations = [{
      species: { taxonName: 'Toppand' },
      placeName: 'Østensjøvannet',
      count: 5,
      activity: 'Rastende',
      age: 'Adult',
      gender: 'Hann',
      comment: 'Fin dag',
      timestamp: '2026-01-22T12:00:00Z',
      tilKlokkeslett: '2026-01-22T13:00:00Z',
      coObservers: []
    }];

    const csv = toCsv(observations);
    const lines = csv.split('\n');

    // Sjekk at første linje er header
    expect(lines[0]).toContain('Artsnavn');
    expect(lines[0]).toContain('Lokalitetsnavn');
    expect(lines[0]).toContain('Nord');
    expect(lines[0]).toContain('Øst');
    expect(lines[0]).toContain('Fra dato');
    expect(lines[0]).toContain('Til dato');
    expect(lines[0]).toContain('Antall');
    expect(lines[0]).toContain('Medobservatør');
  });

  it('should format a single observation correctly', () => {
    const observations = [{
      species: { taxonName: 'Toppand' },
      placeName: 'Østensjøvannet',
      count: 5,
      activity: 'Rastende',
      age: 'Adult',
      gender: 'Hann',
      comment: 'Fin dag',
      timestamp: '2026-01-22T12:30:00Z',
      tilKlokkeslett: '2026-01-22T13:45:00Z',
      coObservers: []
    }];

    const csv = toCsv(observations);
    const lines = csv.split('\n');

    // Linje 2 skal være data (linje 1 er header)
    const dataLine = lines[1];
    const columns = dataLine.split('\t');

    expect(columns[0]).toBe('Toppand');           // Artsnavn
    expect(columns[1]).toBe('Østensjøvannet');    // Lokalitetsnavn
    expect(columns[6]).toMatch(/^\d{2}\.\d{2}\.\d{4}$/); // Fra dato (DD.MM.YYYY)
    expect(columns[7]).toMatch(/^\d{2}\.\d{2}\.\d{4}$/); // Til dato
    expect(columns[8]).toMatch(/^\d{2}:\d{2}$/);  // Fra klokkeslett (HH:MM)
    expect(columns[9]).toMatch(/^\d{2}:\d{2}$/);  // Til klokkeslett
    expect(columns[10]).toBe('5');                // Antall
    expect(columns[11]).toBe('Adult');            // Alder
    expect(columns[12]).toBe('Hann');             // Kjønn
    expect(columns[13]).toBe('Rastende');         // Aktivitet
    expect(columns[14]).toBe('Fin dag');          // Kommentar
  });

  it('should handle missing species gracefully', () => {
    const observations = [{
      species: null,
      placeName: 'Test',
      count: 1,
      timestamp: '2026-01-22T12:00:00Z'
    }];

    const csv = toCsv(observations);
    const lines = csv.split('\n');
    const dataLine = lines[1];
    const columns = dataLine.split('\t');

    expect(columns[0]).toBe(''); // Tom artsnavn
  });

  it('should handle coObservers array correctly', () => {
    const observations = [{
      species: { taxonName: 'Toppand' },
      placeName: 'Østensjøvannet',
      count: 5,
      timestamp: '2026-01-22T12:00:00Z',
      coObservers: [
        { name: 'Ola Nordmann' },
        { name: 'Kari Nordmann' },
        'Per Hansen' // Også støtte for string
      ]
    }];

    const csv = toCsv(observations);
    const lines = csv.split('\n');
    const dataLine = lines[1];
    const columns = dataLine.split('\t');

    // Medobservatører starter på kolonne 17 (index 17)
    expect(columns[17]).toBe('Ola Nordmann');
    expect(columns[18]).toBe('Kari Nordmann');
    expect(columns[19]).toBe('Per Hansen');
  });

  it('should handle special characters in fields', () => {
    const observations = [{
      species: { taxonName: 'Art;med;semikolon' },
      placeName: 'Sted\tmed\ttab',
      comment: 'Kommentar; med, spesialtegn',
      count: 1,
      timestamp: '2026-01-22T12:00:00Z'
    }];

    const csv = toCsv(observations);
    const lines = csv.split('\n');
    const dataLine = lines[1];

    // Spesialtegn skal erstattes med komma
    expect(dataLine).toContain('Art,med,semikolon');
    expect(dataLine).toContain('Sted,med,tab');
    expect(dataLine).toContain('Kommentar, med, spesialtegn');
  });

  it('should use current date if timestamp is missing', () => {
    const observations = [{
      species: { taxonName: 'Toppand' },
      placeName: 'Test',
      count: 1,
      timestamp: null
    }];

    const csv = toCsv(observations);
    const lines = csv.split('\n');
    const dataLine = lines[1];
    const columns = dataLine.split('\t');

    // Skal ha en gyldig dato selv uten timestamp
    expect(columns[6]).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    expect(columns[7]).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
  });

  it('should handle multiple observations', () => {
    const observations = [
      {
        species: { taxonName: 'Toppand' },
        placeName: 'Østensjøvannet',
        count: 5,
        timestamp: '2026-01-22T12:00:00Z'
      },
      {
        species: { taxonName: 'Stokkand' },
        placeName: 'Østensjøvannet',
        count: 3,
        timestamp: '2026-01-22T13:00:00Z'
      },
      {
        species: { taxonName: 'Grågås' },
        placeName: 'Østensjøvannet',
        count: 12,
        timestamp: '2026-01-22T14:00:00Z'
      }
    ];

    const csv = toCsv(observations);
    const lines = csv.split('\n');

    // 1 header + 3 data lines
    expect(lines).toHaveLength(4);

    // Sjekk at alle arter er med
    expect(csv).toContain('Toppand');
    expect(csv).toContain('Stokkand');
    expect(csv).toContain('Grågås');
  });

  it('should handle empty coObservers array', () => {
    const observations = [{
      species: { taxonName: 'Toppand' },
      placeName: 'Test',
      count: 1,
      timestamp: '2026-01-22T12:00:00Z',
      coObservers: []
    }];

    const csv = toCsv(observations);
    const lines = csv.split('\n');
    const dataLine = lines[1];
    const columns = dataLine.split('\t');

    // Medobservatør-kolonner (17-26) skal være tomme
    for (let i = 17; i < 27; i++) {
      expect(columns[i]).toBe('');
    }
  });

  it('should place privateComment in column 15 (Privat kommentar)', () => {
    const observations = [{
      species: { taxonName: 'Toppand' },
      placeName: 'Østensjøvannet',
      count: 1,
      timestamp: '2026-01-22T12:00:00Z',
      privateComment: 'Sett sammen med Kari',
    }];

    const csv = toCsv(observations);
    const columns = csv.split('\n')[1].split('\t');
    expect(columns[15]).toBe('Sett sammen med Kari');
  });

  it('should leave privateComment column empty when not set', () => {
    const observations = [{
      species: { taxonName: 'Toppand' },
      placeName: 'Østensjøvannet',
      count: 1,
      timestamp: '2026-01-22T12:00:00Z',
    }];

    const csv = toCsv(observations);
    const columns = csv.split('\n')[1].split('\t');
    expect(columns[15]).toBe('');
  });

  it('should mark secondhand/uncertain/notSpontaneous/interesting/notRefound/notFound in columns 38-43', () => {
    const observations = [{
      species: { taxonName: 'Fiskemåke' },
      placeName: 'Nes',
      count: 1,
      timestamp: '2026-01-22T12:00:00Z',
      secondhand: true,
      uncertain: true,
      notSpontaneous: true,
      interesting: true,
      notRefound: true,
      notFound: true,
    }];

    const csv = toCsv(observations);
    const columns = csv.split('\n')[1].split('\t');
    expect(columns[38]).not.toBe(''); // Andrehånds
    expect(columns[39]).not.toBe(''); // Usikker artsbestemming
    expect(columns[40]).not.toBe(''); // Ikke spontan
    expect(columns[41]).not.toBe(''); // Interessant observasjon
    expect(columns[42]).not.toBe(''); // Ikke gjenfunnet
    expect(columns[43]).not.toBe(''); // Ikke funnet
  });

  it('should leave columns 39-43 empty when none of the flags are set', () => {
    const observations = [{
      species: { taxonName: 'Fiskemåke' },
      placeName: 'Nes',
      count: 1,
      timestamp: '2026-01-22T12:00:00Z',
    }];

    const csv = toCsv(observations);
    const columns = csv.split('\n')[1].split('\t');
    expect(columns[39]).toBe('');
    expect(columns[40]).toBe('');
    expect(columns[41]).toBe('');
    expect(columns[42]).toBe('');
    expect(columns[43]).toBe('');
  });

  it('should use tilKlokkeslett as end time when provided', () => {
    const observations = [{
      species: { taxonName: 'Toppand' },
      placeName: 'Test',
      count: 1,
      timestamp: '2026-01-22T10:00:00Z',
      tilKlokkeslett: '2026-01-22T12:00:00Z'
    }];

    const csv = toCsv(observations);
    const lines = csv.split('\n');
    const dataLine = lines[1];
    const columns = dataLine.split('\t');

    // Kolonne 8 = fra klokkeslett, kolonne 9 = til klokkeslett
    expect(columns[8]).toMatch(/^\d{2}:\d{2}$/);
    expect(columns[9]).toMatch(/^\d{2}:\d{2}$/);
    expect(columns[8]).not.toBe(columns[9]); // Skal være forskjellige
  });
});

describe('renderObservations besøk', () => {
  it('viser samme tilbake-ikon som hjelpesiden for tidligere besøk', () => {
    const observations = [
      {
        species: { taxonName: 'Heilo' },
        placeName: 'Herdla',
        placeId: 42,
        visitId: 'visit-morgen',
        count: 20,
        activity: 'Overflygende',
        timestamp: '2026-07-03T08:00:00',
      },
    ];
    const obsListEl = document.createElement('div');

    renderObservations(observations, obsListEl, {}, vi.fn());

    const usePlaceBtn = obsListEl.querySelector('.obs-group-place-btn');
    expect(usePlaceBtn.textContent).toBe('↩');
    expect(usePlaceBtn.getAttribute('aria-label')).toBe('Gå tilbake til besøket på Herdla');
  });

  it('låser bare valgt besøk og lar samme lokalitet ha flere besøk', () => {
    const observations = [
      {
        species: { taxonName: 'Heilo' },
        placeName: 'Herdla',
        placeId: 42,
        visitId: 'visit-kveld',
        count: 20,
        activity: 'Overflygende',
        timestamp: '2026-07-03T18:00:00',
      },
      {
        species: { taxonName: 'Heilo' },
        placeName: 'Herdla',
        placeId: 42,
        visitId: 'visit-morgen',
        count: 100,
        activity: 'Næringssøkende',
        timestamp: '2026-07-03T08:00:00',
      },
    ];
    const obsListEl = document.createElement('div');
    const saveState = vi.fn();

    renderObservations(observations, obsListEl, {}, saveState);

    const lockButtons = obsListEl.querySelectorAll('.obs-group-lock-btn');
    expect(lockButtons).toHaveLength(2);

    lockButtons[0].click();

    expect(observations[0].visitLocked).toBe(true);
    expect(observations[1].visitLocked).toBeFalsy();
    expect(saveState).toHaveBeenCalled();
    const updatedLockButtons = obsListEl.querySelectorAll('.obs-group-lock-btn');
    // Låsen er en egentegnet SVG, ikke 🔓/🔒-emoji (de to skilte seg kun på
    // bøylens vinkel og var i praksis like i 34 px-knappen). Tilstanden leses
    // derfor av klassen og aria-label, ikke av tegninnholdet.
    expect(updatedLockButtons[0].classList.contains('is-locked')).toBe(true);
    expect(updatedLockButtons[1].classList.contains('is-locked')).toBe(false);
    expect(updatedLockButtons[0].querySelector('svg')).toBeTruthy();
    expect(updatedLockButtons[0].getAttribute('aria-label')).toBe('Besøk avsluttet');
    expect(updatedLockButtons[1].getAttribute('aria-label')).toBe('Besøk åpent');
  });

  it('viser "Sletta <art>" i toast ved sletting når nynorsk er valgt', () => {
    saveLanguage('nn');
    const observations = [
      {
        species: { taxonName: 'Gråmåke', nynorsk: 'Gråmåse' },
        placeName: 'Herdla',
        count: 1,
        timestamp: '2026-07-03T08:00:00',
      },
    ];
    const obsListEl = document.createElement('div');
    const saveState = vi.fn();
    renderObservations(observations, obsListEl, {}, saveState);

    const deleteBtn = obsListEl.querySelector('.delete-obs-btn');
    expect(deleteBtn).not.toBeNull();
    deleteBtn.click();

    expect(observations).toHaveLength(0);
    const toast = document.getElementById('registered-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain('Sletta Gråmåse');
    const undoBtn = toast.querySelector('button');
    expect(undoBtn.textContent).toBe('Angra');
  });

  it('viser "Slettet <art>" i toast ved sletting på bokmål', () => {
    saveLanguage('nb');
    const observations = [
      {
        species: { taxonName: 'Gråmåke', nynorsk: 'Gråmåse' },
        placeName: 'Herdla',
        count: 1,
        timestamp: '2026-07-03T08:00:00',
      },
    ];
    const obsListEl = document.createElement('div');
    const saveState = vi.fn();
    renderObservations(observations, obsListEl, {}, saveState);

    const deleteBtn = obsListEl.querySelector('.delete-obs-btn');
    expect(deleteBtn).not.toBeNull();
    deleteBtn.click();

    expect(observations).toHaveLength(0);
    const toast = document.getElementById('registered-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain('Slettet Gråmåke');
    const undoBtn = toast.querySelector('button');
    expect(undoBtn.textContent).toBe('Angre');
  });

  it('bruker "Besøk avslutta" og "Besøk opna att" på hengelåsen når nynorsk er valgt', () => {
    saveLanguage('nn');
    const observations = [
      {
        species: { taxonName: 'Heilo' },
        placeName: 'Herdla',
        count: 1,
        timestamp: '2026-07-03T08:00:00',
      },
    ];
    const obsListEl = document.createElement('div');
    const saveState = vi.fn();
    renderObservations(observations, obsListEl, {}, saveState);

    const lockBtn = obsListEl.querySelector('.obs-group-lock-btn');
    expect(lockBtn).not.toBeNull();
    expect(lockBtn.getAttribute('aria-label')).toBe('Besøk opna');

    lockBtn.click();
    expect(observations[0].visitLocked).toBe(true);
    const toast = document.getElementById('registered-toast');
    expect(toast.textContent).toBe('Besøk avslutta');

    const updatedLockBtn = obsListEl.querySelector('.obs-group-lock-btn');
    updatedLockBtn.click();
    expect(observations[0].visitLocked).toBe(false);
    expect(toast.textContent).toBe('Besøk opna att');
  });

  it('viser nynorsk tekst i klokkeslett-modalen (Set klokkeslett, Frå, Til, Set på alle)', () => {
    saveLanguage('nn');
    const observations = [
      {
        species: { taxonName: 'Heilo' },
        placeName: 'Herdla',
        count: 1,
        timestamp: '2026-07-03T08:00:00',
      },
    ];
    const obsListEl = document.createElement('div');
    const saveState = vi.fn();
    renderObservations(observations, obsListEl, {}, saveState);

    const clockBtn = obsListEl.querySelector('.obs-group-time-btn');
    expect(clockBtn).not.toBeNull();
    expect(clockBtn.getAttribute('aria-label')).toBe('Set klokkeslett');

    clockBtn.click();
    const modal = document.getElementById('time-modal');
    expect(modal).not.toBeNull();
    expect(modal.querySelector('h3').textContent).toBe('🕐 Set klokkeslett');
    expect(modal.textContent).toContain('Frå');
    expect(modal.textContent).toContain('Til');
    expect(modal.querySelector('#time-modal-apply').textContent).toBe('Set på alle');
    modal.remove();
  });
});
