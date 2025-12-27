import { Card } from "heroui-native";
import type React from "react";
import {
  Image,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from "react-native";
import { useThemeColor } from "heroui-native";
import type { Playlist } from "./playlist-item";

interface PlaylistCardProps {
  playlist: Playlist;
  onPress?: () => void;
  isLoading?: boolean;
}

export const PlaylistCard: React.FC<PlaylistCardProps> = ({
  playlist,
  onPress,
  isLoading,
}) => {
  const themeColorForeground = useThemeColor("foreground");
  return (
    <TouchableOpacity
      onPress={onPress}
      className="mr-4 w-32"
      disabled={isLoading}
    >
      <View className="w-32 h-32 rounded-xl overflow-hidden mb-2 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 items-center justify-center relative">
        {playlist.artwork ? (
          <Image
            source={{ uri: playlist.artwork }}
            className="w-full h-full"
            resizeMode="cover"
          />
        ) : (
          <Text className="text-3xl">📜</Text>
        )}
        {isLoading && (
          <View className="absolute inset-0 bg-black/40 items-center justify-center">
            <ActivityIndicator color={themeColorForeground} size="small" />
          </View>
        )}
      </View>
      <View className="px-1">
        <Text
          className="font-bold text-[14px] text-foreground"
          numberOfLines={1}
        >
          {playlist.title}
        </Text>
        <Text
          className="text-foreground opacity-60 text-[11px] font-medium"
          numberOfLines={1}
        >
          {playlist.creator ? `By ${playlist.creator}` : "Playlist"}
        </Text>
      </View>
    </TouchableOpacity>
  );
};
