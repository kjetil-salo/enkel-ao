/**
 * Kart-modul for visning av brukerposisjon og AO-lokaliteter
 */

// Versjonert import
import { createAoSite, ensureAoTokens, fetchAoSitesCached, fetchAoSitesByBounds, getCachedPrivateSites, hasActiveAoLogin } from './api.js?v=v1.59.4';
import { mergeAoSitesWithPrivateCache, isPrivateSite, shouldShowOthersPrivateSites, DEFAULT_MAP_CENTER } from './location.js?v=v1.59.4';
import { saveLastKnownPosition, loadLastKnownPosition } from './storage.js?v=v1.59.4';
import { haversine } from './utils.js';
import {
  DEFAULT_OFFLINE_AREA_SIDE_M,
  KARTVERKET_TOPO_URL_TEMPLATE,
  MAP_TILE_CACHE_NAME,
  MAX_TILE_BATCH_SIZE,
  OFFLINE_ZOOM_LEVELS,
  calculateTilesForBounds,
  computeDynamicFetchBounds,
  createCenteredBounds,
  downloadTilesInBatches,
  fetchDynamicViewportSites,
  filterSitesForOfflineDownload,
  filterSitesInBounds,
  getBoundsDimensionsMeters,
  moveBoundsToCenter,
  resizeBoundsFromCorner,
} from './offline-area.js?v=v1.59.4';
import {
  getNetworkMode,
  isOfflineMode,
  isHybridMode,
  saveOfflineAreaLocations,
  saveOpportunisticOfflineLocations,
  getAllOfflineLocations,
  getOfflineLocationsInBounds,
  getOfflineStorageStats,
  syncOfflineAreas,
  clearAllOfflineData,
  syncNetworkModeToServiceWorker,
} from './offline-db.js?v=v1.59.4';

// Hent data fra localStorage — fall tilbake til Svortland, Bømlo dersom mapData mangler
let data = {};
try {
  const rawMapData = localStorage.getItem('mapData');
  if (rawMapData) {
    data = JSON.parse(rawMapData) || {};
  }
} catch (e) {
  console.warn('Kunne ikke lese mapData fra localStorage, bruker standard kartsenter:', e);
}

const hasValidUserPos = Boolean(
  data.userPosition
    && typeof data.userPosition.lat === 'number' && !isNaN(data.userPosition.lat)
    && typeof data.userPosition.lon === 'number' && !isNaN(data.userPosition.lon)
);

let isUserPositionAvailable = hasValidUserPos && !data.userPosition.isFallback;

if (isUserPositionAvailable) {
  saveLastKnownPosition(data.userPosition);
}

let lastMapCenter = null;
try {
  const storedMapCenter = localStorage.getItem('lastMapCenter_v1');
  if (storedMapCenter) lastMapCenter = JSON.parse(storedMapCenter);
} catch (e) {}

const lastKnown = loadLastKnownPosition();

// Pri 1: GPS, Pri 2: Førre aktive kart-lokasjon, Pri 3: Sist kjende/Svortland
let userPosition;
if (isUserPositionAvailable) {
  userPosition = { ...data.userPosition };
} else if (lastMapCenter && typeof lastMapCenter.lat === 'number' && typeof lastMapCenter.lon === 'number') {
  userPosition = { ...lastMapCenter, isFallback: true };
} else if (lastKnown && typeof lastKnown.lat === 'number' && typeof lastKnown.lon === 'number') {
  userPosition = { ...lastKnown, isFallback: true, isLastKnown: true };
} else {
  userPosition = { ...DEFAULT_MAP_CENTER, isFallback: true };
}

const sites = Array.isArray(data.sites) ? data.sites : [];
const sizeMeters = (typeof data.sizeMeters === 'number' && data.sizeMeters > 0) ? data.sizeMeters : 1000;

const missingLocationBanner = document.getElementById('missing-location-banner');
if (missingLocationBanner) {
  if (!isUserPositionAvailable) {
    missingLocationBanner.textContent = 'Din posisjon er ikke tilgjengelig';
    missingLocationBanner.style.display = 'block';
  } else {
    missingLocationBanner.style.display = 'none';
  }
}

const GEOLOCATION_ZOOM_LEVEL = 15;
// Første ferske GPS-fiks etter at kartet åpnes sentrerer alltid kartet på brukeren (zoom 15),
// også når kartet startet på en lagret posisjon. Utsettes hvis brukeren allerede har tatt i kartet.
let initialGpsZoomDone = false;
let userHasMovedMap = false;

function initMap(centerPosition) {
  const centerLat = (centerPosition && typeof centerPosition.lat === 'number' && !isNaN(centerPosition.lat)) ? centerPosition.lat : DEFAULT_MAP_CENTER.lat;
  const centerLon = (centerPosition && typeof centerPosition.lon === 'number' && !isNaN(centerPosition.lon)) ? centerPosition.lon : DEFAULT_MAP_CENTER.lon;
  const initialZoom = 15; // Alltid nivå 15 som standard

  const mapInstance = L.map('map', {
    minZoom: 0,
    maxZoom: 19,
  }).setView([centerLat, centerLon], initialZoom);

  return mapInstance;
}

syncNetworkModeToServiceWorker(getNetworkMode()).catch(() => {});

/**
 * Generer en manglende flis dynamisk fra fliser som ligger i cachen (over-/underzooming
 * med Canvas). Brukes når bare enkelte zoom-nivåer (12 og 15) er lastet ned.
 *
 * - Overzoom: etterspurt nivå er høyere enn cachet nivå → klipp ut og forstørr delen av
 *   foreldreflisen som dekker flisen.
 * - Underzoom: etterspurt nivå er lavere enn cachet nivå → sett sammen 2×2, 4×4 eller 8×8
 *   barnefliser. Mangler noen barn (kanten av et nedlastet område), fylles hullene med
 *   overzoom fra et lavere nivå i stedet for å la flisen stå halvtom.
 */
// Kartmaler brukt av cache-oppslaget (må stå FØR kartlagene lages — første flis lages umiddelbart).
const OSM_URL_TEMPLATE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const KARTVERKET_GRAYSCALE_URL_TEMPLATE =
  'https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png';

const FALLBACK_MIN_ZOOM = 8;
const FALLBACK_MAX_ZOOM = 19;
const FALLBACK_MAX_UNDERZOOM_SCALE = 8; // 8×8 = 64 barnefliser
const TILE_PX = 256;

// Små minne-cacher: avkodede bilder (foreldrefliser gjenbrukes av mange nabofliser) og
// ferdige fallback-fliser (Leaflet ber om samme flis igjen ved panorering).
const decodedTileImages = new Map();
const generatedFallbackTiles = new Map();

function rememberBounded(map, key, value, max) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
}

/** Hent og avkod en flis fra cachen. Returnerer null hvis den mangler eller er ubrukelig. */
function loadCachedTileImage(url, cache) {
  if (decodedTileImages.has(url)) {
    const hit = decodedTileImages.get(url);
    rememberBounded(decodedTileImages, url, hit, 48); // «nylig brukt»
    return hit;
  }
  const promise = (async () => {
    const resp = await cache.match(url);
    // Opake svar (no-cors) kan ikke leses til Canvas — blob() blir tom.
    if (!resp || resp.type === 'opaque') return null;
    const blob = await resp.blob();
    if (!blob || blob.size === 0) return null;
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image load error'));
        img.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  })().catch(() => null);
  rememberBounded(decodedTileImages, url, promise, 48);
  return promise;
}

function newTileCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  return canvas;
}

/** Forstørr riktig del av foreldreflisen (cachet nivå fz) til en flis på nivå coords.z. */
async function buildOverzoomTile(coords, fz, getTileUrlFn, cache) {
  const scale = Math.pow(2, coords.z - fz);
  const img = await loadCachedTileImage(
    getTileUrlFn({ x: Math.floor(coords.x / scale), y: Math.floor(coords.y / scale), z: fz }),
    cache,
  );
  if (!img) return null;
  const srcW = (img.naturalWidth || TILE_PX) / scale;
  const srcH = (img.naturalHeight || TILE_PX) / scale;
  const canvas = newTileCanvas();
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    img,
    (coords.x % scale) * srcW,
    (coords.y % scale) * srcH,
    srcW,
    srcH,
    0,
    0,
    TILE_PX,
    TILE_PX,
  );
  return canvas;
}

/** Sett sammen barnefliser fra et høyere cachet nivå fz. */
async function buildUnderzoomTile(coords, fz, getTileUrlFn, cache) {
  const scale = Math.pow(2, fz - coords.z);
  if (scale > FALLBACK_MAX_UNDERZOOM_SCALE) return null;
  const size = TILE_PX / scale;
  const canvas = newTileCanvas();
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;

  const jobs = [];
  for (let dx = 0; dx < scale; dx++) {
    for (let dy = 0; dy < scale; dy++) {
      jobs.push(
        loadCachedTileImage(
          getTileUrlFn({ x: coords.x * scale + dx, y: coords.y * scale + dy, z: fz }),
          cache,
        ).then((img) => ({ img, dx, dy })),
      );
    }
  }
  const results = await Promise.all(jobs);
  let drawn = 0;
  results.forEach(({ img, dx, dy }) => {
    if (!img) return;
    ctx.drawImage(img, 0, 0, img.naturalWidth || TILE_PX, img.naturalHeight || TILE_PX, dx * size, dy * size, size, size);
    drawn++;
  });
  return { canvas, drawn, total: jobs.length };
}

