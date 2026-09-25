// Service worker: app-shell offline beschikbaar. Microsoft/Graph/OSM-verkeer gaat altijd naar het netwerk.
const CACHE = 'klantkaart-v5';
const SHELL = [
  './', 'index.html', 'auth.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/planner.js', 'js/graph.js', 'js/excel.js', 'js/geo.js', 'js/demo.js', 'js/claude.js', 'js/auth-page.js',
  'vendor/xlsx.full.min.js', 'vendor/MicrosoftTeams.min.js', 'vendor/anthropic-sdk.mjs',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Stale-while-revalidate voor eigen bestanden: direct uit cache, op de achtergrond bijwerken.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/auth.html') && url.search) return; // aanmeld-callback nooit uit cache
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request)
        .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
