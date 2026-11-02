import { describe, it, expect, vi } from 'vitest';
import {
  MAX_OFFLINE_AREA_SIDE_M,
  MIN_OFFLINE_AREA_SIDE_M,
  DEFAULT_OFFLINE_AREA_SIDE_M,
  MAX_MAP_EXTENT_SIDE_M,
  MAX_VIEWPORT_FETCH_SIDE_M,
  MAX_DYNAMIC_FETCH_BOX_SIDE_M,
  MIN_TILE_ZOOM,
  MAX_TILE_ZOOM,
  MAX_TILE_BATCH_SIZE,
  MAP_TILE_CACHE_NAME,
  calculateTilesForBounds,
  computeDynamicFetchBounds,
  createCenteredBounds,
  createExtentBounds,
  downloadTilesInBatches,
  fetchDynamicViewportSites,
  filterSitesForOfflineDownload,
  filterSitesInBounds,
  formatKartverketTileUrl,
  getBoundsDimensionsMeters,
  latLonToTileXY,
  moveBoundsToCenter,
  resizeBoundsFromCorner,
} from '../../public/js/offline-area.js';

describe('offline-area bounding box helpers', () => {
  it('oppretter 10 × 10 km utstrekningsboks for maks kartutsnitt', () => {
    const bounds = createExtentBounds(59.7928, 5.1723, MAX_MAP_EXTENT_SIDE_M);
    const { widthM, heightM } = getBoundsDimensionsMeters(bounds);

    expect(Math.round(widthM)).toBeCloseTo(10000, -1);
    expect(Math.round(heightM)).toBeCloseTo(10000, -1);
  });

  it('oppretter sentrert boks med standard 2,5 × 2,5 km dimensjoner', () => {
    const bounds = createCenteredBounds(60.393, 5.323);
    const { widthM, heightM } = getBoundsDimensionsMeters(bounds);

    expect(bounds.north).toBeGreaterThan(60.393);
    expect(bounds.south).toBeLessThan(60.393);
    expect(bounds.east).toBeGreaterThan(5.323);
    expect(bounds.west).toBeLessThan(5.323);
    expect(Math.round(widthM)).toBeCloseTo(DEFAULT_OFFLINE_AREA_SIDE_M, -1);
    expect(Math.round(heightM)).toBeCloseTo(DEFAULT_OFFLINE_AREA_SIDE_M, -1);
  });

  it('begrenser (clamper) størrelse ved opprettelse til maks 10 × 10 km', () => {
    const bounds = createCenteredBounds(60.393, 5.323, 15000, 14000);
    const { widthM, heightM } = getBoundsDimensionsMeters(bounds);

    expect(widthM).toBeLessThanOrEqual(MAX_OFFLINE_AREA_SIDE_M + 10);
    expect(heightM).toBeLessThanOrEqual(MAX_OFFLINE_AREA_SIDE_M + 10);
    expect(Math.round(widthM)).toBeCloseTo(MAX_OFFLINE_AREA_SIDE_M, -1);
    expect(Math.round(heightM)).toBeCloseTo(MAX_OFFLINE_AREA_SIDE_M, -1);
  });

  it('flytter utvalgsboksen til nytt senter uten å endre dimensjoner i meter', () => {
    const initial = createCenteredBounds(59.91, 10.75, 3200, 1800);
    const moved = moveBoundsToCenter(initial, 63.43, 10.39);
    const dims = getBoundsDimensionsMeters(moved);

    const midLat = (moved.north + moved.south) / 2;
    const midLon = (moved.east + moved.west) / 2;
    expect(midLat).toBeCloseTo(63.43, 4);
    expect(midLon).toBeCloseTo(10.39, 4);
    expect(Math.round(dims.widthM)).toBeCloseTo(3200, -1);
    expect(Math.round(dims.heightM)).toBeCloseTo(1800, -1);
  });

  it('tillater skalering innenfor 10 × 10 km uten clamping', () => {
    const initial = createCenteredBounds(60.0, 10.0, 2000, 2000);
    // Flytt nordøst-hjørnet litt ut (ca. 3,5 km fra sørvest-ankeret)
    const target = {
      lat: initial.south + 0.03,
      lon: initial.west + 0.06,
    };
    const res = resizeBoundsFromCorner(initial, 'ne', target);

    expect(res.clamped).toBe(false);
    expect(res.bounds.south).toBeCloseTo(initial.south, 6);
    expect(res.bounds.west).toBeCloseTo(initial.west, 6);
    expect(res.widthM).toBeLessThanOrEqual(MAX_OFFLINE_AREA_SIDE_M);
    expect(res.heightM).toBeLessThanOrEqual(MAX_OFFLINE_AREA_SIDE_M);
  });

  it('låser (clamper) hjørnet ved forsøk på å skalere utover 10 × 10 km', () => {
    const initial = createCenteredBounds(60.0, 10.0, 2500, 2500);
    // Forsøk å dra nordvest-hjørnet ~25 km nord og vest fra sørøst-ankeret
    const target = {
      lat: initial.south + 0.25,
      lon: initial.east - 0.5,
    };
    const res = resizeBoundsFromCorner(initial, 'nw', target);

    expect(res.clamped).toBe(true);
    // Sørøst-ankeret skal stå fast
    expect(res.bounds.south).toBeCloseTo(initial.south, 6);
    expect(res.bounds.east).toBeCloseTo(initial.east, 6);
    // Bredde og høyde skal være låst til 10000 m (10 × 10 km)
    expect(Math.round(res.widthM)).toBeCloseTo(MAX_OFFLINE_AREA_SIDE_M, -1);
    expect(Math.round(res.heightM)).toBeCloseTo(MAX_OFFLINE_AREA_SIDE_M, -1);
  });

  it('hindrer at boksen vrenges eller blir mindre enn minimumsstørrelsen', () => {
    const initial = createCenteredBounds(60.0, 10.0, 2500, 2500);
    // Forsøk å dra sørøst-hjørnet forbi nordvest-ankeret
    const target = {
      lat: initial.north + 0.05,
      lon: initial.west - 0.05,
    };
    const res = resizeBoundsFromCorner(initial, 'se', target);

    expect(res.bounds.north).toBeCloseTo(initial.north, 6);
    expect(res.bounds.west).toBeCloseTo(initial.west, 6);
    expect(res.bounds.south).toBeLessThan(res.bounds.north);
    expect(res.bounds.east).toBeGreaterThan(res.bounds.west);
    expect(Math.round(res.widthM)).toBeCloseTo(MIN_OFFLINE_AREA_SIDE_M, -1);
    expect(Math.round(res.heightM)).toBeCloseTo(MIN_OFFLINE_AREA_SIDE_M, -1);
  });

  it('filtrerer lokaliteter som ligger innenfor valgt bounding box', () => {
    const bounds = { north: 60.0, south: 59.0, east: 6.0, west: 5.0 };
    const sites = [
      { id: 1, name: 'Inni offentlig', lat: 59.5, lon: 5.5, isPrivate: false },
      { id: 2, name: 'Inni privat', lat: 59.8, lon: 5.2, isPrivate: true },
      { id: 3, name: 'Utenfor nord', lat: 60.2, lon: 5.5, isPrivate: false },
    ];
    const inside = filterSitesInBounds(sites, bounds);
    expect(inside).toHaveLength(2);
    expect(inside.map((s) => s.id)).toEqual([1, 2]);
  });

  it('laster kun ned offentlige lokaliteter når brukeren ikke er innlogget', () => {
    const bboxSites = [
      { id: 1, name: 'Offentlig vann', lat: 59.79, lon: 5.17, isPrivate: false },
      { id: 2, name: 'Andres hage', lat: 59.79, lon: 5.18, isPrivate: true, isMine: false },
      { id: 3, name: 'Server-merket privat', lat: 59.79, lon: 5.19, isPrivate: true, isMine: true },
    ];
    const filtered = filterSitesForOfflineDownload(bboxSites, [], {
      isLoggedIn: false,
      showOthersPrivate: false,
      cachedPrivateSites: [{ id: 99, name: 'Gammel cache', lat: 59.79, lon: 5.17 }],
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(1);
  });

  it('laster ned offentlige + egne private lokaliteter når brukeren er innlogget (uten andres private)', () => {
    const bboxSites = [
      { id: 1, name: 'Offentlig vann', lat: 59.79, lon: 5.17, isPrivate: false },
      { id: 2, name: 'Andres hage', lat: 59.79, lon: 5.18, isPrivate: true, isMine: false },
      { id: 3, name: 'Min lokasjon i bbox', lat: 59.79, lon: 5.19, isPrivate: true, isMine: false },
    ];
    const cachedPrivateSites = [
      { id: 3, name: 'Min lokasjon i bbox', lat: 59.79, lon: 5.19 },
      { id: 4, name: 'Min ekstra lokasjon', lat: 59.795, lon: 5.175 },
    ];
    const filtered = filterSitesForOfflineDownload(bboxSites, [], {
      isLoggedIn: true,
      showOthersPrivate: false,
      cachedPrivateSites,
    });
    expect(filtered.map((s) => s.id)).toEqual([1, 3, 4]);
    expect(filtered.find((s) => s.id === 3).isMine).toBe(true);
    expect(filtered.find((s) => s.id === 4).isMine).toBe(true);
  });

  it('laster ned alle lokaliteter (offentlige + egne private + andres private) når «Vis andres private lokasjoner» er valgt', () => {
    const bboxSites = [
      { id: 1, name: 'Offentlig vann', lat: 59.79, lon: 5.17, isPrivate: false },
      { id: 2, name: 'Andres hage', lat: 59.79, lon: 5.18, isPrivate: true, isMine: false },
    ];
    const cachedPrivateSites = [
      { id: 3, name: 'Min hage', lat: 59.791, lon: 5.171 },
    ];
    const filtered = filterSitesForOfflineDownload(bboxSites, [], {
      isLoggedIn: true,
      showOthersPrivate: true,
      cachedPrivateSites,
    });
    expect(filtered.map((s) => s.id)).toEqual([1, 2, 3]);
  });
});

describe('offline map tile calculation and throttled batch caching', () => {
  it('konverterer bredde-/lengdegrad til forventede Web Mercator XYZ-fliskoordinater', () => {
    const tile = latLonToTileXY(59.7928, 5.1723, 10);
    expect(tile.z).toBe(10);
    expect(tile.x).toBe(526);
    expect(tile.y).toBe(298);

    const url = formatKartverketTileUrl(tile);
    expect(url).toBe(
      'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/10/298/526.png',
    );
  });

  it('beregner kartfliser kun for zoom-nivåene 10 til og med 16', () => {
    const bounds = createCenteredBounds(59.7928, 5.1723, 1000, 1000);
    // Forsøk å sende inn zoom 5..19 — skal tvinges til 10..16
    const tiles = calculateTilesForBounds(bounds, 5, 19);

    expect(tiles.length).toBeGreaterThan(0);
    const zoomLevels = [...new Set(tiles.map((t) => t.z))].sort((a, b) => a - b);
    expect(zoomLevels).toEqual([10, 11, 12, 13, 14, 15, 16]);
    expect(Math.min(...zoomLevels)).toBe(MIN_TILE_ZOOM);
    expect(Math.max(...zoomLevels)).toBe(MAX_TILE_ZOOM);
  });

  it('laster ned kartfliser i puljer (batches) på maks 10 samtidige kall og lagrer i Cache API', async () => {
    const storedMap = new Map();
    const mockCache = {
      match: vi.fn(async (url) => storedMap.get(url) || undefined),
      put: vi.fn(async (url, resp) => {
        storedMap.set(url, resp);
      }),
    };
    const mockCacheStorage = {
      open: vi.fn(async () => mockCache),
    };

    const totalTiles = 25;
    const tiles = Array.from({ length: totalTiles }, (_, idx) => ({
      x: 500 + idx,
      y: 300,
      z: 12,
      url: `https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/12/300/${500 + idx}.png`,
    }));

    let inFlight = 0;
    let maxInFlightObserved = 0;
    const progressEvents = [];

    const mockFetch = vi.fn(async (url) => {
      inFlight += 1;
      if (inFlight > maxInFlightObserved) {
        maxInFlightObserved = inFlight;
      }
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return {
        ok: true,
        status: 200,
        url,
        clone() {
          return { ...this };
        },
      };
    });

    const summary = await downloadTilesInBatches(tiles, {
      batchSize: 50, // Selv om 50 bes om, skal den klampes til MAX_TILE_BATCH_SIZE (10)
      cacheName: MAP_TILE_CACHE_NAME,
      cacheStorage: mockCacheStorage,
      fetchFn: mockFetch,
      onProgress: (info) => progressEvents.push(info),
    });

    expect(maxInFlightObserved).toBeLessThanOrEqual(MAX_TILE_BATCH_SIZE);
    expect(maxInFlightObserved).toBe(10);
    expect(summary).toEqual({ total: 25, cached: 25, failed: 0 });
    expect(mockCacheStorage.open).toHaveBeenCalledWith(MAP_TILE_CACHE_NAME);
    expect(mockCache.put).toHaveBeenCalledTimes(25);
    expect(progressEvents).toHaveLength(25);
    expect(progressEvents[progressEvents.length - 1]).toEqual({
      completed: 25,
      total: 25,
      cached: 25,
      failed: 0,
    });
  });
});

describe('dynamic viewport location fetching (20x20 km rule & 10x10 km cap)', () => {
  const center = { lat: 59.7928, lon: 5.1723 };

  it('avbryter innlasting når synlig kartutsnitt er 20 × 20 km eller større', () => {
    const viewport20km = createExtentBounds(center.lat, center.lon, MAX_VIEWPORT_FETCH_SIDE_M);
    const plan20 = computeDynamicFetchBounds(viewport20km, center);
    expect(plan20.shouldFetch).toBe(false);
    expect(plan20.fetchBounds).toBeNull();

    const viewport35km = createExtentBounds(center.lat, center.lon, 35000);
    const plan35 = computeDynamicFetchBounds(viewport35km, center);
    expect(plan35.shouldFetch).toBe(false);
    expect(plan35.fetchBounds).toBeNull();
  });

  it('bruker synlig kartutsnitt direkte når både bredde og høyde er <= 10 km', () => {
    const viewport6km = createExtentBounds(center.lat, center.lon, 6000);
    const plan = computeDynamicFetchBounds(viewport6km, center);

    expect(plan.shouldFetch).toBe(true);
    expect(plan.capped).toBe(false);
    expect(plan.fetchBounds).toEqual(viewport6km);
  });

  it('begrenser forespørselen til en streng 10 × 10 km boks sentrert på kartsenteret når utsnittet er mellom 10 × 10 km og 20 × 20 km', () => {
    const viewport15km = createExtentBounds(center.lat, center.lon, 15000);
    const plan = computeDynamicFetchBounds(viewport15km, center);

    expect(plan.shouldFetch).toBe(true);
    expect(plan.capped).toBe(true);
    expect(plan.fetchBounds).not.toBeNull();

    const { widthM, heightM } = getBoundsDimensionsMeters(plan.fetchBounds);
    expect(Math.round(widthM)).toBeCloseTo(MAX_DYNAMIC_FETCH_BOX_SIDE_M, -1);
    expect(Math.round(heightM)).toBeCloseTo(MAX_DYNAMIC_FETCH_BOX_SIDE_M, -1);

    const midLat = (plan.fetchBounds.north + plan.fetchBounds.south) / 2;
    const midLon = (plan.fetchBounds.east + plan.fetchBounds.west) / 2;
    expect(midLat).toBeCloseTo(center.lat, 5);
    expect(midLon).toBeCloseTo(center.lon, 5);
  });

  it('gjør ingen API-kall når utsnittet er >= 20 × 20 km i fetchDynamicViewportSites', async () => {
    const viewport25km = createExtentBounds(center.lat, center.lon, 25000);
    const fetchSitesByBounds = vi.fn();
    const ensureTokens = vi.fn();

    const result = await fetchDynamicViewportSites(viewport25km, center, {
      checkLoggedIn: () => true,
      ensureTokens,
      fetchSitesByBounds,
      getShowOthersPrivate: () => false,
      getPrivateSitesCache: () => [],
    });

    expect(result.shouldFetch).toBe(false);
    expect(result.sites).toEqual([]);
    expect(ensureTokens).not.toHaveBeenCalled();
    expect(fetchSitesByBounds).not.toHaveBeenCalled();
  });

  it('integrerer 10 × 10 km-taket med autentiseringsreglene (utlogget vs. innlogget vs. vis andres private)', async () => {
    const viewport14km = createExtentBounds(center.lat, center.lon, 14000);
    const rawApiSites = [
      { id: 1, name: 'Offentlig innenfor 10km', lat: center.lat + 0.01, lon: center.lon + 0.01, isPrivate: false },
      { id: 2, name: 'Andres privat innenfor 10km', lat: center.lat + 0.015, lon: center.lon + 0.015, isPrivate: true, isMine: false },
      { id: 3, name: 'Utenfor 10km-boksen', lat: center.lat + 0.06, lon: center.lon + 0.06, isPrivate: false },
    ];
    const cachedOwnPrivate = [
      { id: 4, name: 'Min egen private innenfor 10km', lat: center.lat - 0.01, lon: center.lon - 0.01 },
      { id: 5, name: 'Min egen private utenfor 10km', lat: center.lat - 0.06, lon: center.lon - 0.06 },
    ];

    const fetchSitesByBounds = vi.fn(async () => rawApiSites);

    // 1. Utlogget: kun offentlige innenfor 10x10 km
    const loggedOutRes = await fetchDynamicViewportSites(viewport14km, center, {
      checkLoggedIn: () => false,
      fetchSitesByBounds,
      getShowOthersPrivate: () => false,
      getPrivateSitesCache: () => cachedOwnPrivate,
    });
    expect(loggedOutRes.shouldFetch).toBe(true);
    expect(loggedOutRes.capped).toBe(true);
    expect(loggedOutRes.sites.map((s) => s.id)).toEqual([1]);

    // 2. Innlogget (standard): offentlige + egne private innenfor 10x10 km
    const loggedInRes = await fetchDynamicViewportSites(viewport14km, center, {
      checkLoggedIn: () => true,
      ensureTokens: async () => true,
      fetchSitesByBounds,
      getShowOthersPrivate: () => false,
      getPrivateSitesCache: () => cachedOwnPrivate,
    });
    expect(loggedInRes.sites.map((s) => s.id)).toEqual([1, 4]);
    expect(loggedInRes.sites.find((s) => s.id === 4).isMine).toBe(true);

    // 3. Innlogget med «Vis andres private lokasjoner»: offentlige + andres private + egne private innenfor 10x10 km
    const showAllRes = await fetchDynamicViewportSites(viewport14km, center, {
      checkLoggedIn: () => true,
      ensureTokens: async () => true,
      fetchSitesByBounds,
      getShowOthersPrivate: () => true,
      getPrivateSitesCache: () => cachedOwnPrivate,
    });
    expect(showAllRes.sites.map((s) => s.id)).toEqual([1, 2, 4]);
  });

  it('støtter Online (Network-First), Hybrid (Cache-First med fallback) og Offline (Cache-Only) i fetchDynamicViewportSites', async () => {
    const viewport8km = createExtentBounds(center.lat, center.lon, 8000);
    const cachedSites = [
      { id: 501, name: 'Cachet lokalitet', lat: center.lat, lon: center.lon, isPrivate: false },
    ];
    const networkSites = [
      { id: 601, name: 'Nettverkslokalitet', lat: center.lat, lon: center.lon, isPrivate: false },
    ];

    const fetchSitesByBounds = vi.fn(async () => networkSites);
    const ensureTokens = vi.fn(async () => true);

    // 1. Online-modus: Henter fra nettverk selv når lokalt mellomlager har data
    const onlineRes = await fetchDynamicViewportSites(viewport8km, center, {
      networkMode: 'online',
      getOfflineLocationsInBounds: async () => cachedSites,
      checkLoggedIn: () => false,
      ensureTokens,
      fetchSitesByBounds,
    });
    expect(onlineRes.mode).toBe('online');
    expect(onlineRes.source).toBe('network');
    expect(onlineRes.sites.map((s) => s.id)).toEqual([601]);
    expect(fetchSitesByBounds).toHaveBeenCalledTimes(1);

    // 2. Hybrid-modus med treff i lokalt mellomlager: Returnerer cache uten nettverkskall
    fetchSitesByBounds.mockClear();
    const hybridHitRes = await fetchDynamicViewportSites(viewport8km, center, {
      networkMode: 'hybrid',
      getOfflineLocationsInBounds: async () => cachedSites,
      checkLoggedIn: () => false,
      ensureTokens,
      fetchSitesByBounds,
    });
    expect(hybridHitRes.mode).toBe('hybrid');
    expect(hybridHitRes.source).toBe('cache');
    expect(hybridHitRes.sites.map((s) => s.id)).toEqual([501]);
    expect(fetchSitesByBounds).not.toHaveBeenCalled();

    // 3. Hybrid-modus uten treff i lokalt mellomlager (panorert utenfor nedlastet område): Faller tilbake til nettverk
    const hybridMissRes = await fetchDynamicViewportSites(viewport8km, center, {
      networkMode: 'hybrid',
      getOfflineLocationsInBounds: async () => [],
      checkLoggedIn: () => false,
      ensureTokens,
      fetchSitesByBounds,
    });
    expect(hybridMissRes.mode).toBe('hybrid');
    expect(hybridMissRes.source).toBe('network');
    expect(hybridMissRes.sites.map((s) => s.id)).toEqual([601]);
    expect(fetchSitesByBounds).toHaveBeenCalledTimes(1);

    // 4. Streng Offline-modus: Returnerer kun fra lokalt mellomlager og kaller aldri nettverket
    fetchSitesByBounds.mockClear();
    ensureTokens.mockClear();
    const offlineRes = await fetchDynamicViewportSites(viewport8km, center, {
      networkMode: 'offline',
      getOfflineLocationsInBounds: async () => [],
      checkLoggedIn: () => true,
      ensureTokens,
      fetchSitesByBounds,
    });
    expect(offlineRes.mode).toBe('offline');
    expect(offlineRes.source).toBe('cache');
    expect(offlineRes.sites).toEqual([]);
    expect(fetchSitesByBounds).not.toHaveBeenCalled();
    expect(ensureTokens).not.toHaveBeenCalled();
  });
});



