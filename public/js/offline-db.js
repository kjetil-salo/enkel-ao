/**
 * Persistent offline-database (IndexedDB) for nedlastede AO-lokaliteter og kartområder.
 *
 * Cachen tømmes ALDRI automatisk (ingen TTL eller automatisk sletting).
 * Hver nedlastet lokalitet lagres i IndexedDB og merkes (tagges) med både
 * boundingBox-ID (`areaId`) og de eksakte koordinatene (`bounds: { north, south, east, west }`).
 */

import {
  filterSitesInBounds,
  mergeCachedSites,
  createCenteredBounds,
  calculateTilesForBounds,
  downloadTilesInBatches,
  filterSitesForOfflineDownload,
  dropOthersPrivateSites,
  determineAreaName,
  OFFLINE_ZOOM_LEVELS,
  MAX_TILE_BATCH_SIZE,
  KARTVERKET_TOPO_URL_TEMPLATE,
} from './offline-area.js?v=v1.60.16';
import { haversine } from './utils.js';

export const OFFLINE_DB_NAME = 'enkel_ao_offline_db';
export const OFFLINE_DB_VERSION = 1;
export const OFFLINE_AREAS_STORE = 'areas';
export const OFFLINE_LOCATIONS_STORE = 'locations';
export const OFFLINE_MODE_KEY = 'offline_mode_v1';
export const NETWORK_MODE_KEY = 'network_mode_v1';
export const NETWORK_MODES = ['online', 'hybrid', 'offline'];
// Modus ved aller første oppstart (ingenting lagret ennå). Samme verdi brukes i sw.js.
export const DEFAULT_NETWORK_MODE = 'hybrid';
// Service Worker registreres ALLTID med nøyaktig denne URL-en (samme som i index.html).
// En avvikende URL får nettleseren til å bytte ut workeren ved sidebytte, og da mister
// den modusen sin fra minnet. Versjonert URL omgår Cloudflares edge-cache av /sw.js,
// og versjonen oppdateres sammen med de andre treffene ved release.
export const SERVICE_WORKER_URL = '/sw.js?v=v1.60.16';
export const NETWORK_MODE_CACHE_URL = 'https://enkel-ao.local/__network_mode__';
export const MAP_TILE_CACHE_NAME = 'enkel-ao-kartverket-tiles-v1';
export const OPPORTUNISTIC_AREA_ID = 'opportunistic';

/**
 * Er «Vis andres private lokasjoner» slått på i innstillingene? Samme nøkkel som
 * shouldShowOthersPrivateSites() i location.js (som ikke kan importeres herfra uten
 * sirkulær avhengighet). Av som standard.
 */
function readShowOthersPrivate() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('showPrivateSitesOnMap') === '1';
  } catch {
    return false;
  }
}

// Fallback i minne kun dersom IndexedDB ikke eksisterer i kjøremiljøet (f.eks. eldre JSDOM uten IDB)
const memoryFallback = {
  areas: new Map(),
  locations: new Map(),
};

/**
 * Normaliser en modusverdi til 'online', 'hybrid' eller 'offline'.
 * @param {string|boolean} mode
 * @returns {'online'|'hybrid'|'offline'}
 */
export function normalizeNetworkMode(mode) {
  if (mode === true) return 'offline';
  if (mode === false) return 'online';
  const str = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
  if (str === 'hybrid' || str === 'offline' || str === 'online') {
    return str;
  }
  return DEFAULT_NETWORK_MODE;
}

/**
 * Hent gjeldende nettverksmodus ('online' | 'hybrid' | 'offline').
 * Bakoverkompatibel med eldre OFFLINE_MODE_KEY ('1' -> 'offline').
 * @returns {'online'|'hybrid'|'offline'}
 */
export function getNetworkMode() {
  try {
    const raw = localStorage.getItem(NETWORK_MODE_KEY);
    const stored = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (stored === 'online' || stored === 'hybrid' || stored === 'offline') {
      if (raw !== stored) {
        localStorage.setItem(NETWORK_MODE_KEY, stored);
      }
      return stored;
    }
    if (localStorage.getItem(OFFLINE_MODE_KEY) === '1') {
      localStorage.setItem(NETWORK_MODE_KEY, 'offline');
      return 'offline';
    }
    // Første oppstart: lagre standardmodusen slik at alle sider og Service Worker
    // fra da av leser samme lagrede verdi (én kilde til sannhet).
    localStorage.setItem(NETWORK_MODE_KEY, DEFAULT_NETWORK_MODE);
  } catch {
    // Ignorer localStorage-feil
  }
  return DEFAULT_NETWORK_MODE;
}

/**
 * Synkroniser gjeldende nettverksmodus til Service Worker og Cache API
 * slik at kartflis-forespørsler håndteres med riktig strategi (Network-First, Cache-First, Cache-Only).
 * @param {'online'|'hybrid'|'offline'} mode
 */
