import { Card } from "heroui-native";
import type React from "react";
import { Image, Text, TouchableOpacity, View } from "react-native";
import type { Playlist } from "./playlist-item";

interface PlaylistCardProps {
  playlist: Playlist;
  onPress?: () => void;
}

export const PlaylistCard: React.FC<PlaylistCardProps> = ({ playlist, onPress }) => {
  return (
    <TouchableOpacity onPress={onPress} className="mr-4 w-32">
      <View className="w-32 h-32 rounded-xl overflow-hidden mb-2 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 items-center justify-center">
        {playlist.artwork ? (
          <Image
            source={{ uri: playlist.artwork }}
            className="w-full h-full"
            resizeMode="cover"
          />
        ) : (
          <Text className="text-3xl">📜</Text>
        )}
      </View>
      <View className="px-1">
        <Text
          className="font-bold text-[14px] text-foreground"
          numberOfLines={1}
        >
          {playlist.title}
        </Text>
        <Text className="text-default-500 text-[11px] font-medium" numberOfLines={1}>
          {playlist.creator ? `By ${playlist.creator}` : "Playlist"}
        </Text>
      </View>
    </TouchableOpacity>
  );
};
