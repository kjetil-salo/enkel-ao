/**
 * Kart-modul for visning av brukerposisjon og AO-lokaliteter
 */

// Versjonert import
import { createAoSite, ensureAoTokens, fetchAoSitesCached, fetchAoSitesByBounds, getCachedPrivateSites, hasActiveAoLogin } from './api.js?v=v1.60.16';
import { mergeAoSitesWithPrivateCache, isPrivateSite, shouldShowOthersPrivateSites, DEFAULT_MAP_CENTER } from './location.js?v=v1.60.16';
import { saveLastKnownPosition, loadLastKnownPosition } from './storage.js?v=v1.60.16';
import { haversine } from './utils.js';
// Versjonert import: HARD avhengighet til navngitte eksporter i en modul som
// er ny her. Samme begrunnelse som location.js-importen over.
import {
  knappetekst,
  knappetittel,
  lesLagretVisning,
  nesteVisning,
  tilLagretVerdi,
  visLokaliteter,
  visNavn,
} from './kart-visning.js?v=v1.60.16';
import {
  DEFAULT_OFFLINE_AREA_SIDE_M,
  KARTVERKET_TOPO_URL_TEMPLATE,
  MAP_TILE_CACHE_NAME,
  MAX_TILE_BATCH_SIZE,
  OFFLINE_ZOOM_LEVELS,
  calculateTilesForBounds,
  boundsAreaKm2,
  MAX_OFFLINE_AREA_KM2,
  KB_PER_FLIS,
  computeDynamicFetchBounds,
  createCenteredBounds,
  downloadTilesInBatches,
  fetchDynamicViewportSites,
  filterSitesForOfflineDownload,
  filterSitesInBounds,
  isOthersPrivateSite,
  mergeCachedSites,
  getBoundsDimensionsMeters,
  moveBoundsToCenter,
  resizeBoundsFromCorner,
} from './offline-area.js?v=v1.60.16';
import {
  getNetworkMode,
  setNetworkMode,
  fetchLocationsWithNetworkMode,
  isOfflineMode,
  isHybridMode,
  saveOfflineAreaLocations,
  saveOpportunisticOfflineLocations,
  getAllOfflineLocations,
  getOfflineLocationsInBounds,
  getOfflineStorageStats,
  getOfflineAreas,
  deleteOfflineArea,
  syncOfflineAreas,
  clearAllOfflineData,
  syncNetworkModeToServiceWorker,
} from './offline-db.js?v=v1.60.16';

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
// Første ferske GPS-fiks etter at kartet åpnes sentrerer alltid kartet på brukeren (zoom 15 / 300m målestokk),
// også når kartet startet på en lagret posisjon. Utsettes hvis brukeren allerede har tatt i kartet.
let initialGpsZoomDone = false;
let userHasMovedMap = false;

