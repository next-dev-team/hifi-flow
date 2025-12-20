import { useSearchSearchGet } from "api-hifi/src/gen/hooks";
import type React from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { PlaylistCard } from "./playlist-card";
import type { Playlist } from "./playlist-item";
import { resolveArtwork, resolveName } from "@/utils/resolvers";
import { useMemo } from "react";

interface PlaylistSectionProps {
  title: string;
  query: string;
  onSelect: (playlist: Playlist) => void;
}

export const PlaylistSection: React.FC<PlaylistSectionProps> = ({
  title,
  query,
  onSelect,
}) => {
  const { data, isLoading } = useSearchSearchGet({ p: query });

  const playlists = useMemo(() => {
    if (!data) return [];
    const response = data as any;

    let items: any[] = [];
    
    // Attempt to find playlist items in response
    if (response.playlists?.items) items = response.playlists.items;
    else if (response.playlists?.results) items = response.playlists.results;
    else if (response.items) items = response.items;
    else if (response.results) items = response.results;
    else if (response.data?.items) items = response.data.items;
    
    if (!items) return [];

    return items.map((item, index): Playlist => {
      const id = item.id || `playlist-${index}`;
      return {
        id: String(id),
        title: item.title || "Unknown Playlist",
        creator: resolveName(item.artist || item.author),
        artwork: resolveArtwork(item),
        trackCount: item.trackCount || item.numberOfTracks,
      };
    });
  }, [data]);

  if (isLoading) {
    return (
      <View className="mb-6 h-48 justify-center">
         <Text className="text-xl font-bold text-foreground mb-3 px-4">{title}</Text>
        <ActivityIndicator size="small" />
      </View>
    );
  }

  if (playlists.length === 0) return null;

  return (
    <View className="mb-6">
      <Text className="text-xl font-bold text-foreground mb-3 px-4">
        {title}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16 }}
      >
        {playlists.map((p) => (
          <PlaylistCard
            key={p.id}
            playlist={p}
            onPress={() => onSelect(p)}
          />
        ))}
      </ScrollView>
    </View>
  );
};
