// Minimal service worker: makes the site installable and shows an offline page when a
// navigation fails. It caches nothing else: the browser's HTTP cache already handles the
// hashed build assets, and a second cache layer risked serving stale chunks to the map.
const VERSION = 'v2';
const STATIC = `static-${VERSION}`;
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode !== 'navigate') return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;
  event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
});