async function getDynamicFallbackTile(coords, getTileUrlFn, cache) {
  if (typeof window === 'undefined' || !('caches' in window) || !cache) return null;

  const memoKey = getTileUrlFn(coords);
  if (generatedFallbackTiles.has(memoKey)) return generatedFallbackTiles.get(memoKey);

  // Nærmeste zoom-nivå først. Ved likt avstand prøves høyere nivå (skarpere) først.
  const zooms = [];
  for (let z = FALLBACK_MIN_ZOOM; z <= FALLBACK_MAX_ZOOM; z++) if (z !== coords.z) zooms.push(z);
  zooms.sort((a, b) => Math.abs(coords.z - a) - Math.abs(coords.z - b) || b - a);

  let partial = null; // beste ufullstendige underzoom-flis (med hull)
  let result = null;

  for (const fz of zooms) {
    try {
      if (fz < coords.z) {
        const over = await buildOverzoomTile(coords, fz, getTileUrlFn, cache);
        if (over) {
          // Lapp inn de barneflisene vi fant, oppå den forstørrede bakgrunnen.
          if (partial) over.getContext('2d').drawImage(partial.canvas, 0, 0);
          result = over;
          break;
        }
      } else {
        const under = await buildUnderzoomTile(coords, fz, getTileUrlFn, cache);
        if (under && under.drawn === under.total) {
          result = under.canvas;
          break;
        }
        if (under && under.drawn > 0 && (!partial || under.drawn > partial.drawn)) partial = under;
      }
    } catch (e) {
      console.warn('Fallback over-/underzoom feilet:', e);
    }
  }

  const isPartialResult = !result && Boolean(partial);
  if (isPartialResult) result = partial.canvas;
  const dataUrl = result ? result.toDataURL('image/png') : null;
  // Kun fullstendige fliser huskes; en flis med hull skal regnes ut på nytt.
  if (dataUrl && !isPartialResult) rememberBounded(generatedFallbackTiles, memoKey, dataUrl, 300);
  return dataUrl;
}

/** Tøm husket fallback-fliser (kalles etter nedlasting, så nye fliser blir brukt). */
function clearFallbackTileMemo() {
  generatedFallbackTiles.clear();
  decodedTileImages.clear();
}

// Gjennomsiktig 1×1 PNG: tom flis uten nettverkskall.
const BLANK_TILE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function createCachedTileLayer(urlTemplate, options = {}) {
  const CachedTileLayer = L.TileLayer.extend({
    createTile(coords, done) {
      const tile = document.createElement('img');
      L.DomEvent.on(tile, 'load', L.Util.bind(this._tileOnLoad, this, done, tile));
      L.DomEvent.on(tile, 'error', L.Util.bind(this._tileOnError, this, done, tile));

      if (this.options.crossOrigin || this.options.crossOrigin === '') {
        tile.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
      }
      tile.alt = '';
      tile.setAttribute('role', 'presentation');

      try {
        const url = this.getTileUrl(coords);
        const mode = getNetworkMode();
        const hasCaches = typeof window !== 'undefined' && 'caches' in window && window.caches;

        // Om me er online eller nettlesaren manglar støtte for Cache API, last flisa normalt
        if (mode === 'online' || !hasCaches) {
          tile.src = url;
          return tile;
        }

        window.caches.open(MAP_TILE_CACHE_NAME).then(async (cache) => {
          // Byggar korrekt URL-streng for kvar kartmal
          const buildUrl = (tpl, c) => {
            let u = tpl.replace(/\{z\}/g, c.z).replace(/\{x\}/g, c.x).replace(/\{y\}/g, c.y);
            if (u.includes('{s}')) {
              const s = 'abc'[Math.abs(c.x + c.y) % 3];
              u = u.replace(/\{s\}/g, s);
            }
            return u;
          };

          // Prioritet når flisa skal hentes fra cachen (offline/hybrid):
          //   valgt lag → 1. Kartverket Topo → 2. OpenStreetMap → 3. Kartverket Gråtone.
          // For hvert lag prøves først eksakt flis, så over-/underzoom fra cachede nivåer,
          // før neste lag. Topo brukes altså så langt det rekker, og OSM/Gråtone fyller hullene.
          const templatesToTry = [
            urlTemplate,
            KARTVERKET_TOPO_URL_TEMPLATE,
            OSM_URL_TEMPLATE,
            KARTVERKET_GRAYSCALE_URL_TEMPLATE,
          ].filter((t, idx, arr) => arr.indexOf(t) === idx);

          // Slår opp flisa i cachen. Returnerer en URL (blob: eller data:) eller null.
          const resolveFromCache = async () => {
            for (const tpl of templatesToTry) {
              // a) Eksakt flis i dette laget
              const exact = await cache.match(buildUrl(tpl, coords));
              if (exact && exact.type !== 'opaque') {
                const blob = await exact.blob();
                if (blob && blob.size > 0) {
                  const objectUrl = URL.createObjectURL(blob);
                  const revoke = () => URL.revokeObjectURL(objectUrl);
                  tile.addEventListener('load', revoke, { once: true });
                  tile.addEventListener('error', revoke, { once: true });
                  return objectUrl;
                }
              }
              // b) Mangler flisa for innstilt zoom-nivå: over-/underzoom fra cachede nivåer
              try {
                const dataUrl = await getDynamicFallbackTile(coords, (c) => buildUrl(tpl, c), cache);
                if (dataUrl) return dataUrl;
              } catch (e) {
                console.warn('Over-/underzoom feilet:', e);
              }
            }
            return null;
          };

          // Hybrid: la nettlesaren/tjenestearbeideren hente flisa fra nettverket.
          // Feilar det (ingen dekning), bruk det som ligger i cachen i stedet.
          if (mode === 'hybrid') {
            const exactSelected = await cache.match(url);
            if (exactSelected) {
              const resolved = await resolveFromCache();
              if (resolved) { tile.src = resolved; return; }
            }
            tile.addEventListener(
              'error',
              async () => {
                try {
                  const resolved = await resolveFromCache();
                  if (resolved) tile.src = resolved;
                } catch (_) { /* tile blir stående tom */ }
              },
              { once: true },
            );
            tile.src = url;
            return;
          }

          // Offline-modus (cache-only): aldri nettverk. Ingenting brukbart = tom flis.
          tile.src = (await resolveFromCache()) || BLANK_TILE_DATA_URL;
        }).catch(() => {
          // Cache API feilet. Offline: tom flis; ellers last normalt.
          tile.src = mode === 'offline' ? BLANK_TILE_DATA_URL : url;
        });
      } catch (err) {
        console.error("Kritisk feil under oppteikning av flis:", err);
        setTimeout(() => this._tileOnError(done, tile, err), 0);
      }

      return tile;
    },
  });

  return new CachedTileLayer(urlTemplate, options);
}

const map = initMap(userPosition);
['pointerdown', 'touchstart', 'wheel'].forEach((evt) => {
  map.getContainer().addEventListener(evt, () => { userHasMovedMap = true; }, { once: true, passive: true });
});

// Sikring: kartet skal åpne på nivå 15 (GPS, ellers sist brukte posisjon). Skjer det noe som
// zoomer ut de første sekundene — f.eks. gammel cachet kode som tilpasser kartet til alle
// nedlastede lokaliteter — settes kartet tilbake til nivå 15 så lenge brukeren ikke har rørt det.
const START_VIEW_GUARD_MS = 5000;
const startViewGuardUntil = Date.now() + START_VIEW_GUARD_MS;
let startViewCenter = [userPosition.lat, userPosition.lon];
map.on('zoomend', () => {
  if (userHasMovedMap || Date.now() > startViewGuardUntil) return;
  if (map.getZoom() < GEOLOCATION_ZOOM_LEVEL) {
    map.setView(startViewCenter, GEOLOCATION_ZOOM_LEVEL, { animate: false });
  }
});

const kartverketTopoLayer = createCachedTileLayer(KARTVERKET_TOPO_URL_TEMPLATE, {
  attribution: 'Kart: © <a href="https://www.kartverket.no/" target="_blank" rel="noopener">Kartverket</a>',
  minZoom: 0,
  maxZoom: 19,
  maxNativeZoom: 18,
  crossOrigin: 'anonymous',
});

const kartverketGrayscaleLayer = createCachedTileLayer(
  'https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png',
  {
    attribution: 'Kart: © <a href="https://www.kartverket.no/" target="_blank" rel="noopener">Kartverket</a>',
    minZoom: 0,
    maxZoom: 19,
    maxNativeZoom: 18,
    crossOrigin: 'anonymous',
  },
);

const osmLayer = createCachedTileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> bidragsytere',
  minZoom: 0,
  maxZoom: 19,
  crossOrigin: 'anonymous',
});

const userLocationPane = map.createPane('userLocationPane');
userLocationPane.style.zIndex = 650;

let activeTileUrlTemplate = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

if (isOfflineMode()) {
  kartverketTopoLayer.addTo(map);
  activeTileUrlTemplate = KARTVERKET_TOPO_URL_TEMPLATE;
} else {
  osmLayer.addTo(map);
}

