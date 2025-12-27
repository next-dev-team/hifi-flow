import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { BlurView } from "expo-blur";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Animated,
  DeviceEventEmitter,
  Image,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayer, type PreBufferStatus } from "@/contexts/player-context";
import { getSheetMargin, SHEET_MAX_WIDTH } from "@/utils/layout";
import { resolveArtwork } from "@/utils/resolvers";

export interface QueueSheetRef {
  open: () => void;
  close: () => void;
}

interface QueueSheetProps {
  onClose?: () => void;
}

export const OPEN_QUEUE_SHEET_EVENT = "open-queue-sheet";

/**
 * Pulsing buffer status indicator
 */
const BufferBadge: React.FC<{ status: PreBufferStatus }> = ({ status }) => {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (status === "buffering") {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 0.3,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
      return () => animation.stop();
    } else {
      opacity.setValue(1);
    }
  }, [status, opacity]);

  if (status !== "buffering" && status !== "ready") return null;

  return (
    <Animated.View
      style={{
        position: "absolute",
        top: -2,
        right: -2,
        opacity,
      }}
    >
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: status === "ready" ? "#22c55e" : "#f59e0b",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 2,
          borderColor: "#0a0a0a",
        }}
      >
        <Ionicons
          name={status === "ready" ? "checkmark" : "hourglass-outline"}
          size={10}
          color="#fff"
        />
      </View>
    </Animated.View>
  );
};

