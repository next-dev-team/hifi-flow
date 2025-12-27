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

const CHUNK_DURATION_SEC = 40;
const WINDOW_AHEAD_SEC = 60;
const CACHE_VERSION = "v2";
const META_CACHE_NAME = `hififlow-audio-meta-${CACHE_VERSION}`;
const CHUNK_CACHE_NAME = `hififlow-audio-chunks-${CACHE_VERSION}`;
const AUDIO_STREAM_PATH = "/__hififlow_audio_stream";

const progressByUrl = new Map<string, AudioCacheProgress>();
const urlListeners = new Set<(url: string) => void>();
const progressListeners = new Set<(progress: AudioCacheProgress) => void>();
const lastWindowRequestAt = new Map<string, number>();
let swListenerReady = false;

function getMetaKey(url: string) {
  return new Request(`/__hififlow_audio_meta?u=${encodeURIComponent(url)}`);
}

function getChunkKey(url: string, chunkIndex: number) {
  return new Request(
    `/__hififlow_audio_chunk?u=${encodeURIComponent(url)}&i=${chunkIndex}`
  );
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

async function upsertMeta(url: string, metadata?: AudioMetadata) {
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
      cachedChunks:
        typeof prev?.cachedChunks === "number" ? prev.cachedChunks : 0,
      totalChunks: typeof prev?.totalChunks === "number" ? prev.totalChunks : 0,
    };
    await cache.put(
      key,
      new Response(JSON.stringify(next), {
        headers: { "Content-Type": "application/json" },
      })
    );
  } catch {}
}

async function deleteChunksForUrl(url: string) {
  if (typeof caches === "undefined") return;
  const encoded = encodeURIComponent(url);
  const cache = await caches.open(CHUNK_CACHE_NAME);
  const keys = await cache.keys();
  await Promise.all(
    keys
      .filter((k) => k.url.includes(`/__hififlow_audio_chunk?u=${encoded}`))
      .map((k) => cache.delete(k))
  );
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

async function hasChunk(url: string, chunkIndex: number): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(CHUNK_CACHE_NAME);
    const match = await cache.match(getChunkKey(url, chunkIndex));
    return Boolean(match);
  } catch {
    return false;
  }
}

async function waitForChunks(
  url: string,
  chunkIndexes: number[],
  options: { timeoutMs: number }
): Promise<boolean> {
  const timeoutMs = Math.max(0, options.timeoutMs);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const checks = await Promise.all(chunkIndexes.map((i) => hasChunk(url, i)));
    if (checks.every(Boolean)) return true;
    await new Promise((r) => setTimeout(r, 125));
  }

  const finalChecks = await Promise.all(
    chunkIndexes.map((i) => hasChunk(url, i))
  );
  return finalChecks.every(Boolean);
}

export class ChunkedAudioLoader {
  constructor(private url: string) {}

