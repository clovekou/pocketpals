// Pocket Pals service worker: makes the game open fast, especially on phones.
//  - Pictures, sprites and icons (assets/): kept on the device and served from there.
//  - Game code with a version in its name (js/…?v=55, css/…?v=55): kept and served from the device. A new
//    version has a new name, so updates still arrive.
//  - The page itself (index.html, admin.html): asked from the site first (so updates show up), but after
//    a few seconds without an answer the saved copy is used, so a slow connection can't keep the game shut.
//  - Other websites (sign-in, database, cries): never touched.
const ASSETS = 'pp-assets-v1';
const CODE = 'pp-code-v2';
const PAGES = 'pp-pages-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![ASSETS, CODE, PAGES].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const keep = (cache, req, res) => { if (res && res.ok) { const copy = res.clone(); caches.open(cache).then(c => c.put(req, copy)); } return res; };
function cacheFirst(cache, req, ignoreSearch) {
  return caches.open(cache).then(c => c.match(req, { ignoreSearch })).then(hit => hit || fetch(req).then(res => keep(cache, req, res)));
}
function networkFirst(req, wait) {
  return new Promise(resolve => {
    let done = false;
    const fallback = () => caches.open(PAGES).then(c => c.match(req, { ignoreSearch: true })).then(hit => hit || null);
    const timer = setTimeout(() => fallback().then(hit => { if (hit && !done) { done = true; resolve(hit); } }), wait);
    fetch(req).then(res => { keep(PAGES, req, res); if (!done) { done = true; clearTimeout(timer); resolve(res); } })
      .catch(() => fallback().then(hit => { if (!done) { done = true; clearTimeout(timer); resolve(hit || new Response('Offline', { status: 503 })); } }));
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has('check')) return;                       // the update check always asks the site
  if (url.pathname.includes('/assets/')) return e.respondWith(cacheFirst(ASSETS, req, true));
  if (/\.(js|css)$/.test(url.pathname) && url.searchParams.has('v')) return e.respondWith(cacheFirst(CODE, req, false));
  e.respondWith(networkFirst(req, req.mode === 'navigate' ? 3000 : 5000));
});
