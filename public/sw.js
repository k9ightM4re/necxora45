/* NEXORA service worker: app-shell cache with network-first navigation and scripts. */
const VERSION = 'nexora-shell-v3';
const SHELL = [
  '/', '/index.html', '/app.html', '/login.html', '/signup.html',
  '/verify.html', '/forgot-password.html', '/reset-password.html',
  '/welcome.html', '/offline.html', '/manifest.webmanifest',
  '/assets/logo.svg', '/assets/logo-icon.svg', '/assets/favicon.svg',
  '/assets/icon-192.png', '/assets/icon-512.png', '/assets/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match('/offline.html');
          return fallback || Response.error();
        })
    );
    return;
  }

  // Always fetch fresh JS, CSS, and JSON config first; fall back to cache only if offline
  if (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/') || url.pathname.endsWith('.json')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || Response.error())
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    })
  );
});
