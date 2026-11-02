/**
 * Service Worker for Enkel-AO (PWA app-shell og kartflis-cache).
 */

const CACHE_NAME = 'fugleobs-v193';
const MAP_TILE_CACHE_NAME = 'enkel-ao-kartverket-tiles-v1';
const NETWORK_MODE_CACHE_URL = 'https://enkel-ao.local/__network_mode__';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/map.html',
  '/settings.html',
  '/help.html',
  '/sendt.html',
  '/fellestur.html',
  '/mine-delinger.html',
  '/ao-direct.html',
  '/medobs.html',
  '/feedback.html',
  '/changelog.html',
  '/style.css',
  '/manifest.json',
  '/favicon.png',
  '/icon-192.png',
  '/apple-touch-icon.png',
  '/css/1-tokens.css',
  '/css/2-base.css',
  '/css/3-layout.css',
  '/css/4-components.css',
  '/css/5-utilities.css',
  '/css/6-animations.css',
  '/css/7-page-specific.css',
  '/js/theme.js',
  '/js/main.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/storage.js',
  '/js/location.js',
  '/js/observations.js',
  '/js/form-state.js',
  '/js/species-search.js',
  '/js/observation-commit.js',
  '/js/export-operations.js',
  '/js/share.js',
  '/js/visits.js',
  '/js/news-splash.js',
  '/js/first-run-hint.js',
  '/js/species_offline.js',
  '/js/species-matcher.js',
  '/js/version.js',
  '/js/photo-picker.js',
  '/js/bilde-editor.js',
  '/js/bilde-rediger-modal.js',
  '/js/coobserver-picker.js',
  '/js/ao-observer-autocomplete.js',
  '/js/autocomplete.js',
  '/js/celebrate.js',
  '/js/datetime-helpers.js',
  '/js/edit-modal.js',
  '/js/fellestur-client.js',
  '/js/fellestur-sync.js',
  '/js/fellestur.js',
  '/js/map.js',
  '/js/migration-banner.js',
  '/js/offline-area.js',
  '/js/offline-db.js',
  '/js/rarity.js',
  '/js/utils.js',
  '/data/activities.json',
  '/data/norske_arter.json',
  '/data/norske_arter_hierarki.json'
];

let currentNetworkMode = null;

function normalizeSwMode(mode) {
  const str = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
  if (str === 'online' || str === 'hybrid' || str === 'offline') {
    return str;
  }
  return 'hybrid'; // Samme standard som DEFAULT_NETWORK_MODE i offline-db.js
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        // Står appen i offline-modus akkurat nå, hoppes forhåndslastingen over (ingen
        // mobildata); eksisterende cache beholdes. Den fylles neste gang appen er online.
        const modeCache = await caches.open(MAP_TILE_CACHE_NAME);
        if ((await resolveSwNetworkMode(modeCache)) === 'offline') {
          await self.skipWaiting();
          return;
        }
        const cache = await caches.open(CACHE_NAME);
        await Promise.allSettled(
          STATIC_ASSETS.map(async (asset) => {
            const resp = await fetch(asset, { cache: 'no-cache' });
            if (resp && resp.ok) {
              await cache.put(asset, resp);
            }
          }),
        );
      } catch {
        // Ignorer enkeltfeil ved forhåndscaching slik at installasjon aldri blokkeres
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== MAP_TILE_CACHE_NAME)
            .map((key) => caches.delete(key)),
        );
      } catch {
        // Ignorer oppryddingsfeil
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event && event.data;
  if (data && data.type === 'SET_NETWORK_MODE') {
    currentNetworkMode = normalizeSwMode(data.mode);
  }
});

/**
 * Sjekk om en URL er en kartflis-forespørsel som skal håndteres av kartflis-strategien.
 * @param {string} urlString
 * @returns {boolean}
 */
function isMapTileRequest(urlString) {
  try {
    const url = new URL(urlString);
    return (
      url.hostname.includes('cache.kartverket.no') ||
      url.hostname.includes('tile.openstreetmap.org')
    );
  } catch {
    return false;
  }
}

