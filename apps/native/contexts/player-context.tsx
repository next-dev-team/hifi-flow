import {
  type AudioAnalysis,
  extractAudioAnalysis,
} from "@siteed/expo-audio-studio";
import {
  default as AudioModule,
  type AudioPlayer,
  type AudioStatus,
  createAudioPlayer,
} from "expo-audio";
import * as SecureStore from "expo-secure-store";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import { useToast } from "@/contexts/toast-context";
import { useOfflineStatus } from "@/hooks/use-offline-status";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { losslessAPI } from "@/utils/api";
import { audioCacheService } from "@/utils/audio-cache";
import { mediaSessionService } from "@/utils/media-session";
import type { AudioQuality as ApiAudioQuality } from "@/utils/types";

type AudioQuality = ApiAudioQuality;
type RepeatMode = "off" | "all" | "one";
type QueueType = "music" | "podcast";

function isPodcastTrackId(id: unknown): boolean {
  return String(id ?? "").startsWith("podcast:");
}

interface Track {
  id: string | number;
  title: string;
  artist: string;
  artwork?: string;
  url: string;
  duration?: number;
}

export type SavedTrack = {
  id: string;
  title: string;
  artist: string;
  artwork?: string;
  streamUrl: string | null;
  addedAt: number;
};

// Pre-buffer status for UI indication
export type PreBufferStatus = "none" | "buffering" | "ready" | "failed";

interface PlayerContextType {
  currentTrack: Track | null;
  activeQueueType: "music" | "podcast";
  isPlaying: boolean;
  isLoading: boolean;
  queue: Track[];
  quality: AudioQuality;
  setQuality: (quality: AudioQuality) => void;
  shuffleEnabled: boolean;
  toggleShuffle: () => void;
  repeatMode: RepeatMode;
  cycleRepeatMode: () => void;
  positionMillis: number;
  durationMillis: number;
  currentStreamUrl: string | null;
  audioAnalysis: AudioAnalysis | null;
  isAnalyzing: boolean;
  sleepTimerEndsAt: number | null;
  sleepTimerRemainingMs: number;
  startSleepTimer: (minutes: number) => void;
  cancelSleepTimer: () => void;
  playTrack: (
    track: Track,
    options?: {
      skipRecentlyPlayed?: boolean;
      queueType?: QueueType;
      replaceQueue?: boolean;
    }
  ) => Promise<void>;
  playQueue: (
    tracks: Track[],
    startIndex?: number,
    options?: { queueType?: QueueType; replaceQueue?: boolean }
  ) => Promise<void>;
  pauseTrack: () => Promise<void>;
  resumeTrack: () => Promise<void>;
  seekToMillis: (positionMillis: number) => Promise<void>;
  seekByMillis: (deltaMillis: number) => Promise<void>;
  addToQueue: (track: Track) => boolean;
  addTracksToQueue: (tracks: Track[]) => number;
  removeFromQueue: (trackId: string) => void;
  shuffleQueue: () => void;
  clearQueue: () => void;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  favorites: SavedTrack[];
  recentlyPlayed: SavedTrack[];
  isCurrentFavorited: boolean;
  toggleCurrentFavorite: (artwork?: string) => Promise<void>;
  toggleFavorite: (track: Track) => Promise<void>;
  toggleTracksFavorites: (tracks: Track[]) => Promise<void>;
  removeFavorite: (id: string) => Promise<void>;
  removeFromRecentlyPlayed: (id: string) => Promise<void>;
  playSaved: (saved: SavedTrack) => Promise<void>;
  volume: number;
  setVolume: (volume: number) => Promise<void>;
  loadingTrackId: string | null;
  cachedTrackIds: Set<string>;
  // New: Pre-buffer status for next track
  nextTrackBufferStatus: PreBufferStatus;
  nextTrack: Track | null;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

const FAVORITES_STORAGE_KEY = "hififlow:favorites:v1";
const RECENTLY_PLAYED_STORAGE_KEY = "hififlow:recently_played:v1";
const QUALITY_STORAGE_KEY = "hififlow:quality:v1";
const SHUFFLE_STORAGE_KEY = "hififlow:shuffle:v1";
const REPEAT_STORAGE_KEY = "hififlow:repeat:v1";
const VOLUME_STORAGE_KEY = "hififlow:volume:v1";
const SLEEP_TIMER_KEY = "hififlow:sleeptimer:v1";
const MUSIC_QUEUE_STORAGE_KEY = "hififlow:queue:v1";
const MUSIC_QUEUE_INDEX_KEY = "hififlow:queue_index:v1";
const PODCAST_QUEUE_STORAGE_KEY = "hififlow:podcast_queue:v1";
const PODCAST_QUEUE_INDEX_KEY = "hififlow:podcast_queue_index:v1";
const ACTIVE_QUEUE_TYPE_KEY = "hififlow:active_queue_type:v1";
const PLAYBACK_POSITIONS_KEY = "hififlow:positions:v1";

// Maximum number of items in queue (keep newest)
const MAX_QUEUE_SIZE = 500;

async function readPersistentValue(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writePersistentValue(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      localStorage.setItem(key, value);
    } catch {
      return;
    }
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    return;
  }
}

function normalizeFavoriteId(id: unknown): string {
  const raw = typeof id === "string" ? id : String(id ?? "");
  if (raw.startsWith("saved:")) return raw.slice("saved:".length);
  return raw;
}

