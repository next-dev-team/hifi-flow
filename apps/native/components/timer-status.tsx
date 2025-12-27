import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import { usePlayer } from "@/contexts/player-context";
import { useAppTheme } from "@/contexts/app-theme-context";

const StyledView = withUniwind(View);
const StyledText = withUniwind(Text);
const StyledTouchableOpacity = withUniwind(TouchableOpacity);
const StyledIonicons = withUniwind(Ionicons);

interface TimerStatusProps {
  absolute?: boolean;
}

export const TimerStatus = ({ absolute = true }: TimerStatusProps) => {
  const { sleepTimerRemainingMs, sleepTimerEndsAt, cancelSleepTimer } =
    usePlayer();
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();

  if (!sleepTimerEndsAt || sleepTimerRemainingMs <= 0) {
    return null;
  }

  const seconds = Math.floor((sleepTimerRemainingMs / 1000) % 60);
  const minutes = Math.floor((sleepTimerRemainingMs / (1000 * 60)) % 60);
  const hours = Math.floor(sleepTimerRemainingMs / (1000 * 60 * 60));

  const formatted =
    hours > 0
      ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
          .toString()
          .padStart(2, "0")}`
      : `${minutes}:${seconds.toString().padStart(2, "0")}`;

  if (!absolute) {
    return (
      <StyledTouchableOpacity
        onPress={cancelSleepTimer}
        className="flex-row items-center bg-foreground/10 px-2 py-0.5 rounded-full mr-2"
      >
        <StyledText className="text-foreground text-[10px] font-bold">
          💤 {formatted}
        </StyledText>
        <StyledIonicons
          name="close-circle"
          size={12}
          color={isDark ? "white" : "black"}
          className="ml-1 opacity-70"
        />
      </StyledTouchableOpacity>
    );
  }

  return (
    <StyledTouchableOpacity
      onPress={cancelSleepTimer}
      className="absolute top-0 right-0 z-50 bg-foreground/10 px-3 py-1 rounded-bl-lg flex-row items-center"
      style={{ top: insets.top }}
    >
      <StyledText className="text-foreground text-xs font-bold">
        💤 {formatted}
      </StyledText>
      <StyledIonicons
        name="close-circle"
        size={14}
        color={isDark ? "white" : "black"}
        className="ml-2 opacity-70"
      />
    </StyledTouchableOpacity>
  );
};
