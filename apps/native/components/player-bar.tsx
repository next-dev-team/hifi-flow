import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { Card, Chip, useThemeColor } from "heroui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Image,
  ImageBackground,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import { usePlayer } from "@/contexts/player-context";
import { losslessAPI } from "@/utils/api";

const StyledBottomSheetView = withUniwind(BottomSheetView);

export const PlayerBar = () => {
  const {
    currentTrack,
    isPlaying,
    pauseTrack,
    resumeTrack,
    playNext,
    playPrevious,
    quality,
    setQuality,
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

  const cycleQuality = () => {
    const order: (typeof quality)[] = [
      "LOW",
      "HIGH",
      "LOSSLESS",
      "HIRES_LOSSLESS",
    ];
    const index = order.indexOf(quality);
    const next = order[(index + 1) % order.length];
    setQuality(next);
  };

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
                  cycleQuality();
                }}
                className="mr-1"
              >
                <Chip variant="secondary" size="sm" className="px-2 h-7">
                  <Text className="text-[11px]">{quality}</Text>
                </Chip>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation();
                  (isPlaying ? pauseTrack : resumeTrack)();
                }}
                className="p-2"
              >
                <Ionicons
                  name={isPlaying ? "pause" : "play"}
                  size={24}
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
        onChange={(index) => setIsSheetOpen(index >= 0)}
        onDismiss={() => setIsSheetOpen(false)}
        handleIndicatorStyle={{ backgroundColor: themeColorForeground }}
        backgroundStyle={{ backgroundColor: themeColorBackground }}
      >
        <StyledBottomSheetView className="flex-1">
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
                blurRadius={60}
              />
            ) : null}
            <View
              className="flex-1 items-center justify-between pb-10"
              style={{ paddingTop: insets.top + 12 }}
            >
              <View className="w-full px-5 flex-row items-center justify-between">
                <TouchableOpacity onPress={handleCloseFullPlayer}>
                  <Ionicons
                    name="chevron-down"
                    size={28}
                    color={themeColorForeground}
                  />
                </TouchableOpacity>
                <Chip variant="secondary" size="sm" className="px-2 h-7">
                  <Text className="text-[11px]">{quality}</Text>
                </Chip>
                <View className="w-7" />
              </View>

              <View className="items-center px-8">
                <Text className="text-xs text-default-500 mb-2">
                  Now Playing
                </Text>
                <Text
                  className="text-2xl font-bold text-foreground mb-1"
                  numberOfLines={1}
                >
                  {currentTrack.title}
                </Text>
                <Text className="text-default-500" numberOfLines={1}>
                  {currentTrack.artist}
                </Text>
              </View>

              <View className="items-center">
                <View className="w-56 h-56 rounded-full bg-black/70 items-center justify-center shadow-2xl mb-8">
                  {resolvedArtwork ? (
                    <Image
                      source={{ uri: resolvedArtwork }}
                      className="w-44 h-44 rounded-full"
                      resizeMode="cover"
                    />
                  ) : (
                    <View className="w-32 h-32 rounded-full bg-default-300 items-center justify-center">
                      <Text className="text-4xl">🎵</Text>
                    </View>
                  )}
                </View>

                <View className="w-full px-10 mt-4">
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-[11px] text-default-500">--:--</Text>
                    <Text className="text-[11px] text-default-500">--:--</Text>
                  </View>
                  <View className="h-1.5 rounded-full overflow-hidden bg-content2">
                    <View className="h-full w-1/3 bg-cyan-400" />
                  </View>
                </View>
              </View>

              <View className="w-full flex-row items-center justify-center gap-6 mt-6">
                <TouchableOpacity
                  className="w-12 h-12 rounded-full bg-white/10 items-center justify-center shadow-lg"
                  onPress={playPrevious}
                >
                  <Ionicons
                    name="play-back"
                    size={18}
                    color={themeColorForeground}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  className="w-16 h-16 rounded-full bg-white/10 items-center justify-center shadow-xl"
                  onPress={isPlaying ? pauseTrack : resumeTrack}
                >
                  <Ionicons
                    name={isPlaying ? "pause" : "play"}
                    size={22}
                    color={themeColorForeground}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  className="w-12 h-12 rounded-full bg-white/10 items-center justify-center shadow-lg"
                  onPress={playNext}
                >
                  <Ionicons
                    name="play-forward"
                    size={18}
                    color={themeColorForeground}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </StyledBottomSheetView>
      </BottomSheetModal>
    </>
  );
};
