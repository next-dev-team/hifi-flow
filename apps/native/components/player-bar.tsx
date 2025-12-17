import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
  useBottomSheetTimingConfigs,
} from "@gorhom/bottom-sheet";
import { Card, useThemeColor } from "heroui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  ImageBackground,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Easing } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import { usePlayer } from "@/contexts/player-context";
import { losslessAPI } from "@/utils/api";

const StyledBottomSheetView = withUniwind(BottomSheetView);

export const PlayerBar = () => {
  const {
    currentTrack,
    isPlaying,
    isLoading,
    isCurrentFavorited,
    toggleCurrentFavorite,
    pauseTrack,
    resumeTrack,
    playNext,
    playPrevious,
    positionMillis,
    durationMillis,
    seekToMillis,
    seekByMillis,
  } = usePlayer();
  const insets = useSafeAreaInsets();
  const bottomSheetRef = useRef<BottomSheetModal | null>(null);
  const snapPoints = useMemo(() => ["100%"], []);
  const themeColorBackground = useThemeColor("background");
  const themeColorForeground = useThemeColor("foreground");
  const [resolvedArtwork, setResolvedArtwork] = useState<string | undefined>(
    undefined
  );
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const progressRatio =
    durationMillis > 0
      ? Math.min(1, Math.max(0, positionMillis / durationMillis))
      : 0;
  const [progressBarWidth, setProgressBarWidth] = useState(0);

  const formatMillis = (value: number) => {
    const seconds = Math.max(0, Math.floor(value / 1000));
    return losslessAPI.formatDuration(seconds);
  };

  const handleProgressBarPress = (event: any) => {
    if (durationMillis <= 0 || progressBarWidth <= 0) return;
    const locationX = event?.nativeEvent?.locationX;
    if (typeof locationX !== "number") return;
    const ratio = Math.min(1, Math.max(0, locationX / progressBarWidth));
    seekToMillis(Math.floor(durationMillis * ratio));
  };

  const animationConfigs = useBottomSheetTimingConfigs({
    duration: 320,
    easing: Easing.bezier(0.2, 0.9, 0.2, 1),
  });

  const handleOpenFullPlayer = () => {
    bottomSheetRef.current?.present();
  };

  const handleCloseFullPlayer = () => {
    bottomSheetRef.current?.dismiss();
  };

  const renderBackdrop = useMemo(() => {
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

  useEffect(() => {
    let cancelled = false;
    if (!currentTrack) {
      setResolvedArtwork(undefined);
      return;
    }

    setResolvedArtwork(currentTrack.artwork);

    if (currentTrack.artwork) {
      return () => {
        cancelled = true;
      };
    }

    const trackId = Number(currentTrack.id);
    if (!Number.isFinite(trackId)) {
      return () => {
        cancelled = true;
      };
    }

    losslessAPI
      .getTrack(trackId)
      .then((lookup) => {
        if (cancelled) return;
        const coverId = lookup.track.album?.cover;
        if (!coverId) return;
        setResolvedArtwork(losslessAPI.getCoverUrl(coverId, "1280"));
      })
      .catch(() => {
        if (cancelled) return;
      });

    return () => {
      cancelled = true;
    };
  }, [currentTrack]);

  useEffect(() => {
    if (!isSheetOpen) return;

    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      bottomSheetRef.current?.dismiss();
      return true;
    });

    return () => {
      sub.remove();
    };
  }, [isSheetOpen]);

  if (!currentTrack) return null;

  return (
    <>
      {isSheetOpen ? null : (
        <View
          className="absolute left-0 right-0 px-4 z-50"
          style={{ bottom: insets.bottom + 56 }}
        >
          <Pressable onPress={handleOpenFullPlayer}>
            <Card className="flex-row items-center px-3 py-2 bg-black border border-blue-300 rounded-full shadow-lg">
              {resolvedArtwork ? (
                <Image
                  source={{ uri: resolvedArtwork }}
                  className="w-10 h-10 rounded-full mr-3"
                  resizeMode="cover"
                />
              ) : (
                <View className="w-10 h-10 rounded-full mr-3 bg-default-300 items-center justify-center">
                  <Text>🎵</Text>
                </View>
              )}

              <View className="flex-1 mr-2">
                <Text
                  className="text-white font-bold text-sm"
                  numberOfLines={1}
                >
                  {currentTrack.title}
                </Text>
                <Text className="text-white text-xs" numberOfLines={1}>
                  {currentTrack.artist}
                </Text>
              </View>

              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation();
                  playPrevious();
                }}
                className="p-2"
              >
                <Ionicons name="play-skip-back" size={20} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation();
                  (isPlaying ? pauseTrack : resumeTrack)();
                }}
                className="p-2"
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons
                    name={isPlaying ? "pause" : "play"}
                    size={24}
                    color="#fff"
                  />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation();
                  playNext();
                }}
                className="p-2"
              >
                <Ionicons name="play-skip-forward" size={20} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation();
                  void toggleCurrentFavorite(resolvedArtwork);
                }}
                className="p-2"
              >
                <Ionicons
                  name={isCurrentFavorited ? "heart" : "heart-outline"}
                  size={20}
                  color="#fff"
                />
              </TouchableOpacity>
            </Card>
          </Pressable>
        </View>
      )}
      <BottomSheetModal
        ref={bottomSheetRef}
        snapPoints={snapPoints}
        index={0}
        enablePanDownToClose
        enableDismissOnClose
        backdropComponent={renderBackdrop}
        animationConfigs={animationConfigs}
        onChange={(index) => setIsSheetOpen(index >= 0)}
        onDismiss={() => setIsSheetOpen(false)}
        handleIndicatorStyle={{ backgroundColor: "#ccc" }}
        backgroundStyle={{ backgroundColor: "#18181b" }}
      >
        <StyledBottomSheetView className="flex-1 bg-black">
          <View style={{ flex: 1 }}>
            {resolvedArtwork ? (
              <ImageBackground
                source={{ uri: resolvedArtwork }}
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                }}
                resizeMode="cover"
                blurRadius={50}
              >
                <View className="absolute inset-0 bg-black/50" />
              </ImageBackground>
            ) : null}
            <View
              className="flex-1 items-center justify-between pb-10"
              style={{ paddingTop: insets.top + 12 }}
            >
              <View className="w-full px-5 flex-row items-center justify-between">
                <TouchableOpacity onPress={handleCloseFullPlayer}>
                  <Ionicons name="chevron-down" size={28} color="#fff" />
                </TouchableOpacity>
                <View className="w-7" />
                <TouchableOpacity
                  className="w-7 items-end"
                  onPress={() => void toggleCurrentFavorite(resolvedArtwork)}
                >
                  <Ionicons
                    name={isCurrentFavorited ? "heart" : "heart-outline"}
                    size={22}
                    color="#fff"
                  />
                </TouchableOpacity>
              </View>

              <View className="items-center px-8">
                <Text className="text-xs text-gray-300 mb-2">Now Playing</Text>
                <Text
                  className="text-2xl font-bold text-white mb-1"
                  numberOfLines={1}
                >
                  {currentTrack.title}
                </Text>
                <Text className="text-gray-300" numberOfLines={1}>
                  {currentTrack.artist}
                </Text>
              </View>

              <View className="items-center">
                <View className="w-64 h-64 rounded-full bg-black/20 items-center justify-center mb-10 overflow-hidden">
                  {resolvedArtwork ? (
                    <Image
                      source={{ uri: resolvedArtwork }}
                      className="w-full h-full rounded-full"
                      resizeMode="cover"
                    />
                  ) : (
                    <View className="w-full h-full bg-neutral-800 items-center justify-center">
                      <Text className="text-6xl">🎵</Text>
                    </View>
                  )}
                </View>

                <View className="w-full px-10 mt-4">
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-[11px] text-gray-400">
                      {formatMillis(positionMillis)}
                    </Text>
                    <Text className="text-[11px] text-gray-400">
                      {durationMillis > 0
                        ? formatMillis(durationMillis)
                        : "--:--"}
                    </Text>
                  </View>
                  <View className="h-10 justify-center">
                    <Pressable
                      onPress={handleProgressBarPress}
                      onLayout={(e) =>
                        setProgressBarWidth(e.nativeEvent.layout.width)
                      }
                      hitSlop={{ top: 10, bottom: 10 }}
                      className="h-2 rounded-full overflow-hidden bg-white/20"
                    >
                      <View
                        className="h-full bg-white"
                        style={{ width: `${progressRatio * 100}%` }}
                      />
                    </Pressable>
                  </View>
                  <View className="flex-row items-center justify-between mt-4">
                    <TouchableOpacity
                      className="px-3 py-2 rounded-full bg-white/10"
                      onPress={() => seekByMillis(-10_000)}
                    >
                      <Text className="text-xs text-white">-10s</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="px-3 py-2 rounded-full bg-white/10"
                      onPress={() => seekByMillis(10_000)}
                    >
                      <Text className="text-xs text-white">+10s</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              <View className="w-full flex-row items-center justify-center gap-8 mt-6">
                <TouchableOpacity
                  className="w-14 h-14 rounded-full items-center justify-center"
                  onPress={playPrevious}
                >
                  <Ionicons name="play-skip-back" size={28} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  className="w-20 h-20 rounded-full bg-white items-center justify-center shadow-xl"
                  onPress={isPlaying ? pauseTrack : resumeTrack}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Ionicons
                      name={isPlaying ? "pause" : "play"}
                      size={32}
                      color="#000"
                    />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  className="w-14 h-14 rounded-full items-center justify-center"
                  onPress={playNext}
                >
                  <Ionicons name="play-skip-forward" size={28} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </StyledBottomSheetView>
      </BottomSheetModal>
    </>
  );
};
