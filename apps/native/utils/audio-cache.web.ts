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

const progressByUrl = new Map<string, AudioCacheProgress>();
const urlListeners = new Set<(url: string) => void>();
const progressListeners = new Set<(progress: AudioCacheProgress) => void>();

function getMetaKey(url: string) {
  return new Request(`/__hififlow_audio_meta?u=${encodeURIComponent(url)}`);
}
export class ChunkedAudioLoader {
  constructor(private url: string) {}

  async getAudioUrl(_metadata?: AudioMetadata): Promise<string> {
    return this.url;
  }

  async cacheFullAudio(metadata?: AudioMetadata): Promise<void> {
    await audioCacheService.cacheUrl(this.url, metadata);
  }
}

export const audioCacheService = {
  _listeners: urlListeners,

  addListener(callback: (url: string) => void) {
    urlListeners.add(callback);
    return () => urlListeners.delete(callback);
  },

  addProgressListener(callback: (progress: AudioCacheProgress) => void) {
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
    void url;
    return null;
  },

  findCachedUrlByTrackId: async (trackId: string): Promise<string | null> => {
    void trackId;
    return null;
  },

  resolveUrl: async (url: string, metadata?: AudioMetadata) => {
    void metadata;
    return url;
  },

  cacheUrl: async (url: string, metadata?: AudioMetadata) => {
    void url;
    void metadata;
    return;
  },

  evictUrl: async (url: string) => {
    void url;
    return;
  },

  isCached: async (url: string) => {
    void url;
    return false;
  },

  getAllCachedTracks: async (): Promise<
    { url: string; metadata?: AudioMetadata; timestamp: number }[]
  > => {
    return [];
  },

  clearCache: async () => {
    if (typeof caches === "undefined") return;
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(
          (key) =>
            key.startsWith("hififlow-audio-meta-") ||
            key.startsWith("hififlow-audio-full-")
        )
        .map((key) => caches.delete(key))
    );
  },

  chunkDurationSec: 0,
  windowAheadSec: 0,
  metaCacheName: "",
  chunkCacheName: "",
  getMetaKey,
  getChunkKey: (url: string, _chunkIndex: number) => new Request(url),
};
