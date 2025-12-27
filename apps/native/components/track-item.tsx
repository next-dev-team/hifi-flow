import { Ionicons } from "@expo/vector-icons";
import type React from "react";
import { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useAppTheme } from "@/contexts/app-theme-context";
import { usePlayer } from "@/contexts/player-context";
import { useThemeColor } from "heroui-native";

export interface Track {
  id: string;
  title: string;
  artist: string;
  artwork?: string;
  url: string;
  duration?: number;
}

export interface TrackItemProps {
  track: Track;
  onPress?: () => void;
  onLongPress?: () => void;
  onRemove?: () => void;
  isLoading?: boolean;
  isCached?: boolean;
  /** Index in queue - used to determine if this is the "next" track */
  queueIndex?: number;
}

/**
 * Flashing indicator component for pre-buffer status
 */
const BufferIndicator: React.FC<{ status: "buffering" | "ready" }> = ({
  status,
}) => {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (status === "buffering") {
      // Pulsing animation for buffering
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 0.3,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
      return () => animation.stop();
    } else {
      // Solid for ready
      opacity.setValue(1);
    }
  }, [status, opacity]);

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: 2,
        right: 2,
        opacity,
      }}
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: status === "ready" ? "#22c55e" : "#f59e0b",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons
          name={status === "ready" ? "checkmark" : "hourglass-outline"}
          size={10}
          color="#fff"
        />
      </View>
    </Animated.View>
  );
};

export const TrackItem: React.FC<TrackItemProps> = ({
  track,
  onPress,
  onLongPress,
  onRemove,
  isLoading: propLoading,
  isCached,
  queueIndex,
}) => {
  const {
    playTrack,
    loadingTrackId,
    currentTrack,
    isPlaying,
    pauseTrack,
    resumeTrack,
    queue,
    nextTrackBufferStatus,
    cachedTrackIds,
  } = usePlayer();
  const { isDark } = useAppTheme();
  const themeColorForeground = useThemeColor("foreground");

  const isPlayerLoading = loadingTrackId === String(track.id);
  const isLoading = propLoading || isPlayerLoading;
  const isActive = currentTrack?.id === String(track.id);

  // Determine if cached using internal check if prop not provided
  const isTrackCached =
    isCached ??
    (cachedTrackIds?.has(String(track.id)) || cachedTrackIds?.has(track.url));

  // Determine if this track is the "next" track in queue
  const isNextTrack = (() => {
    if (queueIndex === undefined || !currentTrack || queue.length <= 1) {
      return false;
    }
    const currentIndex = queue.findIndex(
      (t) => String(t.id) === String(currentTrack.id)
    );
    if (currentIndex === -1) return false;
    const nextIndex = (currentIndex + 1) % queue.length;
    return queueIndex === nextIndex;
  })();

  // Show buffer indicator for next track
  const showBufferIndicator =
    isNextTrack &&
    (nextTrackBufferStatus === "buffering" ||
      nextTrackBufferStatus === "ready");

  const handlePress = () => {
    if (isLoading) return;
    if (isActive) {
      if (isPlaying) {
        void pauseTrack().catch((e) => {
          console.warn("[TrackItem] pauseTrack failed", e);
        });
      } else {
        void resumeTrack().catch((e) => {
          console.warn("[TrackItem] resumeTrack failed", e);
        });
      }
      return;
    }
    if (onPress) {
      onPress();
    } else {
      void playTrack(track).catch((e) => {
        console.warn("[TrackItem] playTrack failed", e);
      });
    }
  };

  const handleIconPress = (e: any) => {
    e.stopPropagation();
    handlePress();
  };

  const handleRemovePress = (e: any) => {
    e.stopPropagation();
    onRemove?.();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={onLongPress}
      disabled={isLoading}
    >
      <View
        className={`flex-row items-center p-3 mb-2 rounded-xl border border-black/5 dark:border-white/5 ${
          isActive ? "bg-primary/10" : "bg-black/5 dark:bg-white/5"
        }`}
      >
        {track.artwork ? (
          <View className="relative mr-3">
            <Image
              source={{ uri: track.artwork }}
              className="w-12 h-12 rounded-lg"
              resizeMode="cover"
            />
            {isLoading && (
              <View className="absolute inset-0 bg-black/50 items-center justify-center rounded-lg">
                <ActivityIndicator size="small" color="#fff" />
              </View>
            )}
            {!isLoading && isActive && isPlaying && (
              <View className="absolute inset-0 bg-black/30 items-center justify-center rounded-lg">
                <View className="flex-row items-center gap-0.5">
                  <View className="w-1 h-3 bg-white rounded-full" />
                  <View className="w-1 h-4 bg-white rounded-full" />
                  <View className="w-1 h-2 bg-white rounded-full" />
                </View>
              </View>
            )}
            {/* Pre-buffer indicator for next track */}
            {showBufferIndicator && !isLoading && !isActive && (
              <BufferIndicator
                status={nextTrackBufferStatus as "buffering" | "ready"}
              />
            )}
          </View>
        ) : (
          <View className="w-12 h-12 rounded-lg mr-3 bg-default-200 items-center justify-center relative">
            {isLoading ? (
              <ActivityIndicator size="small" color={themeColorForeground} />
            ) : (
              <Text className="text-lg">🎵</Text>
            )}
            {/* Pre-buffer indicator for next track without artwork */}
            {showBufferIndicator && !isLoading && !isActive && (
              <BufferIndicator
                status={nextTrackBufferStatus as "buffering" | "ready"}
              />
            )}
          </View>
        )}
        <View className="flex-1 justify-center">
          <Text
            className={`font-semibold text-[15px] ${
              isActive ? "text-primary" : "text-foreground"
            }`}
            numberOfLines={1}
          >
            {track.title}
          </Text>
          <View className="flex-row items-center gap-1">
            {isTrackCached && (
              <Ionicons name="flash" size={10} color="#4ade80" />
            )}
            <Text
              className={`text-[13px] shrink ${
                isActive
                  ? "text-foreground opacity-70"
                  : "text-foreground opacity-60"
              }`}
              numberOfLines={1}
            >
              {track.artist}
            </Text>
          </View>
        </View>
        {onRemove && (
          <TouchableOpacity
            className="pl-2 pr-1 h-10 items-center justify-center"
            onPress={handleRemovePress}
          >
            <Ionicons name="trash-outline" size={20} color="#ff3b30" />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          className="pl-1 pr-2 h-10 items-center justify-center"
          onPress={handleIconPress}
        >
          {isLoading ? null : (
            <Ionicons
              name={isActive && isPlaying ? "pause" : "play"}
              size={20}
              color={isActive ? (isDark ? "#fff" : "#007AFF") : "#888"}
            />
          )}
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};