export async function syncNetworkModeToServiceWorker(mode) {
  const normalized = normalizeNetworkMode(mode);

  try {
    if (typeof caches !== 'undefined' && caches && typeof caches.open === 'function') {
      const cache = await caches.open(MAP_TILE_CACHE_NAME);
      if (cache && typeof cache.put === 'function' && typeof Response !== 'undefined') {
        await cache.put(
          NETWORK_MODE_CACHE_URL,
          new Response(normalized, { headers: { 'Content-Type': 'text/plain' } }),
        );
      }
    }
  } catch {
    // Ignorer dersom Cache API ikke er tilgjengelig i kjøremiljøet
  }

  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker) {
      const msg = { type: 'SET_NETWORK_MODE', mode: normalized };
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage(msg);
      }
      if (navigator.serviceWorker.ready && typeof navigator.serviceWorker.ready.then === 'function') {
        navigator.serviceWorker.ready
          .then((reg) => {
            if (reg && reg.active) {
              reg.active.postMessage(msg);
            }
          })
          .catch(() => {});
      }
    }
  } catch {
    // Ignorer dersom Service Worker ikke støttes
  }
}

/**
 * Registrer Service Worker (alltid med samme URL) og synkroniser lagret nettverksmodus
 * til den. Kalles av alle sider ved innlasting, slik at UI og Service Worker alltid
 * leser samme verdi fra localStorage.
 * @returns {Promise<void>}
 */
export async function initNetworkModeAndServiceWorker() {
  const mode = getNetworkMode();
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker) {
      await navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(() => {});
    }
  } catch {
    // Ignorer dersom Service Worker ikke støttes
  }
  await syncNetworkModeToServiceWorker(mode).catch(() => {});
}

/**
 * Sett nettverksmodus ('online' | 'hybrid' | 'offline') og varsle lyttere.
 * @param {'online'|'hybrid'|'offline'|boolean} mode
 * @returns {'online'|'hybrid'|'offline'} Ny nettverksmodus
 */
export function setNetworkMode(mode) {
  const next = normalizeNetworkMode(mode);
  try {
    localStorage.setItem(NETWORK_MODE_KEY, next);
    if (next === 'offline') {
      localStorage.setItem(OFFLINE_MODE_KEY, '1');
    } else {
      localStorage.removeItem(OFFLINE_MODE_KEY);
    }
  } catch (e) {
    console.warn('[offline-db] Kunne ikke lagre nettverksmodus i localStorage:', e);
  }

  syncNetworkModeToServiceWorker(next).catch(() => {});

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent('network_mode_changed', {
        detail: {
          mode: next,
          online: next === 'online',
          hybrid: next === 'hybrid',
          offline: next === 'offline',
        },
      }),
    );
    window.dispatchEvent(
      new CustomEvent('offline_mode_changed', {
        detail: { offline: next === 'offline', mode: next },
      }),
    );
  }
  return next;
}

/**
 * Ruller til neste nettverksmodus i rekkefølgen: online -> hybrid -> offline -> online.
 * @returns {'online'|'hybrid'|'offline'} Ny nettverksmodus
 */
export function cycleNetworkMode() {
  const current = getNetworkMode();
  const idx = NETWORK_MODES.indexOf(current);
  const next = NETWORK_MODES[(idx + 1) % NETWORK_MODES.length];
  return setNetworkMode(next);
}

/**
 * Sjekk om appen er i Online-modus (Network-First).
 * @returns {boolean}
 */
export function isOnlineMode() {
  return getNetworkMode() === 'online';
}

/**
 * Sjekk om appen er i Hybrid-modus (Cache-First med nettverk som fallback).
 * @returns {boolean}
 */
export function isHybridMode() {
  return getNetworkMode() === 'hybrid';
}

/**
 * Sjekk om appen er i streng Offline-modus (Strict Cache-Only).
 * @returns {boolean}
 */
export function isOfflineMode() {
  return getNetworkMode() === 'offline';
}

/**
 * Skru Offline-modus av eller på og varsle lyttere via CustomEvent('offline_mode_changed').
 * Beholdes for bakoverkompatibilitet.
 * @param {boolean} enabled
 * @returns {boolean} Ny offline-tilstand
 */
export function setOfflineMode(enabled) {
  const next = Boolean(enabled);
  setNetworkMode(next ? 'offline' : 'online');
  return next;
}

/**
 * Generer en deterministisk ID for en bounding box.
 * @param {{ north: number, south: number, east: number, west: number }} bounds
 * @returns {string}
 */
export function formatAreaId(bounds) {
  if (!bounds) return 'bbox_unknown';
  const n = Number(bounds.north).toFixed(4);
  const s = Number(bounds.south).toFixed(4);
  const e = Number(bounds.east).toFixed(4);
  const w = Number(bounds.west).toFixed(4);
  return `bbox_${n}_${s}_${e}_${w}`;
}

/**
 * Åpne IndexedDB-databasen (oppretter object stores ved første kjøring).
 * @returns {Promise<IDBDatabase|null>}
 */
