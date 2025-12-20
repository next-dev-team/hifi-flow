import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Card } from "heroui-native";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import { usePlayer } from "@/contexts/player-context";
import { losslessAPI } from "@/utils/api";
import { resolveArtwork, resolveName } from "@/utils/resolvers";

const StyledSafeAreaView = withUniwind(SafeAreaView);
const StyledView = withUniwind(View);
const StyledText = withUniwind(Text);

export default function SongPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { playTrack, isPlaying, pauseTrack, resumeTrack, currentTrack } =
    usePlayer();

  const { data: trackDetails, isLoading } = useQuery({
    queryKey: ["track", id],
    queryFn: async () => {
      if (!id) return null;
      const trackId = parseInt(id);
      if (isNaN(trackId)) return null;
      return await losslessAPI.getTrack(trackId);
    },
    enabled: !!id && !isNaN(parseInt(id)),
  });

  if (isLoading) {
    return (
      <StyledView className="flex-1 justify-center items-center bg-background">
        <ActivityIndicator size="large" color="#ef4444" />
      </StyledView>
    );
  }

  if (!trackDetails && !id.startsWith("saved:")) {
    return (
      <StyledView className="flex-1 justify-center items-center bg-background px-4">
        <StyledText className="text-default-500 text-center">
          Unable to load track details.
        </StyledText>
      </StyledView>
    );
  }

  const track = trackDetails?.track || currentTrack;
  const streamUrl = trackDetails?.originalTrackUrl;
  const artworkUrl = resolveArtwork(track, "1280");
  const title =
    (typeof (track as any)?.title === "string" && (track as any).title) ||
    (typeof (track as any)?.name === "string" && (track as any).name) ||
    "Unknown Title";
  const artist =
    resolveName((track as any)?.artist) ||
    resolveName((track as any)?.author) ||
    "Unknown Artist";
  const album = (track as any)?.album?.title || "Single";

  const isCurrentTrack = String(currentTrack?.id ?? "") === String(id);

  const handlePlay = () => {
    if (isCurrentTrack) {
      if (isPlaying) void pauseTrack();
      else void resumeTrack();
    } else if (track) {
      void playTrack({
        id: String(id),
        title,
        artist,
        artwork: artworkUrl,
        url: streamUrl || "",
      });
    }
  };

  return (
    <StyledSafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-6 pt-4">
          {/* Cover Art */}
          <View className="aspect-square w-full rounded-2xl overflow-hidden bg-content3 shadow-2xl mb-8">
            {artworkUrl ? (
              <Image
                source={{ uri: artworkUrl }}
                className="w-full h-full"
                resizeMode="cover"
              />
            ) : (
              <View className="w-full h-full items-center justify-center bg-default-200">
                <Ionicons name="musical-notes" size={120} color="#94a3b8" />
              </View>
            )}
          </View>

          {/* Track Info */}
          <View className="mb-8">
            <Text
              className="text-3xl font-bold text-foreground mb-2"
              numberOfLines={2}
            >
              {title}
            </Text>
            <Text className="text-xl text-default-500 mb-1">{artist}</Text>
            <Text className="text-sm text-default-400">{album}</Text>
          </View>

          {/* Controls */}
          <View className="flex-row justify-center items-center gap-12 mb-10">
            <TouchableOpacity onPress={() => {}}>
              <Ionicons name="play-skip-back" size={40} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handlePlay}
              className="w-20 h-20 bg-primary rounded-full items-center justify-center shadow-lg"
            >
              <Ionicons
                name={isCurrentTrack && isPlaying ? "pause" : "play"}
                size={45}
                color="#fff"
                style={{ marginLeft: isCurrentTrack && isPlaying ? 0 : 4 }}
              />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => {}}>
              <Ionicons name="play-skip-forward" size={40} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Actions */}
          <View className="flex-row justify-between px-4">
            <TouchableOpacity className="items-center">
              <Ionicons name="heart-outline" size={28} color="#94a3b8" />
              <Text className="text-xs text-default-400 mt-1">Like</Text>
            </TouchableOpacity>
            <TouchableOpacity className="items-center">
              <Ionicons name="add-circle-outline" size={28} color="#94a3b8" />
              <Text className="text-xs text-default-400 mt-1">Playlist</Text>
            </TouchableOpacity>
            <TouchableOpacity className="items-center">
              <Ionicons name="share-outline" size={28} color="#94a3b8" />
              <Text className="text-xs text-default-400 mt-1">Share</Text>
            </TouchableOpacity>
            <TouchableOpacity className="items-center">
              <Ionicons name="download-outline" size={28} color="#94a3b8" />
              <Text className="text-xs text-default-400 mt-1">Offline</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </StyledSafeAreaView>
  );
}
