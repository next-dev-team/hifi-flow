import React, { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { withUniwind } from "uniwind";

const StyledView = withUniwind(View);

interface ThinkingDotsProps {
  color?: string;
  size?: number;
  className?: string;
}

export const ThinkingDots = ({
  color = "#007AFF",
  size = 18,
  className = "",
}: ThinkingDotsProps) => {
  const dot1 = useSharedValue(0.3);
  const dot2 = useSharedValue(0.3);
  const dot3 = useSharedValue(0.3);

  useEffect(() => {
    dot1.value = withRepeat(
      withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    dot2.value = withDelay(
      200,
      withRepeat(
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      )
    );
    dot3.value = withDelay(
      400,
      withRepeat(
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      )
    );
  }, [dot1, dot2, dot3]);

  const dotStyle1 = useAnimatedStyle(() => ({ opacity: dot1.value }));
  const dotStyle2 = useAnimatedStyle(() => ({ opacity: dot2.value }));
  const dotStyle3 = useAnimatedStyle(() => ({ opacity: dot3.value }));

  return (
    <StyledView className={`flex-row items-center ml-1 ${className}`}>
      <Animated.Text
        style={[{ color, fontSize: size, fontWeight: "bold" }, dotStyle1]}
      >
        .
      </Animated.Text>
      <Animated.Text
        style={[{ color, fontSize: size, fontWeight: "bold" }, dotStyle2]}
      >
        .
      </Animated.Text>
      <Animated.Text
        style={[{ color, fontSize: size, fontWeight: "bold" }, dotStyle3]}
      >
        .
      </Animated.Text>
    </StyledView>
  );
};
