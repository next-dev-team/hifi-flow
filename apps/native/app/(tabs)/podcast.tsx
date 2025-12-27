import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";
import { Ionicons } from "@expo/vector-icons";

const StyledSafeAreaView = withUniwind(SafeAreaView);
const StyledView = withUniwind(View);
const StyledText = withUniwind(Text);

export default function PodcastScreen() {
  return (
    <StyledSafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <StyledView className="px-4 py-4 mb-2">
        <StyledText className="text-2xl font-bold text-foreground">
          Podcast
        </StyledText>
      </StyledView>

      <StyledView className="flex-1 justify-center items-center px-4">
        <Ionicons name="mic-outline" size={80} color="#ef4444" />
        <StyledText className="text-xl font-bold text-foreground mt-4">
          Coming Soon
        </StyledText>
        <StyledText className="text-foreground opacity-60 text-center mt-2">
          We're working hard to bring podcasts to HiFi Flow. Stay tuned!
        </StyledText>
      </StyledView>
    </StyledSafeAreaView>
  );
}
