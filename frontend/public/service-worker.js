// Offline-capable Service Worker (simple, sin precache de assets hashed)
const CACHE_NAME = 'olive-tracking-offline-v3';
const CORE = ['/', '/index.html', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try { await cache.addAll(CORE); } catch (_) {}
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Limpiar caches antiguos
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

// Estrategias:
// - Navegaciones/HTML: network-first, fallback a index.html cacheado
// - Assets /assets/: cache-first con actualización en background
// - Otros GET: cache-first, fallback a red
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  const isAsset = url.pathname.startsWith('/assets/');
  const isApi = url.pathname.startsWith('/api/');

  // No cache para API protegida; requiere estar online y autenticado
  if (isApi) {
    event.respondWith(fetch(req));
    return;
  }

  if (isHTML) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          // Mantener index.html actualizado
          cache.put('/index.html', fresh.clone());
          return fresh;
        } catch (_) {
          const cached = await caches.match('/index.html');
          return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  if (isAsset) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        if (cached) {
          // Actualizar en background
          fetch(req).then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
          }).catch(() => {});
          return cached;
        }
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch (e) {
          return new Response('', { status: 504, statusText: 'Asset unavailable offline' });
        }
      })()
    );
    return;
  }

  // Genérico GET: cache-first
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (_) {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })()
  );
});
