/** biome-ignore-all lint/style/noNonNullAssertion: <explanation> */
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
  useGetPlaylistPlaylistGet,
  useSearchSearchGet,
} from "api-hifi/src/gen/hooks";
import type { SearchSearchGetQueryParams } from "api-hifi/src/gen/types/SearchSearchGet";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { Card, Chip, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  DeviceEventEmitter,
  FlatList,
  Image,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import type {} from "uniwind/types";
import { ApiDebug } from "@/components/api-debug";
import { type Artist, ArtistItem } from "@/components/artist-item";
import { PlaylistDiscovery } from "@/components/playlist-discovery";
import { type Playlist, PlaylistItem } from "@/components/playlist-item";
import { SearchComposer } from "@/components/search-composer";
import { ThinkingDots } from "@/components/thinking-dots";
import { TimerStatus } from "@/components/timer-status";
import { type Track, TrackItem } from "@/components/track-item";
import { useAppTheme } from "@/contexts/app-theme-context";
import { type SavedTrack, usePlayer } from "@/contexts/player-context";
import { useToast } from "@/contexts/toast-context";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { detectThemeVoiceAction } from "@/utils/ai";
import { getSuggestedArtists, losslessAPI } from "@/utils/api";
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
    removeFavorite,
    quality,
    setQuality,
    sleepTimerEndsAt,
    sleepTimerRemainingMs,
    startSleepTimer,
    cancelSleepTimer,
    pauseTrack,
    resumeTrack,
    playNext,
    playPrevious,
  } = usePlayer();
  const { isDark, setTheme } = useAppTheme();
  const { showToast } = useToast();
  const themeColorBackground = useThemeColor("background");
  const themeColorForeground = useThemeColor("foreground");

  const voiceActionOwnerRef = useRef(false);
  const voiceActionTranscriptRef = useRef("");
  const [isVoiceActionListening, setIsVoiceActionListening] = useState(false);
  const [voiceActionStatus, setVoiceActionStatus] = useState<
    "idle" | "listening" | "processing" | "error"
  >("idle");
  const [speechLang, setSpeechLang] = usePersistentState<"en-US" | "km-KH">(
    "app-speech-lang",
    (() => {
      try {
        const locale = Intl.DateTimeFormat().resolvedOptions().locale;
        return locale.startsWith("km") ? "km-KH" : "en-US";
      } catch {
        return "en-US";
      }
    })()
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilter>("songs");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [favViewMode, setFavViewMode] = useState<"songs" | "artists">("songs");
  const [favArtistFilter, setFavArtistFilter] = useState<string | null>(null);

  useSpeechRecognitionEvent("start", () => {
    if (!voiceActionOwnerRef.current) return;
    setIsVoiceActionListening(true);
    setVoiceActionStatus("listening");
    voiceActionTranscriptRef.current = "";
  });

  useSpeechRecognitionEvent("result", (event) => {
    if (!voiceActionOwnerRef.current) return;
    const transcript = event.results.map((r) => r.transcript).join(" ");
    voiceActionTranscriptRef.current = transcript;
  });

  useSpeechRecognitionEvent("end", () => {
    if (!voiceActionOwnerRef.current) return;
    const transcript = voiceActionTranscriptRef.current.trim();
    voiceActionOwnerRef.current = false;
    setIsVoiceActionListening(false);

    if (!transcript) {
      setVoiceActionStatus("idle");
      return;
    }

    setVoiceActionStatus("processing");
    void (async () => {
      try {
        const action = await detectThemeVoiceAction(transcript);
        if (action.action === "set_theme") {
          setTheme(action.theme!);
          showToast({
            message: `Theme changed to ${action.theme}`,
            type: "success",
          });
        } else if (action.action === "search") {
          setQuery(action.query!);
          showToast({
            message: `Searching for "${action.query}"`,
            type: "success",
          });
        } else if (action.action === "search_and_play") {
          setQuery(action.query!);
          showToast({
            message: `Playing "${action.query}"`,
            type: "success",
          });

          // Wait a bit for search to trigger and then try to play first item
          setTimeout(async () => {
            if (tracks && tracks.length > 0) {
              await playQueue(tracks, 0);
            }
          }, 1500);
        } else if (action.action === "pause") {
          await pauseTrack();
          showToast({ message: "Music paused", type: "success" });
        } else if (action.action === "resume") {
          await resumeTrack();
          showToast({ message: "Music resumed", type: "success" });
        } else if (action.action === "stop") {
          await pauseTrack();
          showToast({ message: "Music stopped", type: "success" });
        } else if (action.action === "next") {
          await playNext();
          showToast({ message: "Playing next track", type: "success" });
        } else if (action.action === "previous") {
          await playPrevious();
          showToast({ message: "Playing previous track", type: "success" });
        } else if (action.action === "refresh_suggestions") {
          await refetchSuggestedArtists();
          showToast({ message: "Suggestions refreshed", type: "success" });
        } else if (action.action === "change_filter") {
          if (action.filter) {
            setFilter(action.filter);
            showToast({
              message: `Search filter changed to ${action.filter}`,
              type: "success",
            });
          }
        } else {
          showToast({
            message: "Action not recognized",
            type: "info",
          });
        }
      } catch (error) {
        showToast({
          message: "Failed to process voice action",
          type: "error",
        });
      } finally {
        setVoiceActionStatus("idle");
      }
    })();
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (!voiceActionOwnerRef.current) return;
    voiceActionOwnerRef.current = false;
    setIsVoiceActionListening(false);
    setVoiceActionStatus("error");
    showToast({
      message: event.message || "Voice recognition error",
      type: "error",
    });
    setTimeout(() => setVoiceActionStatus("idle"), 1500);
  });

  const handleVoiceAction = useCallback(async () => {
    if (isVoiceActionListening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }

    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {}

    const isAvailable =
      await ExpoSpeechRecognitionModule.isRecognitionAvailable();
    if (!isAvailable) return;

    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) return;

    voiceActionOwnerRef.current = true;
    setVoiceActionStatus("listening");
    ExpoSpeechRecognitionModule.start({
      lang: speechLang,
      interimResults: true,
      continuous: false,
      androidIntentOptions: {
        EXTRA_LANGUAGE_MODEL: "web_search",
      },
    });
  }, [isVoiceActionListening, speechLang]);

  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<any | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<any | null>(null);
  const artistSheetRef = useRef<BottomSheetModal | null>(null);
  const artistSnapPoints = useMemo(() => ["90%"], []);

  const { data: artistDetails, isLoading: isArtistLoading } = useQuery({
    queryKey: ["artist", selectedArtist?.id],
    queryFn: async () => {
      if (!selectedArtist?.id) return null;
      const id = parseInt(String(selectedArtist.id));
      if (isNaN(id)) return null;
      return await losslessAPI.getArtist(id);
    },
    enabled:
      !!selectedArtist?.id && !isNaN(parseInt(String(selectedArtist.id))),
  });

  const { data: albumDetails, isLoading: isAlbumLoading } = useQuery({
    queryKey: ["album", selectedAlbum?.id],
    queryFn: async () => {
      if (!selectedAlbum?.id) return null;
      const id = parseInt(String(selectedAlbum.id));
      if (isNaN(id)) return null;
      return await losslessAPI.getAlbum(id);
    },
    enabled: !!selectedAlbum?.id && !isNaN(parseInt(String(selectedAlbum.id))),
  });

  const { data: playlistDetails, isLoading: isPlaylistLoading } =
    useGetPlaylistPlaylistGet(
      { id: String(selectedPlaylist?.uuid) },
      { query: { enabled: !!selectedPlaylist?.uuid } }
    );

  const artistTopTracks = useMemo(() => {
    if (!artistDetails) return [] as Track[];
    return (artistDetails.tracks || []).map(
      (item: any, index: number): Track => {
        return {
          id: String(item.id),
          title: item.title || "Unknown Title",
          artist: item.artist?.name || selectedArtist?.name || "Unknown Artist",
          artwork: resolveArtwork(item) || resolveArtwork(selectedArtist),
          url: item.url || "",
        };
      }
    );
  }, [artistDetails, selectedArtist]);

  const albumTracks = useMemo(() => {
    if (!albumDetails) return [] as Track[];
    return (albumDetails.tracks || []).map((item: any): Track => {
      return {
        id: String(item.id),
        title: item.title || "Unknown Title",
        artist:
          item.artist?.name ||
          albumDetails.album?.artist?.name ||
          "Unknown Artist",
        artwork: resolveArtwork(item) || resolveArtwork(albumDetails.album),
        url: item.url || "",
      };
    });
  }, [albumDetails]);

  const playlistTracks = useMemo(() => {
    if (!playlistDetails || !playlistDetails.items) return [] as Track[];
    return playlistDetails.items.map((entry: any): Track => {
      const item = entry.item;
      return {
        id: String(item.id),
        title: item.title || "Unknown Title",
        artist: item.artist?.name || "Unknown Artist",
        artwork:
          resolveArtwork(item) || resolveArtwork(playlistDetails.playlist),
        url: item.url || "",
      };
    });
  }, [playlistDetails]);

  const artistAlbums = useMemo(() => {
    if (!artistDetails) return [];
    return artistDetails.albums || [];
  }, [artistDetails]);

  const favoritesSheetRef = useRef<BottomSheetModal | null>(null);
  const settingsSheetRef = useRef<BottomSheetModal | null>(null);
  const favoritesSnapPoints = useMemo(() => ["100%"], []);
  const settingsSnapPoints = useMemo(() => ["55%"], []);
  const aiHelpSheetRef = useRef<BottomSheetModal | null>(null);
  const aiHelpSnapPoints = useMemo(() => ["80%"], []);
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

  const { data: suggestedArtists, refetch: refetchSuggestedArtists } = useQuery(
    {
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
          return df;
        }
        return [...df, ...response] as SuggestedArtist[];
      },
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 5,
      retry: 2,
    }
  );

  const suggestedArtistNames = useMemo(() => {
    if (!suggestedArtists || suggestedArtists.length === 0) return [];

    // Mock artists are the first 3 in the current implementation of queryFn
    const mockNames = ["Vannda", "Tep piseth", "Sin Sisamut"];

    const allNames = suggestedArtists
      .map((entry) =>
        typeof entry?.name === "string" ? entry.name.trim() : ""
      )
      .filter((name) => name.length > 0);

    const uniqueNames = Array.from(new Set(allNames));

    // Separate mock names from the rest
    const mocks = uniqueNames.filter((name) => mockNames.includes(name));
    const others = uniqueNames.filter((name) => !mockNames.includes(name));

    // Randomize the "others" pool
    const randomizedOthers = others.sort(() => Math.random() - 0.5);

    // Combine mocks first, then randomized others, total 10
    return [...mocks, ...randomizedOthers].slice(0, 10);
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

  const shouldFetchMainQuery = useMemo(() => {
    if (filter === "playlists" && !query) return false;
    return true;
  }, [filter, query]);

  const { data, isLoading, error } = useSearchSearchGet(params, {
    query: { enabled: shouldFetchMainQuery },
  });

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
    { key: "songs", label: speechLang === "en-US" ? "Songs" : "បទចម្រៀង" },
    { key: "artists", label: speechLang === "en-US" ? "Artists" : "សិល្បករ" },
    { key: "albums", label: speechLang === "en-US" ? "Albums" : "អាល់ប៊ុម" },
    {
      key: "playlists",
      label: speechLang === "en-US" ? "Playlists" : "បញ្ជីចាក់",
    },
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

  const playlists = useMemo(() => {
    if (filter !== "playlists") return [];
    return listData.map((item, index): Playlist => {
      const id = item.id || `playlist-${index}`;
      return {
        id: String(id),
        title: item.title || "Unknown Playlist",
        creator: resolveName(item.artist || item.author),
        artwork: resolveArtwork(item),
        trackCount: (item as any).trackCount || (item as any).numberOfTracks,
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

    if (filter === "playlists") {
      const playlist = playlists[index];
      if (!playlist) return null;
      return (
        <PlaylistItem
          playlist={playlist}
          onPress={() => {
            const item = listData[index];
            setSelectedPlaylist(item);
            artistSheetRef.current?.present();
          }}
        />
      );
    }

    const track = tracks[index];
    if (!track) return null;

    if (filter === "albums") {
      return (
        <TrackItem
          track={track}
          onPress={() => {
            const item = listData[index];
            setSelectedAlbum(item);
            artistSheetRef.current?.present();
          }}
        />
      );
    }

    return (
      <TrackItem
        track={track}
        onPress={() => {
          void playQueue(tracks, index);
        }}
      />
    );
  };

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("open-favorites-sheet", () => {
      favoritesSheetRef.current?.present();
    });
    return () => sub.remove();
  }, []);

  const renderSavedItem = ({
    item,
    index,
  }: {
    item: SavedTrack;
    index: number;
  }) => {
    return (
      <Card className="flex-row items-center p-3 mb-2 bg-content2 border-none shadow-sm">
        <TouchableOpacity
          className="flex-1 flex-row items-center"
          onPress={() => {
            void playQueue(favoriteQueue, index);
            favoritesSheetRef.current?.dismiss();
          }}
        >
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
        </TouchableOpacity>

        <TouchableOpacity
          className="p-2 ml-2"
          onPress={() => {
            void removeFavorite(item.id);
          }}
        >
          <Ionicons name="trash-outline" size={20} color="#ff4444" />
        </TouchableOpacity>
      </Card>
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
          <View className="flex-row items-center gap-x-1.5">
            <TimerStatus absolute={false} />
            <View className="flex-row items-center bg-content2 border border-default-200 rounded-full overflow-hidden">
              <TouchableOpacity
                className={`p-1 flex-row items-center border-r border-default-200 active:bg-default-100 ${
                  voiceActionStatus === "processing" ? "bg-primary/5 px-2" : ""
                }`}
                onPress={() => {
                  void handleVoiceAction();
                }}
              >
                <Ionicons
                  name={
                    voiceActionStatus === "processing"
                      ? "sparkles"
                      : isVoiceActionListening
                      ? "mic"
                      : "sparkles-outline"
                  }
                  size={18}
                  color={
                    voiceActionStatus === "error"
                      ? "#FF3B30"
                      : isVoiceActionListening ||
                        voiceActionStatus === "processing"
                      ? "#007AFF"
                      : themeColorForeground
                  }
                />
                {voiceActionStatus === "processing" && (
                  <View className="flex-row items-center ml-1">
                    <StyledText className="text-[#007AFF] font-bold text-[10px]">
                      Thinking
                    </StyledText>
                    <ThinkingDots />
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                className="px-2 py-1 flex-row items-center justify-center border-r border-default-200 active:bg-default-100 h-full"
                onPress={() => {
                  setSpeechLang((prev) =>
                    prev === "en-US" ? "km-KH" : "en-US"
                  );
                }}
              >
                <StyledText className="text-[10px] font-bold text-foreground opacity-60 uppercase">
                  {speechLang === "en-US" ? "EN" : "KH"}
                </StyledText>
              </TouchableOpacity>
              <TouchableOpacity
                className="p-1 active:bg-default-100"
                onPress={() => aiHelpSheetRef.current?.present()}
              >
                <Ionicons
                  name="help-circle-outline"
                  size={16}
                  color={themeColorForeground}
                  style={{ opacity: 0.6 }}
                />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              className="p-1.5 active:bg-default-100 rounded-full"
              onPress={() => settingsSheetRef.current?.present()}
            >
              <Ionicons
                name="settings"
                size={20}
                color={themeColorForeground}
              />
            </TouchableOpacity>
            <TouchableOpacity
              className="p-1.5 active:bg-default-100 rounded-full"
              onPress={() => favoritesSheetRef.current?.present()}
            >
              <Ionicons
                name={favorites.length > 0 ? "heart" : "heart-outline"}
                size={20}
                color="red"
              />
            </TouchableOpacity>
          </View>
        </View>

        {suggestedArtistNames.length > 0 ? (
          <StyledView className="mb-3">
            <StyledText className="text-default-500 text-[11px] font-semibold uppercase tracking-wider mb-2 px-1">
              {speechLang === "en-US"
                ? "Suggested artists"
                : "សិល្បករដែលបានណែនាំ"}
            </StyledText>
            <StyledScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ maxHeight: 38 }}
            >
              {suggestedArtistNames.map((name) => (
                <StyledTouchableOpacity
                  key={name}
                  onPress={() => {
                    setFilter("artists");
                    setQuery(name);
                  }}
                  className="mr-2 h-8 px-3 flex-row items-center justify-center rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10"
                >
                  <StyledText className="text-[13px] font-medium text-default-700 dark:text-default-300">
                    {name}
                  </StyledText>
                </StyledTouchableOpacity>
              ))}
            </StyledScrollView>
          </StyledView>
        ) : null}
        <StyledView className="mb-4">
          <SearchComposer
            value={query}
            onChangeText={setQuery}
            placeholder={
              speechLang === "en-US"
                ? "Search songs, artists, albums..."
                : "ស្វែងរកបទចម្រៀង, សិល្បករ, អាល់ប៊ុម..."
            }
            className="mb-4"
            voiceLang={speechLang}
          />
          <StyledScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ maxHeight: 38 }}
          >
            {filters.map((f) => {
              const isActive = filter === f.key;
              return (
                <StyledTouchableOpacity
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  className={`mr-2 h-8 px-3 flex-row items-center justify-center rounded-lg border ${
                    isActive
                      ? "bg-foreground border-foreground shadow-sm"
                      : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10"
                  }`}
                >
                  <StyledText
                    className={`text-[13px] font-semibold ${
                      isActive
                        ? "text-background"
                        : "text-default-600 dark:text-default-400"
                    }`}
                  >
                    {f.label}
                  </StyledText>
                </StyledTouchableOpacity>
              );
            })}
          </StyledScrollView>
        </StyledView>
        <ApiDebug title="Home search" data={data} error={error} />
      </StyledView>

      {filter === "playlists" && !query ? (
        <PlaylistDiscovery
          onSelect={(p) => {
            setSelectedPlaylist(p);
            artistSheetRef.current?.present();
          }}
        />
      ) : isLoading ? (
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
            paddingBottom: 20,
          }}
          ListHeaderComponent={
            !query ? (
              <StyledView className="mb-2">
                <StyledText className="text-lg font-bold mb-1.5">
                  {speechLang === "en-US"
                    ? "Made for you"
                    : "បង្កើតសម្រាប់អ្នក"}
                </StyledText>
                <StyledText className="text-default-500 text-[13px] mb-2">
                  {speechLang === "en-US"
                    ? "Fresh tunes to get you started"
                    : "បទថ្មីៗដើម្បីចាប់ផ្តើម"}
                </StyledText>
              </StyledView>
            ) : null
          }
          ListEmptyComponent={
            <StyledView className="flex-1 justify-center items-center mt-20">
              <StyledText className="text-default-500 text-lg text-center px-4">
                {query
                  ? speechLang === "en-US"
                    ? "No results found"
                    : "រកមិនឃើញលទ្ធផល"
                  : speechLang === "en-US"
                  ? "Start typing to find songs, artists and more"
                  : "ចាប់ផ្តើមវាយដើម្បីស្វែងរកបទចម្រៀង សិល្បករ និងផ្សេងៗទៀត"}
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
        <StyledView className="flex-1 bg-background">
          <View className="px-4 pt-3 pb-2 flex-row items-center justify-between">
            <View className="flex-row items-center">
              {(selectedAlbum || selectedPlaylist) && (
                <TouchableOpacity
                  onPress={() => {
                    if (selectedAlbum) setSelectedAlbum(null);
                    if (selectedPlaylist) setSelectedPlaylist(null);
                  }}
                  className="mr-3 p-1"
                >
                  <Ionicons
                    name="arrow-back"
                    size={24}
                    color={themeColorForeground}
                  />
                </TouchableOpacity>
              )}
              <Text className="text-xl font-bold text-foreground">
                {selectedAlbum
                  ? speechLang === "en-US"
                    ? "Album Tracks"
                    : "បទក្នុងអាល់ប៊ុម"
                  : selectedPlaylist
                  ? speechLang === "en-US"
                    ? "Playlist Tracks"
                    : "បទក្នុងបញ្ជីចាក់"
                  : speechLang === "en-US"
                  ? "Artist Details"
                  : "ព័ត៌មានសិល្បករ"}
              </Text>
            </View>
            <TouchableOpacity
              className="p-2"
              onPress={() => {
                artistSheetRef.current?.dismiss();
                setSelectedAlbum(null);
                setSelectedPlaylist(null);
              }}
            >
              <Ionicons name="close" size={22} color={themeColorForeground} />
            </TouchableOpacity>
          </View>

          {isArtistLoading ||
          (selectedAlbum && isAlbumLoading) ||
          (selectedPlaylist && isPlaylistLoading) ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color="#fff" />
            </View>
          ) : (
            <BottomSheetFlatList
              style={{ flex: 1 }}
              ListHeaderComponent={
                <View className="px-4 mb-6">
                  {selectedAlbum ? (
                    <View className="flex-row items-center mb-6">
                      <View className="w-24 h-24 rounded-lg overflow-hidden mr-4 bg-content3 shadow-md">
                        <Image
                          source={{ uri: resolveArtwork(selectedAlbum) }}
                          className="w-full h-full"
                          resizeMode="cover"
                        />
                      </View>
                      <View className="flex-1">
                        <Text className="text-2xl font-bold text-foreground">
                          {selectedAlbum.title}
                        </Text>
                        <Text className="text-default-500">
                          {selectedAlbum.releaseDate?.split("-")[0] ||
                            (speechLang === "en-US" ? "Album" : "អាល់ប៊ុម")}
                        </Text>
                      </View>
                    </View>
                  ) : selectedPlaylist ? (
                    <View>
                      <View className="flex-row items-center mb-6">
                        <View className="w-24 h-24 rounded-lg overflow-hidden mr-4 bg-content3 shadow-md">
                          <Image
                            source={{ uri: resolveArtwork(selectedPlaylist) }}
                            className="w-full h-full"
                            resizeMode="cover"
                          />
                        </View>
                        <View className="flex-1">
                          <Text className="text-2xl font-bold text-foreground">
                            {selectedPlaylist.title}
                          </Text>
                          <Text className="text-default-500">
                            {resolveName(
                              selectedPlaylist.artist || selectedPlaylist.author
                            ) ||
                              (speechLang === "en-US"
                                ? "Playlist"
                                : "បញ្ជីចាក់")}
                          </Text>
                        </View>
                      </View>

                      {playlistDetails?.playlist?.promotedArtists &&
                        playlistDetails.playlist.promotedArtists.length > 0 && (
                          <View className="mb-4">
                            <Text className="text-lg font-bold text-foreground mb-2">
                              {speechLang === "en-US"
                                ? "Promoted Artists"
                                : "សិល្បករដែលបានផ្សព្វផ្សាយ"}
                            </Text>
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                            >
                              {playlistDetails.playlist.promotedArtists.map(
                                (artist: any) => (
                                  <TouchableOpacity
                                    key={artist.id}
                                    className="mr-4 items-center"
                                    onPress={() => {
                                      setSelectedPlaylist(null);
                                      setSelectedArtist(artist);
                                    }}
                                  >
                                    <View className="w-16 h-16 rounded-full overflow-hidden bg-content3 mb-1">
                                      <Image
                                        source={{ uri: resolveArtwork(artist) }}
                                        className="w-full h-full"
                                        resizeMode="cover"
                                      />
                                    </View>
                                    <Text
                                      className="text-xs text-foreground text-center"
                                      numberOfLines={1}
                                      style={{ width: 64 }}
                                    >
                                      {artist.name}
                                    </Text>
                                  </TouchableOpacity>
                                )
                              )}
                            </ScrollView>
                          </View>
                        )}
                    </View>
                  ) : (
                    <View className="flex-row items-center mb-6">
                      <View className="w-24 h-24 rounded-full overflow-hidden mr-4 bg-content3 shadow-md">
                        {resolveArtwork(selectedArtist) ? (
                          <Image
                            source={{ uri: resolveArtwork(selectedArtist) }}
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
                          {selectedArtist?.subscribers ||
                            (speechLang === "en-US" ? "Artist" : "សិល្បករ")}
                        </Text>
                      </View>
                    </View>
                  )}

                  {((!selectedAlbum &&
                    !selectedPlaylist &&
                    artistTopTracks.length > 0) ||
                    (selectedAlbum && albumTracks.length > 0) ||
                    (selectedPlaylist && playlistTracks.length > 0)) && (
                    <View className="mb-8">
                      <View className="flex-row justify-between items-center mb-4">
                        <View>
                          <Text className="text-xl font-bold text-foreground">
                            {selectedAlbum
                              ? speechLang === "en-US"
                                ? "Tracks"
                                : "បទ"
                              : selectedPlaylist
                              ? speechLang === "en-US"
                                ? "Tracks"
                                : "បទ"
                              : speechLang === "en-US"
                              ? "Top Tracks"
                              : "បទល្បីៗ"}
                          </Text>
                          <Text className="text-default-500 text-sm">
                            {selectedAlbum
                              ? speechLang === "en-US"
                                ? `All songs from ${selectedAlbum.title}`
                                : `បទទាំងអស់ពី ${selectedAlbum.title}`
                              : selectedPlaylist
                              ? speechLang === "en-US"
                                ? `All songs from ${selectedPlaylist.title}`
                                : `បទទាំងអស់ពី ${selectedPlaylist.title}`
                              : speechLang === "en-US"
                              ? `Best songs from ${selectedArtist?.name}`
                              : `បទល្អបំផុតពី ${selectedArtist?.name}`}
                          </Text>
                        </View>
                        <TouchableOpacity
                          className="bg-primary px-4 py-2 rounded-full"
                          onPress={() => {
                            const tracksToPlay = selectedAlbum
                              ? albumTracks
                              : selectedPlaylist
                              ? playlistTracks
                              : artistTopTracks;
                            if (tracksToPlay.length > 0) {
                              void playQueue(tracksToPlay, 0);
                            }
                          }}
                        >
                          <Text className="text-primary-foreground font-bold">
                            {speechLang === "en-US"
                              ? "Play All"
                              : "ចាក់ទាំងអស់"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              }
              data={
                selectedAlbum
                  ? albumTracks
                  : selectedPlaylist
                  ? playlistTracks
                  : artistTopTracks
              }
              keyExtractor={(item: Track) => item.id}
              renderItem={({ item, index }: { item: Track; index: number }) => {
                const tracksToPlay = selectedAlbum
                  ? albumTracks
                  : selectedPlaylist
                  ? playlistTracks
                  : artistTopTracks;
                return (
                  <View className="px-4">
                    <TrackItem
                      track={item}
                      onPress={() => {
                        void playQueue(tracksToPlay, index);
                      }}
                    />
                  </View>
                );
              }}
              ListFooterComponent={
                !selectedAlbum &&
                !selectedPlaylist &&
                artistAlbums.length > 0 ? (
                  <View className="px-4 mt-8">
                    <Text className="text-xl font-bold text-foreground mb-4">
                      Albums
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      className="flex-row"
                    >
                      {artistAlbums.map((album: any) => (
                        <TouchableOpacity
                          key={album.id}
                          className="mr-4 w-32"
                          onPress={() => {
                            setSelectedAlbum(album);
                          }}
                        >
                          <View className="w-32 h-32 rounded-lg overflow-hidden bg-content3 mb-2 shadow-sm">
                            <Image
                              source={{ uri: resolveArtwork(album) }}
                              className="w-full h-full"
                              resizeMode="cover"
                            />
                          </View>
                          <Text
                            className="text-foreground font-medium text-sm"
                            numberOfLines={1}
                          >
                            {album.title}
                          </Text>
                          <Text className="text-default-500 text-xs">
                            {album.releaseDate?.split("-")[0] || "Album"}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                ) : null
              }
              contentContainerStyle={{
                paddingBottom: 60,
              }}
            />
          )}
        </StyledView>
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
        <StyledView className="flex-1 bg-background">
          <View className="px-4 pt-3 pb-2 flex-col items-start justify-between">
            <View className="flex-row items-center justify-between w-full">
              <Text className="text-xl font-bold text-foreground">
                {speechLang === "en-US" ? "Favorites" : "ចំណូលចិត្ត"}
              </Text>
              <TouchableOpacity
                className="p-2"
                onPress={() => favoritesSheetRef.current?.dismiss()}
              >
                <Ionicons name="close" size={22} color={themeColorForeground} />
              </TouchableOpacity>
            </View>
            <View className="flex-row gap-2 mt-2">
              <Chip
                variant={favViewMode === "songs" ? "primary" : "secondary"}
                color={favViewMode === "songs" ? "accent" : "default"}
                onPress={() => {
                  setFavViewMode("songs");
                  setFavArtistFilter(null);
                }}
              >
                {speechLang === "en-US" ? "Songs" : "បទចម្រៀង"}
              </Chip>
              <Chip
                variant={favViewMode === "artists" ? "primary" : "secondary"}
                color={favViewMode === "artists" ? "accent" : "default"}
                onPress={() => setFavViewMode("artists")}
              >
                {speechLang === "en-US" ? "Artists" : "សិល្បករ"}
              </Chip>
            </View>
          </View>

          {favorites.length === 0 ? (
            <View className="flex-1 items-center justify-center px-6">
              <Text className="text-default-500 text-center">
                {speechLang === "en-US"
                  ? "No favorites yet."
                  : "មិនទាន់មានចំណូលចិត្តនៅឡើយទេ។"}
              </Text>
              <Text className="text-default-500 text-center mt-2">
                {speechLang === "en-US"
                  ? "Tap the heart in the player to save tracks."
                  : "ចុចលើបេះដូងក្នុងកម្មវិធីចាក់ដើម្បីរក្សាទុកបទចម្រៀង។"}
              </Text>
            </View>
          ) : favViewMode === "artists" ? (
            <BottomSheetFlatList
              data={Array.from(
                new Set(
                  favorites
                    .map((t) => t.artist)
                    .filter((a): a is string => typeof a === "string" && !!a)
                )
              ).sort()}
              keyExtractor={(item: string) => item}
              renderItem={({ item: artistName }: { item: string }) => (
                <TouchableOpacity
                  onPress={() => {
                    setFavArtistFilter(artistName);
                    setFavViewMode("songs");
                  }}
                  className="flex-row items-center px-4 py-3 active:bg-content2"
                >
                  <View className="w-12 h-12 rounded-full bg-content3 items-center justify-center mr-3 overflow-hidden">
                    {/* Try to find artwork from the first track of this artist */}
                    <Image
                      source={{
                        uri: resolveArtwork(
                          favorites.find((t) => t.artist === artistName)
                        ),
                      }}
                      className="w-full h-full"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-foreground font-medium text-lg">
                      {artistName}
                    </Text>
                    <Text className="text-default-500 text-sm">
                      {favorites.filter((t) => t.artist === artistName).length}{" "}
                      {speechLang === "en-US" ? "songs" : "បទ"}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={themeColorForeground}
                  />
                </TouchableOpacity>
              )}
              contentContainerStyle={{
                paddingBottom: 24,
              }}
            />
          ) : (
            <>
              {favArtistFilter && (
                <View className="px-4 py-2 flex-row items-center">
                  <Text className="text-foreground text-sm mr-2">
                    {speechLang === "en-US" ? "Filtered by: " : "ត្រងដោយ៖ "}
                    <Text className="font-bold">{favArtistFilter}</Text>
                  </Text>
                  <TouchableOpacity onPress={() => setFavArtistFilter(null)}>
                    <Ionicons
                      name="close-circle"
                      size={18}
                      color={themeColorForeground}
                    />
                  </TouchableOpacity>
                </View>
              )}
              <BottomSheetFlatList
                data={
                  favArtistFilter
                    ? favorites.filter((t) => t.artist === favArtistFilter)
                    : favorites
                }
                keyExtractor={(item: SavedTrack) => item.id}
                renderItem={renderSavedItem}
                contentContainerStyle={{
                  paddingHorizontal: 16,
                  paddingBottom: 24,
                }}
              />
            </>
          )}
        </StyledView>
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
            <Text className="text-xl font-bold text-foreground">
              {speechLang === "en-US" ? "Settings" : "ការកំណត់"}
            </Text>
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
                {speechLang === "en-US" ? "Dark mode" : "មុខងារងងឹត"}
              </Text>
              <Switch
                value={isDark}
                onValueChange={(next) => setTheme(next ? "dark" : "light")}
              />
            </View>

            <View className="py-4 border-b border-default-200">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-base text-foreground font-medium">
                  {speechLang === "en-US"
                    ? "Streaming quality"
                    : "គុណភាពការចាក់"}
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
                  {speechLang === "en-US" ? "Sleep timer" : "កំណត់ពេលបិទ"}
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
                  <Text className="text-foreground">
                    {speechLang === "en-US" ? "10m" : "10នាទី"}
                  </Text>
                </Chip>
                <Chip
                  onPress={() => startSleepTimer(20)}
                  className="mr-2 mb-2 bg-default-200"
                >
                  <Text className="text-foreground">
                    {speechLang === "en-US" ? "20m" : "20នាទី"}
                  </Text>
                </Chip>
                <Chip
                  onPress={() => startSleepTimer(30)}
                  className="mr-2 mb-2 bg-default-200"
                >
                  <Text className="text-foreground">
                    {speechLang === "en-US" ? "30m" : "30នាទី"}
                  </Text>
                </Chip>
                <Chip
                  onPress={() => startSleepTimer(60)}
                  className="mr-2 mb-2 bg-default-200"
                >
                  <Text className="text-foreground">
                    {speechLang === "en-US" ? "1h" : "1ម៉ោង"}
                  </Text>
                </Chip>
                {sleepTimerEndsAt ? (
                  <Chip
                    onPress={cancelSleepTimer}
                    className="mr-2 mb-2 bg-default-200"
                  >
                    <Text className="text-foreground">
                      {speechLang === "en-US" ? "Off" : "បិទ"}
                    </Text>
                  </Chip>
                ) : null}
              </View>
            </View>
          </View>
        </StyledBottomSheetView>
      </BottomSheetModal>

      <BottomSheetModal
        ref={aiHelpSheetRef}
        snapPoints={aiHelpSnapPoints}
        index={0}
        enablePanDownToClose
        enableDismissOnClose
        backdropComponent={favoritesBackdrop}
        animationConfigs={favoritesAnimationConfigs}
        handleIndicatorStyle={{ backgroundColor: "#ccc" }}
        backgroundStyle={{ backgroundColor: themeColorBackground }}
      >
        <StyledBottomSheetView className="flex-1 bg-background px-4">
          <View className="pt-3 pb-4 flex-row items-center justify-between">
            <View className="flex-row items-center">
              <Ionicons name="sparkles" size={20} color="#007AFF" />
              <Text className="text-xl font-bold text-foreground ml-2">
                {speechLang === "en-US" ? "AI Assistant" : "ជំនួយការ AI"}
              </Text>
            </View>
            <TouchableOpacity
              className="p-2"
              onPress={() => aiHelpSheetRef.current?.dismiss()}
            >
              <Ionicons name="close" size={22} color={themeColorForeground} />
            </TouchableOpacity>
          </View>

          <StyledScrollView showsVerticalScrollIndicator={false}>
            <View className="mb-6">
              <Text className="text-default-500 text-sm mb-4">
                {speechLang === "en-US"
                  ? "You can control HiFi Flow using natural voice commands. Tap the sparkle icon to start listening."
                  : "អ្នកអាចបញ្ជា HiFi Flow ដោយប្រើសំឡេង។ ចុចលើរូបផ្កាយដើម្បីចាប់ផ្តើម។"}
              </Text>

              <View className="bg-content2 rounded-2xl p-4 mb-4">
                <Text className="text-foreground font-bold mb-3">
                  {speechLang === "en-US"
                    ? "Playback Controls"
                    : "ការគ្រប់គ្រងការចាក់"}
                </Text>
                <View className="space-y-2">
                  <Text className="text-default-600 text-sm">
                    •{" "}
                    {speechLang === "en-US"
                      ? '"Pause the music" or "Stop"'
                      : '"ផ្អាកតន្ត្រី" ឬ "ឈប់"'}
                  </Text>
                  <Text className="text-default-600 text-sm">
                    •{" "}
                    {speechLang === "en-US"
                      ? '"Play", "Resume", or "Continue"'
                      : '"ចាក់" ឬ "បន្ត"'}
                  </Text>
                  <Text className="text-default-600 text-sm">
                    •{" "}
                    {speechLang === "en-US"
                      ? '"Next song" or "Skip this"'
                      : '"បទបន្ទាប់" ឬ "រំលង"'}
                  </Text>
                  <Text className="text-default-600 text-sm">
                    •{" "}
                    {speechLang === "en-US"
                      ? '"Previous track" or "Go back"'
                      : '"បទមុន" ឬ "ត្រឡប់ក្រោយ"'}
                  </Text>
                </View>
              </View>

              <View className="bg-content2 rounded-2xl p-4 mb-4">
                <Text className="text-foreground font-bold mb-3">
                  {speechLang === "en-US" ? "Search & Discovery" : "ការស្វែងរក"}
                </Text>
                <View className="space-y-2">
                  <Text className="text-default-600 text-sm">
                    •{" "}
                    {speechLang === "en-US"
                      ? '"Search for Vannda"'
                      : '"ស្វែងរក Vannda"'}
                  </Text>
                  <Text className="text-default-600 text-sm">
                    •{" "}
                    {speechLang === "en-US"
                      ? '"Play and search for Lo-fi beats"'
                      : '"ចាក់ និងស្វែងរក Lo-fi beats"'}
                  </Text>
                  <Text className="text-default-600 text-sm">
                    •{" "}
                    {speechLang === "en-US"
                      ? '"Switch filter to artists"'
                      : '"ប្តូរទៅតម្រងសិល្បករ"'}
                  </Text>
                  <Text className="text-default-600 text-sm">
                    •{" "}
                    {speechLang === "en-US"
                      ? '"Refresh suggested artists"'
                      : '"ផ្ទុកសិល្បករដែលបានណែនាំឡើងវិញ"'}
                  </Text>
                </View>
              </View>

              <View className="bg-content2 rounded-2xl p-4">
                <Text className="text-foreground font-bold mb-3">
                  {speechLang === "en-US"
                    ? "System Settings"
                    : "ការកំណត់ប្រព័ន្ធ"}
                </Text>
                <View className="space-y-2">
                  <Text className="text-default-600 text-sm">
                    •{" "}
                    {speechLang === "en-US"
                      ? '"Turn on dark mode"'
                      : '"បើកមុខងារងងឹត"'}
                  </Text>
                  <Text className="text-default-600 text-sm">
                    •{" "}
                    {speechLang === "en-US"
                      ? '"Switch to light theme"'
                      : '"ប្តូរទៅស្បែកភ្លឺ"'}
                  </Text>
                </View>
              </View>
            </View>
          </StyledScrollView>
        </StyledBottomSheetView>
      </BottomSheetModal>
    </StyledSafeAreaView>
  );
}