L.control.layers({
  'OpenStreetMap': osmLayer,
  'Kartverket Topo': kartverketTopoLayer,
  'Kartverket Gråtone': kartverketGrayscaleLayer,
}, null, { position: 'bottomleft', collapsed: true }).addTo(map);

function updateMapAttribution(activeLayerName) {
  const cornerAttr = document.getElementById('map-corner-attribution');
  if (!cornerAttr) return;
  if (!activeLayerName || activeLayerName === 'OpenStreetMap') {
    cornerAttr.style.display = 'none';
  } else {
    cornerAttr.style.display = 'block';
    cornerAttr.innerHTML = '<a href="https://www.kartverket.no/" target="_blank" rel="noopener">Kart: © Kartverket</a>';
  }
}

map.on('baselayerchange', (e) => {
  updateMapAttribution(e.name);
  if (e.name === 'Kartverket Topo') activeTileUrlTemplate = KARTVERKET_TOPO_URL_TEMPLATE;
  else if (e.name === 'Kartverket Gråtone') activeTileUrlTemplate = 'https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png';
  else activeTileUrlTemplate = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
});
updateMapAttribution(isOfflineMode() ? 'Kartverket Topo' : 'OpenStreetMap');

if (typeof L.control.scale === 'function') {
  L.control.scale({ metric: true, imperial: false, maxWidth: 140, position: 'bottomleft' }).addTo(map);
}

const SHOW_LABELS_KEY = 'mapShowLabels_v1';
let showLabels = localStorage.getItem(SHOW_LABELS_KEY) !== '0';
const labelMarkers = [];
const siteLabelMarkers = [];
const toggleLabelsBtn = document.getElementById('toggle-labels-btn');

function updateToggleLabelsBtnText() {
  if (!toggleLabelsBtn) return;
  toggleLabelsBtn.textContent = showLabels ? '🏷️ Skjul navn' : '🏷️ Vis navn';
}
function setShowLabels(value) {
  showLabels = value;
  try {
    localStorage.setItem(SHOW_LABELS_KEY, value ? '1' : '0');
  } catch (e) {}
  [...labelMarkers, ...siteLabelMarkers].forEach((marker) => {
    if (value) marker.openTooltip();
    else marker.closeTooltip();
  });
  updateToggleLabelsBtnText();
}
if (toggleLabelsBtn) {
  updateToggleLabelsBtnText();
  toggleLabelsBtn.addEventListener('click', () => setShowLabels(!showLabels));
}

let userMarker = null;

function updateUserPositionOnMap({ lat, lon, accuracy }) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) return;

  const wasAvailable = isUserPositionAvailable;
  isUserPositionAvailable = true;
  userPosition.lat = lat;
  userPosition.lon = lon;
  userPosition.accuracy = accuracy;
  userPosition.isFallback = false;

  userLocationPane.style.display = '';

  let popupContent = '<strong>📍 Din posisjon</strong>';
  if (accuracy) popupContent += `<br>Nøyaktighet: ±${Math.round(accuracy)} m`;

  if (!userMarker) {
    userMarker = L.circleMarker([lat, lon], {
      pane: 'userLocationPane', color: '#ffffff', fillColor: '#3b82f6', fillOpacity: 1, radius: 13, weight: 4,
    }).addTo(map);
  } else {
    userMarker.setLatLng([lat, lon]);
  }
  userMarker.bindPopup(popupContent);

  if (missingLocationBanner) missingLocationBanner.style.display = 'none';

  if (!initialGpsZoomDone) {
    initialGpsZoomDone = true;
    startViewCenter = [lat, lon]; // sikringen over skal gå tilbake til GPS, ikke gammel posisjon
    if (!userHasMovedMap) map.setView([lat, lon], GEOLOCATION_ZOOM_LEVEL, { animate: true });
  } else if (!wasAvailable) {
    map.setView([lat, lon], Math.max(map.getZoom(), GEOLOCATION_ZOOM_LEVEL), { animate: true });
  }

  saveLastKnownPosition({ lat, lon, accuracy });
  try {
    const stored = JSON.parse(localStorage.getItem('mapData') || '{}');
    stored.userPosition = { lat, lon, accuracy, isFallback: false };
    localStorage.setItem('mapData', JSON.stringify(stored));
  } catch (_) {}
}

if (isUserPositionAvailable) {
  updateUserPositionOnMap(userPosition);
} else {
  userLocationPane.style.display = 'none';
}

let mapGpsWatchId = null;
if (typeof navigator !== 'undefined' && 'geolocation' in navigator && typeof navigator.geolocation.watchPosition === 'function') {
  mapGpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (!pos || !pos.coords) return;
      const { latitude, longitude, accuracy } = pos.coords;
      updateUserPositionOnMap({ lat: latitude, lon: longitude, accuracy });
      if (typeof accuracy === 'number' && accuracy <= 20 && mapGpsWatchId !== null) {
        navigator.geolocation.clearWatch(mapGpsWatchId);
        mapGpsWatchId = null;
      }
    },
    (err) => console.warn('GPS-oppslag i bakgrunnen:', err),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );

  window.addEventListener('beforeunload', () => {
    if (mapGpsWatchId !== null) {
      navigator.geolocation.clearWatch(mapGpsWatchId);
      mapGpsWatchId = null;
    }
  });
}

function recenterToGps() {
  const btn = document.getElementById('gps-recenter-btn');
  if (btn) btn.classList.add('is-locating');

  if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== 'function') {
    if (btn) btn.classList.remove('is-locating');
    if (missingLocationBanner) {
      missingLocationBanner.textContent = 'Geolokasjon støttes ikke på denne enheten';
      missingLocationBanner.style.display = 'block';
    }
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (btn) btn.classList.remove('is-locating');
      if (!pos || !pos.coords) return;
      const { latitude, longitude, accuracy } = pos.coords;
      updateUserPositionOnMap({ lat: latitude, lon: longitude, accuracy });
      const targetZoom = Math.max(map.getZoom(), GEOLOCATION_ZOOM_LEVEL);
      if (typeof map.flyTo === 'function') {
        map.flyTo([latitude, longitude], targetZoom, { duration: 1.0 });
      } else {
        map.setView([latitude, longitude], targetZoom, { animate: true });
      }
    },
    (err) => {
      if (btn) btn.classList.remove('is-locating');
      console.warn('Kunne ikke hente fersk GPS-posisjon:', err);
      const fallback = isUserPositionAvailable ? userPosition : loadLastKnownPosition();
      if (fallback && typeof fallback.lat === 'number' && typeof fallback.lon === 'number') {
        if (typeof map.flyTo === 'function') map.flyTo([fallback.lat, fallback.lon], Math.max(map.getZoom(), 13), { duration: 0.8 });
        else map.setView([fallback.lat, fallback.lon], Math.max(map.getZoom(), 13), { animate: true });
      }
      if (missingLocationBanner) {
        missingLocationBanner.textContent = 'Kunne ikke hente fersk posisjon. Sjekk GPS-signal/tillatelse.';
        missingLocationBanner.style.display = 'block';
        setTimeout(() => {
          missingLocationBanner.style.display = isUserPositionAvailable ? 'none' : 'block';
          if (!isUserPositionAvailable) missingLocationBanner.textContent = 'Din posisjon er ikke tilgjengelig';
        }, 4000);
      }
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  );
}

const gpsRecenterBtn = document.getElementById('gps-recenter-btn');
if (gpsRecenterBtn) gpsRecenterBtn.addEventListener('click', recenterToGps);

const downloadModalBackdropEl = document.getElementById('offline-download-modal-backdrop');
const downloadModalTextEl = document.getElementById('offline-download-modal-text');
const downloadModalOkBtnEl = document.getElementById('offline-download-modal-ok-btn');

function openDownloadModal(publicCount, privateCount, alreadyDownloaded = false, totalTiles = 0, failedTiles = 0) {
  let message = alreadyDownloaded
    ? `${publicCount} offentlige og ${privateCount} private lokaliteter, samt ${totalTiles} kartfliser for området, er allerede lagret for offline-bruk.`
    : `${publicCount} offentlige og ${privateCount} private lokaliteter, og ${totalTiles} kartfliser, er nå lastet ned og lagret.`;
  
  if (failedTiles > 0) {
    message += `\n\nOBS: ${failedTiles} av ${totalTiles} kartfliser kunne ikke lastes ned. Dette skjer oftest hvis OpenStreetMap har gitt deg en midlertidig sperre (IP-ban) for å beskytte serverne sine.\n\nTIPS: Åpne kartmenyen (nede til venstre), bytt til "Kartverket Topo" og prøv å laste ned på nytt!`;
  }
  
  if (downloadModalTextEl) downloadModalTextEl.innerText = message; // Bruker innerText for å respektere linjeskift
  if (downloadModalBackdropEl) downloadModalBackdropEl.style.display = 'flex';
  if (downloadModalOkBtnEl) downloadModalOkBtnEl.focus();
}

/** Vis en enkel melding i samme dialog som nedlastingsresultatet. */
function openMessageModal(message) {
  if (downloadModalTextEl) downloadModalTextEl.innerText = message;
  if (downloadModalBackdropEl) downloadModalBackdropEl.style.display = 'flex';
  if (downloadModalOkBtnEl) downloadModalOkBtnEl.focus();
}

