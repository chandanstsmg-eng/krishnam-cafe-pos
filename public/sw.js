/*
 * Keeps the till's screens available when this device cannot reach the
 * server (Wi-Fi drop, server PC restarting). Orders and bills are queued by
 * the app itself; this worker only makes sure the app can still open.
 */
const CACHE = 'annapoorna-shell-v4';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(['/', '/logo-128.png', '/logo-192.png', '/dhishaai-logo.png', '/manifest.webmanifest']);
      try {
        const res = await fetch('/asset-manifest.json', { cache: 'no-store' });
        const manifest = await res.json();
        const files = new Set();
        for (const entry of Object.values(manifest)) {
          if (entry.file) files.add('/' + entry.file);
          for (const css of entry.css || []) files.add('/' + css);
          for (const a of entry.assets || []) files.add('/' + a);
        }
        await cache.addAll([...files]);
      } catch {
        /* dev mode or first build still running — runtime caching covers it */
      }
      self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Pages: try the network, fall back to the cached app shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(async (res) => {
          // Only a real page becomes the offline shell — never a proxy error page
          // shown while the server restarts (serve the saved shell instead).
          if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/', copy));
            return res;
          }
          if (res.status >= 500) return (await caches.match('/')) || res;
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Hashed build files never change: cache first.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.startsWith('/assets/') || /\.(svg|png)$/.test(url.pathname))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