export function openOfflineDb() {
  const idb = typeof indexedDB !== 'undefined'
    ? indexedDB
    : (typeof window !== 'undefined' && window.indexedDB ? window.indexedDB : null);

  if (!idb) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    try {
      const request = idb.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(OFFLINE_AREAS_STORE)) {
          db.createObjectStore(OFFLINE_AREAS_STORE, { keyPath: 'areaId' });
        }
        if (!db.objectStoreNames.contains(OFFLINE_LOCATIONS_STORE)) {
          const locStore = db.createObjectStore(OFFLINE_LOCATIONS_STORE, { keyPath: 'key' });
          locStore.createIndex('areaId', 'areaId', { unique: false });
          locStore.createIndex('siteId', 'siteId', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Kunne ikke åpne IndexedDB'));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Bygg en stabil lagringsnøkkel for en lokalitet innenfor et område.
 * @param {Object} site
 * @param {string} areaId
 * @param {number} index
 * @returns {{ key: string, siteId: string }}
 */
function buildLocationKeys(site, areaId, index) {
  const rawId = site && site.id != null ? String(site.id).trim() : '';
  const latStr = site && site.lat != null ? Number(site.lat).toFixed(5) : '0';
  const lonStr = site && site.lon != null ? Number(site.lon).toFixed(5) : '0';
  const nameStr = site && site.name ? String(site.name).trim() : `site_${index}`;
  const siteId = rawId || `${nameStr}_${latStr}_${lonStr}`;
  return {
    key: `${areaId}::${siteId}`,
    siteId,
  };
}

/**
 * Lagre nedlastede lokaliteter for en valgt bounding box i den persistente offline-databasen.
 * Merk (tag) hver lokalitet med både `areaId` og `boundingBox`-koordinatene.
 *
 * @param {{ north: number, south: number, east: number, west: number }} bounds
 * @param {Array<Object>} sites
 * @returns {Promise<{ areaId: string, bounds: Object, savedCount: number, publicCount: number, privateCount: number }>}
 */
export async function saveOfflineAreaLocations(bounds, sites, options = {}) {
  if (!bounds || typeof bounds.north !== 'number' || typeof bounds.south !== 'number') {
    throw new Error('Ugyldig bounding box for offline-lagring');
  }

  const normalizedBounds = {
    north: Number(bounds.north),
    south: Number(bounds.south),
    east: Number(bounds.east),
    west: Number(bounds.west),
  };
  const areaId = formatAreaId(normalizedBounds);
  const downloadedAt = new Date().toISOString();
  // Siste skanse: andres private lokaliteter lagres aldri uten at innstillingen er på,
  // uansett hvilken kodevei som kalte oss.
  const showOthersPrivate =
    typeof options.showOthersPrivate === 'boolean' ? options.showOthersPrivate : readShowOthersPrivate();
  const validSites = dropOthersPrivateSites(Array.isArray(sites) ? sites.filter(Boolean) : [], showOthersPrivate);

  let publicCount = 0;
  let privateCount = 0;

  const records = validSites.map((site, idx) => {
    const raw = site.raw && typeof site.raw === 'object' ? site.raw : site;
    const isPriv = Boolean(
      site.isMine ||
      site.isPrivate === true ||
      site.isPrivate === 'true' ||
      raw.isPrivate === true ||
      raw.isPrivate === 'true' ||
      raw.IsPrivate === true ||
      raw.IsPrivate === 'true',
    );
    if (isPriv) {
      privateCount++;
    } else {
      publicCount++;
    }

    const { key, siteId } = buildLocationKeys(site, areaId, idx);
    const taggedSite = {
      ...site,
      areaId,
      boundingBox: { ...normalizedBounds },
      downloadedAt,
    };

    return {
      key,
      siteId,
      areaId,
      bounds: { ...normalizedBounds },
      downloadedAt,
      isPrivate: isPriv,
      isMine: Boolean(site.isMine),
      lat: Number(site.lat),
      lon: Number(site.lon),
      name: site.name || '',
      site: taggedSite,
    };
  });

  const areaName =
    typeof options.name === 'string' && options.name.trim()
      ? options.name.trim()
      : determineAreaName(validSites, options.allSites || []);

  const areaRecord = {
    areaId,
    name: areaName,
    bounds: { ...normalizedBounds },
    publicCount,
    privateCount,
    totalCount: records.length,
    downloadedAt,
  };

  // Oppdater alltid in-memory speil i tillegg til IndexedDB (erstatt gamle oppføringer for samme areaId)
  for (const [k, v] of memoryFallback.locations.entries()) {
    if (v && v.areaId === areaId) {
      memoryFallback.locations.delete(k);
    }
  }
  memoryFallback.areas.set(areaId, areaRecord);
  records.forEach((rec) => {
    memoryFallback.locations.set(rec.key, rec);
  });

  const db = await openOfflineDb().catch(() => null);
  if (db) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction([OFFLINE_AREAS_STORE, OFFLINE_LOCATIONS_STORE], 'readwrite');
      const areasStore = tx.objectStore(OFFLINE_AREAS_STORE);
      const locationsStore = tx.objectStore(OFFLINE_LOCATIONS_STORE);

      try {
        if (typeof IDBKeyRange !== 'undefined' && typeof locationsStore.delete === 'function') {
          locationsStore.delete(IDBKeyRange.bound(`${areaId}::`, `${areaId}::\uffff`));
        }
      } catch {
        // Ignorer dersom kjøremiljøet ikke støtter IDBKeyRange.bound
      }

      areasStore.put(areaRecord);
      records.forEach((rec) => {
        locationsStore.put(rec);
      });

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        const err = tx.error;
        db.close();
        reject(err || new Error('Kunne ikke lagre offline-område i IndexedDB'));
      };
    });
  }

  return {
    areaId,
    name: areaName,
    bounds: normalizedBounds,
    savedCount: records.length,
    publicCount,
    privateCount,
  };
}

