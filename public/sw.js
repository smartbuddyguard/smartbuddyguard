// Caches the client shell so the game starts instantly (and the menu still
// loads without a network). Gameplay itself always needs the websocket.
const CACHE = 'liberty-v3';
const ASSETS = [
  './',
  'index.html',
  'solo.html',
  'style.css',
  'manifest.webmanifest',
  'js/main.js',
  'js/solo.js',
  'js/net.js',
  'js/input.js',
  'js/render.js',
  'js/hud.js',
  'js/audio.js',
  'js/controls.js',
  '/shared/constants.js',
  '/shared/city.js',
  '/shared/physics.js',
  '/shared/world.js',
  '/shared/util.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first so a redeploy is picked up, cache as offline fallback.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
