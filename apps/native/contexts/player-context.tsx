import { Audio, type AVPlaybackStatus } from "expo-av";
import * as SecureStore from "expo-secure-store";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import { losslessAPI } from "@/utils/api";
import type { AudioQuality as ApiAudioQuality } from "@/utils/types";

type AudioQuality = ApiAudioQuality;

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
  positionMillis: number;
  durationMillis: number;
  currentStreamUrl: string | null;
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
  playSaved: (saved: SavedTrack) => Promise<void>;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

const FAVORITES_STORAGE_KEY = "hififlow:favorites:v1";

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
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [queue, setQueue] = useState<Track[]>([]);
  const [quality, setQuality] = useState<AudioQuality>("LOSSLESS");
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [currentStreamUrl, setCurrentStreamUrl] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<SavedTrack[]>([]);

  const soundRef = useRef<Audio.Sound | null>(null);
  const currentTrackRef = useRef<Track | null>(null);
  const queueRef = useRef<Track[]>([]);
  const qualityRef = useRef<AudioQuality>(quality);
  const playNextRef = useRef<() => Promise<void>>(async () => {});
  const playRequestIdRef = useRef(0);
  const currentStreamUrlRef = useRef<string | null>(null);

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
    async function setupAudio() {
      try {
        await Audio.setAudioModeAsync({
          staysActiveInBackground: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch (e) {
        console.error("Error setting up audio mode", e);
      }
    }
    setupAudio();
  }, []);

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
    const sound = soundRef.current;
    if (sound) {
      try {
        sound.setOnPlaybackStatusUpdate(null);
        await sound.unloadAsync();
      } catch {
        // ignore
      }
    }
  }, []);

  const playSound = useCallback(async (track: Track) => {
    playRequestIdRef.current += 1;
    const requestId = playRequestIdRef.current;

    setIsLoading(true);
    setIsPlaying(false);

    // Unload previous sound first
    if (soundRef.current) {
      const previous = soundRef.current;
      try {
        previous.setOnPlaybackStatusUpdate(null);
        await previous.unloadAsync();
      } catch {
        // ignore
      }
      soundRef.current = null;
    }

    if (playRequestIdRef.current !== requestId) {
      return;
    }

    setPositionMillis(0);
    setDurationMillis(0);
    setCurrentStreamUrl(null);

    const trackId = Number(track.id);
    let streamUrl: string | null = null;

    if (Number.isFinite(trackId)) {
      try {
        streamUrl = await losslessAPI.getTrackStreamUrl(
          trackId,
          qualityRef.current
        );
      } catch {
        streamUrl = null;
      }
    }

    if (playRequestIdRef.current !== requestId) {
      return;
    }

    if (!streamUrl && track.url) {
      streamUrl = track.url;
    }

    if (!streamUrl) {
      if (playRequestIdRef.current === requestId) {
        setIsPlaying(false);
        setIsLoading(false);
        setCurrentStreamUrl(null);
      }
      return;
    }

    // Create new sound instance
    const sound = new Audio.Sound();
    soundRef.current = sound;

    try {
      sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
        if (playRequestIdRef.current !== requestId) return;
        if (!status.isLoaded) return;
        setIsPlaying(status.isPlaying);
        setPositionMillis(status.positionMillis);
        setDurationMillis(status.durationMillis ?? 0);
        if (status.didJustFinish) {
          void playNextRef.current();
        }
      });

      await sound.loadAsync(
        { uri: streamUrl },
        { shouldPlay: false, progressUpdateIntervalMillis: 500 }
      );

      // Check if we were interrupted
      if (soundRef.current !== sound) {
        await sound.unloadAsync();
        return;
      }

      if (playRequestIdRef.current !== requestId) {
        await sound.unloadAsync();
        return;
      }

      setCurrentStreamUrl(streamUrl);
      await sound.playAsync();

      if (playRequestIdRef.current !== requestId) {
        await sound.unloadAsync();
        return;
      }

      setIsLoading(false);
    } catch (error) {
      console.error("Error loading sound", error);
      if (playRequestIdRef.current === requestId) {
        if (soundRef.current === sound) {
          soundRef.current = null;
          setIsPlaying(false);
          setCurrentStreamUrl(null);
        }
        setIsLoading(false);
      }
    }
  }, []);

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
        setIsPlaying(false);
        return;
      }
      setCurrentTrack(startTrack);
      currentTrackRef.current = startTrack;
      await playSound(startTrack);
    },
    [playSound]
  );

  const pauseTrack = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;
    await sound.pauseAsync();
    setIsPlaying(false);
  }, []);

  const resumeTrack = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;
    await sound.playAsync();
    setIsPlaying(true);
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

  const seekToMillis = useCallback(
    async (nextPositionMillis: number) => {
      const sound = soundRef.current;
      if (!sound) return;
      const clamped = Math.min(
        Math.max(0, Math.floor(nextPositionMillis)),
        durationMillis > 0 ? durationMillis : Number.MAX_SAFE_INTEGER
      );
      await sound.setPositionAsync(clamped);
      setPositionMillis(clamped);
    },
    [durationMillis]
  );

  const seekByMillis = useCallback(
    async (deltaMillis: number) => {
      await seekToMillis(positionMillis + deltaMillis);
    },
    [positionMillis, seekToMillis]
  );

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
        setIsPlaying(false);
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
      setIsPlaying(false);
      return;
    }
    const currentIndex = nextQueue.findIndex((t) => t.id === active.id);
    if (currentIndex === -1) {
      setIsPlaying(false);
      return;
    }
    if (currentIndex < nextQueue.length - 1) {
      await playFromQueueIndex(currentIndex + 1);
      return;
    }
    setIsPlaying(false);
  }, [playFromQueueIndex]);

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
    if (currentIndex > 0) {
      await playFromQueueIndex(currentIndex - 1);
    }
  }, [playFromQueueIndex]);

  useEffect(() => {
    return () => {
      unloadSound();
    };
  }, [unloadSound]);

  return (
    <PlayerContext.Provider
      value={{
        currentTrack,
        isPlaying,
        isLoading,
        queue,
        quality,
        setQuality,
        positionMillis,
        durationMillis,
        currentStreamUrl,
        playTrack,
        playQueue,
        pauseTrack,
        resumeTrack,
        seekToMillis,
        seekByMillis,
        addToQueue,
        playNext,
        playPrevious,
        favorites,
        isCurrentFavorited: Boolean(
          currentTrack &&
            favorites.some(
              (entry) => entry.id === normalizeFavoriteId(currentTrack.id)
            )
        ),
        toggleCurrentFavorite,
        playSaved,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error("usePlayer must be used within a PlayerProvider");
  }
  return context;
};
