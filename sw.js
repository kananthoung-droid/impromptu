/* Impromptu service worker: caches the app so it opens instantly and works offline.
   Bump VERSION whenever any file changes so phones pick up the update. */
const VERSION = 'v1.0.0';
const CACHE = `impromptu-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/fonts.css',
  './js/main.js',
  './js/nav.js',
  './js/util.js',
  './js/settings.js',
  './js/i18n.js',
  './js/db.js',
  './js/ui.js',
  './js/prompter.js',
  './js/media.js',
  './js/captions.js',
  './js/process.js',
  './js/chunks.js',
  './js/screens/home.js',
  './js/screens/editor.js',
  './js/screens/recorder.js',
  './js/screens/review.js',
  './js/screens/settings.js',
  './js/screens/controls.js',
  './fonts/figtree-latin.woff2',
  './fonts/figtree-latin-ext.woff2',
  './fonts/kantumruypro-khmer.woff2',
  './fonts/notoserifkhmer-khmer.woff2',
  './fonts/playfair-latin.woff2',
  './fonts/playfair-latin-ext.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('impromptu-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // App navigation → the cached app shell (works offline).
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html', { ignoreSearch: true }).then((cached) => cached || fetch(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Cache other same-origin files (e.g. splash images) for next time.
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
