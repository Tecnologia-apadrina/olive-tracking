const CACHE_NAME = 'olive-tracking-cache-v2';
// No precache de index.html para evitar servir HTML obsoleto tras despliegues
const URLS_TO_CACHE = ['/', '/manifest.json', '/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames.map(name => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
          return undefined;
        })
      )
    )
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const accept = req.headers.get('accept') || '';
  // Para navegaciones/HTML: estrategia red primero, y caer a cache si offline
  if (req.mode === 'navigate' || accept.includes('text/html')) {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;
  }
  // Para otros recursos: cache primero, red si no existe
  event.respondWith(
    caches.match(req).then(res => res || fetch(req))
  );
});
