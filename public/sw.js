// Minimal service worker: keeps the site installable and shows a short page when a
// navigation fails offline. It uses no cache at all; everything comes from the network.
const OFFLINE_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#ededeb;color:#141414;font:16px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif}@media(prefers-color-scheme:dark){body{background:#1c1c1c;color:#ededed}}main{padding:24px;max-width:28rem}a{color:inherit}</style>
<main><h1>You&rsquo;re offline</h1><p>The map needs a connection to load photos.</p><p><a href="/">Try again</a></p></main>`;

self.addEventListener('install', () => self.skipWaiting());

// Clears whatever earlier versions of this worker stored.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;
  event.respondWith(
    fetch(request).catch(
      () => new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    ),
  );
});