/**
 * Lagre lokaliteter som er lastet inn under vanlig bruk (utenom eksplisitt nedlasting av offline-område)
 * slik at disse også blir tilgjengelige i Hybrid- og Offline-modus.
 * Oppretter IKKE en oppføring i OFFLINE_AREAS_STORE, slik at synkronisering av offline-områder
 * kun laster ned fliser for brukerens eksplisitt lagrede offline-bokser.
 *
 * @param {Array<Object>} sites
 * @param {{ north: number, south: number, east: number, west: number }|null} [bounds=null]
 * @returns {Promise<{ savedCount: number }>}
 */
export async function saveOpportunisticOfflineLocations(sites, bounds = null) {
  // Andres private lokaliteter lagres ikke automatisk med mindre innstillingen er på.
  const validSites = dropOthersPrivateSites(
    Array.isArray(sites)
      ? sites.filter(
          (s) =>
            s &&
            typeof s === 'object' &&
            typeof s.name === 'string' &&
            s.name.trim() &&
            !Number.isNaN( parseFloat(s.lat) ) &&
            !Number.isNaN( parseFloat(s.lon) ),
        )
      : [],
    readShowOthersPrivate(),
  );

  if (validSites.length === 0) {
    return { savedCount: 0 };
  }

  const downloadedAt = new Date().toISOString();
  const normalizedBounds =
    bounds &&
    typeof bounds.north === 'number' &&
    typeof bounds.south === 'number' &&
    typeof bounds.east === 'number' &&
    typeof bounds.west === 'number'
      ? {
          north: Number(bounds.north),
          south: Number(bounds.south),
          east: Number(bounds.east),
          west: Number(bounds.west),
        }
      : null;

  const records = validSites.map((site, idx) => {
    const raw = site.raw && typeof site.raw === 'object' ? site.raw : site;
    const isPriv = Boolean(
      site.isMine ||
      site.isPrivate === true ||
      site.isPrivate === 'true' ||
      raw.isPrivate === true ||
      raw.isPrivate === 'true' ||
      raw.IsPrivate === true ||
      raw.IsPrivate === 'true',
    );
    const { key, siteId } = buildLocationKeys(site, OPPORTUNISTIC_AREA_ID, idx);
    const taggedSite = {
      ...site,
      areaId: site.areaId || OPPORTUNISTIC_AREA_ID,
      ...(normalizedBounds && !site.boundingBox ? { boundingBox: { ...normalizedBounds } } : {}),
      downloadedAt: site.downloadedAt || downloadedAt,
    };

    return {
      key,
      siteId,
      areaId: OPPORTUNISTIC_AREA_ID,
      bounds: normalizedBounds,
      downloadedAt,
      isPrivate: isPriv,
      isMine: Boolean(site.isMine),
      lat: Number(site.lat),
      lon: Number(site.lon),
      name: site.name || '',
      site: taggedSite,
    };
  });

  records.forEach((rec) => {
    memoryFallback.locations.set(rec.key, rec);
  });

  const db = await openOfflineDb().catch(() => null);
  if (db) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction([OFFLINE_LOCATIONS_STORE], 'readwrite');
      const locationsStore = tx.objectStore(OFFLINE_LOCATIONS_STORE);

      records.forEach((rec) => {
        locationsStore.put(rec);
      });

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        const err = tx.error;
        db.close();
        reject(err || new Error('Kunne ikke lagre opportunistiske lokaliteter i IndexedDB'));
      };
    }).catch(() => {});
  }

  return { savedCount: records.length };
}

/**
 * Hent alle lagrede lokaliteter fra offline-databasen (deduplisert på siteId).
 * @returns {Promise<Array<Object>>} Liste med site-objekter (med `areaId` og `boundingBox`)
 */
