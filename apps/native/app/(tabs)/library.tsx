import { Ionicons } from "@expo/vector-icons";
import { useSearchSearchGet } from "api-hifi/src/gen/hooks";
import { router } from "expo-router";
import { Card, useThemeColor } from "heroui-native";
import React, { useEffect, useState } from "react";
import { Alert, FlatList, Image, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiDebug } from "@/components/api-debug";
import { TimerStatus } from "@/components/timer-status";
import { TrackItem } from "@/components/track-item";
import { usePlayer } from "@/contexts/player-context";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { type AudioMetadata, audioCacheService } from "@/utils/audio-cache";
import { resolveArtwork, resolveName } from "@/utils/resolvers";

const FAVORITE_MIXES_STORAGE_KEY = "hififlow:favorite_mixes:v1";

export default function Library() {
  const { data, isLoading, error } = useSearchSearchGet({ p: "mix" });
  const themeColorForeground = useThemeColor("foreground");
  const {
    recentlyPlayed,
    mixedTracks,
    removeFromMixed,
    removeFromRecentlyPlayed,
  } = usePlayer();
  const [viewMode, setViewMode] = useState<
    "mixes" | "recent" | "downloaded" | "mixed"
  >("recent");
  const [favoriteMixIds, setFavoriteMixIds] = usePersistentState<string[]>(
    FAVORITE_MIXES_STORAGE_KEY,
    []
  );
  const [downloadedTracks, setDownloadedTracks] = useState<
    { url: string; metadata?: AudioMetadata }[]
  >([]);

  useEffect(() => {
    if (viewMode === "downloaded") {
      audioCacheService.getAllCachedTracks().then((tracks) => {
        // Sort by timestamp desc (newest first)
        const sorted = tracks.sort((a, b) => b.timestamp - a.timestamp);
        setDownloadedTracks(sorted);
      });
    }
  }, [viewMode]);

  const listData = (() => {
    if (!data) return [] as any[];
    if (Array.isArray(data)) return data as any[];
    const response = data as {
      data?: { items?: any[]; results?: any[] };
      items?: any[];
      results?: any[];
    };
    return (
      response.data?.items ??
      response.data?.results ??
      response.items ??
      response.results ??
      []
    );
  })();

  const renderItem = ({ item }: { item: any }) => {
    const id = item.id || item.playlistId;
    const title = item.title || item.name || "Playlist";
    const subtitle =
      item.description || item.owner?.name || item.author?.name || "";
    const trackCount = item.trackCount || item.tracks?.length;
    const mixId = id ? String(id) : null;
    const isFavorited = mixId ? favoriteMixIds.includes(mixId) : false;

    const handlePress = () => {
      if (!id) return;
      router.push({ pathname: "/playlist/[id]", params: { id: String(id) } });
    };

    return (
      <Pressable disabled={!id} onPress={handlePress}>
        <Card className="flex-row items-center p-4 mb-2 bg-content2">
          <View className="w-12 h-12 rounded-md bg-primary/20 items-center justify-center mr-4">
            <Ionicons
              name="musical-notes"
              size={24}
              color={themeColorForeground}
            />
          </View>
          <View className="flex-1">
            <Text
              className="font-bold text-lg text-foreground"
              numberOfLines={1}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text className="text-foreground opacity-60" numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
            {trackCount ? (
              <Text className="text-foreground opacity-60 text-xs">
                {trackCount} tracks
              </Text>
            ) : null}
          </View>
          <Pressable
            disabled={!mixId}
            onPress={(e) => {
              if (typeof (e as any)?.stopPropagation === "function") {
                (e as any).stopPropagation();
              }
              if (!mixId) return;
              setFavoriteMixIds((prev) =>
                prev.includes(mixId)
                  ? prev.filter((x) => x !== mixId)
                  : [...prev, mixId]
              );
            }}
            hitSlop={10}
            className="px-2"
            accessibilityRole="button"
            accessibilityLabel={
              isFavorited ? "Remove from favorites" : "Add to favorites"
            }
          >
            <Ionicons
              name={isFavorited ? "heart" : "heart-outline"}
              size={20}
              color={isFavorited ? "#ef4444" : themeColorForeground}
              style={{ opacity: isFavorited ? 1 : 0.4 }}
            />
          </Pressable>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={themeColorForeground}
          />
        </Card>
      </Pressable>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <View className="px-4 py-4 flex-row items-center justify-between">
        <View>
          <Text className="text-3xl font-bold text-foreground mb-2">
            Library
          </Text>
          <Text className="text-foreground opacity-60 mb-4">
            Your playlists and mixes
          </Text>
        </View>
        <TimerStatus absolute={false} />
      </View>

      <View className="flex-row px-4 mb-4 gap-2">
        <Pressable
          onPress={() => setViewMode("recent")}
          className={`px-3 py-2 rounded-lg border ${
            viewMode === "recent"
              ? "bg-foreground border-foreground shadow-sm"
              : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10"
          }`}
        >
          <Text
            className={
              viewMode === "recent"
                ? "text-background font-semibold"
                : "text-foreground font-semibold"
            }
          >
            Recently Played
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setViewMode("mixes")}
          className={`px-3 py-2 rounded-lg border ${
            viewMode === "mixes"
              ? "bg-foreground border-foreground shadow-sm"
              : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10"
          }`}
        >
          <Text
            className={
              viewMode === "mixes"
                ? "text-background font-semibold"
                : "text-foreground font-semibold"
            }
          >
            Mixes
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setViewMode("downloaded")}
          className={`px-3 py-2 rounded-lg border ${
            viewMode === "downloaded"
              ? "bg-foreground border-foreground shadow-sm"
              : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10"
          }`}
        >
          <Text
            className={
              viewMode === "downloaded"
                ? "text-background font-semibold"
                : "text-foreground font-semibold"
            }
          >
            Downloaded
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setViewMode("mixed")}
          className={`px-3 py-2 rounded-lg border ${
            viewMode === "mixed"
              ? "bg-foreground border-foreground shadow-sm"
              : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10"
          }`}
        >
          <Text
            className={
              viewMode === "mixed"
                ? "text-background font-semibold"
                : "text-foreground font-semibold"
            }
          >
            Mixed
          </Text>
        </Pressable>
      </View>

      {viewMode === "mixes" ? (
        <>
          <ApiDebug title="Library search" data={data} error={error} />

          {isLoading ? (
            <View className="flex-1 justify-center items-center">
              <Text className="text-foreground opacity-70">
                Loading library...
              </Text>
            </View>
          ) : error ? (
            <View className="flex-1 justify-center items-center px-4">
              <Text className="text-foreground opacity-60 text-center">
                Unable to load your library.
              </Text>
            </View>
          ) : (
            <FlatList
              data={listData}
              keyExtractor={(item, index) => (item.id || index).toString()}
              renderItem={renderItem}
              ListHeaderComponent={() =>
                mixedTracks.length === 0 ? null : (
                  <View className="mb-3">
                    <Text className="text-foreground font-semibold text-base mb-2">
                      Mixed Tracks
                    </Text>
                    {mixedTracks.map((t) => {
                      const handleRemove = () => {
                        void removeFromMixed(t.id);
                      };

                      return (
                        <TrackItem
                          key={t.id}
                          track={{
                            id: t.id,
                            title: t.title,
                            artist: t.artist,
                            artwork: t.artwork,
                            url: t.streamUrl || "",
                          }}
                          onLongPress={handleRemove}
                          onRemove={handleRemove}
                        />
                      );
                    })}
                  </View>
                )
              }
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingBottom: 100,
              }}
            />
          )}
        </>
      ) : viewMode === "downloaded" ? (
        <FlatList
          data={downloadedTracks}
          keyExtractor={(item, index) =>
            (item.metadata?.id || item.url || index).toString()
          }
          renderItem={({ item }) => (
            <TrackItem
              track={{
                id: item.metadata?.id || item.url,
                title: item.metadata?.title || "Unknown Track",
                artist: item.metadata?.artist || "Unknown Artist",
                artwork: item.metadata?.artwork,
                url: item.url,
              }}
              isCached={true}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          ListEmptyComponent={
            <View className="flex-1 justify-center items-center mt-10">
              <Text className="text-foreground opacity-60">
                No downloaded tracks.
              </Text>
            </View>
          }
        />
      ) : viewMode === "mixed" ? (
        <FlatList
          data={mixedTracks}
          keyExtractor={(item, index) => (item.id || index).toString()}
          renderItem={({ item }) => {
            const handleRemove = () => {
              void removeFromMixed(item.id);
            };

            return (
              <TrackItem
                track={{
                  id: item.id,
                  title: item.title,
                  artist: item.artist,
                  artwork: item.artwork,
                  url: item.streamUrl || "",
                }}
                onLongPress={handleRemove}
                onRemove={handleRemove}
              />
            );
          }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          ListEmptyComponent={
            <View className="flex-1 justify-center items-center mt-10">
              <Text className="text-foreground opacity-70">
                No mixed tracks.
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={recentlyPlayed}
          keyExtractor={(item, index) => (item.id || index).toString()}
          renderItem={({ item }) => {
            const handleRemove = () => {
              void removeFromRecentlyPlayed(item.id);
            };

            return (
              <TrackItem
                track={{
                  id: item.id,
                  title: item.title,
                  artist: item.artist,
                  artwork: item.artwork,
                  url: "",
                }}
                onLongPress={handleRemove}
                onRemove={handleRemove}
              />
            );
          }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          ListEmptyComponent={
            <View className="flex-1 justify-center items-center mt-10">
              <Text className="text-foreground opacity-70">
                No recently played tracks.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
