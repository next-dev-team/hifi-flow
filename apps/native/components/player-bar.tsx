import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  type BottomSheetBackgroundProps,
  BottomSheetModal,
  BottomSheetView,
  useBottomSheetTimingConfigs,
} from "@gorhom/bottom-sheet";
import { Portal } from "@gorhom/portal";
import { BlurView } from "expo-blur";
import { Card, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  ImageBackground,
  PanResponder,
  Platform,
  Pressable,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Circle, Svg } from "react-native-svg";
import { withUniwind } from "uniwind";
import { usePlayer } from "@/contexts/player-context";
import { losslessAPI } from "@/utils/api";

const StyledBottomSheetView = withUniwind(BottomSheetView);

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

const SpectrumBar = ({
  index,
  phase,
  active,
  multiplier = 1,
  barWidth = 4,
  variant = "wave",
  totalBars,
}: {
  index: number;
  phase: SharedValue<number>;
  active: boolean;
  multiplier?: number;
  barWidth?: number;
  variant?:
    | "wave"
    | "symmetric"
    | "pulse"
    | "digital"
    | "natural"
    | "mirror"
    | "fountain";
  totalBars: number;
}) => {
  const animatedStyle = useAnimatedStyle(() => {
    const base = active ? 0.25 : 0.06;
    const amp = active ? 0.75 : 0.12;
    let value = 0;

    switch (variant) {
      case "symmetric": {
        const center = totalBars / 2;
        const dist = Math.abs(index - center);
        value = Math.abs(Math.sin(phase.value - dist * 0.4));
        break;
      }
      case "pulse": {
        const beat = Math.abs(Math.sin(phase.value * 1.5));
        const spatial = Math.abs(Math.sin(index * 0.3 + phase.value * 0.5));
        value = beat * 0.7 + spatial * 0.3;
        break;
      }
      case "digital": {
        const speed = 1 + (index % 7) * 0.2;
        value = Math.abs(Math.sin(phase.value * speed + index));
        break;
      }
      case "natural": {
        // Simulates a frequency spectrum: Bass (low index) -> Treble (high index)
        const normalizedIndex = index / totalBars;
        // Bass moves slower but has more "weight", Treble moves faster
        const speed = 0.8 + normalizedIndex * 3;
        // Combine multiple sines for "noise" look
        const v1 = Math.sin(phase.value * speed + index * 0.5);
        const v2 = Math.sin(phase.value * (speed * 0.5) - index * 0.2);
        // Scale down high frequencies slightly
        value =
          (Math.abs(v1) * 0.7 + Math.abs(v2) * 0.3) *
          (1 - normalizedIndex * 0.4);
        break;
      }
      case "mirror": {
        // Intersecting waves
        const v1 = Math.sin(phase.value + index * 0.3);
        const v2 = Math.sin(phase.value * 1.2 - index * 0.3);
        value = (Math.abs(v1) + Math.abs(v2)) / 2;
        break;
      }
      case "fountain": {
        // High energy in center, shooting out
        const center = totalBars / 2;
        const dist = Math.abs(index - center);
        const normalizedDist = dist / (totalBars / 2);
        // Wave moving outward
        const wave = Math.abs(Math.sin(phase.value * 2 - dist * 0.4));
        // Decay with distance from center
        value = wave * (1 - normalizedDist * 0.7);
        break;
      }
      case "wave":
      default: {
        value = Math.abs(Math.sin(phase.value + index * 0.55));
        break;
      }
    }

    const height = (3 + (base + amp * value) * 14) * multiplier;
    return {
      height,
      opacity: active ? 0.7 : 0.25,
    };
  }, [active, index, phase, multiplier, variant, totalBars]);

  return (
    <Animated.View
      style={[
        {
          width: barWidth,
          borderRadius: 999,
          backgroundColor: "rgba(255,255,255,0.9)",
        },
        animatedStyle,
      ]}
    />
  );
};

