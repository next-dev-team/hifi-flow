import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  type BottomSheetBackgroundProps,
  BottomSheetModal,
  BottomSheetView,
  useBottomSheetTimingConfigs,
} from "@gorhom/bottom-sheet";
import type { AudioAnalysis } from "@siteed/expo-audio-studio";
import { BlurView } from "expo-blur";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  BackHandler,
  DeviceEventEmitter,
  Image,
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
import { useThemeColor } from "heroui-native";
import { withUniwind } from "uniwind";
import { useAppTheme } from "@/contexts/app-theme-context";

const StyledView = withUniwind(View);
const StyledText = withUniwind(Text);
const StyledTouchableOpacity = withUniwind(TouchableOpacity);
const StyledPressable = withUniwind(Pressable);
const StyledIonicons = withUniwind(Ionicons);
import { Circle, Svg } from "react-native-svg";
import {
  OPEN_QUEUE_SHEET_EVENT,
  QueueSheet,
  type QueueSheetRef,
} from "@/components/queue-sheet";
import { usePlayer } from "@/contexts/player-context";
import { losslessAPI } from "@/utils/api";
import { getSheetMargin, SHEET_MAX_WIDTH } from "@/utils/layout";
import { resolveArtwork } from "@/utils/resolvers";

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

const Particle = ({
  p,
  phase,
  active,
}: {
  p: {
    x: number;
    y: number;
    size: number;
    speed: number;
    offset: number;
    color: string;
  };
  phase: SharedValue<number>;
  active: boolean;
}) => {
  const animatedStyle = useAnimatedStyle(() => {
    // Simpler, faster calculations
    const bassPulse = Math.max(0, Math.sin(phase.value * 3.2)) ** 3;
    const moveX = p.x + Math.sin(phase.value * p.speed + p.offset) * 25;
    const moveY = p.y + Math.cos(phase.value * p.speed + p.offset) * 25;

    return {
      transform: [
        { translateX: moveX },
        { translateY: moveY },
        { scale: active ? 1 + bassPulse * 0.6 : 1 },
      ],
      opacity: active ? 0.3 + bassPulse * 0.4 : 0.05,
      width: p.size,
      height: p.size,
      borderRadius: p.size / 2,
      backgroundColor: p.color,
      position: "absolute",
    };
  });

  return <Animated.View style={animatedStyle} />;
};

const TrapParticles = ({
  phase,
  active,
  isDark = true,
}: {
  phase: SharedValue<number>;
  active: boolean;
  isDark?: boolean;
}) => {
  const particleCount = 40; // Reduced for performance
  const particles = useMemo(
    () =>
      Array.from({ length: particleCount }, (_, i) => ({
        id: i,
        x: Math.random() * 500 - 250,
        y: Math.random() * 500 - 250,
        size: Math.random() * 2 + 0.5,
        speed: Math.random() * 0.8 + 0.2,
        offset: Math.random() * Math.PI * 2,
        color:
          Math.random() > 0.85
            ? "rgba(147, 197, 253, 0.7)"
            : isDark
            ? "rgba(255, 255, 255, 0.8)"
            : "rgba(0, 0, 0, 0.8)",
      })),
    [isDark]
  );

  return (
    <View className="absolute inset-0 items-center justify-center overflow-hidden">
      {particles.map((p) => (
        <Particle key={p.id} p={p} phase={phase} active={active} />
      ))}
    </View>
  );
};

const SpectrumBar = ({
  index,
  phase,
  active,
  multiplier = 1,
  amplitudeScale,
  useAmplitudeScale = false,
  barWidth = 4,
  variant = "wave",
  totalBars,
  radius,
  isDark = true,
}: {
  index: number;
  phase: SharedValue<number>;
  active: boolean;
  multiplier?: number;
  amplitudeScale?: SharedValue<number>;
  useAmplitudeScale?: boolean;
  barWidth?: number;
  variant?:
    | "wave"
    | "symmetric"
    | "pulse"
    | "digital"
    | "natural"
    | "mirror"
    | "fountain"
    | "trap";
  totalBars: number;
  radius?: number;
  isDark?: boolean;
}) => {
  const barRadius = radius;
  const animatedStyle = useAnimatedStyle(() => {
    const base = active ? 0.25 : 0.06;
    const amp = active ? 0.75 : 0.12;
    let value = 0;

    const effectiveMultiplier =
      multiplier *
      (useAmplitudeScale && amplitudeScale ? amplitudeScale.value : 1);

    switch (variant) {
      case "trap": {
        // High energy, circular reaction
        const normalizedIndex = index / totalBars;
        // Symmetry
        const mirrorIndex =
          normalizedIndex > 0.5 ? 1 - normalizedIndex : normalizedIndex;

        // Bass pulse
        const bassPulse = Math.max(0, Math.sin(phase.value * 3.2)) ** 3;

        // Add a bit of jitter/speed boost during bass peaks to make it "feel" the beat
        const dynamicPhase = phase.value + bassPulse * 0.15;
        const energySpeed = 1 + mirrorIndex * 2.5;
        const localPhase = dynamicPhase * energySpeed;

        const bass = bassPulse * Math.max(0, 1 - mirrorIndex * 3.5);

        // Mids
        const mids =
          Math.sin(localPhase * 1.5 + mirrorIndex * 12) *
          Math.max(0, 1 - Math.abs(mirrorIndex - 0.3) * 3);

        // Treble
        const treble =
          (Math.sin(localPhase * 5 + mirrorIndex * 40) * 0.5 +
            Math.sin(localPhase * 8 - mirrorIndex * 25) * 0.5) *
          Math.max(0, mirrorIndex * 1.5);

        // Trap Nation "Ears" shape logic
        const ear1 = Math.exp(-((normalizedIndex - 0.08) ** 2) / 0.006);
        const ear2 = Math.exp(-((normalizedIndex - 0.92) ** 2) / 0.006);
        const earShape = (ear1 + ear2) * 1.5;

        value =
          Math.abs(bass) * 1.2 + Math.abs(mids) * 0.6 + Math.abs(treble) * 0.4;

        // Apply ear shape boost
        value = value * (1 + earShape);

        // Add a "kick" pulse effect
        const globalKick =
          Math.max(0, Math.sin(phase.value * 3.2 + 0.2)) ** 5 * 0.3;
        value += globalKick;

        // Scale for more subtle visual impact (closer to cover)
        value = value * 0.7;
        break;
      }
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

    if (variant === "trap") {
      const angle = (index / totalBars) * Math.PI * 2;
      const baseRadius = barRadius;
      const height = (2 + (base + amp * value) * 25) * effectiveMultiplier;

      // Rainbow color logic with white mix
      const hue = (index / totalBars) * 360;
      const isGlint = index % 4 === 0;
      const saturation = isGlint ? 0 : 90 - value * 40;
      const lightness = isGlint ? 95 : 65 + value * 25;
      const color = `hsl(${hue}, ${Math.max(0, saturation)}%, ${Math.min(
        100,
        lightness
      )}%)`;

      // If no radius provided, render as a linear bar (for mini player)
      if (!baseRadius || baseRadius <= 0) {
        return {
          height,
          width: barWidth,
          borderRadius: 999,
          backgroundColor: active
            ? color
            : isDark
            ? "rgba(255,255,255,0.4)"
            : "rgba(0,0,0,0.4)",
          opacity: active ? 0.95 : 0.3,
        };
      }

      return {
        height,
        position: "absolute",
        left: "50%",
        top: "50%",
        width: barWidth,
        borderRadius: 999,
        backgroundColor: active
          ? color
          : isDark
          ? "rgba(255,255,255,0.4)"
          : "rgba(0,0,0,0.4)",
        transform: [
          { translateX: -barWidth / 2 },
          { translateY: -height / 2 },
          { rotate: `${angle}rad` },
          { translateY: -baseRadius - height / 2 },
        ],
        opacity: active ? 0.95 : 0.3,
      };
    }

    const height = (3 + (base + amp * value) * 14) * effectiveMultiplier;
    return {
      height,
      width: barWidth,
      borderRadius: 999,
      backgroundColor: isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.9)",
      opacity: active ? 0.7 : 0.25,
    };
  }, [
    active,
    index,
    phase,
    multiplier,
    amplitudeScale,
    useAmplitudeScale,
    variant,
    totalBars,
    barWidth,
    barRadius,
    isDark,
  ]);

  return <Animated.View style={animatedStyle} />;
};

