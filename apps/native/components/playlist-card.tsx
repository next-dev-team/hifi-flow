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
    <TouchableOpacity onPress={onPress} className="mr-4 w-36">
      <Card className="p-0 border-none bg-transparent shadow-none">
        <View className="w-36 h-36 rounded-md overflow-hidden mb-2 bg-default-300 items-center justify-center shadow-sm">
          {playlist.artwork ? (
            <Image
              source={{ uri: playlist.artwork }}
              className="w-full h-full"
              resizeMode="cover"
            />
          ) : (
            <Text className="text-4xl">📜</Text>
          )}
        </View>
        <View>
          <Text
            className="font-semibold text-base text-foreground"
            numberOfLines={1}
          >
            {playlist.title}
          </Text>
          <Text className="text-default-500 text-xs" numberOfLines={1}>
            {playlist.creator ? `By ${playlist.creator}` : "Playlist"}
          </Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
};