const SpectrumVisualizer = ({
  isPlaying,
  barCount,
  multiplier,
  opacity,
  containerStyle,
  barWidth = 4,
  variant = "wave",
}: {
  isPlaying: boolean;
  barCount: number;
  multiplier: number;
  opacity: number;
  containerStyle?: any;
  barWidth?: number;
  variant?:
    | "wave"
    | "symmetric"
    | "pulse"
    | "digital"
    | "natural"
    | "mirror"
    | "fountain";
}) => {
  const bars = useMemo(
    () => Array.from({ length: barCount }, (_, i) => ({ id: i, index: i })),
    [barCount]
  );
  const phase = useSharedValue(0);

  useEffect(() => {
    if (!isPlaying) {
      cancelAnimation(phase);
      phase.value = 0;
      return;
    }
    phase.value = withRepeat(
      withTiming(Math.PI * 2, {
        duration: 2000,
        easing: Easing.linear,
      }),
      -1,
      false
    );
  }, [isPlaying, phase]);

  return (
    <View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          top: 0,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 0,
          opacity,
        },
        containerStyle,
      ]}
    >
      {bars.map((bar) => (
        <SpectrumBar
          key={bar.id}
          index={bar.index}
          phase={phase}
          active={isPlaying}
          multiplier={multiplier}
          barWidth={barWidth}
          variant={variant}
          totalBars={barCount}
        />
      ))}
    </View>
  );
};

