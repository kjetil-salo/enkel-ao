import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  formatAreaId,
  getNetworkMode,
  setNetworkMode,
  cycleNetworkMode,
  isOnlineMode,
  isHybridMode,
  isOfflineMode,
  setOfflineMode,
  saveOfflineAreaLocations,
  saveOpportunisticOfflineLocations,
  getAllOfflineLocations,
  getOfflineLocationsInBounds,
  getOfflineLocationsNear,
  fetchLocationsWithNetworkMode,
  getOfflineAreas,
  getOfflineStorageStats,
  syncOfflineAreas,
  clearOfflineDatabase,
  clearAllOfflineData,
  clearAppCachesPreservingMapTiles,
  MAP_TILE_CACHE_NAME,
  NETWORK_MODE_CACHE_URL,
} from '../../public/js/offline-db.js';
import { handleDirectSend } from '../../public/js/export-operations.js';

describe('offline-db (persistent lagring av nedlastede kartområder og 3-veis nettverksmodus)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearOfflineDatabase();
  });

  it('veksler mellom Online- og Offline-modus og lagrer tilstanden persistent', () => {
    // Første oppstart: standardmodus er hybrid
    expect(isOfflineMode()).toBe(false);
    expect(getNetworkMode()).toBe('hybrid');

    let eventPayload = null;
    window.addEventListener(
      'offline_mode_changed',
      (e) => {
        eventPayload = e.detail;
      },
      { once: true },
    );

    setOfflineMode(true);
    expect(isOfflineMode()).toBe(true);
    expect(getNetworkMode()).toBe('offline');
    expect(eventPayload).toEqual({ offline: true, mode: 'offline' });

    setOfflineMode(false);
    expect(isOfflineMode()).toBe(false);
    expect(getNetworkMode()).toBe('online');
  });

  it('standardmodus ved første oppstart er hybrid og lagres persistent i localStorage', () => {
    expect(localStorage.getItem('network_mode_v1')).toBeNull();
    expect(getNetworkMode()).toBe('hybrid');
    expect(localStorage.getItem('network_mode_v1')).toBe('hybrid');
  });

  it('valgt modus overlever «sidebytte» (ny lesing fra localStorage) og er ikke avhengig av minnetilstand', () => {
    setNetworkMode('offline');
    expect(getNetworkMode()).toBe('offline');
    setNetworkMode('online');
    expect(getNetworkMode()).toBe('online');
    expect(localStorage.getItem('network_mode_v1')).toBe('online');
  });

  it('rullerer gjennom 3-veis nettverksmodus (online -> hybrid -> offline -> online)', () => {
    setNetworkMode('online');
    expect(getNetworkMode()).toBe('online');
    expect(isOnlineMode()).toBe(true);
    expect(isHybridMode()).toBe(false);
    expect(isOfflineMode()).toBe(false);

    const events = [];
    const onModeChange = (e) => events.push(e.detail.mode);
    window.addEventListener('network_mode_changed', onModeChange);

    expect(cycleNetworkMode()).toBe('hybrid');
    expect(getNetworkMode()).toBe('hybrid');
    expect(isHybridMode()).toBe(true);
    expect(isOfflineMode()).toBe(false);

    expect(cycleNetworkMode()).toBe('offline');
    expect(getNetworkMode()).toBe('offline');
    expect(isOfflineMode()).toBe(true);
    expect(isHybridMode()).toBe(false);

    expect(cycleNetworkMode()).toBe('online');
    expect(getNetworkMode()).toBe('online');
    expect(isOnlineMode()).toBe(true);

    window.removeEventListener('network_mode_changed', onModeChange);
    expect(events).toEqual(['hybrid', 'offline', 'online']);
  });

  it('lagrer offentlige og private lokaliteter merket med boundingBox-ID og koordinater', async () => {
    const bounds = {
      north: 59.81,
      south: 59.77,
      east: 5.2,
      west: 5.14,
    };
    const sampleSites = [
      { id: 101, name: 'Svortland våtmark', lat: 59.7928, lon: 5.1723, raw: { isPrivate: false } },
      { id: 102, name: 'Privat hage Bømlo', lat: 59.795, lon: 5.175, isMine: true, raw: { isPrivate: true } },
    ];

    const result = await saveOfflineAreaLocations(bounds, sampleSites);
    expect(result.areaId).toBe(formatAreaId(bounds));
    expect(result.publicCount).toBe(1);
    expect(result.privateCount).toBe(1);
    expect(result.savedCount).toBe(2);

    const storedLocations = await getAllOfflineLocations();
    expect(storedLocations).toHaveLength(2);
    expect(storedLocations[0].areaId).toBe(formatAreaId(bounds));
    expect(storedLocations[0].boundingBox).toEqual(bounds);

    const areas = await getOfflineAreas();
    expect(areas).toHaveLength(1);
    expect(areas[0].areaId).toBe(formatAreaId(bounds));
    expect(areas[0].publicCount).toBe(1);
    expect(areas[0].privateCount).toBe(1);
  });

  it('filtrerer lagrede offline-lokaliteter innenfor gitt bounding box', async () => {
    const bounds = {
      north: 59.85,
      south: 59.75,
      east: 5.25,
      west: 5.1,
    };
    await saveOfflineAreaLocations(bounds, [
      { id: 201, name: 'Inni sub-boks', lat: 59.7928, lon: 5.1723 },
      { id: 202, name: 'Utenfor sub-boks', lat: 59.84, lon: 5.24 },
    ]);

    const subBounds = {
      north: 59.8,
      south: 59.78,
      east: 5.19,
      west: 5.15,
    };
    const filtered = await getOfflineLocationsInBounds(subBounds);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(201);
  });

  it('anvender riktig strategi (Network-First, Cache-First, Cache-Only) i fetchLocationsWithNetworkMode', async () => {
    const bounds = { north: 59.82, south: 59.77, east: 5.2, west: 5.14 };
    await saveOfflineAreaLocations(bounds, [
      { id: 301, name: 'Lagret Bømlo-lokalitet', lat: 59.7928, lon: 5.1723 },
    ]);

    const nearCached = await getOfflineLocationsNear(59.7928, 5.1723, 1000);
    expect(nearCached).toHaveLength(1);

    const fetchOnline = vi.fn(async () => [
      { id: 999, name: 'Fersk nettverkslokalitet', lat: 59.7928, lon: 5.1723 },
    ]);
    const ensureTokens = vi.fn(async () => true);

    // 1. Online-modus (Network-First): Henter alltid fra nettverket selv om cachen har data
    setNetworkMode('online');
    const onlineRes = await fetchLocationsWithNetworkMode(59.7928, 5.1723, 1000, {
      fetchOnline,
      ensureTokens,
    });
    expect(onlineRes.source).toBe('network');
    expect(onlineRes.sites.map((s) => s.id)).toEqual([999]);
    expect(fetchOnline).toHaveBeenCalledTimes(1);

    // 2. Hybrid supplerer delvise cachetreff, også innenfor et lagret område
    fetchOnline.mockClear();
    ensureTokens.mockClear();
    setNetworkMode('hybrid');
    const hybridHitRes = await fetchLocationsWithNetworkMode(59.7928, 5.1723, 1000, {
      fetchOnline,
      ensureTokens,
    });
    expect(hybridHitRes.source).toBe('network');
    expect(hybridHitRes.sites.map((s) => s.id)).toEqual([301, 999]);
    expect(fetchOnline).toHaveBeenCalledTimes(1);

    // 3. Uten cachetreff brukes nettverkslisten
    fetchOnline.mockClear();
    const hybridMissRes = await fetchLocationsWithNetworkMode(63.4305, 10.3951, 1000, {
      fetchOnline,
      ensureTokens,
    });
    expect(hybridMissRes.source).toBe('network');
    expect(hybridMissRes.sites.map((s) => s.id)).toEqual([999]);
    expect(fetchOnline).toHaveBeenCalledTimes(1);

    // 4. Streng Offline-modus (Cache-Only): Aldri nettverkskall, selv utenfor område
    fetchOnline.mockClear();
    ensureTokens.mockClear();
    setNetworkMode('offline');
    const offlineRes = await fetchLocationsWithNetworkMode(63.4305, 10.3951, 1000, {
      fetchOnline,
      ensureTokens,
    });
    expect(offlineRes.source).toBe('cache');
    expect(offlineRes.sites.map((s) => s.id)).toEqual([301]);
    expect(fetchOnline).not.toHaveBeenCalled();
    expect(ensureTokens).not.toHaveBeenCalled();
  });

  it('gjør lokaliteter som lastes inn utenom nedlasting av offline-område tilgjengelige offline', async () => {
    setNetworkMode('online');
    const fetchOnline = vi.fn(async () => [
      { id: 701, name: 'Sognsvann', lat: 59.972, lon: 10.731 },
      { id: 702, name: 'Maridalsvannet', lat: 59.985, lon: 10.765 },
    ]);

    const onlineRes = await fetchLocationsWithNetworkMode(59.972, 10.731, 1000, {
      fetchOnline,
      persistOpportunistic: true,
    });
    expect(onlineRes.source).toBe('network');
    expect(onlineRes.sites).toHaveLength(2);

    // Skal IKKE ha opprettet et eksplisitt offline-område (slik at sync ikke laster ned fliser for tilfeldig bruk)
    const areas = await getOfflineAreas();
    expect(areas).toHaveLength(0);

    // Men lokalitetene skal være tilgjengelige i både Hybrid- og Offline-modus
    setNetworkMode('offline');
    const offlineRes = await fetchLocationsWithNetworkMode(59.972, 10.731, 1000, {
      fetchOnline,
    });
    expect(offlineRes.source).toBe('cache');
    expect(offlineRes.sites.map((s) => s.id)).toEqual([701, 702]);
  });

  it('synkroniserer lagrede offline-områder (både lokaliteter og kartfliser) og beregner lagringsstatistikk', async () => {
    const bounds = { north: 59.8, south: 59.78, east: 5.19, west: 5.15 };
    await saveOfflineAreaLocations(bounds, [
      { id: 10, name: 'Opprinnelig lokalitet', lat: 59.79, lon: 5.17, isPrivate: false },
    ]);

    const storedTiles = new Map();
    // Legg også inn den interne nettverksmodus-nøkkelen for å sjekke at den ikke telles som en kartflis
    storedTiles.set(NETWORK_MODE_CACHE_URL, { ok: true });

    const mockCache = {
      match: vi.fn(async (url) => storedTiles.get(url) || undefined),
      put: vi.fn(async (url, resp) => {
        storedTiles.set(url, resp);
      }),
      keys: vi.fn(async () => Array.from(storedTiles.keys()).map((url) => ({ url }))),
    };
    const mockCacheStorage = {
      open: vi.fn(async () => mockCache),
      delete: vi.fn(async () => {
        storedTiles.clear();
        return true;
      }),
    };

    const updatedApiSites = [
      { id: 10, name: 'Opprinnelig lokalitet', lat: 59.79, lon: 5.17, isPrivate: false },
      { id: 11, name: 'Ny offentlig lokalitet', lat: 59.792, lon: 5.172, isPrivate: false },
      { id: 12, name: 'Andres private', lat: 59.793, lon: 5.173, isPrivate: true, isMine: false },
    ];
    const ownPrivate = [
      { id: 13, name: 'Min nye private lokalitet', lat: 59.794, lon: 5.174 },
    ];

    const progressUpdates = [];
    const summary = await syncOfflineAreas({
      fetchSitesByBounds: vi.fn(async () => updatedApiSites),
      checkLoggedIn: () => true,
      ensureTokens: async () => true,
      getShowOthersPrivate: () => false,
      getPrivateSitesCache: () => ownPrivate,
      cacheStorage: mockCacheStorage,
      fetchTileFn: vi.fn(async (url) => ({
        ok: true,
        status: 200,
        url,
        clone() {
          return { ...this };
        },
      })),
      onProgress: (info) => progressUpdates.push(info),
    });

    expect(summary.syncedAreas).toBe(1);
    expect(summary.totalLocations).toBe(3); // 10, 11 og 13 (ikke 12 som er andres private)
    expect(summary.totalTilesCached).toBeGreaterThan(0);
    expect(progressUpdates.some((p) => p.phase === 'locations')).toBe(true);
    expect(progressUpdates.some((p) => p.phase === 'tiles')).toBe(true);

    const stats = await getOfflineStorageStats({ cacheStorage: mockCacheStorage });
    expect(stats.areasCount).toBe(1);
    expect(stats.locationsCount).toBe(3);
    expect(stats.tilesCount).toBe(summary.totalTilesCached);

    // Slett alle offline-data (IndexedDB + Cache API)
    const clearRes = await clearAllOfflineData({ cacheStorage: mockCacheStorage });
    expect(clearRes.clearedLocations).toBe(true);
    expect(clearRes.clearedTiles).toBe(true);

    const statsAfterClear = await getOfflineStorageStats({ cacheStorage: mockCacheStorage });
    expect(statsAfterClear.areasCount).toBe(0);
    expect(statsAfterClear.locationsCount).toBe(0);
    expect(statsAfterClear.tilesCount).toBe(0);
  });

  it('bevarer nedlastede kartfliser ved app-oppdatering (clearAppCachesPreservingMapTiles)', async () => {
    const activeCaches = new Set(['workbox-precache-v1', 'app-shell-v2', MAP_TILE_CACHE_NAME]);
    const mockCacheStorage = {
      keys: vi.fn(async () => Array.from(activeCaches)),
      delete: vi.fn(async (key) => activeCaches.delete(key)),
    };

    const deleted = await clearAppCachesPreservingMapTiles(mockCacheStorage);
    expect(deleted).toEqual(['workbox-precache-v1', 'app-shell-v2']);
    expect(activeCaches.has(MAP_TILE_CACHE_NAME)).toBe(true);
    expect(activeCaches.size).toBe(1);
  });

  it('spør brukeren om tillatelse før nettverk brukes til innsending i streng Offline-modus', async () => {
    localStorage.setItem('ao_username', 'test@example.com');
    localStorage.setItem('ao_password', 'secret');
    setNetworkMode('offline');

    const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({ success: false }),
    });

    const dom = {
      aoDirectBtn: document.createElement('button'),
      aoDirectStatus: document.createElement('div'),
      aoDirectAutoClear: document.createElement('input'),
    };
    const callbacks = {
      doRenderObservations: vi.fn(),
      saveState: vi.fn(),
    };
    const obs = [{ species: { taxonName: 'Kjøttmeis' }, count: '2', timestamp: new Date(Date.now() - 60000).toISOString() }];

    // Start innsending i Offline-modus — skal vise bekreftelsesdialog før fetch kalles
    const sendPromise = handleDirectSend(obs, dom, callbacks);
    const modal = document.getElementById('offline-send-confirm-modal');
    expect(modal).not.toBeNull();
    expect(modal.textContent).toContain('Offline-modus');
    expect(modal.textContent).toContain('mobildatakostnader');
    expect(globalFetchSpy).not.toHaveBeenCalled();

    // Klikk Avbryt -> ingen nettverkskall skal utføres
    modal.querySelector('#offline-send-avbryt').click();
    await sendPromise;
    expect(globalFetchSpy).not.toHaveBeenCalled();

    // Start innsending på nytt og klikk «Tillat nettverk og send inn»
    const sendAllowedPromise = handleDirectSend(obs, dom, callbacks);
    const modal2 = document.getElementById('offline-send-confirm-modal');
    expect(modal2).not.toBeNull();
    modal2.querySelector('#offline-send-tillat').click();
    await sendAllowedPromise;

    // Skal ha utført fetch med X-Allow-Offline-Network: 1
    expect(globalFetchSpy).toHaveBeenCalled();
    const [calledUrl, calledOptions] = globalFetchSpy.mock.calls[0];
    expect(calledUrl).toBe('/api/ao-login');
    expect(calledOptions.headers['X-Allow-Offline-Network']).toBe('1');

    globalFetchSpy.mockRestore();
  });
});


