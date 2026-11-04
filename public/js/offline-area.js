/**
 * Hjelpefunksjoner for valg av offline-område (bounding box) på kartet.
 * Håndterer konvertering mellom meter og bredde-/lengdegrad samt
 * begrensning til maks 10 × 10 km.
 */

import { haversine } from './utils.js';

export const MAX_OFFLINE_AREA_SIDE_M = 10000;
export const MIN_OFFLINE_AREA_SIDE_M = 250;
export const DEFAULT_OFFLINE_AREA_SIDE_M = 2500;
export const MAX_MAP_EXTENT_SIDE_M = 10000;
export const MAX_VIEWPORT_FETCH_SIDE_M = 20000;
export const MAX_DYNAMIC_FETCH_BOX_SIDE_M = 10000;

export const MIN_TILE_ZOOM = 10;
export const MAX_TILE_ZOOM = 16;
export const OFFLINE_ZOOM_LEVELS = [12, 15]; // Kun disse zoom-nivåene lastes ned for offline bruk
export const MAX_TILE_BATCH_SIZE = 10;
export const MAP_TILE_CACHE_NAME = 'enkel-ao-kartverket-tiles-v1';
export const KARTVERKET_TOPO_URL_TEMPLATE =
  'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png';

const EARTH_RADIUS_M = 6371000;
const WEB_MERCATOR_MAX_LAT = 85.05112878;

/**
 * Konverter breddegrad, lengdegrad og zoom-nivå til Web Mercator XYZ-fliskoordinater.
 * @param {number} lat
 * @param {number} lon
 * @param {number} zoom
 * @returns {{ x: number, y: number, z: number }}
 */
export function latLonToTileXY(lat, lon, zoom) {
  const z = Math.floor(Number(zoom));
  const n = Math.pow(2, z);
  const clampedLat = Math.max(-WEB_MERCATOR_MAX_LAT, Math.min(WEB_MERCATOR_MAX_LAT, Number(lat)));
  const normalizedLon = ((Number(lon) + 180) / 360) * n;
  const latRad = (clampedLat * Math.PI) / 180;
  const mercatorY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  const x = Math.min(n - 1, Math.max(0, Math.floor(normalizedLon)));
  const y = Math.min(n - 1, Math.max(0, Math.floor(mercatorY)));

  return { x, y, z };
}

/**
 * Bygg URL til Kartverket-flis for gitt { x, y, z }.
 * Merk at Kartverket WMTS bruker rekkefølgen /{z}/{y}/{x}.png.
 * @param {{ x: number, y: number, z: number }} tile
 * @param {string} [template=KARTVERKET_TOPO_URL_TEMPLATE]
 * @returns {string}
 */
export function formatKartverketTileUrl({ x, y, z }, template = KARTVERKET_TOPO_URL_TEMPLATE) {
  return String(template)
    .replace('{z}', String(z))
    .replace('{y}', String(y))
    .replace('{x}', String(x));
}

/**
 * Beregn alle kartfliser (XYZ-koordinater og URL) som trengs for å vise
 * valgt bounding box. Begrenset til spesifikke zoom-nivåer (standard 12 og 15).
 *
 * @param {{ north: number, south: number, east: number, west: number }} bounds
 * @param {Array<number>} [zoomLevels=OFFLINE_ZOOM_LEVELS]
 * @param {string} [urlTemplate=KARTVERKET_TOPO_URL_TEMPLATE]
 * @returns {Array<{ x: number, y: number, z: number, url: string }>}
 */
