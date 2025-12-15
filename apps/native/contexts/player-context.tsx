import { Audio, type AVPlaybackStatus } from "expo-av";
import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { losslessAPI } from "@/utils/api";

type AudioQuality = "LOW" | "HIGH" | "LOSSLESS" | "HIRES_LOSSLESS";

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
  queue: Track[];
  quality: AudioQuality;
  setQuality: (quality: AudioQuality) => void;
  playTrack: (track: Track) => void;
  pauseTrack: () => void;
  resumeTrack: () => void;
  addToQueue: (track: Track) => void;
  playNext: () => void;
  playPrevious: () => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queue, setQueue] = useState<Track[]>([]);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [quality, setQuality] = useState<AudioQuality>("LOSSLESS");

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

  // Basic Expo AV implementation for now
  async function playSound(trackId: string) {
    const track = await losslessAPI.getTrackStreamUrl(+trackId);

    if (sound) {
      await sound.unloadAsync();
    }

    try {
      const streamUrl = track || "";
      if (!streamUrl) {
        console.error("Track URL is empty");
        return;
      }

      const { sound: newSound } = await Audio.Sound.createAsync({
        uri: streamUrl,
      });
      setSound(newSound);
      console.log("Playing Sound");
      await newSound.playAsync();
      setIsPlaying(true);

      newSound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
        if (status.isLoaded) {
          if (status.didJustFinish) {
            setIsPlaying(false);
            playNext();
          }
        }
      });
    } catch (e) {
      console.error("Error playing sound", e);
    }
  }

  const playTrack = async (track: Track) => {
    setCurrentTrack(track);
    await playSound(track.id);
  };

  const pauseTrack = async () => {
    if (sound) {
      await sound.pauseAsync();
      setIsPlaying(false);
    }
  };

  const resumeTrack = async () => {
    if (sound) {
      await sound.playAsync();
      setIsPlaying(true);
    }
  };

  const addToQueue = (track: Track) => {
    setQueue((prev) => [...prev, track]);
  };

  const playNext = async () => {
    if (!currentTrack) return;
    const currentIndex = queue.findIndex((t) => t.id === currentTrack.id);
    if (currentIndex < queue.length - 1) {
      const nextTrack = queue[currentIndex + 1];
      await playTrack(nextTrack);
    } else {
      setIsPlaying(false);
    }
  };

  const playPrevious = async () => {
    if (!currentTrack) return;
    const currentIndex = queue.findIndex((t) => t.id === currentTrack.id);
    if (currentIndex > 0) {
      const prevTrack = queue[currentIndex - 1];
      await playTrack(prevTrack);
    }
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [sound]);

  return (
    <PlayerContext.Provider
      value={{
        currentTrack,
        isPlaying,
        queue,
        quality,
        setQuality,
        playTrack,
        pauseTrack,
        resumeTrack,
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