function closeDownloadModal() {
  if (downloadModalBackdropEl) downloadModalBackdropEl.style.display = 'none';
}

if (downloadModalOkBtnEl) downloadModalOkBtnEl.addEventListener('click', closeDownloadModal);
if (downloadModalBackdropEl) downloadModalBackdropEl.addEventListener('click', (e) => {
  if (e.target === downloadModalBackdropEl) closeDownloadModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && downloadModalBackdropEl && downloadModalBackdropEl.style.display === 'flex') {
    closeDownloadModal();
  }
});

function showDownloadedSitesFeedback(publicCount, privateCount) {
  const siteCountEl = document.getElementById('site-count');
  const privateSiteCountEl = document.getElementById('private-site-count');
  if (siteCountEl) siteCountEl.textContent = String(publicCount);
  if (privateSiteCountEl) privateSiteCountEl.textContent = String(privateCount);
}

const siteShapesGroup = L.layerGroup().addTo(map);

const siteLayerGroup = (
  typeof L.markerClusterGroup === 'function'
    ? L.markerClusterGroup({
        maxClusterRadius: 45, disableClusteringAtZoom: 16, spiderfyOnMaxZoom: true, zoomToBoundsOnClick: false,
        showCoverageOnHover: false, // ikke tegn omrisset av lokalitetene under en samlesirkel ved hover
      })
    : L.layerGroup()
).addTo(map);

if (typeof siteLayerGroup.on === 'function') {
  siteLayerGroup.on('clusterclick', (event) => {
    const cluster = event && event.layer;
    if (!cluster) return;
    const childMarkers = typeof cluster.getAllChildMarkers === 'function' ? cluster.getAllChildMarkers() : [];
    const clusterBounds = typeof cluster.getBounds === 'function' ? cluster.getBounds() : null;

    if (clusterBounds && typeof clusterBounds.getNorthEast === 'function' && typeof clusterBounds.getSouthWest === 'function') {
      const ne = clusterBounds.getNorthEast();
      const sw = clusterBounds.getSouthWest();
      const spanMeters = haversine(sw.lat, sw.lng, ne.lat, ne.lng);
      if (spanMeters < 1.5 && typeof cluster.spiderfy === 'function') {
        cluster.spiderfy();
        return;
      }
    }

    let splitTarget = cluster;
    while (splitTarget && Array.isArray(splitTarget._childClusters) && splitTarget._childClusters.length === 1 && (!Array.isArray(splitTarget._markers) || splitTarget._markers.length === 0)) {
      splitTarget = splitTarget._childClusters[0];
    }

    const currentZoom = map.getZoom();
    const maxMapZoom = typeof map.getMaxZoom === 'function' ? map.getMaxZoom() : 18;
    const disableZoom = 16;
    const treeSplitZoom = splitTarget && typeof splitTarget._zoom === 'number' ? Math.min(splitTarget._zoom + 1, disableZoom) : currentZoom + 2;
    let boundsZoom = currentZoom + 2;
    if (clusterBounds && typeof map.getBoundsZoom === 'function') boundsZoom = map.getBoundsZoom(clusterBounds, false, L.point(80, 80));

    const targetZoom = Math.min(maxMapZoom, Math.max(treeSplitZoom, Math.min(boundsZoom, disableZoom), currentZoom + 1));
    const centerLatLng = clusterBounds && typeof clusterBounds.getCenter === 'function' ? clusterBounds.getCenter() : cluster.getLatLng();
    map.setView(centerLatLng, targetZoom, { animate: true });
  });
}

let currentRenderedSites = Array.isArray(sites) ? sites : [];
const manuallyPlacedSiteIds = new Set();

// Former (polygon, nøyaktighetssirkel, linje til superlokalitet) hører til én eller to markører.
// De skal bare vises når markøren(e) vises enkeltvis — ikke når de ligger skjult under en
// samlesirkel (klynge med tall i).
let siteShapeLinks = []; // [{ markers: [L.Marker], layers: [L.Layer] }]
let shapeVisibilityTimer = null;

function isMarkerHiddenInCluster(marker) {
  if (typeof siteLayerGroup.getVisibleParent !== 'function') return false;
  const visibleParent = siteLayerGroup.getVisibleParent(marker);
  // Markøren er skjult kun når en klynge med ikon (synlig sirkel) dekker den.
  return Boolean(visibleParent && visibleParent !== marker && visibleParent._icon);
}

function updateClusteredShapeVisibility() {
  siteShapeLinks.forEach(({ markers, layers }) => {
    const hidden = markers.some(isMarkerHiddenInCluster);
    layers.forEach((layer) => {
      const shown = siteShapesGroup.hasLayer(layer);
      if (hidden && shown) siteShapesGroup.removeLayer(layer);
      else if (!hidden && !shown) siteShapesGroup.addLayer(layer);
    });
  });
}

function scheduleShapeVisibilityUpdate() {
  clearTimeout(shapeVisibilityTimer);
  shapeVisibilityTimer = setTimeout(updateClusteredShapeVisibility, 30);
}

if (typeof siteLayerGroup.on === 'function') {
  ['animationend', 'spiderfied', 'unspiderfied'].forEach((evt) => siteLayerGroup.on(evt, scheduleShapeVisibilityUpdate));
}
map.on('zoomend moveend', scheduleShapeVisibilityUpdate);

function renderSites(sitesToRender, { fitToBounds = false } = {}) {
  if (Array.isArray(sitesToRender)) currentRenderedSites = sitesToRender;
  siteLayerGroup.clearLayers();
  siteShapesGroup.clearLayers();
  siteLabelMarkers.length = 0;
  siteShapeLinks = [];
  const markerBySiteId = new Map();

  const bounds = L.latLngBounds([[userPosition.lat, userPosition.lon]]);
  const siteCoordsById = new Map();
  const polygonLayers = [];

  let siteCount = 0;
  let publicSiteCount = 0;
  let privateSiteCount = 0;

  if (sitesToRender && Array.isArray(sitesToRender)) {
    sitesToRender.forEach(site => {
      if (site.id != null && manuallyPlacedSiteIds.has(String(site.id))) return;

      const isPrivate = isPrivateSite(site);
      const showPrivateSites = shouldShowOthersPrivateSites();
      const isMine = hasActiveAoLogin() && Boolean(site.isMine);
      
      if (isPrivate && !isMine && !showPrivateSites) return;

      const lat = parseFloat(site.lat);
      const lon = parseFloat(site.lon);
      if (isNaN(lat) || isNaN(lon)) return;

      if (site.id != null) siteCoordsById.set(String(site.id), { lat, lon });

      let markerColor, polygonColor;
      if (isMine) {
        markerColor = 'yellow'; polygonColor = '#eab308';
      } else if (isPrivate) {
        markerColor = 'grey'; polygonColor = '#9ca3af';
      } else if (site.isSuper) {
        markerColor = 'orange'; polygonColor = '#f97316';
      } else {
        markerColor = 'green'; polygonColor = '#22c55e';
      }

      const siteName = site.name || 'Ukjent lokalitet';
      let displayName = isMine ? `★ ${siteName}` : siteName;

      const distance = isUserPositionAvailable ? haversine(userPosition.lat, userPosition.lon, lat, lon) : null;
      let distStr = '';
      if (distance !== null) distStr = distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`;

      const siteIdStr = site.id != null ? String(site.id) : '';
      let popupHtml = `<strong>${displayName}</strong>`;
      if (distStr) popupHtml += `<br>Avstand: ${distStr}`;
      popupHtml += `<br><br><button onclick="selectLocation('${siteName.replace(/'/g, "\\'")}', '${siteIdStr}')">Velg denne lokaliteten</button>`;

      const siteShapeLayers = [];
      const hasPolygon = !!(site.raw && site.raw.isPolygon && site.raw.polygonCoordinates && site.raw.polygonCoordinates.length > 0);
      if (hasPolygon) {
        const leafletCoords = site.raw.polygonCoordinates.map(coord => [coord[1], coord[0]]);
        const polygon = L.polygon(leafletCoords, {
          color: polygonColor, weight: 2, opacity: 0.8, fillColor: polygonColor, fillOpacity: 0.15
        }).addTo(siteShapesGroup).bindPopup(popupHtml);
        polygon.on('click', () => { if (showLabels) selectLocation(siteName, site.id ?? null); });
        polygonLayers.push(polygon);
        siteShapeLayers.push(polygon);
      }

      if (!hasPolygon && site.raw) {
        const accuracyM = parseFloat(site.raw.accuracy ?? site.raw.Accuracy);
        if (!isNaN(accuracyM) && accuracyM > 0) {
          const radiusCircle = L.circle([lat, lon], {
            radius: accuracyM, color: polygonColor, weight: 2, opacity: 0.8, fillColor: polygonColor, fillOpacity: 0.12, dashArray: '5 5'
          }).addTo(siteShapesGroup).bindPopup(popupHtml);
          radiusCircle.on('click', () => { if (showLabels) selectLocation(siteName, site.id ?? null); });
          siteShapeLayers.push(radiusCircle);
        }
      }

      const markerIconUrl = `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${markerColor}.png`;
      // Polygon-lokaliteter får ingen synlig nål i «senteret»: polygonet er selve markeringen.
      // En usynlig anker-markør beholdes, slik at navnelappen og samlesirkelen fortsatt virker.
      const marker = L.marker([lat, lon], hasPolygon
        ? {
            icon: L.divIcon({ className: 'site-polygon-anchor', html: '', iconSize: [0, 0], iconAnchor: [0, 0] }),
            interactive: false,
            keyboard: false,
          }
        : {
            icon: L.icon({
              iconUrl: markerIconUrl, shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
              iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
            })
          }).addTo(siteLayerGroup);
      if (!hasPolygon) marker.bindPopup(popupHtml);
      if (site.id != null) markerBySiteId.set(String(site.id), marker);
      if (siteShapeLayers.length > 0) siteShapeLinks.push({ markers: [marker], layers: siteShapeLayers });

      const tooltipText = distStr ? `${siteName} (${distStr})` : siteName;
      const tooltipClasses = ['site-label'];
      if (isMine) tooltipClasses.push('mine-label');
      if (site.isSuper) tooltipClasses.push('super-label');
      marker.bindTooltip(tooltipText, { permanent: true, direction: 'top', className: tooltipClasses.join(' '), offset: hasPolygon ? [0, -4] : [0, -35] });
      if (!showLabels) marker.closeTooltip();
      siteLabelMarkers.push(marker);

      marker.on('click', () => { if (showLabels) selectLocation(siteName, site.id ?? null); });

      bounds.extend([lat, lon]);
      siteCount++;
      if (isPrivate || isMine) privateSiteCount++; else publicSiteCount++;
    });

    sitesToRender.forEach(site => {
      if (site.id == null || site.parentId == null) return;
      const childCoords = siteCoordsById.get(String(site.id));
      const parentCoords = siteCoordsById.get(String(site.parentId));
      if (!childCoords || !parentCoords) return;
      const link = L.polyline(
        [[childCoords.lat, childCoords.lon], [parentCoords.lat, parentCoords.lon]],
        { color: '#f97316', weight: 1.5, opacity: 0.6, dashArray: '4 6' }
      ).addTo(siteShapesGroup);
      const childMarker = markerBySiteId.get(String(site.id));
      const parentMarker = markerBySiteId.get(String(site.parentId));
      if (childMarker && parentMarker) siteShapeLinks.push({ markers: [childMarker, parentMarker], layers: [link] });
    });

    polygonLayers.forEach(polygon => polygon.bringToFront());
  }

  if (fitToBounds && siteCount > 0) map.fitBounds(bounds, { padding: [50, 50], animate: false });
  scheduleShapeVisibilityUpdate();
  showDownloadedSitesFeedback(publicSiteCount, privateSiteCount);
  return siteCount;
}