export function calculateTilesForBounds(
  bounds,
  zoomLevels = OFFLINE_ZOOM_LEVELS,
  urlTemplate = KARTVERKET_TOPO_URL_TEMPLATE,
) {
  if (!bounds || typeof bounds !== 'object') return [];
  const north = Number(bounds.north);
  const south = Number(bounds.south);
  const east = Number(bounds.east);
  const west = Number(bounds.west);
  if ([north, south, east, west].some((v) => Number.isNaN(v))) return [];

  const tiles = [];
  let zoomsToFetch;
  let activeTemplate = urlTemplate;

  if (Array.isArray(zoomLevels)) {
    zoomsToFetch = zoomLevels;
  } else if (typeof zoomLevels === 'number' && typeof urlTemplate === 'number') {
    const minZ = Math.max(MIN_TILE_ZOOM, Math.min(zoomLevels, urlTemplate));
    const maxZ = Math.min(MAX_TILE_ZOOM, Math.max(zoomLevels, urlTemplate));
    zoomsToFetch = [];
    for (let z = minZ; z <= maxZ; z += 1) {
      zoomsToFetch.push(z);
    }
    activeTemplate = KARTVERKET_TOPO_URL_TEMPLATE;
  } else {
    zoomsToFetch = OFFLINE_ZOOM_LEVELS;
  }

  for (const z of zoomsToFetch) {
    const nw = latLonToTileXY(north, west, z);
    const se = latLonToTileXY(south, east, z);

    const xMin = Math.min(nw.x, se.x);
    const xMax = Math.max(nw.x, se.x);
    const yMin = Math.min(nw.y, se.y);
    const yMax = Math.max(nw.y, se.y);

    for (let x = xMin; x <= xMax; x += 1) {
      for (let y = yMin; y <= yMax; y += 1) {
        tiles.push({
          x,
          y,
          z,
          url: formatKartverketTileUrl({ x, y, z }, activeTemplate),
        });
      }
    }
  }
  return tiles;
}

/**
 * Last ned kartfliser i sekvensielle puljer (batches) på maks 10 samtidige kall,
 * og lagre vellykkede svar i nettleserens Cache API (Service Worker-cache).
 * Venter til hele puljen er ferdig før neste pulje startes.
 *
 * @param {Array<{ x?: number, y?: number, z?: number, url?: string }|string>} tiles
 * @param {Object} [options={}]
 * @param {number} [options.batchSize=MAX_TILE_BATCH_SIZE] - Maks samtidige nedlastinger (begrenses til <= 10)
 * @param {string} [options.cacheName=MAP_TILE_CACHE_NAME] - Navn på Cache API-lager
 * @param {CacheStorage|null} [options.cacheStorage] - overstyrbar window.caches (for tester)
 * @param {Function|null} [options.fetchFn] - overstyrbar fetch-funksjon (for tester)
 * @param {Function|null} [options.onProgress] - callback ({ completed, total, cached, failed })
 * @returns {Promise<{ total: number, cached: number, failed: number }>}
 */
export async function downloadTilesInBatches(tiles, options = {}) {
  const list = Array.isArray(tiles) ? tiles : [];
  const total = list.length;
  if (total === 0) {
    return { total: 0, cached: 0, failed: 0 };
  }

  const requestedBatchSize = Number(options.batchSize) || MAX_TILE_BATCH_SIZE;
  const safeBatchSize = Math.max(1, Math.min(MAX_TILE_BATCH_SIZE, Math.floor(requestedBatchSize)));
  const cacheName = options.cacheName || MAP_TILE_CACHE_NAME;
  const cacheStorage =
    options.cacheStorage !== undefined
      ? options.cacheStorage
      : typeof caches !== 'undefined'
        ? caches
        : null;
  const fetchFn =
    options.fetchFn !== undefined
      ? options.fetchFn
      : typeof fetch === 'function'
        ? fetch.bind(globalThis)
        : null;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  let cache = null;
  if (cacheStorage && typeof cacheStorage.open === 'function') {
    try {
      cache = await cacheStorage.open(cacheName);
    } catch {
      cache = null;
    }
  }

  let completed = 0;
  let cached = 0;
  let failed = 0;

  for (let i = 0; i < total; i += safeBatchSize) {
    const batch = list.slice(i, i + safeBatchSize);

    await Promise.all(
      batch.map(async (tileItem) => {
        const url =
          typeof tileItem === 'string'
            ? tileItem
            : tileItem?.url || formatKartverketTileUrl(tileItem);

        try {
          if (cache && typeof cache.match === 'function') {
            const existing = await cache.match(url);
            if (existing) {
              cached += 1;
              return;
            }
          }

          if (!fetchFn) {
            failed += 1;
            return;
          }

          const response = await fetchFn(url, { mode: 'cors', credentials: 'omit' });
          if (response && (response.ok || response.type === 'opaque')) {
            if (cache && typeof cache.put === 'function') {
              const toStore = typeof response.clone === 'function' ? response.clone() : response;
              await cache.put(url, toStore);
            }
            cached += 1;
          } else {
            failed += 1;
          }
        } catch {
          failed += 1;
        } finally {
          completed += 1;
          if (onProgress) {
            onProgress({ completed, total, cached, failed });
          }
        }
      }),
    );
  }

  return { total, cached, failed };
}

/**
 * Konverter meter i nord/sør-retning til breddegrader (delta lat).
 * @param {number} meters
 * @returns {number}
 */
