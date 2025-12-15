import { useGetPlaylistPlaylistGet } from "api-hifi/src/gen/hooks";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiDebug } from "@/components/api-debug";
import { type Track, TrackItem } from "@/components/track-item";

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, error } = useGetPlaylistPlaylistGet({
    id: String(id),
    limit: 100,
  });

  type PlaylistTrackItem = {
    id?: string;
    videoId?: string;
    title?: string;
    name?: string;
    artist?: { name?: string } | string;
    author?: { name?: string } | string;
    thumbnail?: { url?: string };
    thumbnails?: { url?: string }[];
    image?: string;
    url?: string;
  };

  type PlaylistResponse = {
    items?: PlaylistTrackItem[];
    tracks?: PlaylistTrackItem[];
    title?: string;
    name?: string;
    description?: string;
    owner?: { name?: string };
    data?: {
      items?: PlaylistTrackItem[];
      tracks?: PlaylistTrackItem[];
      title?: string;
      name?: string;
      description?: string;
      owner?: { name?: string };
    };
  };

  const resolveName = (value?: { name?: string } | string) => {
    if (!value) return undefined;
    if (typeof value === "string") return value;
    return value.name;
  };

  const playlist = data as PlaylistResponse | undefined;
  const items: PlaylistTrackItem[] =
    playlist?.data?.items ??
    playlist?.data?.tracks ??
    playlist?.items ??
    playlist?.tracks ??
    [];

  const renderItem = ({ item }: { item: PlaylistTrackItem }) => {
    const track: Track = {
      id: item.id || item.videoId || Math.random().toString(),
      title: item.title || item.name || "Unknown Title",
      artist:
        resolveName(item.artist) ||
        resolveName(item.author) ||
        "Unknown Artist",
      artwork: item.thumbnail?.url || item.thumbnails?.[0]?.url || item.image,
      url: item.url || `https://www.youtube.com/watch?v=${item.id}`,
    };
    return <TrackItem track={track} />;
  };

  const title =
    playlist?.data?.title ||
    playlist?.title ||
    playlist?.data?.name ||
    playlist?.name ||
    "Playlist";
  const description =
    playlist?.data?.description ||
    playlist?.description ||
    playlist?.data?.owner?.name ||
    playlist?.owner?.name ||
    "";

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <View className="px-4 py-4 mb-2">
        <Text className="text-2xl font-bold text-foreground" numberOfLines={2}>
          {title}
        </Text>
        {description ? (
          <Text className="text-default-500" numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>

      <ApiDebug title="Playlist details" data={data} error={error} />

      {isLoading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : error ? (
        <View className="flex-1 justify-center items-center px-4">
          <Text className="text-default-500 text-center">
            Unable to load playlist.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, index) => (item.id || index).toString()}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 100,
          }}
        />
      )}
    </SafeAreaView>
  );
}
