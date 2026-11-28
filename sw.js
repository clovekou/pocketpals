// Pocket Pals service worker: makes the game load quickly after the first visit.
//  - Pictures, sprites and icons (assets/): kept on the device and served from there (they rarely change).
//  - The game itself (HTML, JS, CSS, manifest): always fetched fresh when online, with the saved copy as a
//    fallback, so updates arrive straight away (and the "new version" bar keeps working).
//  - Other websites (sign-in, database, cries): never touched.
const ASSETS = 'pp-assets-v1';
const CODE = 'pp-code-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== ASSETS && k !== CODE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has('check')) return;                       // the update check must always ask the site

  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.open(ASSETS).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // the game's code and pages: network first, saved copy when offline
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CODE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.open(CODE).then(c => c.match(req)).then(hit => hit || caches.match(req, { ignoreSearch: true }))
    .then(hit => hit || new Response('Offline', { status: 503, statusText: 'Offline' }))));
});