const SpectrumVisualizer = ({
  isPlaying,
  barCount,
  multiplier,
  opacity,
  containerStyle,
  barWidth = 4,
  variant = "wave",
  radius,
  phase: externalPhase,
  audioAnalysis,
  positionMillis,
  isDark = true,
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
    | "fountain"
    | "trap";
  radius?: number;
  phase?: SharedValue<number>;
  audioAnalysis?: AudioAnalysis | null;
  positionMillis?: number;
  isDark?: boolean;
}) => {
  const bars = useMemo(
    () => Array.from({ length: barCount }, (_, i) => ({ id: i, index: i })),
    [barCount]
  );
  const internalPhase = useSharedValue(0);
  const phase = externalPhase || internalPhase;

  // Real-time amplitude scaling based on analysis
  const amplitudeScale = useSharedValue(1);

  useEffect(() => {
    if (audioAnalysis && positionMillis !== undefined) {
      const dp = audioAnalysis.dataPoints.find(
        (p) =>
          positionMillis >= (p.startTime ?? 0) &&
          positionMillis < (p.endTime ?? 0)
      );
      if (dp) {
        // Normalize amplitude/rms to a reasonable scale
        const targetScale = 0.5 + dp.rms * 5;
        amplitudeScale.value = withTiming(targetScale, { duration: 100 });
      }
    } else {
      amplitudeScale.value = 1;
    }
  }, [audioAnalysis, positionMillis, amplitudeScale]);

  // Add more dynamic simulation based on playback state
  const frameId = useRef<number>(0);
  useEffect(() => {
    // Only animate if we're using internal phase
    if (externalPhase) return;

    if (!isPlaying) {
      phase.value = 0;
      return;
    }

    const animate = () => {
      // Slightly vary the phase increment for more organic feel
      const jitter = Math.sin(Date.now() / 1000) * 0.01;
      // If we have real amplitude data, use it to boost the speed
      const speedBoost = audioAnalysis ? amplitudeScale.value * 0.5 : 1;
      phase.value = phase.value + (0.05 + jitter) * speedBoost;
      frameId.current = requestAnimationFrame(animate);
    };

    frameId.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId.current);
  }, [isPlaying, phase, externalPhase, audioAnalysis, amplitudeScale]);

  const isCircular = variant === "trap" && radius !== undefined && radius > 0;

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
          flexDirection: isCircular ? "column" : "row",
          alignItems: "center",
          justifyContent: isCircular ? "center" : "space-between",
          paddingHorizontal: 0,
          opacity,
        },
        containerStyle,
      ]}
    >
      {isCircular && (
        <TrapParticles phase={phase} active={isPlaying} isDark={isDark} />
      )}
      {bars.map((bar) => (
        <SpectrumBar
          key={bar.id}
          index={bar.index}
          phase={phase}
          active={isPlaying}
          multiplier={multiplier}
          amplitudeScale={amplitudeScale}
          useAmplitudeScale={!!audioAnalysis}
          barWidth={barWidth}
          variant={variant}
          totalBars={barCount}
          radius={radius}
          isDark={isDark}
        />
      ))}
    </View>
  );
};

