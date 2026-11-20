/* eslint-env serviceworker */
const VERSION = '__BUILD_VERSION__';
const CACHE_NAME = `stl-viewer-${VERSION}`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './app.js',
  './app.css',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './demo.stl',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch (error) {
            console.warn('[sw] 预缓存失败：', url, error);
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = (await cache.match('./index.html')) || (await cache.match('./'));
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put('./index.html', response.clone());
            return response;
          })
          .catch(() => null);

        // 有缓存就立即返回（后台静默更新），避免弱网/离线时白屏
        if (cached) {
          network.catch(() => {});
          return cached;
        }
        return (await network) || Response.error();
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) {
        fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
          })
          .catch(() => {});
        return cached;
      }
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch (error) {
        return Response.error();
      }
    })(),
  );
});
