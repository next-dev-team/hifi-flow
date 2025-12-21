import {
  type AudioAnalysis,
  extractAudioAnalysis,
} from "@siteed/expo-audio-studio";
import {
  type AudioPlayer,
  type AudioStatus,
  createAudioPlayer,
  useAudioPlayerStatus,
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
import { losslessAPI } from "@/utils/api";
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
  streamUrl: string;
  addedAt: number;
};

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
  playTrack: (track: Track) => Promise<void>;
  playQueue: (tracks: Track[], startIndex?: number) => Promise<void>;
  pauseTrack: () => Promise<void>;
  resumeTrack: () => Promise<void>;
  seekToMillis: (positionMillis: number) => Promise<void>;
  seekByMillis: (deltaMillis: number) => Promise<void>;
  addToQueue: (track: Track) => void;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  favorites: SavedTrack[];
  isCurrentFavorited: boolean;
  toggleCurrentFavorite: (artwork?: string) => Promise<void>;
  removeFavorite: (id: string) => Promise<void>;
  playSaved: (saved: SavedTrack) => Promise<void>;
  volume: number;
  setVolume: (volume: number) => Promise<void>;
  loadingTrackId: string | null;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

const FAVORITES_STORAGE_KEY = "hififlow:favorites:v1";
const QUALITY_STORAGE_KEY = "hififlow:quality:v1";
const SHUFFLE_STORAGE_KEY = "hififlow:shuffle:v1";
const REPEAT_STORAGE_KEY = "hififlow:repeat:v1";
const VOLUME_STORAGE_KEY = "hififlow:volume:v1";
const SLEEP_TIMER_KEY = "hififlow:sleeptimer:v1";

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

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  // We manage the current player in state so hooks can react to it
  const [player, setPlayer] = useState<AudioPlayer | null>(null);
  const [status, setStatus] = useState<AudioStatus | null>(null);

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

  // Derived state from status
  const isPlaying = status?.playing ?? false;
  const isLoading = status?.isBuffering ?? false; // or !status.isLoaded if we want initial load
  const positionMillis = (status?.currentTime ?? 0) * 1000;
  const durationMillis = (status?.duration ?? 0) * 1000;

  const [queue, setQueue] = useState<Track[]>([]);
  const [quality, setQualityState] = useState<AudioQuality>("HI_RES_LOSSLESS");
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  // Removed manual position/duration/isPlaying/isLoading state since we use status hook
  const [currentStreamUrl, setCurrentStreamUrl] = useState<string | null>(null);
  const [audioAnalysis, setAudioAnalysis] = useState<AudioAnalysis | null>(
    null
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [favorites, setFavorites] = useState<SavedTrack[]>([]);
  const [volume, setVolumeState] = useState(1.0);
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState<number | null>(null);
  const [sleepTimerRemainingMs, setSleepTimerRemainingMs] = useState(0);
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);

  const setQuality = useCallback((newQuality: AudioQuality) => {
    setQualityState(newQuality);
    void writePersistentValue(QUALITY_STORAGE_KEY, newQuality);
  }, []);

  // We keep a ref to the current player for imperative access in playSound
  const playerRef = useRef<AudioPlayer | null>(null);
  const preloadedPlayerRef = useRef<AudioPlayer | null>(null);
  const preloadedTrackKeyRef = useRef<string | null>(null);
  const preloadedStreamUrlRef = useRef<string | null>(null);
  const preloadRequestIdRef = useRef(0);
  const plannedNextForTrackKeyRef = useRef<string | null>(null);
  const plannedNextIndexRef = useRef<number | null>(null);
  const lastPreloadTriggerKeyRef = useRef<string | null>(null);
  const currentTrackRef = useRef<Track | null>(null);
  const queueRef = useRef<Track[]>([]);
  const qualityRef = useRef<AudioQuality>(quality);
  const shuffleEnabledRef = useRef(false);
  const repeatModeRef = useRef<RepeatMode>("off");
  const shuffleHistoryRef = useRef<number[]>([]);
  const playNextRef = useRef<() => Promise<void>>(async () => {});
  const playRequestIdRef = useRef(0);
  const currentStreamUrlRef = useRef<string | null>(null);
  const hasPreloadedForCurrentTrackRef = useRef(false);

  const preloadTriggerKey = `${quality}|${repeatMode}|${shuffleEnabled}|${queue.length}`;

  const sleepTimerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const sleepTimerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );

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

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    currentStreamUrlRef.current = currentStreamUrl;
  }, [currentStreamUrl]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    qualityRef.current = quality;
  }, [quality]);

  useEffect(() => {
    shuffleEnabledRef.current = shuffleEnabled;
    if (!shuffleEnabled) {
      shuffleHistoryRef.current = [];
    }
  }, [shuffleEnabled]);

  useEffect(() => {
    repeatModeRef.current = repeatMode;
  }, [repeatMode]);

  // Handle playback completion
  useEffect(() => {
    if (status?.didJustFinish) {
      if (repeatModeRef.current === "one") {
        player?.seekTo(0);
        player?.play();
      } else {
        void playNextRef.current();
      }
    }
  }, [status?.didJustFinish, player]);

  const getTrackKey = useCallback((track: Track, q: AudioQuality) => {
    return `${String(track.id)}|${q}`;
  }, []);

  const resetPreloadState = useCallback(async () => {
    preloadRequestIdRef.current += 1;
    plannedNextForTrackKeyRef.current = null;
    plannedNextIndexRef.current = null;
    preloadedTrackKeyRef.current = null;
    preloadedStreamUrlRef.current = null;
    lastPreloadTriggerKeyRef.current = null;
    const previous = preloadedPlayerRef.current;
    preloadedPlayerRef.current = null;
    if (previous) {
      previous.remove();
    }
    return preloadRequestIdRef.current;
  }, []);

  const getStreamUrlForTrack = useCallback(async (track: Track) => {
    const trackId = Number(track.id);
    let streamUrl: string | null = null;

    if (Number.isFinite(trackId)) {
      try {
        streamUrl = await losslessAPI.getStreamUrl(trackId, qualityRef.current);
      } catch {
        streamUrl = null;
      }
    }

    if (!streamUrl && track.url) {
      streamUrl = track.url;
    }

    return streamUrl;
  }, []);

  const preloadNextForTrack = useCallback(
    async (activeTrack: Track, playRequestId: number, triggerKey: string) => {
      lastPreloadTriggerKeyRef.current = triggerKey;
      const nextQueue = queueRef.current;
      if (nextQueue.length === 0) {
        await resetPreloadState();
        return;
      }

      const currentIndex = nextQueue.findIndex((t) => t.id === activeTrack.id);
      if (currentIndex === -1) {
        await resetPreloadState();
        return;
      }

      if (repeatModeRef.current === "one") {
        await resetPreloadState();
        return;
      }

      let nextIndex: number | null = null;
      const activeKey = getTrackKey(activeTrack, qualityRef.current);

      if (shuffleEnabledRef.current && nextQueue.length > 1) {
        const available: number[] = [];
        for (let i = 0; i < nextQueue.length; i += 1) {
          if (i !== currentIndex) available.push(i);
        }
        nextIndex =
          available[Math.floor(Math.random() * available.length)] ?? null;
        if (nextIndex !== null) {
          plannedNextForTrackKeyRef.current = activeKey;
          plannedNextIndexRef.current = nextIndex;
        }
      } else if (currentIndex < nextQueue.length - 1) {
        nextIndex = currentIndex + 1;
      } else if (repeatModeRef.current === "all" && nextQueue.length > 0) {
        nextIndex = 0;
      }

      const nextTrack =
        nextIndex === null ? null : nextQueue[nextIndex] ?? null;
      if (!nextTrack) {
        await resetPreloadState();
        return;
      }

      const nextKey = getTrackKey(nextTrack, qualityRef.current);
      if (preloadedTrackKeyRef.current === nextKey) {
        return;
      }

      const preloadId = await resetPreloadState();
      const streamUrl = await getStreamUrlForTrack(nextTrack);
      if (!streamUrl) {
        return;
      }

      if (
        playRequestIdRef.current !== playRequestId ||
        preloadRequestIdRef.current !== preloadId
      ) {
        return;
      }

      // Create preloaded player
      // We don't play it, just create it. It will buffer.
      const player = createAudioPlayer(streamUrl, {
        downloadFirst: false, // Stream immediately
        updateInterval: 250,
      });

      if (
        playRequestIdRef.current !== playRequestId ||
        preloadRequestIdRef.current !== preloadId
      ) {
        player.remove();
        return;
      }

      preloadedPlayerRef.current = player;
      preloadedTrackKeyRef.current = nextKey;
      preloadedStreamUrlRef.current = streamUrl;
    },
    [getStreamUrlForTrack, getTrackKey, resetPreloadState]
  );

  useEffect(() => {
    readPersistentValue(FAVORITES_STORAGE_KEY)
      .then((value) => {
        if (!value) return;
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) return;
        const loaded = parsed
          .filter((entry): entry is SavedTrack => {
            if (!entry || typeof entry !== "object") return false;
            const record = entry as Record<string, unknown>;
            return (
              typeof record.id === "string" &&
              typeof record.title === "string" &&
              typeof record.artist === "string" &&
              typeof record.streamUrl === "string" &&
              typeof record.addedAt === "number" &&
              (record.artwork === undefined ||
                typeof record.artwork === "string")
            );
          })
          .slice(0, 500);
        setFavorites(loaded);
      })
      .catch(() => {
        return;
      });
  }, []);

  const unloadSound = useCallback(async () => {
    await resetPreloadState();
    const sound = playerRef.current;
    if (sound) {
      sound.remove();
      playerRef.current = null;
      setPlayer(null);
    }
    // Also clear loading state if we are unloading everything
    setLoadingTrackId(null);
  }, [resetPreloadState]);

  const setVolume = useCallback(async (value: number) => {
    const normalized = Math.max(0, Math.min(1, value));
    setVolumeState(normalized);
    void writePersistentValue(VOLUME_STORAGE_KEY, String(normalized));
    if (playerRef.current) {
      playerRef.current.volume = normalized;
    }
  }, []);

  useEffect(() => {
    // Quality
    readPersistentValue(QUALITY_STORAGE_KEY).then((val) => {
      if (val) setQualityState(val as AudioQuality);
    });
    // Shuffle
    readPersistentValue(SHUFFLE_STORAGE_KEY).then((val) => {
      if (val) setShuffleEnabled(val === "true");
    });
    // Repeat
    readPersistentValue(REPEAT_STORAGE_KEY).then((val) => {
      if (val) setRepeatMode(val as RepeatMode);
    });
    // Volume
    readPersistentValue(VOLUME_STORAGE_KEY).then((val) => {
      if (val) {
        const v = parseFloat(val);
        if (!isNaN(v)) setVolumeState(v);
      }
    });

    // Sleep Timer
    readPersistentValue(SLEEP_TIMER_KEY).then((val) => {
      if (val) {
        const endsAt = parseInt(val, 10);
        if (!isNaN(endsAt) && endsAt > Date.now()) {
          setSleepTimerEndsAt(endsAt);
          const ms = endsAt - Date.now();
          setSleepTimerRemainingMs(ms);

          sleepTimerIntervalRef.current = setInterval(() => {
            const remaining = Math.max(0, endsAt - Date.now());
            setSleepTimerRemainingMs(remaining);
            if (remaining <= 0) {
              if (sleepTimerIntervalRef.current) {
                clearInterval(sleepTimerIntervalRef.current);
                sleepTimerIntervalRef.current = null;
              }
            }
          }, 1000);

          sleepTimerTimeoutRef.current = setTimeout(() => {
            void unloadSound();
            clearSleepTimerHandles();
            setSleepTimerEndsAt(null);
            setSleepTimerRemainingMs(0);
            void writePersistentValue(SLEEP_TIMER_KEY, "");
          }, ms);
        } else {
          // Expired or invalid
          void writePersistentValue(SLEEP_TIMER_KEY, "");
        }
      }
    });
  }, [clearSleepTimerHandles, unloadSound]);

  const analyzeTrack = useCallback(async (uri: string, requestId: number) => {
    // If we already have analysis for this track, don't re-analyze
    // checks are done in the effect
    setIsAnalyzing(true);
    try {
      const result = await extractAudioAnalysis({
        fileUri: uri,
        segmentDurationMs: 100,
        features: {
          rms: true,
          energy: true,
          spectralCentroid: true,
        },
      });
      if (playRequestIdRef.current === requestId) {
        setAudioAnalysis(result);
      }
    } catch (e) {
      console.error("Error analyzing track", e);
    } finally {
      if (playRequestIdRef.current === requestId) {
        setIsAnalyzing(false);
      }
    }
  }, []);

  // Trigger analysis when playback starts to avoid competing for bandwidth during initial load
  useEffect(() => {
    if (status?.playing && currentStreamUrl && !audioAnalysis && !isAnalyzing) {
      const requestId = playRequestIdRef.current;
      // Small delay to ensure player has established a buffer
      const timer = setTimeout(() => {
        if (playRequestIdRef.current === requestId) {
          void analyzeTrack(currentStreamUrl, requestId);
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [
    status?.playing,
    currentStreamUrl,
    audioAnalysis,
    isAnalyzing,
    analyzeTrack,
  ]);

  const playSound = useCallback(
    async (track: Track) => {
      playRequestIdRef.current += 1;
      const requestId = playRequestIdRef.current;
      setLoadingTrackId(String(track.id));

      // Unload previous sound first
      if (playerRef.current) {
        playerRef.current.remove();
        playerRef.current = null;
        setPlayer(null);
      }

      hasPreloadedForCurrentTrackRef.current = false;

      // Reset analysis state immediately
      setAudioAnalysis(null);
      setIsAnalyzing(false);

      if (playRequestIdRef.current !== requestId) {
        return;
      }

      // Reset derived state implicitly by new player status (handled by hook)
      // But we can reset stream url
      setCurrentStreamUrl(null);

      const wantedKey = getTrackKey(track, qualityRef.current);
      const maybePreloadedPlayer = preloadedPlayerRef.current;
      const maybePreloadedKey = preloadedTrackKeyRef.current;
      const maybePreloadedUrl = preloadedStreamUrlRef.current;

      if (
        maybePreloadedPlayer &&
        maybePreloadedKey === wantedKey &&
        typeof maybePreloadedUrl === "string" &&
        maybePreloadedUrl.length > 0
      ) {
        preloadedPlayerRef.current = null;
        preloadedTrackKeyRef.current = null;
        preloadedStreamUrlRef.current = null;

        const player = maybePreloadedPlayer;
        playerRef.current = player;
        setPlayer(player);

        player.volume = volume;

        if (playRequestIdRef.current !== requestId) {
          player.remove();
          return;
        }

        setCurrentStreamUrl(maybePreloadedUrl);
        // Analysis will be triggered by the useEffect when playing starts
        player.play();
        setLoadingTrackId(null);

        // Preloading is now handled by the useEffect watching status.playing
        return;
      }

      void resetPreloadState();

      const streamUrl = await getStreamUrlForTrack(track);

      if (playRequestIdRef.current !== requestId) {
        return;
      }

      if (!streamUrl) {
        if (playRequestIdRef.current === requestId) {
          setCurrentStreamUrl(null);
          setLoadingTrackId(null);
        }
        return;
      }

      try {
        // Create new sound instance
        // Chunked loading / streaming enabled by downloadFirst: false (default)
        const player = createAudioPlayer(streamUrl, {
          downloadFirst: false,
          updateInterval: 250,
        });

        playerRef.current = player;
        setPlayer(player);
        player.volume = volume;

        if (playRequestIdRef.current !== requestId) {
          player.remove();
          return;
        }

        setCurrentStreamUrl(streamUrl);
        // Analysis will be triggered by the useEffect when playing starts
        player.play();
      } catch (error) {
        console.error("Playback failed", error);
      } finally {
        if (playRequestIdRef.current === requestId) {
          setLoadingTrackId(null);
        }
      }
    },
    [
      volume,
      // analyzeTrack, // Removed from dependency since it's not called directly
      getStreamUrlForTrack,
      getTrackKey,
      resetPreloadState,
    ]
  );

  // Sequential preloading: Only trigger preloading when the current track has actually started playing
  useEffect(() => {
    if (
      status?.playing &&
      !hasPreloadedForCurrentTrackRef.current &&
      currentTrackRef.current
    ) {
      hasPreloadedForCurrentTrackRef.current = true;
      const triggerKey = `${qualityRef.current}|${repeatModeRef.current}|${shuffleEnabledRef.current}|${queueRef.current.length}`;
      void preloadNextForTrack(
        currentTrackRef.current,
        playRequestIdRef.current,
        triggerKey
      );
    }
  }, [status?.playing, preloadNextForTrack]);

  const playTrack = useCallback(
    async (track: Track) => {
      setQueue([track]);
      queueRef.current = [track];
      setCurrentTrack(track);
      currentTrackRef.current = track;
      await playSound(track);
    },
    [playSound]
  );

  const playQueue = useCallback(
    async (tracks: Track[], startIndex: number = 0) => {
      const nextQueue = tracks.filter((candidate): candidate is Track =>
        Boolean(candidate && candidate.id && candidate.title)
      );
      setQueue(nextQueue);
      queueRef.current = nextQueue;
      const startTrack = nextQueue[startIndex] ?? nextQueue[0];
      if (!startTrack) {
        setCurrentTrack(null);
        currentTrackRef.current = null;
        return;
      }
      setCurrentTrack(startTrack);
      currentTrackRef.current = startTrack;
      await playSound(startTrack);
    },
    [playSound]
  );

  const pauseTrack = useCallback(async () => {
    const player = playerRef.current;
    if (player) {
      player.pause();
    }
  }, []);

  const cancelSleepTimer = useCallback(() => {
    clearSleepTimerHandles();
    setSleepTimerEndsAt(null);
    setSleepTimerRemainingMs(0);
    void writePersistentValue(SLEEP_TIMER_KEY, "");
  }, [clearSleepTimerHandles]);

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
        void unloadSound();
        clearSleepTimerHandles();
        setSleepTimerEndsAt(null);
        setSleepTimerRemainingMs(0);
        void writePersistentValue(SLEEP_TIMER_KEY, "");
      }, ms);
    },
    [clearSleepTimerHandles, unloadSound]
  );

  const resumeTrack = useCallback(async () => {
    const player = playerRef.current;
    if (player) {
      player.play();
    }
  }, []);

  const persistFavorites = useCallback(async (next: SavedTrack[]) => {
    setFavorites(next);
    await writePersistentValue(FAVORITES_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const toggleCurrentFavorite = useCallback(
    async (artwork?: string) => {
      const active = currentTrackRef.current;
      const streamUrl = currentStreamUrlRef.current;
      if (!active || !streamUrl) return;
      const favoriteId = normalizeFavoriteId(active.id);

      const existing = favorites.some((entry) => entry.id === favoriteId);
      if (existing) {
        const next = favorites.filter((entry) => entry.id !== favoriteId);
        await persistFavorites(next);
        return;
      }

      const next: SavedTrack[] = [
        {
          id: favoriteId,
          title: active.title,
          artist: active.artist,
          artwork: artwork ?? active.artwork,
          streamUrl,
          addedAt: Date.now(),
        },
        ...favorites,
      ].slice(0, 200);

      await persistFavorites(next);
    },
    [favorites, persistFavorites]
  );

  const removeFavorite = useCallback(
    async (id: string) => {
      const favoriteId = normalizeFavoriteId(id);
      const next = favorites.filter((entry) => entry.id !== favoriteId);
      await persistFavorites(next);
    },
    [favorites, persistFavorites]
  );

  const playSaved = useCallback(
    async (saved: SavedTrack) => {
      const track: Track = {
        id: `saved:${saved.id}`,
        title: saved.title,
        artist: saved.artist,
        artwork: saved.artwork,
        url: saved.streamUrl,
      };

      setQueue([track]);
      queueRef.current = [track];
      setCurrentTrack(track);
      currentTrackRef.current = track;
      await playSound(track);
    },
    [playSound]
  );

  const seekToMillis = useCallback(async (nextPositionMillis: number) => {
    const player = playerRef.current;
    if (!player) return;

    const seconds = nextPositionMillis / 1000;
    player.seekTo(seconds);
  }, []);

  const seekByMillis = useCallback(
    async (deltaMillis: number) => {
      await seekToMillis(positionMillis + deltaMillis);
    },
    [positionMillis, seekToMillis]
  );

  const toggleShuffle = useCallback(() => {
    setShuffleEnabled((prev) => {
      const next = !prev;
      if (!next) {
        shuffleHistoryRef.current = [];
      }
      void writePersistentValue(SHUFFLE_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((prev) => {
      let next: RepeatMode;
      if (prev === "off") next = "all";
      else if (prev === "all") next = "one";
      else next = "off";

      void writePersistentValue(REPEAT_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const addToQueue = (track: Track) => {
    setQueue((prev) => {
      if (prev.some((entry) => entry.id === track.id)) return prev;
      const nextQueue = [...prev, track];
      queueRef.current = nextQueue;
      return nextQueue;
    });
  };

  const playFromQueueIndex = useCallback(
    async (nextIndex: number) => {
      const nextQueue = queueRef.current;
      const nextTrack = nextQueue[nextIndex];
      if (!nextTrack) {
        return;
      }
      setCurrentTrack(nextTrack);
      currentTrackRef.current = nextTrack;
      await playSound(nextTrack);
    },
    [playSound]
  );

  const playNext = useCallback(async () => {
    const active = currentTrackRef.current;
    const nextQueue = queueRef.current;
    if (!active || nextQueue.length === 0) {
      return;
    }
    const currentIndex = nextQueue.findIndex((t) => t.id === active.id);
    if (currentIndex === -1) {
      return;
    }

    if (shuffleEnabledRef.current && nextQueue.length > 1) {
      const activeKey = getTrackKey(active, qualityRef.current);
      const plannedForKey = plannedNextForTrackKeyRef.current;
      const plannedIndex = plannedNextIndexRef.current;
      if (
        plannedForKey === activeKey &&
        plannedIndex !== null &&
        plannedIndex >= 0 &&
        plannedIndex < nextQueue.length &&
        plannedIndex !== currentIndex
      ) {
        plannedNextForTrackKeyRef.current = null;
        plannedNextIndexRef.current = null;
        shuffleHistoryRef.current.push(currentIndex);
        await playFromQueueIndex(plannedIndex);
        return;
      }
      const available: number[] = [];
      for (let i = 0; i < nextQueue.length; i += 1) {
        if (i !== currentIndex) {
          available.push(i);
        }
      }
      const nextIndex =
        available[Math.floor(Math.random() * available.length)] ?? currentIndex;
      shuffleHistoryRef.current.push(currentIndex);
      await playFromQueueIndex(nextIndex);
      return;
    }

    if (currentIndex < nextQueue.length - 1) {
      await playFromQueueIndex(currentIndex + 1);
      return;
    }

    if (repeatModeRef.current === "all" && nextQueue.length > 0) {
      await playFromQueueIndex(0);
      return;
    }
  }, [getTrackKey, playFromQueueIndex]);

  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  const playPrevious = useCallback(async () => {
    const active = currentTrackRef.current;
    const nextQueue = queueRef.current;
    if (!active || nextQueue.length === 0) {
      return;
    }
    const currentIndex = nextQueue.findIndex((t) => t.id === active.id);

    if (shuffleEnabledRef.current) {
      const history = shuffleHistoryRef.current;
      const previousIndex = history.pop();
      if (previousIndex !== undefined) {
        await playFromQueueIndex(previousIndex);
        return;
      }
    }

    if (currentIndex > 0) {
      await playFromQueueIndex(currentIndex - 1);
      return;
    }

    if (repeatModeRef.current === "all" && nextQueue.length > 0) {
      await playFromQueueIndex(nextQueue.length - 1);
    }
  }, [playFromQueueIndex]);

  useEffect(() => {
    return () => {
      unloadSound();
      clearSleepTimerHandles();
    };
  }, [clearSleepTimerHandles, unloadSound]);

  const value: PlayerContextType = {
    currentTrack,
    isPlaying,
    isLoading,
    queue,
    quality,
    setQuality,
    shuffleEnabled,
    toggleShuffle: () => {
      setShuffleEnabled((prev) => {
        const next = !prev;
        void writePersistentValue(SHUFFLE_STORAGE_KEY, String(next));
        return next;
      });
    },
    repeatMode,
    cycleRepeatMode: () => {
      setRepeatMode((prev) => {
        const next = prev === "off" ? "all" : prev === "all" ? "one" : "off";
        void writePersistentValue(REPEAT_STORAGE_KEY, next);
        return next;
      });
    },
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
    resumeTrack: async () => {
      if (playerRef.current) {
        playerRef.current.play();
      }
    },
    seekToMillis: async (pos) => {
      if (playerRef.current) {
        playerRef.current.seekTo(pos / 1000);
      }
    },
    seekByMillis: async (delta) => {
      if (playerRef.current) {
        const current = playerRef.current.currentTime;
        playerRef.current.seekTo(current + delta / 1000);
      }
    },
    addToQueue: (track) => {
      setQueue((prev) => [...prev, track]);
    },
    playNext: async () => {
      await playNextRef.current();
    },
    playPrevious: async () => {
      const prev = queueRef.current;
      const current = currentTrackRef.current;
      if (!current || prev.length === 0) return;
      const idx = prev.findIndex((t) => t.id === current.id);
      if (idx > 0) {
        const prevTrack = prev[idx - 1];
        if (prevTrack) {
          setCurrentTrack(prevTrack);
          await playSound(prevTrack);
        }
      }
    },
    favorites,
    isCurrentFavorited: useMemo(() => {
      if (!currentTrack) return false;
      return favorites.some(
        (f) =>
          normalizeFavoriteId(f.id) === normalizeFavoriteId(currentTrack.id)
      );
    }, [currentTrack, favorites]),
    toggleCurrentFavorite: async (artwork) => {
      if (!currentTrack) return;
      const id = normalizeFavoriteId(currentTrack.id);
      const exists = favorites.some((f) => normalizeFavoriteId(f.id) === id);

      let nextFavorites: SavedTrack[];
      if (exists) {
        nextFavorites = favorites.filter(
          (f) => normalizeFavoriteId(f.id) !== id
        );
      } else {
        const newFav: SavedTrack = {
          id: String(currentTrack.id),
          title: currentTrack.title,
          artist: currentTrack.artist,
          streamUrl: currentTrack.url,
          artwork: artwork || currentTrack.artwork,
          addedAt: Date.now(),
        };
        nextFavorites = [newFav, ...favorites];
      }

      setFavorites(nextFavorites);
      await writePersistentValue(
        FAVORITES_STORAGE_KEY,
        JSON.stringify(nextFavorites)
      );
    },
    removeFavorite: async (idToRemove) => {
      const nextFavorites = favorites.filter(
        (f) => normalizeFavoriteId(f.id) !== normalizeFavoriteId(idToRemove)
      );
      setFavorites(nextFavorites);
      await writePersistentValue(
        FAVORITES_STORAGE_KEY,
        JSON.stringify(nextFavorites)
      );
    },
    playSaved: async (saved) => {
      const track: Track = {
        id: saved.id,
        title: saved.title,
        artist: saved.artist,
        artwork: saved.artwork,
        url: saved.streamUrl,
      };
      setQueue([track]);
      queueRef.current = [track];
      setCurrentTrack(track);
      await playSound(track);
    },
    volume,
    setVolume,
    loadingTrackId,
  };

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error("usePlayer must be used within a PlayerProvider");
  }
  return context;
};
