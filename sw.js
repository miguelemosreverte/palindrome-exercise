// Bridge Service Worker — caching for offline + PWA install support
var CACHE_NAME = 'bridge-v1';
var PRECACHE = [
  '/miniapp.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap',
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
          .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Never cache API calls or Firebase
  if (url.pathname.startsWith('/api/') ||
      url.hostname.includes('firebasedatabase') ||
      url.hostname.includes('telegram.org')) {
    return;
  }

  // Network-first for HTML, cache-first for assets
  if (event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request).catch(function() {
        return caches.match(event.request);
      })
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        return cached || fetch(event.request).then(function(resp) {
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
          return resp;
        });
      })
    );
  }
});
