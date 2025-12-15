import { useSearchSearchGet } from "api-hifi/src/gen/hooks";
import React from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiDebug } from "@/components/api-debug";
import { type Track, TrackItem } from "@/components/track-item";

export default function Explore() {
  const { data, isLoading, error } = useSearchSearchGet({ s: "trending" });

  type SearchResultItem = {
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

  const resolveName = (value?: { name?: string } | string) => {
    if (!value) return undefined;
    if (typeof value === "string") return value;
    return value.name;
  };

  const renderItem = ({ item }: { item: SearchResultItem }) => {
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

  const listData: SearchResultItem[] = (() => {
    if (!data) return [];
    if (Array.isArray(data)) return data as SearchResultItem[];
    const response = data as {
      data?: { items?: SearchResultItem[]; results?: SearchResultItem[] };
      items?: SearchResultItem[];
      results?: SearchResultItem[];
    };
    return (
      response.data?.items ??
      response.data?.results ??
      response.items ??
      response.results ??
      []
    );
  })();

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <View className="px-4 py-4 mb-2">
        <Text className="text-2xl font-bold text-foreground">Explore</Text>
        <Text className="text-default-500">Discover new music and trends</Text>
      </View>

      <ApiDebug title="Explore search" data={data} error={error} />

      {isLoading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : error ? (
        <View className="flex-1 justify-center items-center px-4">
          <Text className="text-default-500 text-center">
            Unable to load explore content.
          </Text>
        </View>
      ) : (
        <FlatList
          data={listData}
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