  async getAudioUrl(metadata?: AudioMetadata): Promise<string> {
    initServiceWorkerListeners();
    await upsertMeta(this.url, metadata);
    const durationSec = metadata?.durationSec;
    await postToServiceWorker({
      type: "AUDIO_META",
      url: this.url,
      durationSec,
      metadata: metadata
        ? {
            id: metadata.id,
            title: metadata.title,
            artist: metadata.artist,
            artwork: metadata.artwork,
          }
        : undefined,
    });
    await postToServiceWorker({
      type: "AUDIO_CACHE_WINDOW",
      url: this.url,
      positionSec: 0,
    });

    if (
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      !navigator.serviceWorker.controller
    ) {
      try {
        await navigator.serviceWorker.ready;
      } catch {}
      for (let i = 0; i < 10; i += 1) {
        if (navigator.serviceWorker.controller) break;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    if (canUseAudioStreamProxy()) {
      return buildStreamProxyUrl(this.url);
    }
    return this.url;
  }

  async cacheFullAudio(metadata?: AudioMetadata): Promise<void> {
    initServiceWorkerListeners();
    await upsertMeta(this.url, metadata);
    await postToServiceWorker({
      type: "AUDIO_META",
      url: this.url,
      durationSec: metadata?.durationSec,
      metadata: metadata
        ? {
            id: metadata.id,
            title: metadata.title,
            artist: metadata.artist,
            artwork: metadata.artwork,
          }
        : undefined,
    });
    await postToServiceWorker({
      type: "AUDIO_CACHE_FULL",
      url: this.url,
    });
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

  cacheWindow: async (
    url: string,
    options?: { positionSec?: number; metadata?: AudioMetadata }
  ) => {
    initServiceWorkerListeners();
    const now = Date.now();
    const last = lastWindowRequestAt.get(url) ?? 0;
    if (now - last < 750) return;
    lastWindowRequestAt.set(url, now);

    await upsertMeta(url, options?.metadata);
    if (options?.metadata?.durationSec) {
      await postToServiceWorker({
        type: "AUDIO_META",
        url,
        durationSec: options.metadata.durationSec,
        metadata: {
          id: options.metadata.id,
          title: options.metadata.title,
          artist: options.metadata.artist,
          artwork: options.metadata.artwork,
        },
      });
    }
    await postToServiceWorker({
      type: "AUDIO_CACHE_WINDOW",
      url,
      positionSec: options?.positionSec ?? 0,
    });
  },

  ensureCachedSeconds: async (
    url: string,
    options?: {
      positionSec?: number;
      seconds?: number;
      timeoutMs?: number;
      metadata?: AudioMetadata;
    }
  ): Promise<boolean> => {
    initServiceWorkerListeners();
    const positionSec = options?.positionSec ?? 0;
    const seconds = Math.max(0, options?.seconds ?? CHUNK_DURATION_SEC);
    const timeoutMs = Math.max(0, options?.timeoutMs ?? 2500);

    await upsertMeta(url, options?.metadata);
    if (options?.metadata?.durationSec) {
      await postToServiceWorker({
        type: "AUDIO_META",
        url,
        durationSec: options.metadata.durationSec,
        metadata: {
          id: options.metadata.id,
          title: options.metadata.title,
          artist: options.metadata.artist,
          artwork: options.metadata.artwork,
        },
      });
    }

    await postToServiceWorker({
      type: "AUDIO_CACHE_WINDOW",
      url,
      positionSec,
    });

    const neededChunks = Math.max(1, Math.ceil(seconds / CHUNK_DURATION_SEC));
    const startChunkIndex = Math.max(
      0,
      Math.floor(positionSec / CHUNK_DURATION_SEC)
    );
    const chunkIndexes = Array.from(
      { length: neededChunks },
      (_, idx) => startChunkIndex + idx
    );
    return waitForChunks(url, chunkIndexes, { timeoutMs });
  },

  isChunkCached: async (url: string, chunkIndex: number): Promise<boolean> => {
    return hasChunk(url, chunkIndex);
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
      cachedChunks:
        typeof (parsed as any).cachedChunks === "number"
          ? (parsed as any).cachedChunks
          : undefined,
      totalChunks:
        typeof (parsed as any).totalChunks === "number"
          ? (parsed as any).totalChunks
          : undefined,
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
            if (typeof parsed?.url === "string") {
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
    const loader = new ChunkedAudioLoader(url);
    return loader.getAudioUrl(metadata);
  },

  cacheUrl: async (url: string, metadata?: AudioMetadata) => {
    const loader = new ChunkedAudioLoader(url);
    await loader.cacheFullAudio(metadata);
    urlListeners.forEach((l) => {
      try {
        l(url);
      } catch {}
    });
  },

  evictUrl: async (url: string) => {
    if (typeof caches === "undefined") return;
    await deleteChunksForUrl(url);
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
      const metaCache = await caches.open(META_CACHE_NAME);
      const meta = await metaCache.match(getMetaKey(url));
      if (!meta) return false;
      const parsed = (await meta.json()) as any;
      if (typeof parsed?.cachedChunks === "number") {
        return parsed.cachedChunks > 0;
      }
      const chunkCache = await caches.open(CHUNK_CACHE_NAME);
      const keys = await chunkCache.keys();
      const encoded = encodeURIComponent(url);
      return keys.some((k) =>
        k.url.includes(`/__hififlow_audio_chunk?u=${encoded}`)
      );
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
            typeof parsed?.timestamp === "number"
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
      caches.delete(CHUNK_CACHE_NAME),
    ]);
  },

  chunkDurationSec: CHUNK_DURATION_SEC,
  windowAheadSec: WINDOW_AHEAD_SEC,
  metaCacheName: META_CACHE_NAME,
  chunkCacheName: CHUNK_CACHE_NAME,
  getMetaKey,
  getChunkKey,
};
