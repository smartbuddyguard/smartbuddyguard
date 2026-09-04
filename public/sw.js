// Service Worker: App-Hülle offline verfügbar halten, API immer live abfragen.
const CACHE = 'telegroove-v1';
const SHELL = [
  '/', '/index.html', '/css/app.css',
  '/js/app.js', '/js/api.js', '/js/state.js', '/js/socket.js', '/js/util.js',
  '/js/ui.js', '/js/chat.js', '/js/chatlist.js', '/js/composer.js',
  '/js/dialogs.js', '/js/emoji.js', '/js/info.js',
  '/manifest.webmanifest', '/icons/icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;

  // Hochgeladene Medien dürfen dauerhaft im Cache liegen.
  if (url.pathname.startsWith('/media/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      })
    );
    return;
  }

  // App-Hülle: Netz zuerst, Cache als Rückfallebene.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && url.origin === location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/index.html')))
  );
});
