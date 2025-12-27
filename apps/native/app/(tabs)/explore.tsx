import { useSearchSearchGet } from "api-hifi/src/gen/hooks";
import { useMemo } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import { ApiDebug } from "@/components/api-debug";
import { TimerStatus } from "@/components/timer-status";
import { type Track, TrackItem } from "@/components/track-item";
import { usePlayer } from "@/contexts/player-context";
import { resolveArtwork, resolveName } from "@/utils/resolvers";

const StyledSafeAreaView = withUniwind(SafeAreaView);
const StyledView = withUniwind(View);
const StyledText = withUniwind(Text);

export default function Explore() {
  const { playQueue } = usePlayer();
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

  const tracks = useMemo(() => {
    return listData.map((item, index): Track => {
      const id = item.id || item.videoId || `result-${index}`;
      return {
        id: String(id),
        title: item.title || item.name || "Unknown Title",
        artist: resolveName(item.artist || item.author) || "Unknown Artist",
        artwork: resolveArtwork(item),
        url: item.url || `https://www.youtube.com/watch?v=${id}`,
      };
    });
  }, [listData]);

  const renderItem = ({ index }: { item: SearchResultItem; index: number }) => {
    const track = tracks[index];
    if (!track) return null;

    return (
      <TrackItem
        track={track}
        onPress={() => {
          void playQueue(tracks, index).catch((e) => {
            console.warn("[Explore] playQueue failed", e);
          });
        }}
      />
    );
  };

  return (
    <StyledSafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <StyledView className="px-4 py-4 mb-2 flex-row items-center justify-between">
        <View>
          <StyledText className="text-2xl font-bold text-foreground">
            Explore
          </StyledText>
          <StyledText className="text-foreground opacity-70">
            Discover new music and trends
          </StyledText>
        </View>
        <TimerStatus absolute={false} />
      </StyledView>

      <ApiDebug title="Explore search" data={data} error={error} />

      {isLoading ? (
        <StyledView className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#fff" />
        </StyledView>
      ) : error ? (
        <StyledView className="flex-1 justify-center items-center px-4">
          <StyledText className="text-foreground opacity-60 text-center">
            Unable to load explore content.
          </StyledText>
        </StyledView>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item, index) => (item.id || index).toString()}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 20,
          }}
        />
      )}
    </StyledSafeAreaView>
  );
}
