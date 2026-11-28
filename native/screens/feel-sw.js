// Prototype of an app-only shell cache for the Mac feel audit
// (native/mac-feel-audit only, never merged). Copied into the runner's dist/
// and registered by the driver, never by the site. Every page of the site is
// the same index.html, so any navigation gets the last copy of it at once and
// the copy refreshes in the background. Hashed assets and fonts come from the
// cache, else the network. The API is never touched: data always comes fresh.
const SHELL = 'feel-shell-v1';
const isAsset = url =>
  url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') || url.pathname === '/logo.svg';

const refresh = async (cache, request, key) => {
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(key, response.clone());
  }
  return response;
};

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then(cache => cache.add('/'))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) {
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        const cached = await cache.match('/');
        const fresh = refresh(cache, '/', '/');
        if (cached) {
          event.waitUntil(fresh.catch(() => undefined));
          return cached;
        }
        return fresh;
      })()
    );
    return;
  }
  if (isAsset(url)) {
    event.respondWith(
      caches.open(SHELL).then(async cache => (await cache.match(request)) ?? refresh(cache, request, request))
    );
  }
});
