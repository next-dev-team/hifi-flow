import {
  type AudioAnalysis,
  extractAudioAnalysis,
} from "@siteed/expo-audio-studio";
import {
  type AudioPlayer,
  type AudioStatus,
  createAudioPlayer,
} from "expo-audio";
import type { AddTrack as TrackPlayerAddTrack } from "react-native-track-player";
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
import { AppState, Platform } from "react-native";
import { useToast } from "@/contexts/toast-context";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { losslessAPI } from "@/utils/api";
import { mediaSessionService } from "@/utils/media-session";
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  RepeatMode as TrackPlayerRepeatMode,
  State as TrackPlayerState,
  usePlaybackState,
  useProgress,
  useTrackPlayerEvents,
} from "@/utils/track-player";
import type { AudioQuality as ApiAudioQuality } from "@/utils/types";

type AudioQuality = ApiAudioQuality;
type RepeatMode = "off" | "all" | "one";

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
    options?: { skipRecentlyPlayed?: boolean }
  ) => Promise<void>;
  playQueue: (tracks: Track[], startIndex?: number) => Promise<void>;
  pauseTrack: () => Promise<void>;
  resumeTrack: () => Promise<void>;
  seekToMillis: (positionMillis: number) => Promise<void>;
  seekByMillis: (deltaMillis: number) => Promise<void>;
  addToQueue: (track: Track) => boolean;
  addTracksToQueue: (tracks: Track[]) => number;
  removeFromQueue: (trackId: string) => void;
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
  // New: Pre-buffer status for next track
  nextTrackBufferStatus: PreBufferStatus;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

