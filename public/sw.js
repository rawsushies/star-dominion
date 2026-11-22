// Star Dominion service worker: lets the game start and play offline after the first visit, and
// keeps the large models, textures and sounds on the device so they load instantly next time.
//
//   - the page itself: network first (so a new release arrives on the next visit), cache fallback
//   - built code (assets/*-<hash>.js|css): cache first; the file name changes with every build
//   - models, textures, audio, fonts: cache first, fetched once on demand
//
// The cache name carries the release version (sw.js?v=<version>); old caches are removed when a
// new release activates. Only GET requests to this site are handled; cloud saves go straight
// to the network.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `star-dominion-${VERSION}`;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('star-dominion-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || (await cache.match('./index.html')) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // partial (range) responses cannot be cached
  if (res.ok && res.status === 200) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.has('range')) return;
  if (req.mode === 'navigate') { event.respondWith(networkFirst(req)); return; }
  if (/\/assets\/|\.(glb|gltf|bin|ktx2|png|jpe?g|webp|ogg|mp3|wav|m4a|woff2?|json|svg)$/i.test(url.pathname)) { event.respondWith(cacheFirst(req)); return; }
  event.respondWith(networkFirst(req));
});