function initMap(centerPosition) {
  if (typeof L === 'undefined') {
    return null;
  }
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

// ============================================================
// Varsel når kartet ikke får en eneste flis
// ============================================================
// I offline-modus settes manglende fliser til BLANK_TILE_DATA_URL. Det gir et
// helt tomt kart der lokalitetspinnene likevel står (de kommer fra den lokale
// databasen) — og uten en forklaring leser det som at kartet er ødelagt, ikke
// som at området aldri ble lastet ned. Feltmelding 05.11.2026.
//
// Vi teller fliser i stedet for å gjette på modus: hybrid uten dekning ender i
// samme tomme kart, og over-/underzoom-fallbacken kan redde et utsnitt selv i
// offline. Bare «null ekte fliser» er et sikkert tegn.
let flisTeller = { ekte: 0, blanke: 0 };
let flisVarselTimer = null;

/** Registrerer hva en flis endte opp med, og vurderer varselet etterpå. */
function registrerFlis(erEkte) {
  if (erEkte) flisTeller.ekte += 1;
  else flisTeller.blanke += 1;
  clearTimeout(flisVarselTimer);
  // Fliser kommer i puljer; vent til utsnittet har satt seg før vi dømmer.
  flisVarselTimer = setTimeout(oppdaterTomtKartVarsel, 600);
}

/**
 * Setter flis-kilden og bokfører UTFALLET, ikke intensjonen: i hybrid-modus
 * settes nettverks-URL-en først og feiler etterpå når dekningen mangler, så en
 * bokføring i det src settes ville regnet den tomme flisen som en ekte en — og
 * varselet uteblitt nettopp der det trengs mest (målt i hybrid uten nett).
 */
function settFlisKilde(tile, src) {
  if (src === BLANK_TILE_DATA_URL) {
    registrerFlis(false);
  } else {
    tile.addEventListener('load', () => registrerFlis(true), { once: true });
    tile.addEventListener('error', () => registrerFlis(false), { once: true });
  }
  tile.src = src;
}

/** Nullstiller tellingen — nytt utsnitt skal vurderes på egne fliser. */
function nullstillFlisTeller() {
  flisTeller = { ekte: 0, blanke: 0 };
  clearTimeout(flisVarselTimer);
}

function hentFlisVarselEl() {
  let el = document.getElementById('tomt-kart-varsel');
  if (el) return el;
  const kartEl = document.getElementById('map');
  if (!kartEl) return null;
  el = document.createElement('div');
  el.id = 'tomt-kart-varsel';
  el.className = 'tomt-kart-varsel';
  el.setAttribute('role', 'status');
  el.style.display = 'none';
  // Bygges her, ikke i map.html: da slipper siden å holde to blokker i synk,
  // og varselet følger koden som vet når det trengs.
  el.innerHTML = `
    <div class="tomt-kart-varsel-ikon" aria-hidden="true">🗺️</div>
    <h2 class="tomt-kart-varsel-tittel">Ingen kartbakgrunn her</h2>
    <p class="tomt-kart-varsel-tekst" id="tomt-kart-varsel-tekst"></p>
    <div class="tomt-kart-varsel-knapper">
      <button type="button" id="tomt-kart-varsel-online-btn">Bytt til Online</button>
      <button type="button" id="tomt-kart-varsel-lukk-btn">Lukk</button>
    </div>`;
  kartEl.appendChild(el);
  el.querySelector('#tomt-kart-varsel-lukk-btn').addEventListener('click', () => {
    el.style.display = 'none';
    flisVarselLukket = true;
  });
  el.querySelector('#tomt-kart-varsel-online-btn').addEventListener('click', () => {
    setNetworkMode('online');
    // Enklest og tryggest: hent siden på nytt, så alle lag bygges i ny modus.
    window.location.reload();
  });
  return el;
}

// Lukker brukeren varselet, skal det ikke komme tilbake ved hver panorering.
let flisVarselLukket = false;

function oppdaterTomtKartVarsel() {
  const el = hentFlisVarselEl();
  if (!el) return;
  const tomt = flisTeller.ekte === 0 && flisTeller.blanke > 0;
  if (!tomt || flisVarselLukket) {
    el.style.display = 'none';
    return;
  }
  const mode = getNetworkMode();
  const tekst = el.querySelector('#tomt-kart-varsel-tekst');
  const onlineBtn = el.querySelector('#tomt-kart-varsel-online-btn');
  if (mode === 'offline') {
    tekst.textContent =
      'Appen står i Offline-modus, og dette området er ikke lastet ned. '
      + 'Lokalitetene vises fortsatt, men kartbakgrunnen finnes bare for områder du har lastet ned på forhånd.';
    onlineBtn.style.display = '';
  } else {
    tekst.textContent =
      'Kartflisene kunne ikke hentes — mest sannsynlig ingen dekning her. '
      + 'Lokalitetene vises fortsatt. Last ned området på forhånd neste gang du har nett.';
    onlineBtn.style.display = 'none';
  }
  el.style.display = '';
}

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
          settFlisKilde(tile, url);
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
              if (resolved) { settFlisKilde(tile, resolved); return; }
            }
            tile.addEventListener(
              'error',
              async () => {
                try {
                  const resolved = await resolveFromCache();
                  if (resolved) settFlisKilde(tile, resolved);
                } catch (_) { /* tile blir stående tom */ }
              },
              { once: true },
            );
            settFlisKilde(tile, url);
            return;
          }

          // Offline-modus (cache-only): aldri nettverk. Ingenting brukbart = tom flis.
          settFlisKilde(tile, (await resolveFromCache()) || BLANK_TILE_DATA_URL);
        }).catch(() => {
          // Cache API feilet. Offline: tom flis; ellers last normalt.
          settFlisKilde(tile, mode === 'offline' ? BLANK_TILE_DATA_URL : url);
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

function startMapUI() {
  if (typeof L === 'undefined') {
    console.warn('Leaflet er ikke tilgjengelig (L is not defined)');
    const mapEl = document.getElementById('map');
    if (mapEl) {
      mapEl.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:20px;text-align:center;color:var(--text, #e5e7eb);background:var(--bg, #0f172a);font-family:system-ui,-apple-system,sans-serif;">
          <div style="font-size:2.5rem;margin-bottom:12px;">🗺️</div>
          <h2 style="font-size:1.15rem;font-weight:600;margin-bottom:8px;">Kunne ikke laste kartet</h2>
          <p style="color:var(--muted, #9ca3af);max-width:380px;font-size:0.9rem;line-height:1.4;margin-bottom:16px;">
            Kartressursene (Leaflet) kunne ikke lastes inn. Sjekk internettforbindelsen og last siden på nytt for å lagre kartet til offline bruk.
          </p>
          <button type="button" onclick="window.location.reload()" style="padding:8px 18px;border-radius:8px;background:var(--accent, #3b82f6);color:white;border:none;cursor:pointer;font-size:0.95rem;font-weight:500;">
            Prøv igjen
          </button>
        </div>
      `;
    }
    return;
  }

  const map = initMap(userPosition);
  if (!map) return;
  ['pointerdown', 'touchstart', 'wheel'].forEach((evt) => {
  map.getContainer().addEventListener(evt, () => { userHasMovedMap = true; }, { once: true, passive: true });
});

// Sikring: kartet skal åpne på nivå 15 (GPS, ellers sist brukte posisjon). Skjer det noe som
// zoomer ut de første sekundene — f.eks. gammel cachet kode som tilpasser kartet til alle
// nedlastede lokaliteter — settes kartet tilbake til nivå 15 så lenge brukeren ikke har rørt det.
const START_VIEW_GUARD_MS = 5000;
let startViewGuardUntil = Date.now() + START_VIEW_GUARD_MS;
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

// Hvor mye av lokalitetene kartet viser — tre trinn på én knapp:
// Alt → Skjul navn → Skjul alt → Alt. Se public/js/kart-visning.js for
// tilstandsmaskinen og hvorfor det ble tre trinn og ikke to knapper.
//
// Første trykk gjør nøyaktig det samme som den gamle to-tilstands-knappen,
// så valget er bakoverkompatibelt både i oppførsel og i localStorage.
const SHOW_LABELS_KEY = 'mapShowLabels_v1';
let visning = lesLagretVisning(localStorage.getItem(SHOW_LABELS_KEY));
// Manuelt opprettede lokasjoner (pin-drop, se addNewSiteMarker) — disse ligger
// utenfor siteLayerGroup og overlever derfor en panorer-oppdatering uendret.
// De blir også stående gjennom «skjul alt»: en markør brukeren nettopp har
// laget er svaret på en handling han gjorde, og forsvant den med resten ville
// en vellykket opprettelse sett ut som en feilet. Bare navnet følger navn-trinnet.
const labelMarkers = [];
// Hentede AO-lokaliteter — bygges på nytt for hvert kall til renderSites().
const siteLabelMarkers = [];
// Polygonlagene fra siste tegning. Må leve på modulnivå fordi rekkefølgen
// deres må gjenopprettes HVER gang laggruppa legges tilbake på kartet, ikke
// bare når den tegnes — se anvendVisning().
let sistePolygonLag = [];
const toggleLabelsBtn = document.getElementById('toggle-labels-btn');
const mapContainer = document.getElementById('map');

function applyLabelsVisibilityDom() {
  if (mapContainer) {
    mapContainer.classList.toggle('map-hide-labels', !visNavn(visning));
  }
}

/**
 * Tegn kartet slik gjeldende visning sier. Kalles både ved trykk på knappen
 * og etter hver renderSites(), så en panorer-oppdatering ikke smetter inn
 * lokaliteter brukeren har valgt å skjule.
 */
function anvendVisning() {
  // Hele laggruppa av/på kartet med ett grep. Legges nye lag inn i en gruppe
  // som IKKE er på kartet (f.eks. fra en panorer-oppdatering), havner de
  // heller ikke på kartet — derfor trengs ingen egen bokføring for det
  // tilfellet, og en skjult panorering kan ikke smette lokaliteter inn igjen.
  // BEGGE laggruppene: markørene ligger i siteLayerGroup, mens polygoner og
  // radius-sirkler ligger i siteShapesGroup (lagt til i offline-arbeidet).
  // Tar vi bare den første, blir flatene stående igjen og «skjul alt» dekker
  // fortsatt kartet — nettopp det knappen finnes for å rydde unna.
  // Zoom-logikken i updateShapeVisibility() legger og fjerner ENKELTLAG inne i
  // gruppa, så den er uavhengig av om gruppa selv er på kartet.
  if (visLokaliteter(visning)) {
    if (!map.hasLayer(siteLayerGroup)) siteLayerGroup.addTo(map);
    if (!map.hasLayer(siteShapesGroup)) siteShapesGroup.addTo(map);
  } else {
    if (map.hasLayer(siteLayerGroup)) map.removeLayer(siteLayerGroup);
    if (map.hasLayer(siteShapesGroup)) map.removeLayer(siteShapesGroup);
  }

  applyLabelsVisibilityDom();

  // Tooltip-tilstanden MÅ settes ETTER at lagene er lagt tilbake på kartet:
  // Leaflet åpner en permanent tooltip på nytt av seg selv når laget legges
  // til. Uten denne rekkefølgen ville et hopp fra «skjul alt» rett tilbake
  // til navn-av-tilstanden fått navnene til å dukke opp igjen uoppfordret.
  const navnSynlige = visNavn(visning);
  [...labelMarkers, ...siteLabelMarkers].forEach((marker) => {
    if (!marker) return;
    if (navnSynlige) {
      if (typeof marker.openTooltip === 'function') marker.openTooltip();
    } else if (typeof marker.closeTooltip === 'function') {
      marker.closeTooltip();
    }
  });

  // Løft polygonene over eventuelle overlappende radius-sirkler PÅ NYTT. Må
  // skje her, ikke bare i renderSites(), av to grunner:
  //   1. `map.removeLayer(siteLayerGroup)` river SVG-elementene ut av DOM-en,
  //      og `addTo(map)` legger dem tilbake i gruppas egen innsettings-
  //      rekkefølge — altså nøyaktig den tegnerekkefølgen bringToFront() fins
  //      for å overstyre. Uten dette falt polygonet bak sirkelen etter en tur
  //      innom «skjul alt», og brukeren fant ikke noe sted å trykke for å
  //      velge det (samme symptom som feltrapporten 01.10.2026).
  //   2. Tegnes det nye lag mens gruppa er av kartet (panorering i skjult
  //      tilstand), er `bringToFront()` den gang et stille no-op.
  // bringToFront() på et lag som ikke er på kartet er ufarlig, så dette kan
  // kalles ubetinget.
  sistePolygonLag.forEach((polygon) => polygon.bringToFront());

  if (toggleLabelsBtn) {
    toggleLabelsBtn.textContent = knappetekst(visning);
    // Tittelen må følge teksten: i «skjul alt»-tilstanden VISER neste trykk
    // alt, og en fast tittel ville lovet det motsatte ved hover på PC.
    toggleLabelsBtn.title = knappetittel(visning);
  }
}

function enforceLabelsVisibility() {
  anvendVisning();
}

function setVisning(nyVisning) {
  visning = nyVisning;
  const lagretVerdi = tilLagretVerdi(visning);
  // null = «ikke en innstilling» (gjelder 'ingen'). Da står den forrige,
  // lagrede preferansen urørt, og kartet åpner ikke tomt neste gang.
  if (lagretVerdi !== null) {
    try {
      localStorage.setItem(SHOW_LABELS_KEY, lagretVerdi);
    } catch (e) {
      // Ikke kritisk om preferansen ikke lar seg lagre
    }
  }
  anvendVisning();
}

applyLabelsVisibilityDom();
if (toggleLabelsBtn) {
  toggleLabelsBtn.textContent = knappetekst(visning);
  toggleLabelsBtn.title = knappetittel(visning);
  toggleLabelsBtn.addEventListener('click', () => setVisning(nesteVisning(visning)));
}

const offlinePanel = document.getElementById('offline-area-panel');
let offlineSelectMode = false;
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

  if (missingLocationBanner) {
    missingLocationBanner.style.display = 'none';
    updateBannerAndOfflinePanelLayout();
  }

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
      updateBannerAndOfflinePanelLayout();
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
        updateBannerAndOfflinePanelLayout();
        setTimeout(() => {
          missingLocationBanner.style.display = isUserPositionAvailable ? 'none' : 'block';
          if (!isUserPositionAvailable) missingLocationBanner.textContent = 'Din posisjon er ikke tilgjengelig';
          updateBannerAndOfflinePanelLayout();
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
  ['animationend', 'spiderfied', 'unspiderfied'].forEach((evt) => {
    siteLayerGroup.on(evt, scheduleShapeVisibilityUpdate);
    siteLayerGroup.on(evt, enforceLabelsVisibility);
  });
}
map.on('movestart zoomstart', nullstillFlisTeller);
map.on('zoomend moveend', scheduleShapeVisibilityUpdate);
map.on('zoomend', enforceLabelsVisibility);

function renderSites(sitesToRender, { fitToBounds = false } = {}) {
  if (Array.isArray(sitesToRender)) currentRenderedSites = sitesToRender;
  siteLayerGroup.clearLayers();
  siteShapesGroup.clearLayers();
  siteLabelMarkers.length = 0;
  // Nullstilles sammen med resten: står det igjen lag fra forrige tegning her,
  // ville anvendVisning() prøvd å løfte lag som allerede er ryddet bort.
  sistePolygonLag = [];
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
      // Navnene velges av AO-brukerne selv, og Leaflet setter popup og tooltip
      // som HTML. Uescapet ødela et «"» i navnet knappen under, og «<» ble tolket.
      const navnHtml = escapeHtml(siteName);
      const displayName = isMine ? `★ ${navnHtml}` : navnHtml;

      const distance = isUserPositionAvailable ? haversine(userPosition.lat, userPosition.lon, lat, lon) : null;
      let distStr = '';
      if (distance !== null) distStr = distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`;

      const siteIdStr = site.id != null ? String(site.id) : '';
      let popupHtml = `<strong>${displayName}</strong>`;
      if (distStr) popupHtml += `<br>Avstand: ${distStr}`;
      popupHtml += `<br><br><button onclick="selectLocation(${escapeHtml(JSON.stringify(siteName))}, ${escapeHtml(JSON.stringify(siteIdStr))})">Velg denne lokaliteten</button>`;

      const siteShapeLayers = [];
      const hasPolygon = !!(site.raw && site.raw.isPolygon && site.raw.polygonCoordinates && site.raw.polygonCoordinates.length > 0);
      if (hasPolygon) {
        const leafletCoords = site.raw.polygonCoordinates.map(coord => [coord[1], coord[0]]);
        const polygon = L.polygon(leafletCoords, {
          color: polygonColor, weight: 2, opacity: 0.8, fillColor: polygonColor, fillOpacity: 0.15
        }).addTo(siteShapesGroup).bindPopup(popupHtml);
        polygon.on('click', () => { if (visNavn(visning)) selectLocation(siteName, site.id ?? null); });
        polygonLayers.push(polygon);
        siteShapeLayers.push(polygon);
      }

      if (!hasPolygon && site.raw) {
        const accuracyM = parseFloat(site.raw.accuracy ?? site.raw.Accuracy);
        if (!isNaN(accuracyM) && accuracyM > 0) {
          const radiusCircle = L.circle([lat, lon], {
            radius: accuracyM, color: polygonColor, weight: 2, opacity: 0.8, fillColor: polygonColor, fillOpacity: 0.12, dashArray: '5 5'
          }).addTo(siteShapesGroup).bindPopup(popupHtml);
          radiusCircle.on('click', () => { if (visNavn(visning)) selectLocation(siteName, site.id ?? null); });
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

      const tooltipText = distStr ? `${navnHtml} (${distStr})` : navnHtml;
      const tooltipClasses = ['site-label'];
      if (isMine) tooltipClasses.push('mine-label');
      if (site.isSuper) tooltipClasses.push('super-label');
      marker.bindTooltip(tooltipText, { permanent: true, direction: 'top', className: tooltipClasses.join(' '), offset: hasPolygon ? [0, -4] : [0, -35] });
      if (!visNavn(visning)) marker.closeTooltip();
      marker.on('add', () => { if (!visNavn(visning)) marker.closeTooltip(); });
      siteLabelMarkers.push(marker);

      marker.on('click', () => { if (visNavn(visning)) selectLocation(siteName, site.id ?? null); });

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

    // Selve løftingen gjøres av anvendVisning() på slutten av denne
    // funksjonen OG hver gang laggruppa legges tilbake på kartet — se
    // begrunnelsen der.
    sistePolygonLag = polygonLayers;
  }

  if (fitToBounds && siteCount > 0) map.fitBounds(bounds, { padding: [50, 50], animate: false });
  scheduleShapeVisibilityUpdate();
  showDownloadedSitesFeedback(publicSiteCount, privateSiteCount);

  // Håndhev gjeldende visning på det nylig tegnede: lagene over ble lagt inn
  // i siteLayerGroup uten hensyn til om brukeren har skjult navn eller alt.
  // Uten dette ville en panorer-oppdatering smettet lokalitetene inn igjen.
  anvendVisning();

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
} else {
  renderSites(sites, { fitToBounds: false });
}

const MAX_AUTO_FETCH_RADIUS_M = 3000;
const AUTO_FETCH_RADIUS_M = Math.max(MAX_AUTO_FETCH_RADIUS_M, sizeMeters);
const MIN_REFETCH_DISTANCE_M = Math.max(150, AUTO_FETCH_RADIUS_M / 4);

let lastFetchedCenter = { lat: map.getCenter().lat, lon: map.getCenter().lng };
let moveendTimer = null;
let fetchSeq = 0;
const lokalitetsstatus = document.getElementById('map-sites-status');

map.on('moveend', handleMapMoveEnd);

async function hentOgTegnLokaliteter(center, seq) {
  const diameter = AUTO_FETCH_RADIUS_M * 2;
  const bounds = createCenteredBounds(center.lat, center.lng, diameter, diameter);
  const egneLokaliteter = () => filterSitesInBounds(getCachedPrivateSites(), bounds)
    .map((site) => ({ ...site, isMine: true, isPrivate: true }));
  lokalitetsstatus?.replaceChildren('Henter lokaliteter …');
  try {
    const { sites: bboxSites } = await fetchLocationsWithNetworkMode(center.lat, center.lng, AUTO_FETCH_RADIUS_M, {
      ensureTokens: ensureAoTokens, fetchOnline: fetchAoSitesCached, persistOpportunistic: true,
      onCachedSites(cachedSites) {
        if (seq !== fetchSeq) return;
        // Eiendomsmerking i offline-lageret kan være fra en tidligere konto.
        const offentlige = cachedSites.filter((site) => !site.isMine && !isOthersPrivateSite(site));
        const lokale = mergeCachedSites(offentlige, egneLokaliteter());
        if (lokale.length === 0) return;
        renderSites(lokale, { fitToBounds: false });
        lokalitetsstatus?.replaceChildren();
      },
    });
    if (seq !== fetchSeq || bboxSites.length === 0) return;

    const merged = mergeAoSitesWithPrivateCache(
      mergeCachedSites(egneLokaliteter(), bboxSites), { lat: center.lat, lon: center.lng }, sizeMeters,
    );
    renderSites(merged, { fitToBounds: false });
  } finally {
    if (seq === fetchSeq) lokalitetsstatus?.replaceChildren();
  }
}

if (!isOfflineMode() && sites.length === 0) {
  hentOgTegnLokaliteter(map.getCenter(), ++fetchSeq).catch((e) => {
    console.warn('Kunne ikke hente lokaliteter ved kartoppstart:', e);
  });
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
      lokalitetsstatus?.replaceChildren();
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
      await hentOgTegnLokaliteter(center, seq);
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
  marker.bindTooltip(`★ ${escapeHtml(name)}`, { permanent: true, direction: 'top', className: 'site-label mine-label', offset: [0, -35] });
  if (!visNavn(visning)) marker.closeTooltip();
  marker.on('add', () => { if (!visNavn(visning)) marker.closeTooltip(); });
  labelMarkers.push(marker);
  marker.bindPopup(`<strong>★ ${escapeHtml(name)}</strong><br><em>Nettopp opprettet</em>`);
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
const offlineAreasListBtn = document.getElementById('offline-areas-list-btn');
if (offlineAreasListBtn) {
  // Sikre at knappen har listeikon og er skjult ved oppstart (vises kun i områdevalg)
  offlineAreasListBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6"></line>
      <line x1="8" y1="12" x2="21" y2="12"></line>
      <line x1="8" y1="18" x2="21" y2="18"></line>
      <line x1="3" y1="6" x2="3.01" y2="6"></line>
      <line x1="3" y1="12" x2="3.01" y2="12"></line>
      <line x1="3" y1="18" x2="3.01" y2="18"></line>
    </svg>
  `;
  offlineAreasListBtn.style.display = 'none';
}

const downloadedAreasModalBackdrop = document.getElementById('downloaded-areas-modal-backdrop');
const downloadedAreasListEl = document.getElementById('downloaded-areas-list');
const closeDownloadedAreasBtn = document.getElementById('close-downloaded-areas-btn');

const mapTopProgressEl = document.getElementById('map-top-progress');
const mapTopProgressBarEl = document.getElementById('map-top-progress-bar');
const mapTopProgressTextEl = document.getElementById('map-top-progress-text');

const offlineDimsEl = document.getElementById('offline-area-dims');
const offlineLimitMsgEl = document.getElementById('offline-area-limit-msg');
const cancelOfflineBtn = document.getElementById('cancel-offline-area-btn');
const downloadOfflineBtn = document.getElementById('download-offline-area-btn');

const offlineOverlayPane = map.createPane('offlineOverlayPane');
offlineOverlayPane.style.zIndex = 380;
offlineOverlayPane.style.pointerEvents = 'none';

const offlineAreaPane = map.createPane('offlineAreaPane');
offlineAreaPane.style.zIndex = 620;

const offlineHandlesPane = map.createPane('offlineHandlesPane');
offlineHandlesPane.style.zIndex = 750;

let showOfflineMarkers = true, currentOfflineBounds = null, offlineRectLayer = null, offlineCenterMarker = null;
let offlineCheckMarker = null, offlineDarkOverlayLayer = null;
const offlineCornerMarkers = {};
let isBoxDragging = false, boxDragStartLatLng = null, boxDragStartCenter = null;
let isDownloadingArea = false;

/**
 * Justerer plasseringa slik at offline-panelet og "Din posisjon er ikke tilgjengelig"-banneret
 * aldri overlappar kvarandre, samtidig som horisontal midtstilling (translateX(-50%)) bevares.
 */
function updateBannerAndOfflinePanelLayout() {
  if (!missingLocationBanner || !offlinePanel) return;

  const isBannerVisible =
    missingLocationBanner.style.display !== 'none' &&
    window.getComputedStyle(missingLocationBanner).display !== 'none';

  if (offlineSelectMode && isBannerVisible) {
    requestAnimationFrame(() => {
      const bannerRect = missingLocationBanner.getBoundingClientRect();
      const bannerHeight = bannerRect.height || 40;

      // Flytt kun med translateY (ikkje både margin-bottom og transform, som gav +60px dobbel effekt)
      // og behold translateX(-50%) slik at boksen held seg midtstilt.
      const liftPx = Math.max(8, Math.round(bannerHeight + 8));
      offlinePanel.style.removeProperty('margin-bottom');
      offlinePanel.style.setProperty('transform', `translate(-50%, -${liftPx}px)`, 'important');
    });
  } else {
    offlinePanel.style.removeProperty('margin-bottom');
    offlinePanel.style.removeProperty('transform');
  }
}

function updateOfflineMarkersVisibility(visible) {
  showOfflineMarkers = visible;
  if (visible) {
    labelMarkers.forEach((m) => { if (!map.hasLayer(m)) m.addTo(map); });
    // anvendVisning() avgjør selv om siteLayerGroup skal på kartet og hvilke
    // tooltips som skal stå åpne. La den gjøre det her også, ellers kjemper
    // de to knappene: står visningen på «skjul alt», ville denne ellers dratt
    // lokalitetene inn igjen bak ryggen på brukeren.
    anvendVisning();
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

  if (offlineCheckMarker) {
    offlineCheckMarker.setLatLng([north, west]);
    const checkBtnEl = offlineCheckMarker.getElement()?.querySelector('.offline-check-btn');
    if (checkBtnEl) {
      checkBtnEl.classList.toggle('is-offline-blocked', isOfflineMode());
    }
  }

  const { widthM, heightM } = getBoundsDimensionsMeters(currentOfflineBounds);
  // Arealet er det som koster, så det vises sammen med målene — og et anslag
  // på nedlastingen, siden 250 km² er rundt 34 MB. Det skal man ikke oppdage
  // etterpå, på mobildata i felt.
  const arealKm2 = boundsAreaKm2(currentOfflineBounds);
  const antallFliser = calculateTilesForBounds(currentOfflineBounds, OFFLINE_ZOOM_LEVELS).length;
  const anslagMb = (antallFliser * KB_PER_FLIS) / 1024;
  const anslag = anslagMb >= 1
    ? `~${anslagMb.toFixed(anslagMb >= 10 ? 0 : 1).replace('.', ',')} MB`
    : `~${Math.round(antallFliser * KB_PER_FLIS)} KB`;
  if (offlineDimsEl) {
    offlineDimsEl.textContent =
      `${formatKm(widthM)} × ${formatKm(heightM)} km · ${Math.round(arealKm2)} km² · ${anslag}`;
  }
  if (offlineLimitMsgEl) {
    if (clamped) {
      offlineLimitMsgEl.textContent = `Maksimalt areal nådd (${MAX_OFFLINE_AREA_KM2} km²).`;
      offlineLimitMsgEl.classList.add('limit-reached');
    } else {
      offlineLimitMsgEl.textContent =
        `Dra midtpunktet (✥) for å flytte, eller hjørnene for å endre størrelse (maks ${MAX_OFFLINE_AREA_KM2} km² — formen er fri).`;
      offlineLimitMsgEl.classList.remove('limit-reached');
    }
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

/**
 * Slår sammen overlappende rektangler til ikke-overlappende rektangler som dekker nøyaktig
 * samme område. Nødvendig for det mørke laget: Leaflet tegner polygoner med fill-rule «evenodd»,
 * så et punkt der to hull overlapper telles to ganger og blir fylt (mørkt) igjen — som om
 * området ikke var lastet ned.
 * @param {Array<{south:number, west:number, north:number, east:number}>} rects
 * @returns {Array<{south:number, west:number, north:number, east:number}>}
 */
function unionRectangles(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r.west, r.east]))].sort((a, b) => a - b);
  const strips = [];

  // Del kartet i vertikale striper mellom alle kant-koordinatene, og slå sammen y-intervallene
  // som dekker hver stripe.
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    const intervals = rects
      .filter((r) => r.west <= x0 && r.east >= x1)
      .map((r) => [r.south, r.north])
      .sort((a, b) => a[0] - b[0]);
    const merged = [];
    intervals.forEach(([south, north]) => {
      const last = merged[merged.length - 1];
      if (last && south <= last[1]) last[1] = Math.max(last[1], north);
      else merged.push([south, north]);
    });
    merged.forEach(([south, north]) => strips.push({ south, west: x0, north, east: x1 }));
  }

  // Slå sammen nabostriper med identisk y-intervall til ett rektangel (færre hull, færre sømmer)
  const result = [];
  strips.forEach((strip) => {
    const prev = result.find((r) => r.south === strip.south && r.north === strip.north && r.east === strip.west);
    if (prev) prev.east = strip.east;
    else result.push({ ...strip });
  });
  return result;
}

async function updateOfflineDarkOverlay() {
  if (!offlineSelectMode) return;
  try {
    const areas = await getOfflineAreas();
    const worldRing = [
      [-90, -180],
      [-90, 180],
      [90, 180],
      [90, -180],
    ];
    // Overlappende områder må slås sammen, ellers blir overlappen mørk (se unionRectangles)
    const holes = unionRectangles(
      (Array.isArray(areas) ? areas : [])
        .filter((a) => a && a.bounds && typeof a.bounds.south === 'number')
        .map((a) => a.bounds),
    )
      .map((b) => [
        [b.south, b.west],
        [b.north, b.west],
        [b.north, b.east],
        [b.south, b.east],
      ]);

    if (offlineDarkOverlayLayer) {
      map.removeLayer(offlineDarkOverlayLayer);
      offlineDarkOverlayLayer = null;
    }

    offlineDarkOverlayLayer = L.polygon([worldRing, ...holes], {
      pane: 'offlineOverlayPane',
      color: 'transparent',
      fillColor: '#0f172a',
      fillOpacity: 0.45,
      interactive: false,
    }).addTo(map);
  } catch (err) {
    console.warn('Kunne ikke oppdatere mørkt overlay for offline-områder:', err);
  }
}

function createOfflineCheckMarker(latLng) {
  const marker = L.marker(latLng, {
    icon: L.divIcon({
      className: '',
      html: `
        <div class="offline-check-hit" title="Last ned dette området">
          <button type="button" class="offline-check-btn" id="offline-check-download-btn" aria-label="Last ned dette området" title="Last ned dette området">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </button>
        </div>
      `,
      iconSize: [48, 48],
      iconAnchor: [56, 24],
    }),
    pane: 'offlineHandlesPane',
    zIndexOffset: 2500,
  }).addTo(map);

  const checkBtnEl = marker.getElement()?.querySelector('.offline-check-btn');
  if (checkBtnEl) {
    checkBtnEl.classList.toggle('is-offline-blocked', isOfflineMode());
    checkBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      startOfflineAreaDownload();
    });
    checkBtnEl.addEventListener('touchstart', (e) => {
      e.stopPropagation();
    });
    checkBtnEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
  }

  return marker;
}

function enterOfflineSelectMode() {
  if (pinDropMode) exitPinDropMode();
  offlineSelectMode = true;

  // Brukeren har åpnet offline-valg: deaktiver oppstartssikringa
  userHasMovedMap = true;
  startViewGuardUntil = 0;

  if (toggleOfflineBtn) toggleOfflineBtn.textContent = '✕ Lukk områdevalg';
  if (offlineAreasListBtn) offlineAreasListBtn.style.display = 'flex';
  if (toggleOfflineMarkersBtn) { toggleOfflineMarkersBtn.style.display = 'flex'; toggleOfflineMarkersBtn.textContent = showOfflineMarkers ? '📍 Skjul lokaliteter' : '📍 Vis lokaliteter'; }
  if (offlinePanel) offlinePanel.style.display = 'block';
  refreshMapOfflineStorageStats();
  updateBannerAndOfflinePanelLayout();

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

  offlineCheckMarker = createOfflineCheckMarker([north, west]);

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
  updateOfflineDarkOverlay();

  // Fast zoom-nivå 11 når offline-område opnast
  const centerPoint = [(north + south) / 2, (east + west) / 2];
  map.setView(centerPoint, 11, { animate: true });
}

function exitOfflineSelectMode() {
  stopMapBoxDrag(); offlineSelectMode = false;
  if (!showOfflineMarkers) updateOfflineMarkersVisibility(true);
  if (toggleOfflineBtn) toggleOfflineBtn.textContent = '📦 Offline-område';
  if (offlineAreasListBtn) offlineAreasListBtn.style.display = 'none';
  if (toggleOfflineMarkersBtn) toggleOfflineMarkersBtn.style.display = isOfflineMode() ? 'flex' : 'none';
  if (offlinePanel) offlinePanel.style.display = 'none';
  updateBannerAndOfflinePanelLayout();

  if (offlineRectLayer) { map.removeLayer(offlineRectLayer); offlineRectLayer = null; }
  if (offlineCenterMarker) { map.removeLayer(offlineCenterMarker); offlineCenterMarker = null; }
  if (offlineCheckMarker) { map.removeLayer(offlineCheckMarker); offlineCheckMarker = null; }
  if (offlineDarkOverlayLayer) { map.removeLayer(offlineDarkOverlayLayer); offlineDarkOverlayLayer = null; }
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

function setTileDownloadProgressVisible(visible, text = 'Laster ned kartfliser...', percent = null) {
  if (mapTopProgressEl) {
    if (visible) {
      if (mapTopProgressTextEl) mapTopProgressTextEl.textContent = text;
      if (mapTopProgressBarEl) {
        if (percent !== null) {
          mapTopProgressBarEl.style.width = `${Math.min(100, Math.max(5, Math.round(percent)))}%`;
        } else {
          mapTopProgressBarEl.style.width = '30%';
        }
      }
      mapTopProgressEl.style.display = 'flex';
    } else {
      mapTopProgressEl.style.display = 'none';
      if (mapTopProgressBarEl) mapTopProgressBarEl.style.width = '0%';
    }
  }

  if (tileDownloadProgressEl) {
    if (visible) {
      if (tileDownloadProgressTextEl) tileDownloadProgressTextEl.textContent = text;
      tileDownloadProgressEl.style.display = 'flex';
    } else {
      tileDownloadProgressEl.style.display = 'none';
    }
  }
}

const OFFLINE_DOWNLOAD_BLOCKED_MESSAGE = 'Kan ikke laste ned kart. Du er offline!';

/** Offline-modus: gjør nedlastingsknapper grå (men trykkbare, så vi kan forklare hvorfor). */
function updateDownloadButtonOfflineState() {
  const blocked = isOfflineMode();
  if (downloadOfflineBtn) {
    downloadOfflineBtn.classList.toggle('is-offline-blocked', blocked);
    downloadOfflineBtn.setAttribute('aria-disabled', blocked ? 'true' : 'false');
    downloadOfflineBtn.title = blocked ? OFFLINE_DOWNLOAD_BLOCKED_MESSAGE : '';
  }
  const checkBtnEl = offlineCheckMarker?.getElement()?.querySelector('.offline-check-btn');
  if (checkBtnEl) {
    checkBtnEl.classList.toggle('is-offline-blocked', blocked);
    checkBtnEl.title = blocked ? OFFLINE_DOWNLOAD_BLOCKED_MESSAGE : 'Last ned dette området';
  }
}
updateDownloadButtonOfflineState();
window.addEventListener('network_mode_changed', updateDownloadButtonOfflineState);
window.addEventListener('storage', updateDownloadButtonOfflineState);

async function startOfflineAreaDownload() {
  if (isDownloadingArea) return;
  if (isOfflineMode()) {
    openMessageModal(OFFLINE_DOWNLOAD_BLOCKED_MESSAGE);
    return;
  }
  if (!currentOfflineBounds) return;
  const targetBounds = { ...currentOfflineBounds };

  isDownloadingArea = true;
  const checkBtnEl = offlineCheckMarker?.getElement()?.querySelector('.offline-check-btn');
  if (checkBtnEl) checkBtnEl.disabled = true;
  if (downloadOfflineBtn) {
    downloadOfflineBtn.disabled = true;
    downloadOfflineBtn.textContent = 'Laster ned lokaliteter …';
  }
  setTileDownloadProgressVisible(true, 'Laster ned lokaliteter …', 10);

  try {
    const existingOfflineSites = await getOfflineLocationsInBounds(targetBounds).catch(() => []);
    let sitesInArea = [], savedInfo = null, sitesAlreadyDownloaded = false;

    if (isOfflineMode()) {
      sitesInArea = existingOfflineSites;
      sitesAlreadyDownloaded = existingOfflineSites.length > 0;
      let pubCount = 0, privCount = 0;
      existingOfflineSites.forEach((s) => { if (isPrivateSite(s) || s.isMine) privCount++; else pubCount++; });
      savedInfo = { publicCount: pubCount, privateCount: privCount, name: 'Nedlastet område' };
    } else {
      let isLoggedIn = hasActiveAoLogin();
      let fetchedSites = [];
      try {
        if (isLoggedIn) isLoggedIn = await ensureAoTokens();
        fetchedSites = await fetchAoSitesByBounds(targetBounds);
      } catch (err) { }
      const fallbackSites = [...existingOfflineSites, ...currentRenderedSites];
      const showOthersPrivate = shouldShowOthersPrivateSites();
      const filteredSites = filterSitesForOfflineDownload(mergeCachedSites(fallbackSites, fetchedSites), [], {
        isLoggedIn,
        showOthersPrivate,
        cachedPrivateSites: isLoggedIn ? getCachedPrivateSites() : [],
      });
      sitesInArea = filterSitesInBounds(filteredSites, targetBounds);
      savedInfo = await saveOfflineAreaLocations(targetBounds, sitesInArea, {
        showOthersPrivate,
        allSites: currentRenderedSites,
      });
    }

    const activeTemplate = KARTVERKET_TOPO_URL_TEMPLATE;
    const allTiles = calculateTilesForBounds(targetBounds, OFFLINE_ZOOM_LEVELS, activeTemplate);
    const totalTilesCount = allTiles.length;
    let cache = null;
    if (typeof caches !== 'undefined') {
      try { cache = await caches.open(MAP_TILE_CACHE_NAME); } catch (_) {}
    }

    const tilesToDownload = [];
    if (cache) {
      for (const t of allTiles) {
        const tileUrl = typeof t === 'string' ? t : t.url;
        if (tileUrl) {
          const inCache = await cache.match(tileUrl);
          if (!inCache) tilesToDownload.push(t);
        } else { tilesToDownload.push(t); }
      }
    } else {
      tilesToDownload.push(...allTiles);
    }

    const tilesAlreadyDownloaded = tilesToDownload.length === 0;
    let failedCount = 0;

    if (tilesAlreadyDownloaded) {
      if (downloadOfflineBtn) downloadOfflineBtn.textContent = 'Kartfliser er allerede lagret';
    } else {
      setTileDownloadProgressVisible(true, `Laster ned kartfliser... (0/${tilesToDownload.length})`, 25);
      const result = await downloadTilesInBatches(tilesToDownload, {
        batchSize: MAX_TILE_BATCH_SIZE,
        cacheName: MAP_TILE_CACHE_NAME,
        onProgress: ({ completed, total }) => {
          const pct = total > 0 ? 25 + (completed / total) * 70 : 50;
          setTileDownloadProgressVisible(true, `Laster ned kartfliser (${completed}/${total}) …`, pct);
          if (downloadOfflineBtn) downloadOfflineBtn.textContent = `Laster ned kartfliser (${completed}/${total}) …`;
        },
      });
      failedCount = result.failed || 0;
    }

    clearFallbackTileMemo();
    renderSites(sitesInArea, { fitToBounds: false });
    await refreshMapOfflineStorageStats();
    await updateOfflineDarkOverlay();
    openDownloadModal(
      savedInfo.publicCount,
      savedInfo.privateCount,
      sitesAlreadyDownloaded && tilesAlreadyDownloaded,
      totalTilesCount,
      failedCount,
    );
  } catch (e) {
    openDownloadModal(0, 0, false, 0, 0);
  } finally {
    setTileDownloadProgressVisible(false);
    isDownloadingArea = false;
    if (checkBtnEl) checkBtnEl.disabled = false;
    if (downloadOfflineBtn) {
      downloadOfflineBtn.disabled = false;
      downloadOfflineBtn.textContent = 'Last ned område for offline-bruk';
    }
  }
}

if (downloadOfflineBtn) {
  downloadOfflineBtn.addEventListener('click', startOfflineAreaDownload);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function renderDownloadedAreasList() {
  if (!downloadedAreasListEl) return;
  downloadedAreasListEl.innerHTML = '<div style="padding:14px;text-align:center;color:#64748b;font-size:14px;">Laster nedlastede områder …</div>';

  try {
    const areas = await getOfflineAreas();
    if (!areas || areas.length === 0) {
      downloadedAreasListEl.innerHTML = '<div style="padding:24px 12px;text-align:center;color:#64748b;font-size:14px;">Ingen nedlastede områder ennå.</div>';
      return;
    }

    downloadedAreasListEl.innerHTML = '';
    areas.forEach((area) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'downloaded-area-item';
      itemEl.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;gap:10px;';

      const { widthM, heightM } = getBoundsDimensionsMeters(area.bounds || {});
      const dimStr = `${formatKm(widthM)} × ${formatKm(heightM)} km`;
      const count = area.totalCount != null ? area.totalCount : ((area.publicCount || 0) + (area.privateCount || 0));
      const areaName = area.name || 'Nedlastet område';

      const infoWrap = document.createElement('div');
      infoWrap.style.cssText = 'flex:1;cursor:pointer;min-width:0;';
      infoWrap.setAttribute('role', 'button');
      infoWrap.setAttribute('tabindex', '0');
      infoWrap.setAttribute('title', 'Sentrer og juster kartet til dette området');
      infoWrap.innerHTML = `
        <div style="font-weight:700;font-size:15px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(areaName)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">ca. ${count} lokaliteter • ${dimStr}</div>
      `;

      // Eit trykk på eit område sentrerer og justerer zoom for dette området
      infoWrap.addEventListener('click', () => {
        if (downloadedAreasModalBackdrop) downloadedAreasModalBackdrop.style.display = 'none';
        if (area.bounds) {
          const { north, south, east, west } = area.bounds;
          map.fitBounds([[south, west], [north, east]], { padding: [30, 30], maxZoom: 15 });
        }
      });

      // Eit trykk på søppelbøtteikon til høgre for området slettar området frå lokal cache/offline område
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.setAttribute('aria-label', `Slett ${areaName}`);
      deleteBtn.setAttribute('title', `Slett ${areaName}`);
      deleteBtn.style.cssText = 'width:38px;height:38px;display:flex;align-items:center;justify-content:center;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;cursor:pointer;font-size:16px;flex-shrink:0;';
      deleteBtn.innerHTML = '🗑️';

      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        deleteBtn.disabled = true;
        try {
          await deleteOfflineArea(area.areaId);
          await renderDownloadedAreasList();
          await updateOfflineDarkOverlay();
          await refreshMapOfflineStorageStats();
          const remaining = await getAllOfflineLocations().catch(() => []);
          renderSites(remaining, { fitToBounds: false });
        } catch (err) {
          console.error('Feil ved sletting av område:', err);
          deleteBtn.disabled = false;
        }
      });

      itemEl.appendChild(infoWrap);
      itemEl.appendChild(deleteBtn);
      downloadedAreasListEl.appendChild(itemEl);
    });
  } catch (err) {
    downloadedAreasListEl.innerHTML = '<div style="padding:14px;text-align:center;color:#dc2626;font-size:13px;">Kunne ikke laste nedlastede områder.</div>';
  }
}

function openDownloadedAreasModal() {
  if (!downloadedAreasModalBackdrop) return;
  downloadedAreasModalBackdrop.style.display = 'flex';
  renderDownloadedAreasList();
}

function closeDownloadedAreasModal() {
  if (downloadedAreasModalBackdrop) downloadedAreasModalBackdrop.style.display = 'none';
}

if (offlineAreasListBtn) {
  offlineAreasListBtn.addEventListener('click', openDownloadedAreasModal);
}
if (closeDownloadedAreasBtn) {
  closeDownloadedAreasBtn.addEventListener('click', closeDownloadedAreasModal);
}
if (downloadedAreasModalBackdrop) {
  downloadedAreasModalBackdrop.addEventListener('click', (e) => {
    if (e.target === downloadedAreasModalBackdrop) closeDownloadedAreasModal();
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && downloadedAreasModalBackdrop && downloadedAreasModalBackdrop.style.display === 'flex') {
    closeDownloadedAreasModal();
  }
});

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
}

startMapUI();