/**
 * Sjekk om en forespørsel gjelder appens egne statiske filer eller navigasjon (app-shell).
 * @param {Request} request
 * @returns {boolean}
 */
function isAppShellRequest(request) {
  try {
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return false;
    if (url.pathname.startsWith('/api/')) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Finn gjeldende nettverksmodus ('online' | 'hybrid' | 'offline') i Service Worker.
 * Leser først fra minne, deretter fra Cache API-oppføringen dersom SW har startet på nytt.
 * @param {Cache|null} cache
 * @returns {Promise<'online'|'hybrid'|'offline'>}
 */
async function resolveSwNetworkMode(cache) {
  if (currentNetworkMode) {
    return currentNetworkMode;
  }
  if (cache && typeof cache.match === 'function') {
    try {
      const modeResp = await cache.match(NETWORK_MODE_CACHE_URL);
      if (modeResp && typeof modeResp.text === 'function') {
        const text = await modeResp.text();
        currentNetworkMode = normalizeSwMode(text);
        return currentNetworkMode;
      }
    } catch {
      // Ignorer feil ved lesing av lagret modus
    }
  }
  return 'hybrid';
}

async function handleMapTileFetch(request) {
  let cache = null;
  try {
    cache = await caches.open(MAP_TILE_CACHE_NAME);
  } catch {
    cache = null;
  }

  const mode = await resolveSwNetworkMode(cache);

  // 1. Offline-modus (Strict Cache-Only): Strengt kun fra lokalt mellomlager
  if (mode === 'offline') {
    if (cache) {
      try {
        const cachedResponse = await cache.match(request.url);
        if (cachedResponse) {
          return cachedResponse;
        }
      } catch {
        // Ignorer oppslagsfeil
      }
    }
    return new Response('', {
      status: 504,
      statusText: 'Offline Mode (Strict Cache Only)',
    });
  }

  // 2. Hybrid-modus (Cache-First): Sjekk lokalt mellomlager først, nettverk som fallback
  if (mode === 'hybrid') {
    if (cache) {
      try {
        const cachedResponse = await cache.match(request.url);
        if (cachedResponse) {
          return cachedResponse;
        }
      } catch {
        // Fall tilbake til nettverk
      }
    }
    const netResponse = await fetch(request);
    if (cache && netResponse && (netResponse.ok || netResponse.type === 'opaque')) {
      try {
        await cache.put(
          request.url,
          typeof netResponse.clone === 'function' ? netResponse.clone() : netResponse,
        );
      } catch {
        // Ignorer kvote-/lagringsfeil
      }
    }
    return netResponse;
  }

  // 3. Online-modus (Network-First): Hent alltid ferskeste flis fra nettverket først,
  // og lagre flisen i Cache API slik at den også blir tilgjengelig offline senere.
  try {
    const netResponse = await fetch(request);
    if (cache && netResponse && (netResponse.ok || netResponse.type === 'opaque')) {
      try {
        await cache.put(
          request.url,
          typeof netResponse.clone === 'function' ? netResponse.clone() : netResponse,
        );
      } catch {
        // Ignorer kvote-/lagringsfeil
      }
    }
    return netResponse;
  } catch (err) {
    if (cache) {
      try {
        const cachedResponse = await cache.match(request.url);
        if (cachedResponse) {
          return cachedResponse;
        }
      } catch {
        // Ignorer
      }
    }
    throw err;
  }
}

/**
 * Slå opp en app-shell-forespørsel i mellomlageret (med fallback til forsiden ved navigasjon).
 * @returns {Promise<Response|null>}
 */
async function matchAppShell(cache, request) {
  if (!cache) return null;
  try {
    const cached =
      (await cache.match(request)) ||
      (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match(request.url));
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return (await cache.match('/')) || (await cache.match('/index.html')) || null;
    }
  } catch {
    // Ignorer oppslagsfeil
  }
  return null;
}

async function openCacheSafe(name) {
  try {
    return await caches.open(name);
  } catch {
    return null;
  }
}

async function handleAppShellFetch(request) {
  const cache = await openCacheSafe(CACHE_NAME);

  // Offline-modus (Strict Cache-Only): ALDRI nettverk — heller ikke for å revalidere
  // appfilene. Før gikk hver side-, JS-, CSS- og JSON-forespørsel til nettverket
  // (cache: 'no-cache') selv i offline-modus, og brukte dermed mobildata.
  const mode = await resolveSwNetworkMode(await openCacheSafe(MAP_TILE_CACHE_NAME));
  if (mode === 'offline') {
    const cached = await matchAppShell(cache, request);
    return (
      cached ||
      new Response('', { status: 504, statusText: 'Offline Mode (Strict Cache Only)' })
    );
  }

  try {
    const netResponse = await fetch(request, { cache: 'no-cache' });
    if (cache && netResponse && netResponse.ok) {
      try {
        await cache.put(
          request,
          typeof netResponse.clone === 'function' ? netResponse.clone() : netResponse,
        );
      } catch {
        // Ignorer lagringsfeil
      }
    }
    return netResponse;
  } catch (err) {
    const cached = await matchAppShell(cache, request);
    if (cached) return cached;
    throw err;
  }
}

/**
 * Appens egne /api/-kall (alle metoder). I offline-modus går de aldri til nettverket;
 * i øvrige moduler sendes de uendret videre.
 */
async function handleApiFetch(request) {
  const mode = await resolveSwNetworkMode(await openCacheSafe(MAP_TILE_CACHE_NAME));
  if (mode === 'offline') {
    return new Response(JSON.stringify({ error: 'Offline-modus: ingen nettverkskall' }), {
      status: 503,
      statusText: 'Offline Mode',
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return fetch(request);
}

function isApiRequest(request) {
  try {
    const url = new URL(request.url);
    return url.origin === self.location.origin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/**
 * Eksterne ressurser som ikke er kartfliser (Leaflet fra unpkg, markørikoner m.m.).
 * Offline-modus: kun fra mellomlager. Ellers: nettverk, og en kopi lagres så de
 * finnes lokalt neste gang appen brukes offline.
 */
function isExternalAssetRequest(request) {
  try {
    const url = new URL(request.url);
    if (url.origin === self.location.origin) return false;
    return ['script', 'style', 'image', 'font'].includes(request.destination);
  } catch {
    return false;
  }
}

async function handleExternalAssetFetch(request) {
  const cache = await openCacheSafe(CACHE_NAME);
  const mode = await resolveSwNetworkMode(await openCacheSafe(MAP_TILE_CACHE_NAME));
  if (mode === 'offline') {
    try {
      const cached = cache && (await cache.match(request.url));
      if (cached) return cached;
    } catch {
      // Ignorer oppslagsfeil
    }
    return new Response('', { status: 504, statusText: 'Offline Mode (Strict Cache Only)' });
  }
  try {
    const netResponse = await fetch(request);
    if (cache && netResponse && (netResponse.ok || netResponse.type === 'opaque')) {
      try {
        await cache.put(request.url, netResponse.clone());
      } catch {
        // Ignorer kvote-/lagringsfeil
      }
    }
    return netResponse;
  } catch (err) {
    try {
      const cached = cache && (await cache.match(request.url));
      if (cached) return cached;
    } catch {
      // Ignorer
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // /api/-kall (også POST) må sjekkes FØR GET-filteret, ellers slipper de forbi
  // offline-sperren.
  if (isApiRequest(request)) {
    event.respondWith(handleApiFetch(request));
    return;
  }

  if (request.method !== 'GET') return;

  if (isMapTileRequest(request.url)) {
    event.respondWith(handleMapTileFetch(request));
    return;
  }

  if (isAppShellRequest(request)) {
    event.respondWith(handleAppShellFetch(request));
    return;
  }

  if (isExternalAssetRequest(request)) {
    event.respondWith(handleExternalAssetFetch(request));
  }
});