export async function getAllOfflineLocations() {
  const db = await openOfflineDb().catch(() => null);
  let rawRecords = [];

  if (db) {
    rawRecords = await new Promise((resolve, reject) => {
      const tx = db.transaction([OFFLINE_LOCATIONS_STORE], 'readonly');
      const store = tx.objectStore(OFFLINE_LOCATIONS_STORE);
      const req = store.getAll();

      req.onsuccess = () => {
        db.close();
        resolve(Array.isArray(req.result) ? req.result : []);
      };
      req.onerror = () => {
        const err = req.error;
        db.close();
        reject(err || new Error('Kunne ikke lese lokaliteter fra IndexedDB'));
      };
    }).catch(() => []);
  }

  if (!rawRecords.length && memoryFallback.locations.size > 0) {
    rawRecords = Array.from(memoryFallback.locations.values());
  }

  // Dedupliser på siteId slik at samme lokalitet i overlappende bokser kun vises én gang.
  // Foretrekk oppføringer fra eksplisitt nedlastede områder fremfor 'opportunistic' for metadata.
  const bySiteId = new Map();
  rawRecords.forEach((rec) => {
    if (!rec || !rec.site) return;
    const dedupKey = rec.siteId || rec.key;
    const existing = bySiteId.get(dedupKey);
    if (!existing) {
      bySiteId.set(dedupKey, rec.site);
    } else {
      const preferIncomingArea =
        existing.areaId === OPPORTUNISTIC_AREA_ID &&
        rec.areaId &&
        rec.areaId !== OPPORTUNISTIC_AREA_ID;
      const mergedIsMine = Boolean(existing.isMine || rec.site.isMine);
      if (preferIncomingArea) {
        bySiteId.set(dedupKey, { ...existing, ...rec.site, isMine: mergedIsMine });
      } else if (mergedIsMine && !existing.isMine) {
        bySiteId.set(dedupKey, { ...existing, isMine: true });
      }
    }
  });

  // Slås «Vis andres private» av etter en nedlasting, skal tidligere lagrede private
  // lokaliteter fra andre heller ikke dukke opp igjen (kart, forslag, autocomplete).
  return dropOthersPrivateSites(Array.from(bySiteId.values()), readShowOthersPrivate());
}

/**
 * Hent lagrede offline-lokaliteter filtrert innenfor en gitt bounding box.
 * Hvis `bounds` ikke oppgis, returneres alle lagrede lokaliteter.
 *
 * @param {{ north: number, south: number, east: number, west: number }} [bounds]
 * @returns {Promise<Array<Object>>}
 */
export async function getOfflineLocationsInBounds(bounds) {
  const allSites = await getAllOfflineLocations();
  if (!bounds) return allSites;
  return filterSitesInBounds(allSites, bounds);
}

/**
 * Hent lagrede offline-lokaliteter nær en gitt posisjon (lat, lon) innenfor en radius (meter).
 * Brukes bl.a. i Hybrid-modus (Cache-First) for å sjekke om posisjonen allerede har lokaliteter i IndexedDB.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} [radiusMeters=1000]
 * @returns {Promise<Array<Object>>}
 */
export async function getOfflineLocationsNear(lat, lon, radiusMeters = 1000) {
  const numLat = Number(lat);
  const numLon = Number(lon);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLon)) return [];

  const effRadius = Number(radiusMeters) > 0 ? Number(radiusMeters) : 1000;
  const searchBounds = createCenteredBounds(numLat, numLon, effRadius * 2, effRadius * 2);
  const inBox = await getOfflineLocationsInBounds(searchBounds);
  if (!inBox.length) return [];

  return inBox.filter((s) => {
    const sLat = parseFloat(s.lat);
    const sLon = parseFloat(s.lon);
    if (Number.isNaN(sLat) || Number.isNaN(sLon)) return false;
    const dist = haversine(numLat, numLon, sLat, sLon);
    return dist == null || dist <= effRadius * 1.5;
  });
}

/**
 * Hent lokaliteter for en gitt posisjon og radius i henhold til aktiv nettverksmodus:
 * - 'online' (Network-First): Hent fra nettverk (med fallback til IndexedDB ved nettverksfeil).
 * - 'hybrid': Suppler lokale treff fra nettverket; bruk lokale treff ved nettverksfeil.
 *   Delvise cachetreff beviser ikke full dekning av radiusen.
 * - 'offline' (Strict Cache-Only): Strengt kun fra IndexedDB, aldri nettverkskall.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} [radiusMeters=1000]
 * @param {Object} [deps={}]
 * @param {Function} [deps.fetchOnline] - async (lat, lon, radiusMeters) => Array
 * @param {Function} [deps.ensureTokens] - async () => boolean
 * @param {Function} [deps.onCachedSites] - vis lokale treff før nettverkskallet
 * @param {'online'|'hybrid'|'offline'} [deps.mode] - overstyr nettverksmodus
 * @param {boolean} [deps.persistOpportunistic=false] - lagre nettverkstreff opportunistisk i IndexedDB
 * @returns {Promise<{ sites: Array<Object>, source: 'cache'|'network', mode: 'online'|'hybrid'|'offline' }>}
 */