describe('andres private lokaliteter og offline-nedlasting', () => {
  const bounds = { north: 59.81, south: 59.77, east: 5.2, west: 5.14 };
  const sites = [
    { id: 1, name: 'Offentlig', lat: 59.79, lon: 5.17, isPrivate: false },
    { id: 2, name: 'Min private', lat: 59.791, lon: 5.171, isPrivate: true, isMine: true },
    { id: 3, name: 'Andres private', lat: 59.792, lon: 5.172, isPrivate: true, isMine: false },
  ];

  beforeEach(async () => {
    localStorage.clear();
    await clearOfflineDatabase();
  });

  it('saveOfflineAreaLocations lagrer ikke andres private når innstillingen er av', async () => {
    const result = await saveOfflineAreaLocations(bounds, sites);
    expect(result.savedCount).toBe(2);
    const stored = await getAllOfflineLocations();
    expect(stored.map((s) => s.id).sort()).toEqual([1, 2]);
  });

  it('saveOfflineAreaLocations lagrer andres private når «Vis andres private» er på', async () => {
    localStorage.setItem('showPrivateSitesOnMap', '1');
    const result = await saveOfflineAreaLocations(bounds, sites);
    expect(result.savedCount).toBe(3);
  });

  it('saveOpportunisticOfflineLocations lagrer ikke andres private når innstillingen er av', async () => {
    await saveOpportunisticOfflineLocations(sites);
    const stored = await getAllOfflineLocations();
    expect(stored.map((s) => s.id).sort()).toEqual([1, 2]);
  });

  it('tidligere lagrede private fra andre skjules når innstillingen slås av', async () => {
    localStorage.setItem('showPrivateSitesOnMap', '1');
    await saveOfflineAreaLocations(bounds, sites);
    expect(await getAllOfflineLocations()).toHaveLength(3);

    localStorage.setItem('showPrivateSitesOnMap', '0');
    const visible = await getAllOfflineLocations();
    expect(visible.map((s) => s.id).sort()).toEqual([1, 2]);
  });

  it('syncOfflineAreas bruker Kartverket Topo som standard flismal (ingen ubrukt {s})', async () => {
    await saveOfflineAreaLocations(bounds, [sites[0]]);
    const requestedUrls = [];
    const cacheStorage = {
      open: vi.fn(async () => ({ match: async () => undefined, put: async () => {}, keys: async () => [] })),
    };
    await syncOfflineAreas({
      fetchSitesByBounds: vi.fn(async () => []),
      checkLoggedIn: () => false,
      getShowOthersPrivate: () => false,
      cacheStorage,
      fetchTileFn: vi.fn(async (url) => {
        requestedUrls.push(url);
        return { ok: true, status: 200, clone() { return this; } };
      }),
    });
    expect(requestedUrls.length).toBeGreaterThan(0);
    requestedUrls.forEach((u) => {
      expect(u).toContain('cache.kartverket.no');
      expect(u).not.toContain('{');
    });
  });
});

