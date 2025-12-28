export interface AudioMetadata {
  id: string;
  title: string;
  artist: string;
  artwork?: string;
  durationSec?: number;
}

export interface AudioCacheProgress {
  url: string;
  windowStartSec: number;
  windowEndSec: number;
  cachedChunks: number;
  totalChunks: number;
  cachedSecondsAhead: number;
  updatedAt: number;
}

const CACHE_VERSION = "v3";
const META_CACHE_NAME = `hififlow-audio-meta-${CACHE_VERSION}`;
const FULL_CACHE_NAME = `hififlow-audio-full-${CACHE_VERSION}`;
const AUDIO_STREAM_PATH = "/__hififlow_audio_stream";

const progressByUrl = new Map<string, AudioCacheProgress>();
const urlListeners = new Set<(url: string) => void>();
const progressListeners = new Set<(progress: AudioCacheProgress) => void>();
let swListenerReady = false;

function getMetaKey(url: string) {
  return new Request(`/__hififlow_audio_meta?u=${encodeURIComponent(url)}`);
}

function initServiceWorkerListeners() {
  if (swListenerReady) return;
  swListenerReady = true;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data as any;
    if (!data || typeof data !== "object") return;
    if (data.type === "AUDIO_CACHE_PROGRESS") {
      const progress = data.progress as AudioCacheProgress;
      if (!progress?.url) return;
      progressByUrl.set(progress.url, progress);
      progressListeners.forEach((l) => {
        try {
          l(progress);
        } catch {}
      });
      urlListeners.forEach((l) => {
        try {
          l(progress.url);
        } catch {}
      });
      return;
    }
    if (data.type === "AUDIO_CACHED_URL") {
      const url = data.url as string;
      if (!url) return;
      urlListeners.forEach((l) => {
        try {
          l(url);
        } catch {}
      });
    }
  });
}

function canUseAudioStreamProxy() {
  if (typeof navigator === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  return Boolean(navigator.serviceWorker.controller);
}

function buildStreamProxyUrl(url: string) {
  return `${AUDIO_STREAM_PATH}?u=${encodeURIComponent(url)}`;
}

function isStreamProxyUrl(url: string) {
  try {
    const base =
      typeof location !== "undefined" && location.origin
        ? location.origin
        : "http://localhost";
    const u = new URL(url, base);
    return u.pathname === AUDIO_STREAM_PATH && u.searchParams.has("u");
  } catch {
    return url.startsWith(`${AUDIO_STREAM_PATH}?u=`);
  }
}

async function postToServiceWorker(message: any) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  try {
    const controller = navigator.serviceWorker.controller;
    if (controller) {
      controller.postMessage(message);
      return;
    }
    const ready = await navigator.serviceWorker.ready;
    ready?.active?.postMessage(message);
  } catch {}
}

async function upsertMeta(
  url: string,
  metadata?: AudioMetadata,
  extra?: { cachedFull?: boolean; sizeBytes?: number; contentType?: string }
) {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(META_CACHE_NAME);
    const key = getMetaKey(url);
    const existing = await cache.match(key);
    let prev: any = null;
    if (existing) {
      try {
        prev = await existing.json();
      } catch {}
    }
    const next = {
      url,
      metadata: metadata
        ? {
            id: metadata.id,
            title: metadata.title,
            artist: metadata.artist,
            artwork: metadata.artwork,
            durationSec: metadata.durationSec,
          }
        : prev?.metadata,
      timestamp: Date.now(),
      cachedFull:
        typeof extra?.cachedFull === "boolean"
          ? extra.cachedFull
          : Boolean(prev?.cachedFull),
      sizeBytes:
        typeof extra?.sizeBytes === "number"
          ? extra.sizeBytes
          : typeof prev?.sizeBytes === "number"
          ? prev.sizeBytes
          : undefined,
      contentType:
        typeof extra?.contentType === "string" && extra.contentType
          ? extra.contentType
          : typeof prev?.contentType === "string" && prev.contentType
          ? prev.contentType
          : undefined,
    };
    await cache.put(
      key,
      new Response(JSON.stringify(next), {
        headers: { "Content-Type": "application/json" },
      })
    );
  } catch {}
}