export async function fetchLocationsWithNetworkMode(lat, lon, radiusMeters = 1000, deps = {}) {
  const mode = deps.mode ? normalizeNetworkMode(deps.mode) : getNetworkMode();

  if (mode === 'offline') {
    const allOffline = await getAllOfflineLocations().catch(() => []);
    return { sites: allOffline, source: 'cache', mode };
  }

  // Enkeltlokaliteter beviser ikke at hele den nye radiusen er lastet ned.
  const cachedNear = mode === 'hybrid' || deps.onCachedSites
    ? await getOfflineLocationsNear(lat, lon, radiusMeters).catch(() => [])
    : [];
  deps.onCachedSites?.(cachedNear);

  // 'online' (Network-First)
  try {
    if (typeof deps.ensureTokens === 'function') {
      await deps.ensureTokens();
    }
    const networkSites =
      typeof deps.fetchOnline === 'function'
        ? await deps.fetchOnline(lat, lon, radiusMeters)
        : [];
    const fresh = Array.isArray(networkSites) ? networkSites : [];
    if (mode === 'hybrid' && fresh.length === 0 && cachedNear.length > 0) {
      return { sites: cachedNear, source: 'cache', mode };
    }
    const list = mode === 'hybrid' ? mergeCachedSites(cachedNear, fresh) : fresh;
    if (deps.persistOpportunistic && list.length > 0) {
      await saveOpportunisticOfflineLocations(list).catch(() => {});
    }
    return { sites: list, source: 'network', mode };
  } catch (err) {
    const fallbackOffline = await getOfflineLocationsNear(lat, lon, radiusMeters).catch(() => []);
    if (fallbackOffline.length > 0) {
      return { sites: fallbackOffline, source: 'cache', mode };
    }
    throw err;
  }
}

/**
 * Hent alle nedlastede områder (bounding boxes) fra offline-databasen.
 * @returns {Promise<Array<Object>>}
 */
export async function getOfflineAreas() {
  const db = await openOfflineDb().catch(() => null);
  if (db) {
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction([OFFLINE_AREAS_STORE], 'readonly');
      const store = tx.objectStore(OFFLINE_AREAS_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        db.close();
        resolve(Array.isArray(req.result) ? req.result : []);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    }).catch(() => []);
    if (records.length > 0) return records;
  }
  return Array.from(memoryFallback.areas.values());
}

/**
 * Slett et spesifikt nedlastet offline-område og tilhørende lokaliteter.
 * @param {string} areaId
 * @returns {Promise<{ deleted: boolean }>}
 */
export async function deleteOfflineArea(areaId) {
  if (!areaId) return { deleted: false };
  const strId = String(areaId);

  // Fjern fra memory fallback
  memoryFallback.areas.delete(strId);
  for (const [k, v] of memoryFallback.locations.entries()) {
    if (v && v.areaId === strId) {
      memoryFallback.locations.delete(k);
    }
  }

  const db = await openOfflineDb().catch(() => null);
  if (db) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction([OFFLINE_AREAS_STORE, OFFLINE_LOCATIONS_STORE], 'readwrite');
      const areasStore = tx.objectStore(OFFLINE_AREAS_STORE);
      const locationsStore = tx.objectStore(OFFLINE_LOCATIONS_STORE);

      areasStore.delete(strId);

      try {
        if (typeof IDBKeyRange !== 'undefined' && typeof locationsStore.delete === 'function') {
          locationsStore.delete(IDBKeyRange.bound(`${strId}::`, `${strId}::\uffff`));
        } else {
          const req = locationsStore.getAll();
          req.onsuccess = () => {
            const list = Array.isArray(req.result) ? req.result : [];
            list.forEach((rec) => {
              if (rec && rec.areaId === strId) {
                locationsStore.delete(rec.key);
              }
            });
          };
        }
      } catch {
        // Ignorer slettefeil for enkeltoppføringer
      }

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        const err = tx.error;
        db.close();
        reject(err || new Error('Kunne ikke slette område fra IndexedDB'));
      };
    }).catch(() => {});
  }

  return { deleted: true };
}

/**
 * Beregn et grovt estimat over hvor mange lokaliteter, offline-områder og kartfliser
 * som er lagret lokalt på enheten.
 *
 * @param {Object} [options={}]
 * @param {CacheStorage|null} [options.cacheStorage] - overstyrbar window.caches (for tester)
 * @param {string} [options.cacheName=MAP_TILE_CACHE_NAME]
 * @returns {Promise<{ locationsCount: number, areasCount: number, tilesCount: number }>}
 */
