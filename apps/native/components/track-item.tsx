import { Ionicons } from "@expo/vector-icons";
import { Card } from "heroui-native";
import type React from "react";
import {
  ActivityIndicator,
  Image,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { usePlayer } from "@/contexts/player-context";

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
}

export const TrackItem: React.FC<TrackItemProps> = ({
  track,
  onPress,
  onLongPress,
  onRemove,
  isLoading: propLoading,
}) => {
  const {
    playTrack,
    loadingTrackId,
    currentTrack,
    isPlaying,
    pauseTrack,
    resumeTrack,
  } = usePlayer();

  const isPlayerLoading = loadingTrackId === String(track.id);
  const isLoading = propLoading || isPlayerLoading;
  const isActive = currentTrack?.id === String(track.id);

  const handlePress = () => {
    if (isLoading) return;
    if (isActive) {
      if (isPlaying) {
        void pauseTrack();
      } else {
        void resumeTrack();
      }
      return;
    }
    if (onPress) {
      onPress();
    } else {
      void playTrack(track);
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
        className={`flex-row items-center p-2 mb-2 rounded-xl border border-black/5 dark:border-white/5 ${
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
          </View>
        ) : (
          <View className="w-12 h-12 rounded-lg mr-3 bg-default-200 items-center justify-center">
            {isLoading ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text className="text-lg">🎵</Text>
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
          <Text className="text-default-500 text-[13px]" numberOfLines={1}>
            {track.artist}
          </Text>
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
              color={isActive ? "#007AFF" : "#888"}
            />
          )}
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};
