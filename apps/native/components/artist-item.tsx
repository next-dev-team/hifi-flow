import { Card } from "heroui-native";
import type React from "react";
import { Image, Text, TouchableOpacity, View, ActivityIndicator } from "react-native";
import { resolveArtwork } from "../utils/resolvers";

export interface Artist {
  id: string;
  name: string;
  artwork?: string;
  url?: string;
  subscribers?: string;
  browseId?: string;
}

interface ArtistItemProps {
	artist: Artist;
	onPress?: () => void;
  isLoading?: boolean;
}

export const ArtistItem: React.FC<ArtistItemProps> = ({ artist, onPress, isLoading }) => {
  const artwork = resolveArtwork(artist);

  return (
    <TouchableOpacity 
      onPress={onPress}
      className="items-center mb-6 px-2"
      style={{ width: "50%" }}
      disabled={isLoading}
    >
      <View className="w-32 h-32 rounded-full overflow-hidden mb-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 shadow-sm relative">
        {artwork ? (
          <Image
            source={{ uri: artwork }}
            className="w-full h-full"
            resizeMode="cover"
          />
        ) : (
          <View className="w-full h-full items-center justify-center">
            <Text className="text-3xl">👤</Text>
          </View>
        )}
        {isLoading && (
          <View className="absolute inset-0 bg-black/40 items-center justify-center">
            <ActivityIndicator color="#fff" size="small" />
          </View>
        )}
      </View>
      <Text
        className="font-bold text-[15px] text-foreground text-center"
        numberOfLines={1}
      >
        {artist.name}
      </Text>
      <Text className="text-foreground opacity-60 text-[12px] font-medium text-center">
        {artist.subscribers || "Artist"}
      </Text>
    </TouchableOpacity>
  );
};