// Kartet åpnes alltid på nivå 15 med gjeldende GPS (ellers sist brukte kartposisjon).
// Oppstarts-rendring av lokaliteter må derfor IKKE bruke fitBounds — det zoomet tidligere
// kartet bort fra posisjonen og nivå 15 så snart lokalitetene var tegnet.
if (sites && sites.length > 0) saveOpportunisticOfflineLocations(sites).catch(() => {});

if (isOfflineMode()) {
  (async () => {
    try {
      const offlineSites = await getAllOfflineLocations();
      renderSites(offlineSites.length > 0 ? offlineSites : sites, { fitToBounds: false });
    } catch (e) {
      renderSites(sites, { fitToBounds: false });
    }
  })();
} else if (isHybridMode() && (!sites || sites.length === 0)) {
  (async () => {
    try {
      const center = map.getCenter();
      const viewportBounds = createCenteredBounds(center.lat, center.lng, sizeMeters * 2, sizeMeters * 2);
      const cachedInViewport = await getOfflineLocationsInBounds(viewportBounds);
      if (cachedInViewport.length > 0) renderSites(cachedInViewport, { fitToBounds: false });
      else renderSites(sites, { fitToBounds: false });
    } catch {
      renderSites(sites, { fitToBounds: false });
    }
  })();
} else {
  renderSites(sites, { fitToBounds: false });
}

const MAX_AUTO_FETCH_RADIUS_M = 3000;
const AUTO_FETCH_RADIUS_M = Math.max(MAX_AUTO_FETCH_RADIUS_M, sizeMeters);
const MIN_REFETCH_DISTANCE_M = Math.max(150, AUTO_FETCH_RADIUS_M / 4);

let lastFetchedCenter = { lat: map.getCenter().lat, lon: map.getCenter().lng };
let moveendTimer = null;
let fetchSeq = 0;

map.on('moveend', handleMapMoveEnd);

if (!isOfflineMode() && !isUserPositionAvailable && (!sites || sites.length === 0)) {
  (async () => {
    const seq = ++fetchSeq;
    try {
      const center = map.getCenter();
      await ensureAoTokens();
      const bboxSites = await fetchAoSitesCached(center.lat, center.lng, AUTO_FETCH_RADIUS_M);
      if (seq !== fetchSeq || bboxSites.length === 0) return;

      saveOpportunisticOfflineLocations(bboxSites).catch(()=>{});
      const merged = mergeAoSitesWithPrivateCache(bboxSites, { lat: center.lat, lon: center.lng }, sizeMeters);
      renderSites(merged, { fitToBounds: false });
    } catch (e) {
      console.warn('Kunne ikke hente lokaliteter ved kartoppstart:', e);
    }
  })();
}

function handleMapMoveEnd() {
  try {
    const c = map.getCenter();
    localStorage.setItem('lastMapCenter_v1', JSON.stringify({ lat: c.lat, lon: c.lng }));
  } catch (e) {}

  clearTimeout(moveendTimer);
  moveendTimer = setTimeout(async () => {
    const center = map.getCenter();
    const moved = haversine(lastFetchedCenter.lat, lastFetchedCenter.lon, center.lat, center.lng);
    if (moved != null && moved < MIN_REFETCH_DISTANCE_M) return;

    const previousFetchedCenter = lastFetchedCenter;
    lastFetchedCenter = { lat: center.lat, lon: center.lng };

    const revertFetchBookkeepingIfStillCurrent = () => {
      if (seq === fetchSeq) lastFetchedCenter = previousFetchedCenter;
    };

    const seq = ++fetchSeq;

    if (isOfflineMode()) {
      try {
        const offlineSites = await getAllOfflineLocations();
        if (seq !== fetchSeq) return;
        if (offlineSites.length > 0) renderSites(offlineSites, { fitToBounds: false });
      } catch (e) {
        console.warn('Kunne ikke oppdatere lokaliteter:', e);
        revertFetchBookkeepingIfStillCurrent();
      }
      return;
    }

    try {
      await ensureAoTokens();
      const bboxSites = await fetchAoSitesCached(center.lat, center.lng, AUTO_FETCH_RADIUS_M);
      if (seq !== fetchSeq) return;
      
      if (bboxSites.length > 0) saveOpportunisticOfflineLocations(bboxSites).catch(()=>{});
      if (bboxSites.length === 0) return;

      const merged = mergeAoSitesWithPrivateCache(bboxSites, { lat: center.lat, lon: center.lng }, sizeMeters);
      renderSites(merged, { fitToBounds: false });
    } catch (e) {
      if (isHybridMode()) {
        try {
          const offlineSites = await getOfflineLocationsInBounds(createCenteredBounds(center.lat, center.lng, AUTO_FETCH_RADIUS_M * 2, AUTO_FETCH_RADIUS_M * 2));
          if (seq !== fetchSeq) return;
          if (offlineSites && offlineSites.length > 0) {
            renderSites(offlineSites, { fitToBounds: false });
            return;
          }
        } catch(fallbackErr) {}
      }
      revertFetchBookkeepingIfStillCurrent();
      console.warn('Kunne ikke oppdatere lokaliteter etter panorering:', e);
    }
  }, 600);
}

function selectLocation(locationName, locationId) {
  localStorage.setItem('selectedLocation', locationName);
  if (locationId != null) localStorage.setItem('selectedLocationId', String(locationId));
  else localStorage.removeItem('selectedLocationId');
  window.location.href = '/';
}
window.selectLocation = selectLocation;

const fab = document.getElementById('add-site-fab');
const hint = document.getElementById('pin-drop-hint');
const cancelPinBtn = document.getElementById('cancel-pin-btn');
const panel = document.getElementById('create-site-panel');
const nameInput = document.getElementById('new-site-name');
const accuracySelect = document.getElementById('new-site-accuracy');
const createBtn = document.getElementById('panel-create-btn');
const panelCancelBtn = document.getElementById('panel-cancel-btn');
const panelStatus = document.getElementById('panel-status');

function hasAoCredentials() { return !!(localStorage.getItem('ao_username') && localStorage.getItem('ao_password')); }
if (hasAoCredentials() && fab) fab.style.display = '';

let pinDropMode = false, dropMarker = null, mapClickHandler = null, accuracyCircle = null;

function updateAccuracyCircle(latlng) {
  if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }
  const radiusM = parseInt(accuracySelect.value, 10) || 0;
  if (radiusM > 0) {
    accuracyCircle = L.circle(latlng, { radius: radiusM, color: '#ef4444', weight: 2, dashArray: '5 5', fillColor: '#ef4444', fillOpacity: 0.12 }).addTo(map);
  }
}
function removeAccuracyCircle() {
  if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }
}

