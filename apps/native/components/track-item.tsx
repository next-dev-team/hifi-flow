import { Card } from "heroui-native";
import type React from "react";
import { Image, Text, TouchableOpacity, View } from "react-native";
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
}

export const TrackItem: React.FC<TrackItemProps> = ({ track }) => {
  const { playTrack } = usePlayer();

  return (
    <TouchableOpacity onPress={() => playTrack(track)}>
      <Card className="flex-row items-center p-3 mb-2 bg-content2 border-none shadow-sm">
        {track.artwork ? (
          <Image
            source={{ uri: track.artwork }}
            className="w-14 h-14 rounded-md mr-4"
            resizeMode="cover"
          />
        ) : (
          <View className="w-14 h-14 rounded-md mr-4 bg-default-300 items-center justify-center">
            <Text className="text-xl">🎵</Text>
          </View>
        )}
        <View className="flex-1 justify-center">
          <Text
            className="font-semibold text-base text-foreground"
            numberOfLines={1}
          >
            {track.title}
          </Text>
          <Text className="text-default-500 text-sm" numberOfLines={1}>
            {track.artist}
          </Text>
        </View>
        <View className="px-2">
          <Text className="text-default-400">⋮</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
};
