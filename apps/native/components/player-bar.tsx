import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
  useBottomSheetTimingConfigs,
} from "@gorhom/bottom-sheet";
import { Card, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  ImageBackground,
  PanResponder,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import { usePlayer } from "@/contexts/player-context";
import { losslessAPI } from "@/utils/api";

const StyledBottomSheetView = withUniwind(BottomSheetView);

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

const SPECTRUM_BARS = Array.from({ length: 22 }, (_, index) => {
  return { id: `spectrum-${index}`, index };
});

const SpectrumBar = ({
  index,
  phase,
  active,
}: {
  index: number;
  phase: SharedValue<number>;
  active: boolean;
}) => {
  const animatedStyle = useAnimatedStyle(() => {
    const base = active ? 0.25 : 0.06;
    const amp = active ? 0.75 : 0.12;
    const value = Math.abs(Math.sin(phase.value + index * 0.55));
    const height = 3 + (base + amp * value) * 14;
    return {
      height,
      opacity: active ? 0.7 : 0.25,
    };
  }, [active, index, phase]);

  return (
    <Animated.View
      style={[
        {
          width: 3,
          borderRadius: 999,
          backgroundColor: "rgba(255,255,255,0.9)",
        },
        animatedStyle,
      ]}
    />
  );
};

const SpinningCover = ({
  uri,
  size,
  isPlaying,
}: {
  uri: string;
  size: number;
  isPlaying: boolean;
}) => {
  const spin = useSharedValue(0);

  useEffect(() => {
    if (!isPlaying) {
      cancelAnimation(spin);
      return;
    }
    spin.value = withRepeat(
      withTiming(spin.value + 1, {
        duration: 8000,
        easing: Easing.linear,
      }),
      -1,
      false
    );
  }, [isPlaying, spin]);

  const animatedStyle = useAnimatedStyle(() => {
    const degrees = (spin.value % 1) * 360;
    return { transform: [{ rotate: `${degrees}deg` }] };
  }, [spin]);

  return (
    <View
      style={{
        width: size + 12,
        height: size + 12,
        borderRadius: (size + 12) / 2,
        padding: 6,
        backgroundColor: isPlaying
          ? "rgba(255,255,255,0.14)"
          : "rgba(255,255,255,0.06)",
      }}
    >
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            overflow: "hidden",
          },
          animatedStyle,
        ]}
      >
        <Image
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          resizeMode="cover"
        />
      </Animated.View>
    </View>
  );
};

