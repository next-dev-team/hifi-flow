import {
  type AudioAnalysis,
  extractAudioAnalysis,
} from "@siteed/expo-audio-studio";
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
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

const FAVORITES_STORAGE_KEY = "hififlow:favorites:v1";
const QUALITY_STORAGE_KEY = "hififlow:quality:v1";
const SHUFFLE_STORAGE_KEY = "hififlow:shuffle:v1";
const REPEAT_STORAGE_KEY = "hififlow:repeat:v1";
const VOLUME_STORAGE_KEY = "hififlow:volume:v1";

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
  const [quality, setQualityState] = useState<AudioQuality>("HI_RES_LOSSLESS");
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(0);
  const [currentStreamUrl, setCurrentStreamUrl] = useState<string | null>(null);
  const [audioAnalysis, setAudioAnalysis] = useState<AudioAnalysis | null>(
    null
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [favorites, setFavorites] = useState<SavedTrack[]>([]);
  const [volume, setVolumeState] = useState(1.0);
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState<number | null>(null);
  const [sleepTimerRemainingMs, setSleepTimerRemainingMs] = useState(0);

  const setQuality = useCallback((newQuality: AudioQuality) => {
    setQualityState(newQuality);
    void writePersistentValue(QUALITY_STORAGE_KEY, newQuality);
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
  }, []);

  const soundRef = useRef<Audio.Sound | null>(null);
  const preloadedSoundRef = useRef<Audio.Sound | null>(null);
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
    const previous = preloadedSoundRef.current;
    preloadedSoundRef.current = null;
    if (previous) {
      try {
        previous.setOnPlaybackStatusUpdate(null);
        await previous.unloadAsync();
      } catch {
        return preloadRequestIdRef.current;
      }
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

      const sound = new Audio.Sound();
      try {
        await sound.loadAsync(
          { uri: streamUrl },
          { shouldPlay: false, progressUpdateIntervalMillis: 250 }
        );

        if (
          playRequestIdRef.current !== playRequestId ||
          preloadRequestIdRef.current !== preloadId
        ) {
          await sound.unloadAsync();
          return;
        }

        preloadedSoundRef.current = sound;
        preloadedTrackKeyRef.current = nextKey;
        preloadedStreamUrlRef.current = streamUrl;
      } catch {
        try {
          await sound.unloadAsync();
        } catch {
          return;
        }
      }
    },
    [getStreamUrlForTrack, getTrackKey, resetPreloadState]
  );

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
    await resetPreloadState();
    const sound = soundRef.current;
    if (sound) {
      try {
        sound.setOnPlaybackStatusUpdate(null);
        await sound.unloadAsync();
      } catch {
        return;
      }
    }
  }, [resetPreloadState]);

  const setVolume = useCallback(async (value: number) => {
    const normalized = Math.max(0, Math.min(1, value));
    setVolumeState(normalized);
    void writePersistentValue(VOLUME_STORAGE_KEY, String(normalized));
    if (soundRef.current) {
      try {
        await soundRef.current.setVolumeAsync(normalized);
      } catch {
        // ignore
      }
    }
  }, []);

  const analyzeTrack = useCallback(async (uri: string, requestId: number) => {
    setIsAnalyzing(true);
    setAudioAnalysis(null);
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

  const playSound = useCallback(
    async (track: Track) => {
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

      const wantedKey = getTrackKey(track, qualityRef.current);
      const maybePreloadedSound = preloadedSoundRef.current;
      const maybePreloadedKey = preloadedTrackKeyRef.current;
      const maybePreloadedUrl = preloadedStreamUrlRef.current;

      if (
        maybePreloadedSound &&
        maybePreloadedKey === wantedKey &&
        typeof maybePreloadedUrl === "string" &&
        maybePreloadedUrl.length > 0
      ) {
        preloadedSoundRef.current = null;
        preloadedTrackKeyRef.current = null;
        preloadedStreamUrlRef.current = null;

        let status: AVPlaybackStatus;
        try {
          status = await maybePreloadedSound.getStatusAsync();
        } catch {
          try {
            await maybePreloadedSound.unloadAsync();
          } catch {
            return;
          }
          return;
        }

        if (!status.isLoaded) {
          try {
            await maybePreloadedSound.unloadAsync();
          } catch {
            return;
          }
          return;
        }

        const sound = maybePreloadedSound;
        soundRef.current = sound;

        try {
          sound.setOnPlaybackStatusUpdate((nextStatus: AVPlaybackStatus) => {
            if (playRequestIdRef.current !== requestId) return;
            if (!nextStatus.isLoaded) return;
            setIsPlaying(nextStatus.isPlaying);
            setPositionMillis(nextStatus.positionMillis);
            setDurationMillis(nextStatus.durationMillis ?? 0);
            if (nextStatus.didJustFinish) {
              if (repeatModeRef.current === "one") {
                void (async () => {
                  try {
                    await sound.setPositionAsync(0);
                    await sound.playAsync();
                  } catch {
                    return;
                  }
                })();
                return;
              }
              void playNextRef.current();
            }
          });

          await sound.setVolumeAsync(volume);

          if (soundRef.current !== sound) {
            await sound.unloadAsync();
            return;
          }

          if (playRequestIdRef.current !== requestId) {
            await sound.unloadAsync();
            return;
          }

          setCurrentStreamUrl(maybePreloadedUrl);
          void analyzeTrack(maybePreloadedUrl, requestId);
          await sound.playAsync();

          if (playRequestIdRef.current !== requestId) {
            await sound.unloadAsync();
            return;
          }

          setIsLoading(false);
          void preloadNextForTrack(
            track,
            requestId,
            `${qualityRef.current}|${repeatModeRef.current}|${shuffleEnabledRef.current}|${queueRef.current.length}`
          );
          return;
        } catch {
          if (playRequestIdRef.current === requestId) {
            if (soundRef.current === sound) {
              soundRef.current = null;
              setIsPlaying(false);
              setCurrentStreamUrl(null);
            }
            setIsLoading(false);
          }
          return;
        }
      }

      void resetPreloadState();

      const streamUrl = await getStreamUrlForTrack(track);

      if (playRequestIdRef.current !== requestId) {
        return;
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
            if (repeatModeRef.current === "one") {
              void (async () => {
                try {
                  await sound.setPositionAsync(0);
                  await sound.playAsync();
                } catch {
                  return;
                }
              })();
              return;
            }
            void playNextRef.current();
          }
        });

        await sound.loadAsync(
          { uri: streamUrl },
          { shouldPlay: false, progressUpdateIntervalMillis: 250 }
        );

        // Apply current volume
        await sound.setVolumeAsync(volume);

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
        void analyzeTrack(streamUrl, requestId);
        await sound.playAsync();

        if (playRequestIdRef.current !== requestId) {
          await sound.unloadAsync();
          return;
        }

        setIsLoading(false);
        void preloadNextForTrack(
          track,
          requestId,
          `${qualityRef.current}|${repeatModeRef.current}|${shuffleEnabledRef.current}|${queueRef.current.length}`
        );
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
    },
    [
      volume,
      analyzeTrack,
      getStreamUrlForTrack,
      getTrackKey,
      preloadNextForTrack,
      resetPreloadState,
    ]
  );

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
    try {
      const status = await sound.getStatusAsync();
      if (status.isLoaded) {
        await sound.pauseAsync();
      }
    } catch (e) {
      // ignore errors if sound is not loaded
    }
    setIsPlaying(false);
  }, []);

  const cancelSleepTimer = useCallback(() => {
    clearSleepTimerHandles();
    setSleepTimerEndsAt(null);
    setSleepTimerRemainingMs(0);
  }, [clearSleepTimerHandles]);

  const startSleepTimer = useCallback(
    (minutes: number) => {
      const ms = Math.max(0, Math.floor(minutes * 60 * 1000));
      clearSleepTimerHandles();
      if (ms <= 0) {
        setSleepTimerEndsAt(null);
        setSleepTimerRemainingMs(0);
        return;
      }

      const endsAt = Date.now() + ms;
      setSleepTimerEndsAt(endsAt);
      setSleepTimerRemainingMs(ms);

      sleepTimerIntervalRef.current = setInterval(() => {
        const remaining = Math.max(0, endsAt - Date.now());
        setSleepTimerRemainingMs(remaining);
      }, 1000);

      sleepTimerTimeoutRef.current = setTimeout(() => {
        void pauseTrack();
        clearSleepTimerHandles();
        setSleepTimerEndsAt(null);
        setSleepTimerRemainingMs(0);
      }, ms);
    },
    [clearSleepTimerHandles, pauseTrack]
  );

  const resumeTrack = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;
    try {
      const status = await sound.getStatusAsync();
      if (status.isLoaded) {
        await sound.playAsync();
        setIsPlaying(true);
      }
    } catch (e) {
      // ignore errors if sound is not loaded
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

  const seekToMillis = useCallback(
    async (nextPositionMillis: number) => {
      const sound = soundRef.current;
      if (!sound) return;

      try {
        const status = await sound.getStatusAsync();
        if (!status.isLoaded) return;

        const clamped = Math.min(
          Math.max(0, Math.floor(nextPositionMillis)),
          durationMillis > 0 ? durationMillis : Number.MAX_SAFE_INTEGER
        );
        await sound.setPositionAsync(clamped);
        setPositionMillis(clamped);
      } catch (e) {
        // ignore errors if sound is not loaded
      }
    },
    [durationMillis]
  );

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

    setIsPlaying(false);
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

  useEffect(() => {
    if (!isPlaying) return;
    const active = currentTrackRef.current;
    if (!active) return;
    void preloadNextForTrack(
      active,
      playRequestIdRef.current,
      preloadTriggerKey
    );
  }, [isPlaying, preloadNextForTrack, preloadTriggerKey]);

  return (
    <PlayerContext.Provider
      value={{
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
        removeFavorite,
        playSaved,
        volume,
        setVolume,
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
