// Service Worker for offline-støtte
const CACHE_NAME = 'fugleobs-v14';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/js/main.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/storage.js',
  '/js/location.js',
  '/js/observations.js',
  '/data/activities.json',
  '/favicon.svg'
];

// Installer og cache statiske filer
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
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

// Håndter requests: cache-first for statiske filer, network-first for API
self.addEventListener('fetch', (event) => {
  // Network-first for alle requests: alltid prøv nett først, fallback til cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Oppdater cache med ferskt svar
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
