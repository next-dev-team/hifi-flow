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
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import {
  DeviceEventEmitter,
  Image,
  Platform,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayer } from "@/contexts/player-context";
import { resolveArtwork } from "@/utils/resolvers";

export interface QueueSheetRef {
  open: () => void;
  close: () => void;
}

interface QueueSheetProps {
  onClose?: () => void;
}

export const OPEN_QUEUE_SHEET_EVENT = "open-queue-sheet";

export const QueueSheet = forwardRef<QueueSheetRef, QueueSheetProps>(
  ({ onClose }, ref) => {
    const bottomSheetRef = useRef<BottomSheetModal>(null);
    const insets = useSafeAreaInsets();
    const {
      queue,
      currentTrack,
      isPlaying,
      pauseTrack,
      resumeTrack,
      playQueue,
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
          void playQueue(queue, index);
        }
      },
      [queue, playQueue]
    );

    const renderItem = useCallback(
      ({ item, index }: { item: any; index: number }) => {
        const isActive = String(item.id) === String(currentTrack?.id);
        const artwork = resolveArtwork(item, "160");

        return (
          <TouchableOpacity
            onPress={() => handleTrackPress(index)}
            className="flex-row items-center py-3 px-4"
            style={{
              backgroundColor: isActive
                ? "rgba(96, 165, 250, 0.15)"
                : "transparent",
            }}
          >
            <View className="relative">
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
            </View>

            <View className="flex-1 ml-3">
              <Text
                className="text-white font-medium text-sm"
                numberOfLines={1}
                style={{ color: isActive ? "#60a5fa" : "#fff" }}
              >
                {item.title}
              </Text>
              <Text className="text-white/60 text-xs mt-0.5" numberOfLines={1}>
                {item.artist}
              </Text>
            </View>

            <View className="items-center justify-center px-2">
              <Text className="text-white/40 text-xs">{index + 1}</Text>
            </View>
          </TouchableOpacity>
        );
      },
      [currentTrack, isPlaying, handleTrackPress]
    );

    const ListEmptyComponent = useCallback(
      () => (
        <View className="flex-1 items-center justify-center py-20">
          <Ionicons name="musical-notes-outline" size={48} color="#666" />
          <Text className="text-white/50 text-base mt-4">Queue is empty</Text>
          <Text className="text-white/30 text-sm mt-1">
            Add some tracks to get started
          </Text>
        </View>
      ),
      []
    );

    const currentIndex = queue.findIndex(
      (t) => String(t.id) === String(currentTrack?.id)
    );

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
          <BottomSheetView className="px-4 pt-2 pb-3 border-b border-white/10">
            <View className="flex-row items-center justify-between">
              <Text className="text-white text-lg font-bold">Queue</Text>
              <View className="flex-row items-center">
                <Text className="text-white/50 text-sm mr-3">
                  {queue.length} tracks
                </Text>
                <TouchableOpacity onPress={close} className="p-2">
                  <Ionicons name="close" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
            {currentIndex >= 0 && (
              <Text className="text-white/40 text-xs mt-1">
                Now playing: {currentIndex + 1} of {queue.length}
              </Text>
            )}
          </BottomSheetView>

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