const SeekBar = ({
  positionMillis,
  durationMillis,
  isPlaying,
  onSeekToMillis,
  onScrubMillisChange,
  onScrubStateChange,
}: {
  positionMillis: number;
  durationMillis: number;
  isPlaying: boolean;
  onSeekToMillis: (value: number) => void;
  onScrubMillisChange?: (value: number) => void;
  onScrubStateChange?: (value: boolean) => void;
}) => {
  const barRef = useRef<View | null>(null);
  const barXRef = useRef(0);
  const scrubRatioRef = useRef(0);
  const [barWidth, setBarWidth] = useState(0);
  const [scrubRatio, setScrubRatio] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const phase = useSharedValue(0);

  useEffect(() => {
    if (!isPlaying) {
      cancelAnimation(phase);
      phase.value = 0;
      return;
    }
    phase.value = withRepeat(
      withTiming(Math.PI * 2, {
        duration: 1400,
        easing: Easing.linear,
      }),
      -1,
      false
    );
  }, [isPlaying, phase]);

  const progressRatio =
    durationMillis > 0 ? clamp(positionMillis / durationMillis, 0, 1) : 0;
  const visualRatio = isScrubbing ? scrubRatio : progressRatio;

  const setScrub = useCallback(
    (nextRatio: number) => {
      const ratio = clamp(nextRatio, 0, 1);
      scrubRatioRef.current = ratio;
      setScrubRatio(ratio);
      onScrubMillisChange?.(
        durationMillis > 0 ? Math.floor(durationMillis * ratio) : 0
      );
    },
    [durationMillis, onScrubMillisChange]
  );

  const finishScrub = useCallback(() => {
    const ratio = scrubRatioRef.current;
    setIsScrubbing(false);
    onScrubStateChange?.(false);
    if (durationMillis > 0) {
      onSeekToMillis(Math.floor(durationMillis * ratio));
    }
  }, [durationMillis, onScrubStateChange, onSeekToMillis]);

  const panResponder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        barRef.current?.measureInWindow((x) => {
          barXRef.current = x;
          const pageX = evt?.nativeEvent?.pageX;
          if (typeof pageX === "number" && barWidth > 0 && durationMillis > 0) {
            setScrub((pageX - x) / barWidth);
          } else {
            setScrub(progressRatio);
          }
        });
        setIsScrubbing(true);
        onScrubStateChange?.(true);
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (barWidth <= 0 || durationMillis <= 0) return;
        const relativeX = gestureState.moveX - barXRef.current;
        setScrub(relativeX / barWidth);
      },
      onPanResponderRelease: () => {
        finishScrub();
      },
      onPanResponderTerminate: () => {
        finishScrub();
      },
    });
  }, [
    barWidth,
    durationMillis,
    finishScrub,
    onScrubStateChange,
    progressRatio,
    setScrub,
  ]);

  const knobSize = isScrubbing ? 18 : 14;
  const knobX = barWidth * visualRatio;
  const knobLeft = clamp(
    knobX - knobSize / 2,
    -2,
    Math.max(-2, barWidth - knobSize + 2)
  );

  return (
    <View className="h-12 justify-center">
      <View
        ref={(node) => {
          barRef.current = node;
        }}
        onLayout={(e) => {
          setBarWidth(e.nativeEvent.layout.width);
          barRef.current?.measureInWindow((x) => {
            barXRef.current = x;
          });
        }}
        style={{ height: 30, justifyContent: "center" }}
        hitSlop={{ top: 18, bottom: 18, left: 18, right: 18 }}
        {...panResponder.panHandlers}
      >
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            top: 0,
            flexDirection: "row",
            alignItems: "flex-end",
            justifyContent: "space-between",
            paddingHorizontal: 2,
            opacity: 0.5,
          }}
        >
          {SPECTRUM_BARS.map((bar) => (
            <SpectrumBar
              key={bar.id}
              index={bar.index}
              phase={phase}
              active={isPlaying}
            />
          ))}
        </View>

        <View
          style={{
            height: 8,
            borderRadius: 999,
            overflow: "hidden",
            backgroundColor: "rgba(255,255,255,0.18)",
          }}
        >
          <View
            style={{
              height: "100%",
              width: `${visualRatio * 100}%`,
              backgroundColor: "#fff",
            }}
          />
        </View>

        {durationMillis > 0 ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: knobLeft,
              width: knobSize,
              height: knobSize,
              borderRadius: knobSize / 2,
              backgroundColor: "#fff",
              shadowColor: "#000",
              shadowOpacity: 0.35,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              elevation: 10,
            }}
          />
        ) : null}
      </View>
    </View>
  );
};

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
    shuffleEnabled,
    toggleShuffle,
    repeatMode,
    cycleRepeatMode,
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
  const [scrubMillis, setScrubMillis] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const formatMillis = (value: number) => {
    const seconds = Math.max(0, Math.floor(value / 1000));
    return losslessAPI.formatDuration(seconds);
  };

  const miniProgressRatio =
    durationMillis > 0
      ? Math.min(1, Math.max(0, positionMillis / durationMillis))
      : 0;

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
            <Card className="flex-row items-center px-3 py-2 bg-black/95 border border-white/10 relative overflow-hidden rounded-full h-16 shadow-2xl">
              <View
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 2,
                  backgroundColor: "rgba(255,255,255,0.15)",
                }}
              />
              <View
                style={{
                  position: "absolute",
                  left: 0,
                  bottom: 0,
                  height: 2,
                  width: `${miniProgressRatio * 100}%`,
                  backgroundColor: "#60a5fa",
                }}
              />
              {resolvedArtwork ? (
                <View className="ml-1 mr-3">
                  <SpinningCover
                    uri={resolvedArtwork}
                    size={38}
                    isPlaying={isPlaying}
                  />
                </View>
              ) : (
                <View className="w-10 h-10 rounded-full ml-1 mr-3 bg-default-300 items-center justify-center">
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
                <Text className="text-white/70 text-xs" numberOfLines={1}>
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
                className="p-2 mr-1"
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

              <View className="items-center px-8 mb-4">
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
                <View className="items-center justify-center mt-2 mb-8">
                  {resolvedArtwork ? (
                    <SpinningCover
                      uri={resolvedArtwork}
                      size={202}
                      isPlaying={isPlaying}
                    />
                  ) : (
                    <View
                      style={{
                        width: 214,
                        height: 214,
                        borderRadius: 107,
                        backgroundColor: "rgba(0,0,0,0.2)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text className="text-6xl">🎵</Text>
                    </View>
                  )}
                </View>

                <View className="w-full px-10 mt-4">
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-[11px] text-gray-400">
                      {formatMillis(
                        isScrubbing
                          ? scrubMillis ?? positionMillis
                          : positionMillis
                      )}
                    </Text>
                    <Text className="text-[11px] text-gray-400">
                      {durationMillis > 0
                        ? formatMillis(durationMillis)
                        : "--:--"}
                    </Text>
                  </View>
                  <SeekBar
                    positionMillis={positionMillis}
                    durationMillis={durationMillis}
                    isPlaying={isPlaying}
                    onSeekToMillis={(value) => {
                      void seekToMillis(value);
                    }}
                    onScrubMillisChange={(value) => setScrubMillis(value)}
                    onScrubStateChange={(value) => {
                      setIsScrubbing(value);
                      if (!value) {
                        setScrubMillis(null);
                      }
                    }}
                  />

                  <View className="flex-row items-center justify-between mt-2">
                    <TouchableOpacity
                      className="w-10 h-10 rounded-full items-center justify-center"
                      onPress={toggleShuffle}
                    >
                      <Ionicons
                        name="shuffle"
                        size={22}
                        color={
                          shuffleEnabled ? "#fff" : "rgba(255,255,255,0.45)"
                        }
                      />
                    </TouchableOpacity>

                    <View className="flex-row items-center gap-3">
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

                    <TouchableOpacity
                      className="w-10 h-10 rounded-full items-center justify-center"
                      onPress={cycleRepeatMode}
                    >
                      <View style={{ width: 26, height: 26 }}>
                        <Ionicons
                          name="repeat"
                          size={22}
                          color={
                            repeatMode === "off"
                              ? "rgba(255,255,255,0.45)"
                              : "#fff"
                          }
                          style={{ position: "absolute", left: 0, top: 2 }}
                        />
                        {repeatMode === "one" ? (
                          <View
                            style={{
                              position: "absolute",
                              right: 0,
                              top: 0,
                              width: 12,
                              height: 12,
                              borderRadius: 6,
                              backgroundColor: "#fff",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 9,
                                lineHeight: 11,
                                fontWeight: "700",
                                color: "#000",
                              }}
                            >
                              1
                            </Text>
                          </View>
                        ) : null}
                      </View>
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
