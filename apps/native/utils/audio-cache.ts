// Native implementation - No-op for IndexedDB caching
// As IndexedDB is not available on native, we simply pass through the URL.
// Native caching would require expo-file-system.

export interface AudioMetadata {
  id: string;
  title: string;
  artist: string;
  artwork?: string;
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
};