describe('nettverksmodus-knapp (#offline-mode-toggle) flimmerfri hydrering og persistens på tvers av sider', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('index.html har ikke hardkodet is-hybrid eller "🔄 Hybrid" i knappe-HTML før synkron hydrering', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'public/index.html'), 'utf-8');

    const btnMatch = indexHtml.match(/<button[^>]*id="offline-mode-toggle"[^>]*>([\s\S]*?)<\/button>/);
    expect(btnMatch).not.toBeNull();
    const buttonMarkup = btnMatch[0];
    const innerSpanMarkup = btnMatch[1];

    // Knappen skal ikke ha hardkodet is-hybrid-klasse eller "🔄 Hybrid"-tekst som gir flimring før JS kjører
    expect(buttonMarkup).not.toContain('is-hybrid');
    expect(innerSpanMarkup).not.toContain('🔄 Hybrid');
  });

  it('synkront inline-skript i index.html setter standard "hybrid" kun ved første oppstart og bevarer valgt modus ved navigering tilbake', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'public/index.html'), 'utf-8');

    // Hent ut <button id="offline-mode-toggle"> og det påfølgende synkrone <script>-elementet
    const snippetMatch = indexHtml.match(
      /(<button[^>]*id="offline-mode-toggle"[\s\S]*?<\/button>\s*<script>[\s\S]*?<\/script>)/
    );
    expect(snippetMatch).not.toBeNull();

    const mountHeaderToggle = () => {
      document.body.innerHTML = snippetMatch[1];
      const inlineScript = document.body.querySelector('script');
      expect(inlineScript).not.toBeNull();
      // Evaluer det synkrone inline-skriptet slik nettleseren gjør under HTML-parsing før første opptegning
      new Function(inlineScript.textContent)();
      return {
        btn: document.getElementById('offline-mode-toggle'),
        text: document.getElementById('offline-mode-toggle-text'),
      };
    };

    // 1. Første gangs oppstart (tom localStorage): skal falle tilbake til 'hybrid' og lagre det
    expect(localStorage.getItem('network_mode_v1')).toBeNull();
    const firstLaunch = mountHeaderToggle();
    expect(localStorage.getItem('network_mode_v1')).toBe('hybrid');
    expect(firstLaunch.btn.dataset.networkMode).toBe('hybrid');
    expect(firstLaunch.btn.classList.contains('is-hybrid')).toBe(true);
    expect(firstLaunch.text.textContent).toBe('🔄 Hybrid');

    // 2. Bruker bytter til 'online', navigerer til kart/innstillinger og kommer tilbake til rapporteringssiden
    setNetworkMode('online');
    const afterReturnOnline = mountHeaderToggle();
    expect(afterReturnOnline.btn.dataset.networkMode).toBe('online');
    expect(afterReturnOnline.btn.classList.contains('is-online')).toBe(true);
    expect(afterReturnOnline.btn.classList.contains('is-hybrid')).toBe(false);
    expect(afterReturnOnline.text.textContent).toBe('🌐 Online');
    expect(localStorage.getItem('network_mode_v1')).toBe('online');

    // 3. Bruker bytter til 'offline', navigerer bort og kommer tilbake til rapporteringssiden
    setNetworkMode('offline');
    const afterReturnOffline = mountHeaderToggle();
    expect(afterReturnOffline.btn.dataset.networkMode).toBe('offline');
    expect(afterReturnOffline.btn.classList.contains('is-offline')).toBe(true);
    expect(afterReturnOffline.btn.classList.contains('is-hybrid')).toBe(false);
    expect(afterReturnOffline.text.textContent).toBe('📴 Offline');
    expect(localStorage.getItem('network_mode_v1')).toBe('offline');
  });

  it('sw.js bruker eksakt samme NETWORK_MODE_CACHE_URL som offline-db.js og støtter bypass-header', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const swSource = fs.readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf-8');

    expect(swSource).toContain(`const NETWORK_MODE_CACHE_URL = '${NETWORK_MODE_CACHE_URL}';`);
    expect(swSource).toContain("request.headers.get('x-allow-offline-network') === '1'");
  });
});

