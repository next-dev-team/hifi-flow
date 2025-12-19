import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetView,
  useBottomSheetTimingConfigs,
} from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";
import {
  useGetArtistArtistGet,
  useSearchSearchGet,
} from "api-hifi/src/gen/hooks";
import type { SearchSearchGetQueryParams } from "api-hifi/src/gen/types/SearchSearchGet";
import { Card, Chip, useThemeColor } from "heroui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Easing } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import type {} from "uniwind/types";
import { ApiDebug } from "@/components/api-debug";
import { type Artist, ArtistItem } from "@/components/artist-item";
import { type Track, TrackItem } from "@/components/track-item";
import { useAppTheme } from "@/contexts/app-theme-context";
import { type SavedTrack, usePlayer } from "@/contexts/player-context";
import { getSuggestedArtists } from "@/utils/api";
import { resolveArtwork, resolveName } from "@/utils/resolvers";

type SearchFilter = "songs" | "artists" | "albums" | "playlists";

type SuggestedArtist = {
  name?: string;
  genre?: string;
  era?: string;
};

const StyledSafeAreaView = withUniwind(SafeAreaView);
const StyledView = withUniwind(View);
const StyledText = withUniwind(Text);
const StyledTextInput = withUniwind(TextInput);
const StyledScrollView = withUniwind(ScrollView);
const StyledTouchableOpacity = withUniwind(TouchableOpacity);
const StyledBottomSheetView = withUniwind(BottomSheetView);