// ============================================================================
// PLAYER PROVIDER - Rebuilt with single-player architecture
// ============================================================================
export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // ==================== Core Playback State ====================
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [player, setPlayer] = useState<AudioPlayer | null>(null);
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [currentStreamUrl, setCurrentStreamUrl] = useState<string | null>(null);
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);
  const [cachedTrackIds, setCachedTrackIds] = useState<Set<string>>(new Set());

  const currentStreamUrlRef = useRef<string | null>(null);
  const currentBaseStreamUrlRef = useRef<string | null>(null);

  // ==================== Queue State ====================
  const [activeQueueType, setActiveQueueType, isQueueTypeLoaded] =
    usePersistentState<QueueType>(ACTIVE_QUEUE_TYPE_KEY, "music");

  const [musicQueue, setMusicQueue, isMusicQueueLoaded] = usePersistentState<
    Track[]
  >(MUSIC_QUEUE_STORAGE_KEY, []);
  const [musicQueueIndex, setMusicQueueIndex, isMusicIndexLoaded] =
    usePersistentState<number>(MUSIC_QUEUE_INDEX_KEY, -1);
  const musicQueueIndexRef = useRef<number>(-1);

  const [podcastQueue, setPodcastQueue, isPodcastQueueLoaded] =
    usePersistentState<Track[]>(PODCAST_QUEUE_STORAGE_KEY, []);
  const [podcastQueueIndex, setPodcastQueueIndex, isPodcastIndexLoaded] =
    usePersistentState<number>(PODCAST_QUEUE_INDEX_KEY, -1);
  const podcastQueueIndexRef = useRef<number>(-1);

  const queue = activeQueueType === "podcast" ? podcastQueue : musicQueue;
  const persistedQueueIndex =
    activeQueueType === "podcast" ? podcastQueueIndex : musicQueueIndex;
  const queueIndexRef =
    activeQueueType === "podcast" ? podcastQueueIndexRef : musicQueueIndexRef;

  const isQueueLoaded =
    isQueueTypeLoaded &&
    isMusicQueueLoaded &&
    isPodcastQueueLoaded &&
    isMusicIndexLoaded &&
    isPodcastIndexLoaded;

  const setQueueForType = useCallback(
    (type: QueueType, value: Track[] | ((prev: Track[]) => Track[])) => {
      if (type === "podcast") {
        setPodcastQueue(value);
        return;
      }
      setMusicQueue(value);
    },
    [setMusicQueue, setPodcastQueue]
  );

  const setPersistedQueueIndexForType = useCallback(
    (type: QueueType, value: number) => {
      if (type === "podcast") {
        setPodcastQueueIndex(value);
        return;
      }
      setMusicQueueIndex(value);
    },
    [setMusicQueueIndex, setPodcastQueueIndex]
  );

  const setPersistedQueueIndex = useCallback(
    (value: number) => {
      setPersistedQueueIndexForType(activeQueueType, value);
    },
    [activeQueueType, setPersistedQueueIndexForType]
  );

  const [savedPositions, setSavedPositions] = usePersistentState<
    Record<string, number>
  >(PLAYBACK_POSITIONS_KEY, {});

  // ==================== Settings State ====================
  const [quality, setQualityState] = useState<AudioQuality>("HI_RES_LOSSLESS");
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [volume, setVolumeState] = useState(1.0);

  // ==================== Analysis State ====================
  const [audioAnalysis, setAudioAnalysis] = useState<AudioAnalysis | null>(
    null
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // ==================== Sleep Timer State ====================
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState<number | null>(null);
  const [sleepTimerRemainingMs, setSleepTimerRemainingMs] = useState(0);

  // ==================== Library State ====================
  const [favorites, setFavorites] = useState<SavedTrack[]>([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState<SavedTrack[]>([]);

  // ==================== Pre-buffer State ====================
  const [nextTrackBufferStatus, setNextTrackBufferStatus] =
    useState<PreBufferStatus>("none");

  const nextTrack = useMemo(() => {
    if (!currentTrack || queue.length === 0) return null;
    const currentIndex = queue.findIndex(
      (t) => String(t.id) === String(currentTrack.id)
    );
    if (currentIndex === -1) return null;

    let nextIndex;
    if (shuffleEnabled) {
      // In shuffle mode, we don't easily know the next one without shuffleHistoryRef
      // But we can just show the next one in the queue array as a fallback
      nextIndex = (currentIndex + 1) % queue.length;
    } else {
      nextIndex = (currentIndex + 1) % queue.length;
      if (nextIndex === 0 && repeatMode !== "all") return null;
    }
    return queue[nextIndex] || null;
  }, [currentTrack, queue, shuffleEnabled, repeatMode]);

  const { showToast } = useToast();
  const isOffline = useOfflineStatus();

  const prevFavoriteIdsRef = useRef<Set<string>>(new Set());
  const pendingFavoriteCacheIdsRef = useRef<Set<string>>(new Set());

  // ==================== Refs for single-player control ====================
  // CRITICAL: Only ONE active player at any time
  const activePlayerRef = useRef<AudioPlayer | null>(null);
  // Playback operation lock - prevents concurrent play operations
  const playLockRef = useRef<boolean>(false);
  // Pre-buffered player for instant next-track playback
  const preBufferedPlayerRef = useRef<{
    player: AudioPlayer;
    trackId: string;
    quality: AudioQuality;
    url: string;
    baseUrl: string;
  } | null>(null);

  const cachedUrlByTrackIdRef = useRef<Map<string, string>>(new Map());
  const streamUrlInFlightRef = useRef<Map<string, Promise<string | null>>>(
    new Map()
  );
  // Shuffle state
  const shuffleHistoryRef = useRef<number[]>([]);
  // Sleep timer handles
  const sleepTimerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const sleepTimerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  // Failure tracking for skip protection
  const consecutiveFailuresRef = useRef<number>(0);
  const MAX_CONSECUTIVE_FAILURES = 5;
  // PlayNext ref for callbacks
  const playNextRef = useRef<() => Promise<void>>(async () => {});

  const brokenTrackIdsRef = useRef<Map<string, number>>(new Map());
  const BROKEN_TRACK_TTL_MS = 2 * 60 * 1000;

  // ==================== Derived State ====================
  const isPlaying = status?.playing ?? false;
  const isLoading = status?.isBuffering ?? false;
  const positionMillis = (status?.currentTime ?? 0) * 1000;
  const durationMillis = (status?.duration ?? 0) * 1000;

  useEffect(() => {
    currentStreamUrlRef.current = currentStreamUrl;
  }, [currentStreamUrl]);

  // ==================== Audio Mode Configuration ====================
  useEffect(() => {
    async function configureAudio() {
      if (Platform.OS === "web") return;
      try {
        await AudioModule.setAudioModeAsync({
          playsInSilentMode: true,
          interruptionMode: "doNotMix",
          shouldPlayInBackground: true,
        });
      } catch (e) {
        console.warn("Failed to set audio mode", e);
      }
    }
    void configureAudio();
  }, []);

  // ==================== Status Listener ====================
  useEffect(() => {
    if (!player) {
      setStatus(null);
      return;
    }
    setStatus(player.currentStatus);
    const subscription = player.addListener(
      "playbackStatusUpdate",
      (newStatus) => {
        setStatus(newStatus);
      }
    );
    return () => subscription.remove();
  }, [player]);

  // Auto-skip logic for broken tracks
  useEffect(() => {
    // Cast to any because the type definition might be missing the error property
    // even though it exists at runtime in some versions of expo-audio
    const statusAny = status as any;
    if (statusAny?.error) {
      console.log("Playback error, attempting auto-skip:", statusAny.error);
      void playNextRef.current().catch((e: unknown) => {
        console.warn("[Player] Auto-skip failed", e);
      });
    }
  }, [status]);

  // ==================== Session Restoration ====================
  useEffect(() => {
    if (isQueueLoaded && !currentTrack && queue.length > 0) {
      let indexToRestore = persistedQueueIndex;
      if (indexToRestore < 0 || indexToRestore >= queue.length) {
        indexToRestore = 0;
      }

      const track = queue[indexToRestore];
      if (track) {
        setCurrentTrack(track);
        queueIndexRef.current = indexToRestore;
      }
    }
  }, [isQueueLoaded, queue, currentTrack, persistedQueueIndex, queueIndexRef]);

  useEffect(() => {
    if (!currentTrack) return;
    const desiredQueueType: QueueType = isPodcastTrackId(currentTrack.id)
      ? "podcast"
      : "music";
    if (activeQueueType !== desiredQueueType) {
      setActiveQueueType(desiredQueueType);
    }
  }, [currentTrack, activeQueueType, setActiveQueueType]);

  // Sync index to storage
  useEffect(() => {
    if (currentTrack && queue.length > 0) {
      const index = queue.findIndex(
        (t) => String(t.id) === String(currentTrack.id)
      );
      if (index !== -1) {
        setPersistedQueueIndex(index);
        queueIndexRef.current = index; // Ensure ref is synced too
      }
    }
  }, [currentTrack, queue, setPersistedQueueIndex]);

  // ==================== Core Utilities ====================

  const waitForPlaybackStart = useCallback(
    (candidatePlayer: AudioPlayer, timeoutMs: number) => {
      return new Promise<
        | { ok: true }
        | { ok: false; reason: "not_supported" | "timeout" | "error" }
      >((resolve) => {
        let settled = false;
        let media: any;
        let onMediaError: (() => void) | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const finish = (
          result:
            | { ok: true }
            | { ok: false; reason: "not_supported" | "timeout" | "error" }
        ) => {
          if (settled) return;
          settled = true;
          try {
            subscription.remove();
          } catch {}
          if (onMediaError && media?.removeEventListener) {
            try {
              media.removeEventListener("error", onMediaError);
            } catch {}
          }
          if (timer) clearTimeout(timer);
          resolve(result);
        };

        const subscription = candidatePlayer.addListener(
          "playbackStatusUpdate",
          (newStatus) => {
            if (
              newStatus.isLoaded ||
              newStatus.playing ||
              newStatus.currentTime > 0
            ) {
              finish({ ok: true });
            }
          }
        );

        if (Platform.OS === "web") {
          media = (candidatePlayer as any)?.media;
          if (media?.addEventListener) {
            onMediaError = () => {
              const mediaError = media?.error;
              const code =
                typeof mediaError?.code === "number" ? mediaError.code : null;

              if (code === 4) {
                finish({ ok: false, reason: "not_supported" });
                return;
              }

              finish({ ok: false, reason: "error" });
            };
            media.addEventListener("error", onMediaError);
          }
        }

        timer = setTimeout(() => {
          finish({ ok: false, reason: "timeout" });
        }, timeoutMs);
      });
    },
    []
  );

  const isNotSupportedPlaybackError = useCallback((error: unknown) => {
    if (!error) return false;
    const anyError = error as any;
    const name = typeof anyError?.name === "string" ? anyError.name : "";
    const message =
      typeof anyError?.message === "string" ? anyError.message : "";
    const text = `${name} ${message}`.toLowerCase();
    return (
      name === "NotSupportedError" ||
      text.includes("notsupportederror") ||
      text.includes("no supported sources")
    );
  }, []);

  const getWebContentType = useCallback(async (url: string) => {
    if (Platform.OS !== "web") return null;
    try {
      const resp = await fetch(url, {
        headers: {
          Range: "bytes=0-1",
        },
      });
      if (!resp.ok) return null;
      const contentType = (resp.headers.get("content-type") || "")
        .toLowerCase()
        .trim();
      return contentType || null;
    } catch {
      return null;
    }
  }, []);

  const canPlayWebContentType = useCallback((contentType: string | null) => {
    if (Platform.OS !== "web") return true;
    if (!contentType) return true;
    const normalized = contentType.split(";")[0]?.trim().toLowerCase();
    if (!normalized) return true;
    if (!normalized.startsWith("audio/") && !normalized.startsWith("video/")) {
      return true;
    }
    try {
      const audio = document.createElement("audio");
      const result = audio.canPlayType(normalized);
      return result === "probably" || result === "maybe";
    } catch {
      return true;
    }
  }, []);

  const canLoadWebProxyUrl = useCallback(
    async (proxyUrl: string) => {
      if (Platform.OS !== "web") return true;
      try {
        const contentType = await getWebContentType(proxyUrl);
        if (!contentType) return true;
        if (
          contentType.startsWith("audio/") ||
          contentType.startsWith("video/")
        ) {
          return canPlayWebContentType(contentType);
        }
        if (contentType.startsWith("application/octet-stream")) {
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [getWebContentType, canPlayWebContentType]
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const anyGlobal = globalThis as any;
    if (!anyGlobal?.addEventListener) return;

    const onUnhandledRejection = (event: any) => {
      const reason = event?.reason;
      if (!isNotSupportedPlaybackError(reason)) return;
      try {
        event.preventDefault?.();
      } catch {}
    };

    anyGlobal.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      try {
        anyGlobal.removeEventListener(
          "unhandledrejection",
          onUnhandledRejection
        );
      } catch {}
    };
  }, [isNotSupportedPlaybackError]);

  const clearWebCachesForUrl = useCallback(async (url: string) => {
    if (Platform.OS !== "web") return;

    try {
      await audioCacheService.evictUrl(url);
    } catch {}

    const cachesAny = (globalThis as any)?.caches;
    if (!cachesAny?.open || !cachesAny?.keys) return;

    try {
      const cacheNames: string[] = await cachesAny.keys();
      await Promise.all(
        cacheNames.map(async (name) => {
          try {
            const cache = await cachesAny.open(name);
            await cache.delete(url);
          } catch {}
        })
      );
    } catch {}
  }, []);

  const isWebStreamUrlForbidden = useCallback(async (url: string) => {
    if (Platform.OS !== "web") return false;
    try {
      const resp = await fetch(url, {
        cache: "no-store",
        headers: {
          Range: "bytes=0-1",
        },
      });
      return resp.status === 401 || resp.status === 403;
    } catch {
      return false;
    }
  }, []);

  const isTrackBroken = useCallback((trackId: string) => {
    const expiresAt = brokenTrackIdsRef.current.get(trackId);
    if (!expiresAt) {
      return false;
    }
    if (Date.now() > expiresAt) {
      brokenTrackIdsRef.current.delete(trackId);
      return false;
    }
    return true;
  }, []);

  const markTrackBroken = useCallback((trackId: string) => {
    brokenTrackIdsRef.current.set(trackId, Date.now() + BROKEN_TRACK_TTL_MS);
  }, []);

  const setQuality = useCallback((newQuality: AudioQuality) => {
    setQualityState(newQuality);
    void writePersistentValue(QUALITY_STORAGE_KEY, newQuality);
  }, []);

  const clearSleepTimerHandles = useCallback(() => {
    if (sleepTimerTimeoutRef.current) {
      clearTimeout(sleepTimerTimeoutRef.current);
      sleepTimerTimeoutRef.current = null;
    }
    if (sleepTimerIntervalRef.current) {
      clearInterval(sleepTimerIntervalRef.current);
      sleepTimerIntervalRef.current = null;
    }
  }, []);

  // Get stream URL with in-flight de-duplication
  const getStreamUrlForTrack = useCallback(
    async (
      track: Track,
      currentQuality: AudioQuality
    ): Promise<string | null> => {
      const trackIdStr = String(track.id);
      const trackId = Number(track.id);
      const cacheKey = `${trackIdStr}:${currentQuality}`;

      const existingInFlight = streamUrlInFlightRef.current.get(cacheKey);
      if (existingInFlight) {
        return await existingInFlight;
      }

      // Check saved tracks
      const savedTrack =
        recentlyPlayed.find((t) => String(t.id) === trackIdStr) ||
        favorites.find((t) => String(t.id) === trackIdStr);

      if (savedTrack?.streamUrl) {
        if (Platform.OS === "web" && savedTrack.streamUrl.startsWith("blob:")) {
          return track.url || null;
        }

        if (!isOffline && Number.isFinite(trackId)) {
          const forbidden = await isWebStreamUrlForbidden(savedTrack.streamUrl);
          if (!forbidden) {
            return savedTrack.streamUrl;
          }
        } else {
          return savedTrack.streamUrl;
        }
      }

      if (isOffline) {
        try {
          const cachedUrl = await audioCacheService.findCachedUrlByTrackId(
            trackIdStr
          );
          if (cachedUrl) {
            return cachedUrl;
          }
        } catch {}
      }

      const job = (async () => {
        if (!isOffline && Number.isFinite(trackId)) {
          try {
            const url = await losslessAPI.getStreamUrl(trackId, currentQuality);
            if (url) return url;
          } catch {}
        }
        return track.url || null;
      })();

      streamUrlInFlightRef.current.set(cacheKey, job);
      try {
        return await job;
      } finally {
        streamUrlInFlightRef.current.delete(cacheKey);
      }
    },
    [recentlyPlayed, favorites, isOffline, isWebStreamUrlForbidden]
  );

  // ==================== Player Control - SINGLE PLAYER PATTERN ====================

  // Save position helper
  const savePosition = useCallback(
    (trackId: string, position: number) => {
      setSavedPositions((prev) => {
        const newPositions = { ...prev, [trackId]: position };
        // Limit to 100 items
        const keys = Object.keys(newPositions);
        if (keys.length > 100) {
          delete newPositions[keys[0]];
        }
        return newPositions;
      });
    },
    [setSavedPositions]
  );

  /**
   * CRITICAL: Destroys ALL audio players to ensure single-player mode
   * Must be called before creating any new player
   */
  const destroyAllPlayers = useCallback(() => {
    // Save current position before destroying
    if (activePlayerRef.current && currentTrack) {
      savePosition(
        String(currentTrack.id),
        activePlayerRef.current.currentTime
      );
    }

    // Destroy active player
    if (activePlayerRef.current) {
      try {
        activePlayerRef.current.pause();
        activePlayerRef.current.remove();
      } catch (e) {
        console.warn("Error removing active player:", e);
      }
      activePlayerRef.current = null;
    }

    const urlToRevoke = currentStreamUrlRef.current;
    if (Platform.OS === "web" && urlToRevoke?.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(urlToRevoke);
      } catch {}
    }
    currentStreamUrlRef.current = null;
    currentBaseStreamUrlRef.current = null;

    // Destroy pre-buffered player
    if (preBufferedPlayerRef.current) {
      const bufferedUrl = preBufferedPlayerRef.current.url;
      try {
        preBufferedPlayerRef.current.player.pause();
        preBufferedPlayerRef.current.player.remove();
      } catch (e) {
        console.warn("Error removing pre-buffered player:", e);
      }
      if (Platform.OS === "web" && bufferedUrl?.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(bufferedUrl);
        } catch {}
      }
      preBufferedPlayerRef.current = null;
    }

    setPlayer(null);
    setNextTrackBufferStatus("none");
  }, [currentTrack, savePosition]);

  // Add to recently played
  const addToRecentlyPlayed = useCallback((track: Track, streamUrl: string) => {
    setRecentlyPlayed((prev) => {
      const existingIndex = prev.findIndex(
        (t) => String(t.id) === String(track.id)
      );
      const newTrack: SavedTrack = {
        id: String(track.id),
        title: track.title,
        artist: track.artist,
        artwork: track.artwork,
        streamUrl: streamUrl,
        addedAt: Date.now(),
      };

      let newHistory: SavedTrack[];
      if (existingIndex !== -1) {
        newHistory = [newTrack, ...prev.filter((_, i) => i !== existingIndex)];
      } else {
        newHistory = [newTrack, ...prev];
      }

      newHistory = newHistory.slice(0, 50);

      void writePersistentValue(
        RECENTLY_PLAYED_STORAGE_KEY,
        JSON.stringify(newHistory)
      );
      return newHistory;
    });
  }, []);

  /**
   * Core play function - handles single track playback with mutex lock
   * @param track - Track to play
   * @param usePreBuffered - Whether to check pre-buffered player first
   * @param skipRecentlyPlayed - Skip adding to recently played (for playing from recently played list)
   */
  const playSoundInternal = useCallback(
    async (
      track: Track,
      usePreBuffered = true,
      skipRecentlyPlayed = false
    ): Promise<boolean> => {
      // Mutex lock - prevent concurrent play operations
      if (playLockRef.current) {
        console.log("[Player] Play operation already in progress, skipping");
        return false;
      }

      playLockRef.current = true;
      const trackIdStr = String(track.id);
      setLoadingTrackId(trackIdStr);

      try {
        let allowPreBuffered = usePreBuffered;

        const trackId = Number(track.id);
        const trackIdStr = String(track.id);
        const preferredQuality: AudioQuality =
          quality === "HI_RES_LOSSLESS" ? "LOSSLESS" : quality;

        const qualityCandidates: AudioQuality[] =
          Platform.OS === "web"
            ? Array.from(new Set([preferredQuality, "HIGH", "LOW"]))
            : [preferredQuality];
        const attemptQualities = qualityCandidates.slice(
          0,
          Math.min(3, qualityCandidates.length)
        );

        const trackMetadata = {
          id: String(track.id),
          title: track.title,
          artist: track.artist,
          artwork: track.artwork,
          durationSec: track.duration,
        };

        const savedPosSec = savedPositions[trackIdStr];
        const startPositionSec =
          typeof savedPosSec === "number" && Number.isFinite(savedPosSec)
            ? Math.max(0, savedPosSec)
            : 0;

        const offlineWeb = Platform.OS === "web" && isOffline;

        for (
          let attemptIndex = 0;
          attemptIndex < attemptQualities.length;
          attemptIndex += 1
        ) {
          const attemptQuality: AudioQuality =
            attemptQualities[attemptIndex] ?? preferredQuality;
          if (offlineWeb && attemptIndex > 0) break;
          if (
            allowPreBuffered &&
            preBufferedPlayerRef.current?.trackId === trackIdStr &&
            preBufferedPlayerRef.current?.quality === attemptQuality
          ) {
            console.log("[Player] Using pre-buffered player for:", track.title);
            const { player: bufferedPlayer, url } =
              preBufferedPlayerRef.current;
            const baseUrl = preBufferedPlayerRef.current.baseUrl;
            preBufferedPlayerRef.current = null;

            try {
              destroyAllPlayers();
            } catch {}

            bufferedPlayer.volume = volume;
            let playError: unknown = null;
            try {
              const playResult = (bufferedPlayer as any).play?.();
              if (playResult && typeof playResult.then === "function") {
                await playResult.catch((e: unknown) => {
                  playError = e;
                });
              }
            } catch (e) {
              playError = e;
            }

            const startResult = playError
              ? {
                  ok: false as const,
                  reason: isNotSupportedPlaybackError(playError)
                    ? ("not_supported" as const)
                    : ("error" as const),
                }
              : await waitForPlaybackStart(bufferedPlayer, 15000);
            if (startResult.ok) {
              activePlayerRef.current = bufferedPlayer;
              setPlayer(bufferedPlayer);
              setCurrentStreamUrl(url);
              currentBaseStreamUrlRef.current = baseUrl || null;
              setLoadingTrackId(null);
              consecutiveFailuresRef.current = 0;
              setNextTrackBufferStatus("none");
              if (!skipRecentlyPlayed) {
                void addToRecentlyPlayed(track, baseUrl || url);
              }
              return true;
            }

            try {
              bufferedPlayer.pause();
              bufferedPlayer.remove();
            } catch {}

            if (startResult.reason === "not_supported") {
              if (url.startsWith("blob:")) {
                try {
                  URL.revokeObjectURL(url);
                } catch {}
              }
              await clearWebCachesForUrl(baseUrl || url);
            } else if (!offlineWeb && Platform.OS === "web") {
              await clearWebCachesForUrl(baseUrl || url);
            }

            allowPreBuffered = false;
          }

          let refreshedForbidden = false;

          while (true) {
            destroyAllPlayers();

            let baseStreamUrl: string | null = null;

            if (offlineWeb) {
              baseStreamUrl =
                cachedUrlByTrackIdRef.current.get(trackIdStr) ?? null;
              if (!baseStreamUrl) {
                const fromLibrary =
                  recentlyPlayed.find((t) => String(t.id) === trackIdStr)
                    ?.streamUrl ||
                  favorites.find((t) => String(t.id) === trackIdStr)?.streamUrl;
                baseStreamUrl = fromLibrary || null;
              }
              if (!baseStreamUrl) {
                baseStreamUrl = await audioCacheService.findCachedUrlByTrackId(
                  trackIdStr
                );
              }
              if (!baseStreamUrl) {
                return false;
              }

              const cached = await audioCacheService.isCached(baseStreamUrl);
              if (!cached) {
                return false;
              }
            } else {
              const forceRefresh = attemptIndex > 0 || refreshedForbidden;
              if (!forceRefresh) {
                baseStreamUrl = await getStreamUrlForTrack(
                  track,
                  attemptQuality
                );
              } else if (!isOffline && Number.isFinite(trackId)) {
                try {
                  baseStreamUrl = await losslessAPI.getStreamUrl(
                    trackId,
                    attemptQuality
                  );
                } catch {
                  baseStreamUrl = null;
                }
              } else {
                baseStreamUrl = await getStreamUrlForTrack(
                  track,
                  attemptQuality
                );
              }
            }
            if (!baseStreamUrl) {
              console.warn(`[Player] No stream URL for track ${track.id}`);
              return false;
            }

            let streamUrl = baseStreamUrl;
            try {
              streamUrl = await audioCacheService.resolveUrl(
                baseStreamUrl,
                trackMetadata
              );
            } catch (e) {
              console.warn(
                "[Player] Cache resolution failed, using original URL:",
                e
              );
              streamUrl = baseStreamUrl;
            }

            if (
              Platform.OS === "web" &&
              streamUrl !== baseStreamUrl &&
              streamUrl.includes("/__hififlow_audio_stream")
            ) {
              const ok = await canLoadWebProxyUrl(streamUrl);
              if (!ok) {
                console.warn(
                  "[Player] Proxy stream failed preflight, using direct URL"
                );
                streamUrl = baseStreamUrl;
              }
            }

            if (Platform.OS === "web" && streamUrl.startsWith("blob:")) {
              try {
                const response = await fetch(streamUrl);
                if (!response.ok) {
                  throw new Error("Blob URL inaccessible");
                }
              } catch {
                streamUrl = baseStreamUrl;
              }
            }

            if (Platform.OS === "web" && !offlineWeb) {
              const contentType = await getWebContentType(streamUrl);
              if (contentType && !canPlayWebContentType(contentType)) {
                console.warn(
                  "[Player] Browser cannot play content-type, trying next quality:",
                  contentType
                );
                if (streamUrl.startsWith("blob:")) {
                  try {
                    URL.revokeObjectURL(streamUrl);
                  } catch {}
                }
                await clearWebCachesForUrl(baseStreamUrl);
                if (attemptIndex < attemptQualities.length - 1) {
                  await new Promise((r) => setTimeout(r, 100));
                  break;
                }
                return false;
              }
            }

            console.log("[Player] Creating new player for:", track.title);
            const newPlayer = createAudioPlayer(streamUrl, {
              downloadFirst: false,
              updateInterval: 250,
            });

            const savedPos = savedPositions[trackIdStr];
            if (savedPos && savedPos > 5) {
              try {
                const seekResult = (newPlayer as any).seekTo?.(savedPos);
                if (seekResult && typeof seekResult.then === "function") {
                  void seekResult.catch((e: unknown) => {
                    console.warn("[Player] Restore seek failed", e);
                  });
                }
              } catch (e) {
                console.warn("[Player] Restore seek threw", e);
              }
            }

            newPlayer.volume = volume;
            let playError: unknown = null;
            try {
              const playResult = (newPlayer as any).play?.();
              if (playResult && typeof playResult.then === "function") {
                await playResult.catch((e: unknown) => {
                  playError = e;
                });
              }
            } catch (e) {
              playError = e;
            }

            const startResult = playError
              ? {
                  ok: false as const,
                  reason: isNotSupportedPlaybackError(playError)
                    ? ("not_supported" as const)
                    : ("error" as const),
                }
              : await waitForPlaybackStart(newPlayer, 15000);
            if (startResult.ok) {
              activePlayerRef.current = newPlayer;
              setPlayer(newPlayer);
              setCurrentStreamUrl(streamUrl);
              currentBaseStreamUrlRef.current = baseStreamUrl;
              consecutiveFailuresRef.current = 0;
              if (!skipRecentlyPlayed) {
                void addToRecentlyPlayed(track, baseStreamUrl);
              }
              return true;
            }

            try {
              newPlayer.pause();
              newPlayer.remove();
            } catch {}

            if (
              !refreshedForbidden &&
              !offlineWeb &&
              Platform.OS === "web" &&
              Number.isFinite(trackId) &&
              startResult.reason === "error"
            ) {
              const forbidden = await isWebStreamUrlForbidden(baseStreamUrl);
              if (forbidden) {
                const cacheKey = `${trackIdStr}:${attemptQuality}`;
                streamUrlInFlightRef.current.delete(cacheKey);
                refreshedForbidden = true;
                await new Promise((r) => setTimeout(r, 100));
                continue;
              }
            }

            if (startResult.reason === "not_supported") {
              if (streamUrl.startsWith("blob:")) {
                try {
                  URL.revokeObjectURL(streamUrl);
                } catch {}
              }
              await clearWebCachesForUrl(baseStreamUrl);
              if (
                Platform.OS === "web" &&
                (quality === "LOSSLESS" || quality === "HI_RES_LOSSLESS") &&
                attemptQuality === preferredQuality &&
                (attemptQualities.includes("HIGH") ||
                  attemptQualities.includes("LOW"))
              ) {
                showToast({
                  message:
                    "Stream format not supported, trying lower quality…",
                  type: "error",
                });
              }
            } else if (
              !offlineWeb &&
              Platform.OS === "web" &&
              attemptIndex === 0
            ) {
              await clearWebCachesForUrl(baseStreamUrl);
            }

            break;
          }

          if (attemptIndex < attemptQualities.length - 1) {
            await new Promise((r) =>
              setTimeout(r, refreshedForbidden ? 100 : 250)
            );
          }
        }

        return false;
      } catch (error) {
        console.error("[Player] Playback failed:", error);
        return false;
      } finally {
        setLoadingTrackId(null);
        playLockRef.current = false;
      }
    },
    [
      volume,
      quality,
      getStreamUrlForTrack,
      destroyAllPlayers,
      addToRecentlyPlayed,
      savedPositions,
      waitForPlaybackStart,
      isNotSupportedPlaybackError,
      canLoadWebProxyUrl,
      getWebContentType,
      canPlayWebContentType,
      clearWebCachesForUrl,
      showToast,
      recentlyPlayed,
      favorites,
      isOffline,
    ]
  );

  // ==================== Pre-buffering Logic ====================

  /**
   * Pre-buffer the next track in queue for instant playback
   * Called after current track starts playing
   */
  const preBufferNextTrack = useCallback(async () => {
    if (queue.length === 0) return;

    // Find current index
    const currentIndex = currentTrack
      ? queue.findIndex((t) => String(t.id) === String(currentTrack.id))
      : -1;

    if (currentIndex === -1) return;

    let nextIndex: number;
    if (shuffleEnabled) {
      // For shuffle, pick a random unplayed track
      const available: number[] = [];
      for (let i = 0; i < queue.length; i++) {
        if (i !== currentIndex && !shuffleHistoryRef.current.includes(i)) {
          available.push(i);
        }
      }
      if (available.length === 0) {
        if (repeatMode === "all") {
          shuffleHistoryRef.current = [];
          nextIndex = Math.floor(Math.random() * queue.length);
        } else {
          return; // No next track
        }
      } else {
        nextIndex = available[Math.floor(Math.random() * available.length)];
      }
    } else {
      // Sequential
      if (currentIndex >= queue.length - 1) {
        if (repeatMode === "all") {
          nextIndex = 0;
        } else {
          return; // End of queue
        }
      } else {
        nextIndex = currentIndex + 1;
      }
    }

    if (queue.length > 1) {
      for (let guard = 0; guard < queue.length; guard += 1) {
        const candidate = queue[nextIndex];
        if (!candidate) {
          break;
        }
        if (!isTrackBroken(String(candidate.id))) {
          break;
        }

        nextIndex = (nextIndex + 1) % queue.length;
        if (nextIndex === currentIndex) {
          return;
        }
      }
    }

    const nextTrack = queue[nextIndex];
    if (!nextTrack) return;

    const nextTrackIdStr = String(nextTrack.id);

    // Skip if already pre-buffered
    if (preBufferedPlayerRef.current?.trackId === nextTrackIdStr) {
      return;
    }

    setNextTrackBufferStatus("buffering");

    try {
      const effectiveQuality =
        quality === "HI_RES_LOSSLESS" ? "LOSSLESS" : quality;
      const baseStreamUrl = await getStreamUrlForTrack(
        nextTrack,
        effectiveQuality
      );
      if (!baseStreamUrl) {
        console.warn("[PreBuffer] No stream URL for next track");
        setNextTrackBufferStatus("failed");
        return;
      }

      let streamUrl = baseStreamUrl;

      // Resolve through cache
      streamUrl = await audioCacheService.resolveUrl(streamUrl, {
        id: String(nextTrack.id),
        title: nextTrack.title,
        artist: nextTrack.artist,
        artwork: nextTrack.artwork,
        durationSec: nextTrack.duration,
      });

      // Clean up ANY existing pre-buffered player (including from race conditions)
      if (preBufferedPlayerRef.current) {
        const oldUrl = preBufferedPlayerRef.current.url;
        try {
          preBufferedPlayerRef.current.player.pause();
          preBufferedPlayerRef.current.player.remove();
        } catch (e) {
          console.warn("Error removing pre-buffered player:", e);
        }
        if (Platform.OS === "web" && oldUrl?.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(oldUrl);
          } catch {}
        }
        preBufferedPlayerRef.current = null;
      }

      // Create player but don't play
      console.log("[PreBuffer] Pre-buffering:", nextTrack.title);
      const bufferedPlayer = createAudioPlayer(streamUrl, {
        downloadFirst: false,
        updateInterval: 250,
      });

      preBufferedPlayerRef.current = {
        player: bufferedPlayer,
        trackId: nextTrackIdStr,
        quality: effectiveQuality,
        url: streamUrl,
        baseUrl: baseStreamUrl,
      };

      setNextTrackBufferStatus("ready");
    } catch (error) {
      console.error("[PreBuffer] Failed to pre-buffer:", error);
      setNextTrackBufferStatus("failed");
    }
  }, [
    queue,
    currentTrack,
    shuffleEnabled,
    repeatMode,
    quality,
    getStreamUrlForTrack,
    isTrackBroken,
  ]);

  // ==================== Queue Navigation ====================

  const playNext = useCallback(async () => {
    if (queue.length === 0) return;

    if (playLockRef.current) {
      return;
    }

    const currentIndex = currentTrack
      ? queue.findIndex((t) => String(t.id) === String(currentTrack.id))
      : -1;

    if (repeatMode === "one" && currentIndex !== -1) {
      if (activePlayerRef.current) {
        activePlayerRef.current.seekTo(0);

        let playError: unknown = null;
        try {
          const playResult = (activePlayerRef.current as any).play?.();
          if (playResult && typeof playResult.then === "function") {
            await playResult.catch((e: unknown) => {
              playError = e;
            });
          }
        } catch (e) {
          playError = e;
        }

        if (!playError) {
          return;
        }
      }

      const repeatTrack = queue[currentIndex];
      if (!repeatTrack) return;

      const success = await playSoundInternal(repeatTrack, false, true);
      if (success) {
        return;
      }

      markTrackBroken(String(repeatTrack.id));

      if (queue.length <= 1) {
        return;
      }

      let nextIndex = (currentIndex + 1) % queue.length;
      for (let scan = 0; scan < queue.length; scan += 1) {
        const candidate = queue[nextIndex];
        if (!candidate) {
          return;
        }
        if (!isTrackBroken(String(candidate.id))) {
          break;
        }
        nextIndex = (nextIndex + 1) % queue.length;
        if (nextIndex === currentIndex) {
          return;
        }
      }

      const nextTrack = queue[nextIndex];
      if (!nextTrack) {
        return;
      }

      queueIndexRef.current = nextIndex;
      setCurrentTrack(nextTrack);
      setAudioAnalysis(null);
      await playSoundInternal(nextTrack, true);
      return;
    }

    let resolvedCurrentIndex = currentIndex;
    if (resolvedCurrentIndex === -1) {
      const queuedIndex = queueIndexRef.current;
      if (queuedIndex >= 0 && queuedIndex < queue.length) {
        resolvedCurrentIndex = queuedIndex;
      }
    }

    const maxAttempts = Math.max(1, queue.length);

    for (let guard = 0; guard < maxAttempts; guard += 1) {
      let nextIndex: number;

      if (shuffleEnabled) {
        // Shuffle mode
        const available: number[] = [];
        for (let i = 0; i < queue.length; i++) {
          if (
            i !== resolvedCurrentIndex &&
            !shuffleHistoryRef.current.includes(i) &&
            !isTrackBroken(String(queue[i]?.id))
          ) {
            available.push(i);
          }
        }

        if (available.length === 0) {
          if (repeatMode === "all") {
            shuffleHistoryRef.current = [];
            nextIndex = Math.floor(Math.random() * queue.length);
          } else {
            // End of queue
            return;
          }
        } else {
          nextIndex = available[Math.floor(Math.random() * available.length)];
        }
        shuffleHistoryRef.current.push(nextIndex);
      } else {
        // Sequential mode
        if (resolvedCurrentIndex >= queue.length - 1) {
          if (repeatMode === "all") {
            nextIndex = 0;
          } else {
            return; // End of queue
          }
        } else {
          nextIndex = Math.max(0, resolvedCurrentIndex + 1);
        }

        for (let scan = 0; scan < queue.length; scan += 1) {
          const candidate = queue[nextIndex];
          if (!candidate) {
            return;
          }
          if (!isTrackBroken(String(candidate.id))) {
            break;
          }
          nextIndex = (nextIndex + 1) % queue.length;
          if (nextIndex === resolvedCurrentIndex) {
            return;
          }
        }
      }

      const nextTrack = queue[nextIndex];
      if (!nextTrack) return;

      queueIndexRef.current = nextIndex;
      setCurrentTrack(nextTrack);
      setAudioAnalysis(null);

      const success = await playSoundInternal(nextTrack, true);

      if (!success) {
        markTrackBroken(String(nextTrack.id));
        consecutiveFailuresRef.current++;
        if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
          showToast({
            message: "Too many playback errors, stopping.",
            type: "error",
          });
          consecutiveFailuresRef.current = 0;
          return;
        }
        showToast({ message: "Playback failed, skipping...", type: "info" });
        await new Promise((r) => setTimeout(r, 300));
        resolvedCurrentIndex = nextIndex;
        continue;
      }

      return;
    }
  }, [
    queue,
    currentTrack,
    shuffleEnabled,
    repeatMode,
    playSoundInternal,
    showToast,
    isTrackBroken,
    markTrackBroken,
  ]);

  // Update ref
  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  const playPrevious = useCallback(async () => {
    if (queue.length === 0) return;

    const currentIndex = currentTrack
      ? queue.findIndex((t) => String(t.id) === String(currentTrack.id))
      : -1;

    // If more than 3 seconds played, restart current track
    if (positionMillis > 3000 && activePlayerRef.current) {
      activePlayerRef.current.seekTo(0);
      return;
    }

    let prevIndex: number;
    if (shuffleEnabled) {
      // Pop from shuffle history
      if (shuffleHistoryRef.current.length > 0) {
        prevIndex = shuffleHistoryRef.current.pop()!;
      } else {
        return;
      }
    } else {
      if (currentIndex > 0) {
        prevIndex = currentIndex - 1;
      } else if (repeatMode === "all") {
        prevIndex = queue.length - 1;
      } else {
        return;
      }
    }

    const prevTrack = queue[prevIndex];
    if (!prevTrack) return;

    queueIndexRef.current = prevIndex;
    setCurrentTrack(prevTrack);
    setAudioAnalysis(null);

    await playSoundInternal(prevTrack, true);
  }, [
    queue,
    currentTrack,
    shuffleEnabled,
    repeatMode,
    positionMillis,
    playSoundInternal,
  ]);

  // ==================== Public API ====================

  const playTrack = useCallback(
    async (
      track: Track,
      options?: {
        skipRecentlyPlayed?: boolean;
        queueType?: QueueType;
        replaceQueue?: boolean;
      }
    ) => {
      const skipRecentlyPlayed = options?.skipRecentlyPlayed ?? false;
      const queueType: QueueType =
        options?.queueType ??
        (isPodcastTrackId(track.id) ? "podcast" : "music");
      const replaceQueue = options?.replaceQueue ?? false;

      if (playLockRef.current) {
        return;
      }

      setActiveQueueType(queueType);
      setLoadingTrackId(String(track.id));

      const targetQueueIndexRef =
        queueType === "podcast" ? podcastQueueIndexRef : musicQueueIndexRef;

      // Add track to queue (append, don't replace)
      setQueueForType(queueType, (prev) => {
        if (replaceQueue) {
          targetQueueIndexRef.current = 0;
          return [track];
        }
        // Check if track already exists in queue
        const existingIndex = prev.findIndex(
          (t) => String(t.id) === String(track.id)
        );
        if (existingIndex !== -1) {
          // Track exists, just update index
          targetQueueIndexRef.current = existingIndex;
          return prev;
        }
        // Append new track
        targetQueueIndexRef.current = prev.length;
        const newQueue = [...prev, track];
        // Limit to MAX_QUEUE_SIZE (keep newest)
        if (newQueue.length > MAX_QUEUE_SIZE) {
          const trimAmount = newQueue.length - MAX_QUEUE_SIZE;
          targetQueueIndexRef.current = Math.max(
            0,
            targetQueueIndexRef.current - trimAmount
          );
          return newQueue.slice(trimAmount);
        }
        return newQueue;
      });
      shuffleHistoryRef.current = [];
      setCurrentTrack(track);
      setAudioAnalysis(null);

      const effectiveSkipRecentlyPlayed =
        skipRecentlyPlayed || queueType === "podcast";
      const success = await playSoundInternal(
        track,
        false,
        effectiveSkipRecentlyPlayed
      );
      if (!success) {
        markTrackBroken(String(track.id));
        consecutiveFailuresRef.current++;
        if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
          showToast({
            message: "Too many playback errors, stopping.",
            type: "error",
          });
          consecutiveFailuresRef.current = 0;
          return;
        }
        showToast({ message: "Playback failed, skipping...", type: "info" });
        await new Promise((r) => setTimeout(r, 300));
        await playNextRef.current();
      }
    },
    [
      playSoundInternal,
      setQueueForType,
      showToast,
      markTrackBroken,
      setActiveQueueType,
    ]
  );

  const playQueue = useCallback(
    async (
      tracks: Track[],
      startIndex = 0,
      options?: { queueType?: QueueType; replaceQueue?: boolean }
    ) => {
      if (playLockRef.current) {
        return;
      }

      const seedTrack = tracks[startIndex] ?? tracks[0];
      const queueType: QueueType =
        options?.queueType ??
        (seedTrack && isPodcastTrackId(seedTrack.id) ? "podcast" : "music");
      const replaceQueue = options?.replaceQueue ?? false;

      setActiveQueueType(queueType);

      const targetQueueIndexRef =
        queueType === "podcast" ? podcastQueueIndexRef : musicQueueIndexRef;

      // Append tracks to queue (don't replace)
      setQueueForType(queueType, (prev) => {
        if (replaceQueue) {
          const newQueue = tracks.slice(0, MAX_QUEUE_SIZE);
          const boundedStartIndex = Math.max(
            0,
            Math.min(startIndex, Math.max(0, newQueue.length - 1))
          );
          targetQueueIndexRef.current = boundedStartIndex;
          return newQueue;
        }
        // Filter out duplicates (tracks already in queue)
        const existingIds = new Set(prev.map((t) => String(t.id)));
        const newTracks = tracks.filter((t) => !existingIds.has(String(t.id)));

        // Find the track to play
        const targetTrack = tracks[startIndex] ?? tracks[0];
        if (!targetTrack) return prev;

        // Check if target track is already in queue
        const existingTargetIndex = prev.findIndex(
          (t) => String(t.id) === String(targetTrack.id)
        );

        if (existingTargetIndex !== -1) {
          // Track exists, just update index to play from there
          targetQueueIndexRef.current = existingTargetIndex;
          return [...prev, ...newTracks];
        }

        // Append all new tracks, set index to the start track in new portion
        let newQueue = [...prev, ...newTracks];

        // Limit to MAX_QUEUE_SIZE (keep newest)
        if (newQueue.length > MAX_QUEUE_SIZE) {
          const trimAmount = newQueue.length - MAX_QUEUE_SIZE;
          newQueue = newQueue.slice(trimAmount);
        }

        const newTargetIndex = newQueue.findIndex(
          (t) => String(t.id) === String(targetTrack.id)
        );
        targetQueueIndexRef.current =
          newTargetIndex !== -1
            ? newTargetIndex
            : Math.max(0, newQueue.length - 1);
        return newQueue;
      });

      shuffleHistoryRef.current = [];

      const startTrack = tracks[startIndex] ?? tracks[0];
      if (startTrack) {
        setLoadingTrackId(String(startTrack.id));
        setCurrentTrack(startTrack);
        setAudioAnalysis(null);
        const success = await playSoundInternal(
          startTrack,
          false,
          queueType === "podcast"
        );
        if (!success) {
          markTrackBroken(String(startTrack.id));
          consecutiveFailuresRef.current++;
          if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
            showToast({
              message: "Too many playback errors, stopping.",
              type: "error",
            });
            consecutiveFailuresRef.current = 0;
            return;
          }
          showToast({ message: "Playback failed, skipping...", type: "info" });
          await new Promise((r) => setTimeout(r, 300));
          await playNextRef.current();
        }
      }
    },
    [
      playSoundInternal,
      setQueueForType,
      showToast,
      markTrackBroken,
      setActiveQueueType,
    ]
  );

  const pauseTrack = useCallback(async () => {
    if (activePlayerRef.current) {
      if (currentTrack) {
        savePosition(
          String(currentTrack.id),
          activePlayerRef.current.currentTime
        );
      }
      activePlayerRef.current.pause();
    }
  }, [currentTrack, savePosition]);

  const resumeTrack = useCallback(async () => {
    if (playLockRef.current) {
      return;
    }

    try {
      if (activePlayerRef.current) {
        if (currentTrack) {
          setLoadingTrackId(String(currentTrack.id));
        }

        let playError: unknown = null;
        try {
          const playResult = (activePlayerRef.current as any).play?.();
          if (playResult && typeof playResult.then === "function") {
            await playResult.catch((e: unknown) => {
              playError = e;
            });
          }
        } catch (e) {
          playError = e;
        }

        if (playError) {
          console.warn("[Player] Resume play() failed:", playError);
        }

        const startResult = playError
          ? {
              ok: false as const,
              reason: isNotSupportedPlaybackError(playError)
                ? ("not_supported" as const)
                : ("error" as const),
            }
          : await waitForPlaybackStart(activePlayerRef.current, 15000);

        if (startResult.ok) {
          consecutiveFailuresRef.current = 0;
          return;
        }

        if (currentTrack) {
          if (startResult.reason === "not_supported") {
            showToast({
              message: "NotSupportedError: refreshing stream and retrying…",
              type: "error",
            });
          }
          if (startResult.reason === "not_supported") {
            const effectiveQuality =
              quality === "HI_RES_LOSSLESS" ? "LOSSLESS" : quality;
            const cacheKey = `${String(currentTrack.id)}:${effectiveQuality}`;
            streamUrlInFlightRef.current.delete(cacheKey);

            const urlToClear = currentStreamUrl;
            const baseUrlToClear = currentBaseStreamUrlRef.current;
            if (urlToClear && urlToClear.startsWith("blob:")) {
              try {
                URL.revokeObjectURL(urlToClear);
              } catch {}
            }

            const uniqueUrlsToClear = new Set<string>();
            if (baseUrlToClear) uniqueUrlsToClear.add(baseUrlToClear);
            if (urlToClear && !urlToClear.startsWith("blob:")) {
              uniqueUrlsToClear.add(urlToClear);
            }

            await Promise.all(
              Array.from(uniqueUrlsToClear).map(async (u) => {
                try {
                  await clearWebCachesForUrl(u);
                } catch {}
              })
            );
          }

          const success = await playSoundInternal(currentTrack, false);
          if (!success) {
            markTrackBroken(String(currentTrack.id));
            consecutiveFailuresRef.current++;
            if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
              showToast({
                message: "Too many playback errors, stopping.",
                type: "error",
              });
              consecutiveFailuresRef.current = 0;
              return;
            }
            showToast({
              message: "Playback failed, skipping...",
              type: "info",
            });
            await new Promise((r) => setTimeout(r, 300));
            await playNextRef.current();
          }
        }
      } else if (currentTrack) {
        await playSoundInternal(currentTrack, false);
      }
    } catch (e) {
      console.warn("[Player] Resume failed:", e);
      showToast({ message: "Playback failed", type: "error" });
    } finally {
      setLoadingTrackId(null);
    }
  }, [
    currentTrack,
    currentStreamUrl,
    playSoundInternal,
    showToast,
    waitForPlaybackStart,
    isNotSupportedPlaybackError,
    clearWebCachesForUrl,
    quality,
    markTrackBroken,
  ]);

  const seekToMillis = useCallback(async (pos: number) => {
    activePlayerRef.current?.seekTo(pos / 1000);
  }, []);

  const seekByMillis = useCallback(async (delta: number) => {
    if (activePlayerRef.current) {
      activePlayerRef.current.seekTo(
        activePlayerRef.current.currentTime + delta / 1000
      );
    }
  }, []);

  const addToQueue = useCallback(
    (track: Track): boolean => {
      let added = false;
      setQueueForType(activeQueueType, (prev) => {
        // Check if track already exists
        const exists = prev.some((t) => String(t.id) === String(track.id));
        if (exists) {
          return prev;
        }
        added = true;
        let newQueue = [...prev, track];
        // Limit to MAX_QUEUE_SIZE (keep newest)
        if (newQueue.length > MAX_QUEUE_SIZE) {
          newQueue = newQueue.slice(newQueue.length - MAX_QUEUE_SIZE);
        }
        return newQueue;
      });

      if (!added) {
        showToast({ message: "Track already in queue", type: "info" });
      } else {
        showToast({ message: "Added to queue", type: "success" });
      }
      return added;
    },
    [showToast, setQueueForType, activeQueueType]
  );

  const addTracksToQueue = useCallback(
    (tracks: Track[]): number => {
      let addedCount = 0;
      setQueueForType(activeQueueType, (prev) => {
        const existingIds = new Set(prev.map((t) => String(t.id)));
        const newTracks = tracks.filter((t) => !existingIds.has(String(t.id)));
        addedCount = newTracks.length;
        let newQueue = [...prev, ...newTracks];
        // Limit to MAX_QUEUE_SIZE (keep newest)
        if (newQueue.length > MAX_QUEUE_SIZE) {
          newQueue = newQueue.slice(newQueue.length - MAX_QUEUE_SIZE);
        }
        return newQueue;
      });

      if (addedCount === 0) {
        showToast({ message: "All tracks already in queue", type: "info" });
      } else {
        showToast({
          message: `Added ${addedCount} track${
            addedCount > 1 ? "s" : ""
          } to queue`,
          type: "success",
        });
      }
      return addedCount;
    },
    [showToast, setQueueForType, activeQueueType]
  );

  const clearQueue = useCallback(() => {
    // Stop playback and clear everything
    destroyAllPlayers();
    setQueueForType(activeQueueType, []);
    setPersistedQueueIndex(-1);
    setCurrentTrack(null);
    setCurrentStreamUrl(null);
    setAudioAnalysis(null);
    queueIndexRef.current = -1;
    shuffleHistoryRef.current = [];
    showToast({ message: "Queue cleared", type: "success" });
  }, [
    destroyAllPlayers,
    setPersistedQueueIndex,
    showToast,
    setQueueForType,
    activeQueueType,
    queueIndexRef,
  ]);

  const removeFromQueue = useCallback(
    (trackId: string) => {
      setQueueForType(activeQueueType, (prev) => {
        const index = prev.findIndex((t) => String(t.id) === String(trackId));
        if (index === -1) return prev;

        // If removing item before current, adjust ref
        if (index < queueIndexRef.current) {
          queueIndexRef.current = Math.max(0, queueIndexRef.current - 1);
        } else if (index === queueIndexRef.current) {
          // If removing current, what to do?
          // We leave queueIndexRef pointing to same numeric index (which is now the next track)
          // But effectively current track is gone.
          // playNext will re-calc index anyway.
        }

        const newQueue = [...prev];
        newQueue.splice(index, 1);
        return newQueue;
      });
      showToast({ message: "Removed from queue", type: "info" });
    },
    [showToast, setQueueForType, activeQueueType]
  );

  const unloadSound = useCallback(async () => {
    destroyAllPlayers();
    setCurrentTrack(null);
    setCurrentStreamUrl(null);
    setAudioAnalysis(null);
  }, [destroyAllPlayers]);

  // ==================== Playback Finish Handler ====================
  useEffect(() => {
    if (status?.didJustFinish) {
      if (repeatMode === "one") {
        if (activePlayerRef.current) {
          activePlayerRef.current.seekTo(0);
          try {
            const playResult = (activePlayerRef.current as any).play?.();
            if (playResult && typeof playResult.then === "function") {
              void playResult.catch((e: unknown) => {
                console.warn("[Player] Repeat play() failed", e);
              });
            }
          } catch (e) {
            console.warn("[Player] Repeat play() threw", e);
          }
        }
      } else {
        void playNextRef.current().catch((e: unknown) => {
          console.warn("[Player] Auto-advance failed", e);
        });
      }
    }
  }, [status?.didJustFinish, repeatMode]);

  // ==================== Pre-buffer Trigger ====================
  // Start pre-buffering after track has been playing for 2 seconds
  useEffect(() => {
    if (isPlaying && currentTrack && queue.length > 1) {
      const timer = setTimeout(() => {
        void preBufferNextTrack();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isPlaying, currentTrack, queue.length, preBufferNextTrack]);

  // ==================== Stuck Buffering Protection ====================
  useEffect(() => {
    // If buffering for too long (20s), consider it stuck and skip
    if (isLoading && isPlaying) {
      const timeoutMs = 20000;
      const timer = setTimeout(() => {
        console.warn(
          `[Player] Stuck buffering for ${timeoutMs}ms, skipping to next track...`
        );
        showToast({
          message: "Network slow, skipping track...",
          type: "info",
        });
        // We use playNextRef to access the latest playNext closure
        void playNextRef.current().catch((e: unknown) => {
          console.warn("[Player] Stuck buffering skip failed", e);
        });
      }, timeoutMs);
      return () => clearTimeout(timer);
    }
  }, [isLoading, isPlaying, showToast]);

  // ==================== Cache Cleanup ====================
  useEffect(() => {
    return;
  }, []);

  // ==================== Media Session Integration ====================
  // Update media session player reference for native lock screen controls
  useEffect(() => {
    mediaSessionService.setPlayer(player);
  }, [player]);

  useEffect(() => {
    mediaSessionService.setHandlers({
      onPlay: () =>
        void resumeTrack().catch((e: unknown) => {
          console.warn("[Player] MediaSession play failed", e);
        }),
      onPause: () =>
        void pauseTrack().catch((e: unknown) => {
          console.warn("[Player] MediaSession pause failed", e);
        }),
      onStop: () => {
        void pauseTrack().catch((e: unknown) => {
          console.warn("[Player] MediaSession pause failed", e);
        });
        activePlayerRef.current?.seekTo(0);
      },
      onNextTrack: () =>
        void playNextRef.current().catch((e: unknown) => {
          console.warn("[Player] MediaSession next failed", e);
        }),
      onPreviousTrack: () =>
        void playPrevious().catch((e: unknown) => {
          console.warn("[Player] MediaSession previous failed", e);
        }),
      onSeekTo: (positionMs) =>
        activePlayerRef.current?.seekTo(positionMs / 1000),
      onSeekForward: (offsetMs) => {
        if (activePlayerRef.current) {
          activePlayerRef.current.seekTo(
            activePlayerRef.current.currentTime + offsetMs / 1000
          );
        }
      },
      onSeekBackward: (offsetMs) => {
        if (activePlayerRef.current) {
          activePlayerRef.current.seekTo(
            Math.max(0, activePlayerRef.current.currentTime - offsetMs / 1000)
          );
        }
      },
    });
  }, [pauseTrack, playPrevious, resumeTrack]);

  // Update media session track metadata
  useEffect(() => {
    if (currentTrack) {
      mediaSessionService.updateTrack({
        id: String(currentTrack.id),
        title: currentTrack.title,
        artist: currentTrack.artist,
        artwork: currentTrack.artwork,
        duration: currentTrack.duration,
      });
    } else {
      mediaSessionService.clear();
    }
  }, [currentTrack]);

  // Update media session playback state
  useEffect(() => {
    mediaSessionService.updatePlaybackState({
      isPlaying,
      positionMs: positionMillis,
      durationMs: durationMillis,
      playbackRate: 1.0,
    });
  }, [isPlaying, positionMillis, durationMillis]);

  // ==================== Persistence ====================
  useEffect(() => {
    readPersistentValue(QUALITY_STORAGE_KEY).then(
      (val) => val && setQualityState(val as AudioQuality)
    );
    readPersistentValue(SHUFFLE_STORAGE_KEY).then(
      (val) => val && setShuffleEnabled(val === "true")
    );
    readPersistentValue(REPEAT_STORAGE_KEY).then(
      (val) => val && setRepeatMode(val as RepeatMode)
    );
    readPersistentValue(VOLUME_STORAGE_KEY).then(
      (val) => val && setVolumeState(parseFloat(val))
    );
    readPersistentValue(FAVORITES_STORAGE_KEY).then((val) => {
      if (!val) return;
      try {
        const parsed = JSON.parse(val) as SavedTrack[];
        const sanitized =
          Platform.OS === "web"
            ? parsed.map((t) => ({
                ...t,
                streamUrl:
                  t.streamUrl && t.streamUrl.startsWith("blob:")
                    ? null
                    : t.streamUrl,
              }))
            : parsed;
        setFavorites(sanitized);
        prevFavoriteIdsRef.current = new Set(
          sanitized.map((t) => normalizeFavoriteId(t.id))
        );
      } catch {}
    });
    readPersistentValue(RECENTLY_PLAYED_STORAGE_KEY).then((val) => {
      if (!val) return;
      try {
        const parsed = JSON.parse(val) as SavedTrack[];
        const sanitized =
          Platform.OS === "web"
            ? parsed.map((t) => ({
                ...t,
                streamUrl:
                  t.streamUrl && t.streamUrl.startsWith("blob:")
                    ? null
                    : t.streamUrl,
              }))
            : parsed;
        setRecentlyPlayed(sanitized);
      } catch {}
    });
  }, []);

  useEffect(() => {
    audioCacheService.getAllCachedTracks().then((tracks) => {
      const ids = new Set(tracks.map((t) => String(t.metadata?.id || t.url)));
      const byId = new Map<string, string>();
      tracks.forEach((t) => {
        ids.add(t.url);
        const id = t.metadata?.id ? String(t.metadata.id) : null;
        if (id) {
          byId.set(id, t.url);
        }
      });
      cachedUrlByTrackIdRef.current = byId;
      setCachedTrackIds(ids);
    });

    const unsubscribe = audioCacheService.addListener((url) => {
      setCachedTrackIds((prev) => {
        const next = new Set(prev);
        next.add(url);
        return next;
      });

      if (Platform.OS === "web") {
        audioCacheService.getCachedMeta(url).then((meta) => {
          const id = meta?.metadata?.id ? String(meta.metadata.id) : null;
          if (id && meta?.url) {
            cachedUrlByTrackIdRef.current.set(id, String(meta.url));
          }
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // ==================== Audio Analysis ====================
  const analyzeTrack = useCallback(async (uri: string) => {
    setIsAnalyzing(true);
    try {
      const result = await extractAudioAnalysis({
        fileUri: uri,
        segmentDurationMs: 100,
        features: { rms: true, energy: true, spectralCentroid: true },
      });
      setAudioAnalysis(result);
    } catch (e) {
      console.error("Analysis failed", e);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  useEffect(() => {
    if (isPlaying && currentStreamUrl && !audioAnalysis && !isAnalyzing) {
      const timer = setTimeout(() => void analyzeTrack(currentStreamUrl), 500);
      return () => clearTimeout(timer);
    }
  }, [isPlaying, currentStreamUrl, audioAnalysis, isAnalyzing, analyzeTrack]);

  // ==================== Volume Control ====================
  const setVolume = useCallback(async (val: number) => {
    const v = Math.max(0, Math.min(1, val));
    setVolumeState(v);
    if (activePlayerRef.current) activePlayerRef.current.volume = v;
    void writePersistentValue(VOLUME_STORAGE_KEY, String(v));
  }, []);

  // ==================== Shuffle & Repeat ====================
  const toggleShuffle = useCallback(() => {
    setShuffleEnabled((prev) => {
      const next = !prev;
      void writePersistentValue(SHUFFLE_STORAGE_KEY, String(next));
      if (!next) {
        shuffleHistoryRef.current = [];
      }
      return next;
    });
  }, []);

  const shuffleQueue = useCallback(() => {
    setQueueForType(activeQueueType, (prev) => {
      if (prev.length <= 1) return prev;

      const newQueue = [...prev];
      const currentTrackId = currentTrack ? String(currentTrack.id) : null;

      // Fisher-Yates shuffle
      for (let i = newQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newQueue[i], newQueue[j]] = [newQueue[j], newQueue[i]];
      }

      // Update index to match where the current track moved
      if (currentTrackId) {
        const newIndex = newQueue.findIndex(
          (t) => String(t.id) === currentTrackId
        );
        if (newIndex !== -1) {
          queueIndexRef.current = newIndex;
          setPersistedQueueIndex(newIndex);
        }
      }

      return newQueue;
    });

    shuffleHistoryRef.current = [];
    showToast({ message: "Queue shuffled", type: "info" });
  }, [
    activeQueueType,
    currentTrack,
    setPersistedQueueIndex,
    setQueueForType,
    showToast,
  ]);

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((prev) => {
      const next = prev === "off" ? "all" : prev === "all" ? "one" : "off";
      void writePersistentValue(REPEAT_STORAGE_KEY, next);
      return next;
    });
  }, []);

  // ==================== Favorites ====================
  const toggleCurrentFavorite = useCallback(
    async (artwork?: string) => {
      if (!currentTrack || !currentStreamUrl) return;
      const id = normalizeFavoriteId(currentTrack.id);
      const exists = favorites.some((f) => normalizeFavoriteId(f.id) === id);
      let next: SavedTrack[];
      if (exists) {
        next = favorites.filter((f) => normalizeFavoriteId(f.id) !== id);
        showToast({ message: "Removed from favorites", type: "info" });
      } else {
        const persistUrl =
          Platform.OS === "web" && currentStreamUrl.startsWith("blob:")
            ? currentBaseStreamUrlRef.current
            : currentStreamUrl;
        next = [
          {
            id: String(currentTrack.id),
            title: currentTrack.title,
            artist: currentTrack.artist,
            artwork: artwork || currentTrack.artwork,
            streamUrl: persistUrl || null,
            addedAt: Date.now(),
          },
          ...favorites,
        ];
        showToast({ message: "Added to favorites", type: "success" });
      }
      setFavorites(next);
      await writePersistentValue(FAVORITES_STORAGE_KEY, JSON.stringify(next));
    },
    [currentTrack, currentStreamUrl, favorites, showToast]
  );

  const toggleFavorite = useCallback(
    async (track: Track) => {
      const id = normalizeFavoriteId(track.id);
      const exists = favorites.some((f) => normalizeFavoriteId(f.id) === id);
      let next: SavedTrack[];

      if (exists) {
        next = favorites.filter((f) => normalizeFavoriteId(f.id) !== id);
        showToast({ message: "Removed from favorites", type: "info" });
      } else {
        // Use current stream URL if it's the current track, otherwise use track.url or null
        const playingCurrent =
          currentTrack?.id === track.id && currentStreamUrl;
        const streamUrl = playingCurrent
          ? Platform.OS === "web" && currentStreamUrl.startsWith("blob:")
            ? currentBaseStreamUrlRef.current || track.url || null
            : currentStreamUrl
          : track.url || null;

        next = [
          {
            id: String(track.id),
            title: track.title,
            artist: track.artist,
            artwork: track.artwork,
            streamUrl: streamUrl,
            addedAt: Date.now(),
          },
          ...favorites,
        ];
        showToast({ message: "Added to favorites", type: "success" });
      }
      setFavorites(next);
      await writePersistentValue(FAVORITES_STORAGE_KEY, JSON.stringify(next));
    },
    [favorites, currentTrack, currentStreamUrl, showToast]
  );

  const toggleTracksFavorites = useCallback(
    async (tracks: Track[]) => {
      if (tracks.length === 0) return;

      const trackIds = new Set(tracks.map((t) => normalizeFavoriteId(t.id)));
      const favoritedIds = new Set(
        favorites.map((f) => normalizeFavoriteId(f.id))
      );

      // Check if ALL tracks are already favorited
      const allAreFavorited = tracks.every((t) =>
        favoritedIds.has(normalizeFavoriteId(t.id))
      );

      let next: SavedTrack[];

      if (allAreFavorited) {
        // Remove allowed tracks
        next = favorites.filter(
          (f) => !trackIds.has(normalizeFavoriteId(f.id))
        );
        showToast({
          message: `Removed ${tracks.length} tracks from favorites`,
          type: "info",
        });
      } else {
        // Add missing tracks
        const timestamp = Date.now();
        const newEntries = tracks
          .filter((t) => !favoritedIds.has(normalizeFavoriteId(t.id)))
          .map((t) => ({
            id: String(t.id),
            title: t.title,
            artist: t.artist,
            artwork: t.artwork,
            streamUrl: t.url || null,
            addedAt: timestamp,
          }));

        next = [...newEntries, ...favorites];
        showToast({
          message: `Added ${newEntries.length} tracks to favorites`,
          type: "success",
        });
      }

      setFavorites(next);
      await writePersistentValue(FAVORITES_STORAGE_KEY, JSON.stringify(next));
    },
    [favorites, showToast]
  );

  const removeFavorite = useCallback(
    async (id: string) => {
      const next = favorites.filter(
        (f) => normalizeFavoriteId(f.id) !== normalizeFavoriteId(id)
      );
      setFavorites(next);
      await writePersistentValue(FAVORITES_STORAGE_KEY, JSON.stringify(next));
      showToast({ message: "Favorite removed", type: "info" });
    },
    [favorites, showToast]
  );

  const removeFromRecentlyPlayed = useCallback(
    async (id: string) => {
      const next = recentlyPlayed.filter((t) => String(t.id) !== String(id));
      setRecentlyPlayed(next);
      await writePersistentValue(
        RECENTLY_PLAYED_STORAGE_KEY,
        JSON.stringify(next)
      );
    },
    [recentlyPlayed]
  );

  const playSaved = useCallback(
    async (saved: SavedTrack) => {
      const track: Track = {
        id: saved.id,
        title: saved.title,
        artist: saved.artist,
        artwork: saved.artwork,
        url: saved.streamUrl || "",
      };
      // Skip adding to recently played since we're already playing from recently played
      await playTrack(track, { skipRecentlyPlayed: true });
    },
    [playTrack]
  );

  useEffect(() => {
    const currentIds = new Set(favorites.map((f) => normalizeFavoriteId(f.id)));
    const prevIds = prevFavoriteIdsRef.current;

    const added: SavedTrack[] = [];
    for (const item of favorites) {
      const id = normalizeFavoriteId(item.id);
      if (!prevIds.has(id)) {
        added.push(item);
      }
    }

    const removed: string[] = [];
    for (const prevId of prevIds) {
      if (!currentIds.has(prevId)) {
        removed.push(prevId);
      }
    }

    prevFavoriteIdsRef.current = currentIds;

    removed.forEach((id) => pendingFavoriteCacheIdsRef.current.delete(id));

    const effectiveQuality: AudioQuality =
      quality === "HI_RES_LOSSLESS" ? "LOSSLESS" : quality;

    void (async () => {
      await Promise.all(
        removed.map(async (id) => {
          try {
            const cachedUrl = await audioCacheService.findCachedUrlByTrackId(
              id
            );
            if (cachedUrl) {
              await audioCacheService.evictUrl(cachedUrl);
            }
          } catch {}
        })
      );

      if (added.length === 0) return;
      if (isOffline) {
        added.forEach((t) =>
          pendingFavoriteCacheIdsRef.current.add(normalizeFavoriteId(t.id))
        );
        return;
      }

      await Promise.all(
        added.map(async (saved) => {
          const id = normalizeFavoriteId(saved.id);
          try {
            const trackId = Number(saved.id);
            const baseUrl =
              Number.isFinite(trackId) && !isOffline
                ? await losslessAPI.getStreamUrl(trackId, effectiveQuality)
                : saved.streamUrl;
            if (!baseUrl) {
              pendingFavoriteCacheIdsRef.current.add(id);
              return;
            }
            await audioCacheService.cacheUrl(baseUrl, {
              id: String(saved.id),
              title: saved.title,
              artist: saved.artist,
              artwork: saved.artwork,
              durationSec: undefined,
            });
            pendingFavoriteCacheIdsRef.current.delete(id);
          } catch {
            pendingFavoriteCacheIdsRef.current.add(id);
            showToast({
              message: "Failed to download for offline playback",
              type: "error",
            });
          }
        })
      );
    })();
  }, [favorites, isOffline, quality, showToast]);

  useEffect(() => {
    if (isOffline) return;
    const pendingIds = Array.from(pendingFavoriteCacheIdsRef.current);
    if (pendingIds.length === 0) return;

    const byId = new Map(
      favorites.map((f) => [normalizeFavoriteId(f.id), f] as const)
    );
    const effectiveQuality: AudioQuality =
      quality === "HI_RES_LOSSLESS" ? "LOSSLESS" : quality;

    void (async () => {
      await Promise.all(
        pendingIds.map(async (id) => {
          const saved = byId.get(id);
          if (!saved) {
            pendingFavoriteCacheIdsRef.current.delete(id);
            return;
          }
          try {
            const trackId = Number(saved.id);
            if (!Number.isFinite(trackId)) return;
            const baseUrl = await losslessAPI.getStreamUrl(
              trackId,
              effectiveQuality
            );
            if (!baseUrl) return;
            await audioCacheService.cacheUrl(baseUrl, {
              id: String(saved.id),
              title: saved.title,
              artist: saved.artist,
              artwork: saved.artwork,
              durationSec: undefined,
            });
            pendingFavoriteCacheIdsRef.current.delete(id);
          } catch {}
        })
      );
    })();
  }, [favorites, isOffline, quality]);

  // ==================== Sleep Timer ====================
  const startSleepTimer = useCallback(
    (minutes: number) => {
      const ms = Math.max(0, Math.floor(minutes * 60 * 1000));
      clearSleepTimerHandles();
      if (ms <= 0) {
        setSleepTimerEndsAt(null);
        setSleepTimerRemainingMs(0);
        void writePersistentValue(SLEEP_TIMER_KEY, "");
        return;
      }

      const endsAt = Date.now() + ms;
      setSleepTimerEndsAt(endsAt);
      setSleepTimerRemainingMs(ms);
      void writePersistentValue(SLEEP_TIMER_KEY, String(endsAt));

      sleepTimerIntervalRef.current = setInterval(() => {
        const remaining = Math.max(0, endsAt - Date.now());
        setSleepTimerRemainingMs(remaining);
      }, 1000);

      sleepTimerTimeoutRef.current = setTimeout(() => {
        void pauseTrack().catch((e: unknown) => {
          console.warn("[Player] Sleep timer pause failed", e);
        });
        clearSleepTimerHandles();
        setSleepTimerEndsAt(null);
        setSleepTimerRemainingMs(0);
        void writePersistentValue(SLEEP_TIMER_KEY, "");
      }, ms);
    },
    [clearSleepTimerHandles, pauseTrack]
  );

  const cancelSleepTimer = useCallback(() => {
    clearSleepTimerHandles();
    setSleepTimerEndsAt(null);
    setSleepTimerRemainingMs(0);
    void writePersistentValue(SLEEP_TIMER_KEY, "");
  }, [clearSleepTimerHandles]);

  // ==================== Context Value ====================
  const value: PlayerContextType = {
    currentTrack,
    activeQueueType,
    isPlaying,
    isLoading,
    queue,
    quality,
    setQuality,
    shuffleEnabled,
    toggleShuffle,
    repeatMode,
    cycleRepeatMode,
    positionMillis,
    durationMillis,
    currentStreamUrl,
    audioAnalysis,
    isAnalyzing,
    sleepTimerEndsAt,
    sleepTimerRemainingMs,
    startSleepTimer,
    cancelSleepTimer,
    playTrack,
    playQueue,
    pauseTrack,
    resumeTrack,
    seekToMillis,
    seekByMillis,
    addToQueue,
    addTracksToQueue,
    removeFromQueue,
    shuffleQueue,
    clearQueue,
    playNext,
    playPrevious,
    favorites,
    recentlyPlayed,
    isCurrentFavorited: useMemo(
      () =>
        currentTrack
          ? favorites.some(
              (f) =>
                normalizeFavoriteId(f.id) ===
                normalizeFavoriteId(currentTrack.id)
            )
          : false,
      [currentTrack, favorites]
    ),
    toggleCurrentFavorite,
    toggleFavorite,
    toggleTracksFavorites,
    removeFavorite,
    removeFromRecentlyPlayed,
    playSaved,
    volume,
    setVolume,
    loadingTrackId,
    cachedTrackIds,
    nextTrackBufferStatus,
    nextTrack,
  };

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context)
    throw new Error("usePlayer must be used within a PlayerProvider");
  return context;
};
