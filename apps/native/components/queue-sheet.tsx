import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetFlatList,
  BottomSheetModal,
} from "@gorhom/bottom-sheet";
import { BlurView } from "expo-blur";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import {
  Animated,
  DeviceEventEmitter,
  Image,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayer, type PreBufferStatus } from "@/contexts/player-context";
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
    const {
      queue,
      currentTrack,
      isPlaying,
      playQueue,
      clearQueue,
      nextTrackBufferStatus,
    } = usePlayer();

    const snapPoints = useMemo(() => ["60%", "90%"], []);

    const open = useCallback(() => {
      bottomSheetRef.current?.present();
    }, []);

    const close = useCallback(() => {
      bottomSheetRef.current?.dismiss();
      onClose?.();
    }, [onClose]);

    useImperativeHandle(ref, () => ({ open, close }), [open, close]);

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          opacity={0.5}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          pressBehavior="close"
        />
      ),
      []
    );

    const handleTrackPress = useCallback(
      (index: number) => {
        if (queue[index]) {
          // Play from this position in queue
          void playQueue([queue[index]], 0);
        }
      },
      [queue, playQueue]
    );

    const handleClearQueue = useCallback(() => {
      clearQueue();
      close();
    }, [clearQueue, close]);

    // Determine the next track index
    const currentIndex = queue.findIndex(
      (t) => String(t.id) === String(currentTrack?.id)
    );
    const nextIndex =
      currentIndex >= 0 ? (currentIndex + 1) % queue.length : -1;

    const renderItem = useCallback(
      ({ item, index }: { item: any; index: number }) => {
        const isActive = String(item.id) === String(currentTrack?.id);
        const isNextTrack = index === nextIndex && queue.length > 1;
        const artwork = resolveArtwork(item, "160");

        return (
          <TouchableOpacity
            onPress={() => handleTrackPress(index)}
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

            <View
              style={{
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 8,
              }}
            >
              <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>
                {index + 1}
              </Text>
            </View>
          </TouchableOpacity>
        );
      },
      [
        currentTrack,
        isPlaying,
        handleTrackPress,
        nextIndex,
        nextTrackBufferStatus,
        queue.length,
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

    // Fixed header height for proper spacing
    const HEADER_HEIGHT = 100;

    return (
      <BottomSheetModal
        ref={bottomSheetRef}
        snapPoints={snapPoints}
        index={0}
        enablePanDownToClose
        enableDismissOnClose
        backdropComponent={renderBackdrop}
        backgroundStyle={{
          backgroundColor: Platform.OS === "ios" ? "transparent" : "#0a0a0a",
        }}
        handleIndicatorStyle={{
          backgroundColor: "rgba(255,255,255,0.3)",
          width: 40,
        }}
        onDismiss={onClose}
      >
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
                Queue
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text
                  style={{
                    color: "rgba(255,255,255,0.5)",
                    fontSize: 14,
                    marginRight: 12,
                  }}
                >
                  {queue.length} tracks
                </Text>
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

            {/* Status Row */}
            {currentIndex >= 0 && (
              <Text
                style={{
                  color: "rgba(255,255,255,0.4)",
                  fontSize: 12,
                  marginTop: 4,
                }}
              >
                Now playing: {currentIndex + 1} of {queue.length}
              </Text>
            )}

            {/* Clear All Button */}
            {queue.length > 0 && (
              <TouchableOpacity
                onPress={handleClearQueue}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  backgroundColor: "rgba(255, 59, 48, 0.15)",
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: "rgba(255, 59, 48, 0.3)",
                }}
              >
                <Ionicons
                  name="trash-outline"
                  size={16}
                  color="#ff3b30"
                  style={{ marginRight: 8 }}
                />
                <Text
                  style={{
                    color: "#ff3b30",
                    fontSize: 14,
                    fontWeight: "600",
                  }}
                >
                  Clear Queue
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Scrollable Track List */}
          <BottomSheetFlatList
            data={queue}
            keyExtractor={(item: { id: string | number }, index: number) =>
              `${item.id}-${index}`
            }
            renderItem={renderItem}
            ListEmptyComponent={ListEmptyComponent}
            contentContainerStyle={{
              paddingBottom: insets.bottom + 20,
            }}
            showsVerticalScrollIndicator={false}
          />
        </BlurView>
      </BottomSheetModal>
    );
  }
);

QueueSheet.displayName = "QueueSheet";

// Helper to emit open event from anywhere
export const openQueueSheet = () => {
  DeviceEventEmitter.emit(OPEN_QUEUE_SHEET_EVENT);
};
