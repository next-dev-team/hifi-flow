importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

if (workbox) {
  console.log(`Workbox is loaded`);

  // Force verbose logging
  workbox.setConfig({ debug: true });

  const { registerRoute } = workbox.routing;
  const { CacheFirst, StaleWhileRevalidate } = workbox.strategies;
  const { CacheableResponsePlugin } = workbox.cacheableResponse;
  const { ExpirationPlugin } = workbox.expiration;
  const { RangeRequestsPlugin } = workbox.rangeRequests;

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
  self.addEventListener('install', (event) => {
    self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
  });

} else {
  console.log(`Workbox didn't load`);
}