const CircularProgress = ({
  size,
  strokeWidth,
  progress,
  isDark = true,
}: {
  size: number;
  strokeWidth: number;
  progress: number;
  isDark?: boolean;
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
          stroke={isDark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.14)"}
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
  phase,
  isDark = true,
}: {
  uri: string;
  size: number;
  isPlaying: boolean;
  phase?: SharedValue<number>;
  isDark?: boolean;
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
    const baseScale = 1;
    let pulseScale = 0;

    if (phase) {
      // Smoother pulse
      const bassPulse = Math.max(0, Math.sin(phase.value * 3.2)) ** 3;
      pulseScale = bassPulse * 0.08;
    }

    return {
      transform: [
        { rotate: `${degrees}deg` },
        { scale: baseScale + pulseScale },
      ],
    };
  }, [spin, phase]);

  const ringStyle = useAnimatedStyle(() => {
    if (!phase) return { opacity: 0 };
    const bassPulse = Math.max(0, Math.sin(phase.value * 3.2)) ** 3;
    return {
      transform: [{ scale: 1.05 + bassPulse * 0.3 }],
      opacity: bassPulse * 0.4,
      borderColor: isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)",
    };
  });

  return (
    <View className="items-center justify-center">
      {/* Pulsing ring for Trap style */}
      <Animated.View
        style={[
          {
            position: "absolute",
            width: size + 20,
            height: size + 20,
            borderRadius: (size + 20) / 2,
            borderWidth: 2,
          },
          ringStyle,
        ]}
      />
      <View
        style={{
          width: size + 12,
          height: size + 12,
          borderRadius: (size + 12) / 2,
          padding: 6,
          backgroundColor: isPlaying
            ? isDark
              ? "rgba(255,255,255,0.14)"
              : "rgba(0,0,0,0.14)"
            : isDark
            ? "rgba(255,255,255,0.06)"
            : "rgba(0,0,0,0.06)",
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
    </View>
  );
};

const SeekBar = ({
  positionMillis,
  durationMillis,
  onSeekToMillis,
  onScrubMillisChange,
  onScrubStateChange,
  isDark = true,
}: {
  positionMillis: number;
  durationMillis: number;
  onSeekToMillis: (value: number) => void;
  onScrubMillisChange?: (value: number) => void;
  onScrubStateChange?: (value: boolean) => void;
  isDark?: boolean;
}) => {
  const themeColorForeground = useThemeColor("foreground");
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
            backgroundColor: themeColorForeground,
            opacity: 0.18,
          }}
        >
          <View
            style={{
              height: "100%",
              width: `${visualRatio * 100}%`,
              backgroundColor: themeColorForeground,
              opacity: 0.9,
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
              backgroundColor: themeColorForeground,
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

const VolumeSlider = ({
  volume,
  onVolumeChange,
  isDark = true,
}: {
  volume: number;
  onVolumeChange: (value: number) => void;
  isDark?: boolean;
}) => {
  const themeColorForeground = useThemeColor("foreground");
  const barRef = useRef<View | null>(null);
  const barYRef = useRef(0);
  const [barHeight, setBarHeight] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragVolume, setDragVolume] = useState(volume);

  const visualRatio = isDragging ? dragVolume : volume;

  const handleVolumeUpdate = useCallback(
    (pageY: number) => {
      if (barHeight <= 0) return;
      // In vertical slider, top is 1 (ratio), bottom is 0 (ratio)
      // pageY increases downwards, so we invert the ratio
      const ratio = clamp(1 - (pageY - barYRef.current) / barHeight, 0, 1);
      setDragVolume(ratio);
      onVolumeChange(ratio);
    },
    [barHeight, onVolumeChange]
  );

  const panResponder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        setIsDragging(true);
        barRef.current?.measureInWindow((_x, y) => {
          barYRef.current = y;
          handleVolumeUpdate(evt.nativeEvent.pageY);
        });
      },
      onPanResponderMove: (_evt, gestureState) => {
        handleVolumeUpdate(gestureState.moveY);
      },
      onPanResponderRelease: () => {
        setIsDragging(false);
      },
      onPanResponderTerminate: () => {
        setIsDragging(false);
      },
    });
  }, [handleVolumeUpdate]);

  const knobSize = isDragging ? 18 : 14;
  const knobY = barHeight * (1 - visualRatio);
  const knobTop = clamp(
    knobY - knobSize / 2,
    -2,
    Math.max(-2, barHeight - knobSize + 2)
  );

  return (
    <View
      ref={(node) => {
        barRef.current = node;
      }}
      onLayout={(e) => {
        setBarHeight(e.nativeEvent.layout.height);
        barRef.current?.measureInWindow((_x, y) => {
          barYRef.current = y;
        });
      }}
      style={{
        height: 120,
        width: 30,
        alignItems: "center",
        justifyContent: "center",
      }}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      {...panResponder.panHandlers}
    >
      <View
        style={{
          width: 8,
          height: "100%",
          borderRadius: 999,
          overflow: "hidden",
          backgroundColor: themeColorForeground,
          opacity: 0.18,
          justifyContent: "flex-end",
        }}
      >
        <View
          style={{
            width: "100%",
            height: `${visualRatio * 100}%`,
            backgroundColor: themeColorForeground,
            opacity: 0.9,
          }}
        />
      </View>

      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: knobTop,
          width: knobSize,
          height: knobSize,
          borderRadius: knobSize / 2,
          backgroundColor: themeColorForeground,
          shadowColor: "#000",
          shadowOpacity: 0.35,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 10,
        }}
      />
    </View>
  );
};