export function metersToLatDegrees(meters) {
  return (meters / EARTH_RADIUS_M) * (180 / Math.PI);
}

/**
 * Konverter meter i øst/vest-retning til lengdegrader (delta lon) ved gitt breddegrad.
 * @param {number} meters
 * @param {number} lat
 * @returns {number}
 */
export function metersToLonDegrees(meters, lat) {
  const cosLat = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  return (meters / (EARTH_RADIUS_M * cosLat)) * (180 / Math.PI);
}

/**
 * Beregn bredde (øst–vest) og høyde (nord–sør) i meter for en gitt bounding box.
 * @param {{ north: number, south: number, east: number, west: number }} bounds
 * @returns {{ widthM: number, heightM: number }}
 */
export function getBoundsDimensionsMeters(bounds) {
  const midLat = (bounds.north + bounds.south) / 2;
  const midLon = (bounds.east + bounds.west) / 2;
  const heightM = haversine(bounds.south, midLon, bounds.north, midLon) || 0;
  const widthM = haversine(midLat, bounds.west, midLat, bounds.east) || 0;
  return { widthM, heightM };
}

/**
 * Opprett en bounding box sentrert på (centerLat, centerLon) med gitt bredde og høyde i meter.
 * Bredde og høyde clampes automatisk til [MIN_OFFLINE_AREA_SIDE_M, MAX_OFFLINE_AREA_SIDE_M].
 *
 * @param {number} centerLat
 * @param {number} centerLon
 * @param {number} [widthM=DEFAULT_OFFLINE_AREA_SIDE_M]
 * @param {number} [heightM=DEFAULT_OFFLINE_AREA_SIDE_M]
 * @returns {{ north: number, south: number, east: number, west: number }}
 */
export function createCenteredBounds(
  centerLat,
  centerLon,
  widthM = DEFAULT_OFFLINE_AREA_SIDE_M,
  heightM = DEFAULT_OFFLINE_AREA_SIDE_M,
) {
  const clampedW = Math.min(MAX_OFFLINE_AREA_SIDE_M, Math.max(MIN_OFFLINE_AREA_SIDE_M, widthM));
  const clampedH = Math.min(MAX_OFFLINE_AREA_SIDE_M, Math.max(MIN_OFFLINE_AREA_SIDE_M, heightM));

  const halfLat = metersToLatDegrees(clampedH / 2);
  const halfLon = metersToLonDegrees(clampedW / 2, centerLat);

  return {
    north: centerLat + halfLat,
    south: centerLat - halfLat,
    east: centerLon + halfLon,
    west: centerLon - halfLon,
  };
}

/**
 * Opprett en geografisk utstrekningsboks (f.eks. 10 × 10 km for maks kartutsnitt)
 * rundt et gitt senterpunkt uten 5 km-clamping.
 * @param {number} centerLat
 * @param {number} centerLon
 * @param {number} [sideMeters=MAX_MAP_EXTENT_SIDE_M]
 * @returns {{ north: number, south: number, east: number, west: number }}
 */
export function createExtentBounds(
  centerLat,
  centerLon,
  sideMeters = MAX_MAP_EXTENT_SIDE_M,
) {
  const halfLat = metersToLatDegrees(sideMeters / 2);
  const halfLon = metersToLonDegrees(sideMeters / 2, centerLat);
  return {
    north: centerLat + halfLat,
    south: centerLat - halfLat,
    east: centerLon + halfLon,
    west: centerLon - halfLon,
  };
}

/**
 * Flytt en eksisterende bounding box til et nytt senterpunkt og behold bredde/høyde i meter.
 * @param {{ north: number, south: number, east: number, west: number }} bounds
 * @param {number} newCenterLat
 * @param {number} newCenterLon
 * @returns {{ north: number, south: number, east: number, west: number }}
 */
export function moveBoundsToCenter(bounds, newCenterLat, newCenterLon) {
  const { widthM, heightM } = getBoundsDimensionsMeters(bounds);
  return createCenteredBounds(newCenterLat, newCenterLon, widthM, heightM);
}

/**
 * Skalér et hjørne av utvalgsboksen med motsatt hjørne som fast ankerpunkt.
 * Sikrer at boksen aldri blir større enn 5 × 5 km (MAX_OFFLINE_AREA_SIDE_M)
 * eller mindre enn MIN_OFFLINE_AREA_SIDE_M, og at hjørnet ikke vrenger boksen.
 *
 * @param {{ north: number, south: number, east: number, west: number }} currentBounds
 * @param {'nw'|'ne'|'se'|'sw'} corner - Hvilket hjørne brukeren drar i
 * @param {{ lat: number, lon: number }} targetLatLng - Ny ønsket posisjon for hjørnet
 * @returns {{ bounds: { north: number, south: number, east: number, west: number }, clamped: boolean, widthM: number, heightM: number }}
 */