export async function getOfflineStorageStats(options = {}) {
  const [locations, areas] = await Promise.all([
    getAllOfflineLocations().catch(() => []),
    getOfflineAreas().catch(() => []),
  ]);

  const cacheName = options.cacheName || MAP_TILE_CACHE_NAME;
  const cacheStorage =
    options.cacheStorage !== undefined
      ? options.cacheStorage
      : typeof caches !== 'undefined'
        ? caches
        : null;

  let tilesCount = 0;
  if (cacheStorage && typeof cacheStorage.open === 'function') {
    try {
      const cache = await cacheStorage.open(cacheName);
      if (cache && typeof cache.keys === 'function') {
        const keys = await cache.keys();
        if (Array.isArray(keys)) {
          tilesCount = keys.filter((req) => {
            const url = typeof req === 'string' ? req : req?.url || '';
            return url !== NETWORK_MODE_CACHE_URL && !url.includes('__network_mode__');
          }).length;
        }
      }
    } catch {
      tilesCount = 0;
    }
  }

  return {
    locationsCount: Array.isArray(locations) ? locations.length : 0,
    areasCount: Array.isArray(areas) ? areas.length : 0,
    tilesCount,
  };
}

/**
 * Synkroniser alle lagrede offline-områder (bounding boxes) ved å:
 * 1. Hente ferske lokaliteter fra AO API (med gjeldende autentiseringsregler: offentlige vs. private)
 *    og oppdatere IndexedDB.
 * 2. Laste ned eventuelle manglende kartfliser (zoom 12 og 15) for hvert lagret område til Cache API.
 *
 * @param {Object} [deps={}]
 * @param {Function} [deps.fetchSitesByBounds] - async (bounds) => Array
 * @param {Function} [deps.checkLoggedIn] - () => boolean
 * @param {Function} [deps.ensureTokens] - async () => boolean
 * @param {Function} [deps.getShowOthersPrivate] - () => boolean
 * @param {Function} [deps.getPrivateSitesCache] - () => Array
 * @param {string} [deps.tileUrlTemplate] - URL-mal for kartfliser som skal synkroniserast
 * @param {CacheStorage|null} [deps.cacheStorage] - overstyrbar window.caches (for tester)
 * @param {Function|null} [deps.fetchTileFn] - overstyrbar fetch for kartfliser (for tester)
 * @param {Function|null} [deps.onProgress] - callback ({ areaIndex, totalAreas, phase, completedTiles, totalTiles, syncedLocations })
 * @returns {Promise<{ syncedAreas: number, totalLocations: number, totalTilesCached: number }>}
 */
export async function syncOfflineAreas(deps = {}) {
  const areas = await getOfflineAreas().catch(() => []);
  const validAreas = Array.isArray(areas) ? areas.filter((a) => a && a.bounds) : [];
  const totalAreas = validAreas.length;

  if (totalAreas === 0) {
    return { syncedAreas: 0, totalLocations: 0, totalTilesCached: 0 };
  }

  let isLoggedIn = typeof deps.checkLoggedIn === 'function' ? Boolean(deps.checkLoggedIn()) : false;
  if (isLoggedIn && typeof deps.ensureTokens === 'function') {
    try {
      const tokenOk = await deps.ensureTokens();
      if (typeof tokenOk === 'boolean') {
        isLoggedIn = tokenOk;
      }
    } catch {
      // Fortsett med eksisterende status
    }
  }

  const showOthersPrivate =
    typeof deps.getShowOthersPrivate === 'function' ? Boolean(deps.getShowOthersPrivate()) : false;
  const cachedPrivateSites =
    isLoggedIn && typeof deps.getPrivateSitesCache === 'function'
      ? deps.getPrivateSitesCache()
      : [];
  const onProgress = typeof deps.onProgress === 'function' ? deps.onProgress : null;

  let syncedAreas = 0;
  let totalLocations = 0;
  let totalTilesCached = 0;

  for (let i = 0; i < totalAreas; i += 1) {
    const area = validAreas[i];
    const bounds = area.bounds;
    const areaIndex = i + 1;

    if (onProgress) {
      onProgress({
        areaIndex,
        totalAreas,
        phase: 'locations',
        completedTiles: 0,
        totalTiles: 0,
        syncedLocations: totalLocations,
      });
    }

    // 1. Hent oppdaterte lokaliteter fra AO API og oppdater IndexedDB
    let fetchedSites = [];
    if (typeof deps.fetchSitesByBounds === 'function') {
      try {
        fetchedSites = await deps.fetchSitesByBounds(bounds);
      } catch {
        fetchedSites = [];
      }
    }

    const existingInArea = await getOfflineLocationsInBounds(bounds).catch(() => []);
    const ownPrivateInBounds = filterSitesInBounds(cachedPrivateSites, bounds);

    const filteredSites = filterSitesForOfflineDownload(mergeCachedSites(existingInArea, fetchedSites), [], {
      isLoggedIn,
      showOthersPrivate,
      cachedPrivateSites: ownPrivateInBounds,
    });
    const sitesInArea = filterSitesInBounds(filteredSites, bounds);

    const savedInfo = await saveOfflineAreaLocations(bounds, sitesInArea, { showOthersPrivate });
    totalLocations += savedInfo.savedCount;

    // 2. Beregn og last ned eventuelle manglende kartfliser for området (kun offline-zoom levels)
    // Alltid Kartverket Topo (samme som «Last ned område» i kartet). Den gamle OSM-malen
    // inneholdt en ikke-erstattet {s}, så alle flisene feilet stille ved synkronisering.
    const template = deps.tileUrlTemplate || KARTVERKET_TOPO_URL_TEMPLATE;
    const tiles = calculateTilesForBounds(bounds, OFFLINE_ZOOM_LEVELS, template);
    if (onProgress) {
      onProgress({
        areaIndex,
        totalAreas,
        phase: 'tiles',
        completedTiles: 0,
        totalTiles: tiles.length,
        syncedLocations: totalLocations,
      });
    }

    const tileSummary = await downloadTilesInBatches(tiles, {
      batchSize: MAX_TILE_BATCH_SIZE,
      cacheName: MAP_TILE_CACHE_NAME,
      cacheStorage: deps.cacheStorage,
      fetchFn: deps.fetchTileFn,
      onProgress: ({ completed, total }) => {
        if (onProgress) {
          onProgress({
            areaIndex,
            totalAreas,
            phase: 'tiles',
            completedTiles: completed,
            totalTiles: total,
            syncedLocations: totalLocations,
          });
        }
      },
    });

    totalTilesCached += tileSummary.cached;
    syncedAreas += 1;
  }

  return {
    syncedAreas,
    totalLocations,
    totalTilesCached,
  };
}

