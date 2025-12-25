importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

if (workbox) {
  console.log(`Workbox is loaded`);

  // Force verbose logging
  workbox.setConfig({ debug: true });

  const { registerRoute } = workbox.routing;
  const { CacheFirst, StaleWhileRevalidate, NetworkFirst } = workbox.strategies;
  const { CacheableResponsePlugin } = workbox.cacheableResponse;
  const { ExpirationPlugin } = workbox.expiration;
  const { RangeRequestsPlugin } = workbox.rangeRequests;

  // Precache App Shell
  const APP_SHELL = '/';
  const CACHE_NAME = 'pages-cache';
  
  const OFFLINE_HTML = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Offline - HiFi Flow</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
      h1 { margin-bottom: 10px; }
      p { color: #888; margin-bottom: 20px; }
      button { padding: 12px 24px; background: #fff; color: #000; border: none; border-radius: 999px; font-weight: bold; cursor: pointer; font-size: 16px; }
      button:active { opacity: 0.8; }
    </style>
  </head>
  <body>
    <h1>You are offline</h1>
    <p>Please check your internet connection.</p>
    <button onclick="window.location.reload()">Retry</button>
  </body>
  </html>
  `;
  
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        // Cache both / and /index.html to be safe
        return cache.addAll([APP_SHELL, '/index.html']).catch(() => {
            console.log('Failed to cache app shell during install - ignoring');
        });
      })
    );
    self.skipWaiting();
  });

  // Cache HTML (App Shell) with Fallback
  registerRoute(
    ({ request }) => request.mode === 'navigate',
    async ({ event }) => {
      try {
        // 1. Try Network
        return await fetch(event.request);
      } catch (error) {
        // 2. Network failed (Offline)
        const cache = await caches.open(CACHE_NAME);
        
        // 3. Try finding the exact page in cache
        let cachedResponse = await cache.match(event.request);
        if (cachedResponse) return cachedResponse;
        
        // 4. Fallback to App Shell (/)
        cachedResponse = await cache.match(APP_SHELL);
        if (cachedResponse) return cachedResponse;

        // 5. Fallback to index.html
        cachedResponse = await cache.match('/index.html');
        if (cachedResponse) return cachedResponse;
        
        // 6. Final fallback: Simple Offline Page
        return new Response(OFFLINE_HTML, {
          headers: { 'Content-Type': 'text/html' }
        });
      }
    }
  );

  // Cache JS, CSS, and Worker files
  registerRoute(
    ({ request }) =>
      request.destination === 'script' ||
      request.destination === 'style' ||
      request.destination === 'worker',
    new StaleWhileRevalidate({
      cacheName: 'assets-cache',
      plugins: [
        new CacheableResponsePlugin({
          statuses: [200],
        }),
      ],
    })
  );

  // Cache Fonts
  registerRoute(
    ({ request }) => request.destination === 'font',
    new CacheFirst({
      cacheName: 'fonts-cache',
      plugins: [
        new CacheableResponsePlugin({
          statuses: [200],
        }),
        new ExpirationPlugin({
          maxEntries: 30,
          maxAgeSeconds: 60 * 24 * 60 * 60, // 60 Days
        }),
      ],
    })
  );

  // Cache Audio Files
  // We use CacheFirst so that if we have it, we serve it (supporting ranges).
  // If not, we fetch it (full file), cache it, and serve the requested range.
  // This might introduce a slight delay on first play compared to direct range streaming,
  // but ensures the file is cached for next time.
  registerRoute(
    ({ request, url }) => {
      return (
        request.destination === 'audio' ||
        request.destination === 'video' ||
        url.pathname.endsWith('.mp3') ||
        url.pathname.endsWith('.m4a') ||
        url.pathname.endsWith('.wav') ||
        url.pathname.endsWith('.flac') ||
        url.pathname.endsWith('.aac')
      );
    },
    new CacheFirst({
      cacheName: 'audio-cache',
      plugins: [
        new CacheableResponsePlugin({
          statuses: [200], // We only cache full responses
        }),
        new RangeRequestsPlugin(), // Important for seeking
        new ExpirationPlugin({
          maxEntries: 50, // Cache up to 50 songs
          maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
          purgeOnQuotaError: true,
        }),
      ],
    })
  );

  // Cache Images (Covers/Artwork)
  registerRoute(
    ({ request }) => request.destination === 'image',
    new StaleWhileRevalidate({
      cacheName: 'image-cache',
      plugins: [
        new CacheableResponsePlugin({
          statuses: [0, 200],
        }),
        new ExpirationPlugin({
          maxEntries: 100,
          maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
        }),
      ],
    })
  );

  // Skip waiting to activate immediately
  // self.addEventListener('install', (event) => {
  //   self.skipWaiting();
  // });

  self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
  });

} else {
  console.log(`Workbox didn't load`);
}
