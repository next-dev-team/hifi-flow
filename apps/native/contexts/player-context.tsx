import {
  type AudioAnalysis,
  extractAudioAnalysis,
} from "@siteed/expo-audio-studio";
import {
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
  recentlyPlayed: SavedTrack[];
  isCurrentFavorited: boolean;
  toggleCurrentFavorite: (artwork?: string) => Promise<void>;
  removeFavorite: (id: string) => Promise<void>;
  removeFromRecentlyPlayed: (id: string) => Promise<void>;
  playSaved: (saved: SavedTrack) => Promise<void>;
  volume: number;
  setVolume: (volume: number) => Promise<void>;
  loadingTrackId: string | null;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

const FAVORITES_STORAGE_KEY = "hififlow:favorites:v1";
const RECENTLY_PLAYED_STORAGE_KEY = "hififlow:recently_played:v1";
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
  const [player, setPlayer] = useState<AudioPlayer | null>(null);
  const [status, setStatus] = useState<AudioStatus | null>(null);

  // Status listener
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

  const isPlaying = status?.playing ?? false;
  const isLoading = status?.isBuffering ?? false;
  const positionMillis = (status?.currentTime ?? 0) * 1000;
  const durationMillis = (status?.duration ?? 0) * 1000;

  const [queue, setQueue] = useState<Track[]>([]);
  const [quality, setQualityState] = useState<AudioQuality>("HI_RES_LOSSLESS");
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [currentStreamUrl, setCurrentStreamUrl] = useState<string | null>(null);
  const [audioAnalysis, setAudioAnalysis] = useState<AudioAnalysis | null>(
    null
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [favorites, setFavorites] = useState<SavedTrack[]>([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState<SavedTrack[]>([]);
  const [volume, setVolumeState] = useState(1.0);
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState<number | null>(null);
  const [sleepTimerRemainingMs, setSleepTimerRemainingMs] = useState(0);
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);
  const { showToast } = useToast();

  const setQuality = useCallback((newQuality: AudioQuality) => {
    setQualityState(newQuality);
    void writePersistentValue(QUALITY_STORAGE_KEY, newQuality);
  }, []);

  const playerRef = useRef<AudioPlayer | null>(null);
  // Store preloaded players: key is track ID
  const preloadedPlayersRef = useRef<
    Map<string, { player: AudioPlayer; url: string; trackId: string }>
  >(new Map());
  const shuffleHistoryRef = useRef<number[]>([]);
  const plannedShuffleIndicesRef = useRef<number[]>([]);

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

  const resetPreloadedPlayers = useCallback(() => {
    preloadedPlayersRef.current.forEach((item) => {
      item.player.remove();
    });
    preloadedPlayersRef.current.clear();
    plannedShuffleIndicesRef.current = [];
  }, []);

  const getStreamUrlForTrack = useCallback(
    async (track: Track, currentQuality: AudioQuality) => {
      const trackId = Number(track.id);
      let streamUrl: string | null = null;

      const savedTrack =
        recentlyPlayed.find((t) => String(t.id) === String(track.id)) ||
        favorites.find((t) => String(t.id) === String(track.id));

      if (savedTrack?.streamUrl) {
        return savedTrack.streamUrl;
      }

      if (Number.isFinite(trackId)) {
        try {
          streamUrl = await losslessAPI.getStreamUrl(trackId, currentQuality);
        } catch {
          streamUrl = null;
        }
      }

      if (!streamUrl && track.url) {
        streamUrl = track.url;
      }

      return streamUrl;
    },
    [recentlyPlayed, favorites]
  );

  const unloadSound = useCallback(async () => {
    resetPreloadedPlayers();
    const sound = playerRef.current;
    if (sound) {
      sound.remove();
      playerRef.current = null;
      setPlayer(null);
    }
    setLoadingTrackId(null);
  }, [resetPreloadedPlayers]);

  const addToRecentlyPlayed = useCallback(
    async (track: Track, streamUrl: string) => {
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
          newHistory = [
            newTrack,
            ...prev.filter((_, i) => i !== existingIndex),
          ];
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
    },
    []
  );

  const playSound = useCallback(
    async (track: Track) => {
      setLoadingTrackId(String(track.id));

      // Stop current player
      if (playerRef.current) {
        playerRef.current.remove();
        playerRef.current = null;
        setPlayer(null);
      }

      setAudioAnalysis(null);
      setIsAnalyzing(false);
      setCurrentStreamUrl(null);

      // Check if preloaded
      const preloaded = preloadedPlayersRef.current.get(String(track.id));
      if (preloaded) {
        // Use preloaded player
        const newPlayer = preloaded.player;
        playerRef.current = newPlayer;
        setPlayer(newPlayer);
        newPlayer.volume = volume;
        setCurrentStreamUrl(preloaded.url);
        newPlayer.play();
        setLoadingTrackId(null);

        // Remove from preloaded map as we are using it
        preloadedPlayersRef.current.delete(String(track.id));
        return;
      }

      // If not preloaded, fetch and play
      const streamUrl = await getStreamUrlForTrack(track, quality);
      if (!streamUrl) {
        setLoadingTrackId(null);
        showToast({ message: "Stream URL not found", type: "error" });
        return;
      }

      try {
        const newPlayer = createAudioPlayer(streamUrl, {
          downloadFirst: false,
          updateInterval: 250,
        });
        playerRef.current = newPlayer;
        setPlayer(newPlayer);
        newPlayer.volume = volume;
        setCurrentStreamUrl(streamUrl);
        newPlayer.play();

        void addToRecentlyPlayed(track, streamUrl);
      } catch (error) {
        console.error("Playback failed", error);
        showToast({ message: "Playback failed", type: "error" });
      } finally {
        setLoadingTrackId(null);
      }
    },
    [volume, quality, getStreamUrlForTrack, showToast, addToRecentlyPlayed]
  );

  // Preloading Logic
  const preloadNextTracks = useCallback(async () => {
    if (!currentTrack || queue.length === 0) return;

    const currentIndex = queue.findIndex((t) => t.id === currentTrack.id);
    if (currentIndex === -1) return;

    const tracksToPreload: Track[] = [];

    // Determine next 2 tracks
    if (shuffleEnabled) {
      // Logic for shuffle: use planned indices or pick new ones
      const availableIndices: number[] = [];
      queue.forEach((_, i) => {
        if (i !== currentIndex && !shuffleHistoryRef.current.includes(i)) {
          availableIndices.push(i);
        }
      });

      // If we already have planned indices, verify they are still valid
      const planned = [...plannedShuffleIndicesRef.current];

      // Need 2 tracks
      while (planned.length < 2 && availableIndices.length > 0) {
        const randomIdx = Math.floor(Math.random() * availableIndices.length);
        const pickedIndex = availableIndices[randomIdx];
        if (!planned.includes(pickedIndex)) {
          planned.push(pickedIndex);
          // Remove from available to avoid picking same
          availableIndices.splice(randomIdx, 1);
        } else {
          // Should not happen if logic is correct
          availableIndices.splice(randomIdx, 1);
        }
      }

      plannedShuffleIndicesRef.current = planned;
      planned.forEach((idx) => {
        if (queue[idx]) tracksToPreload.push(queue[idx]);
      });
    } else {
      // Normal order
      if (repeatMode === "one") {
        // Next is same track? Usually we don't preload same track if it's already playing,
        // but if it's "one", we might want to restart it quickly.
        // But let's assume "one" just loops.
      } else {
        let nextIdx1 = currentIndex + 1;
        let nextIdx2 = currentIndex + 2;

        if (nextIdx1 >= queue.length) {
          if (repeatMode === "all") nextIdx1 = 0;
          else nextIdx1 = -1;
        }

        if (nextIdx2 >= queue.length) {
          if (repeatMode === "all") nextIdx2 = nextIdx2 % queue.length;
          else nextIdx2 = -1;
        }

        if (nextIdx1 !== -1) tracksToPreload.push(queue[nextIdx1]);
        if (nextIdx2 !== -1) tracksToPreload.push(queue[nextIdx2]);
      }
    }

    // Perform Preloading
    // 1. Remove players not in tracksToPreload
    const neededIds = new Set(tracksToPreload.map((t) => String(t.id)));
    for (const [id, item] of preloadedPlayersRef.current.entries()) {
      if (!neededIds.has(id)) {
        item.player.remove();
        preloadedPlayersRef.current.delete(id);
      }
    }

    // 2. Add new players
    for (const track of tracksToPreload) {
      const id = String(track.id);
      if (!preloadedPlayersRef.current.has(id)) {
        const url = await getStreamUrlForTrack(track, quality);
        if (url) {
          const player = createAudioPlayer(url, {
            downloadFirst: false,
            updateInterval: 250,
          });
          // We don't play, just create.
          preloadedPlayersRef.current.set(id, { player, url, trackId: id });
        }
      }
    }
  }, [
    currentTrack,
    queue,
    shuffleEnabled,
    repeatMode,
    quality,
    getStreamUrlForTrack,
  ]);

  // Trigger preloading
  useEffect(() => {
    if (isPlaying || isLoading) {
      void preloadNextTracks();
    }
  }, [isPlaying, isLoading, preloadNextTracks]);

  const playQueue = useCallback(
    async (tracks: Track[], startIndex = 0) => {
      setQueue(tracks);
      // Reset shuffle history when new queue starts
      shuffleHistoryRef.current = [];
      plannedShuffleIndicesRef.current = [];

      const startTrack = tracks[startIndex] ?? tracks[0];
      if (startTrack) {
        setCurrentTrack(startTrack);
        await playSound(startTrack);
      }
    },
    [playSound]
  );

  const playTrack = useCallback(
    async (track: Track) => {
      setQueue([track]);
      setCurrentTrack(track);
      shuffleHistoryRef.current = [];
      plannedShuffleIndicesRef.current = [];
      await playSound(track);
    },
    [playSound]
  );

  const playNext = useCallback(async () => {
    if (!currentTrack || queue.length === 0) return;

    const currentIndex = queue.findIndex((t) => t.id === currentTrack.id);
    if (currentIndex === -1) return;

    let nextIndex = -1;

    if (shuffleEnabled) {
      // Use planned if available
      if (plannedShuffleIndicesRef.current.length > 0) {
        nextIndex = plannedShuffleIndicesRef.current.shift()!;
      } else {
        // Fallback if no planned
        const available: number[] = [];
        for (let i = 0; i < queue.length; i++) {
          if (i !== currentIndex && !shuffleHistoryRef.current.includes(i)) {
            available.push(i);
          }
        }
        if (available.length > 0) {
          nextIndex = available[Math.floor(Math.random() * available.length)];
        } else if (repeatMode === "all") {
          // Reset history
          shuffleHistoryRef.current = [];
          nextIndex = Math.floor(Math.random() * queue.length);
        }
      }

      if (nextIndex !== -1) {
        shuffleHistoryRef.current.push(nextIndex);
      }
    } else {
      if (currentIndex < queue.length - 1) {
        nextIndex = currentIndex + 1;
      } else if (repeatMode === "all") {
        nextIndex = 0;
      }
    }

    if (nextIndex !== -1) {
      const nextTrack = queue[nextIndex];
      setCurrentTrack(nextTrack);
      await playSound(nextTrack);
    }
  }, [currentTrack, queue, shuffleEnabled, repeatMode, playSound]);

  const playPrevious = useCallback(async () => {
    if (!currentTrack || queue.length === 0) return;
    const currentIndex = queue.findIndex((t) => t.id === currentTrack.id);

    // If more than 3 seconds played, restart
    if (positionMillis > 3000) {
      if (playerRef.current) playerRef.current.seekTo(0);
      return;
    }

    let prevIndex = -1;

    if (shuffleEnabled) {
      // Pop from history
      if (shuffleHistoryRef.current.length > 0) {
        prevIndex = shuffleHistoryRef.current.pop()!;
        // Make sure it's not current?
        if (
          prevIndex === currentIndex &&
          shuffleHistoryRef.current.length > 0
        ) {
          prevIndex = shuffleHistoryRef.current.pop()!;
        }
      }
    } else {
      if (currentIndex > 0) {
        prevIndex = currentIndex - 1;
      } else if (repeatMode === "all") {
        prevIndex = queue.length - 1;
      }
    }

    if (prevIndex !== -1) {
      const prevTrack = queue[prevIndex];
      setCurrentTrack(prevTrack);
      await playSound(prevTrack);
    }
  }, [
    currentTrack,
    queue,
    shuffleEnabled,
    repeatMode,
    positionMillis,
    playSound,
  ]);

  // Playback finish listener
  useEffect(() => {
    if (status?.didJustFinish) {
      if (repeatMode === "one") {
        if (playerRef.current) {
          playerRef.current.seekTo(0);
          playerRef.current.play();
        }
      } else {
        void playNext();
      }
    }
  }, [status?.didJustFinish, repeatMode, playNext]);

  // ... Rest of the context methods (toggleShuffle, cycleRepeatMode, etc) ...
  // Need to implement the rest of the file logic like persistence etc.

  // Persistence effects
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

    // Favorites and Recently Played loading
    readPersistentValue(FAVORITES_STORAGE_KEY).then((val) => {
      if (val) setFavorites(JSON.parse(val));
    });
    readPersistentValue(RECENTLY_PLAYED_STORAGE_KEY).then((val) => {
      if (val) setRecentlyPlayed(JSON.parse(val));
    });
  }, []);

  // Analysis logic (simplified from original)
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

  const setVolume = useCallback(async (val: number) => {
    const v = Math.max(0, Math.min(1, val));
    setVolumeState(v);
    if (playerRef.current) playerRef.current.volume = v;
    void writePersistentValue(VOLUME_STORAGE_KEY, String(v));
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffleEnabled((prev) => {
      const next = !prev;
      void writePersistentValue(SHUFFLE_STORAGE_KEY, String(next));
      if (!next) {
        shuffleHistoryRef.current = [];
        plannedShuffleIndicesRef.current = [];
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
        url: saved.streamUrl,
      };
      await playTrack(track);
    },
    [playTrack]
  );

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
    startSleepTimer: useCallback(
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
    ),
    cancelSleepTimer: useCallback(() => {
      clearSleepTimerHandles();
      setSleepTimerEndsAt(null);
      setSleepTimerRemainingMs(0);
      void writePersistentValue(SLEEP_TIMER_KEY, "");
    }, [clearSleepTimerHandles]),
    playTrack,
    playQueue,
    pauseTrack: async () => playerRef.current?.pause(),
    resumeTrack: async () => playerRef.current?.play(),
    seekToMillis: async (pos) => playerRef.current?.seekTo(pos / 1000),
    seekByMillis: async (delta) =>
      playerRef.current?.seekTo(playerRef.current.currentTime + delta / 1000),
    addToQueue: (track) => setQueue((prev) => [...prev, track]),
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
    removeFavorite,
    removeFromRecentlyPlayed,
    playSaved,
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
  if (!context)
    throw new Error("usePlayer must be used within a PlayerProvider");
  return context;
};