function enterPinDropMode() {
  if (typeof offlineSelectMode !== 'undefined' && offlineSelectMode) exitOfflineSelectMode();
  pinDropMode = true;
  fab.style.display = 'none'; hint.style.display = 'block'; cancelPinBtn.style.display = 'block';
  map.getContainer().style.cursor = 'crosshair';

  mapClickHandler = (e) => {
    if (dropMarker) map.removeLayer(dropMarker);
    dropMarker = L.marker(e.latlng, { icon: L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }), draggable: true }).addTo(map);
    updateAccuracyCircle(e.latlng);
    dropMarker.on('drag', (ev) => updateAccuracyCircle(ev.target.getLatLng()));
    hint.style.display = 'none'; cancelPinBtn.style.display = 'none';
    map.off('click', mapClickHandler);
    openCreatePanel();
  };
  map.on('click', mapClickHandler);
}

function exitPinDropMode() {
  pinDropMode = false;
  hint.style.display = 'none'; cancelPinBtn.style.display = 'none'; panel.style.display = 'none';
  map.getContainer().style.cursor = '';
  if (mapClickHandler) { map.off('click', mapClickHandler); mapClickHandler = null; }
  if (dropMarker) { map.removeLayer(dropMarker); dropMarker = null; }
  removeAccuracyCircle();
  if (hasAoCredentials() && fab) fab.style.display = '';
}

function openCreatePanel() {
  nameInput.value = ''; panelStatus.style.display = 'none'; createBtn.disabled = false; panel.style.display = 'block';
}
function showPanelStatus(msg, isError) {
  panelStatus.textContent = msg; panelStatus.style.display = 'block';
  panelStatus.style.background = isError ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)';
  panelStatus.style.color = isError ? '#ef4444' : '#22c55e';
}

function addNewSiteMarker(name, lat, lon, siteId) {
  if (siteId != null) manuallyPlacedSiteIds.add(String(siteId));
  const marker = L.marker([lat, lon], { icon: L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] }) }).addTo(map);
  marker.bindTooltip(`★ ${name}`, { permanent: true, direction: 'top', className: 'site-label mine-label', offset: [0, -35] });
  if (!showLabels) marker.closeTooltip();
  labelMarkers.push(marker);
  marker.bindPopup(`<strong>★ ${name}</strong><br><em>Nettopp opprettet</em>`);
}

if (fab) fab.addEventListener('click', enterPinDropMode);
if (cancelPinBtn) cancelPinBtn.addEventListener('click', exitPinDropMode);
if (panelCancelBtn) panelCancelBtn.addEventListener('click', exitPinDropMode);
if (accuracySelect) accuracySelect.addEventListener('change', () => { if (dropMarker) updateAccuracyCircle(dropMarker.getLatLng()); });
if (createBtn) createBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name) { showPanelStatus('Skriv inn et lokalitetsnavn', true); return; }
  if (!dropMarker) { showPanelStatus('Ingen posisjon valgt', true); return; }
  const latlng = dropMarker.getLatLng();
  createBtn.disabled = true; showPanelStatus('Logger inn på AO...', false);

  try {
    const loggedIn = await ensureAoTokens();
    if (!loggedIn) { showPanelStatus('Innlogging feilet.', true); createBtn.disabled = false; return; }
    showPanelStatus('Oppretter lokasjon...', false);
    const result = await createAoSite(name, latlng.lat, latlng.lng, parseInt(accuracySelect.value));
    if (result.success) {
      showPanelStatus(result.message || 'Lokasjon opprettet!', false);
      if (dropMarker) { map.removeLayer(dropMarker); dropMarker = null; }
      removeAccuracyCircle();
      addNewSiteMarker(name, latlng.lat, latlng.lng, result.siteId);
      saveOpportunisticOfflineLocations([{ id: result.siteId > 0 ? result.siteId : undefined, name, lat: latlng.lat, lon: latlng.lng, isMine: true, isPrivate: true }]).catch(() => {});
      setTimeout(() => selectLocation(name, result.siteId > 0 ? result.siteId : null), 1500);
    } else {
      showPanelStatus(result.message || result.error || 'Ukjent feil', true);
      createBtn.disabled = false;
    }
  } catch (e) {
    showPanelStatus('Nettverksfeil: ' + e.message, true); createBtn.disabled = false;
  }
});

const toggleOfflineBtn = document.getElementById('toggle-offline-area-btn');
const toggleOfflineMarkersBtn = document.getElementById('toggle-offline-markers-btn');
const offlinePanel = document.getElementById('offline-area-panel');
const offlineDimsEl = document.getElementById('offline-area-dims');
const offlineLimitMsgEl = document.getElementById('offline-area-limit-msg');
const cancelOfflineBtn = document.getElementById('cancel-offline-area-btn');
const downloadOfflineBtn = document.getElementById('download-offline-area-btn');
const offlineAreaPane = map.createPane('offlineAreaPane'); offlineAreaPane.style.zIndex = 620;
const offlineHandlesPane = map.createPane('offlineHandlesPane'); offlineHandlesPane.style.zIndex = 750;

let offlineSelectMode = false, showOfflineMarkers = true, currentOfflineBounds = null, offlineRectLayer = null, offlineCenterMarker = null;
const offlineCornerMarkers = {};
let isBoxDragging = false, boxDragStartLatLng = null, boxDragStartCenter = null;

function updateOfflineMarkersVisibility(visible) {
  showOfflineMarkers = visible;
  if (visible) {
    if (!map.hasLayer(siteShapesGroup)) siteShapesGroup.addTo(map);
    if (!map.hasLayer(siteLayerGroup)) siteLayerGroup.addTo(map);
    labelMarkers.forEach((m) => { if (!map.hasLayer(m)) m.addTo(map); });
    if (showLabels) [...labelMarkers, ...siteLabelMarkers].forEach((m) => m.openTooltip());
  } else {
    if (map.hasLayer(siteShapesGroup)) map.removeLayer(siteShapesGroup);
    if (map.hasLayer(siteLayerGroup)) map.removeLayer(siteLayerGroup);
    labelMarkers.forEach((m) => { if (map.hasLayer(m)) map.removeLayer(m); });
  }
  if (toggleOfflineMarkersBtn) toggleOfflineMarkersBtn.textContent = visible ? '📍 Skjul lokaliteter' : '📍 Vis lokaliteter';
}

function formatKm(meters) { return (meters / 1000).toFixed(1).replace('.', ','); }

function updateOfflineUI(clamped = false) {
  if (!currentOfflineBounds) return;
  const { north, south, east, west } = currentOfflineBounds;
  const latLngBounds = [[south, west], [north, east]];
  const strokeColor = clamped ? '#f59e0b' : '#2563eb';
  if (offlineRectLayer) { offlineRectLayer.setBounds(latLngBounds); offlineRectLayer.setStyle({ color: strokeColor, fillColor: strokeColor }); }
  
  const cornerPositions = { nw: [north, west], ne: [north, east], se: [south, east], sw: [south, west] };
  Object.entries(cornerPositions).forEach(([key, pos]) => {
    if (offlineCornerMarkers[key]) {
      offlineCornerMarkers[key].setLatLng(pos);
      const handleEl = offlineCornerMarkers[key].getElement()?.querySelector('.offline-corner-handle');
      if (handleEl) handleEl.classList.toggle('is-clamped', clamped);
    }
  });

  if (offlineCenterMarker) {
    offlineCenterMarker.setLatLng([(north + south) / 2, (east + west) / 2]);
    const handleEl = offlineCenterMarker.getElement()?.querySelector('.offline-move-handle');
    if (handleEl) handleEl.classList.toggle('is-clamped', clamped);
  }

  const { widthM, heightM } = getBoundsDimensionsMeters(currentOfflineBounds);
  if (offlineDimsEl) offlineDimsEl.textContent = `${formatKm(widthM)} × ${formatKm(heightM)} km`;
  if (offlineLimitMsgEl) {
    if (clamped) { offlineLimitMsgEl.textContent = 'Maksimal størrelse nådd (10x10 km).'; offlineLimitMsgEl.classList.add('limit-reached'); }
    else { offlineLimitMsgEl.textContent = 'Dra midtpunktet (✥) for å flytte, eller hjørnene for å endre størrelse (maks 10x10 km).'; offlineLimitMsgEl.classList.remove('limit-reached'); }
  }
}

function attachDirectHandleDrag(marker, onLatLngMove, onDragFinish) {
  const el = marker.getElement();
  if (!el) return;
  let activePointer = false;
  function onTouchMove(ev) {
    if (!activePointer || !ev.touches || ev.touches.length === 0) return;
    if (ev.cancelable) ev.preventDefault();
    const containerRect = map.getContainer().getBoundingClientRect();
    onLatLngMove(map.containerPointToLatLng(L.point(ev.touches[0].clientX - containerRect.left, ev.touches[0].clientY - containerRect.top)));
  }
  function onTouchEnd() {
    if (!activePointer) return;
    activePointer = false; map.dragging.enable();
    window.removeEventListener('touchmove', onTouchMove, { passive: false });
    window.removeEventListener('touchend', onTouchEnd); window.removeEventListener('touchcancel', onTouchEnd);
    if (typeof onDragFinish === 'function') onDragFinish();
  }
  el.addEventListener('touchstart', (ev) => {
    if (!ev.touches || ev.touches.length !== 1) return;
    ev.stopPropagation(); activePointer = true; map.dragging.disable();
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd); window.addEventListener('touchcancel', onTouchEnd);
  }, { passive: true });
  el.addEventListener('mousedown', (ev) => ev.stopPropagation());
}