async function readMeta(url: string): Promise<any | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(META_CACHE_NAME);
    const resp = await cache.match(getMetaKey(url));
    if (!resp) return null;
    return await resp.json();
  } catch {
    return null;
  }
}
export class ChunkedAudioLoader {
  constructor(private url: string) {}

  async getAudioUrl(_metadata?: AudioMetadata): Promise<string> {
    initServiceWorkerListeners();
    if (canUseAudioStreamProxy() && !isStreamProxyUrl(this.url)) {
      return buildStreamProxyUrl(this.url);
    }
    return this.url;
  }

  async cacheFullAudio(metadata?: AudioMetadata): Promise<void> {
    await audioCacheService.cacheUrl(this.url, metadata);
  }
}

export const audioCacheService = {
  _listeners: urlListeners,

  addListener(callback: (url: string) => void) {
    initServiceWorkerListeners();
    urlListeners.add(callback);
    return () => urlListeners.delete(callback);
  },

  addProgressListener(callback: (progress: AudioCacheProgress) => void) {
    initServiceWorkerListeners();
    progressListeners.add(callback);
    return () => progressListeners.delete(callback);
  },

  getProgress(url: string): AudioCacheProgress | null {
    return progressByUrl.get(url) ?? null;
  },

  getStorageEstimate: async (): Promise<StorageEstimate | null> => {
    try {
      if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
        return null;
      }
      return await navigator.storage.estimate();
    } catch {
      return null;
    }
  },

  cacheWindow: async (_url: string, _options?: any) => {
    return;
  },

  ensureCachedSeconds: async (
    _url: string,
    _options?: any
  ): Promise<boolean> => {
    return false;
  },

  isChunkCached: async (
    _url: string,
    _chunkIndex: number
  ): Promise<boolean> => {
    return false;
  },

  getCachedMeta: async (
    url: string
  ): Promise<{
    url: string;
    metadata?: AudioMetadata;
    timestamp: number;
    cachedChunks?: number;
    totalChunks?: number;
  } | null> => {
    const parsed = await readMeta(url);
    if (!parsed || typeof parsed !== "object") return null;
    if (
      typeof (parsed as any).url !== "string" ||
      typeof (parsed as any).timestamp !== "number"
    ) {
      return null;
    }
    return {
      url: (parsed as any).url,
      metadata: (parsed as any).metadata,
      timestamp: (parsed as any).timestamp,
      cachedChunks: (parsed as any).cachedFull ? 1 : 0,
      totalChunks: 1,
    };
  },

  findCachedUrlByTrackId: async (trackId: string): Promise<string | null> => {
    if (typeof caches === "undefined") return null;
    try {
      const cache = await caches.open(META_CACHE_NAME);
      const keys = await cache.keys();
      for (const key of keys) {
        const resp = await cache.match(key);
        if (!resp) continue;
        try {
          const parsed = (await resp.json()) as any;
          if (
            parsed?.metadata?.id &&
            String(parsed.metadata.id) === String(trackId)
          ) {
            if (typeof parsed?.url === "string" && parsed?.cachedFull) {
              return parsed.url;
            }
          }
        } catch {}
      }
      return null;
    } catch {
      return null;
    }
  },

  resolveUrl: async (url: string, metadata?: AudioMetadata) => {
    initServiceWorkerListeners();
    const next =
      canUseAudioStreamProxy() && !isStreamProxyUrl(url)
        ? buildStreamProxyUrl(url)
        : url;
    if (metadata) {
      void postToServiceWorker({
        type: "AUDIO_META",
        url,
        durationSec: metadata?.durationSec,
        metadata: {
          id: metadata.id,
          title: metadata.title,
          artist: metadata.artist,
          artwork: metadata.artwork,
        },
      });
    }
    return next;
  },

  cacheUrl: async (url: string, metadata?: AudioMetadata) => {
    if (!url || typeof caches === "undefined") return;
    initServiceWorkerListeners();

    const inProgress: AudioCacheProgress = {
      url,
      windowStartSec: 0,
      windowEndSec: metadata?.durationSec ?? 0,
      cachedChunks: 0,
      totalChunks: 1,
      cachedSecondsAhead: 0,
      updatedAt: Date.now(),
    };
    progressByUrl.set(url, inProgress);
    progressListeners.forEach((l) => {
      try {
        l(inProgress);
      } catch {}
    });

    let ok = false;
    try {
      await upsertMeta(url, metadata, { cachedFull: false });

      const cache = await caches.open(FULL_CACHE_NAME);
      const existing = await cache.match(url);
      if (existing) {
        await upsertMeta(url, metadata, { cachedFull: true });
        ok = true;
        return;
      }

      if (canUseAudioStreamProxy()) {
        void postToServiceWorker({ type: "AUDIO_CACHE_FULL", url });
        const start = Date.now();
        while (Date.now() - start < 120_000) {
          try {
            const cached = await audioCacheService.isCached(url);
            if (cached) {
              ok = true;
              break;
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 250));
        }
        if (ok) {
          await upsertMeta(url, metadata, { cachedFull: true });
        }
        return;
      }

      try {
        const resp = await fetch(url, { cache: "no-store" });
        if (resp.status && resp.status >= 400) {
          return;
        }
        await cache.put(url, resp.clone());
        await upsertMeta(url, metadata, {
          cachedFull: true,
          contentType: resp.headers.get("content-type") || undefined,
        });
        ok = true;
      } catch {
        return;
      }
    } finally {
      const done: AudioCacheProgress = {
        url,
        windowStartSec: 0,
        windowEndSec: metadata?.durationSec ?? 0,
        cachedChunks: ok ? 1 : 0,
        totalChunks: 1,
        cachedSecondsAhead: ok ? metadata?.durationSec ?? 0 : 0,
        updatedAt: Date.now(),
      };
      progressByUrl.set(url, done);
      progressListeners.forEach((l) => {
        try {
          l(done);
        } catch {}
      });
      if (ok) {
        urlListeners.forEach((l) => {
          try {
            l(url);
          } catch {}
        });
      }
    }
  },

  evictUrl: async (url: string) => {
    if (typeof caches === "undefined") return;
    try {
      const full = await caches.open(FULL_CACHE_NAME);
      await full.delete(url);
    } catch {}
    const metaCache = await caches.open(META_CACHE_NAME);
    await metaCache.delete(getMetaKey(url));
    urlListeners.forEach((l) => {
      try {
        l(url);
      } catch {}
    });
  },

  isCached: async (url: string) => {
    if (typeof caches === "undefined") return false;
    try {
      const full = await caches.open(FULL_CACHE_NAME);
      const existing = await full.match(url);
      if (existing) return true;
      const metaCache = await caches.open(META_CACHE_NAME);
      const meta = await metaCache.match(getMetaKey(url));
      if (!meta) return false;
      const parsed = (await meta.json()) as any;
      return Boolean(parsed?.cachedFull);
    } catch {
      return false;
    }
  },

  getAllCachedTracks: async (): Promise<
    { url: string; metadata?: AudioMetadata; timestamp: number }[]
  > => {
    if (typeof caches === "undefined") return [];
    try {
      const cache = await caches.open(META_CACHE_NAME);
      const keys = await cache.keys();
      const results: {
        url: string;
        metadata?: AudioMetadata;
        timestamp: number;
      }[] = [];
      for (const key of keys) {
        const resp = await cache.match(key);
        if (!resp) continue;
        try {
          const parsed = (await resp.json()) as any;
          if (
            typeof parsed?.url === "string" &&
            typeof parsed?.timestamp === "number" &&
            parsed?.cachedFull
          ) {
            results.push({
              url: parsed.url,
              metadata: parsed.metadata,
              timestamp: parsed.timestamp,
            });
          }
        } catch {}
      }
      return results.sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  },

  clearCache: async () => {
    if (typeof caches === "undefined") return;
    await Promise.all([
      caches.delete(META_CACHE_NAME),
      caches.delete(FULL_CACHE_NAME),
    ]);
  },

  chunkDurationSec: 0,
  windowAheadSec: 0,
  metaCacheName: META_CACHE_NAME,
  chunkCacheName: FULL_CACHE_NAME,
  getMetaKey,
  getChunkKey: (url: string, _chunkIndex: number) => new Request(url),
};
