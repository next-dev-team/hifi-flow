// Web implementation using IndexedDB
// Based on the user's provided concept

export interface AudioMetadata {
  id: string;
  title: string;
  artist: string;
  artwork?: string;
}

class AudioChunkCache {
  private dbName: string;
  private storeName: string;
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase>;

  constructor(dbName = "AudioCache", storeName = "chunks") {
    this.dbName = dbName;
    this.storeName = storeName;
    this.initPromise = this.init();
  }

  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
        // Store for tracking complete files
        if (!db.objectStoreNames.contains("files")) {
          db.createObjectStore("files");
        }
      };
    });
  }

  async saveChunk(key: string, data: ArrayBuffer) {
    await this.initPromise;
    return new Promise<void>((resolve, reject) => {
      if (!this.db) return reject(new Error("DB not initialized"));
      const tx = this.db.transaction([this.storeName], "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.put(data, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getChunk(key: string): Promise<ArrayBuffer | undefined> {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error("DB not initialized"));
      const tx = this.db.transaction([this.storeName], "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async hasChunk(key: string): Promise<boolean> {
    const chunk = await this.getChunk(key);
    return chunk !== undefined;
  }

  // Helper to mark a file as fully cached
  async markFileComplete(
    url: string,
    contentLength: number,
    contentType: string,
    metadata?: AudioMetadata
  ) {
    await this.initPromise;
    return new Promise<void>((resolve, reject) => {
      if (!this.db) return reject(new Error("DB not initialized"));
      const tx = this.db.transaction(["files"], "readwrite");
      const store = tx.objectStore("files");
      const request = store.put(
        {
          url,
          contentLength,
          contentType,
          metadata,
          timestamp: Date.now(),
        },
        url
      );
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getFileInfo(
    url: string
  ): Promise<
    | { contentLength: number; contentType: string; metadata?: AudioMetadata }
    | undefined
  > {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error("DB not initialized"));
      const tx = this.db.transaction(["files"], "readonly");
      const store = tx.objectStore("files");
      const request = store.get(url);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllCachedFiles(): Promise<
    { url: string; metadata?: AudioMetadata; timestamp: number }[]
  > {
    await this.initPromise;
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error("DB not initialized"));
      const tx = this.db.transaction(["files"], "readonly");
      const store = tx.objectStore("files");
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }
  async clearAll() {
    await this.initPromise;
    return new Promise<void>((resolve, reject) => {
      if (!this.db) return reject(new Error("DB not initialized"));
      const tx = this.db.transaction([this.storeName, "files"], "readwrite");
      
      const chunksStore = tx.objectStore(this.storeName);
      const filesStore = tx.objectStore("files");

      chunksStore.clear();
      filesStore.clear();

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteUrl(url: string) {
    await this.initPromise;
    return new Promise<void>((resolve, reject) => {
      if (!this.db) return reject(new Error("DB not initialized"));

      const tx = this.db.transaction([this.storeName, "files"], "readwrite");
      const chunksStore = tx.objectStore(this.storeName);
      const filesStore = tx.objectStore("files");

      try {
        filesStore.delete(url);
      } catch {}

      const prefix = `${url}_chunk_`;
      const cursorRequest = chunksStore.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          return;
        }

        const key = cursor.key;
        if (typeof key === "string" && key.startsWith(prefix)) {
          try {
            cursor.delete();
          } catch {}
        }
        cursor.continue();
      };
      cursorRequest.onerror = () => {
        reject(cursorRequest.error);
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// Global cache instance
const globalCache = new AudioChunkCache();

export class ChunkedAudioLoader {
  private url: string;
  private chunkSize: number;
  private cache: AudioChunkCache;
  private totalSize: number = 0;
  private contentType: string = "audio/mpeg"; // Default
  private chunks: Map<number, ArrayBuffer> = new Map();

  constructor(url: string, chunkSize = 256 * 1024) {
    // 256KB chunks
    this.url = url;
    this.chunkSize = chunkSize;
    this.cache = globalCache;
  }

  async getContentLength() {
    if (this.totalSize > 0) return this.totalSize;

    // Check cache first
    const cachedInfo = await this.cache.getFileInfo(this.url);
    if (cachedInfo) {
      this.totalSize = cachedInfo.contentLength;
      this.contentType = cachedInfo.contentType;
      return this.totalSize;
    }

    try {
      const response = await fetch(this.url, { method: "HEAD" });
      this.totalSize = parseInt(response.headers.get("content-length") || "0");
      this.contentType = response.headers.get("content-type") || "audio/mpeg";
      return this.totalSize;
    } catch (e) {
      console.warn("[AudioLoader] Failed to get content length", e);
      return 0;
    }
  }

  async loadChunk(chunkIndex: number): Promise<ArrayBuffer> {
    const cacheKey = `${this.url}_chunk_${chunkIndex}`;

    // Check cache first
    const cached = await this.cache.getChunk(cacheKey);
    if (cached) {
      this.chunks.set(chunkIndex, cached);
      return cached;
    }

    if (this.totalSize === 0) await this.getContentLength();
    if (this.totalSize === 0) throw new Error("Cannot determine file size");

    // Download chunk
    const start = chunkIndex * this.chunkSize;
    const end = Math.min(start + this.chunkSize - 1, this.totalSize - 1);

    const response = await fetch(this.url, {
      headers: { Range: `bytes=${start}-${end}` },
    });

    const arrayBuffer = await response.arrayBuffer();

    // Cache it
    await this.cache.saveChunk(cacheKey, arrayBuffer);
    this.chunks.set(chunkIndex, arrayBuffer);

    return arrayBuffer;
  }

  /**
   * Checks if the full audio is available in cache.
   * If so, returns a Blob URL.
   * If not, returns the original URL.
   */
  async getAudioUrl(): Promise<string> {
    const cachedInfo = await this.cache.getFileInfo(this.url);
    if (cachedInfo) {
      // Verify we have all chunks (optimistic check or full check?)
      // For speed, rely on 'files' store entry which implies completeness
      // But we need to reconstruct the blob
      try {
        const blob = await this.reconstructBlob(
          cachedInfo.contentLength,
          cachedInfo.contentType
        );
        console.log(`[AudioLoader] Serving from cache: ${this.url}`);
        return URL.createObjectURL(blob);
      } catch (e) {
        console.warn("[AudioLoader] Failed to reconstruct from cache", e);
        // Fallback to network
      }
    }
    return this.url;
  }

  private async reconstructBlob(
    totalSize: number,
    contentType: string
  ): Promise<Blob> {
    const chunkCount = Math.ceil(totalSize / this.chunkSize);
    const buffers: ArrayBuffer[] = [];

    for (let i = 0; i < chunkCount; i++) {
      const cacheKey = `${this.url}_chunk_${i}`;
      const chunk = await this.cache.getChunk(cacheKey);
      if (!chunk) throw new Error(`Missing chunk ${i}`);
      buffers.push(chunk);
    }

    return new Blob(buffers, { type: contentType });
  }

  /**
   * Downloads the full audio and caches it.
   * Should be called in background.
   */
  async cacheFullAudio(metadata?: AudioMetadata): Promise<void> {
    const cachedInfo = await this.cache.getFileInfo(this.url);
    if (cachedInfo) return; // Already cached

    await this.getContentLength();
    if (this.totalSize === 0) return;

    const chunkCount = Math.ceil(this.totalSize / this.chunkSize);
    console.log(`[AudioLoader] Caching ${this.url} (${chunkCount} chunks)`);

    // Sequential download to avoid flooding network
    // Modified to allow limited concurrency for speed
    const CONCURRENCY = 3;
    for (let i = 0; i < chunkCount; i += CONCURRENCY) {
      const batch = [];
      for (let j = 0; j < CONCURRENCY && i + j < chunkCount; j++) {
        batch.push(this.loadChunk(i + j));
      }
      await Promise.all(batch);
    }

    await this.cache.markFileComplete(
      this.url,
      this.totalSize,
      this.contentType,
      metadata
    );
    console.log(`[AudioLoader] Cached complete: ${this.url}`);
  }
}

export const audioCacheService = {
  // Simple listener implementation
  _listeners: new Set<(url: string) => void>(),

  addListener(callback: (url: string) => void) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  },

  notifyListeners(url: string) {
    this._listeners.forEach((l) => {
      l(url);
    });
  },

  resolveUrl: async (url: string, metadata?: AudioMetadata) => {
    const loader = new ChunkedAudioLoader(url);
    const resolved = await loader.getAudioUrl();

    // If not cached (returned original URL), trigger caching in background
    if (resolved === url) {
      // Fire and forget
      loader
        .cacheFullAudio(metadata)
        .then(() => {
          // Notify listeners that a new file is cached
          audioCacheService.notifyListeners(url);
        })
        .catch((e) => console.warn("[AudioLoader] Background cache failed", e));
    }

    return resolved;
  },

  cacheUrl: async (url: string, metadata?: AudioMetadata) => {
    const loader = new ChunkedAudioLoader(url);
    await loader.cacheFullAudio(metadata);
    audioCacheService.notifyListeners(url);
  },

  evictUrl: async (url: string) => {
    await globalCache.deleteUrl(url);
    audioCacheService.notifyListeners(url);
  },

  isCached: async (url: string) => {
    const info = await globalCache.getFileInfo(url);
    return !!info;
  },

  getAllCachedTracks: async (): Promise<
    { url: string; metadata?: AudioMetadata; timestamp: number }[]
  > => {
    return globalCache.getAllCachedFiles();
  },
  
  clearCache: async () => {
    return globalCache.clearAll();
  }
};