function createCornerHandleMarker(cornerKey, initialLatLng) {
  const marker = L.marker(initialLatLng, {
    icon: L.divIcon({ className: '', html: `<div class="offline-handle-hit-corner corner-${cornerKey}" data-corner="${cornerKey}" title="Dra hjørnet for å endre størrelse"><div class="offline-corner-handle corner-${cornerKey}"></div></div>`, iconSize: [48, 48], iconAnchor: [24, 24] }),
    pane: 'offlineHandlesPane', draggable: true, zIndexOffset: 2000,
  }).addTo(map);

  const applyPos = (pos) => {
    if (!currentOfflineBounds) return;
    const { bounds, clamped } = resizeBoundsFromCorner(currentOfflineBounds, cornerKey, { lat: pos.lat, lon: pos.lng });
    currentOfflineBounds = bounds; updateOfflineUI(clamped);
  };

  marker.on('drag', () => applyPos(marker.getLatLng()));
  marker.on('dragend', () => { if (currentOfflineBounds) updateOfflineUI(false); });
  attachDirectHandleDrag(marker, applyPos, () => updateOfflineUI(false));
  return marker;
}

function onMapBoxDragMove(e) {
  if (!isBoxDragging || !boxDragStartLatLng || !boxDragStartCenter || !currentOfflineBounds) return;
  currentOfflineBounds = moveBoundsToCenter(currentOfflineBounds, boxDragStartCenter.lat + (e.latlng.lat - boxDragStartLatLng.lat), boxDragStartCenter.lon + (e.latlng.lng - boxDragStartLatLng.lng));
  updateOfflineUI(false);
}

function stopMapBoxDrag() {
  if (!isBoxDragging) return;
  isBoxDragging = false; boxDragStartLatLng = null; boxDragStartCenter = null;
  map.dragging.enable(); map.off('mousemove', onMapBoxDragMove); map.off('mouseup', stopMapBoxDrag);
}

function enterOfflineSelectMode() {
  if (pinDropMode) exitPinDropMode();
  offlineSelectMode = true;

  if (toggleOfflineBtn) toggleOfflineBtn.textContent = '✕ Lukk områdevalg';
  if (toggleOfflineMarkersBtn) { toggleOfflineMarkersBtn.style.display = 'flex'; toggleOfflineMarkersBtn.textContent = showOfflineMarkers ? '📍 Skjul lokaliteter' : '📍 Vis lokaliteter'; }
  if (offlinePanel) offlinePanel.style.display = 'block';
  refreshMapOfflineStorageStats();

  const center = map.getCenter();
  currentOfflineBounds = createCenteredBounds(center.lat, center.lng, DEFAULT_OFFLINE_AREA_SIDE_M, DEFAULT_OFFLINE_AREA_SIDE_M);
  const { north, south, east, west } = currentOfflineBounds;

  offlineRectLayer = L.rectangle([[south, west], [north, east]], { pane: 'offlineAreaPane', color: '#2563eb', weight: 3, dashArray: '6 4', fillColor: '#2563eb', fillOpacity: 0.14, interactive: true }).addTo(map);
  offlineRectLayer.on('mousedown', (e) => {
    L.DomEvent.stopPropagation(e); isBoxDragging = true; boxDragStartLatLng = e.latlng;
    boxDragStartCenter = { lat: (currentOfflineBounds.north + currentOfflineBounds.south) / 2, lon: (currentOfflineBounds.east + currentOfflineBounds.west) / 2 };
    map.dragging.disable(); map.on('mousemove', onMapBoxDragMove); map.on('mouseup', stopMapBoxDrag);
  });

  offlineCornerMarkers.nw = createCornerHandleMarker('nw', [north, west]);
  offlineCornerMarkers.ne = createCornerHandleMarker('ne', [north, east]);
  offlineCornerMarkers.se = createCornerHandleMarker('se', [south, east]);
  offlineCornerMarkers.sw = createCornerHandleMarker('sw', [south, west]);

  offlineCenterMarker = L.marker([(north + south) / 2, (east + west) / 2], {
    icon: L.divIcon({ className: '', html: '<div class="offline-handle-hit-center" title="Dra midtpunktet for å flytte området"><div class="offline-move-handle">✥</div></div>', iconSize: [56, 56], iconAnchor: [28, 28] }),
    pane: 'offlineHandlesPane', draggable: true, zIndexOffset: 2100,
  }).addTo(map);

  const applyCenter = (pos) => {
    if (currentOfflineBounds) { currentOfflineBounds = moveBoundsToCenter(currentOfflineBounds, pos.lat, pos.lng); updateOfflineUI(false); }
  };
  offlineCenterMarker.on('drag', () => applyCenter(offlineCenterMarker.getLatLng()));
  attachDirectHandleDrag(offlineCenterMarker, applyCenter, () => updateOfflineUI(false));

  updateOfflineUI(false);
  const panelHeight = offlinePanel ? offlinePanel.offsetHeight || 220 : 220;
  map.fitBounds(L.latLngBounds([[south, west], [north, east]]).pad(0.35), { paddingTopLeft: [48, 75], paddingBottomRight: [48, panelHeight + 55], animate: true });
}

function exitOfflineSelectMode() {
  stopMapBoxDrag(); offlineSelectMode = false;
  if (!showOfflineMarkers) updateOfflineMarkersVisibility(true);
  if (toggleOfflineBtn) toggleOfflineBtn.textContent = '📦 Offline-område';
  if (toggleOfflineMarkersBtn) toggleOfflineMarkersBtn.style.display = isOfflineMode() ? 'flex' : 'none';
  if (offlinePanel) offlinePanel.style.display = 'none';

  if (offlineRectLayer) { map.removeLayer(offlineRectLayer); offlineRectLayer = null; }
  if (offlineCenterMarker) { map.removeLayer(offlineCenterMarker); offlineCenterMarker = null; }
  Object.keys(offlineCornerMarkers).forEach((key) => {
    if (offlineCornerMarkers[key]) { map.removeLayer(offlineCornerMarkers[key]); delete offlineCornerMarkers[key]; }
  });
}

if (toggleOfflineMarkersBtn && isOfflineMode()) toggleOfflineMarkersBtn.style.display = 'flex';
if (toggleOfflineBtn) toggleOfflineBtn.addEventListener('click', () => { offlineSelectMode ? exitOfflineSelectMode() : enterOfflineSelectMode(); });
if (toggleOfflineMarkersBtn) toggleOfflineMarkersBtn.addEventListener('click', () => updateOfflineMarkersVisibility(!showOfflineMarkers));
if (cancelOfflineBtn) cancelOfflineBtn.addEventListener('click', exitOfflineSelectMode);

const tileDownloadProgressEl = document.getElementById('tile-download-progress');
const tileDownloadProgressTextEl = document.getElementById('tile-download-progress-text');

function setTileDownloadProgressVisible(visible, text = 'Downloading map tiles...') {
  if (!tileDownloadProgressEl) return;
  if (visible) {
    if (tileDownloadProgressTextEl) tileDownloadProgressTextEl.textContent = text;
    tileDownloadProgressEl.style.display = 'flex';
  } else {
    tileDownloadProgressEl.style.display = 'none';
  }
}

const OFFLINE_DOWNLOAD_BLOCKED_MESSAGE = 'Kan ikke laste ned kart. Du er offline!';

/** Offline-modus: gjør nedlastingsknappen grå (men trykkbar, så vi kan forklare hvorfor). */
function updateDownloadButtonOfflineState() {
  if (!downloadOfflineBtn) return;
  const blocked = isOfflineMode();
  downloadOfflineBtn.classList.toggle('is-offline-blocked', blocked);
  downloadOfflineBtn.setAttribute('aria-disabled', blocked ? 'true' : 'false');
  downloadOfflineBtn.title = blocked ? OFFLINE_DOWNLOAD_BLOCKED_MESSAGE : '';
}
updateDownloadButtonOfflineState();
window.addEventListener('network_mode_changed', updateDownloadButtonOfflineState);
window.addEventListener('storage', updateDownloadButtonOfflineState);