export const PlayerBar = () => {
  const { width: screenWidth } = useWindowDimensions();
  const { isDark } = useAppTheme();
  const themeColorBackground = useThemeColor("background");
  const themeColorForeground = useThemeColor("foreground");
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
    volume,
    setVolume,
    audioAnalysis,
    loadingTrackId,
    currentStreamUrl,
    nextTrack,
  } = usePlayer();
  const isCached = currentStreamUrl?.startsWith("blob:") || false;

  const insets = useSafeAreaInsets();
  const bottomSheetRef = useRef<BottomSheetModal | null>(null);
  const queueSheetRef = useRef<QueueSheetRef>(null);
  const snapPoints = useMemo(() => ["100%"], []);
  const [resolvedArtwork, setResolvedArtwork] = useState<string | undefined>(
    undefined
  );
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [showSpectrumSelector, setShowSpectrumSelector] = useState(false);

  // Desktop: calculate margin to center the sheet
  const sheetMargin = getSheetMargin(screenWidth);

  // Queue sheet handlers
  const handleOpenQueue = useCallback(() => {
    queueSheetRef.current?.open();
  }, []);

  // Listen for global queue sheet open event
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      OPEN_QUEUE_SHEET_EVENT,
      handleOpenQueue
    );
    return () => subscription.remove();
  }, [handleOpenQueue]);

  // Auto-close volume slider after 3 seconds of inactivity
  // biome-ignore lint/correctness/useExhaustiveDependencies: volume is used to reset the timer
  useEffect(() => {
    if (!showVolume) return;

    const timer = setTimeout(() => {
      setShowVolume(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, [showVolume, volume]);

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
    | "trap"
  >("wave");

  const sharedPhase = useSharedValue(0);

  useEffect(() => {
    if (!isPlaying) {
      cancelAnimation(sharedPhase);
      sharedPhase.value = withTiming(0, { duration: 300 });
      return;
    }

    // Seamless continuous phase increment
    // Using a multiple of 2PI (Math.PI * 20 ≈ 62.83) to ensure seamless loops
    sharedPhase.value = withRepeat(
      withTiming(sharedPhase.value + Math.PI * 20, {
        duration: 20000, // 1 unit per second approx
        easing: Easing.linear,
      }),
      -1,
      false
    );
  }, [isPlaying, sharedPhase]);

  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const miniPlayerOpacity = useSharedValue(1);
  const isDragging = useSharedValue(false);
  const collapseProgress = useSharedValue(0);

  useEffect(() => {
    miniPlayerOpacity.value = withTiming(isSheetOpen ? 0 : 1, {
      duration: 250,
    });
    if (!isSheetOpen) {
      dragX.value = withSpring(0);
      dragY.value = withSpring(0);
    }
  }, [isSheetOpen, miniPlayerOpacity, dragX, dragY]);

  const isTrackLoading = loadingTrackId === String(currentTrack?.id);
  const controlsDisabled = isLoading || isTrackLoading;

  const handleOpenFullPlayer = useCallback(() => {
    setIsSheetOpen(true);
    bottomSheetRef.current?.present();
  }, []);

  const handleCloseFullPlayer = useCallback(() => {
    setIsSheetOpen(false);
    bottomSheetRef.current?.dismiss();
  }, []);

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
        return Math.abs(gestureState.dx) > 10 || Math.abs(gestureState.dy) > 10;
      },
      onPanResponderGrant: () => {
        isDragging.value = true;
      },
      onPanResponderMove: (_, gestureState) => {
        if (Math.abs(gestureState.dx) > Math.abs(gestureState.dy)) {
          // Horizontal dominant - reset Y
          dragY.value = 0;
          if (!isCollapsed) {
            dragX.value = Math.min(0, gestureState.dx);
          }
        } else {
          // Vertical dominant - reset X
          dragX.value = 0;
          // Vertical swipe - allow upward movement for feedback
          dragY.value = Math.min(0, gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        isDragging.value = false;

        // Vertical swipe up to open full player
        if (gestureState.dy < -60) {
          handleOpenFullPlayer();
          // Continue moving up while fading out for a smoother transition
          dragY.value = withTiming(-80, { duration: 250 });
        }
        // Horizontal swipes for mini-player collapse/expand
        else if (!isCollapsed && gestureState.dx < -80) {
          setIsCollapsed(true);
          dragY.value = withSpring(0);
        } else if (isCollapsed && gestureState.dx > 40) {
          setIsCollapsed(false);
          dragY.value = withSpring(0);
        } else {
          dragY.value = withSpring(0, {
            damping: 18,
            stiffness: 110,
            mass: 0.8,
          });
        }

        dragX.value = withSpring(0, {
          damping: 18,
          stiffness: 110,
          mass: 0.8,
        });
      },
      onPanResponderTerminate: () => {
        isDragging.value = false;
        dragX.value = withSpring(0);
        dragY.value = withSpring(0);
      },
    });
  }, [isCollapsed, dragX, dragY, isDragging, handleOpenFullPlayer]);

  const animatedMiniPlayerStyle = useAnimatedStyle(() => {
    const isWeb = Platform.OS === "web";
    const margin = 6;
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
        bottom: 62,
        height: isCollapsed ? 56 : 68,
        zIndex: 50,
        opacity:
          miniPlayerOpacity.value *
          interpolate(dragY.value, [-100, 0], [0.5, 1], "clamp"),
        transform: [
          { translateX: dragX.value },
          { translateY: dragY.value },
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
      height: interpolate(collapseProgress.value, [0, 1], [68, 56], "clamp"),
      bottom: 62 + margin,
      zIndex: 50,
      opacity:
        miniPlayerOpacity.value *
        interpolate(dragY.value, [-100, 0], [0.5, 1], "clamp"),
      transform: [
        { translateX: dragX.value },
        { translateY: dragY.value },
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
      marginLeft: interpolate(collapseProgress.value, [0, 1], [30, 0]),
      marginRight: interpolate(collapseProgress.value, [0, 1], [8, 0]),
    };
  });

  const animatedCardStyle = useAnimatedStyle(() => {
    return {
      paddingHorizontal: interpolate(collapseProgress.value, [0, 1], [12, 10]),
      paddingVertical: interpolate(collapseProgress.value, [0, 1], [8, 6]),
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

  const renderBackdrop = useMemo(
    () =>
      forwardRef<unknown, BottomSheetBackdropProps>((props, _ref) => (
        <BottomSheetBackdrop
          {...props}
          opacity={0.6}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          pressBehavior="close"
        />
      )),
    []
  );

  const renderBackground = useMemo(
    () =>
      forwardRef<View, BottomSheetBackgroundProps>((props, ref) => (
        <Animated.View
          ref={ref as any}
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
                backgroundColor: themeColorBackground,
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
                tint={isDark ? "dark" : "light"}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                }}
              />
              {Platform.OS === "web" && typeof document !== "undefined" ? (
                (require("react-dom") as any).createPortal(
                  <StyledView
                    pointerEvents="none"
                    style={{
                      position: "fixed",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      zIndex: 2147483647,
                      backgroundColor: isDark
                        ? "rgba(0,0,0,0.3)"
                        : "rgba(255,255,255,0.3)",
                    }}
                  />,
                  document.body
                )
              ) : (
                <StyledView
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: isDark
                      ? "rgba(0,0,0,0.3)"
                      : "rgba(255,255,255,0.3)",
                  }}
                />
              )}
            </View>
          ) : null}
        </Animated.View>
      )),
    [resolvedArtwork, isDark, themeColorBackground]
  );

  useEffect(() => {
    let cancelled = false;
    if (!currentTrack) {
      setResolvedArtwork(undefined);
      return;
    }

    // Use the enhanced resolveArtwork which handles direct URLs and Tidal UUIDs
    const artwork = resolveArtwork(currentTrack, "1280");
    setResolvedArtwork(artwork);

    if (artwork) {
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

    // If still no artwork, try to fetch track metadata to get coverId
    losslessAPI
      .getTrack(trackId)
      .then((lookup) => {
        if (cancelled) return;
        const resolved = resolveArtwork(lookup.track, "1280");
        if (resolved) {
          setResolvedArtwork(resolved);
        }
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
      <Animated.View
        className="absolute"
        style={[
          animatedMiniPlayerStyle,
          isSheetOpen ? { pointerEvents: "none" } : null,
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
                  backgroundColor: themeColorBackground,
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
                    opacity: isDark ? 0.8 : 0.4,
                  }}
                  resizeMode="cover"
                />
                <BlurView
                  intensity={Platform.OS === "ios" ? 50 : 100}
                  tint={isDark ? "dark" : "light"}
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
                    backgroundColor: isDark
                      ? "rgba(0,0,0,0.3)"
                      : "rgba(255,255,255,0.3)",
                  }}
                />
              </View>
            ) : (
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: themeColorBackground,
                }}
              />
            )}
            <SpectrumVisualizer
              isPlaying={isPlaying}
              barCount={spectrumVariant === "trap" ? 60 : 120}
              multiplier={spectrumVariant === "trap" ? 1.5 : 3}
              opacity={0.15}
              barWidth={3}
              variant={spectrumVariant}
              phase={sharedPhase}
              audioAnalysis={audioAnalysis}
              positionMillis={positionMillis}
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
                  backgroundColor: isDark
                    ? "rgba(255,255,255,0.1)"
                    : "rgba(0,0,0,0.05)",
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
                    size={40}
                    isPlaying={isPlaying}
                    isDark={isDark}
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
                      size={44}
                      strokeWidth={2}
                      progress={miniProgressRatio}
                      isDark={isDark}
                    />
                  </Animated.View>
                  <Animated.View
                    style={[
                      expandedIconStyle,
                      {
                        position: "absolute",
                        left: -26,
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
                      className="bg-blue-500 rounded-full w-5 h-5 items-center justify-center border-2 active:scale-90 transition-transform"
                      style={{ borderColor: isDark ? "#000" : "#fff" }}
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
                            color={themeColorForeground}
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
                      className="bg-blue-500 rounded-full w-5 h-5 items-center justify-center border-2 active:scale-90 transition-transform"
                      style={{ borderColor: isDark ? "#000" : "#fff" }}
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
                            color={themeColorForeground}
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
                    backgroundColor: isDark ? "#262626" : "#e5e5e5",
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
                      isDark={isDark}
                    />
                  </Animated.View>
                  <Animated.View
                    style={[
                      expandedIconStyle,
                      {
                        position: "absolute",
                        left: -26,
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
                            color={themeColorForeground}
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
                            color={themeColorForeground}
                          />
                        </Animated.View>
                      )}
                    </Pressable>
                  </Animated.View>
                </View>
              )}
            </Animated.View>

            <Animated.View
              className="flex-1"
              style={animatedContentStyle}
              pointerEvents={isCollapsed ? "none" : "auto"}
            >
              <StyledView className="flex-1 flex-row items-center pr-1.5 gap-1">
                {/* Left side: Track Info (closer to cover) */}
                <StyledView className="justify-between max-w-[50%] py-1">
                  <StyledText
                    className="font-bold text-[13px] text-left select-none"
                    style={{ color: themeColorForeground }}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    selectable={false}
                  >
                    {currentTrack.title}
                  </StyledText>
                  <StyledView className="flex-row items-center gap-1">
                    {isCached && (
                      <StyledIonicons name="flash" size={10} color="#4ade80" />
                    )}
                    <StyledText
                      className="opacity-70 text-[11px] text-left select-none shrink"
                      style={{ color: themeColorForeground }}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      selectable={false}
                    >
                      {currentTrack.artist}
                    </StyledText>
                  </StyledView>
                </StyledView>

                {/* Right side: Controls and Up Next */}
                <StyledView className="justify-between items-start py-0.5">
                  <StyledView className="flex-row items-center justify-start">
                    <StyledPressable
                      onPress={(e) => {
                        e.stopPropagation();
                        playPrevious();
                      }}
                      style={{ paddingHorizontal: 2 }}
                      disabled={controlsDisabled}
                    >
                      {({ pressed }) => (
                        <StyledIonicons
                          name="play-skip-back"
                          size={20}
                          color={pressed ? "#ef4444" : themeColorForeground}
                          style={{ opacity: controlsDisabled ? 0.35 : 1 }}
                        />
                      )}
                    </StyledPressable>

                    <StyledPressable
                      onPress={(e) => {
                        e.stopPropagation();
                        (isPlaying ? pauseTrack : resumeTrack)();
                      }}
                      style={{ paddingHorizontal: 2 }}
                      disabled={isLoading || isTrackLoading}
                    >
                      {({ pressed }) =>
                        isLoading || isTrackLoading ? (
                          <ActivityIndicator
                            size="small"
                            color={themeColorForeground}
                            style={{ width: 28, height: 28 }}
                          />
                        ) : (
                          <StyledIonicons
                            name={isPlaying ? "pause" : "play"}
                            size={28}
                            color={pressed ? "#ef4444" : themeColorForeground}
                            style={{ marginLeft: isPlaying ? 0 : 2 }}
                          />
                        )
                      }
                    </StyledPressable>

                    <StyledPressable
                      onPress={(e) => {
                        e.stopPropagation();
                        playNext();
                      }}
                      style={{ paddingHorizontal: 2 }}
                      disabled={controlsDisabled}
                    >
                      {({ pressed }) => (
                        <StyledIonicons
                          name="play-skip-forward"
                          size={20}
                          color={pressed ? "#ef4444" : themeColorForeground}
                          style={{ opacity: controlsDisabled ? 0.35 : 1 }}
                        />
                      )}
                    </StyledPressable>

                    <StyledPressable
                      onPress={(e) => {
                        e.stopPropagation();
                        void toggleCurrentFavorite(resolvedArtwork);
                      }}
                      style={{ paddingHorizontal: 2 }}
                    >
                      {({ pressed }) => (
                        <StyledIonicons
                          name={isCurrentFavorited ? "heart" : "heart-outline"}
                          size={20}
                          color={
                            isCurrentFavorited || pressed
                              ? "#ef4444"
                              : themeColorForeground
                          }
                        />
                      )}
                    </StyledPressable>

                    <StyledPressable
                      onPress={(e) => {
                        e.stopPropagation();
                        handleOpenQueue();
                      }}
                      style={{ paddingHorizontal: 2 }}
                    >
                      {({ pressed }) => (
                        <StyledIonicons
                          name="list"
                          size={20}
                          color={pressed ? "#60a5fa" : themeColorForeground}
                        />
                      )}
                    </StyledPressable>
                  </StyledView>

                  {nextTrack && (
                    <StyledView className="flex-row items-center justify-start gap-1">
                      <StyledText
                        className="text-[11px] opacity-60 font-bold select-none"
                        style={{ color: themeColorForeground }}
                      >
                        Up Next:
                      </StyledText>
                      <StyledText
                        className="text-[11px] opacity-40 select-none max-w-[120px]"
                        style={{ color: themeColorForeground }}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {nextTrack.title}
                      </StyledText>
                    </StyledView>
                  )}
                </StyledView>
              </StyledView>
            </Animated.View>
          </Animated.View>
        </Pressable>
      </Animated.View>
      <BottomSheetModal
        ref={bottomSheetRef}
        snapPoints={snapPoints}
        index={0}
        enablePanDownToClose
        enableDismissOnClose
        backdropComponent={renderBackdrop}
        backgroundComponent={renderBackground}
        animationConfigs={animationConfigs}
        style={{
          marginHorizontal: sheetMargin,
        }}
        onChange={(index) => setIsSheetOpen(index >= 0)}
        onDismiss={() => setIsSheetOpen(false)}
        handleIndicatorStyle={{
          backgroundColor: themeColorForeground,
          opacity: 0.3,
          width: 40,
        }}
      >
        <BottomSheetView style={{ flex: 1 }}>
          <View className="flex-1 rounded-t-3xl overflow-hidden">
            {spectrumVariant !== "trap" && (
              <SpectrumVisualizer
                isPlaying={isPlaying}
                barCount={150}
                multiplier={24}
                opacity={0.25}
                barWidth={4}
                variant={spectrumVariant}
                phase={sharedPhase}
                audioAnalysis={audioAnalysis}
                positionMillis={positionMillis}
                isDark={isDark}
              />
            )}
            <View className="flex-1 max-w-md w-full mx-auto relative">
              <View
                className="flex-1 items-center justify-between pb-5"
                style={{ paddingTop: insets.top + 12 }}
              >
                <View className="w-full px-5 flex-row items-center justify-between">
                  <StyledPressable onPress={handleCloseFullPlayer}>
                    {({ pressed }) => (
                      <StyledIonicons
                        name="chevron-down"
                        size={28}
                        color={pressed ? "#ef4444" : themeColorForeground}
                      />
                    )}
                  </StyledPressable>
                  <StyledPressable
                    className="w-7 items-center justify-center"
                    onPress={() =>
                      setShowSpectrumSelector(!showSpectrumSelector)
                    }
                  >
                    {({ pressed }) => (
                      <StyledIonicons
                        name={
                          spectrumVariant === "wave"
                            ? "water-outline"
                            : spectrumVariant === "symmetric"
                            ? "git-compare-outline"
                            : spectrumVariant === "pulse"
                            ? "heart-outline"
                            : spectrumVariant === "digital"
                            ? "stats-chart-outline"
                            : spectrumVariant === "natural"
                            ? "leaf-outline"
                            : spectrumVariant === "mirror"
                            ? "repeat-outline"
                            : spectrumVariant === "fountain"
                            ? "sunny-outline"
                            : "disc-outline"
                        }
                        size={20}
                        color={
                          showSpectrumSelector || pressed
                            ? "#60a5fa"
                            : themeColorForeground
                        }
                      />
                    )}
                  </StyledPressable>
                  <StyledPressable
                    className="w-7 items-end"
                    onPress={() => void toggleCurrentFavorite(resolvedArtwork)}
                  >
                    {({ pressed }) => (
                      <StyledIonicons
                        name={isCurrentFavorited ? "heart" : "heart-outline"}
                        size={22}
                        color={
                          isCurrentFavorited || pressed
                            ? "#ef4444"
                            : themeColorForeground
                        }
                      />
                    )}
                  </StyledPressable>
                  <StyledPressable
                    className="w-7 items-end ml-4"
                    onPress={handleOpenQueue}
                  >
                    {({ pressed }) => (
                      <StyledIonicons
                        name="list"
                        size={22}
                        color={pressed ? "#60a5fa" : themeColorForeground}
                      />
                    )}
                  </StyledPressable>
                </View>

                {showSpectrumSelector && (
                  <StyledView className="absolute top-16 left-0 right-0 z-50 items-center">
                    <BlurView
                      intensity={80}
                      tint={isDark ? "dark" : "light"}
                      className="flex-row items-center px-4 py-3 rounded-2xl border border-foreground/10"
                    >
                      {[
                        { id: "wave", icon: "water-outline", label: "Wave" },
                        {
                          id: "symmetric",
                          icon: "git-compare-outline",
                          label: "Symmetric",
                        },
                        { id: "pulse", icon: "heart-outline", label: "Pulse" },
                        {
                          id: "digital",
                          icon: "stats-chart-outline",
                          label: "Digital",
                        },
                        {
                          id: "natural",
                          icon: "leaf-outline",
                          label: "Natural",
                        },
                        {
                          id: "mirror",
                          icon: "repeat-outline",
                          label: "Mirror",
                        },
                        {
                          id: "fountain",
                          icon: "sunny-outline",
                          label: "Fountain",
                        },
                        { id: "trap", icon: "disc-outline", label: "Trap" },
                      ].map((v) => (
                        <StyledTouchableOpacity
                          key={v.id}
                          onPress={() => {
                            setSpectrumVariant(v.id as any);
                            setShowSpectrumSelector(false);
                          }}
                          className={`mx-2 items-center justify-center w-10 h-10 rounded-full ${
                            spectrumVariant === v.id
                              ? "bg-primary"
                              : "bg-foreground/10"
                          }`}
                        >
                          <StyledIonicons
                            name={v.icon as any}
                            size={18}
                            color={
                              spectrumVariant === v.id
                                ? "#fff"
                                : themeColorForeground
                            }
                            style={{
                              opacity: spectrumVariant === v.id ? 1 : 0.7,
                            }}
                          />
                        </StyledTouchableOpacity>
                      ))}
                    </BlurView>
                  </StyledView>
                )}

                <StyledView className="items-center px-8 mb-4">
                  <StyledText
                    className="text-xs opacity-70 mb-2 select-none"
                    style={{ color: themeColorForeground }}
                    selectable={false}
                  >
                    Now Playing
                  </StyledText>
                  <StyledText
                    className="text-2xl font-bold mb-1 select-none"
                    style={{ color: themeColorForeground }}
                    numberOfLines={1}
                    selectable={false}
                  >
                    {currentTrack.title}
                  </StyledText>
                  <StyledView className="flex-row items-center justify-center gap-2 max-w-full">
                    {isCached && (
                      <StyledView className="bg-green-500/20 px-2 py-0.5 rounded-full border border-green-500/50 flex-row items-center gap-1 shrink-0">
                        <StyledIonicons
                          name="flash"
                          size={10}
                          color="#4ade80"
                        />
                        <StyledText className="text-[9px] text-green-400 font-bold uppercase">
                          Fast
                        </StyledText>
                      </StyledView>
                    )}
                    <StyledText
                      className="opacity-70 select-none shrink"
                      style={{ color: themeColorForeground }}
                      numberOfLines={1}
                      selectable={false}
                    >
                      {currentTrack.artist}
                    </StyledText>
                  </StyledView>

                  {nextTrack && (
                    <StyledView className="items-center mt-2 px-10">
                      <StyledText
                        className="text-[11px] opacity-50 uppercase tracking-[2px] font-bold mb-0.5"
                        style={{ color: themeColorForeground }}
                      >
                        Up Next Track
                      </StyledText>
                      <StyledText
                        className="text-sm font-semibold opacity-70"
                        style={{ color: themeColorForeground }}
                        numberOfLines={1}
                      >
                        {nextTrack.title}
                      </StyledText>
                    </StyledView>
                  )}
                </StyledView>

                <View className="items-center">
                  <Pressable
                    onPress={() => {
                      if (isLoading) return;
                      if (isPlaying) {
                        void pauseTrack().catch((e) => {
                          console.warn("[PlayerBar] pauseTrack failed", e);
                        });
                      } else {
                        void resumeTrack().catch((e) => {
                          console.warn("[PlayerBar] resumeTrack failed", e);
                        });
                      }
                    }}
                    className="items-center justify-center mt-2 mb-8 relative"
                  >
                    {spectrumVariant === "trap" && (
                      <SpectrumVisualizer
                        isPlaying={isPlaying}
                        barCount={80}
                        multiplier={1.2}
                        opacity={1}
                        barWidth={3}
                        variant="trap"
                        radius={104}
                        phase={sharedPhase}
                        audioAnalysis={audioAnalysis}
                        positionMillis={positionMillis}
                        isDark={isDark}
                      />
                    )}
                    {resolvedArtwork ? (
                      <SpinningCover
                        uri={resolvedArtwork}
                        size={202}
                        isPlaying={isPlaying}
                        phase={sharedPhase}
                        isDark={isDark}
                      />
                    ) : (
                      <StyledView
                        style={{
                          width: 214,
                          height: 214,
                          borderRadius: 107,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        className="bg-foreground/10"
                      >
                        <StyledText
                          className="text-6xl"
                          style={{ color: themeColorForeground }}
                        >
                          🎵
                        </StyledText>
                      </StyledView>
                    )}
                  </Pressable>

                  <StyledView className="w-full px-10 mt-4">
                    <StyledView className="flex-row justify-between mb-1">
                      <StyledText
                        className="text-[11px] opacity-60 select-none"
                        style={{ color: themeColorForeground }}
                        selectable={false}
                      >
                        {formatMillis(
                          isScrubbing
                            ? scrubMillis ?? positionMillis
                            : positionMillis
                        )}
                      </StyledText>
                      <StyledText
                        className="text-[11px] opacity-60 select-none"
                        style={{ color: themeColorForeground }}
                        selectable={false}
                      >
                        {durationMillis > 0
                          ? formatMillis(durationMillis)
                          : "--:--"}
                      </StyledText>
                    </StyledView>
                    <SeekBar
                      positionMillis={positionMillis}
                      durationMillis={durationMillis}
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
                      isDark={isDark}
                    />

                    <StyledView className="flex-row items-center justify-between mt-2 px-2">
                      <StyledPressable
                        className="w-10 h-10 rounded-full items-center justify-center"
                        onPress={toggleShuffle}
                      >
                        {({ pressed }) => (
                          <StyledIonicons
                            name="shuffle"
                            size={22}
                            color={
                              pressed
                                ? "#ef4444"
                                : shuffleEnabled
                                ? themeColorForeground
                                : themeColorForeground
                            }
                            style={{
                              opacity: shuffleEnabled ? 1 : 0.45,
                            }}
                          />
                        )}
                      </StyledPressable>

                      <StyledView className="flex-row items-center gap-3">
                        <StyledTouchableOpacity
                          className="px-3 py-2 rounded-full bg-foreground/10"
                          onPress={() => seekByMillis(-10_000)}
                        >
                          <StyledText
                            className="text-xs"
                            style={{ color: themeColorForeground }}
                          >
                            -10s
                          </StyledText>
                        </StyledTouchableOpacity>
                        <StyledTouchableOpacity
                          className="px-3 py-2 rounded-full bg-foreground/10"
                          onPress={() => seekByMillis(10_000)}
                        >
                          <StyledText
                            className="text-xs"
                            style={{ color: themeColorForeground }}
                          >
                            +10s
                          </StyledText>
                        </StyledTouchableOpacity>
                      </StyledView>

                      <StyledPressable
                        className="w-10 h-10 rounded-full items-center justify-center"
                        onPress={cycleRepeatMode}
                      >
                        {({ pressed }) => (
                          <>
                            <StyledIonicons
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
                                  ? themeColorForeground
                                  : themeColorForeground
                              }
                              style={{
                                opacity: repeatMode !== "off" ? 1 : 0.45,
                              }}
                            />
                            {repeatMode === "one" && (
                              <StyledView className="absolute bottom-1 right-1 bg-foreground rounded-full w-3 h-3 items-center justify-center">
                                <StyledText
                                  className="text-background font-bold"
                                  style={{ fontSize: 7 }}
                                >
                                  1
                                </StyledText>
                              </StyledView>
                            )}
                          </>
                        )}
                      </StyledPressable>

                      <StyledView className="relative">
                        {showVolume && (
                          <StyledView
                            style={{
                              position: "absolute",
                              bottom: 50,
                              right: 0,
                              borderRadius: 20,
                              paddingVertical: 12,
                              paddingHorizontal: 4,
                              shadowColor: "#000",
                              shadowOpacity: 0.3,
                              shadowRadius: 10,
                              elevation: 5,
                              zIndex: 100,
                              backgroundColor: themeColorBackground,
                            }}
                          >
                            <VolumeSlider
                              volume={volume}
                              onVolumeChange={setVolume}
                              isDark={isDark}
                            />
                          </StyledView>
                        )}
                        <StyledTouchableOpacity
                          onPress={() => setShowVolume(!showVolume)}
                          className="w-10 h-10 rounded-full items-center justify-center"
                        >
                          <StyledIonicons
                            name={
                              volume === 0
                                ? "volume-mute"
                                : volume < 0.5
                                ? "volume-low"
                                : "volume-high"
                            }
                            size={22}
                            color={themeColorForeground}
                            style={{
                              opacity: showVolume ? 1 : 0.45,
                            }}
                          />
                        </StyledTouchableOpacity>
                      </StyledView>
                    </StyledView>
                  </StyledView>
                </View>

                <StyledView className="w-full px-6 mt-6">
                  <StyledView className="flex-row items-center justify-center">
                    <StyledTouchableOpacity
                      onPress={playPrevious}
                      className="p-4"
                      disabled={controlsDisabled}
                      style={{ opacity: controlsDisabled ? 0.35 : 1 }}
                    >
                      <StyledIonicons
                        name="play-skip-back"
                        size={38}
                        color={themeColorForeground}
                      />
                    </StyledTouchableOpacity>

                    <StyledTouchableOpacity
                      onPress={isPlaying ? pauseTrack : resumeTrack}
                      className="w-20 h-20 rounded-full items-center justify-center shadow-lg mx-4"
                      style={{ backgroundColor: themeColorForeground }}
                      disabled={isLoading || isTrackLoading}
                    >
                      {isLoading || isTrackLoading ? (
                        <ActivityIndicator
                          size="large"
                          color={themeColorBackground}
                        />
                      ) : (
                        <StyledIonicons
                          name={isPlaying ? "pause" : "play"}
                          size={42}
                          style={{
                            marginLeft: isPlaying ? 0 : 4,
                            color: themeColorBackground,
                          }}
                        />
                      )}
                    </StyledTouchableOpacity>

                    <StyledTouchableOpacity
                      onPress={playNext}
                      className="p-4"
                      disabled={controlsDisabled}
                      style={{ opacity: controlsDisabled ? 0.35 : 1 }}
                    >
                      <StyledIonicons
                        name="play-skip-forward"
                        size={38}
                        color={themeColorForeground}
                      />
                    </StyledTouchableOpacity>
                  </StyledView>

                  {nextTrack && (
                    <StyledView className="items-center mt-8">
                      <StyledText
                        className="text-[10px] opacity-40 uppercase font-bold tracking-[2px] mb-1.5"
                        style={{ color: themeColorForeground }}
                      >
                        Up Next
                      </StyledText>
                      <StyledText
                        className="text-sm font-semibold opacity-60 px-10"
                        style={{ color: themeColorForeground }}
                        numberOfLines={1}
                      >
                        {nextTrack.title}
                      </StyledText>
                    </StyledView>
                  )}
                </StyledView>

                <View className="h-6" />
              </View>
            </View>
          </View>
        </BottomSheetView>
      </BottomSheetModal>
      <QueueSheet ref={queueSheetRef} />
    </>
  );
};