export function resizeBoundsFromCorner(currentBounds, corner, targetLatLng) {
  const movesNorth = corner === 'nw' || corner === 'ne';
  const movesEast = corner === 'ne' || corner === 'se';

  const anchorLat = movesNorth ? currentBounds.south : currentBounds.north;
  const anchorLon = movesEast ? currentBounds.west : currentBounds.east;

  const minDeltaLat = metersToLatDegrees(MIN_OFFLINE_AREA_SIDE_M);
  const maxDeltaLat = metersToLatDegrees(MAX_OFFLINE_AREA_SIDE_M);

  let clamped = false;

  // Beregn ny breddegrad (nord eller sør) relativt til ankeret
  let newLat = targetLatLng.lat;
  let rawDeltaLat = movesNorth ? newLat - anchorLat : anchorLat - newLat;
  if (rawDeltaLat < minDeltaLat) {
    rawDeltaLat = minDeltaLat;
  } else if (rawDeltaLat > maxDeltaLat) {
    rawDeltaLat = maxDeltaLat;
    clamped = true;
  }
  newLat = movesNorth ? anchorLat + rawDeltaLat : anchorLat - rawDeltaLat;

  const north = movesNorth ? newLat : anchorLat;
  const south = movesNorth ? anchorLat : newLat;
  const midLat = (north + south) / 2;

  // Beregn ny lengdegrad (øst eller vest) relativt til ankeret ved ny midLat
  const minDeltaLon = metersToLonDegrees(MIN_OFFLINE_AREA_SIDE_M, midLat);
  const maxDeltaLon = metersToLonDegrees(MAX_OFFLINE_AREA_SIDE_M, midLat);

  let newLon = targetLatLng.lon;
  let rawDeltaLon = movesEast ? newLon - anchorLon : anchorLon - newLon;
  if (rawDeltaLon < minDeltaLon) {
    rawDeltaLon = minDeltaLon;
  } else if (rawDeltaLon > maxDeltaLon) {
    rawDeltaLon = maxDeltaLon;
    clamped = true;
  }
  newLon = movesEast ? anchorLon + rawDeltaLon : anchorLon - rawDeltaLon;

  const east = movesEast ? newLon : anchorLon;
  const west = movesEast ? anchorLon : newLon;

  const bounds = { north, south, east, west };
  const { widthM, heightM } = getBoundsDimensionsMeters(bounds);

  return {
    bounds,
    clamped,
    widthM,
    heightM,
  };
}

/**
 * Filtrer lokaliteter som befinner seg innenfor en gitt bounding box.
 * @param {Array} sites
 * @param {{ north: number, south: number, east: number, west: number }} bounds
 * @returns {Array}
 */
export function filterSitesInBounds(sites, bounds) {
  if (!Array.isArray(sites) || !bounds) return [];
  return sites.filter((site) => {
    if (!site) return false;
    const lat = parseFloat(site.lat);
    const lon = parseFloat(site.lon);
    if (isNaN(lat) || isNaN(lon)) return false;
    return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
  });
}

/**
 * Bestem navn på et offline-område basert på navnet på superlokaliteten
 * med flest underlokaliteter innenfor området.
 * Dersom ingen superlokalitet har underlokaliteter, velges en eventuell
 * superlokalitet i området, eller en passende lokasjon/kommune/standardnavn.
 *
 * @param {Array<Object>} sitesInArea - Lokaliteter innenfor området
 * @param {Array<Object>} [allKnownSites=[]] - Kjente lokaliteter (brukes for oppslag av parent-navn)
 * @returns {string} Områdenavn
 */
