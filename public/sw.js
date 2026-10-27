// Service Worker for offline-støtte
const CACHE_NAME = 'fugleobs-v175';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/fellestur.html',
  '/js/fellestur.js',
  '/js/fellestur-client.js',
  '/js/fellestur-sync.js',
  '/js/autocomplete.js',
  '/style.css',
  // style.css er en ren @import-fil — uten disse sju precaches selve stilene
  // ALDRI av service workeren, bare omslaget rundt dem. To følger: en offline
  // PWA-start kan lande på en ustilt side, og enhver CSS-endring kan bli
  // liggende bak Cloudflares max-age=14400 i opptil fire timer etter deploy
  // selv om CACHE_NAME er bumpet. Må holdes i synk med @import-lista i
  // style.css når en modul kommer til eller forsvinner.
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
  '/img/nyhet-bilder-hjemme.jpg',
  '/js/first-run-hint.js',
  '/js/species_offline.js',
  '/js/version.js',
  '/js/photo-picker.js',
  '/js/bilde-editor.js',
  '/js/coobserver-picker.js',
  '/js/ao-observer-autocomplete.js',
  '/js/datetime-helpers.js',
  '/js/edit-modal.js',
  '/js/rarity.js',
  '/js/celebrate.js',
  '/data/activities.json',
  '/data/norske_arter.json',
  '/favicon.png'
];

// Installer og cache statiske filer
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // cache: 'reload' hopper over nettleserens HTTP-cache. Uten den kan en ny SW
      // precache akkurat de utdaterte filene den skulle erstatte — Cloudflare sender
      // max-age=14400 på JS, så nettleseren ville ellers svart fra egen cache.
      // ?v=CACHE_NAME gjør det samme mot Cloudflare-edgen: den cacher per full URL,
      // så en ny versjon gir garantert et ferskt hent fra origin. Svaret lagres
      // under den rene URL-en, så oppslag i fetch-handleren er uendret.
      return Promise.all(STATIC_ASSETS.map((url) =>
        fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + CACHE_NAME, { cache: 'reload' })
          .then((res) => (res.ok ? cache.put(url, res) : null))
          .catch(() => null)
      ));
    })
  );
  self.skipWaiting();
});

// Rydd opp gamle cacher
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Nettverkskall med timeout — faller tilbake til cache hvis nett er tregt/nede
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// Håndter requests: network-first med timeout, fallback til cache
// API-kall går direkte til nettverket uten SW-timeout (backend har egen timeout)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    fetchWithTimeout(event.request, 5000)
      .then((response) => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
