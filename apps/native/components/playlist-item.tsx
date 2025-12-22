import { Card } from "heroui-native";
import type React from "react";
import { Image, Text, TouchableOpacity, View, ActivityIndicator } from "react-native";

export interface Playlist {
  id: string;
  title: string;
  creator?: string;
  artwork?: string;
  trackCount?: number;
}

interface PlaylistItemProps {
  playlist: Playlist;
  onPress?: () => void;
  isLoading?: boolean;
}

export const PlaylistItem: React.FC<PlaylistItemProps> = ({ playlist, onPress, isLoading }) => {
  return (
    <TouchableOpacity onPress={onPress} disabled={isLoading}>
      <Card className="flex-row items-center p-3 mb-2 bg-content2 border-none shadow-sm">
        <View className="relative mr-4">
          {playlist.artwork ? (
            <Image
              source={{ uri: playlist.artwork }}
              className="w-14 h-14 rounded-md"
              resizeMode="cover"
            />
          ) : (
            <View className="w-14 h-14 rounded-md bg-default-300 items-center justify-center">
              <Text className="text-xl">📜</Text>
            </View>
          )}
          {isLoading && (
            <View className="absolute inset-0 bg-black/40 items-center justify-center rounded-md">
              <ActivityIndicator color="#fff" size="small" />
            </View>
          )}
        </View>
        <View className="flex-1 justify-center">
          <Text
            className="font-semibold text-base text-foreground"
            numberOfLines={1}
          >
            {playlist.title}
          </Text>
          <Text className="text-default-500 text-sm" numberOfLines={1}>
            {playlist.creator ? `By ${playlist.creator}` : "Playlist"}
             {playlist.trackCount ? ` • ${playlist.trackCount} tracks` : ""}
          </Text>
        </View>
        <View className="px-2">
          <Text className="text-default-400">›</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
};
