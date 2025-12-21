import React from "react";
import { View, Text } from "react-native";
import { usePlayer } from "@/contexts/player-context";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

const StyledView = withUniwind(View);
const StyledText = withUniwind(Text);

export const TimerStatus = () => {
  const { sleepTimerRemainingMs, sleepTimerEndsAt } = usePlayer();
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

  return (
    <StyledView
      className="absolute top-0 right-0 z-50 bg-black/80 px-3 py-1 rounded-bl-lg"
      style={{ top: insets.top }}
    >
      <StyledText className="text-white text-xs font-bold">
        💤 {formatted}
      </StyledText>
    </StyledView>
  );
};
