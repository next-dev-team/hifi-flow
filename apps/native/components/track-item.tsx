import { Card } from "heroui-native";
import type React from "react";
import { ActivityIndicator, Image, Text, TouchableOpacity, View } from "react-native";
import { usePlayer } from "@/contexts/player-context";

export interface Track {
  id: string;
  title: string;
  artist: string;
  artwork?: string;
  url: string;
  duration?: number;
}

interface TrackItemProps {
  track: Track;
  onPress?: () => void;
}

export const TrackItem: React.FC<TrackItemProps> = ({ track, onPress }) => {
  const { playTrack, loadingTrackId, currentTrack, isPlaying } = usePlayer();
  
  const isLoading = loadingTrackId === String(track.id);
  const isActive = currentTrack?.id === String(track.id);
  
  const handlePress = () => {
    if (isLoading) return;
    if (onPress) {
      onPress();
    } else {
      void playTrack(track);
    }
  };

  return (
    <TouchableOpacity onPress={handlePress} disabled={isLoading}>
      <Card className={`flex-row items-center p-3 mb-2 border-none shadow-sm ${isActive ? 'bg-primary/10' : 'bg-content2'}`}>
        {track.artwork ? (
          <View className="relative mr-4">
            <Image
              source={{ uri: track.artwork }}
              className="w-14 h-14 rounded-md"
              resizeMode="cover"
            />
            {isLoading && (
              <View className="absolute inset-0 bg-black/50 items-center justify-center rounded-md">
                <ActivityIndicator size="small" color="#fff" />
              </View>
            )}
            {!isLoading && isActive && isPlaying && (
               <View className="absolute inset-0 bg-black/30 items-center justify-center rounded-md">
                  <Text className="text-white text-xs font-bold">PLAYING</Text>
               </View>
            )}
          </View>
        ) : (
          <View className="w-14 h-14 rounded-md mr-4 bg-default-300 items-center justify-center">
            {isLoading ? (
               <ActivityIndicator size="small" color="#000" />
            ) : (
               <Text className="text-xl">🎵</Text>
            )}
          </View>
        )}
        <View className="flex-1 justify-center">
          <Text
            className={`font-semibold text-base ${isActive ? 'text-primary' : 'text-foreground'}`}
            numberOfLines={1}
          >
            {track.title}
          </Text>
          <Text className="text-default-500 text-sm" numberOfLines={1}>
            {track.artist}
          </Text>
        </View>
        <View className="px-2">
          {isLoading ? null : <Text className="text-default-400">⋮</Text>}
        </View>
      </Card>
    </TouchableOpacity>
  );
};
