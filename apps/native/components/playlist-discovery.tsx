import type React from "react";
import { ScrollView, View } from "react-native";
import { PlaylistSection } from "./playlist-section";
import type { Playlist } from "./playlist-item";

interface PlaylistDiscoveryProps {
  onSelect: (playlist: Playlist) => void;
}

export const PlaylistDiscovery: React.FC<PlaylistDiscoveryProps> = ({
  onSelect,
}) => {
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
      <PlaylistSection
        title="Trending Playlists"
        query="trending"
        onSelect={onSelect}
      />
      <PlaylistSection title="Mixes for You" query="mix" onSelect={onSelect} />
      <PlaylistSection title="Top Charts" query="top 100" onSelect={onSelect} />
      <PlaylistSection
        title="Moods & Moments"
        query="mood"
        onSelect={onSelect}
      />
      <PlaylistSection title="Workout" query="workout" onSelect={onSelect} />
      <PlaylistSection title="Focus" query="focus" onSelect={onSelect} />
      <PlaylistSection title="Party" query="party" onSelect={onSelect} />
    </ScrollView>
  );
};
