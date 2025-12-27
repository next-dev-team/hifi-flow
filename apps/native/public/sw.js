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

  const AUDIO_CACHE_VERSION = "v2";
  const AUDIO_META_CACHE = `hififlow-audio-meta-${AUDIO_CACHE_VERSION}`;
  const AUDIO_CHUNK_CACHE = `hififlow-audio-chunks-${AUDIO_CACHE_VERSION}`;
  const AUDIO_META_PATH = "/__hififlow_audio_meta";
  const AUDIO_CHUNK_PATH = "/__hififlow_audio_chunk";
  const AUDIO_STREAM_PATH = "/__hififlow_audio_stream";
  const CHUNK_DURATION_SEC = 40;
  const WINDOW_AHEAD_SEC = 60;
  const MIN_CHUNK_BYTES = 16384;
  const DEFAULT_CHUNK_BYTES = 262144;
  const MAX_META_ENTRIES = 100;

  const jobByUrl = new Map();

  const buildMetaRequest = (url) => {
    return new Request(`${AUDIO_META_PATH}?u=${encodeURIComponent(url)}`);
  };

  const buildChunkRequest = (url, chunkIndex) => {
    return new Request(
      `${AUDIO_CHUNK_PATH}?u=${encodeURIComponent(url)}&i=${chunkIndex}`
    );
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
    const existing = (await loadMeta(url)) || { url, timestamp: Date.now() };
    if (typeof existing.timestamp !== "number") {
      existing.timestamp = Date.now();
    }

    let totalBytes =
      typeof existing.totalBytes === "number" ? existing.totalBytes : 0;
    let contentType =
      typeof existing.contentType === "string" ? existing.contentType : "";
    if (!totalBytes || !contentType) {
      try {
        const resp = await fetch(url, { headers: { Range: "bytes=0-0" } });
        contentType =
          resp.headers.get("content-type") || contentType || "audio/mpeg";
        if (resp.status === 206) {
          const contentRange = resp.headers.get("content-range") || "";
          const m = contentRange.match(/\/(\d+)$/);
          if (m) {
            totalBytes = parseInt(m[1], 10);
          }
        }
        if (!totalBytes) {
          const len = resp.headers.get("content-length");
          if (len) {
            totalBytes = parseInt(len, 10);
          }
        }
      } catch {}
    }

    const durationSec =
      typeof existing.metadata?.durationSec === "number"
        ? existing.metadata.durationSec
        : typeof existing.durationSec === "number"
        ? existing.durationSec
        : 0;

    let chunkByteSize =
      typeof existing.chunkByteSize === "number" ? existing.chunkByteSize : 0;
    if (!chunkByteSize) {
      if (totalBytes > 0 && durationSec > 0) {
        const bytesPerSecond = totalBytes / durationSec;
        chunkByteSize = Math.floor(bytesPerSecond * CHUNK_DURATION_SEC);
      } else {
        chunkByteSize = DEFAULT_CHUNK_BYTES;
      }
      chunkByteSize = Math.max(MIN_CHUNK_BYTES, chunkByteSize);
    }

    const totalChunks =
      totalBytes > 0 ? Math.ceil(totalBytes / chunkByteSize) : 0;

    const next = {
      ...existing,
      totalBytes,
      contentType: contentType || "audio/mpeg",
      chunkByteSize,
      totalChunks,
      timestamp: Date.now(),
    };

    await saveMeta(url, next);
    return next;
  };

  const countCachedChunks = async (url) => {
    const encoded = encodeURIComponent(url);
    const cache = await caches.open(AUDIO_CHUNK_CACHE);
    const keys = await cache.keys();
    return keys.filter((k) =>
      k.url.includes(`${AUDIO_CHUNK_PATH}?u=${encoded}`)
    ).length;
  };

  const enforceMetaLimit = async () => {
    const cache = await caches.open(AUDIO_META_CACHE);
    const keys = await cache.keys();
    if (keys.length <= MAX_META_ENTRIES) return;
    const entries = [];
    for (const key of keys) {
      const resp = await cache.match(key);
      if (!resp) continue;
      try {
        const meta = await resp.json();
        if (meta?.url) {
          entries.push({ key, url: meta.url, ts: meta.timestamp || 0 });
        }
      } catch {}
    }
    entries.sort((a, b) => a.ts - b.ts);
    const extra = entries.slice(
      0,
      Math.max(0, entries.length - MAX_META_ENTRIES)
    );
    const chunkCache = await caches.open(AUDIO_CHUNK_CACHE);
    for (const item of extra) {
      try {
        await cache.delete(item.key);
      } catch {}
      try {
        const encoded = encodeURIComponent(item.url);
        const chunkKeys = await chunkCache.keys();
        for (const ck of chunkKeys) {
          if (ck.url.includes(`${AUDIO_CHUNK_PATH}?u=${encoded}`)) {
            try {
              await chunkCache.delete(ck);
            } catch {}
          }
        }
      } catch {}
    }
  };

  const cacheWindowForUrl = async (url, positionSec) => {
    const prevJob = jobByUrl.get(url);
    if (prevJob?.abortController) {
      try {
        prevJob.abortController.abort();
      } catch {}
    }

    const abortController = new AbortController();
    const job = (async () => {
      const meta = await ensureMetaDetails(url);
      if (!meta?.totalBytes || !meta.chunkByteSize) return;

      await enforceMetaLimit();

      const totalChunksInWindow = Math.ceil(
        WINDOW_AHEAD_SEC / CHUNK_DURATION_SEC
      );
      const startChunkIndex = Math.max(
        0,
        Math.floor((positionSec || 0) / CHUNK_DURATION_SEC)
      );

      const cache = await caches.open(AUDIO_CHUNK_CACHE);
      let cachedInWindow = 0;

      for (let offset = 0; offset < totalChunksInWindow; offset += 1) {
        if (abortController.signal.aborted) return;
        const chunkIndex = startChunkIndex + offset;
        const startByte = chunkIndex * meta.chunkByteSize;
        if (startByte > meta.totalBytes - 1) break;
        const endByte = Math.min(
          startByte + meta.chunkByteSize - 1,
          meta.totalBytes - 1
        );
        const key = buildChunkRequest(url, chunkIndex);
        const existing = await cache.match(key);
        if (existing) {
          cachedInWindow += 1;
          continue;
        }

        try {
          const resp = await fetch(url, {
            headers: { Range: `bytes=${startByte}-${endByte}` },
            signal: abortController.signal,
          });
          if (!(resp && (resp.status === 206 || resp.status === 200))) {
            continue;
          }
          const buffer = await resp.arrayBuffer();
          const headers = new Headers(resp.headers);
          headers.set("content-length", String(buffer.byteLength));
          headers.set("x-hififlow-cached-at", String(Date.now()));
          await cache.put(
            key,
            new Response(buffer, {
              status: 206,
              headers,
            })
          );
          cachedInWindow += 1;

          const cachedChunks = await countCachedChunks(url);
          const updatedMeta = {
            ...meta,
            cachedChunks,
            timestamp: Date.now(),
          };
          await saveMeta(url, updatedMeta);

          await postToClients({
            type: "AUDIO_CACHE_PROGRESS",
            progress: {
              url,
              windowStartSec: startChunkIndex * CHUNK_DURATION_SEC,
              windowEndSec:
                startChunkIndex * CHUNK_DURATION_SEC +
                totalChunksInWindow * CHUNK_DURATION_SEC,
              cachedChunks: cachedInWindow,
              totalChunks: totalChunksInWindow,
              cachedSecondsAhead: cachedInWindow * CHUNK_DURATION_SEC,
              updatedAt: Date.now(),
            },
          });
          await postToClients({ type: "AUDIO_CACHED_URL", url });
        } catch {}
      }
    })();

    jobByUrl.set(url, { abortController, job });
    await job;
  };

  const cacheFullForUrl = async (url) => {
    const meta = await ensureMetaDetails(url);
    if (!meta?.totalBytes || !meta.chunkByteSize) return;
    const cache = await caches.open(AUDIO_CHUNK_CACHE);
    for (let chunkIndex = 0; chunkIndex < meta.totalChunks; chunkIndex += 1) {
      const startByte = chunkIndex * meta.chunkByteSize;
      if (startByte > meta.totalBytes - 1) break;
      const endByte = Math.min(
        startByte + meta.chunkByteSize - 1,
        meta.totalBytes - 1
      );
      const key = buildChunkRequest(url, chunkIndex);
      const existing = await cache.match(key);
      if (existing) continue;
      try {
        const resp = await fetch(url, {
          headers: { Range: `bytes=${startByte}-${endByte}` },
        });
        if (!(resp && (resp.status === 206 || resp.status === 200))) {
          continue;
        }
        const buffer = await resp.arrayBuffer();
        const headers = new Headers(resp.headers);
        headers.set("content-length", String(buffer.byteLength));
        headers.set("x-hififlow-cached-at", String(Date.now()));
        await cache.put(
          key,
          new Response(buffer, {
            status: 206,
            headers,
          })
        );
      } catch {}
    }
    try {
      const cachedChunks = await countCachedChunks(url);
      await saveMeta(url, { ...meta, cachedChunks, timestamp: Date.now() });
      await postToClients({ type: "AUDIO_CACHED_URL", url });
    } catch {}
  };

  const tryServeRangeFromChunks = async (url, start, end) => {
    const meta = await ensureMetaDetails(url);
    if (!meta?.totalBytes || !meta.chunkByteSize) return null;
    const rangeEnd =
      end === null ? meta.totalBytes - 1 : Math.min(end, meta.totalBytes - 1);
    const rangeStart = Math.min(start, rangeEnd);

    const firstChunk = Math.floor(rangeStart / meta.chunkByteSize);
    const lastChunk = Math.floor(rangeEnd / meta.chunkByteSize);
    const cache = await caches.open(AUDIO_CHUNK_CACHE);

    const buffers = [];
    for (
      let chunkIndex = firstChunk;
      chunkIndex <= lastChunk;
      chunkIndex += 1
    ) {
      const resp = await cache.match(buildChunkRequest(url, chunkIndex));
      if (!resp) return null;
      const buf = await resp.arrayBuffer();
      const chunkStartByte = chunkIndex * meta.chunkByteSize;
      const sliceStart = Math.max(0, rangeStart - chunkStartByte);
      const sliceEnd = Math.min(buf.byteLength, rangeEnd - chunkStartByte + 1);
      buffers.push(new Uint8Array(buf.slice(sliceStart, sliceEnd)));
    }

    let totalLength = 0;
    for (const b of buffers) totalLength += b.byteLength;
    const joined = new Uint8Array(totalLength);
    let offset = 0;
    for (const b of buffers) {
      joined.set(b, offset);
      offset += b.byteLength;
    }

    const headers = new Headers();
    headers.set("Content-Type", meta.contentType || "audio/mpeg");
    headers.set("Accept-Ranges", "bytes");
    headers.set(
      "Content-Range",
      `bytes ${rangeStart}-${rangeEnd}/${meta.totalBytes}`
    );
    headers.set("Content-Length", String(joined.byteLength));
    return new Response(joined, { status: 206, headers });
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

    if (type === "AUDIO_CACHE_WINDOW") {
      const positionSec =
        typeof data.positionSec === "number" ? data.positionSec : 0;
      event.waitUntil(cacheWindowForUrl(url, positionSec));
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
            const cached = await tryServeRangeFromChunks(
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

          const resp = await fetch(sourceUrl, { headers });
          const nextHeaders = new Headers(resp.headers);
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
            const cached = await tryServeRangeFromChunks(
              sourceUrl,
              parsed.start,
              parsed.end
            );
            if (cached) return cached;
          }
        }
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
                  k.startsWith("hififlow-audio-chunks-")
              )
              .filter((k) => k !== AUDIO_META_CACHE && k !== AUDIO_CHUNK_CACHE)
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
