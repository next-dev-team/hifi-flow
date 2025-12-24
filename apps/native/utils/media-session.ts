/**
 * Media Session Service for background playback and lock screen controls
 *
 * This service provides:
 * - Lock screen media controls (play/pause/next/previous)
 * - Notification bar controls
 * - Background audio playback support
 *
 * Note: For full background playback support, you need to install react-native-track-player:
 * npx expo install react-native-track-player
 *
 * This module provides a bridge that can be used with either expo-audio or react-native-track-player
 */

import { Platform } from "react-native";
import type { AudioPlayer, AudioMetadata } from "expo-audio";

export interface MediaSessionTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  duration?: number;
}

export interface MediaSessionState {
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  playbackRate: number;
}

export interface MediaSessionHandlers {
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  onSeekTo?: (positionMs: number) => void;
  onSeekForward?: (offsetMs: number) => void;
  onSeekBackward?: (offsetMs: number) => void;
  onNextTrack?: () => void;
  onPreviousTrack?: () => void;
}

class MediaSessionService {
  private handlers: MediaSessionHandlers = {};
  private currentTrack: MediaSessionTrack | null = null;
  private currentState: MediaSessionState = {
    isPlaying: false,
    positionMs: 0,
    durationMs: 0,
    playbackRate: 1.0,
  };
  private player: AudioPlayer | null = null;

  /**
   * Set the AudioPlayer instance for native lock screen controls (Expo Audio)
   */
  setPlayer(player: AudioPlayer | null) {
    this.player = player;
    if (this.player && Platform.OS !== "web") {
      // Enable lock screen controls
      const metadata: AudioMetadata = {
        title: this.currentTrack?.title ?? "Ui Stream",
        artist: this.currentTrack?.artist ?? "Siteed",
        albumTitle: this.currentTrack?.album,
        artworkUrl: this.currentTrack?.artwork,
      };

      this.player.setActiveForLockScreen(true, metadata);

      // Note: The previous event handler for 'play', 'pause', etc. was removed
      // because setActiveForLockScreen now expects AudioMetadata as the second argument.
      // You may need to set up event listeners separately if supported by the library.
    }
  }

  /**
   * Check if Media Session API is available (Web only)
   */
  private isMediaSessionAvailable(): boolean {
    return Platform.OS === "web" && "mediaSession" in navigator;
  }

  /**
   * Set media session action handlers
   */
  setHandlers(handlers: MediaSessionHandlers) {
    this.handlers = handlers;

    if (this.isMediaSessionAvailable()) {
      this.setupWebMediaSession();
    }
  }

  /**
   * Setup Web Media Session API handlers
   */
  private setupWebMediaSession() {
    if (!this.isMediaSessionAvailable()) return;

    const session = navigator.mediaSession;

    if (this.handlers.onPlay) {
      session.setActionHandler("play", () => this.handlers.onPlay?.());
    }

    if (this.handlers.onPause) {
      session.setActionHandler("pause", () => this.handlers.onPause?.());
    }

    if (this.handlers.onStop) {
      session.setActionHandler("stop", () => this.handlers.onStop?.());
    }

    if (this.handlers.onSeekTo) {
      session.setActionHandler("seekto", (details) => {
        if (details.seekTime !== undefined) {
          this.handlers.onSeekTo?.(details.seekTime * 1000);
        }
      });
    }

    if (this.handlers.onSeekForward) {
      session.setActionHandler("seekforward", (details) => {
        this.handlers.onSeekForward?.((details.seekOffset ?? 10) * 1000);
      });
    }

    if (this.handlers.onSeekBackward) {
      session.setActionHandler("seekbackward", (details) => {
        this.handlers.onSeekBackward?.((details.seekOffset ?? 10) * 1000);
      });
    }

    if (this.handlers.onNextTrack) {
      session.setActionHandler("nexttrack", () =>
        this.handlers.onNextTrack?.()
      );
    }

    if (this.handlers.onPreviousTrack) {
      session.setActionHandler("previoustrack", () =>
        this.handlers.onPreviousTrack?.()
      );
    }
  }

  /**
   * Update the current track metadata
   */
  updateTrack(track: MediaSessionTrack) {
    this.currentTrack = track;

    if (this.isMediaSessionAvailable()) {
      const artwork: MediaImage[] = [];
      if (track.artwork) {
        artwork.push({
          src: track.artwork,
          sizes: "512x512",
          type: "image/jpeg",
        });
      }

      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album ?? "",
        artwork,
      });
    }

    // Native support (Expo Audio)
    if (this.player && Platform.OS !== "web") {
      const metadata: AudioMetadata = {
        title: track.title,
        artist: track.artist,
        albumTitle: track.album,
        artworkUrl: track.artwork,
      };
      this.player.updateLockScreenMetadata(metadata);
    }
  }

  /**
   * Update playback state
   */
  updatePlaybackState(state: Partial<MediaSessionState>) {
    this.currentState = { ...this.currentState, ...state };

    if (this.isMediaSessionAvailable()) {
      navigator.mediaSession.playbackState = this.currentState.isPlaying
        ? "playing"
        : "paused";

      // Update position state if duration is available
      if (this.currentState.durationMs > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: this.currentState.durationMs / 1000,
            position: this.currentState.positionMs / 1000,
            playbackRate: this.currentState.playbackRate,
          });
        } catch (error) {
          // Position state might not be supported in all browsers
          console.debug("MediaSession position state not supported:", error);
        }
      }
    }
  }

  /**
   * Clear media session
   */
  clear() {
    this.currentTrack = null;
    this.currentState = {
      isPlaying: false,
      positionMs: 0,
      durationMs: 0,
      playbackRate: 1.0,
    };

    if (this.isMediaSessionAvailable()) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }

    if (this.player && Platform.OS !== "web") {
      this.player.setActiveForLockScreen(false);
    }
  }

  /**
   * Get current track
   */
  getCurrentTrack(): MediaSessionTrack | null {
    return this.currentTrack;
  }

  /**
   * Get current state
   */
  getCurrentState(): MediaSessionState {
    return { ...this.currentState };
  }
}

/**
 * Singleton instance of the Media Session Service
 */
export const mediaSessionService = new MediaSessionService();

/**
 * Helper hook to get media session availability
 */
export function useMediaSessionAvailable(): boolean {
  return Platform.OS === "web" && "mediaSession" in navigator;
}