export default function Home() {
  const {
    playQueue,
    favorites,
    quality,
    setQuality,
    sleepTimerEndsAt,
    sleepTimerRemainingMs,
    startSleepTimer,
    cancelSleepTimer,
  } = usePlayer();
  const { isDark, setTheme } = useAppTheme();
  const themeColorBackground = useThemeColor("background");
  const themeColorForeground = useThemeColor("foreground");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilter>("songs");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const artistSheetRef = useRef<BottomSheetModal | null>(null);
  const artistSnapPoints = useMemo(() => ["90%"], []);

  const { data: artistDetails, isLoading: isArtistLoading } =
    useGetArtistArtistGet(
      selectedArtist
        ? {
            f:
              parseInt(String(selectedArtist.id)) ||
              parseInt(
                String(selectedArtist.browseId).replace(/[^0-9]/g, "")
              ) ||
              0,
          }
        : undefined,
      {
        query: {
          enabled: !!(selectedArtist?.id || selectedArtist?.browseId),
        },
      }
    );

  const artistTopTracks = useMemo(() => {
    if (!artistDetails) return [] as Track[];

    // The API might return tracks in a specific property, let's look for them
    const response = artistDetails as any;
    const items =
      response.tracks?.items ||
      response.tracks ||
      response.data?.tracks?.items ||
      response.data?.tracks ||
      response.items ||
      response.results ||
      [];

    return (Array.isArray(items) ? items : []).map(
      (item: any, index: number): Track => {
        const id = item.id || item.videoId || `artist-track-${index}`;
        return {
          id: String(id),
          title: item.title || item.name || "Unknown Title",
          artist:
            resolveName(item.artist) ||
            selectedArtist?.name ||
            "Unknown Artist",
          artwork: resolveArtwork(item) || selectedArtist?.artwork,
          url: item.url || `https://www.youtube.com/watch?v=${id}`,
        };
      }
    );
  }, [artistDetails, selectedArtist]);

  const favoritesSheetRef = useRef<BottomSheetModal | null>(null);
  const settingsSheetRef = useRef<BottomSheetModal | null>(null);
  const favoritesSnapPoints = useMemo(() => ["100%"], []);
  const settingsSnapPoints = useMemo(() => ["55%"], []);
  const favoritesAnimationConfigs = useBottomSheetTimingConfigs({
    duration: 320,
    easing: Easing.bezier(0.2, 0.9, 0.2, 1),
  });

  const favoritesBackdrop = useMemo(() => {
    return (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        opacity={0.6}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    );
  }, []);

  const formattedSleepRemaining = useMemo(() => {
    if (!sleepTimerEndsAt || sleepTimerRemainingMs <= 0) return "Off";
    const totalSeconds = Math.ceil(sleepTimerRemainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, [sleepTimerEndsAt, sleepTimerRemainingMs]);

  const qualityOptions = useMemo(
    () =>
      [
        { value: "HI_RES_LOSSLESS", label: "Hi-Res" },
        { value: "LOSSLESS", label: "Lossless" },
        { value: "HIGH", label: "High" },
        { value: "LOW", label: "Low" },
      ] as const,
    []
  );

  const { data: suggestedArtists } = useQuery({
    queryKey: ["suggested-artists"],
    queryFn: async () => {
      const response = await getSuggestedArtists();
      const df = [
        {
          name: "Vannda",
          genre: "rapper",
          era: "2000s",
        },
        {
          name: "Tep piseth",
          genre: "rapper",
          era: "2000s",
        },
        {
          name: "Sin Sisamut",
          genre: "unknown",
          era: "1960",
        },
      ] as SuggestedArtist[];
      if (!Array.isArray(response)) {
        return;
      }
      return [...df, ...response] as SuggestedArtist[];
    },
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 2,
  });

  const suggestedArtistNames = useMemo(() => {
    const names = (suggestedArtists ?? [])
      .map((entry) =>
        typeof entry?.name === "string" ? entry.name.trim() : ""
      )
      .filter((name) => name.length > 0);
    return Array.from(new Set(names)).slice(0, 12);
  }, [suggestedArtists]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 350);
    return () => clearTimeout(timeout);
  }, [query]);

  const params = useMemo(() => {
    const base: SearchSearchGetQueryParams = {};
    const effectiveQuery = debouncedQuery || "trending";

    if (filter === "songs") {
      base.s = debouncedQuery || "new music";
    } else if (filter === "artists") {
      base.a = effectiveQuery;
    } else if (filter === "albums") {
      base.al = effectiveQuery;
    } else if (filter === "playlists") {
      base.p = effectiveQuery;
    }
    return base;
  }, [debouncedQuery, filter]);

  const { data, isLoading, error } = useSearchSearchGet(params);

  type SearchResultItem = {
    id?: string | number;
    videoId?: string;
    browseId?: string;
    title?: string;
    name?: string;
    artist?: { name?: string } | string;
    author?: { name?: string } | string;
    thumbnail?: { url?: string };
    thumbnails?: { url?: string }[] | string;
    image?: string;
    picture?: string;
    url?: string;
    subscribers?: string;
    subscribersCountText?: string;
    subscriberCountText?: string;
    popularity?: number;
  };

  type SearchResponse =
    | SearchResultItem[]
    | {
        data?: {
          items?: SearchResultItem[];
          results?: SearchResultItem[];
          tracks?: { items?: SearchResultItem[] };
          artists?: { items?: SearchResultItem[] };
          albums?: { items?: SearchResultItem[] };
          playlists?: { items?: SearchResultItem[] };
        };
        items?: SearchResultItem[];
        results?: SearchResultItem[];
        tracks?: { items?: SearchResultItem[] };
        artists?: { items?: SearchResultItem[] };
        albums?: { items?: SearchResultItem[] };
        playlists?: { items?: SearchResultItem[] };
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

    const response = data as any;

    // Helper to find items in a potentially nested structure
    const findItems = (obj: any): SearchResultItem[] | undefined => {
      if (!obj || typeof obj !== "object") return undefined;

      // 1. Check direct items/results
      if (Array.isArray(obj.items)) return obj.items;
      if (Array.isArray(obj.results)) return obj.results;

      // 2. Check filter-specific keys (mapping "songs" to "tracks")
      const apiKey = filter === "songs" ? "tracks" : filter;
      if (obj[apiKey]) {
        if (Array.isArray(obj[apiKey])) return obj[apiKey];
        if (Array.isArray(obj[apiKey].items)) return obj[apiKey].items;
        if (Array.isArray(obj[apiKey].results)) return obj[apiKey].results;
      }

      // 3. Check within "data" property
      if (obj.data) {
        return findItems(obj.data);
      }

      return undefined;
    };

    return findItems(response) ?? [];
  })();

  const tracks = useMemo(() => {
    if (filter === "artists") return [];

    return listData.map((item, index): Track => {
      const id = item.id || item.videoId || `track-${index}`;
      return {
        id: String(id),
        title: item.title || item.name || "Unknown Title",
        artist: resolveName(item.artist || item.author) || "Unknown Artist",
        artwork: resolveArtwork(item),
        url: item.url || `https://www.youtube.com/watch?v=${id}`,
      };
    });
  }, [listData, filter]);

  const artists = useMemo(() => {
    if (filter === "songs") return [];

    return listData.map((item, index): Artist => {
      const id = item.id || item.browseId || `artist-${index}`;
      return {
        id: String(id),
        name: item.name || item.title || "Unknown Artist",
        artwork: resolveArtwork(item),
        subscribers:
          item.subscribers ||
          item.subscribersCountText ||
          item.subscriberCountText ||
          (item.popularity ? `${item.popularity} popularity` : undefined),
        url: item.url,
        browseId:
          item.browseId ||
          (typeof id === "string" && id.startsWith("UC") ? id : undefined),
      };
    });
  }, [listData, filter]);

  const favoriteQueue = useMemo<Track[]>(() => {
    return favorites.map((saved) => {
      return {
        id: `saved:${saved.id}`,
        title: saved.title,
        artist: saved.artist,
        artwork: saved.artwork,
        url: saved.streamUrl,
      };
    });
  }, [favorites]);

  const renderItem = ({ index }: { index: number }) => {
    if (filter === "artists") {
      const artist = artists[index];
      if (!artist) return null;
      return (
        <ArtistItem
          artist={artist}
          onPress={() => {
            setSelectedArtist(artist);
            artistSheetRef.current?.present();
          }}
        />
      );
    }

    const track = tracks[index];
    if (!track) return null;

    return (
      <TrackItem
        track={track}
        onPress={() => {
          void playQueue(tracks, index);
        }}
      />
    );
  };

  const renderSavedItem = ({
    item,
    index,
  }: {
    item: SavedTrack;
    index: number;
  }) => {
    return (
      <TouchableOpacity
        onPress={() => {
          void playQueue(favoriteQueue, index);
          favoritesSheetRef.current?.dismiss();
        }}
      >
        <Card className="flex-row items-center p-3 mb-2 bg-content2 border-none shadow-sm">
          <View className="w-14 h-14 rounded-full overflow-hidden mr-4 bg-default-300 items-center justify-center">
            {item.artwork ? (
              <Image
                source={{ uri: item.artwork }}
                className="w-full h-full"
                resizeMode="cover"
              />
            ) : (
              <Text className="text-xl">🎵</Text>
            )}
          </View>
          <View className="flex-1 justify-center">
            <Text
              className="font-semibold text-base text-foreground"
              numberOfLines={1}
            >
              {item.title}
            </Text>
            <Text className="text-default-500 text-sm" numberOfLines={1}>
              {item.artist}
            </Text>
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <StyledSafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <StyledView className="px-4 pt-3 pb-2">
        <View className="flex-row items-center justify-between mb-2">
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => favoritesSheetRef.current?.present()}
          >
            <StyledText className="text-2xl font-bold text-foreground">
              HiFi Flow
            </StyledText>
          </TouchableOpacity>
          <View className="flex-row items-center">
            <TouchableOpacity
              className="p-2"
              onPress={() => settingsSheetRef.current?.present()}
            >
              <Ionicons
                name="settings"
                size={22}
                color={themeColorForeground}
              />
            </TouchableOpacity>
            <TouchableOpacity
              className="p-2"
              onPress={() => favoritesSheetRef.current?.present()}
            >
              <Ionicons
                name={favorites.length > 0 ? "heart" : "heart-outline"}
                size={22}
                color="red"
              />
            </TouchableOpacity>
          </View>
        </View>
        <StyledText className="text-default-500 mb-4">
          Search across songs, artists, albums and playlists.
        </StyledText>
        {suggestedArtistNames.length > 0 ? (
          <StyledView className="mb-3">
            <StyledText className="text-default-500 text-xs mb-2">
              Suggested artists
            </StyledText>
            <StyledScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ maxHeight: 40 }}
            >
              {suggestedArtistNames.map((name) => (
                <Chip
                  key={name}
                  onPress={() => {
                    setFilter("artists");
                    setQuery(name);
                  }}
                  variant="secondary"
                  color="default"
                  className="mr-2"
                >
                  <StyledText className="text-default-700">{name}</StyledText>
                </Chip>
              ))}
            </StyledScrollView>
          </StyledView>
        ) : null}
        <Card className="bg-content1 border border-default-200">
          <Card.Body className="p-3">
            <StyledView className="flex-row items-center bg-default-100 rounded-full px-3 py-2 mb-3">
              <Ionicons name="search" size={18} color="#888" />
              <StyledTextInput
                className="flex-1 ml-2 text-foreground h-9"
                placeholder="Search songs, artists, albums"
                placeholderTextColor="#888"
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
              />
            </StyledView>
            <StyledScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ maxHeight: 40 }}
            >
              {filters.map((f) => (
                <Chip
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  color={filter === f.key ? "accent" : "default"}
                  variant={filter === f.key ? "primary" : "secondary"}
                  className="mr-2"
                >
                  <StyledText
                    className={
                      filter === f.key
                        ? "text-accent-foreground font-medium"
                        : "text-default-600"
                    }
                  >
                    {f.label}
                  </StyledText>
                </Chip>
              ))}
            </StyledScrollView>
          </Card.Body>
        </Card>
        <ApiDebug title="Home search" data={data} error={error} />
      </StyledView>

      {isLoading ? (
        <StyledView className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#fff" />
        </StyledView>
      ) : error ? (
        <StyledView className="flex-1 justify-center items-center px-4">
          <StyledText className="text-default-500 text-center">
            Unable to load music right now.
          </StyledText>
        </StyledView>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item, index) => (item.id || index).toString()}
          renderItem={renderItem}
          numColumns={filter === "artists" ? 2 : 1}
          key={filter === "artists" ? "grid" : "list"}
          contentContainerStyle={{
            paddingHorizontal: filter === "artists" ? 8 : 16,
            paddingBottom: 100,
          }}
          ListHeaderComponent={
            !query ? (
              <StyledView className="mb-4">
                <StyledText className="text-xl font-bold mb-2">
                  Made for you
                </StyledText>
                <StyledText className="text-default-500 mb-4">
                  Fresh tunes to get you started
                </StyledText>
              </StyledView>
            ) : null
          }
          ListEmptyComponent={
            <StyledView className="flex-1 justify-center items-center mt-20">
              <StyledText className="text-default-500 text-lg">
                {query
                  ? "No results found"
                  : "Start typing to find songs, artists and more"}
              </StyledText>
            </StyledView>
          }
        />
      )}

      <BottomSheetModal
        ref={artistSheetRef}
        snapPoints={artistSnapPoints}
        index={0}
        enablePanDownToClose
        enableDismissOnClose
        backdropComponent={favoritesBackdrop}
        animationConfigs={favoritesAnimationConfigs}
        handleIndicatorStyle={{ backgroundColor: "#ccc" }}
        backgroundStyle={{ backgroundColor: themeColorBackground }}
      >
        <StyledBottomSheetView className="flex-1 bg-background">
          <View className="px-4 pt-3 pb-2 flex-row items-center justify-between">
            <Text className="text-xl font-bold text-foreground">
              Artist Details
            </Text>
            <TouchableOpacity
              className="p-2"
              onPress={() => artistSheetRef.current?.dismiss()}
            >
              <Ionicons name="close" size={22} color={themeColorForeground} />
            </TouchableOpacity>
          </View>

          {isArtistLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color="#fff" />
            </View>
          ) : (
            <BottomSheetFlatList
              ListHeaderComponent={
                <View className="px-4 mb-6">
                  <View className="flex-row items-center mb-6">
                    <View className="w-24 h-24 rounded-full overflow-hidden mr-4 bg-content3 shadow-md">
                      {selectedArtist?.artwork ? (
                        <Image
                          source={{ uri: selectedArtist.artwork }}
                          className="w-full h-full"
                          resizeMode="cover"
                        />
                      ) : (
                        <View className="w-full h-full items-center justify-center">
                          <Text className="text-3xl">👤</Text>
                        </View>
                      )}
                    </View>
                    <View className="flex-1">
                      <Text className="text-2xl font-bold text-foreground">
                        {selectedArtist?.name}
                      </Text>
                      <Text className="text-default-500">
                        {selectedArtist?.subscribers || "Artist"}
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row justify-between items-center mb-4">
                    <View>
                      <Text className="text-xl font-bold text-foreground">
                        Top Tracks
                      </Text>
                      <Text className="text-default-500 text-sm">
                        Best songs from {selectedArtist?.name}
                      </Text>
                    </View>
                    <TouchableOpacity
                      className="bg-primary px-4 py-2 rounded-full"
                      onPress={() => {
                        if (artistTopTracks.length > 0) {
                          void playQueue(artistTopTracks, 0);
                        }
                      }}
                    >
                      <Text className="text-primary-foreground font-bold">
                        Play All
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              }
              data={artistTopTracks}
              keyExtractor={(item: Track) => item.id}
              renderItem={({ item, index }: { item: Track; index: number }) => (
                <View className="px-4">
                  <TrackItem
                    track={item}
                    onPress={() => {
                      void playQueue(artistTopTracks, index);
                    }}
                  />
                </View>
              )}
              contentContainerStyle={{
                paddingBottom: 40,
              }}
            />
          )}
        </StyledBottomSheetView>
      </BottomSheetModal>

      <BottomSheetModal
        ref={favoritesSheetRef}
        snapPoints={favoritesSnapPoints}
        index={0}
        enablePanDownToClose
        enableDismissOnClose
        backdropComponent={favoritesBackdrop}
        animationConfigs={favoritesAnimationConfigs}
        handleIndicatorStyle={{ backgroundColor: "#ccc" }}
        backgroundStyle={{ backgroundColor: themeColorBackground }}
      >
        <StyledBottomSheetView className="flex-1 bg-background">
          <View className="px-4 pt-3 pb-2 flex-row items-center justify-between">
            <Text className="text-xl font-bold text-foreground">Favorites</Text>
            <TouchableOpacity
              className="p-2"
              onPress={() => favoritesSheetRef.current?.dismiss()}
            >
              <Ionicons name="close" size={22} color={themeColorForeground} />
            </TouchableOpacity>
          </View>

          {favorites.length === 0 ? (
            <View className="flex-1 items-center justify-center px-6">
              <Text className="text-default-500 text-center">
                No favorites yet.
              </Text>
              <Text className="text-default-500 text-center mt-2">
                Tap the heart in the player to save tracks.
              </Text>
            </View>
          ) : (
            <BottomSheetFlatList
              data={favorites}
              keyExtractor={(item: SavedTrack) => item.id}
              renderItem={renderSavedItem}
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingBottom: 24,
              }}
            />
          )}
        </StyledBottomSheetView>
      </BottomSheetModal>

      <BottomSheetModal
        ref={settingsSheetRef}
        snapPoints={settingsSnapPoints}
        index={0}
        enablePanDownToClose
        enableDismissOnClose
        backdropComponent={favoritesBackdrop}
        animationConfigs={favoritesAnimationConfigs}
        handleIndicatorStyle={{ backgroundColor: "#ccc" }}
        backgroundStyle={{ backgroundColor: themeColorBackground }}
      >
        <StyledBottomSheetView className="flex-1 bg-background">
          <View className="px-4 pt-3 pb-2 flex-row items-center justify-between">
            <Text className="text-xl font-bold text-foreground">Settings</Text>
            <TouchableOpacity
              className="p-2"
              onPress={() => settingsSheetRef.current?.dismiss()}
            >
              <Ionicons name="close" size={22} color={themeColorForeground} />
            </TouchableOpacity>
          </View>

          <View className="px-4 pt-2">
            <View className="flex-row items-center justify-between py-3 border-b border-default-200">
              <Text className="text-base text-foreground font-medium">
                Dark mode
              </Text>
              <Switch
                value={isDark}
                onValueChange={(next) => setTheme(next ? "dark" : "light")}
              />
            </View>

            <View className="py-4 border-b border-default-200">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-base text-foreground font-medium">
                  Streaming quality
                </Text>
                <Text className="text-default-500">{quality}</Text>
              </View>
              <View className="flex-row flex-wrap">
                {qualityOptions.map((option) => {
                  const selected = option.value === quality;
                  return (
                    <Chip
                      key={option.value}
                      onPress={() => setQuality(option.value)}
                      color={selected ? "accent" : "default"}
                      variant={selected ? "primary" : "secondary"}
                      className="mr-2 mb-2"
                    >
                      <StyledText
                        className={
                          selected
                            ? "text-accent-foreground font-medium"
                            : "text-default-600"
                        }
                      >
                        {option.label}
                      </StyledText>
                    </Chip>
                  );
                })}
              </View>
            </View>

            <View className="py-4">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-base text-foreground font-medium">
                  Sleep timer
                </Text>
                <Text className="text-default-500">
                  {formattedSleepRemaining}
                </Text>
              </View>

              <View className="flex-row flex-wrap">
                <Chip
                  onPress={() => startSleepTimer(10)}
                  className="mr-2 mb-2 bg-default-200"
                >
                  <Text className="text-foreground">10m</Text>
                </Chip>
                <Chip
                  onPress={() => startSleepTimer(20)}
                  className="mr-2 mb-2 bg-default-200"
                >
                  <Text className="text-foreground">20m</Text>
                </Chip>
                <Chip
                  onPress={() => startSleepTimer(30)}
                  className="mr-2 mb-2 bg-default-200"
                >
                  <Text className="text-foreground">30m</Text>
                </Chip>
                <Chip
                  onPress={() => startSleepTimer(60)}
                  className="mr-2 mb-2 bg-default-200"
                >
                  <Text className="text-foreground">1h</Text>
                </Chip>
                {sleepTimerEndsAt ? (
                  <Chip
                    onPress={cancelSleepTimer}
                    className="mr-2 mb-2 bg-default-200"
                  >
                    <Text className="text-foreground">Off</Text>
                  </Chip>
                ) : null}
              </View>
            </View>
          </View>
        </StyledBottomSheetView>
      </BottomSheetModal>
    </StyledSafeAreaView>
  );
}
