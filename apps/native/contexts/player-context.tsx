import { Audio, type AVPlaybackStatus } from "expo-av";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { losslessAPI } from "@/utils/api";
import type { AudioQuality as ApiAudioQuality } from "@/utils/types";

type AudioQuality = ApiAudioQuality;

interface Track {
  id: string;
  title: string;
  artist: string;
  artwork?: string;
  url: string;
  duration?: number;
}

interface PlayerContextType {
  currentTrack: Track | null;
  isPlaying: boolean;
  isLoading: boolean;
  queue: Track[];
  quality: AudioQuality;
  setQuality: (quality: AudioQuality) => void;
  positionMillis: number;
  durationMillis: number;
  playTrack: (track: Track) => Promise<void>;
  playQueue: (tracks: Track[], startIndex?: number) => Promise<void>;
  pauseTrack: () => Promise<void>;
  resumeTrack: () => Promise<void>;
  seekToMillis: (positionMillis: number) => Promise<void>;
  seekByMillis: (deltaMillis: number) => Promise<void>;
  addToQueue: (track: Track) => void;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

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

  const soundRef = useRef<Audio.Sound | null>(null);
  const currentTrackRef = useRef<Track | null>(null);
  const queueRef = useRef<Track[]>([]);
  const qualityRef = useRef<AudioQuality>(quality);
  const playNextRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

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

  const unloadSound = useCallback(async () => {
    const sound = soundRef.current;
    if (sound) {
      try {
        await sound.unloadAsync();
      } catch {
        // ignore
      }
    }
  }, []);

  const playSound = useCallback(
    async (track: Track) => {
      setIsLoading(true);
      // Unload previous sound first
      if (soundRef.current) {
        try {
          await soundRef.current.unloadAsync();
        } catch {
          // ignore
        }
        soundRef.current = null;
      }

      setPositionMillis(0);
      setDurationMillis(0);

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

      if (!streamUrl && track.url) {
        streamUrl = track.url;
      }

      if (!streamUrl) {
        setIsPlaying(false);
        setIsLoading(false);
        return;
      }

      // Create new sound instance
      const sound = new Audio.Sound();
      soundRef.current = sound;

      try {
        sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
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
          { shouldPlay: true, progressUpdateIntervalMillis: 500 }
        );

        // Check if we were interrupted
        if (soundRef.current !== sound) {
          await sound.unloadAsync();
          return;
        }
        
        setIsLoading(false);
      } catch (error) {
        console.error("Error loading sound", error);
        if (soundRef.current === sound) {
           soundRef.current = null;
           setIsPlaying(false);
        }
        setIsLoading(false);
      }
    },
    []
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
      const nextQueue = tracks.filter(
        (candidate): candidate is Track =>
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

  const seekToMillis = useCallback(async (nextPositionMillis: number) => {
    const sound = soundRef.current;
    if (!sound) return;
    const clamped = Math.min(
      Math.max(0, Math.floor(nextPositionMillis)),
      durationMillis > 0 ? durationMillis : Number.MAX_SAFE_INTEGER
    );
    await sound.setPositionAsync(clamped);
    setPositionMillis(clamped);
  }, [durationMillis]);

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
        playTrack,
        playQueue,
        pauseTrack,
        resumeTrack,
        seekToMillis,
        seekByMillis,
        addToQueue,
        playNext,
        playPrevious,
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