if (downloadOfflineBtn) {
  downloadOfflineBtn.addEventListener('click', async () => {
    if (isOfflineMode()) {
      openMessageModal(OFFLINE_DOWNLOAD_BLOCKED_MESSAGE);
      return;
    }
    if (!currentOfflineBounds) return;
    const targetBounds = { ...currentOfflineBounds };
    const originalText = downloadOfflineBtn.textContent;
    downloadOfflineBtn.disabled = true; downloadOfflineBtn.textContent = 'Laster ned lokaliteter …';
    setTileDownloadProgressVisible(true, 'Downloading map tiles...');

    try {
      const existingOfflineSites = await getOfflineLocationsInBounds(targetBounds).catch(() => []);
      let sitesInArea = [], savedInfo = null, sitesAlreadyDownloaded = false;

      if (isOfflineMode()) {
        // Ingen nettverk: bruk det som allerede ligger lagret innenfor rektangelet.
        sitesInArea = existingOfflineSites; sitesAlreadyDownloaded = existingOfflineSites.length > 0;
        let pubCount = 0, privCount = 0;
        existingOfflineSites.forEach((s) => { if (isPrivateSite(s) || s.isMine) privCount++; else pubCount++; });
        savedInfo = { publicCount: pubCount, privateCount: privCount };
      } else {
        // Hent ALLTID alle lokaliteter for hele rektangelet. Tidligere ble henting hoppet over
        // så snart én lokalitet lå lagret innenfor (f.eks. fra vanlig kartbruk), og resten
        // av rektangelet ble aldri lastet ned.
        let isLoggedIn = hasActiveAoLogin();
        let fetchedSites = [];
        try {
          if (isLoggedIn) isLoggedIn = await ensureAoTokens();
          fetchedSites = await fetchAoSitesByBounds(targetBounds);
        } catch (err) { }
        // Mislyktes henting (tom liste): bruk det som er lagret + det som vises på kartet.
        const fallbackSites = [...existingOfflineSites, ...currentRenderedSites];
        const showOthersPrivate = shouldShowOthersPrivateSites();
        const filteredSites = filterSitesForOfflineDownload(fetchedSites, fallbackSites, { isLoggedIn, showOthersPrivate, cachedPrivateSites: isLoggedIn ? getCachedPrivateSites() : [] });
        sitesInArea = filterSitesInBounds(filteredSites, targetBounds);
        savedInfo = await saveOfflineAreaLocations(targetBounds, sitesInArea, { showOthersPrivate });
      }

      // Tvinger alltid Kartverket Topo for offline-nedlasting
      const activeTemplate = KARTVERKET_TOPO_URL_TEMPLATE;

      // Beregn KUN for offline zoom nivåer (12 og 15)
      const allTiles = calculateTilesForBounds(targetBounds, OFFLINE_ZOOM_LEVELS, activeTemplate);
      const totalTilesCount = allTiles.length;
      let cache = null;
      if (typeof caches !== 'undefined') { try { cache = await caches.open(MAP_TILE_CACHE_NAME); } catch (_) {} }

      const tilesToDownload = [];
      if (cache) {
        for (const t of allTiles) {
          const tileUrl = typeof t === 'string' ? t : t.url;
          if (tileUrl) {
            const inCache = await cache.match(tileUrl);
            if (!inCache) tilesToDownload.push(t);
          } else { tilesToDownload.push(t); }
        }
      } else { tilesToDownload.push(...allTiles); }

      const tilesAlreadyDownloaded = tilesToDownload.length === 0;
      let failedCount = 0;

      if (tilesAlreadyDownloaded) {
        downloadOfflineBtn.textContent = 'Kartfliser er allerede lagret';
      } else {
        setTileDownloadProgressVisible(true, `Laster ned kartfliser... (0/${tilesToDownload.length})`);
        const result = await downloadTilesInBatches(tilesToDownload, {
          batchSize: MAX_TILE_BATCH_SIZE, cacheName: MAP_TILE_CACHE_NAME,
          onProgress: ({ completed, total }) => {
            setTileDownloadProgressVisible(true, `Laster ned kartfliser (${completed}/${total}) ...`);
            downloadOfflineBtn.textContent = `Laster ned kartfliser (${completed}/${total}) …`;
          },
        });
        failedCount = result.failed || 0;
      }

      clearFallbackTileMemo();
      renderSites(sitesInArea, { fitToBounds: false });
      await refreshMapOfflineStorageStats();
      openDownloadModal(savedInfo.publicCount, savedInfo.privateCount, sitesAlreadyDownloaded && tilesAlreadyDownloaded, totalTilesCount, failedCount);
    } catch (e) {
      openDownloadModal(0, 0, false, 0, 0);
    } finally {
      setTileDownloadProgressVisible(false); downloadOfflineBtn.disabled = false; downloadOfflineBtn.textContent = originalText;
    }
  });
}

const mapStorageStatsEl = document.getElementById('map-offline-storage-stats');
const mapSyncOfflineBtn = document.getElementById('map-sync-offline-btn');
const mapClearOfflineBtn = document.getElementById('map-clear-offline-btn');
const mapStorageStatusEl = document.getElementById('map-offline-storage-status');
const mapClearConfirmModal = document.getElementById('map-clear-offline-confirm-modal');
const mapClearCancelBtn = document.getElementById('map-clear-offline-cancel-btn');
const mapClearConfirmBtn = document.getElementById('map-clear-offline-confirm-btn');

function showMapOfflineStorageStatus(msg, isError = false) {
  if (!mapStorageStatusEl) return;
  const bg = isError ? '#fef2f2' : '#f0fdf4';
  const bd = isError ? '#fecaca' : '#bbf7d0';
  const color = isError ? '#dc2626' : '#15803d';
  mapStorageStatusEl.style.cssText = `display:block;margin-top:6px;padding:6px 8px;border-radius:6px;font-size:12px;background:${bg};border:1px solid ${bd};color:${color};font-weight:500;`;
  mapStorageStatusEl.textContent = msg;
}

async function refreshMapOfflineStorageStats() {
  if (!mapStorageStatsEl) return;
  try {
    const stats = await getOfflineStorageStats();
    const areaPart = stats.areasCount > 0 ? ` (${stats.areasCount} område${stats.areasCount === 1 ? '' : 'r'})` : '';
    mapStorageStatsEl.textContent = `Lagret lokalt: ca. ${stats.locationsCount} lokaliteter${areaPart} og ${stats.tilesCount} kartfliser.`;
  } catch {
    mapStorageStatsEl.textContent = 'Lagret lokalt: 0 lokaliteter og 0 kartfliser.';
  }
}

if (mapSyncOfflineBtn) {
  mapSyncOfflineBtn.addEventListener('click', async () => {
    mapSyncOfflineBtn.disabled = true;
    if (mapClearOfflineBtn) mapClearOfflineBtn.disabled = true;
    if (mapStorageStatusEl) mapStorageStatusEl.style.display = 'none';
    setTileDownloadProgressVisible(true, 'Synkroniserer lagrede offline-områder …');

    try {
      const summary = await syncOfflineAreas({
        fetchSitesByBounds: fetchAoSitesByBounds, checkLoggedIn: hasActiveAoLogin, ensureTokens: ensureAoTokens,
        getShowOthersPrivate: shouldShowOthersPrivateSites, getPrivateSitesCache: getCachedPrivateSites,
        tileUrlTemplate: KARTVERKET_TOPO_URL_TEMPLATE,
        onProgress: ({ areaIndex, totalAreas, phase, completedTiles, totalTiles }) => {
          if (phase === 'locations') setTileDownloadProgressVisible(true, `Område ${areaIndex}/${totalAreas}: oppdaterer lokaliteter …`);
          else setTileDownloadProgressVisible(true, `Område ${areaIndex}/${totalAreas}: kartfliser (${completedTiles}/${totalTiles}) …`);
        },
      });

      clearFallbackTileMemo();
      await refreshMapOfflineStorageStats();

      if (summary.syncedAreas === 0) {
        showMapOfflineStorageStatus('Ingen lagrede offline-områder ennå. Trykk «Last ned område for offline-bruk» over.', false);
      } else {
        const allOffline = await getAllOfflineLocations().catch(() => []);
        if (allOffline.length > 0) renderSites(allOffline, { fitToBounds: false });
        showMapOfflineStorageStatus(`✅ Oppdaterte ${summary.syncedAreas} område${summary.syncedAreas === 1 ? '' : 'r'} (${summary.totalLocations} lokaliteter, ${summary.totalTilesCached} kartfliser).`, false);
      }
    } catch (err) {
      showMapOfflineStorageStatus(`❌ Feil ved synkronisering: ${err.message || 'Ukjent feil'}`, true);
    } finally {
      setTileDownloadProgressVisible(false); mapSyncOfflineBtn.disabled = false;
      if (mapClearOfflineBtn) mapClearOfflineBtn.disabled = false;
    }
  });
}

if (mapClearOfflineBtn) mapClearOfflineBtn.addEventListener('click', () => { if (mapClearConfirmModal) mapClearConfirmModal.style.display = 'flex'; });
if (mapClearCancelBtn) mapClearCancelBtn.addEventListener('click', () => { if (mapClearConfirmModal) mapClearConfirmModal.style.display = 'none'; });
if (mapClearConfirmModal) mapClearConfirmModal.addEventListener('click', (e) => { if (e.target === mapClearConfirmModal) mapClearConfirmModal.style.display = 'none'; });
if (mapClearConfirmBtn) {
  mapClearConfirmBtn.addEventListener('click', async () => {
    mapClearConfirmBtn.disabled = true;
    try {
      await clearAllOfflineData();
      if (mapClearConfirmModal) mapClearConfirmModal.style.display = 'none';
      await refreshMapOfflineStorageStats();
      showMapOfflineStorageStatus('✅ Alle nedlastede lokaliteter og kartfliser er slettet.', false);
    } catch (err) {
      if (mapClearConfirmModal) mapClearConfirmModal.style.display = 'none';
      showMapOfflineStorageStatus(`❌ Feil ved sletting: ${err.message || 'Ukjent feil'}`, true);
    } finally { mapClearConfirmBtn.disabled = false; }
  });
}

refreshMapOfflineStorageStats();
