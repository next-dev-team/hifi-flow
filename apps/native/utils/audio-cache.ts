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

  async getAudioUrl(): Promise<string> {
    return this.url;
  }

  async cacheFullAudio(metadata?: AudioMetadata): Promise<void> {
    // No-op on native
  }
}

export const audioCacheService = {
  addListener: (callback: (url: string) => void) => {
    return () => {};
  },
  addProgressListener: (callback: (progress: AudioCacheProgress) => void) => {
    return () => {};
  },
  getProgress: (_url: string): AudioCacheProgress | null => {
    return null;
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
    return null;
  },
  findCachedUrlByTrackId: async (_trackId: string): Promise<string | null> => {
    return null;
  },
  resolveUrl: async (url: string, metadata?: AudioMetadata) => url,
  cacheUrl: async (url: string, metadata?: AudioMetadata) => {
    /* no-op */
  },
  evictUrl: async (url: string) => {
    /* no-op */
  },
  isCached: async (url: string) => {
    return false;
  },
  getAllCachedTracks: async (): Promise<
    { url: string; metadata?: AudioMetadata; timestamp: number }[]
  > => {
    return [];
  },
  clearCache: async () => {
    // no-op
  },

  chunkDurationSec: 5,
  windowAheadSec: 60,
};
