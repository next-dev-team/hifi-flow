importScripts(
  "https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js"
);

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
  const APP_SHELL = "/";
  const CACHE_NAME = "pages-cache";

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

  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        // Cache both / and /index.html to be safe
        return cache.addAll([APP_SHELL, "/index.html"]).catch(() => {
          console.log("Failed to cache app shell during install - ignoring");
        });
      })
    );
    self.skipWaiting();
  });

  // Cache HTML (App Shell) with Fallback
  registerRoute(
    ({ request }) => request.mode === "navigate",
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
        cachedResponse = await cache.match("/index.html");
        if (cachedResponse) return cachedResponse;

        // 6. Final fallback: Simple Offline Page
        return new Response(OFFLINE_HTML, {
          headers: { "Content-Type": "text/html" },
        });
      }
    }
  );

  // Cache JS, CSS, and Worker files
  registerRoute(
    ({ request }) =>
      request.destination === "script" ||
      request.destination === "style" ||
      request.destination === "worker",
    new StaleWhileRevalidate({
      cacheName: "assets-cache",
      plugins: [
        new CacheableResponsePlugin({
          statuses: [200],
        }),
      ],
    })
  );

  // Cache Fonts
  registerRoute(
    ({ request }) => request.destination === "font",
    new CacheFirst({
      cacheName: "fonts-cache",
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

  const AUDIO_CACHE_VERSION = "v3";
  const AUDIO_META_CACHE = `hififlow-audio-meta-${AUDIO_CACHE_VERSION}`;
  const AUDIO_FULL_CACHE = `hififlow-audio-full-${AUDIO_CACHE_VERSION}`;
  const AUDIO_META_PATH = "/__hififlow_audio_meta";
  const AUDIO_STREAM_PATH = "/__hififlow_audio_stream";

  const CORS_PROXIES = [
    "https://corsproxy.io/?",
    "https://api.allorigins.win/raw?url=",
    "https://proxy.cors.sh/",
    "https://api.codetabs.com/v1/proxy?quest=",
    "https://thingproxy.freeboard.io/fetch/",
    "https://cors-anywhere.herokuapp.com/",
  ];

  const metaInFlight = new Map();
  const cacheFullInFlight = new Map();
  const metaProbeCooldownUntilByUrl = new Map();
  const META_PROBE_COOLDOWN_MS = 60_000;

  const buildMetaRequest = (url) => {
    return new Request(`${AUDIO_META_PATH}?u=${encodeURIComponent(url)}`);
  };

  const parseRangeHeader = (rangeHeader) => {
    if (typeof rangeHeader !== "string") return null;
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) return null;
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : null;
    if (!Number.isFinite(start) || start < 0) return null;
    if (end !== null && (!Number.isFinite(end) || end < start)) return null;
    return { start, end };
  };

  const decodeStreamParam = (urlObj) => {
    try {
      const param = urlObj?.searchParams?.get("u");
      if (!param) return null;
      return decodeURIComponent(param);
    } catch {
      return null;
    }
  };

  const postToClients = async (message) => {
    try {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        try {
          client.postMessage(message);
        } catch {}
      }
    } catch {}
  };

  const loadMeta = async (url) => {
    const cache = await caches.open(AUDIO_META_CACHE);
    const resp = await cache.match(buildMetaRequest(url));
    if (!resp) return null;
    try {
      return await resp.json();
    } catch {
      return null;
    }
  };

  const saveMeta = async (url, meta) => {
    const cache = await caches.open(AUDIO_META_CACHE);
    await cache.put(
      buildMetaRequest(url),
      new Response(JSON.stringify(meta), {
        headers: { "Content-Type": "application/json" },
      })
    );
  };

  const ensureMetaDetails = async (url) => {
    const existingInFlight = metaInFlight.get(url);
    if (existingInFlight) {
      return await existingInFlight;
    }

    const job = (async () => {
      const existing = (await loadMeta(url)) || { url, timestamp: Date.now() };
      if (typeof existing.timestamp !== "number") {
        existing.timestamp = Date.now();
      }

      let totalBytes =
        typeof existing.totalBytes === "number" ? existing.totalBytes : 0;
      let contentType =
        typeof existing.contentType === "string" ? existing.contentType : "";
      let supportsRange =
        typeof existing.supportsRange === "boolean"
          ? existing.supportsRange
          : undefined;

      const cooldownUntil = metaProbeCooldownUntilByUrl.get(url) ?? 0;
      if ((!totalBytes || !contentType) && Date.now() >= cooldownUntil) {
        try {
          let resp;
          try {
            resp = await fetch(url, { headers: { Range: "bytes=0-0" } });
            if (!resp.ok && resp.status !== 206)
              throw new Error("Fetch failed");
          } catch (e) {
            console.warn(
              `[SW] Meta probe failed for ${url}, trying proxies...`,
              e
            );
            for (const proxy of CORS_PROXIES) {
              try {
                const proxiedUrl = proxy + encodeURIComponent(url);
                resp = await fetch(proxiedUrl, {
                  headers: { Range: "bytes=0-0" },
                });
                if (resp.ok || resp.status === 206) break;
              } catch {}
            }
          }

          if (resp && (resp.ok || resp.status === 206)) {
            const nextContentType = resp.headers.get("content-type") || "";
            if (nextContentType) {
              contentType = nextContentType;
            }
            if (supportsRange === undefined) {
              const acceptRanges = (
                resp.headers.get("accept-ranges") || ""
              ).toLowerCase();
              supportsRange =
                resp.status === 206 ||
                Boolean(resp.headers.get("content-range")) ||
                acceptRanges === "bytes";
            }
            const contentRange = resp.headers.get("content-range") || "";
            const m = contentRange.match(/\/(\d+)$/);
            if (m) {
              const parsed = parseInt(m[1], 10);
              if (Number.isFinite(parsed) && parsed > 0) {
                totalBytes = parsed;
              }
            }
            if (!totalBytes) {
              const len = resp.headers.get("content-length");
              if (len) {
                const parsed = parseInt(len, 10);
                if (Number.isFinite(parsed) && parsed > 0) {
                  totalBytes = parsed;
                }
              }
            }
          }
        } catch {}

        if (!totalBytes || !contentType) {
          metaProbeCooldownUntilByUrl.set(
            url,
            Date.now() + META_PROBE_COOLDOWN_MS
          );
        }
      }

      const next = {
        ...existing,
        totalBytes,
        contentType: contentType || "audio/mpeg",
        supportsRange: supportsRange ?? false,
        timestamp: Date.now(),
      };

      await saveMeta(url, next);
      return next;
    })();

    metaInFlight.set(url, job);
    try {
      return await job;
    } finally {
      metaInFlight.delete(url);
    }
  };

  const upsertMeta = async (url, patch) => {
    try {
      const prev = (await loadMeta(url)) || { url };
      const merged = {
        ...prev,
        ...patch,
        url,
        metadata: {
          ...(prev.metadata || {}),
          ...(patch?.metadata || {}),
        },
        timestamp: Date.now(),
      };
      await saveMeta(url, merged);
    } catch {}
  };

  const cacheFullForUrl = async (url) => {
    const existingInFlight = cacheFullInFlight.get(url);
    if (existingInFlight) {
      return await existingInFlight;
    }

    const job = (async () => {
      try {
        const meta = await ensureMetaDetails(url);
        const durationSec =
          typeof meta?.metadata?.durationSec === "number"
            ? meta.metadata.durationSec
            : typeof meta?.durationSec === "number"
            ? meta.durationSec
            : 0;

        const fullCache = await caches.open(AUDIO_FULL_CACHE);
        const existing = await fullCache.match(url);
        if (existing) {
          await upsertMeta(url, { cachedFull: true });
          await postToClients({ type: "AUDIO_CACHED_URL", url });
          await postToClients({
            type: "AUDIO_CACHE_PROGRESS",
            progress: {
              url,
              windowStartSec: 0,
              windowEndSec: durationSec,
              cachedChunks: 1,
              totalChunks: 1,
              cachedSecondsAhead: durationSec,
              updatedAt: Date.now(),
            },
          });
          return true;
        }

        await postToClients({
          type: "AUDIO_CACHE_PROGRESS",
          progress: {
            url,
            windowStartSec: 0,
            windowEndSec: durationSec,
            cachedChunks: 0,
            totalChunks: 1,
            cachedSecondsAhead: 0,
            updatedAt: Date.now(),
          },
        });

        let resp;
        try {
          resp = await fetch(url, { cache: "no-store" });
          if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
        } catch (e) {
          console.warn(
            `[SW] Cache full fetch failed for ${url}, trying proxies...`,
            e
          );
          for (const proxy of CORS_PROXIES) {
            try {
              const proxiedUrl = proxy + encodeURIComponent(url);
              resp = await fetch(proxiedUrl);
              if (resp.ok) break;
            } catch {}
          }
        }

        if (!resp || !resp.ok) return false;

        await fullCache.put(url, resp.clone());
        await upsertMeta(url, {
          cachedFull: true,
          contentType: resp.headers.get("content-type") || undefined,
        });

        await postToClients({ type: "AUDIO_CACHED_URL", url });
        await postToClients({
          type: "AUDIO_CACHE_PROGRESS",
          progress: {
            url,
            windowStartSec: 0,
            windowEndSec: durationSec,
            cachedChunks: 1,
            totalChunks: 1,
            cachedSecondsAhead: durationSec,
            updatedAt: Date.now(),
          },
        });
        return true;
      } catch {
        return false;
      }
    })();

    cacheFullInFlight.set(url, job);
    try {
      return await job;
    } finally {
      cacheFullInFlight.delete(url);
    }
  };

  const tryServeRangeFromFull = async (url, start, end) => {
    try {
      const fullCache = await caches.open(AUDIO_FULL_CACHE);
      const resp = await fullCache.match(url);
      if (!resp) return null;
      const buffer = await resp.arrayBuffer();
      const totalBytes = buffer.byteLength;
      if (!totalBytes) return null;

      const rangeStart = Math.max(0, Math.min(start, totalBytes - 1));
      const rangeEnd =
        end === null
          ? totalBytes - 1
          : Math.max(rangeStart, Math.min(end, totalBytes - 1));
      const sliced = buffer.slice(rangeStart, rangeEnd + 1);

      const headers = new Headers();
      headers.set(
        "Content-Type",
        resp.headers.get("content-type") || "audio/mpeg"
      );
      headers.set("Accept-Ranges", "bytes");
      headers.set(
        "Content-Range",
        `bytes ${rangeStart}-${rangeEnd}/${totalBytes}`
      );
      headers.set("Content-Length", String(sliced.byteLength));

      return new Response(sliced, { status: 206, headers });
    } catch {
      return null;
    }
  };

  self.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    const type = data.type;
    const url = data.url;
    if (typeof url !== "string" || !url) return;

    if (type === "AUDIO_META") {
      const next = {
        url,
        metadata: data.metadata,
        durationSec:
          typeof data.durationSec === "number" ? data.durationSec : undefined,
        timestamp: Date.now(),
      };
      event.waitUntil(
        (async () => {
          const prev = (await loadMeta(url)) || {};
          const merged = {
            ...prev,
            ...next,
            metadata: {
              ...(prev.metadata || {}),
              ...(next.metadata || {}),
              durationSec:
                typeof next.durationSec === "number"
                  ? next.durationSec
                  : prev.metadata?.durationSec,
            },
          };
          await saveMeta(url, merged);
        })()
      );
      return;
    }

    if (type === "AUDIO_CACHE_FULL") {
      event.waitUntil(cacheFullForUrl(url));
    }
  });

  registerRoute(
    ({ request, url }) => {
      return (
        request.method === "GET" &&
        (request.destination === "audio" ||
          request.destination === "video" ||
          url.pathname === AUDIO_STREAM_PATH ||
          url.pathname.endsWith(".mp3") ||
          url.pathname.endsWith(".m4a") ||
          url.pathname.endsWith(".wav") ||
          url.pathname.endsWith(".flac") ||
          url.pathname.endsWith(".aac"))
      );
    },
    async ({ event, request, url }) => {
      const rangeHeader = request.headers.get("range");
      const sourceUrl =
        url.pathname === AUDIO_STREAM_PATH ? decodeStreamParam(url) : url.href;
      if (!sourceUrl) {
        return new Response("", { status: 400 });
      }
      if (rangeHeader) {
        const parsed = parseRangeHeader(rangeHeader);
        if (parsed) {
          try {
            const cached = await tryServeRangeFromFull(
              sourceUrl,
              parsed.start,
              parsed.end
            );
            if (cached) return cached;
          } catch {}
        }
      }

      try {
        if (url.pathname === AUDIO_STREAM_PATH) {
          const headers = new Headers();
          if (rangeHeader) headers.set("Range", rangeHeader);
          let meta = null;
          try {
            meta = await ensureMetaDetails(sourceUrl);
          } catch {}

          let resp;
          try {
            resp = await fetch(sourceUrl, { headers });
            if (!resp.ok && resp.status !== 206) {
              throw new Error(`Direct fetch failed with status ${resp.status}`);
            }
          } catch (e) {
            console.warn(
              `[SW] Direct fetch failed for ${sourceUrl}, trying proxies...`,
              e
            );
            for (const proxy of CORS_PROXIES) {
              try {
                const proxiedUrl = proxy + encodeURIComponent(sourceUrl);
                resp = await fetch(proxiedUrl, { headers });
                if (resp.ok || resp.status === 206) {
                  console.log(`[SW] Proxy success: ${proxy}`);
                  break;
                }
              } catch (proxyError) {
                console.warn(`[SW] Proxy failed: ${proxy}`, proxyError);
              }
            }
          }

          if (!resp) {
            throw new Error("All fetch attempts failed");
          }

          // Create a new response with cleaned headers to avoid CORS issues with the browser
          const nextHeaders = new Headers();

          // Copy essential headers
          const essentialHeaders = [
            "content-type",
            "content-length",
            "content-range",
            "accept-ranges",
            "cache-control",
          ];

          essentialHeaders.forEach((h) => {
            const val = resp.headers.get(h);
            if (val) nextHeaders.set(h, val);
          });
          const respContentType = (
            nextHeaders.get("content-type") || ""
          ).toLowerCase();
          const metaContentType =
            meta && typeof meta.contentType === "string" && meta.contentType
              ? meta.contentType
              : "";

          if (
            metaContentType &&
            (!respContentType ||
              respContentType.startsWith("application/octet-stream") ||
              respContentType.startsWith("binary/octet-stream"))
          ) {
            nextHeaders.set("Content-Type", metaContentType);
          }

          if (!nextHeaders.get("Accept-Ranges")) {
            nextHeaders.set("Accept-Ranges", "bytes");
          }

          if (resp.body) {
            return new Response(resp.body, {
              status: resp.status,
              headers: nextHeaders,
            });
          }
          const blob = await resp.blob();
          return new Response(blob, {
            status: resp.status,
            headers: nextHeaders,
          });
        }
        return await fetch(request);
      } catch {
        if (rangeHeader) {
          const parsed = parseRangeHeader(rangeHeader);
          if (parsed) {
            const cached = await tryServeRangeFromFull(
              sourceUrl,
              parsed.start,
              parsed.end
            );
            if (cached) return cached;
          }
        }

        try {
          const fullCache = await caches.open(AUDIO_FULL_CACHE);
          const cached = await fullCache.match(sourceUrl);
          if (cached) return cached;
        } catch {}
        return new Response("", { status: 503 });
      }
    }
  );

  // Cache Images (Covers/Artwork)
  registerRoute(
    ({ request }) => request.destination === "image",
    new StaleWhileRevalidate({
      cacheName: "image-cache",
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

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        try {
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter(
                (k) =>
                  k.startsWith("hififlow-audio-meta-") ||
                  k.startsWith("hififlow-audio-full-")
              )
              .filter((k) => k !== AUDIO_META_CACHE && k !== AUDIO_FULL_CACHE)
              .map((k) => caches.delete(k))
          );
        } catch {}
        await self.clients.claim();
      })()
    );
  });
} else {
  console.log(`Workbox didn't load`);
}
