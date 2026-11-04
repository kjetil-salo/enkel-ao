import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, value) => { store[key] = String(value); }),
  removeItem: vi.fn((key) => { delete store[key]; }),
  clear: vi.fn(() => { Object.keys(store).forEach((k) => delete store[k]); }),
};
vi.stubGlobal('localStorage', localStorageMock);

// Mock document.body
if (typeof document !== 'undefined') {
  document.body.className = '';
}

const { _parseSseEvents, handleDirectSend } = await import('../../public/js/export-operations.js');
const { saveAoDirectAutoClear } = await import('../../public/js/storage.js');

describe('SSE Stream Parsing og Error in input stream resiliens', () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('_parseSseEvents', () => {
    it('parser standard data:-linjer med doble linjeskift', () => {
      const text = 'data: {"phase": "importing", "total": 2, "remaining": 1}\n\ndata: {"phase": "done", "success": true, "count": 2}\n\n';
      const events = _parseSseEvents(text);
      expect(events).toHaveLength(2);
      expect(events[0].phase).toBe('importing');
      expect(events[1].phase).toBe('done');
      expect(events[1].count).toBe(2);
    });

    it('parser data:-linje selv om den mangler avsluttende doble linjeskift', () => {
      const text = 'data: {"phase": "done", "success": true, "count": 1}';
      const events = _parseSseEvents(text);
      expect(events).toHaveLength(1);
      expect(events[0].phase).toBe('done');
      expect(events[0].success).toBe(true);
    });

    it('finner done-event fra rå JSON dersom data:-prefiks mangler', () => {
      const text = '{"phase": "done", "success": true, "count": 3}';
      const events = _parseSseEvents(text);
      expect(events).toHaveLength(1);
      expect(events[0].phase).toBe('done');
      expect(events[0].count).toBe(3);
    });

    it('returnerer tom liste for ugyldig eller tom input', () => {
      expect(_parseSseEvents('')).toEqual([]);
      expect(_parseSseEvents(null)).toEqual([]);
      expect(_parseSseEvents('noe urelatert tekst')).toEqual([]);
    });
  });

  describe('handleDirectSend med stream-avbrudd og auto-clear', () => {
    function lagTestDom() {
      const statusEl = {
        style: { cssText: '', display: 'none' },
        textContent: '',
        innerHTML: '',
      };
      const btnEl = { disabled: false };
      const autoClearEl = { checked: true };
      return {
        dom: {
          aoDirectStatus: statusEl,
          aoDirectBtn: btnEl,
          aoDirectAutoClear: autoClearEl,
          aoKoHint: { style: { display: 'none' } },
        },
      };
    }

    it('håndterer TypeError: Error in input stream ved socket-lukking og fullfører vellykket sending', async () => {
      store['ao_username'] = 'testbruker';
      store['ao_password'] = 'hemmelig';
      store['ao_tokens'] = JSON.stringify({ loginToken: 'tok123', authCookie: 'cook123' });
      saveAoDirectAutoClear(true);

      const observations = [
        {
          species: { taxonName: 'Kjøttmeis' },
          count: 2,
          placeName: 'Fana',
          timestamp: '2026-05-10T12:00:00',
        },
      ];

      const { dom } = lagTestDom();
      const callbacks = {
        doRenderObservations: vi.fn(),
        saveState: vi.fn(),
      };

      // Mock fetch:
      // 1. /api/ao-login -> success
      // 2. /api/ao-import-stream -> stream som sender done og kaster "TypeError: Error in input stream"
      const encoder = new TextEncoder();
      let readCount = 0;

      const mockStream = {
        getReader() {
          return {
            async read() {
              readCount++;
              if (readCount === 1) {
                // Første chunk: publishing
                return {
                  done: false,
                  value: encoder.encode('data: {"phase": "publishing", "total": 1}\n\n'),
                };
              }
              if (readCount === 2) {
                // Andre chunk: done uten dobbel newline, deretter lukkes socketen
                return {
                  done: false,
                  value: encoder.encode('data: {"phase": "done", "success": true, "count": 1}'),
                };
              }
              // Tredje kall: socket lukkes fra serveren og kaster "Error in input stream"
              const err = new TypeError('Error in input stream');
              throw err;
            },
            async cancel() {},
          };
        },
      };

      vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (url === '/api/ao-login') {
          return {
            ok: true,
            json: async () => ({ success: true, loginToken: 'tok', authCookie: 'cook' }),
          };
        }
        if (url === '/api/ao-import-stream') {
          return {
            ok: true,
            status: 200,
            body: mockStream,
          };
        }
        return { ok: true, json: async () => ({}) };
      }));

      await handleDirectSend(observations, dom, callbacks);

      // Verifiser at status IKKE er rød feilmelding "❌ Error in input stream"
      expect(dom.aoDirectStatus.textContent).toContain('✅ 1 observasjon sendt til AO!');
      expect(dom.aoDirectStatus.textContent).not.toContain('❌ Error in input stream');

      // Verifiser at observasjonen ble merket med sentTs
      expect(observations[0].sentTs).toBeDefined();

      // Verifiser at callbacks ble kalt
      expect(callbacks.doRenderObservations).toHaveBeenCalled();
      expect(callbacks.saveState).toHaveBeenCalled();

      // Kjør timer for auto-clear
      expect(observations.length).toBe(1);
      vi.advanceTimersByTime(1500);

      // Nå skal listen være tømt automatisk uten prompt
      expect(observations.length).toBe(0);
    });

    it('tømmer listen automatisk når loadAoDirectAutoClear() er aktivert selv om dom-checkbox mangler', async () => {
      store['ao_username'] = 'testbruker';
      store['ao_password'] = 'hemmelig';
      store['ao_tokens'] = JSON.stringify({ loginToken: 'tok123', authCookie: 'cook123' });
      saveAoDirectAutoClear(true);

      const observations = [
        {
          species: { taxonName: 'Gråtrost' },
          count: 1,
          placeName: 'Os',
          timestamp: '2026-05-10T12:00:00',
        },
      ];

      const { dom } = lagTestDom();
      // Simuler at aoDirectAutoClear ikke finnes i dom
      dom.aoDirectAutoClear = null;

      const callbacks = {
        doRenderObservations: vi.fn(),
        saveState: vi.fn(),
      };

      const encoder = new TextEncoder();
      let readCount = 0;
      const mockStream = {
        getReader() {
          return {
            async read() {
              readCount++;
              if (readCount === 1) {
                return {
                  done: false,
                  value: encoder.encode('data: {"phase": "done", "success": true, "count": 1}\n\n'),
                };
              }
              return { done: true, value: undefined };
            },
            async cancel() {},
          };
        },
      };

      vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (url === '/api/ao-login') {
          return {
            ok: true,
            json: async () => ({ success: true, loginToken: 'tok', authCookie: 'cook' }),
          };
        }
        if (url === '/api/ao-import-stream') {
          return {
            ok: true,
            status: 200,
            body: mockStream,
          };
        }
        return { ok: true, json: async () => ({}) };
      }));

      await handleDirectSend(observations, dom, callbacks);

      expect(dom.aoDirectStatus.textContent).toContain('✅ 1 observasjon sendt til AO!');
      expect(observations.length).toBe(1);

      vi.advanceTimersByTime(1500);
      expect(observations.length).toBe(0);
    });

    it('beholder listen dersom auto-clear er av og brukeren avbryter confirm', async () => {
      store['ao_username'] = 'testbruker';
      store['ao_password'] = 'hemmelig';
      store['ao_tokens'] = JSON.stringify({ loginToken: 'tok123', authCookie: 'cook123' });
      saveAoDirectAutoClear(false);

      const observations = [{ species: { taxonName: 'Bokfink' }, count: 1 }];
      const { dom } = lagTestDom();
      dom.aoDirectAutoClear.checked = false;

      const callbacks = { doRenderObservations: vi.fn(), saveState: vi.fn() };
      const encoder = new TextEncoder();
      const mockStream = {
        getReader() {
          return {
            async read() {
              return { done: false, value: encoder.encode('data: {"phase": "done", "success": true, "count": 1}\n\n') };
            },
            async cancel() {},
          };
        },
      };

      vi.stubGlobal('confirm', vi.fn(() => false));
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (url === '/api/ao-login') return { ok: true, json: async () => ({ success: true }) };
        if (url === '/api/ao-import-stream') return { ok: true, status: 200, body: mockStream };
        return { ok: true, json: async () => ({}) };
      }));

      await handleDirectSend(observations, dom, callbacks);
      vi.advanceTimersByTime(1500);

      expect(window.confirm).toHaveBeenCalledWith('Sending vellykket! Vil du tømme observasjonslisten?');
      expect(observations.length).toBe(1);
    });

    it('tømmer listen dersom auto-clear er av og brukeren godkjenner confirm', async () => {
      store['ao_username'] = 'testbruker';
      store['ao_password'] = 'hemmelig';
      store['ao_tokens'] = JSON.stringify({ loginToken: 'tok123', authCookie: 'cook123' });
      saveAoDirectAutoClear(false);

      const observations = [{ species: { taxonName: 'Bokfink' }, count: 1 }];
      const { dom } = lagTestDom();
      dom.aoDirectAutoClear.checked = false;

      const callbacks = { doRenderObservations: vi.fn(), saveState: vi.fn() };
      const encoder = new TextEncoder();
      const mockStream = {
        getReader() {
          return {
            async read() {
              return { done: false, value: encoder.encode('data: {"phase": "done", "success": true, "count": 1}\n\n') };
            },
            async cancel() {},
          };
        },
      };

      vi.stubGlobal('confirm', vi.fn(() => true));
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (url === '/api/ao-login') return { ok: true, json: async () => ({ success: true }) };
        if (url === '/api/ao-import-stream') return { ok: true, status: 200, body: mockStream };
        return { ok: true, json: async () => ({}) };
      }));

      await handleDirectSend(observations, dom, callbacks);
      vi.advanceTimersByTime(1500);

      expect(window.confirm).toHaveBeenCalledWith('Sending vellykket! Vil du tømme observasjonslisten?');
      expect(observations.length).toBe(0);
    });

    it('beholder listen uten sendtmarkering når strømoppstarten feiler før kvittering', async () => {
      store['ao_username'] = 'testbruker';
      store['ao_password'] = 'hemmelig';
      store['ao_tokens'] = JSON.stringify({ loginToken: 'tok123', authCookie: 'cook123' });
      saveAoDirectAutoClear(true);

      const observations = [
        { species: { taxonName: 'Grønnfink' }, count: 1 },
        { species: { taxonName: 'Dompap' }, count: 1 },
        { species: { taxonName: 'Blåmeis' }, count: 1 },
      ];
      const { dom } = lagTestDom();
      dom.aoDirectAutoClear.checked = true;

      const callbacks = { doRenderObservations: vi.fn(), saveState: vi.fn() };

      vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (url === '/api/ao-login') return { ok: true, json: async () => ({ success: true }) };
        if (url === '/api/ao-import-stream') {
          // Simuler at fetch eller stream kaster TypeError: Error in input stream direkte
          throw new TypeError('Error in input stream');
        }
        return { ok: true, json: async () => ({}) };
      }));

      await handleDirectSend(observations, dom, callbacks);

      expect(dom.aoDirectStatus.textContent).toContain('Sendingen kunne ikke bekreftes');
      expect(observations[0].sentTs).toBeUndefined();
      expect(callbacks.saveState).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1500);
      expect(observations.length).toBe(3);
    });

    it.each(['HTTP', 'SSE'])('viser konkret avvisningsgrunn fra serveren: %s', async (scenario) => {
      store['ao_username'] = 'testbruker';
      store['ao_password'] = 'hemmelig';
      const observations = [{ species: { taxonName: 'Kjøttmeis' }, count: 1 }];
      const { dom } = lagTestDom();
      const callbacks = { doRenderObservations: vi.fn(), saveState: vi.fn() };
      const error = 'Lokaliteten mangler';
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (url === '/api/ao-login') return { ok: true, json: async () => ({ success: true }) };
        if (scenario === 'HTTP') return { ok: false, json: async () => ({ error }) };
        return { ok: true, body: { text: true }, text: async () => `data: ${JSON.stringify({ phase: 'error', error })}\n\n` };
      }));
      await handleDirectSend(observations, dom, callbacks);
      expect(dom.aoDirectStatus.textContent).toBe(`❌ ${error}`);
      expect(observations[0].sentTs).toBeUndefined();
      expect(callbacks.saveState).not.toHaveBeenCalled();
    });

    it.each(['tomt svar', 'bare fremdrift', 'avkortet done', 'vanlig EOF', 'avkortet EOF', 'generisk leseavbrudd'])('beholder observasjoner uten gyldig kvittering: %s', async (scenario) => {
      store['ao_username'] = 'testbruker';
      store['ao_password'] = 'hemmelig';
      saveAoDirectAutoClear(true);
      const observations = [{ species: { taxonName: 'Kjøttmeis' }, count: 1 }];
      const { dom } = lagTestDom();
      const callbacks = { doRenderObservations: vi.fn(), saveState: vi.fn() };
      let reads = 0;
      const text = ['bare fremdrift', 'vanlig EOF', 'generisk leseavbrudd'].includes(scenario)
        ? 'data: {"phase":"publishing","total":1}\n\n'
        : 'data: {"phase":"done","success":true,"count":1';
      const body = scenario === 'tomt svar' ? null : {
        getReader: () => ({
          read: async () => {
            if (++reads === 1) return { done: false, value: new TextEncoder().encode(text) };
            if (scenario.endsWith('EOF')) return { done: true };
            throw new TypeError(scenario === 'generisk leseavbrudd' ? 'Network connection lost' : 'Error in input stream');
          },
          cancel: async () => {},
        }),
      };
      vi.stubGlobal('fetch', vi.fn(async (url) => url === '/api/ao-login'
        ? { ok: true, json: async () => ({ success: true }) }
        : { ok: true, status: scenario === 'tomt svar' ? 204 : 200, body }));
      await handleDirectSend(observations, dom, callbacks);
      expect(dom.aoDirectStatus.textContent).toContain('Sendingen kunne ikke bekreftes');
      expect(dom.aoDirectStatus.textContent).toContain('Kontroller funnene hos Artsobservasjoner før du prøver på nytt');
      expect(observations[0].sentTs).toBeUndefined();
      expect(callbacks.saveState).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1500);
      expect(observations).toHaveLength(1);
    });
  });
});