export function determineAreaName(sitesInArea, allKnownSites = []) {
  const sites = Array.isArray(sitesInArea) ? sitesInArea.filter(Boolean) : [];
  if (sites.length === 0) {
    return 'Nedlastet område';
  }

  const allSites = [...sites, ...(Array.isArray(allKnownSites) ? allKnownSites.filter(Boolean) : [])];
  const sitesById = new Map();
  allSites.forEach((s) => {
    if (s && s.id != null) {
      sitesById.set(String(s.id), s);
    }
  });

  // Tell opp underlokaliteter innenfor området per superlokalitet (parentId)
  const subCountPerSuper = new Map(); // superId -> count
  const superNameMap = new Map(); // superId -> name

  // Registrer kjente superlokaliteter
  allSites.forEach((s) => {
    if (s && s.id != null && (s.isSuper === true || s.is_super === 1 || s.is_super === true)) {
      const sid = String(s.id);
      if (s.name) superNameMap.set(sid, s.name);
      if (!subCountPerSuper.has(sid)) subCountPerSuper.set(sid, 0);
    }
  });

  // Gå gjennom alle lokaliteter i området og finn parentId
  sites.forEach((site) => {
    const raw = site.raw && typeof site.raw === 'object' ? site.raw : {};
    const parentId =
      site.parentId != null
        ? String(site.parentId)
        : raw.parentId != null
          ? String(raw.parentId)
          : raw.parentSiteId != null
            ? String(raw.parentSiteId)
            : null;

    if (parentId) {
      subCountPerSuper.set(parentId, (subCountPerSuper.get(parentId) || 0) + 1);

      if (!superNameMap.has(parentId)) {
        const parentSite = sitesById.get(parentId);
        if (parentSite && parentSite.name) {
          superNameMap.set(parentId, parentSite.name);
        } else if (site.parentName || raw.parentName || raw.parentSiteName) {
          superNameMap.set(parentId, site.parentName || raw.parentName || raw.parentSiteName);
        }
      }
    }
  });

  // Finn superlokaliteten med flest underlokaliteter (> 0)
  let bestSuperId = null;
  let maxCount = 0;
  for (const [superId, count] of subCountPerSuper.entries()) {
    if (count > maxCount) {
      maxCount = count;
      bestSuperId = superId;
    }
  }

  if (bestSuperId && maxCount > 0 && superNameMap.has(bestSuperId)) {
    return superNameMap.get(bestSuperId);
  }

  // Hvis ingen superlokalitet har underlokaliteter, se etter superlokalitet som ligger i området
  const superInArea = sites.find((s) => s.isSuper === true || s.is_super === 1 || s.is_super === true);
  if (superInArea && superInArea.name) {
    return superInArea.name;
  }

  // Fallback 1: Første navngitte offentlige lokalitet eller lokalitet i området
  const namedSite = sites.find((s) => s.name && !s.isPrivate) || sites.find((s) => s.name);
  if (namedSite && namedSite.name) {
    return namedSite.name;
  }

  // Fallback 2: Kommune
  const withMunicipality = sites.find((s) => s.municipality || s.raw?.municipalityName);
  if (withMunicipality) {
    return withMunicipality.municipality || withMunicipality.raw?.municipalityName;
  }

  return 'Nedlastet område';
}

/**
 * Sjekk om en lokalitet er markert som privat i AO-dataene.
 * @param {Object} site
 * @returns {boolean}
 */
function checkSitePrivate(site) {
  if (!site || typeof site !== 'object') return false;
  if (site.isPrivate === true || site.isPrivate === 'true') return true;
  if (site.isPrivate === false || site.isPrivate === 'false') return false;
  if (site.IsPrivate === true || site.IsPrivate === 'true') return true;
  if (site.IsPrivate === false || site.IsPrivate === 'false') return false;

  const raw = site.raw && typeof site.raw === 'object' ? site.raw : null;
  if (raw) {
    if (raw.isPrivate === true || raw.isPrivate === 'true') return true;
    if (raw.isPrivate === false || raw.isPrivate === 'false') return false;
    if (raw.IsPrivate === true || raw.IsPrivate === 'true') return true;
    if (raw.IsPrivate === false || raw.IsPrivate === 'false') return false;
  }
  return false;
}

/**
 * Er dette en privat lokalitet som IKKE tilhører brukeren? (Andres private.)
 * @param {Object} site
 * @returns {boolean}
 */
export function isOthersPrivateSite(site) {
  if (!site || typeof site !== 'object') return false;
  return checkSitePrivate(site) && !site.isMine;
}

/**
 * Fjern andres private lokaliteter, med mindre «Vis andres private lokasjoner» er på.
 * Brukerens egne private (`isMine`) og alle offentlige beholdes alltid.
 * Felles regel for ALT som lagres til eller leses fra offline-databasen.
 * @param {Array} sites
 * @param {boolean} showOthersPrivate
 * @returns {Array}
 */
