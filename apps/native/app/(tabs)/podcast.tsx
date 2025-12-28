import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import { usePodcastWeAnd } from "@/hooks/use-podcast-weand";
import { usePlayer } from "@/contexts/player-context";
import { TimerStatus } from "@/components/timer-status";
import { usePodcastAuth } from "@/hooks/use-auth";

const StyledSafeAreaView = withUniwind(SafeAreaView);
const StyledView = withUniwind(View);
const StyledText = withUniwind(Text);
const StyledTextInput = withUniwind(TextInput);
const StyledPressable = withUniwind(Pressable);

export default function PodcastScreen() {
  const { isUnlocked, isLoaded, unlock } = usePodcastAuth();
  const [passwordInput, setPasswordInput] = useState("");

  const {
    playQueue,
    pauseTrack,
    resumeTrack,
    currentTrack,
    isPlaying,
    loadingTrackId,
  } = usePlayer();
  const [searchQuery, setSearchQuery] = useState("");
  const {
    episodes,
    total,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = usePodcastWeAnd({ limit: 20 });

  const data = useMemo(() => {
    if (!searchQuery.trim()) return episodes;
    const query = searchQuery.toLowerCase();
    return episodes.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.artist.toLowerCase().includes(query)
    );
  }, [episodes, searchQuery]);

  const handlePlay = (index: number) => {
    const track = data[index];
    if (!track) return;

    const isActive = String(currentTrack?.id) === String(track.id);
    const isBusy = loadingTrackId === String(track.id);
    if (isBusy) return;

    if (isActive) {
      if (isPlaying) {
        void pauseTrack().catch(() => {});
      } else {
        void resumeTrack().catch(() => {});
      }
      return;
    }

    void playQueue(data, index, { queueType: "podcast", replaceQueue: true });
  };

  if (!isLoaded) {
    return (
      <StyledSafeAreaView className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#ef4444" />
      </StyledSafeAreaView>
    );
  }

  if (!isUnlocked) {
    return (
      <StyledSafeAreaView className="flex-1 bg-background" edges={["top"]}>
        <StyledView className="px-4 py-4">
          <StyledText className="text-3xl font-bold text-foreground mb-2">
            Podcast
          </StyledText>
          <StyledText className="text-foreground opacity-60">
            Authentication Required
          </StyledText>
        </StyledView>

        <StyledView className="flex-1 items-center justify-center px-8">
          <StyledView className="w-full bg-black/5 dark:bg-white/5 p-6 rounded-2xl border border-black/10 dark:border-white/10">
            <StyledText className="text-xl font-semibold text-foreground mb-6 text-center">
              Enter Password
            </StyledText>
            <StyledTextInput
              className="w-full h-12 bg-black/5 dark:bg-white/5 rounded-xl px-4 text-foreground mb-4 border border-black/5 dark:border-white/5"
              placeholder="••••••••"
              placeholderTextColor="#888"
              secureTextEntry
              value={passwordInput}
              onChangeText={setPasswordInput}
              autoFocus
            />
            <StyledPressable
              onPress={() => {
                if (!unlock(passwordInput)) {
                  Alert.alert("Error", "Incorrect password");
                  setPasswordInput("");
                }
              }}
              className="w-full bg-foreground h-12 rounded-xl items-center justify-center active:opacity-80"
            >
              <Text className="text-background font-bold text-lg">Unlock</Text>
            </StyledPressable>
          </StyledView>
        </StyledView>
      </StyledSafeAreaView>
    );
  }

  return (
    <StyledSafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <StyledView className="px-4 py-4 flex-row items-center justify-between">
        <View>
          <StyledText className="text-3xl font-bold text-foreground mb-2">
            Podcast
          </StyledText>
          <StyledText className="text-foreground opacity-60">
            {total ? `${data.length} / ${total}` : `${data.length}`} episodes
          </StyledText>
        </View>
        <TimerStatus absolute={false} />
      </StyledView>

      <View className="flex-row px-4 mb-4 gap-2">
        <View className="px-3 py-2 rounded-lg border bg-foreground border-foreground shadow-sm">
          <Text className="text-background font-semibold">WeAnd</Text>
        </View>
        <View className="flex-1 flex-row items-center px-3 bg-black/5 dark:bg-white/5 rounded-lg border border-black/10 dark:border-white/10">
          <Ionicons
            name="search"
            size={16}
            color="#888"
            style={{ marginRight: 8 }}
          />
          <StyledTextInput
            className="flex-1 h-10 text-foreground text-[14px]"
            placeholder="Search episodes..."
            placeholderTextColor="#888"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#ef4444" />
          <Text className="text-foreground opacity-60 mt-3">
            Loading podcasts...
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (!hasNextPage || isFetchingNextPage) return;
            void fetchNextPage();
          }}
          ListEmptyComponent={() => (
            <StyledView className="flex-1 items-center justify-center py-20 min-h-[400px]">
              <Ionicons
                name="mic-off-outline"
                size={48}
                color="#888"
                style={{ opacity: 0.5 }}
              />
              <StyledText className="text-foreground opacity-50 mt-4 text-lg">
                No podcasts found
              </StyledText>
            </StyledView>
          )}
          ListFooterComponent={() => (
            <View className="py-6">
              {searchQuery.trim() !== "" ? (
                <Text className="text-foreground opacity-50 text-center">
                  Showing {data.length} results for "{searchQuery}"
                </Text>
              ) : hasNextPage ? (
                <Pressable
                  className="px-4 py-3 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 flex-row items-center justify-center"
                  onPress={() => {
                    if (!hasNextPage || isFetchingNextPage) return;
                    void fetchNextPage();
                  }}
                >
                  {isFetchingNextPage ? (
                    <ActivityIndicator size="small" color="#ef4444" />
                  ) : (
                    <Text className="text-foreground font-semibold">
                      Load more
                    </Text>
                  )}
                </Pressable>
              ) : (
                <Text className="text-foreground opacity-50 text-center">
                  No more episodes
                </Text>
              )}
            </View>
          )}
          renderItem={({ item, index }) => {
            const isActive = String(currentTrack?.id) === String(item.id);
            const isBusy = loadingTrackId === String(item.id);
            const icon = isActive && isPlaying ? "pause" : ("play" as const);

            return (
              <Pressable
                onPress={() => handlePlay(index)}
                disabled={isBusy}
                className="flex-row items-center p-3 mb-2 rounded-xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5"
              >
                {item.artwork ? (
                  <Image
                    source={{ uri: item.artwork }}
                    className="w-12 h-12 rounded-lg mr-3"
                    resizeMode="cover"
                  />
                ) : (
                  <View className="w-12 h-12 rounded-lg mr-3 bg-default-200 items-center justify-center">
                    <Ionicons name="mic" size={18} color="#ef4444" />
                  </View>
                )}
                <View className="flex-1 justify-center">
                  <Text
                    className={`font-semibold text-[15px] ${
                      isActive ? "text-primary" : "text-foreground"
                    }`}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  <Text
                    className="text-[13px] text-foreground opacity-60"
                    numberOfLines={1}
                  >
                    {item.artist}
                  </Text>
                </View>
                <View className="pl-3 pr-1 h-10 items-center justify-center">
                  {isBusy ? (
                    <ActivityIndicator size="small" color="#ef4444" />
                  ) : (
                    <Ionicons
                      name={icon}
                      size={22}
                      color={isActive ? "#ef4444" : "#888"}
                    />
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </StyledSafeAreaView>
  );
}
