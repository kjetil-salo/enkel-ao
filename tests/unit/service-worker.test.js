import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { setNetworkMode, syncNetworkModeToServiceWorker } from '../../public/js/offline-db.js';
import { handleDirectSend } from '../../public/js/export-operations.js';

const source = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');
let cachesMock;
function worker(fetchMock = vi.fn()) {
  const handlers = {};
  const context = vm.createContext({
    self: { addEventListener: (name, fn) => { handlers[name] = fn; }, location: { origin: 'https://example.test' }, skipWaiting: vi.fn(), clients: { claim: vi.fn() } },
    caches: cachesMock, Response, URL, fetch: fetchMock,
  });
  vm.runInContext(source, context);
  return { context, handlers };
}

beforeEach(() => {
  localStorage.clear();
  const stores = new Map();
  cachesMock = {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        put: async (key, value) => store.set(key.url || key, value.clone()),
        match: async key => store.get(key.url || key)?.clone(),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
  };
  vi.stubGlobal('caches', cachesMock);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('er gyldig JavaScript og installerer appskallet', async () => {
  const { handlers, context } = worker(vi.fn(async () => new Response('ressurs')));
  let installing;
  handlers.install({ waitUntil: promise => { installing = promise; } });
  await installing;
  expect(context.self.skipWaiting).toHaveBeenCalled();
  const cache = await cachesMock.open(vm.runInContext('CACHE_NAME', context));
  expect(await cache.match('/index.html')).toBeDefined();
  expect(await cache.match('/js/offline-db.js')).toBeDefined();
});

it.each(['nettverksbrudd', 'HTTP-feil'])('beholder gammel offline-cache hvis appskallet ikke kan oppdateres: %s', async (scenario) => {
  const oldCache = await cachesMock.open('fugleobs-v194');
  await oldCache.put('/index.html', new Response('gammelt fungerende appskall'));
  const { handlers, context } = worker(vi.fn(async asset => {
    if (asset === '/js/main.js') {
      if (scenario === 'HTTP-feil') return new Response('utilgjengelig', { status: 503 });
      throw new TypeError('Nettverket er brutt');
    }
    return new Response('ny ressurs');
  }));
  let installing;
  handlers.install({ waitUntil: promise => { installing = promise; } });
  await expect(installing).rejects.toThrow('appskallet er ufullstendig');
  expect(context.self.skipWaiting).not.toHaveBeenCalled();
  expect(await cachesMock.keys()).toContain('fugleobs-v194');
  expect(await cachesMock.keys()).not.toContain(vm.runInContext('CACHE_NAME', context));
  expect(await (await oldCache.match('/index.html')).text()).toBe('gammelt fungerende appskall');
});

it('kan oppdatere appskallet selv om en ekstern kartressurs feiler', async () => {
  const { handlers, context } = worker(vi.fn(async asset => {
    if (asset.startsWith('https://')) throw new TypeError('CDN utilgjengelig');
    return new Response('ny ressurs');
  }));
  let installing;
  handlers.install({ waitUntil: promise => { installing = promise; } });
  await installing;
  expect(context.self.skipWaiting).toHaveBeenCalled();
});

it('gjenoppretter valgt offline-modus fra cachen når workeren starter på nytt', async () => {
  await syncNetworkModeToServiceWorker('offline');
  const { context } = worker();
  const response = await context.handleApiFetch(new Request('https://example.test/api/species'));
  expect(response.status).toBe(503);
  expect(context.fetch).not.toHaveBeenCalled();
});

it('tillater bare de to bekreftede POST-kallene, og lar annen trafikk være blokkert', async () => {
  await syncNetworkModeToServiceWorker('offline');
  const fetchMock = vi.fn(async () => new Response('{}'));
  const { context } = worker(fetchMock);
  for (const path of ['/api/ao-login', '/api/ao-import-stream']) {
    expect((await context.handleApiFetch(new Request(`https://example.test${path}`, { method: 'POST', headers: { 'X-Allow-Offline-Network': '1' } }))).status).toBe(200);
  }
  for (const [path, options] of [
    ['/api/ao-login', { method: 'POST' }],
    ['/api/ao-login', { headers: { 'X-Allow-Offline-Network': '1' } }],
    ['/api/ao-import', { method: 'POST', headers: { 'X-Allow-Offline-Network': '1' } }],
  ]) {
    expect((await context.handleApiFetch(new Request(`https://example.test${path}`, options))).status).toBe(503);
  }
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('kan fullføre en bekreftet innsending uten å oppheve offline-modus', async () => {
  vi.useFakeTimers();
  setNetworkMode('offline');
  await syncNetworkModeToServiceWorker('offline');
  localStorage.setItem('ao_username', 'testbruker');
  localStorage.setItem('ao_password', 'testpassord');
  const network = vi.fn(async request => request.url.endsWith('/api/ao-login')
    ? new Response(JSON.stringify({ success: true, loginToken: 'test', authCookie: 'test' }))
    : new Response('data: {"phase":"done","success":true,"count":1}\n\n'));
  const { context } = worker(network);
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, options) => context.handleApiFetch(new Request(`https://example.test${url}`, options)));
  const dom = { aoDirectBtn: document.createElement('button'), aoDirectStatus: document.createElement('div') };
  const callbacks = { doRenderObservations: vi.fn(), saveState: vi.fn() };
  const observations = [{ species: { taxonName: 'Testart' }, timestamp: '2026-01-01T10:00:00' }];
  const sending = handleDirectSend(observations, dom, callbacks);
  expect(network).not.toHaveBeenCalled();
  document.getElementById('offline-send-tillat').click();
  await sending;
  expect(dom.aoDirectStatus.textContent).toContain('1 observasjon sendt til AO');
  expect(observations[0].sentTs).toBeTruthy();
  expect(network).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem('network_mode_v1')).toBe('offline');
});

it('forhåndslagrer hver markørfarge kartet bruker, så de vises offline', () => {
  // Bare forhåndslagrede ressurser overlever en ny versjon: activate sletter alle
  // andre cacher. Manglet en farge her, fikk private (grå) og superlokaliteter
  // (oransje) et brutt ikon offline etter hver oppdatering.
  const mapSource = readFileSync(resolve(__dirname, '../../public/js/map.js'), 'utf8');
  const farger = new Set([
    ...[...mapSource.matchAll(/markerColor = '(\w+)'/g)].map(m => m[1]),
    ...[...mapSource.matchAll(/marker-icon-2x-(\w+)\.png/g)].map(m => m[1]),
  ]);
  expect(farger.size).toBeGreaterThanOrEqual(5);
  for (const farge of farger) {
    expect(source, `marker-icon-2x-${farge}.png mangler i STATIC_ASSETS`).toContain(`marker-icon-2x-${farge}.png'`);
  }
});
