import { Ionicons } from "@expo/vector-icons";
import { useSearchSearchGet } from "api-hifi/src/gen/hooks";
import type { SearchSearchGetQueryParams } from "api-hifi/src/gen/types/SearchSearchGet";
import { Card, Chip } from "heroui-native";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiDebug } from "@/components/api-debug";
import { type Track, TrackItem } from "@/components/track-item";

type SearchFilter = "songs" | "artists" | "albums" | "playlists";

export default function Home() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilter>("songs");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 350);
    return () => clearTimeout(timeout);
  }, [query]);

  const params = useMemo(() => {
    const base: SearchSearchGetQueryParams = {};
    if (!debouncedQuery) {
      base.s = "new music";
      return base;
    }
    if (filter === "songs") base.s = debouncedQuery;
    if (filter === "artists") base.a = debouncedQuery;
    if (filter === "albums") base.al = debouncedQuery;
    if (filter === "playlists") base.p = debouncedQuery;
    return base;
  }, [debouncedQuery, filter]);

  const { data, isLoading, error } = useSearchSearchGet(params);

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

  type SearchResponse =
    | SearchResultItem[]
    | {
        data?: {
          items?: SearchResultItem[];
          results?: SearchResultItem[];
        };
        items?: SearchResultItem[];
        results?: SearchResultItem[];
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

  const filters: { key: SearchFilter; label: string }[] = [
    { key: "songs", label: "Songs" },
    { key: "artists", label: "Artists" },
    { key: "albums", label: "Albums" },
    { key: "playlists", label: "Playlists" },
  ];

  const listData: SearchResultItem[] = (() => {
    if (!data) return [];
    if (Array.isArray(data)) return data as SearchResultItem[];
    const response = data as SearchResponse & {
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
      <View className="px-4 pt-3 pb-2">
        <Text className="text-2xl font-bold text-foreground mb-2">
          HiFi Flow
        </Text>
        <Text className="text-default-500 mb-4">
          Search across songs, artists, albums and playlists.
        </Text>
        <Card className="bg-content1 border border-default-200">
          <Card.Body className="p-3">
            <View className="flex-row items-center bg-default-100 rounded-full px-3 py-2 mb-3">
              <Ionicons name="search" size={18} color="#888" />
              <TextInput
                className="flex-1 ml-2 text-foreground h-9"
                placeholder="Search songs, artists, albums"
                placeholderTextColor="#888"
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
              />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ maxHeight: 40 }}
            >
              {filters.map((f) => (
                <TouchableOpacity key={f.key} onPress={() => setFilter(f.key)}>
                  <Chip
                    className={`mr-2 ${
                      filter === f.key ? "bg-primary" : "bg-default-200"
                    }`}
                  >
                    <Text
                      className={
                        filter === f.key
                          ? "text-primary-foreground"
                          : "text-foreground"
                      }
                    >
                      {f.label}
                    </Text>
                  </Chip>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Card.Body>
        </Card>
        <ApiDebug title="Home search" data={data} error={error} />
      </View>

      {isLoading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : error ? (
        <View className="flex-1 justify-center items-center px-4">
          <Text className="text-default-500 text-center">
            Unable to load music right now.
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
          ListHeaderComponent={
            !query ? (
              <View className="mb-4">
                <Text className="text-xl font-bold mb-2">Made for you</Text>
                <Text className="text-default-500 mb-4">
                  Fresh tunes to get you started
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View className="flex-1 justify-center items-center mt-20">
              <Text className="text-default-500 text-lg">
                {query
                  ? "No results found"
                  : "Start typing to find songs, artists and more"}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