export function dropOthersPrivateSites(sites, showOthersPrivate = false) {
  const list = Array.isArray(sites) ? sites : [];
  if (showOthersPrivate) return list;
  return list.filter((s) => !isOthersPrivateSite(s));
}

/** Slå sammen delvise cachetreff med ferske treff; nettverkets versjon vinner. */
export function mergeCachedSites(cachedSites, networkSites) {
  const merged = new Map();
  for (const site of [...(Array.isArray(cachedSites) ? cachedSites : []), ...(Array.isArray(networkSites) ? networkSites : [])]) {
    if (!site) continue;
    const key = site.id != null ? `id:${site.id}` : `${site.name}::${site.lat}::${site.lon}`;
    merged.set(key, site);
  }
  return Array.from(merged.values());
}

/**
 * Filtrer og slå sammen lokaliteter for nedlasting til offline-bruk.
 * Regler:
 * - Offentlige lokaliteter lastes alltid ned.
 * - Dersom brukeren ikke er innlogget (`isLoggedIn = false`), lastes kun offentlige
 *   lokaliteter ned (med mindre «Vis andres private lokasjoner» er valgt i innstillingene).
 * - Dersom brukeren er innlogget (`isLoggedIn = true`), lastes også brukerens
 *   egne private lokaliteter (`isMine`) ned i tillegg til offentlige lokaliteter.
 * - Unntak: Når «Vis andres private lokasjoner» (`showOthersPrivate = true`) er
 *   valgt i innstillingene, lastes alle lokaliteter (offentlige + private) ned.
 *
 * @param {Array} bboxSites - Lokaliteter hentet for bounding box
 * @param {Array} [fallbackSites=[]] - Fallback-lokaliteter dersom bboxSites er tom
 * @param {Object} [options={}]
 * @param {boolean} [options.isLoggedIn=false] - Om brukeren er innlogget på AO
 * @param {boolean} [options.showOthersPrivate=false] - Om «Vis andres private lokasjoner» er valgt
 * @param {Array} [options.cachedPrivateSites=[]] - Brukerens cachede egne private lokaliteter
 * @returns {Array}
 */
export function filterSitesForOfflineDownload(
  bboxSites,
  fallbackSites = [],
  { isLoggedIn = false, showOthersPrivate = false, cachedPrivateSites = [] } = {},
) {
  const baseList = (Array.isArray(bboxSites) && bboxSites.length > 0)
    ? bboxSites
    : (Array.isArray(fallbackSites) ? fallbackSites : []);

  const ownPrivateList = isLoggedIn && Array.isArray(cachedPrivateSites) ? cachedPrivateSites : [];
  const cachedIds = new Set(
    ownPrivateList
      .map((s) => (s && s.id != null ? String(s.id) : null))
      .filter(Boolean),
  );

  const marked = baseList
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      if (!isLoggedIn) {
        // Utlogget bruker har ingen egne private lokaliteter; hvis s.isMine var satt
        // (f.eks. fra server-miljøvariabel), regnes lokaliteten som en vanlig privat lokalitet.
        if (s.isMine) {
          return { ...s, isMine: false, isPrivate: true };
        }
        return s;
      }
      if (!s.isMine && s.id != null && cachedIds.has(String(s.id))) {
        return { ...s, isMine: true };
      }
      return s;
    })
    .filter(Boolean);

  let combined = marked;
  if (isLoggedIn && ownPrivateList.length > 0) {
    const existingIds = new Set(
      marked.map((s) => (s.id != null ? String(s.id) : null)).filter(Boolean),
    );
    const extraPrivate = ownPrivateList
      .filter((s) => s && s.id != null && !existingIds.has(String(s.id)))
      .map((s) => ({
        ...s,
        isMine: true,
        isPrivate: true,
        raw: s.raw || { ...s, isPrivate: true },
      }));
    combined = [...marked, ...extraPrivate];
  }

  return combined.filter((s) => {
    const priv = checkSitePrivate(s) || Boolean(s.isMine);
    if (!priv) return true; // Offentlige lokaliteter lastes alltid ned
    if (showOthersPrivate) return true; // Unntak: «Vis andres private lokasjoner» er valgt
    if (isLoggedIn && s.isMine) return true; // Innlogget bruker får med egne private lokaliteter
    return false;
  });
}

