import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage før import av fellestur-sync (importkjeden går via
// fellestur-client.js, som leser localStorage).
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, value) => { store[key] = String(value); }),
  removeItem: vi.fn((key) => { delete store[key]; }),
};
vi.stubGlobal('localStorage', localStorageMock);

// Toast-modulen bruker DOM-manipulasjon vi ikke trenger å teste her.
vi.mock('../../public/js/ui.js', () => ({ showToast: vi.fn() }));

const { diffObservasjoner, lagreSpeilOgSynk, synk, oppdaterSpeilFraServer, hentSpeilVersjon, lastSpeil } =
  await import('../../public/js/fellestur-sync.js');

function aktiverFellestur(kode = 'ABC123') {
  store['aktivFellestur_v1'] = JSON.stringify({ kode, navn: 'Test' });
}

function ventPaaMikrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  vi.clearAllMocks();
});

function obs(overrides = {}) {
  return {
    obsId: 'uuid-1',
    species: { taxonName: 'Tjeld' },
    count: 3,
    placeName: 'Herdla fyr',
    ...overrides,
  };
}

describe('diffObservasjoner', () => {
  it('gir tomt resultat når begge lister er tomme', () => {
    expect(diffObservasjoner([], [])).toEqual({ upserts: [], deletes: [] });
  });

  it('gir tomt resultat når nåværende og bekreftet er identiske', () => {
    const bekreftet = [obs()];
    const naavarende = [obs()];
    expect(diffObservasjoner(naavarende, bekreftet)).toEqual({ upserts: [], deletes: [] });
  });

  it('en ny observasjon (ikke i bekreftet) blir en upsert', () => {
    const naavarende = [obs()];
    const { upserts, deletes } = diffObservasjoner(naavarende, []);
    expect(deletes).toEqual([]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].id).toBe('uuid-1');
    expect(upserts[0].obs.species.taxonName).toBe('Tjeld');
    // obsId skal ikke være med i selve payloaden som sendes
    expect(upserts[0].obs.obsId).toBeUndefined();
  });

  it('endret antall gir en upsert', () => {
    const bekreftet = [obs({ count: 3 })];
    const naavarende = [obs({ count: 7 })];
    const { upserts } = diffObservasjoner(naavarende, bekreftet);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].obs.count).toBe(7);
  });

  it('kun endring i photo gir INGEN upsert', () => {
    const bekreftet = [obs()];
    const naavarende = [obs({ photo: 'data:image/jpeg;base64,xyz' })];
    expect(diffObservasjoner(naavarende, bekreftet)).toEqual({ upserts: [], deletes: [] });
  });

  it('kun endring i sentTs gir INGEN upsert', () => {
    const bekreftet = [obs()];
    const naavarende = [obs({ sentTs: '2026-08-31T10:00:00Z' })];
    expect(diffObservasjoner(naavarende, bekreftet)).toEqual({ upserts: [], deletes: [] });
  });

  it('kun endring i position gir INGEN upsert', () => {
    const bekreftet = [obs()];
    const naavarende = [obs({ position: { lat: 60.5, lon: 5.0 } })];
    expect(diffObservasjoner(naavarende, bekreftet)).toEqual({ upserts: [], deletes: [] });
  });

  it('en fjernet observasjon gir en delete', () => {
    const bekreftet = [obs({ obsId: 'uuid-1' }), obs({ obsId: 'uuid-2' })];
    const naavarende = [obs({ obsId: 'uuid-1' })];
    const { upserts, deletes } = diffObservasjoner(naavarende, bekreftet);
    expect(upserts).toEqual([]);
    expect(deletes).toEqual(['uuid-2']);
  });

  it('håndterer samtidig upsert og delete', () => {
    const bekreftet = [obs({ obsId: 'uuid-1', count: 1 }), obs({ obsId: 'uuid-2' })];
    const naavarende = [obs({ obsId: 'uuid-1', count: 9 }), obs({ obsId: 'uuid-3' })];
    const { upserts, deletes } = diffObservasjoner(naavarende, bekreftet);
    expect(deletes).toEqual(['uuid-2']);
    expect(upserts.map((u) => u.id).sort()).toEqual(['uuid-1', 'uuid-3']);
  });

  it('hopper defensivt over observasjoner uten obsId', () => {
    const naavarende = [{ species: { taxonName: 'Uten id' }, count: 1 }];
    expect(diffObservasjoner(naavarende, [])).toEqual({ upserts: [], deletes: [] });
  });

  it('tomme lister for både nåværende og bekreftet-parametre håndteres (null/undefined)', () => {
    expect(diffObservasjoner(null, undefined)).toEqual({ upserts: [], deletes: [] });
  });
});

