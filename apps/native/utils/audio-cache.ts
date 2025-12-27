import * as FileSystem from "expo-file-system/legacy";

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

export class AudioChunkCache {
  constructor(public dbName = "AudioCache", public storeName = "chunks") {}

  async init() {
    return Promise.resolve(null);
  }

  async saveChunk(key: string, data: ArrayBuffer) {
    return Promise.resolve();
  }

  async getChunk(key: string) {
    return Promise.resolve(undefined);
  }

  async hasChunk(key: string) {
    return Promise.resolve(false);
  }
}

export class ChunkedAudioLoader {
  constructor(public url: string, public chunkSize = 256 * 1024) {}

  async getAudioUrl(metadata?: AudioMetadata): Promise<string> {
    return audioCacheService.resolveUrl(this.url, metadata);
  }

  async cacheFullAudio(metadata?: AudioMetadata): Promise<void> {
    await audioCacheService.cacheUrl(this.url, metadata);
  }
}

type NativeCacheEntry = {
  url: string;
  localUri: string;
  metadata?: AudioMetadata;
  timestamp: number;
  sizeBytes?: number;
};

type NativeCacheIndex = {
  version: 1;
  entries: NativeCacheEntry[];
};

const CACHE_VERSION = 1 as const;
const MAX_ENTRIES = 200;
const BASE_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}hififlow-audio-cache/`
  : null;
const INDEX_URI = BASE_DIR ? `${BASE_DIR}index-v${CACHE_VERSION}.json` : null;

const progressByUrl = new Map<string, AudioCacheProgress>();
const urlListeners = new Set<(url: string) => void>();
const progressListeners = new Set<(progress: AudioCacheProgress) => void>();

let indexMemo: NativeCacheIndex | null = null;
let indexLoadPromise: Promise<NativeCacheIndex> | null = null;
let indexWriteChain: Promise<void> = Promise.resolve();

function fnv1a32(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function safeExtensionFromUrl(url: string) {
  try {
    const u = new URL(url);
    const pathname = u.pathname || "";
    const last = pathname.split("/").pop() || "";
    const dotIndex = last.lastIndexOf(".");
    if (dotIndex === -1) return "";
    const ext = last.slice(dotIndex + 1).toLowerCase();
    if (!ext) return "";
    if (ext.length > 6) return "";
    if (!/^[a-z0-9]+$/.test(ext)) return "";
    return ext;
  } catch {
    return "";
  }
}

function getFileUriForUrl(url: string) {
  if (!BASE_DIR) return null;
  const hash = fnv1a32(url).toString(16).padStart(8, "0");
  const ext = safeExtensionFromUrl(url);
  const suffix = ext ? `.${ext}` : ".audio";
  return `${BASE_DIR}${hash}${suffix}`;
}

async function ensureReady() {
  if (!BASE_DIR || !INDEX_URI) return false;
  try {
    await FileSystem.makeDirectoryAsync(BASE_DIR, { intermediates: true });
    return true;
  } catch {
    return false;
  }
}

function sanitizeIndex(parsed: unknown): NativeCacheIndex {
  if (!parsed || typeof parsed !== "object") {
    return { version: CACHE_VERSION, entries: [] };
  }
  const obj = parsed as any;
  const entriesRaw = Array.isArray(obj.entries) ? obj.entries : [];
  const entries: NativeCacheEntry[] = entriesRaw
    .map((e: any) => {
      if (!e || typeof e !== "object") return null;
      if (typeof e.url !== "string" || typeof e.localUri !== "string") {
        return null;
      }
      const timestamp =
        typeof e.timestamp === "number" && Number.isFinite(e.timestamp)
          ? e.timestamp
          : 0;
      const sizeBytes =
        typeof e.sizeBytes === "number" && Number.isFinite(e.sizeBytes)
          ? e.sizeBytes
          : undefined;
      const metadata =
        e.metadata &&
        typeof e.metadata === "object" &&
        typeof e.metadata.id === "string"
          ? {
              id: String(e.metadata.id),
              title:
                typeof e.metadata.title === "string" ? e.metadata.title : "",
              artist:
                typeof e.metadata.artist === "string" ? e.metadata.artist : "",
              artwork:
                typeof e.metadata.artwork === "string"
                  ? e.metadata.artwork
                  : undefined,
              durationSec:
                typeof e.metadata.durationSec === "number" &&
                Number.isFinite(e.metadata.durationSec)
                  ? e.metadata.durationSec
                  : undefined,
            }
          : undefined;
      return {
        url: e.url,
        localUri: e.localUri,
        metadata,
        timestamp,
        sizeBytes,
      } satisfies NativeCacheEntry;
    })
    .filter(Boolean) as NativeCacheEntry[];

  const sorted = entries
    .slice()
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, MAX_ENTRIES);

  return { version: CACHE_VERSION, entries: sorted };
}

async function loadIndex(): Promise<NativeCacheIndex> {
  if (indexMemo) return indexMemo;
  if (indexLoadPromise) return indexLoadPromise;

  indexLoadPromise = (async () => {
    const ready = await ensureReady();
    if (!ready || !INDEX_URI) {
      const empty = { version: CACHE_VERSION, entries: [] };
      indexMemo = empty;
      return empty;
    }
    try {
      const info = await FileSystem.getInfoAsync(INDEX_URI);
      if (!info.exists) {
        const empty = { version: CACHE_VERSION, entries: [] };
        indexMemo = empty;
        return empty;
      }
      const text = await FileSystem.readAsStringAsync(INDEX_URI);
      const parsed = JSON.parse(text) as unknown;
      const next = sanitizeIndex(parsed);
      indexMemo = next;
      return next;
    } catch {
      const empty = { version: CACHE_VERSION, entries: [] };
      indexMemo = empty;
      return empty;
    } finally {
      indexLoadPromise = null;
    }
  })();

  return indexLoadPromise;
}

async function writeIndex(next: NativeCacheIndex) {
  if (!INDEX_URI) return;
  try {
    await FileSystem.writeAsStringAsync(INDEX_URI, JSON.stringify(next));
  } catch {
    return;
  }
}

async function updateIndex(
  mutator: (current: NativeCacheIndex) => NativeCacheIndex
) {
  indexWriteChain = indexWriteChain
    .then(async () => {
      const current = await loadIndex();
      const next = sanitizeIndex(mutator(current));
      indexMemo = next;
      await writeIndex(next);
    })
    .catch(() => {
      return;
    });
  await indexWriteChain;
  return (await loadIndex()) as NativeCacheIndex;
}

async function entryFileExists(entry: NativeCacheEntry) {
  try {
    const info = await FileSystem.getInfoAsync(entry.localUri);
    return Boolean(info.exists);
  } catch {
    return false;
  }
}

export const audioCacheService = {
  addListener: (callback: (url: string) => void) => {
    urlListeners.add(callback);
    return () => urlListeners.delete(callback);
  },
  addProgressListener: (callback: (progress: AudioCacheProgress) => void) => {
    progressListeners.add(callback);
    return () => progressListeners.delete(callback);
  },
  getProgress: (_url: string): AudioCacheProgress | null => {
    return progressByUrl.get(_url) ?? null;
  },
  getStorageEstimate: async (): Promise<StorageEstimate | null> => {
    return null;
  },
  cacheWindow: async (
    _url: string,
    _options?: { positionSec?: number; metadata?: AudioMetadata }
  ) => {
    return;
  },
  ensureCachedSeconds: async (
    _url: string,
    _options?: {
      positionSec?: number;
      seconds?: number;
      timeoutMs?: number;
      metadata?: AudioMetadata;
    }
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
    _url: string
  ): Promise<{
    url: string;
    metadata?: AudioMetadata;
    timestamp: number;
    cachedChunks?: number;
    totalChunks?: number;
  } | null> => {
    const index = await loadIndex();
    const entry = index.entries.find((e) => e.url === _url) ?? null;
    if (!entry) return null;
    const exists = await entryFileExists(entry);
    if (!exists) return null;
    return {
      url: entry.url,
      metadata: entry.metadata,
      timestamp: entry.timestamp,
    };
  },
  findCachedUrlByTrackId: async (_trackId: string): Promise<string | null> => {
    const index = await loadIndex();
    for (const entry of index.entries) {
      if (
        entry.metadata?.id &&
        String(entry.metadata.id) === String(_trackId)
      ) {
        if (await entryFileExists(entry)) {
          return entry.localUri;
        }
      }
    }
    return null;
  },
  resolveUrl: async (url: string, metadata?: AudioMetadata) => {
    if (!url) return url;
    const index = await loadIndex();

    const byUrl = index.entries.find((e) => e.url === url) ?? null;
    if (byUrl && (await entryFileExists(byUrl))) {
      return byUrl.localUri;
    }

    const trackId = metadata?.id ? String(metadata.id) : null;
    if (trackId) {
      const byTrack = index.entries.find(
        (e) => e.metadata?.id && String(e.metadata.id) === trackId
      );
      if (byTrack && (await entryFileExists(byTrack))) {
        return byTrack.localUri;
      }
    }

    return url;
  },
  cacheUrl: async (url: string, metadata?: AudioMetadata) => {
    if (!url) return;
    const ready = await ensureReady();
    const fileUri = getFileUriForUrl(url);
    if (!ready || !fileUri) return;

    try {
      const existingInfo = await FileSystem.getInfoAsync(fileUri);
      if (existingInfo.exists) {
        const sizeBytes =
          existingInfo &&
          typeof existingInfo === "object" &&
          "size" in existingInfo &&
          typeof (existingInfo as any).size === "number"
            ? (existingInfo as any).size
            : undefined;
        await updateIndex((current) => {
          const without = current.entries.filter((e) => e.url !== url);
          const entry: NativeCacheEntry = {
            url,
            localUri: fileUri,
            metadata,
            timestamp: Date.now(),
            sizeBytes,
          };
          return { version: CACHE_VERSION, entries: [entry, ...without] };
        });
        urlListeners.forEach((l) => {
          try {
            l(url);
          } catch {}
        });
        return;
      }

      const durationSec =
        typeof metadata?.durationSec === "number" &&
        Number.isFinite(metadata.durationSec)
          ? metadata.durationSec
          : 0;

      const downloadResumable = FileSystem.createDownloadResumable(
        url,
        fileUri,
        {},
        (p: FileSystem.DownloadProgressData) => {
          const total = p.totalBytesExpectedToWrite;
          const written = p.totalBytesWritten;
          const ratio = total > 0 ? written / total : 0;
          const progress: AudioCacheProgress = {
            url,
            windowStartSec: 0,
            windowEndSec: durationSec,
            cachedChunks: Math.floor(ratio * 100),
            totalChunks: 100,
            cachedSecondsAhead: durationSec > 0 ? durationSec * ratio : 0,
            updatedAt: Date.now(),
          };
          progressByUrl.set(url, progress);
          progressListeners.forEach((listener) => {
            try {
              listener(progress);
            } catch {}
          });
        }
      );

      const result = await downloadResumable.downloadAsync();
      if (!result?.uri) return;

      const info = await FileSystem.getInfoAsync(result.uri);
      const sizeBytes =
        info &&
        typeof info === "object" &&
        "size" in info &&
        typeof (info as any).size === "number"
          ? (info as any).size
          : undefined;

      await updateIndex((current) => {
        const without = current.entries.filter((e) => e.url !== url);
        const entry: NativeCacheEntry = {
          url,
          localUri: result.uri,
          metadata,
          timestamp: Date.now(),
          sizeBytes,
        };
        const entries = [entry, ...without]
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
          .slice(0, MAX_ENTRIES);
        return { version: CACHE_VERSION, entries };
      });

      const doneProgress: AudioCacheProgress = {
        url,
        windowStartSec: 0,
        windowEndSec: durationSec,
        cachedChunks: 100,
        totalChunks: 100,
        cachedSecondsAhead: durationSec,
        updatedAt: Date.now(),
      };
      progressByUrl.set(url, doneProgress);
      progressListeners.forEach((listener) => {
        try {
          listener(doneProgress);
        } catch {}
      });

      urlListeners.forEach((l) => {
        try {
          l(url);
        } catch {}
      });
    } catch {
      return;
    }
  },
  evictUrl: async (url: string) => {
    if (!url) return;
    const index = await loadIndex();
    const entry = index.entries.find((e) => e.url === url) ?? null;
    if (entry) {
      try {
        await FileSystem.deleteAsync(entry.localUri, { idempotent: true });
      } catch {}
    }

    await updateIndex((current) => {
      return {
        version: CACHE_VERSION,
        entries: current.entries.filter((e) => e.url !== url),
      };
    });

    urlListeners.forEach((l) => {
      try {
        l(url);
      } catch {}
    });
  },
  isCached: async (url: string) => {
    if (!url) return false;
    const index = await loadIndex();
    const entry = index.entries.find((e) => e.url === url) ?? null;
    if (!entry) return false;
    return entryFileExists(entry);
  },
  getAllCachedTracks: async (): Promise<
    { url: string; metadata?: AudioMetadata; timestamp: number }[]
  > => {
    const index = await loadIndex();
    const results: {
      url: string;
      metadata?: AudioMetadata;
      timestamp: number;
    }[] = [];

    for (const entry of index.entries) {
      if (await entryFileExists(entry)) {
        results.push({
          url: entry.url,
          metadata: entry.metadata,
          timestamp: entry.timestamp,
        });
      }
    }

    return results.sort((a, b) => b.timestamp - a.timestamp);
  },
  clearCache: async () => {
    if (!BASE_DIR) return;
    try {
      await FileSystem.deleteAsync(BASE_DIR, { idempotent: true });
    } catch {}
    indexMemo = { version: CACHE_VERSION, entries: [] };
    if (INDEX_URI) {
      try {
        await FileSystem.deleteAsync(INDEX_URI, { idempotent: true });
      } catch {}
    }
  },

  chunkDurationSec: 5,
  windowAheadSec: 60,
};