export const QueueSheet = forwardRef<QueueSheetRef, QueueSheetProps>(
  ({ onClose }, ref) => {
    const bottomSheetRef = useRef<BottomSheetModal>(null);
    const insets = useSafeAreaInsets();
    const { width: screenWidth } = useWindowDimensions();
    const {
      queue,
      currentTrack,
      isPlaying,
      playQueue,
      clearQueue,
      nextTrackBufferStatus,
      favorites,
      toggleFavorite,
      toggleTracksFavorites,
      removeFromQueue,
      shuffleQueue,
    } = usePlayer();

    // Desktop: calculate margin to center the sheet
    const sheetMargin = getSheetMargin(screenWidth);

    const snapPoints = useMemo(() => ["85%"], []);

    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<"songs" | "artists">("songs");
    const [artistFilter, setArtistFilter] = useState<string | null>(null);
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [isShuffling, setIsShuffling] = useState(false);
    const rotation = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      if (isShuffling) {
        const animation = Animated.loop(
          Animated.timing(rotation, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          })
        );
        animation.start();
        return () => animation.stop();
      } else {
        rotation.setValue(0);
      }
    }, [isShuffling, rotation]);

    const rotate = rotation.interpolate({
      inputRange: [0, 1],
      outputRange: ["0deg", "360deg"],
    });

    const handleShuffle = useCallback(() => {
      if (queue.length <= 1) return;
      setIsShuffling(true);
      // Small delay to show visual feedback
      setTimeout(() => {
        shuffleQueue();
        setIsShuffling(false);
      }, 500);
    }, [shuffleQueue, queue.length]);

    // Filter queue based on search and view mode
    const filteredQueue = useMemo(() => {
      const lowerQuery = searchQuery.toLowerCase();

      if (viewMode === "artists") {
        // Get unique artists
        const artists = Array.from(new Set(queue.map((t) => t.artist))).sort();
        if (!searchQuery) return artists;
        return artists.filter((a) => a.toLowerCase().includes(lowerQuery));
      }

      // Songs mode
      return queue.filter((track) => {
        // 1. apply artist filter if active
        if (artistFilter && track.artist !== artistFilter) return false;

        // 2. apply search query
        if (!searchQuery) return true;

        const matchesTitle = track.title.toLowerCase().includes(lowerQuery);
        const matchesArtist = track.artist.toLowerCase().includes(lowerQuery);
        return matchesTitle || matchesArtist;
      });
    }, [queue, searchQuery, viewMode, artistFilter]);

    // Check if track is favorited
    const isFavorited = useCallback(
      (trackId: number | string) => {
        return favorites.some((f) => String(f.id) === String(trackId));
      },
      [favorites]
    );

    // Handle clearing input when closed
    useEffect(() => {
      return () => {
        setSearchQuery("");
        setViewMode("songs");
        setArtistFilter(null);
      };
    }, []);

    const open = useCallback(() => {
      bottomSheetRef.current?.present();
    }, []);

    const close = useCallback(() => {
      bottomSheetRef.current?.dismiss();
      onClose?.();
    }, [onClose]);

    useImperativeHandle(ref, () => ({ open, close }), [open, close]);

    const renderBackdrop = useMemo(
      () =>
        forwardRef<unknown, BottomSheetBackdropProps>((props, _ref) => (
          <BottomSheetBackdrop
            {...props}
            opacity={0.5}
            appearsOnIndex={0}
            disappearsOnIndex={-1}
            pressBehavior="close"
          />
        )),
      []
    );

    const handleTrackPress = useCallback(
      (index: number) => {
        if (queue[index]) {
          // Play from this position in queue
          void playQueue([queue[index]], 0).catch((e) => {
            console.warn("[QueueSheet] playQueue failed", e);
          });
        }
      },
      [queue, playQueue]
    );

    const handleClearQueue = () => {
      setShowClearConfirm(true);
    };

    // Check if all tracks in queue are favorited
    const areAllFavorited = useMemo(() => {
      if (queue.length === 0) return false;
      const favIds = new Set(favorites.map((f) => String(f.id)));
      return queue.every((t) => favIds.has(String(t.id)));
    }, [queue, favorites]);

    const handleToggleAllFavorites = useCallback(() => {
      toggleTracksFavorites(queue);
    }, [toggleTracksFavorites, queue]);

    // Determine the next track index
    const currentIndex = queue.findIndex(
      (t) => String(t.id) === String(currentTrack?.id)
    );
    const nextIndex =
      currentIndex >= 0 ? (currentIndex + 1) % queue.length : -1;

    // Render Artist Item
    const renderArtistItem = useCallback(
      (artistName: string) => {
        // Find artwork from first track of this artist
        const representativeTrack = queue.find((t) => t.artist === artistName);
        const artwork = resolveArtwork(representativeTrack, "160");
        const count = queue.filter((t) => t.artist === artistName).length;

        return (
          <TouchableOpacity
            onPress={() => {
              setArtistFilter(artistName);
              setViewMode("songs");
              setSearchQuery(""); // Clear search when drilling down
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 12,
              paddingHorizontal: 16,
            }}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24, // Circle for artist
                overflow: "hidden",
                marginRight: 12,
                backgroundColor: "#333",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {artwork ? (
                <Image
                  source={{ uri: artwork }}
                  style={{ width: "100%", height: "100%" }}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons name="person" size={24} color="#666" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{ color: "#fff", fontSize: 16, fontWeight: "500" }}
                numberOfLines={1}
              >
                {artistName}
              </Text>
              <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
                {count} {count === 1 ? "song" : "songs"}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color="rgba(255,255,255,0.4)"
            />
          </TouchableOpacity>
        );
      },
      [queue]
    );

    const renderItem = useCallback(
      ({ item, index }: { item: any; index: number }) => {
        // Handle Artist Row
        if (typeof item === "string") {
          return renderArtistItem(item);
        }

        const isActive = String(item.id) === String(currentTrack?.id);
        const isNextTrack = index === nextIndex && queue.length > 1;
        const artwork = resolveArtwork(item, "160");
        const favorited = isFavorited(item.id);

        return (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 12,
              paddingHorizontal: 16,
              backgroundColor: isActive
                ? "rgba(96, 165, 250, 0.15)"
                : isNextTrack && nextTrackBufferStatus === "ready"
                ? "rgba(34, 197, 94, 0.08)"
                : "transparent",
            }}
          >
            <TouchableOpacity
              onPress={() => handleTrackPress(index)}
              style={{ flexDirection: "row", alignItems: "center", flex: 1 }}
            >
              <View style={{ position: "relative" }}>
                {artwork ? (
                  <Image
                    source={{ uri: artwork }}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 6,
                    }}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 6,
                      backgroundColor: "#333",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="musical-note" size={20} color="#666" />
                  </View>
                )}
                {isActive && (
                  <View
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      borderRadius: 6,
                      backgroundColor: "rgba(0,0,0,0.4)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons
                      name={isPlaying ? "pause" : "play"}
                      size={20}
                      color="#fff"
                    />
                  </View>
                )}
                {/* Buffer status badge for next track */}
                {isNextTrack && !isActive && (
                  <BufferBadge status={nextTrackBufferStatus} />
                )}
              </View>

              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: isActive ? "#60a5fa" : "#fff",
                    fontWeight: "500",
                    fontSize: 14,
                  }}
                >
                  {item.title}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    color: "rgba(255,255,255,0.6)",
                    fontSize: 12,
                    marginTop: 2,
                  }}
                >
                  {item.artist}
                </Text>
                {/* "Up next" label for next track */}
                {isNextTrack && !isActive && (
                  <Text
                    style={{
                      fontSize: 10,
                      marginTop: 2,
                      color:
                        nextTrackBufferStatus === "ready"
                          ? "#22c55e"
                          : nextTrackBufferStatus === "buffering"
                          ? "#f59e0b"
                          : "#888",
                    }}
                  >
                    {nextTrackBufferStatus === "ready"
                      ? "✓ Ready to play instantly"
                      : nextTrackBufferStatus === "buffering"
                      ? "● Buffering..."
                      : "Up next"}
                  </Text>
                )}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => toggleFavorite(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ padding: 8, marginRight: 4 }}
            >
              <Ionicons
                name={favorited ? "heart" : "heart-outline"}
                size={22}
                color={favorited ? "#ef4444" : "rgba(255,255,255,0.4)"}
              />
            </TouchableOpacity>

            {/* Remove Button (only for non-active tracks) */}
            {!isActive && (
              <TouchableOpacity
                onPress={() => removeFromQueue(String(item.id))}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={{ padding: 8, marginRight: 4 }}
              >
                <Ionicons
                  name="close-circle-outline"
                  size={20}
                  color="rgba(255,255,255,0.3)"
                />
              </TouchableOpacity>
            )}

            <View
              style={{
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 4,
                width: 30,
              }}
            >
              <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>
                {index + 1}
              </Text>
            </View>
          </View>
        );
      },

      [
        currentTrack,
        isPlaying,
        handleTrackPress,
        nextIndex,
        nextTrackBufferStatus,
        queue.length,
        isFavorited,
        toggleFavorite,
        renderArtistItem,
        removeFromQueue,
      ]
    );

    const ListEmptyComponent = useCallback(
      () => (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 80,
          }}
        >
          <Ionicons name="musical-notes-outline" size={48} color="#666" />
          <Text
            style={{
              color: "rgba(255,255,255,0.5)",
              fontSize: 16,
              marginTop: 16,
            }}
          >
            Queue is empty
          </Text>
          <Text
            style={{
              color: "rgba(255,255,255,0.3)",
              fontSize: 14,
              marginTop: 4,
            }}
          >
            Add some tracks to get started
          </Text>
        </View>
      ),
      []
    );

    return (
      <BottomSheetModal
        ref={bottomSheetRef}
        snapPoints={snapPoints}
        index={0}
        enablePanDownToClose
        enableDismissOnClose
        backdropComponent={renderBackdrop}
        style={{
          marginHorizontal: sheetMargin,
        }}
        backgroundStyle={{
          backgroundColor: Platform.OS === "ios" ? "transparent" : "#0a0a0a",
        }}
        handleIndicatorStyle={{
          backgroundColor: "rgba(255,255,255,0.3)",
          width: 40,
        }}
        onDismiss={onClose}
      >
        <BottomSheetView style={{ flex: 1 }}>
          <BlurView
            intensity={Platform.OS === "ios" ? 80 : 0}
            tint="dark"
            style={{
              flex: 1,
              backgroundColor: Platform.OS === "ios" ? undefined : "#0a0a0a",
            }}
          >
            {/* Fixed Header - Always visible at top */}
            <View
              style={{
                paddingHorizontal: 16,
                paddingTop: 8,
                paddingBottom: 12,
                borderBottomWidth: 1,
                borderBottomColor: "rgba(255,255,255,0.1)",
                backgroundColor:
                  Platform.OS === "ios" ? "rgba(10,10,10,0.8)" : "#0a0a0a",
              }}
            >
              {/* Title Row */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 18,
                    fontWeight: "bold",
                  }}
                >
                  Queue ({queue.length})
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <TouchableOpacity
                    onPress={handleShuffle}
                    disabled={isShuffling || queue.length <= 1}
                    style={{
                      padding: 8,
                      marginRight: 4,
                      opacity: queue.length <= 1 ? 0.3 : 1,
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel="Shuffle queue items"
                    accessibilityRole="button"
                  >
                    <Animated.View style={{ transform: [{ rotate }] }}>
                      <Ionicons
                        name="shuffle"
                        size={22}
                        color={isShuffling ? "#60a5fa" : "#fff"}
                      />
                    </Animated.View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleClearQueue}
                    style={{
                      padding: 8,
                      marginRight: 4,
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="trash-outline" size={22} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleToggleAllFavorites}
                    style={{
                      padding: 8,
                      marginRight: 4,
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons
                      name={areAllFavorited ? "heart" : "heart-outline"}
                      size={22}
                      color={areAllFavorited ? "#ef4444" : "#fff"}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      close();
                      // Slight delay to allow smooth transition
                      setTimeout(() => {
                        DeviceEventEmitter.emit("open-favorites-sheet");
                      }, 200);
                    }}
                    style={{
                      padding: 8,
                      marginRight: 4,
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="library-outline" size={22} color="#fff" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={close}
                    style={{
                      padding: 8,
                      marginRight: -8,
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="close" size={24} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Search and Filters */}
              <View style={{ marginTop: 12 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: "rgba(255,255,255,0.08)",
                    borderRadius: 10,
                    paddingHorizontal: 10,
                    height: 36,
                  }}
                >
                  <Ionicons
                    name="search"
                    size={16}
                    color="rgba(255,255,255,0.4)"
                  />
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Filter songs or artists..."
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    style={{
                      flex: 1,
                      marginLeft: 8,
                      color: "#fff",
                      fontSize: 14,
                      height: "100%",
                    }}
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery("")}>
                      <Ionicons
                        name="close-circle"
                        size={16}
                        color="rgba(255,255,255,0.4)"
                      />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Filter Chips */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginTop: 10 }}
                >
                  {artistFilter ? (
                    // Show active filter chip to clear it
                    <TouchableOpacity
                      onPress={() => setArtistFilter(null)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 14,
                        backgroundColor: "#fff",
                        marginRight: 8,
                      }}
                    >
                      <Text
                        style={{
                          color: "#000",
                          fontSize: 13,
                          fontWeight: "600",
                          marginRight: 4,
                        }}
                      >
                        Artist: {artistFilter}
                      </Text>
                      <Ionicons name="close-circle" size={16} color="#000" />
                    </TouchableOpacity>
                  ) : (
                    // Show View Mode chips
                    [
                      { id: "songs", label: "Songs" },
                      { id: "artists", label: "Artists" },
                    ].map((chip) => {
                      const isActive = viewMode === chip.id;
                      return (
                        <TouchableOpacity
                          key={chip.id}
                          onPress={() => setViewMode(chip.id as any)}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: 14,
                            backgroundColor: isActive
                              ? "#fff"
                              : "rgba(255,255,255,0.08)",
                            marginRight: 8,
                          }}
                        >
                          <Text
                            style={{
                              color: isActive
                                ? "#000"
                                : "rgba(255,255,255,0.6)",
                              fontSize: 13,
                              fontWeight: isActive ? "600" : "400",
                            }}
                          >
                            {chip.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>
              </View>

              {/* Status Row */}
              {currentIndex >= 0 &&
                !searchQuery &&
                viewMode === "songs" &&
                !artistFilter && (
                  <Text
                    style={{
                      color: "rgba(255,255,255,0.4)",
                      fontSize: 12,
                      marginTop: 10,
                    }}
                  >
                    Now playing: {currentIndex + 1} of {queue.length}
                  </Text>
                )}
            </View>

            {/* Scrollable Track List */}
            <BottomSheetFlatList
              data={filteredQueue}
              keyExtractor={(item: { id: string | number }, index: number) =>
                `${item.id}-${index}`
              }
              renderItem={renderItem}
              ListEmptyComponent={ListEmptyComponent}
              contentContainerStyle={{
                paddingBottom: insets.bottom + 20,
              }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />

            {/* Confirmation Overlay */}
            {showClearConfirm && (
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: "rgba(0,0,0,0.6)",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 100,
                }}
              >
                <View
                  style={{
                    backgroundColor: "#1c1c1e",
                    padding: 24,
                    borderRadius: 20,
                    width: "80%",
                    maxWidth: 320,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.1)",
                  }}
                >
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: "rgba(239, 68, 68, 0.2)",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 16,
                    }}
                  >
                    <Ionicons name="trash" size={24} color="#ef4444" />
                  </View>

                  <Text
                    style={{
                      fontSize: 20,
                      fontWeight: "bold",
                      color: "#fff",
                      marginBottom: 8,
                    }}
                  >
                    Clear Queue?
                  </Text>
                  <Text
                    style={{
                      color: "rgba(255,255,255,0.6)",
                      textAlign: "center",
                      marginBottom: 24,
                      fontSize: 15,
                      lineHeight: 22,
                    }}
                  >
                    This will remove all {queue.length} tracks. This action
                    cannot be undone.
                  </Text>

                  <View
                    style={{
                      flexDirection: "row",
                      width: "100%",
                      columnGap: 12,
                    }}
                  >
                    <TouchableOpacity
                      onPress={() => setShowClearConfirm(false)}
                      style={{
                        flex: 1,
                        paddingVertical: 14,
                        backgroundColor: "rgba(255,255,255,0.1)",
                        borderRadius: 14,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: "#fff",
                          fontWeight: "600",
                          fontSize: 16,
                        }}
                      >
                        Cancel
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        clearQueue();
                        setShowClearConfirm(false);
                      }}
                      style={{
                        flex: 1,
                        paddingVertical: 14,
                        backgroundColor: "#ef4444",
                        borderRadius: 14,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: "#fff",
                          fontWeight: "600",
                          fontSize: 16,
                        }}
                      >
                        Clear
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          </BlurView>
        </BottomSheetView>
      </BottomSheetModal>
    );
  }
);

QueueSheet.displayName = "QueueSheet";

// Helper to emit open event from anywhere
export const openQueueSheet = () => {
  DeviceEventEmitter.emit(OPEN_QUEUE_SHEET_EVENT);
};