const CircularProgress = ({
  size,
  strokeWidth,
  progress,
}: {
  size: number;
  strokeWidth: number;
  progress: number;
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - progress * circumference;

  return (
    <View
      style={{ width: size, height: size, transform: [{ rotate: "-90deg" }] }}
    >
      <Svg width={size} height={size}>
        <Circle
          stroke="rgba(255, 255, 255, 0.14)"
          fill="none"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
        />
        <Circle
          stroke="#60a5fa"
          fill="none"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
        />
      </Svg>
    </View>
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
  const { width: screenWidth } = useWindowDimensions();
  const themeColorBackground = useThemeColor("background");
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
  const [resolvedArtwork, setResolvedArtwork] = useState<string | undefined>(
    undefined
  );
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [scrubMillis, setScrubMillis] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [spectrumVariant, setSpectrumVariant] = useState<
    | "wave"
    | "symmetric"
    | "pulse"
    | "digital"
    | "natural"
    | "mirror"
    | "fountain"
  >("wave");

  const dragX = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const collapseProgress = useSharedValue(0);

  useEffect(() => {
    collapseProgress.value = withSpring(isCollapsed ? 1 : 0, {
      damping: 18,
      stiffness: 110,
      mass: 0.8,
    });
  }, [isCollapsed, collapseProgress]);

  const panResponderMini = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10;
      },
      onPanResponderGrant: () => {
        isDragging.value = true;
      },
      onPanResponderMove: (_, gestureState) => {
        if (!isCollapsed) {
          dragX.value = Math.min(0, gestureState.dx);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        isDragging.value = false;
        if (!isCollapsed && gestureState.dx < -100) {
          setIsCollapsed(true);
          dragX.value = withSpring(0);
        } else {
          dragX.value = withSpring(0);
        }
      },
      onPanResponderTerminate: () => {
        isDragging.value = false;
        dragX.value = withSpring(0);
      },
    });
  }, [isCollapsed, dragX, isDragging]);

  const animatedMiniPlayerStyle = useAnimatedStyle(() => {
    const isWeb = Platform.OS === "web";
    const margin = 16;
    const collapsedWidth = 58;
    const APP_WEB_MAX_WIDTH = 480;

    // Determine if we should use the "floating" style (native mobile OR mobile web H5)
    // On web, we check if screenWidth is small (typical mobile breakpoint)
    const isFloating = !isWeb || screenWidth < APP_WEB_MAX_WIDTH + 40;

    if (!isFloating) {
      // Desktop Web style: Fill the container width
      return {
        width: isCollapsed ? collapsedWidth : "100%",
        left: 0,
        bottom: insets.bottom + 56,
        height: isCollapsed ? 58 : 64,
        transform: [
          { translateX: dragX.value },
          { scale: isDragging.value ? 0.98 : 1 },
        ],
      } as any;
    }

    // Mobile style (Native or H5): Floating with margins
    const expandedWidth = screenWidth - margin * 2;

    const width = interpolate(
      collapseProgress.value,
      [0, 1],
      [expandedWidth, collapsedWidth],
      "clamp"
    );

    const left = interpolate(
      collapseProgress.value,
      [0, 1],
      [margin, margin],
      "clamp"
    );

    return {
      width,
      left,
      height: interpolate(collapseProgress.value, [0, 1], [64, 58], "clamp"),
      bottom: insets.bottom + 56,
      transform: [
        { translateX: dragX.value },
        { scale: isDragging.value ? 0.98 : 1 },
      ],
    } as any;
  });

  const animatedContentStyle = useAnimatedStyle(() => {
    return {
      opacity: 1 - collapseProgress.value,
      transform: [{ scale: 1 - collapseProgress.value * 0.2 }],
    };
  });

  const animatedArtworkContainerStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          scale: interpolate(
            collapseProgress.value,
            [0, 0.5, 1],
            [1, 1.08, 1],
            "clamp"
          ),
        },
      ],
      marginLeft: interpolate(collapseProgress.value, [0, 1], [4, 0]),
      marginRight: interpolate(collapseProgress.value, [0, 1], [12, 0]),
    };
  });

  const animatedCardStyle = useAnimatedStyle(() => {
    return {
      paddingHorizontal: interpolate(collapseProgress.value, [0, 1], [12, 4]),
      paddingVertical: interpolate(collapseProgress.value, [0, 1], [8, 4]),
    };
  });

  const expandedIconStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(collapseProgress.value, [0, 0.3], [1, 0]),
      transform: [
        { scale: interpolate(collapseProgress.value, [0, 0.3], [1, 0]) },
      ],
    };
  });

  const collapsedIconStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(collapseProgress.value, [0.7, 1], [0, 1]),
      transform: [
        { scale: interpolate(collapseProgress.value, [0.7, 1], [0, 1]) },
      ],
    };
  });

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

  const renderBackground = useCallback(
    (props: BottomSheetBackgroundProps) => (
      <View
        style={[
          props.style,
          {
            backgroundColor: themeColorBackground,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            overflow: "hidden",
          },
        ]}
      >
        {resolvedArtwork ? (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "#000",
            }}
          >
            <Image
              source={{ uri: resolvedArtwork }}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                opacity: 0.8,
              }}
              resizeMode="cover"
            />
            <BlurView
              intensity={Platform.OS === "ios" ? 50 : 100}
              tint="dark"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              }}
            />
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0,0,0,0.3)",
              }}
            />
          </View>
        ) : null}
      </View>
    ),
    [resolvedArtwork, themeColorBackground]
  );

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
      <Portal hostName="PlayerBarHost">
        <Animated.View
          className="absolute"
          style={[
            {
              zIndex: 99999,
              elevation: 99999,
            },
            animatedMiniPlayerStyle,
            isSheetOpen ? { opacity: 0, pointerEvents: "none" } : null,
          ]}
          {...panResponderMini.panHandlers}
        >
          <Pressable
            style={{ height: "100%" }}
            onPress={() => {
              if (isCollapsed) {
                setIsCollapsed(false);
              } else {
                handleOpenFullPlayer();
              }
            }}
            onLongPress={() => setIsCollapsed(!isCollapsed)}
            delayLongPress={300}
          >
            <Animated.View
              className="flex-row items-center border border-white/10 relative overflow-hidden rounded-full shadow-2xl justify-center"
              style={[
                animatedCardStyle,
                { height: "100%", backgroundColor: "transparent" },
              ]}
            >
              {resolvedArtwork ? (
                <View
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: "#000",
                  }}
                >
                  <Image
                    source={{ uri: resolvedArtwork }}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      opacity: 0.8,
                    }}
                    resizeMode="cover"
                  />
                  <BlurView
                    intensity={Platform.OS === "ios" ? 50 : 100}
                    tint="dark"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                    }}
                  />
                  <View
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: "rgba(0,0,0,0.3)",
                    }}
                  />
                </View>
              ) : (
                <BlurView
                  intensity={Platform.OS === "ios" ? 40 : 80}
                  tint="default"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: themeColorBackground + "99",
                  }}
                />
              )}
              <SpectrumVisualizer
                isPlaying={isPlaying}
                barCount={120}
                multiplier={3}
                opacity={0.15}
                barWidth={3}
                variant={spectrumVariant}
                containerStyle={{
                  paddingHorizontal: 0,
                }}
              />
              <Animated.View
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  opacity: expandedIconStyle.opacity,
                }}
                pointerEvents="none"
              >
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
              </Animated.View>

              <Animated.View style={animatedArtworkContainerStyle}>
                {resolvedArtwork ? (
                  <View>
                    <SpinningCover
                      uri={resolvedArtwork}
                      size={38}
                      isPlaying={isPlaying}
                    />
                    <Animated.View
                      style={[
                        collapsedIconStyle,
                        {
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          alignItems: "center",
                          justifyContent: "center",
                        },
                      ]}
                    >
                      <CircularProgress
                        size={52}
                        strokeWidth={2}
                        progress={miniProgressRatio}
                      />
                    </Animated.View>
                    <Animated.View
                      style={[
                        expandedIconStyle,
                        {
                          position: "absolute",
                          left: -6,
                          top: "50%",
                          marginTop: -10,
                        },
                      ]}
                    >
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          setIsCollapsed(!isCollapsed);
                        }}
                        className="bg-blue-500 rounded-full w-5 h-5 items-center justify-center border-2 border-black active:scale-90 transition-transform"
                      >
                        {({ pressed }) => (
                          <Animated.View
                            style={{
                              transform: [{ scale: pressed ? 0.85 : 1 }],
                            }}
                          >
                            <Ionicons
                              name="chevron-back"
                              size={12}
                              color="#fff"
                            />
                          </Animated.View>
                        )}
                      </Pressable>
                    </Animated.View>
                    <Animated.View
                      style={[
                        collapsedIconStyle,
                        {
                          position: "absolute",
                          left: -6,
                          top: "50%",
                          marginTop: -10,
                        },
                      ]}
                    >
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          setIsCollapsed(!isCollapsed);
                        }}
                        className="bg-blue-500 rounded-full w-5 h-5 items-center justify-center border-2 border-black active:scale-90 transition-transform"
                      >
                        {({ pressed }) => (
                          <Animated.View
                            style={{
                              transform: [{ scale: pressed ? 0.85 : 1 }],
                            }}
                          >
                            <Ionicons
                              name="chevron-forward"
                              size={12}
                              color="#fff"
                            />
                          </Animated.View>
                        )}
                      </Pressable>
                    </Animated.View>
                  </View>
                ) : (
                  <View
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: 25,
                      backgroundColor: "#525252",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontSize: 16 }}>🎵</Text>
                    <Animated.View
                      style={[
                        collapsedIconStyle,
                        {
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          alignItems: "center",
                          justifyContent: "center",
                        },
                      ]}
                    >
                      <CircularProgress
                        size={52}
                        strokeWidth={2}
                        progress={miniProgressRatio}
                      />
                    </Animated.View>
                    <Animated.View
                      style={[
                        expandedIconStyle,
                        {
                          position: "absolute",
                          left: -6,
                          top: "50%",
                          marginTop: -10,
                        },
                      ]}
                    >
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          setIsCollapsed(!isCollapsed);
                        }}
                        className="bg-blue-500 rounded-full w-5 h-5 items-center justify-center border-2 border-black active:scale-90 transition-transform"
                      >
                        {({ pressed }) => (
                          <Animated.View
                            style={{
                              transform: [{ scale: pressed ? 0.85 : 1 }],
                            }}
                          >
                            <Ionicons
                              name="chevron-back"
                              size={12}
                              color="#fff"
                            />
                          </Animated.View>
                        )}
                      </Pressable>
                    </Animated.View>
                    <Animated.View
                      style={[
                        collapsedIconStyle,
                        {
                          position: "absolute",
                          left: -6,
                          top: "50%",
                          marginTop: -10,
                        },
                      ]}
                    >
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          setIsCollapsed(!isCollapsed);
                        }}
                        className="bg-blue-500 rounded-full w-5 h-5 items-center justify-center border-2 border-black active:scale-90 transition-transform"
                      >
                        {({ pressed }) => (
                          <Animated.View
                            style={{
                              transform: [{ scale: pressed ? 0.85 : 1 }],
                            }}
                          >
                            <Ionicons
                              name="chevron-forward"
                              size={12}
                              color="#fff"
                            />
                          </Animated.View>
                        )}
                      </Pressable>
                    </Animated.View>
                  </View>
                )}
              </Animated.View>

              <Animated.View
                className="flex-1 flex-row items-center"
                style={animatedContentStyle}
                pointerEvents={isCollapsed ? "none" : "auto"}
              >
                <View className="flex-1 mr-2 items-center">
                  <Text
                    className="text-white font-bold text-sm text-center"
                    numberOfLines={1}
                  >
                    {currentTrack.title}
                  </Text>
                  <Text
                    className="text-white/70 text-xs text-center"
                    numberOfLines={1}
                  >
                    {currentTrack.artist}
                  </Text>
                </View>

                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    playPrevious();
                  }}
                  className="p-2"
                >
                  {({ pressed }) => (
                    <Ionicons
                      name="play-skip-back"
                      size={20}
                      color={pressed ? "#ef4444" : "#fff"}
                    />
                  )}
                </Pressable>

                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    (isPlaying ? pauseTrack : resumeTrack)();
                  }}
                  className="p-2"
                  disabled={isLoading}
                >
                  {({ pressed }) =>
                    isLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Ionicons
                        name={isPlaying ? "pause" : "play"}
                        size={24}
                        color={pressed ? "#ef4444" : "#fff"}
                      />
                    )
                  }
                </Pressable>

                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    playNext();
                  }}
                  className="p-2"
                >
                  {({ pressed }) => (
                    <Ionicons
                      name="play-skip-forward"
                      size={20}
                      color={pressed ? "#ef4444" : "#fff"}
                    />
                  )}
                </Pressable>

                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    void toggleCurrentFavorite(resolvedArtwork);
                  }}
                  className="p-2 mr-1"
                >
                  {({ pressed }) => (
                    <Ionicons
                      name={isCurrentFavorited ? "heart" : "heart-outline"}
                      size={20}
                      color={isCurrentFavorited || pressed ? "#ef4444" : "#fff"}
                    />
                  )}
                </Pressable>
              </Animated.View>
            </Animated.View>
          </Pressable>
        </Animated.View>
      </Portal>
      <BottomSheetModal
        ref={bottomSheetRef}
        snapPoints={snapPoints}
        index={0}
        enablePanDownToClose
        enableDismissOnClose
        backdropComponent={renderBackdrop}
        backgroundComponent={renderBackground}
        animationConfigs={animationConfigs}
        onChange={(index) => setIsSheetOpen(index >= 0)}
        onDismiss={() => setIsSheetOpen(false)}
        handleIndicatorStyle={{
          backgroundColor: "rgba(255,255,255,0.3)",
          width: 40,
        }}
      >
        <StyledBottomSheetView className="flex-1 rounded-t-[24px] overflow-hidden">
          <SpectrumVisualizer
            isPlaying={isPlaying}
            barCount={150}
            multiplier={24}
            opacity={0.25}
            barWidth={4}
            variant={spectrumVariant}
          />
          <View className="flex-1 max-w-md w-full mx-auto relative">
            <View
              className="flex-1 items-center justify-between pb-10"
              style={{ paddingTop: insets.top + 12 }}
            >
              <View className="w-full px-5 flex-row items-center justify-between">
                <Pressable onPress={handleCloseFullPlayer}>
                  {({ pressed }) => (
                    <Ionicons
                      name="chevron-down"
                      size={28}
                      color={pressed ? "#ef4444" : "#fff"}
                    />
                  )}
                </Pressable>
                <Pressable
                  className="w-7 items-center justify-center"
                  onPress={() =>
                    setSpectrumVariant((prev) => {
                      if (prev === "wave") return "symmetric";
                      if (prev === "symmetric") return "pulse";
                      if (prev === "pulse") return "digital";
                      if (prev === "digital") return "natural";
                      if (prev === "natural") return "mirror";
                      if (prev === "mirror") return "fountain";
                      return "wave";
                    })
                  }
                >
                  {({ pressed }) => (
                    <Ionicons
                      name={
                        spectrumVariant === "wave"
                          ? "water-outline"
                          : spectrumVariant === "symmetric"
                          ? "code-working-outline"
                          : spectrumVariant === "pulse"
                          ? "pulse-outline"
                          : spectrumVariant === "digital"
                          ? "stats-chart-outline"
                          : spectrumVariant === "natural"
                          ? "musical-notes-outline"
                          : spectrumVariant === "mirror"
                          ? "git-compare-outline"
                          : "flash-outline"
                      }
                      size={22}
                      color={pressed ? "#ef4444" : "#fff"}
                    />
                  )}
                </Pressable>
                <Pressable
                  className="w-7 items-end"
                  onPress={() => void toggleCurrentFavorite(resolvedArtwork)}
                >
                  {({ pressed }) => (
                    <Ionicons
                      name={isCurrentFavorited ? "heart" : "heart-outline"}
                      size={22}
                      color={isCurrentFavorited || pressed ? "#ef4444" : "#fff"}
                    />
                  )}
                </Pressable>
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
                    <Pressable
                      className="w-10 h-10 rounded-full items-center justify-center"
                      onPress={toggleShuffle}
                    >
                      {({ pressed }) => (
                        <Ionicons
                          name="shuffle"
                          size={22}
                          color={
                            pressed
                              ? "#ef4444"
                              : shuffleEnabled
                              ? "#fff"
                              : "rgba(255,255,255,0.45)"
                          }
                        />
                      )}
                    </Pressable>

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

                    <Pressable
                      className="w-10 h-10 rounded-full items-center justify-center"
                      onPress={cycleRepeatMode}
                    >
                      {({ pressed }) => (
                        <>
                          <Ionicons
                            name={
                              repeatMode === "one"
                                ? "repeat"
                                : repeatMode === "all"
                                ? "repeat"
                                : "repeat-outline"
                            }
                            size={22}
                            color={
                              pressed
                                ? "#ef4444"
                                : repeatMode !== "off"
                                ? "#fff"
                                : "rgba(255,255,255,0.45)"
                            }
                          />
                          {repeatMode === "one" && (
                            <View className="absolute bottom-1 right-1 bg-white rounded-full w-3 h-3 items-center justify-center">
                              <Text
                                className="text-black font-bold"
                                style={{ fontSize: 7 }}
                              >
                                1
                              </Text>
                            </View>
                          )}
                        </>
                      )}
                    </Pressable>
                  </View>
                </View>
              </View>

              <View className="w-full flex-row items-center justify-evenly px-6 mt-6">
                <TouchableOpacity onPress={playPrevious} className="p-4">
                  <Ionicons name="play-skip-back" size={38} color="#fff" />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={isPlaying ? pauseTrack : resumeTrack}
                  className="w-20 h-20 rounded-full bg-white items-center justify-center shadow-lg"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator size="large" color="#000" />
                  ) : (
                    <Ionicons
                      name={isPlaying ? "pause" : "play"}
                      size={42}
                      color="#000"
                    />
                  )}
                </TouchableOpacity>

                <TouchableOpacity onPress={playNext} className="p-4">
                  <Ionicons name="play-skip-forward" size={38} color="#fff" />
                </TouchableOpacity>
              </View>

              <View className="h-6" />
            </View>
          </View>
        </StyledBottomSheetView>
      </BottomSheetModal>
    </>
  );
};
