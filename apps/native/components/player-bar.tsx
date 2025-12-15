import { Ionicons } from "@expo/vector-icons";
import { Card, Chip } from "heroui-native";
import React from "react";
import { Image, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayer } from "@/contexts/player-context";

export const PlayerBar = () => {
  const {
    currentTrack,
    isPlaying,
    pauseTrack,
    resumeTrack,
    quality,
    setQuality,
  } = usePlayer();
  const insets = useSafeAreaInsets();

  if (!currentTrack) return null;

  console.log("currentTrack", currentTrack);

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

  return (
    <View
      className="absolute left-0 right-0 px-4 z-50"
      style={{ bottom: insets.bottom + 56 }}
    >
      <Card className="flex-row items-center px-3 py-2 bg-black border border-blue-300 rounded-full shadow-lg">
        {currentTrack.artwork ? (
          <Image
            source={{ uri: currentTrack.artwork }}
            className="w-10 h-10 rounded-full mr-3"
            resizeMode="cover"
          />
        ) : (
          <View className="w-10 h-10 rounded-full mr-3 bg-default-300 items-center justify-center">
            <Text>🎵</Text>
          </View>
        )}

        <TouchableOpacity className="flex-1 mr-2" onPress={() => {}}>
          <Text className="text-white font-bold text-sm" numberOfLines={1}>
            {currentTrack.title}
          </Text>
          <Text className="text-white text-xs" numberOfLines={1}>
            {currentTrack.artist}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={cycleQuality} className="mr-1">
          <Chip variant="secondary" size="sm" className="px-2 h-7">
            <Text className="text-[11px]">{quality}</Text>
          </Chip>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={isPlaying ? pauseTrack : resumeTrack}
          className="p-2"
        >
          <Ionicons
            name={isPlaying ? "pause" : "play"}
            size={24}
            color="#fff"
          />
        </TouchableOpacity>
      </Card>
    </View>
  );
};