/**
 * Tøm offline-databasen manuelt (kun ved eksplisitt brukerhandling eller i tester).
 * Kalles ALDRI automatisk.
 * @returns {Promise<void>}
 */
export async function clearOfflineDatabase() {
  memoryFallback.areas.clear();
  memoryFallback.locations.clear();

  const db = await openOfflineDb().catch(() => null);
  if (!db) return;

  await new Promise((resolve, reject) => {
    const tx = db.transaction([OFFLINE_AREAS_STORE, OFFLINE_LOCATIONS_STORE], 'readwrite');
    tx.objectStore(OFFLINE_AREAS_STORE).clear();
    tx.objectStore(OFFLINE_LOCATIONS_STORE).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Slett ALLE offline-data (både IndexedDB for lokaliteter/områder og Service Worker Cache API for kartfliser).
 * Må KUN kalles når brukeren eksplisitt har bekreftet sletting i sikkerhetsmodalen.
 *
 * @param {Object} [options={}]
 * @param {CacheStorage|null} [options.cacheStorage] - overstyrbar window.caches (for tester)
 * @param {string} [options.cacheName=MAP_TILE_CACHE_NAME]
 * @returns {Promise<{ clearedLocations: boolean, clearedTiles: boolean }>}
 */
export async function clearAllOfflineData(options = {}) {
  await clearOfflineDatabase();

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('ao_bbox_cache_v1');
    }
  } catch {
    // Ignorer localStorage-feil
  }

  const cacheName = options.cacheName || MAP_TILE_CACHE_NAME;
  const cacheStorage =
    options.cacheStorage !== undefined
      ? options.cacheStorage
      : typeof caches !== 'undefined'
        ? caches
        : null;

  let clearedTiles = false;
  if (cacheStorage && typeof cacheStorage.delete === 'function') {
    try {
      clearedTiles = await cacheStorage.delete(cacheName);
    } catch {
      clearedTiles = false;
    }
  }

  // Gjenopprett gjeldende nettverksmodus-flagg i Cache API / Service Worker
  await syncNetworkModeToServiceWorker(getNetworkMode()).catch(() => {});

  return {
    clearedLocations: true,
    clearedTiles: Boolean(clearedTiles),
  };
}

/**
 * Rydd app-cacher ved «Hent nyeste versjon» uten å slette lagrede offline-kartfliser.
 * Sikrer at kun «Slett offline-data» fjerner nedlastede kartfliser.
 *
 * @param {CacheStorage|null} [customCacheStorage]
 * @returns {Promise<Array<string>>} Liste med slettede cache-navn
 */
export async function clearAppCachesPreservingMapTiles(customCacheStorage) {
  const cacheStorage =
    customCacheStorage !== undefined
      ? customCacheStorage
      : typeof caches !== 'undefined'
        ? caches
        : null;

  if (!cacheStorage || typeof cacheStorage.keys !== 'function') {
    return [];
  }

  const keys = await cacheStorage.keys();
  const keysToDelete = (Array.isArray(keys) ? keys : []).filter(
    (key) => key !== MAP_TILE_CACHE_NAME,
  );

  await Promise.all(keysToDelete.map((key) => cacheStorage.delete(key)));
  return keysToDelete;
}


// Hver side som importerer denne modulen synkroniserer lagret modus til Service Worker
// ved innlasting, og følger med når en annen fane endrer modus.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e && e.key === NETWORK_MODE_KEY) {
      syncNetworkModeToServiceWorker(getNetworkMode()).catch(() => {});
    }
  });
  initNetworkModeAndServiceWorker().catch(() => {});
}