/**
 * Beregn om det skal hentes lokaliteter for nåværende synlige kartutsnitt,
 * og hvilken bounding box som skal sendes til API-et.
 *
 * Regler:
 * 1. 20×20 km-regelen: Dersom synlig bredde eller høyde er 20 km (20 000 m) eller mer,
 *    avbrytes innlastingen (`shouldFetch: false, fetchBounds: null`).
 * 2. 10×10 km-taket: Dersom synlig utsnitt er mindre enn 20×20 km, utløses innlasting:
 *    - Hvis bredde og høyde begge er <= 10 km, brukes det synlige utsnittet direkte.
 *    - Hvis bredde eller høyde overstiger 10 km (men begge er < 20 km), beregnes en
 *      streng 10×10 km bounding box sentrert nøyaktig på kartsenteret (`capped: true`).
 *
 * @param {{ north: number, south: number, east: number, west: number }} viewportBounds
 * @param {{ lat?: number, lon?: number, lng?: number }|null} [centerPosition=null]
 * @returns {{
 *   shouldFetch: boolean,
 *   fetchBounds: { north: number, south: number, east: number, west: number }|null,
 *   capped: boolean,
 *   widthM: number,
 *   heightM: number
 * }}
 */
export function computeDynamicFetchBounds(viewportBounds, centerPosition = null) {
  if (!viewportBounds || typeof viewportBounds !== 'object') {
    return { shouldFetch: false, fetchBounds: null, capped: false, widthM: 0, heightM: 0 };
  }

  const north = Number(viewportBounds.north);
  const south = Number(viewportBounds.south);
  const east = Number(viewportBounds.east);
  const west = Number(viewportBounds.west);

  if (
    [north, south, east, west].some((v) => !Number.isFinite(v)) ||
    north <= south ||
    east <= west
  ) {
    return { shouldFetch: false, fetchBounds: null, capped: false, widthM: 0, heightM: 0 };
  }

  const normalizedViewport = { north, south, east, west };
  const { widthM, heightM } = getBoundsDimensionsMeters(normalizedViewport);

  // 20x20 km-regelen: avbryt dersom bredde eller høyde er 20 km eller mer
  if (
    Math.round(widthM) >= MAX_VIEWPORT_FETCH_SIDE_M ||
    Math.round(heightM) >= MAX_VIEWPORT_FETCH_SIDE_M
  ) {
    return {
      shouldFetch: false,
      fetchBounds: null,
      capped: false,
      widthM,
      heightM,
    };
  }

  const rawCenterLat = centerPosition?.lat;
  const rawCenterLon = centerPosition?.lon ?? centerPosition?.lng;
  const centerLat =
    typeof rawCenterLat === 'number' && Number.isFinite(rawCenterLat)
      ? rawCenterLat
      : (north + south) / 2;
  const centerLon =
    typeof rawCenterLon === 'number' && Number.isFinite(rawCenterLon)
      ? rawCenterLon
      : (east + west) / 2;

  // 10x10 km-taket: dersom synlig område overstiger 10 km i bredde eller høyde,
  // begrens API-forespørselen til en streng 10x10 km boks sentrert på kartsenteret.
  if (
    Math.round(widthM) > MAX_DYNAMIC_FETCH_BOX_SIDE_M ||
    Math.round(heightM) > MAX_DYNAMIC_FETCH_BOX_SIDE_M
  ) {
    const fetchBounds = createExtentBounds(centerLat, centerLon, MAX_DYNAMIC_FETCH_BOX_SIDE_M);
    return {
      shouldFetch: true,
      fetchBounds,
      capped: true,
      widthM,
      heightM,
    };
  }

  return {
    shouldFetch: true,
    fetchBounds: normalizedViewport,
    capped: false,
    widthM,
    heightM,
  };
}

/**
 * Utfør dynamisk innlasting av lokaliteter for synlig kartutsnitt i tråd med
 * 20×20 km-regelen, 10×10 km-taket, valgt nettverksmodus (online/hybrid/offline)
 * og autentiseringsreglene for offentlige/private lokaliteter.
 *
 * @param {{ north: number, south: number, east: number, west: number }} viewportBounds
 * @param {{ lat?: number, lon?: number, lng?: number }|null} centerPosition
 * @param {Object} [deps={}]
 * @param {'online'|'hybrid'|'offline'} [deps.networkMode] - eksplisitt nettverksmodus
 * @param {Function} [deps.getNetworkMode] - returnerer 'online' | 'hybrid' | 'offline'
 * @param {Function} [deps.getOfflineLocationsInBounds] - async funksjon som henter lagrede lokaliteter fra IndexedDB for bounds
 * @param {Function} [deps.checkLoggedIn] - returnerer boolean om brukeren er innlogget
 * @param {Function} [deps.ensureTokens] - async funksjon som sikrer gyldige AO-tokens
 * @param {Function} [deps.fetchSitesByBounds] - async funksjon som henter lokaliteter for bounding box
 * @param {Function} [deps.getShowOthersPrivate] - returnerer boolean om andres private lokaliteter skal vises
 * @param {Function} [deps.getPrivateSitesCache] - returnerer array med brukerens egne cachede private lokaliteter
 * @returns {Promise<{
 *   shouldFetch: boolean,
 *   fetchBounds: { north: number, south: number, east: number, west: number }|null,
 *   capped: boolean,
 *   widthM: number,
 *   heightM: number,
 *   sites: Array,
 *   source?: 'network'|'cache'|'none',
 *   mode?: 'online'|'hybrid'|'offline'
 * }>}
 */