describe('utforSynk (via lagreSpeilOgSynk/synk) — regresjon: perpetuell synk-løkke', () => {
  // Denne testen dekker et reelt produksjonsfunn: rate-limit-treff hvert
  // 12. sekund i takt med pollingen, fordi en nettopp bekreftet rad ble
  // værende med sin gamle, lokale form (manglende felt serveren fyller inn,
  // f.eks. tomt kommentarfelt) og dermed så "endret" ut for alltid.
  it('en observasjon uten kommentarfelt slutter å bli sendt på nytt etter server har bekreftet den', async () => {
    aktiverFellestur('ABC123');

    const lokalObs = {
      obsId: 'uuid-1',
      species: { taxonName: 'Tjeld', taxonId: null, scientificNameHtml: null },
      count: 3,
      activity: 'Rastende',
      placeName: 'Herdla fyr',
      placeId: null,
      visitId: 'v1',
      visitLocked: false,
      timestamp: '2026-08-31T10:00:00.000Z',
      tilKlokkeslett: null,
      age: '',
      gender: '',
      coObservers: [],
      // Ingen 'comment'-felt her — akkurat slik commitObservation() faktisk
      // bygger objektet (feltet settes aldri ved vanlig registrering).
    };

    // Serversvaret normaliserer manglende felt (comment: '') — akkurat som
    // den ekte sanitize_observasjon() i fellestur_store.py gjør.
    const { obsId, ...utenObsId } = lokalObs;
    const serverRad = { id: 'uuid-1', registrert_av: '', created_ts: 1, updated_ts: 1, ...utenObsId, comment: '' };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, observasjoner: [serverRad], medobservatorer: [] }),
    });

    const lagretOk = lagreSpeilOgSynk([lokalObs]);
    expect(lagretOk).toBe(true);

    await ventPaaMikrotasks();
    await ventPaaMikrotasks();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Uten fiksen ville denne andre runden (f.eks. utløst av neste poll)
    // fortsatt funnet en "endring" og kalt fetch på nytt — det var nettopp
    // dette som ga et 429-treff hvert 12. sekund i produksjon.
    await synk();
    await ventPaaMikrotasks();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('oppdaterSpeilFraServer — regresjon: treg poll skal ikke fjerne nyere lokale data', () => {
  // Reelt produksjonsfunn: en observasjon lagt til rett etter sideinnlasting
  // forsvant igjen etter noen sekunder. Årsak: pollFellestur() sin GET (fyrt
  // av umiddelbart ved sideinnlasting) var fortsatt underveis da synken for
  // den nyregistrerte observasjonen rakk å fullføre først. Da den trege GET-en
  // til slutt svarte — med en liste fra FØR observasjonen fantes — overskrev
  // den speilet og observasjonen ble borte igjen.
  it('dropper et poll-svar som ble hentet før en observasjon som siden er bekreftet av en synk', async () => {
    aktiverFellestur('ABC123');

    // versjonen slik den var idet (den trege) GET-en ble sendt.
    const versjonVedStart = hentSpeilVersjon();

    const nyObs = obs({ obsId: 'uuid-ny' });
    const { obsId, ...utenObsId } = nyObs;
    const serverRad = { id: 'uuid-ny', registrert_av: '', created_ts: 1, updated_ts: 1, ...utenObsId };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, observasjoner: [serverRad], medobservatorer: [] }),
    });

    // Synken for den nye observasjonen rekker å fullføre FØR den trege GET-en
    // svarer — speilet skrives til, og versjonen bumpes forbi versjonVedStart.
    lagreSpeilOgSynk([nyObs]);
    await ventPaaMikrotasks();
    await ventPaaMikrotasks();
    expect(lastSpeil().map((o) => o.obsId)).toEqual(['uuid-ny']);

    // Den trege GET-en svarer nå — men med data fra FØR observasjonen fantes.
    const resultat = oppdaterSpeilFraServer({ observasjoner: [], medobservatorer: [] }, versjonVedStart);

    expect(resultat.map((o) => o.obsId)).toEqual(['uuid-ny']);
    expect(lastSpeil().map((o) => o.obsId)).toEqual(['uuid-ny']);
  });

  it('anvender poll-svaret normalt når ingenting er skrevet til speilet siden GET-en startet', () => {
    aktiverFellestur('ABC123');
    const versjonVedStart = hentSpeilVersjon();

    const serverRad = { id: 'uuid-1', registrert_av: '', created_ts: 1, updated_ts: 1, ...obs() };
    const resultat = oppdaterSpeilFraServer({ observasjoner: [serverRad], medobservatorer: [] }, versjonVedStart);

    expect(resultat.map((o) => o.obsId)).toEqual(['uuid-1']);
  });
});