describe('deaktivering av Fellestur, Tidligere sendt og Mine delinger i offline-modus', () => {
  let uiModule;
  let mainModule;

  beforeEach(async () => {
    localStorage.clear();
    document.body.innerHTML = '';
    uiModule = await import('../../public/js/ui.js');
    mainModule = await import('../../public/js/main.js');
  });

  it('showOfflineNotAvailableDialog viser modal med tittel "Ikke tilgjengelig i offline-modus!" og OK-knapp', () => {
    const modal = uiModule.showOfflineNotAvailableDialog();
    expect(modal).not.toBeNull();
    expect(document.getElementById('offline-not-available-modal')).toBe(modal);
    expect(modal.textContent).toContain('Ikke tilgjengelig i offline-modus!');
    const okBtn = modal.querySelector('#offline-modal-ok-btn');
    expect(okBtn).not.toBeNull();
    okBtn.click();
    expect(document.getElementById('offline-not-available-modal')).toBeNull();
  });

  it('deaktiverer Fellestur, Tidligere sendt og Mine delinger når appen er i offline-modus og aktiverer dem i online/hybrid', () => {
    document.body.innerHTML = `
      <button id="offline-mode-toggle"><span id="offline-mode-toggle-text"></span></button>
      <a href="/fellestur.html" id="fellestur-header-btn">Fellestur</a>
      <a href="/sendt.html" id="tidligere-sendt-link">Tidligere sendt</a>
      <a href="/mine-delinger.html" id="mine-delinger-link">Mine delinger</a>
    `;

    const fellestur = document.getElementById('fellestur-header-btn');
    const sendt = document.getElementById('tidligere-sendt-link');
    const delinger = document.getElementById('mine-delinger-link');

    // 1. Online-modus: knappene er ikke deaktivert
    setNetworkMode('online');
    mainModule.updateOfflineModeUI();
    expect(fellestur.classList.contains('is-offline-disabled')).toBe(false);
    expect(sendt.classList.contains('is-offline-disabled')).toBe(false);
    expect(delinger.classList.contains('is-offline-disabled')).toBe(false);
    expect(fellestur.getAttribute('aria-disabled')).toBe('false');

    // 2. Offline-modus: knappene blir merket med is-offline-disabled og aria-disabled="true"
    setNetworkMode('offline');
    mainModule.updateOfflineModeUI();
    expect(fellestur.classList.contains('is-offline-disabled')).toBe(true);
    expect(sendt.classList.contains('is-offline-disabled')).toBe(true);
    expect(delinger.classList.contains('is-offline-disabled')).toBe(true);
    expect(fellestur.getAttribute('aria-disabled')).toBe('true');
    expect(sendt.getAttribute('aria-disabled')).toBe('true');
    expect(delinger.getAttribute('aria-disabled')).toBe('true');
    expect(fellestur.title).toContain('Ikke tilgjengelig i offline-modus!');

    // 3. Hybrid-modus: knappene er igjen aktive
    setNetworkMode('hybrid');
    mainModule.updateOfflineModeUI();
    expect(fellestur.classList.contains('is-offline-disabled')).toBe(false);
    expect(sendt.classList.contains('is-offline-disabled')).toBe(false);
    expect(delinger.classList.contains('is-offline-disabled')).toBe(false);
    expect(fellestur.getAttribute('aria-disabled')).toBe('false');
  });

  it('hindrer navigering og åpner dialog ved klikk på knappene når appen er i offline-modus', () => {
    document.body.innerHTML = `
      <button id="offline-mode-toggle"><span id="offline-mode-toggle-text"></span></button>
      <a href="/fellestur.html" id="fellestur-header-btn">Fellestur</a>
      <a href="/sendt.html" id="tidligere-sendt-link">Tidligere sendt</a>
      <a href="/mine-delinger.html" id="mine-delinger-link">Mine delinger</a>
    `;

    // Kall DOMContentLoaded-oppsettet eller fest lyttere
    const fellestur = document.getElementById('fellestur-header-btn');
    const sendt = document.getElementById('tidligere-sendt-link');
    const delinger = document.getElementById('mine-delinger-link');

    // Simuler event listenerene fra main.js
    const setupInterceptors = (el, navn) => {
      el.addEventListener('click', (e) => {
        if (isOfflineMode()) {
          e.preventDefault();
          e.stopPropagation();
          uiModule.showOfflineNotAvailableDialog(
            'Ikke tilgjengelig i offline-modus!',
            `${navn} krever nettverkstilkobling og kan ikke åpnes mens du er i offline-modus.`
          );
        }
      });
    };
    setupInterceptors(fellestur, 'Fellestur');
    setupInterceptors(sendt, 'Tidligere sendt');
    setupInterceptors(delinger, 'Mine delinger');

    // Sett offline-modus
    setNetworkMode('offline');

    // Klikk på Fellestur
    fellestur.click();
    let modal = document.getElementById('offline-not-available-modal');
    expect(modal).not.toBeNull();
    expect(modal.textContent).toContain('Ikke tilgjengelig i offline-modus!');
    expect(modal.textContent).toContain('Fellestur');
    modal.querySelector('#offline-modal-ok-btn').click();
    expect(document.getElementById('offline-not-available-modal')).toBeNull();

    // Klikk på Tidligere sendt
    sendt.click();
    modal = document.getElementById('offline-not-available-modal');
    expect(modal).not.toBeNull();
    expect(modal.textContent).toContain('Tidligere sendt');
    modal.querySelector('#offline-modal-ok-btn').click();

    // Klikk på Mine delinger
    delinger.click();
    modal = document.getElementById('offline-not-available-modal');
    expect(modal).not.toBeNull();
    expect(modal.textContent).toContain('Mine delinger');
    modal.querySelector('#offline-modal-ok-btn').click();
  });
});