export async function fetchDynamicViewportSites(viewportBounds, centerPosition, deps = {}) {
  let rawMode = deps.networkMode;
  if (!rawMode && typeof deps.getNetworkMode === 'function') {
    rawMode = deps.getNetworkMode();
  }
  if (!rawMode && typeof localStorage !== 'undefined') {
    try {
      rawMode =
        localStorage.getItem('network_mode_v1') ||
        (localStorage.getItem('offline_mode_v1') === '1' ? 'offline' : 'hybrid');
    } catch {
      rawMode = 'hybrid';
    }
  }
  const mode =
    rawMode === 'hybrid' || rawMode === 'offline' || rawMode === 'online' ? rawMode : 'hybrid';

  const plan = computeDynamicFetchBounds(viewportBounds, centerPosition);
  if (!plan.shouldFetch || !plan.fetchBounds) {
    return {
      ...plan,
      sites: [],
      source: 'none',
      mode,
    };
  }

  // 1. Streng Offline-modus (Cache-Only): Aldri bruk nettverk
  if (mode === 'offline') {
    const cachedSites =
      typeof deps.getOfflineLocationsInBounds === 'function'
        ? await deps.getOfflineLocationsInBounds(plan.fetchBounds)
        : [];
    return {
      ...plan,
      sites: Array.isArray(cachedSites) ? cachedSites : [],
      source: 'cache',
      mode,
    };
  }

  // Delvise treff er supplement/fallback, ikke bevis på komplett dekning.
  let cachedSites = [];
  if (mode === 'hybrid' && typeof deps.getOfflineLocationsInBounds === 'function') {
    cachedSites = await deps.getOfflineLocationsInBounds(plan.fetchBounds).catch(() => []);
  }

  try {
    // 3. Online-modus (Network-First) eller Hybrid fallback til nettverk
    let isLoggedIn = typeof deps.checkLoggedIn === 'function' ? Boolean(deps.checkLoggedIn()) : false;
    if (isLoggedIn && typeof deps.ensureTokens === 'function') {
      const tokenOk = await deps.ensureTokens();
      if (typeof tokenOk === 'boolean') {
        isLoggedIn = tokenOk;
      }
    }

    const rawSites =
      typeof deps.fetchSitesByBounds === 'function'
        ? await deps.fetchSitesByBounds(plan.fetchBounds)
        : [];

    const showOthersPrivate =
      typeof deps.getShowOthersPrivate === 'function' ? Boolean(deps.getShowOthersPrivate()) : false;
    const allCachedPrivate =
      isLoggedIn && typeof deps.getPrivateSitesCache === 'function'
        ? deps.getPrivateSitesCache()
        : [];
    const ownPrivateInBounds = filterSitesInBounds(allCachedPrivate, plan.fetchBounds);

    const filtered = filterSitesForOfflineDownload(mergeCachedSites(cachedSites, rawSites), [], {
      isLoggedIn,
      showOthersPrivate,
      cachedPrivateSites: ownPrivateInBounds,
    });

    const sites = filterSitesInBounds(filtered, plan.fetchBounds);

    if (sites.length > 0 && typeof deps.saveOpportunisticLocations === 'function') {
      try {
        await deps.saveOpportunisticLocations(sites, plan.fetchBounds);
      } catch {
        // Ignorer lagringsfeil slik at kartvisningen aldri blokkeres
      }
    }

    return {
      ...plan,
      sites,
      source: Array.isArray(rawSites) && rawSites.length > 0 ? 'network' : 'cache',
      mode,
    };
  } catch (err) {
    if (cachedSites.length > 0) return { ...plan, sites: cachedSites, source: 'cache', mode };
    throw err;
  }
}
