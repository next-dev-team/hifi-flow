import type React from "react";
import { ScrollView, View } from "react-native";
import { PlaylistSection } from "./playlist-section";
import type { Playlist } from "./playlist-item";

interface PlaylistDiscoveryProps {
  onSelect: (playlist: Playlist) => void;
  loadingPlaylistId?: string | null;
  isPlaylistLoading?: boolean;
}

export const PlaylistDiscovery: React.FC<PlaylistDiscoveryProps> = ({
  onSelect,
  loadingPlaylistId,
  isPlaylistLoading,
}) => {
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
      <PlaylistSection
        title="Trending Playlists"
        query="trending"
        onSelect={onSelect}
        loadingPlaylistId={loadingPlaylistId}
        isPlaylistLoading={isPlaylistLoading}
      />
      <PlaylistSection
        title="Mixes for You"
        query="mix"
        onSelect={onSelect}
        loadingPlaylistId={loadingPlaylistId}
        isPlaylistLoading={isPlaylistLoading}
      />
      <PlaylistSection
        title="Top Charts"
        query="top 100"
        onSelect={onSelect}
        loadingPlaylistId={loadingPlaylistId}
        isPlaylistLoading={isPlaylistLoading}
      />
      <PlaylistSection
        title="Moods & Moments"
        query="mood"
        onSelect={onSelect}
        loadingPlaylistId={loadingPlaylistId}
        isPlaylistLoading={isPlaylistLoading}
      />
      <PlaylistSection
        title="Workout"
        query="workout"
        onSelect={onSelect}
        loadingPlaylistId={loadingPlaylistId}
        isPlaylistLoading={isPlaylistLoading}
      />
      <PlaylistSection
        title="Focus"
        query="focus"
        onSelect={onSelect}
        loadingPlaylistId={loadingPlaylistId}
        isPlaylistLoading={isPlaylistLoading}
      />
      <PlaylistSection
        title="Party"
        query="party"
        onSelect={onSelect}
        loadingPlaylistId={loadingPlaylistId}
        isPlaylistLoading={isPlaylistLoading}
      />
    </ScrollView>
  );
};
