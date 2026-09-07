// Service worker de ArcaKey.
//
// Solo hace una cosa: guardar el propio `index.html` para que la aplicacion
// abra sin conexion. **No toca la boveda**, no cachea datos y no habla con
// ningun servidor.
const CACHE = 'vault-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((claves) => Promise.all(
    claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Primero la red y si no hay, lo guardado: asi una version nueva se coge en
  // cuanto esta, sin que el usuario tenga que borrar nada.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  );
});
