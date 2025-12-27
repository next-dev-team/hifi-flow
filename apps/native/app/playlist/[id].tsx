import { useGetPlaylistPlaylistGet } from "api-hifi/src/gen/hooks";
import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import { ApiDebug } from "@/components/api-debug";
import { type Track, TrackItem } from "@/components/track-item";
import { usePlayer } from "@/contexts/player-context";
import { resolveArtwork, resolveName } from "@/utils/resolvers";

const StyledSafeAreaView = withUniwind(SafeAreaView);
const StyledView = withUniwind(View);
const StyledText = withUniwind(Text);

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { playQueue } = usePlayer();

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

  const playlist = data as PlaylistResponse | undefined;

  const items = useMemo<PlaylistTrackItem[]>(() => {
    return (
      playlist?.data?.items ??
      playlist?.data?.tracks ??
      playlist?.items ??
      playlist?.tracks ??
      []
    );
  }, [playlist]);

  const tracks = useMemo<Track[]>(() => {
    return items.map((item, index) => {
      const resolvedId = item.id || item.videoId || `playlist-${String(id)}-${index}`;
      return {
        id: String(resolvedId),
        title: item.title || item.name || "Unknown Title",
        artist:
          resolveName(item.artist) ||
          resolveName(item.author) ||
          "Unknown Artist",
        artwork: resolveArtwork(item),
        url: item.url || `https://www.youtube.com/watch?v=${resolvedId}`,
      };
    });
  }, [items, id]);

  const renderItem = ({ item, index }: { item: Track; index: number }) => {
    return (
      <TrackItem
        track={item}
        onPress={() => {
          void playQueue(tracks, index).catch((e) => {
            console.warn("[Playlist] playQueue failed", e);
          });
        }}
      />
    );
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
    <StyledSafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <StyledView className="px-4 py-4 mb-2">
        <StyledText
          className="text-2xl font-bold text-foreground"
          numberOfLines={2}
        >
          {title}
        </StyledText>
        {description ? (
          <StyledText className="text-default-500" numberOfLines={2}>
            {description}
          </StyledText>
        ) : null}
      </StyledView>

      <ApiDebug title="Playlist details" data={data} error={error} />

      {isLoading ? (
        <StyledView className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#fff" />
        </StyledView>
      ) : error ? (
        <StyledView className="flex-1 justify-center items-center px-4">
          <StyledText className="text-default-500 text-center">
            Unable to load playlist.
          </StyledText>
        </StyledView>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 100,
          }}
        />
      )}
    </StyledSafeAreaView>
  );
}
