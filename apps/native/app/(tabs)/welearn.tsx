import React from "react";
import { Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

const URL = "https://kamsan-daily.netlify.app/";

const StyledSafeAreaView = withUniwind(SafeAreaView);
const StyledView = withUniwind(View);

export default function WeLearnScreen() {
  if (Platform.OS === "web") {
    return (
      <StyledSafeAreaView className="flex-1 bg-background" edges={["top"]}>
        <StyledView className="flex-1">
          {React.createElement("iframe", {
            src: URL,
            style: {
              border: 0,
              width: "100%",
              height: "100%",
            },
            allow: "fullscreen",
            allowFullScreen: true,
          })}
        </StyledView>
      </StyledSafeAreaView>
    );
  }

  const WebView = require("react-native-webview")
    .WebView as React.ComponentType<{
    source: { uri: string };
    style?: unknown;
  }>;

  return (
    <StyledSafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <WebView source={{ uri: URL }} style={{ flex: 1 }} />
    </StyledSafeAreaView>
  );
}