const FAVORITES_STORAGE_KEY = "hififlow:favorites:v1";
const RECENTLY_PLAYED_STORAGE_KEY = "hififlow:recently_played:v1";
const QUALITY_STORAGE_KEY = "hififlow:quality:v1";
const SHUFFLE_STORAGE_KEY = "hififlow:shuffle:v1";
const REPEAT_STORAGE_KEY = "hififlow:repeat:v1";
const VOLUME_STORAGE_KEY = "hififlow:volume:v1";
const SLEEP_TIMER_KEY = "hififlow:sleeptimer:v1";
const QUEUE_STORAGE_KEY = "hififlow:queue:v1";
const QUEUE_INDEX_KEY = "hififlow:queue_index:v1";

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

  // ==================== Queue State ====================
  const [queue, setQueue, isQueueLoaded] = usePersistentState<Track[]>(
    QUEUE_STORAGE_KEY,
    []
  );
  const [persistedQueueIndex, setPersistedQueueIndex, isIndexLoaded] =
    usePersistentState<number>(QUEUE_INDEX_KEY, -1);
  const queueIndexRef = useRef<number>(-1);

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

  const { showToast } = useToast();

  // ==================== Refs for single-player control ====================
  // CRITICAL: Only ONE active player at any time
  const activePlayerRef = useRef<AudioPlayer | null>(null);
  // Playback operation lock - prevents concurrent play operations
  const playLockRef = useRef<boolean>(false);
  // Pre-buffered player for instant next-track playback
  const preBufferedPlayerRef = useRef<{
    player: AudioPlayer;
    trackId: string;
    url: string;
  } | null>(null);
  // Stream URL cache
  const streamUrlCacheRef = useRef<
    Map<string, { url: string; timestamp: number }>
  >(new Map());
  const STREAM_URL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
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

  const trackPlayerReadyRef = useRef(false);

  const isNative = Platform.OS !== "web";

  const getTrackPlayerActiveIndex = useCallback(async (): Promise<number | null> => {
    if (!isNative) return null;
    const record = TrackPlayer as unknown as Record<string, unknown>;
    const getActiveTrackIndex = record["getActiveTrackIndex"];
    if (typeof getActiveTrackIndex === "function") {
      const idx = await (getActiveTrackIndex as () => Promise<number | undefined>)();
      return typeof idx === "number" ? idx : null;
    }
    const idx = await TrackPlayer.getCurrentTrack();
    return typeof idx === "number" ? idx : null;
  }, [isNative]);

  const buildTrackPlayerTrack = useCallback(
    (track: Track, url: string): TrackPlayerAddTrack => {
      return {
        id: String(track.id),
        url,
        title: track.title,
        artist: track.artist,
        artwork: track.artwork,
        duration: track.duration,
      };
    },
    []
  );

  // ==================== Derived State ====================
  const trackPlayerProgress = useProgress(250);
  const trackPlayerPlaybackState = usePlaybackState();
  const trackPlayerState =
    typeof trackPlayerPlaybackState === "object" &&
    trackPlayerPlaybackState !== null &&
    "state" in trackPlayerPlaybackState
      ? (trackPlayerPlaybackState as { state?: unknown }).state
      : trackPlayerPlaybackState;

  const isPlaying = isNative
    ? trackPlayerState === TrackPlayerState.Playing
    : (status?.playing ?? false);

  const trackPlayerStateMatches = (key: string) => {
    if (!isNative) return false;
    const record = TrackPlayerState as unknown as Record<string, unknown>;
    return key in record && trackPlayerState === record[key];
  };

  const isLoading = isNative
    ? trackPlayerStateMatches("Buffering") || trackPlayerStateMatches("Connecting")
    : (status?.isBuffering ?? false);

  const positionMillis = isNative
    ? trackPlayerProgress.position * 1000
    : (status?.currentTime ?? 0) * 1000;
  const durationMillis = isNative
    ? trackPlayerProgress.duration * 1000
    : (status?.duration ?? 0) * 1000;

  const mapRepeatModeToTrackPlayer = useCallback(
    (mode: RepeatMode) => {
      if (mode === "one") return TrackPlayerRepeatMode.Track;
      if (mode === "all") return TrackPlayerRepeatMode.Queue;
      return TrackPlayerRepeatMode.Off;
    },
    []
  );

  const setupTrackPlayer = useCallback(async () => {
    if (Platform.OS === "web") return;
    if (trackPlayerReadyRef.current) return;

    try {
      await TrackPlayer.setupPlayer({
        autoHandleInterruptions: true,
        autoUpdateMetadata: true,
      });
    } catch (e) {
      const code = String((e as { code?: unknown } | undefined)?.code ?? "");
      if (code === "android_cannot_setup_player_in_background") {
        return;
      }
      throw e;
    }

    await TrackPlayer.updateOptions({
      android: {
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
      },
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
        Capability.JumpBackward,
        Capability.JumpForward,
        Capability.Stop,
      ],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.JumpBackward,
        Capability.JumpForward,
        Capability.Stop,
      ],
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
      ],
      forwardJumpInterval: 15,
      backwardJumpInterval: 15,
      progressUpdateEventInterval: 1,
    });

    await TrackPlayer.setRepeatMode(mapRepeatModeToTrackPlayer(repeatMode));
    await TrackPlayer.setVolume(volume);
    trackPlayerReadyRef.current = true;
  }, [mapRepeatModeToTrackPlayer, repeatMode, volume]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (trackPlayerReadyRef.current) return;

    let stopped = false;

    const run = async () => {
      try {
        await setupTrackPlayer();
      } catch {
        return;
      }
      if (stopped || trackPlayerReadyRef.current) return;
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active" && !trackPlayerReadyRef.current) {
          void setupTrackPlayer();
        }
      });
      return () => sub.remove();
    };

    const cleanupPromise = run();
    return () => {
      stopped = true;
      void cleanupPromise;
    };
  }, [setupTrackPlayer]);

  // ==================== Status Listener ====================
  useEffect(() => {
    if (Platform.OS !== "web") return;
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

  useTrackPlayerEvents(
    [Event.PlaybackActiveTrackChanged, Event.PlaybackQueueEnded],
    (event: unknown) => {
      if (!isNative) return;
      const record = event as { type?: unknown };
      if (record.type === Event.PlaybackQueueEnded) {
        setNextTrackBufferStatus("none");
        return;
      }
      if (record.type !== Event.PlaybackActiveTrackChanged) return;
      void (async () => {
        const activeIndex = await getTrackPlayerActiveIndex();
        if (activeIndex === null) return;
        const tpTrack = await TrackPlayer.getTrack(activeIndex);
        const tpId =
          typeof tpTrack?.id === "string" ? tpTrack.id : String(tpTrack?.id ?? "");
        const next =
          queue.find((t) => String(t.id) === tpId) ??
          queue[activeIndex] ??
          null;
        if (next) {
          setCurrentTrack(next);
          setAudioAnalysis(null);
        }
        if (typeof tpTrack?.url === "string") {
          setCurrentStreamUrl(tpTrack.url);
        }
        const nextIndex = queue.findIndex((t) => String(t.id) === tpId);
        const persisted = nextIndex !== -1 ? nextIndex : activeIndex;
        queueIndexRef.current = persisted;
        setPersistedQueueIndex(persisted);
        setNextTrackBufferStatus(queue.length > 1 ? "ready" : "none");
      })();
    }
  );

  // ==================== Session Restoration ====================
  useEffect(() => {
    if (isQueueLoaded && isIndexLoaded && !currentTrack && queue.length > 0) {
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
  }, [isQueueLoaded, isIndexLoaded, queue, currentTrack, persistedQueueIndex]);

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

  // Clean expired cache entries
  const cleanStreamUrlCache = useCallback(() => {
    const now = Date.now();
    for (const [key, value] of streamUrlCacheRef.current.entries()) {
      if (now - value.timestamp > STREAM_URL_CACHE_TTL) {
        streamUrlCacheRef.current.delete(key);
      }
    }
  }, []);

  // Get stream URL with caching
  const getStreamUrlForTrack = useCallback(
    async (
      track: Track,
      currentQuality: AudioQuality
    ): Promise<string | null> => {
      const trackIdStr = String(track.id);
      const trackId = Number(track.id);
      const cacheKey = `${trackIdStr}:${currentQuality}`;

      // Check cache first
      const cached = streamUrlCacheRef.current.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < STREAM_URL_CACHE_TTL) {
        return cached.url;
      }

      // Check saved tracks
      const savedTrack =
        recentlyPlayed.find((t) => String(t.id) === trackIdStr) ||
        favorites.find((t) => String(t.id) === trackIdStr);

      if (savedTrack?.streamUrl) {
        streamUrlCacheRef.current.set(cacheKey, {
          url: savedTrack.streamUrl,
          timestamp: Date.now(),
        });
        return savedTrack.streamUrl;
      }

      // Fetch from API
      let streamUrl: string | null = null;
      if (Number.isFinite(trackId)) {
        try {
          streamUrl = await losslessAPI.getStreamUrl(trackId, currentQuality);
        } catch {
          streamUrl = null;
        }
      }

      // Fallback to track URL
      if (!streamUrl && track.url) {
        streamUrl = track.url;
      }

      // Cache the result
      if (streamUrl) {
        streamUrlCacheRef.current.set(cacheKey, {
          url: streamUrl,
          timestamp: Date.now(),
        });
      }

      return streamUrl;
    },
    [recentlyPlayed, favorites]
  );

  const resolveQueueStreamUrls = useCallback(
    async (tracks: Track[]) => {
      const effectiveQuality = quality === "HI_RES_LOSSLESS" ? "LOSSLESS" : quality;

      const results: Array<{ track: Track; url: string }> = [];
      const concurrency = 4;
      let cursor = 0;

      const runWorker = async () => {
        while (cursor < tracks.length) {
          const index = cursor;
          cursor += 1;
          const track = tracks[index];
          if (!track) continue;
          const url = await getStreamUrlForTrack(track, effectiveQuality);
          if (!url) {
            throw new Error(`No stream URL for track ${String(track.id)}`);
          }
          results[index] = { track, url };
        }
      };

      const workers = Array.from(
        { length: Math.min(concurrency, tracks.length) },
        () => runWorker()
      );
      await Promise.all(workers);
      return results;
    },
    [getStreamUrlForTrack, quality]
  );

  // ==================== Player Control - SINGLE PLAYER PATTERN ====================

  /**
   * CRITICAL: Destroys ALL audio players to ensure single-player mode
   * Must be called before creating any new player
   */
  const destroyAllPlayers = useCallback(() => {
    if (isNative) {
      void TrackPlayer.reset();
      setPlayer(null);
      setNextTrackBufferStatus("none");
      return;
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

    // Destroy pre-buffered player
    if (preBufferedPlayerRef.current) {
      try {
        preBufferedPlayerRef.current.player.pause();
        preBufferedPlayerRef.current.player.remove();
      } catch (e) {
        console.warn("Error removing pre-buffered player:", e);
      }
      preBufferedPlayerRef.current = null;
    }

    setPlayer(null);
    setNextTrackBufferStatus("none");
  }, [isNative]);

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

  const setNativeQueueAndPlay = useCallback(
    async (tracks: Track[], startIndex: number, skipRecentlyPlayed = false) => {
      if (!isNative) return false;
      if (playLockRef.current) return false;

      playLockRef.current = true;
      const startTrack = tracks[startIndex];
      setLoadingTrackId(startTrack ? String(startTrack.id) : null);

      try {
        await setupTrackPlayer();
        if (!trackPlayerReadyRef.current) return false;

        const resolved = await resolveQueueStreamUrls(tracks);
        await TrackPlayer.reset();
        await TrackPlayer.add(
          resolved.map((r) => buildTrackPlayerTrack(r.track, r.url))
        );
        await TrackPlayer.skip(
          Math.max(0, Math.min(startIndex, resolved.length - 1))
        );
        await TrackPlayer.play();

        const active = resolved[Math.max(0, Math.min(startIndex, resolved.length - 1))];
        if (active) {
          setCurrentStreamUrl(active.url);
          if (!skipRecentlyPlayed) {
            void addToRecentlyPlayed(active.track, active.url);
          }
        } else {
          setCurrentStreamUrl(null);
        }

        setNextTrackBufferStatus(tracks.length > 1 ? "ready" : "none");
        consecutiveFailuresRef.current = 0;
        return true;
      } catch (error) {
        console.error("[Player] TrackPlayer playback failed:", error);
        return false;
      } finally {
        setLoadingTrackId(null);
        playLockRef.current = false;
      }
    },
    [
      addToRecentlyPlayed,
      buildTrackPlayerTrack,
      isNative,
      resolveQueueStreamUrls,
      setupTrackPlayer,
    ]
  );

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
        // STEP 1: Check if we have a pre-buffered player for this track
        if (
          usePreBuffered &&
          preBufferedPlayerRef.current?.trackId === trackIdStr
        ) {
          console.log("[Player] Using pre-buffered player for:", track.title);

          // Destroy current active player first
          if (activePlayerRef.current) {
            try {
              activePlayerRef.current.pause();
              activePlayerRef.current.remove();
            } catch (e) {
              console.warn("Error removing active player:", e);
            }
            activePlayerRef.current = null;
          }

          // Promote pre-buffered player to active
          const { player: bufferedPlayer, url } = preBufferedPlayerRef.current;
          activePlayerRef.current = bufferedPlayer;
          preBufferedPlayerRef.current = null;

          setPlayer(bufferedPlayer);
          setCurrentStreamUrl(url);
          bufferedPlayer.volume = volume;
          bufferedPlayer.play();

          setLoadingTrackId(null);
          consecutiveFailuresRef.current = 0;
          setNextTrackBufferStatus("none");

          if (!skipRecentlyPlayed) {
            void addToRecentlyPlayed(track, url);
          }
          return true;
        }

        // STEP 2: Destroy ALL existing players
        destroyAllPlayers();

        // STEP 3: Get stream URL (use LOSSLESS for faster start if HI_RES_LOSSLESS requested)
        const effectiveQuality =
          quality === "HI_RES_LOSSLESS" ? "LOSSLESS" : quality;
        const streamUrl = await getStreamUrlForTrack(track, effectiveQuality);

        if (!streamUrl) {
          console.warn(`[Player] No stream URL for track ${track.id}`);
          setLoadingTrackId(null);
          return false;
        }

        // STEP 4: Create and play new player
        console.log("[Player] Creating new player for:", track.title);
        const newPlayer = createAudioPlayer(streamUrl, {
          downloadFirst: false,
          keepAudioSessionActive: true,
          updateInterval: 250,
        });

        activePlayerRef.current = newPlayer;
        setPlayer(newPlayer);
        setCurrentStreamUrl(streamUrl);
        newPlayer.volume = volume;
        newPlayer.play();

        consecutiveFailuresRef.current = 0;
        if (!skipRecentlyPlayed) {
          void addToRecentlyPlayed(track, streamUrl);
        }

        return true;
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
    ]
  );

  // ==================== Pre-buffering Logic ====================

  /**
   * Pre-buffer the next track in queue for instant playback
   * Called after current track starts playing
   */
  const preBufferNextTrack = useCallback(async () => {
    if (isNative) return;
    if (queue.length === 0) return;

    // Find current index
    const currentIndex = currentTrack
      ? queue.findIndex((t) => String(t.id) === String(currentTrack.id))
      : -1;

    if (currentIndex === -1) return;

    // Determine next track
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

    const nextTrack = queue[nextIndex];
    if (!nextTrack) return;

    const nextTrackIdStr = String(nextTrack.id);

    // Skip if already pre-buffered
    if (preBufferedPlayerRef.current?.trackId === nextTrackIdStr) {
      return;
    }

    setNextTrackBufferStatus("buffering");

    try {
      const streamUrl = await getStreamUrlForTrack(nextTrack, quality);
      if (!streamUrl) {
        console.warn("[PreBuffer] No stream URL for next track");
        setNextTrackBufferStatus("failed");
        return;
      }

      // Clean up ANY existing pre-buffered player (including from race conditions)
      if (preBufferedPlayerRef.current) {
        try {
          preBufferedPlayerRef.current.player.pause();
          preBufferedPlayerRef.current.player.remove();
        } catch (e) {
          console.warn("Error removing pre-buffered player:", e);
        }
        preBufferedPlayerRef.current = null;
      }

      // Create player but don't play
      console.log("[PreBuffer] Pre-buffering:", nextTrack.title);
      const bufferedPlayer = createAudioPlayer(streamUrl, {
        downloadFirst: false,
        keepAudioSessionActive: true,
        updateInterval: 250,
      });

      preBufferedPlayerRef.current = {
        player: bufferedPlayer,
        trackId: nextTrackIdStr,
        url: streamUrl,
      };

      setNextTrackBufferStatus("ready");
    } catch (error) {
      console.error("[PreBuffer] Failed to pre-buffer:", error);
      setNextTrackBufferStatus("failed");
    }
  }, [
    queue,
    currentTrack,
    isNative,
    shuffleEnabled,
    repeatMode,
    quality,
    getStreamUrlForTrack,
  ]);

  // ==================== Queue Navigation ====================

  const playNext = useCallback(async () => {
    if (queue.length === 0) return;

    if (isNative) {
      if (repeatMode === "one") {
        await TrackPlayer.seekTo(0);
        await TrackPlayer.play();
        return;
      }

      const currentIndex = currentTrack
        ? queue.findIndex((t) => String(t.id) === String(currentTrack.id))
        : -1;

      let nextIndex: number;
      if (shuffleEnabled) {
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
            return;
          }
        } else {
          nextIndex = available[Math.floor(Math.random() * available.length)];
        }
        shuffleHistoryRef.current.push(nextIndex);
      } else {
        if (currentIndex >= queue.length - 1) {
          if (repeatMode === "all") {
            nextIndex = 0;
          } else {
            return;
          }
        } else {
          nextIndex = Math.max(0, currentIndex + 1);
        }
      }

      const nextTrack = queue[nextIndex];
      if (!nextTrack) return;

      queueIndexRef.current = nextIndex;
      setCurrentTrack(nextTrack);
      setAudioAnalysis(null);

      try {
        await TrackPlayer.skip(nextIndex);
        await TrackPlayer.play();
        const tpTrack = await TrackPlayer.getTrack(nextIndex);
        if (typeof tpTrack?.url === "string") {
          setCurrentStreamUrl(tpTrack.url);
        }
      } catch {
        if (repeatMode === "all") {
          try {
            await TrackPlayer.skip(0);
            await TrackPlayer.play();
          } catch {
            return;
          }
        }
      }

      return;
    }

    const currentIndex = currentTrack
      ? queue.findIndex((t) => String(t.id) === String(currentTrack.id))
      : -1;

    if (repeatMode === "one" && currentIndex !== -1) {
      // Repeat one: restart current track
      if (activePlayerRef.current) {
        activePlayerRef.current.seekTo(0);
        activePlayerRef.current.play();
      }
      return;
    }

    let nextIndex: number;
    if (shuffleEnabled) {
      // Shuffle mode
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
          // End of queue
          return;
        }
      } else {
        nextIndex = available[Math.floor(Math.random() * available.length)];
      }
      shuffleHistoryRef.current.push(nextIndex);
    } else {
      // Sequential mode
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

    const nextTrack = queue[nextIndex];
    if (!nextTrack) return;

    queueIndexRef.current = nextIndex;
    setCurrentTrack(nextTrack);
    setAudioAnalysis(null);

    const success = await playSoundInternal(nextTrack, true);

    if (!success) {
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
      // Retry with next track after short delay
      await new Promise((r) => setTimeout(r, 300));
      await playNext();
    }
  }, [
    queue,
    currentTrack,
    isNative,
    shuffleEnabled,
    repeatMode,
    playSoundInternal,
    setCurrentStreamUrl,
    showToast,
  ]);

  // Update ref
  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  const playPrevious = useCallback(async () => {
    if (queue.length === 0) return;

    if (isNative) {
      if (positionMillis > 3000) {
        await TrackPlayer.seekTo(0);
        await TrackPlayer.play();
        return;
      }

      const currentIndex = currentTrack
        ? queue.findIndex((t) => String(t.id) === String(currentTrack.id))
        : -1;

      let prevIndex: number;
      if (shuffleEnabled) {
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

      try {
        await TrackPlayer.skip(prevIndex);
        await TrackPlayer.play();
        const tpTrack = await TrackPlayer.getTrack(prevIndex);
        if (typeof tpTrack?.url === "string") {
          setCurrentStreamUrl(tpTrack.url);
        }
      } catch {
        return;
      }

      return;
    }

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
    isNative,
    shuffleEnabled,
    repeatMode,
    positionMillis,
    playSoundInternal,
    setCurrentStreamUrl,
  ]);

  // ==================== Public API ====================

  const playTrack = useCallback(
    async (track: Track, options?: { skipRecentlyPlayed?: boolean }) => {
      const skipRecentlyPlayed = options?.skipRecentlyPlayed ?? false;

      if (isNative) {
        const trackId = String(track.id);
        const existingIndex = queue.findIndex((t) => String(t.id) === trackId);

        let nextQueue = queue;
        let nextIndex = existingIndex;

        if (existingIndex === -1) {
          nextQueue = [...queue, track];
          if (nextQueue.length > MAX_QUEUE_SIZE) {
            const trimAmount = nextQueue.length - MAX_QUEUE_SIZE;
            nextQueue = nextQueue.slice(trimAmount);
          }
          nextIndex = nextQueue.findIndex((t) => String(t.id) === trackId);
        }

        queueIndexRef.current = Math.max(0, nextIndex);
        shuffleHistoryRef.current = [];
        setQueue(nextQueue);
        setCurrentTrack(track);
        setAudioAnalysis(null);

        const success = await setNativeQueueAndPlay(
          nextQueue,
          queueIndexRef.current,
          skipRecentlyPlayed
        );
        if (!success) {
          showToast({ message: "Playback failed", type: "error" });
        }
        return;
      }

      // Add track to queue (append, don't replace)
      setQueue((prev) => {
        // Check if track already exists in queue
        const existingIndex = prev.findIndex(
          (t) => String(t.id) === String(track.id)
        );
        if (existingIndex !== -1) {
          // Track exists, just update index
          queueIndexRef.current = existingIndex;
          return prev;
        }
        // Append new track
        queueIndexRef.current = prev.length;
        const newQueue = [...prev, track];
        // Limit to MAX_QUEUE_SIZE (keep newest)
        if (newQueue.length > MAX_QUEUE_SIZE) {
          const trimAmount = newQueue.length - MAX_QUEUE_SIZE;
          queueIndexRef.current = Math.max(
            0,
            queueIndexRef.current - trimAmount
          );
          return newQueue.slice(trimAmount);
        }
        return newQueue;
      });
      shuffleHistoryRef.current = [];
      setCurrentTrack(track);
      setAudioAnalysis(null);

      await playSoundInternal(track, false, skipRecentlyPlayed);
    },
    [
      isNative,
      playSoundInternal,
      queue,
      setNativeQueueAndPlay,
      setQueue,
      showToast,
    ]
  );

  const playQueue = useCallback(
    async (tracks: Track[], startIndex = 0) => {
      if (isNative) {
        const targetTrack = tracks[startIndex] ?? tracks[0];
        if (!targetTrack) return;

        const existingIds = new Set(queue.map((t) => String(t.id)));
        const newTracks = tracks.filter((t) => !existingIds.has(String(t.id)));
        const existingTargetIndex = queue.findIndex(
          (t) => String(t.id) === String(targetTrack.id)
        );

        let nextQueue = [...queue, ...newTracks];
        if (nextQueue.length > MAX_QUEUE_SIZE) {
          const trimAmount = nextQueue.length - MAX_QUEUE_SIZE;
          nextQueue = nextQueue.slice(trimAmount);
        }

        const nextIndex =
          existingTargetIndex !== -1
            ? existingTargetIndex
            : nextQueue.findIndex((t) => String(t.id) === String(targetTrack.id));

        queueIndexRef.current = nextIndex !== -1 ? nextIndex : 0;
        shuffleHistoryRef.current = [];
        setQueue(nextQueue);
        setCurrentTrack(targetTrack);
        setAudioAnalysis(null);

        const success = await setNativeQueueAndPlay(
          nextQueue,
          queueIndexRef.current
        );
        if (!success) {
          showToast({ message: "Playback failed", type: "error" });
        }
        return;
      }

      // Append tracks to queue (don't replace)
      setQueue((prev) => {
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
          queueIndexRef.current = existingTargetIndex;
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
        queueIndexRef.current =
          newTargetIndex !== -1
            ? newTargetIndex
            : Math.max(0, newQueue.length - 1);
        return newQueue;
      });

      shuffleHistoryRef.current = [];

      const startTrack = tracks[startIndex] ?? tracks[0];
      if (startTrack) {
        setCurrentTrack(startTrack);
        setAudioAnalysis(null);
        await playSoundInternal(startTrack, false);
      }
    },
    [
      isNative,
      playSoundInternal,
      queue,
      setNativeQueueAndPlay,
      setQueue,
      showToast,
    ]
  );

  const pauseTrack = useCallback(async () => {
    if (isNative) {
      await TrackPlayer.pause();
      return;
    }
    activePlayerRef.current?.pause();
  }, [isNative]);

  const resumeTrack = useCallback(async () => {
    if (isNative) {
      const activeIndex = await getTrackPlayerActiveIndex();
      if (activeIndex !== null) {
        await TrackPlayer.play();
        return;
      }
      if (currentTrack && queue.length > 0) {
        const index = queue.findIndex(
          (t) => String(t.id) === String(currentTrack.id)
        );
        await setNativeQueueAndPlay(queue, Math.max(0, index));
      }
      return;
    }

    if (activePlayerRef.current) {
      activePlayerRef.current.play();
    } else if (currentTrack) {
      await playSoundInternal(currentTrack, false);
    }
  }, [
    currentTrack,
    getTrackPlayerActiveIndex,
    isNative,
    playSoundInternal,
    queue,
    setNativeQueueAndPlay,
  ]);

  const seekToMillis = useCallback(async (pos: number) => {
    if (isNative) {
      await TrackPlayer.seekTo(pos / 1000);
      return;
    }
    activePlayerRef.current?.seekTo(pos / 1000);
  }, [isNative]);

  const seekByMillis = useCallback(async (delta: number) => {
    if (isNative) {
      const next = Math.max(0, trackPlayerProgress.position + delta / 1000);
      await TrackPlayer.seekTo(next);
      return;
    }
    if (activePlayerRef.current) {
      activePlayerRef.current.seekTo(
        activePlayerRef.current.currentTime + delta / 1000
      );
    }
  }, [isNative, trackPlayerProgress.position]);

  const addToQueue = useCallback(
    (track: Track): boolean => {
      let added = false;
      setQueue((prev) => {
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
        if (isNative) {
          void (async () => {
            await setupTrackPlayer();
            if (!trackPlayerReadyRef.current) return;
            const effectiveQuality =
              quality === "HI_RES_LOSSLESS" ? "LOSSLESS" : quality;
            const url = await getStreamUrlForTrack(track, effectiveQuality);
            if (!url) return;
            await TrackPlayer.add(buildTrackPlayerTrack(track, url));
          })();
        }
      }
      return added;
    },
    [
      buildTrackPlayerTrack,
      getStreamUrlForTrack,
      isNative,
      quality,
      setQueue,
      setupTrackPlayer,
      showToast,
    ]
  );

  const addTracksToQueue = useCallback(
    (tracks: Track[]): number => {
      let addedCount = 0;
      let addedTracks: Track[] = [];
      setQueue((prev) => {
        const existingIds = new Set(prev.map((t) => String(t.id)));
        const newTracks = tracks.filter((t) => !existingIds.has(String(t.id)));
        addedCount = newTracks.length;
        addedTracks = newTracks;
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
        if (isNative) {
          void (async () => {
            await setupTrackPlayer();
            if (!trackPlayerReadyRef.current) return;
            const effectiveQuality =
              quality === "HI_RES_LOSSLESS" ? "LOSSLESS" : quality;
            const resolved = await Promise.all(
              addedTracks.map(async (t) => {
                const url = await getStreamUrlForTrack(t, effectiveQuality);
                if (!url) return null;
                return buildTrackPlayerTrack(t, url);
              })
            );
            const list = resolved.filter(Boolean) as TrackPlayerAddTrack[];
            if (list.length === 0) return;
            await TrackPlayer.add(list);
          })();
        }
      }
      return addedCount;
    },
    [
      buildTrackPlayerTrack,
      getStreamUrlForTrack,
      isNative,
      quality,
      setQueue,
      setupTrackPlayer,
      showToast,
    ]
  );

  const clearQueue = useCallback(() => {
    // Stop playback and clear everything
    destroyAllPlayers();
    setQueue([]);
    setPersistedQueueIndex(-1);
    setCurrentTrack(null);
    setCurrentStreamUrl(null);
    setAudioAnalysis(null);
    queueIndexRef.current = -1;
    shuffleHistoryRef.current = [];
    showToast({ message: "Queue cleared", type: "success" });
  }, [destroyAllPlayers, setPersistedQueueIndex, showToast, setQueue]);

  const removeFromQueue = useCallback(
    (trackId: string) => {
      const removeIndex = queue.findIndex(
        (t) => String(t.id) === String(trackId)
      );
      if (isNative && removeIndex !== -1) {
        void (async () => {
          await setupTrackPlayer();
          if (!trackPlayerReadyRef.current) return;
          await TrackPlayer.remove(removeIndex);
        })();
      }
      setQueue((prev) => {
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
    [isNative, queue, setQueue, setupTrackPlayer, showToast]
  );

  const unloadSound = useCallback(async () => {
    destroyAllPlayers();
    if (isNative) {
      await TrackPlayer.reset();
    }
    setCurrentTrack(null);
    setCurrentStreamUrl(null);
    setAudioAnalysis(null);
  }, [destroyAllPlayers, isNative]);

  // ==================== Playback Finish Handler ====================
  useEffect(() => {
    if (status?.didJustFinish) {
      if (repeatMode === "one") {
        if (activePlayerRef.current) {
          activePlayerRef.current.seekTo(0);
          activePlayerRef.current.play();
        }
      } else {
        void playNextRef.current();
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

  // ==================== Cache Cleanup ====================
  useEffect(() => {
    const interval = setInterval(cleanStreamUrlCache, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [cleanStreamUrlCache]);

  // ==================== Media Session Integration ====================
  // Update media session player reference for native lock screen controls
  useEffect(() => {
    if (isNative) return;
    mediaSessionService.setPlayer(player);
  }, [isNative, player]);

  useEffect(() => {
    if (isNative) return;
    mediaSessionService.setHandlers({
      onPlay: () => activePlayerRef.current?.play(),
      onPause: () => activePlayerRef.current?.pause(),
      onStop: () => {
        activePlayerRef.current?.pause();
        activePlayerRef.current?.seekTo(0);
      },
      onNextTrack: () => void playNextRef.current(),
      onPreviousTrack: () => void playPrevious(),
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
  }, [isNative, playPrevious]);

  // Update media session track metadata
  useEffect(() => {
    if (isNative) return;
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
  }, [isNative, currentTrack]);

  // Update media session playback state
  useEffect(() => {
    if (isNative) return;
    mediaSessionService.updatePlaybackState({
      isPlaying,
      positionMs: positionMillis,
      durationMs: durationMillis,
      playbackRate: 1.0,
    });
  }, [isNative, isPlaying, positionMillis, durationMillis]);

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
      if (val) setFavorites(JSON.parse(val));
    });
    readPersistentValue(RECENTLY_PLAYED_STORAGE_KEY).then((val) => {
      if (val) setRecentlyPlayed(JSON.parse(val));
    });
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
    if (isNative) {
      await TrackPlayer.setVolume(v);
    } else if (activePlayerRef.current) {
      activePlayerRef.current.volume = v;
    }
    void writePersistentValue(VOLUME_STORAGE_KEY, String(v));
  }, [isNative]);

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

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((prev) => {
      const next = prev === "off" ? "all" : prev === "all" ? "one" : "off";
      void writePersistentValue(REPEAT_STORAGE_KEY, next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isNative) return;
    if (!trackPlayerReadyRef.current) return;
    void TrackPlayer.setRepeatMode(mapRepeatModeToTrackPlayer(repeatMode));
  }, [isNative, mapRepeatModeToTrackPlayer, repeatMode]);

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
        next = [
          {
            id: String(currentTrack.id),
            title: currentTrack.title,
            artist: currentTrack.artist,
            artwork: artwork || currentTrack.artwork,
            streamUrl: currentStreamUrl,
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
        const streamUrl = playingCurrent ? currentStreamUrl : track.url || null;

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
        void pauseTrack();
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
    nextTrackBufferStatus,
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