describe('hybrid med delvis lokalitetscache', () => {
  beforeEach(async () => { localStorage.clear(); await clearOfflineDatabase(); });

  it('supplerer ved utvidet radius og oppdaterer cachede lokaliteter uten duplikater', async () => {
    await saveOpportunisticOfflineLocations([{ id: 1, name: 'Gammelt navn', lat: 60, lon: 5 }]);
    const fetchOnline = vi.fn(async () => [
      { id: '1', name: 'Nytt navn', lat: 60, lon: 5 },
      { id: 2, name: 'Lenger unna', lat: 60.01, lon: 5 },
    ]);
    const result = await fetchLocationsWithNetworkMode(60, 5, 2000, { mode: 'hybrid', fetchOnline });
    expect(fetchOnline).toHaveBeenCalledWith(60, 5, 2000);
    expect(result.sites.map(s => s.name)).toEqual(['Nytt navn', 'Lenger unna']);
  });

  it('bevarer lokale treff ved feil eller degradert tomt svar fra backend', async () => {
    await saveOpportunisticOfflineLocations([{ id: 1, name: 'Lokalt', lat: 60, lon: 5 }]);
    for (const fetchOnline of [async () => { throw new Error('uten nett'); }, async () => []]) {
      const result = await fetchLocationsWithNetworkMode(60, 5, 2000, { mode: 'hybrid', fetchOnline });
      expect(result.source).toBe('cache');
      expect(result.sites.map(s => s.id)).toEqual([1]);
    }
  });

  it('sletter ikke lagrede lokaliteter når gjensynk gir et delvis ikke-tomt svar', async () => {
    const bounds = { north: 60.02, south: 59.98, east: 5.02, west: 4.98 };
    const sites = [
      { id: 1, name: 'A', lat: 60, lon: 5 },
      { id: 2, name: 'B', lat: 60.001, lon: 5 },
    ];
    await saveOfflineAreaLocations(bounds, sites);
    await syncOfflineAreas({
      fetchSitesByBounds: async () => [{ ...sites[0], name: 'A oppdatert' }],
      cacheStorage: { open: async () => ({ match: async () => ({}) }) },
    });
    expect((await getAllOfflineLocations()).map(s => s.name)).toEqual(['A oppdatert', 'B']);
  });
});
