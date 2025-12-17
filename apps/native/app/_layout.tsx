import "@/global.css";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { HeroUINativeProvider } from "heroui-native";
import { Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import type {} from "uniwind/types";
import { PlayerBar } from "@/components/player-bar";
import { AppThemeProvider } from "@/contexts/app-theme-context";
import { PlayerProvider } from "@/contexts/player-context";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

function StackLayout() {
  return (
    <Stack screenOptions={{}}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="modal"
        options={{ title: "Modal", presentation: "modal" }}
      />
    </Stack>
  );
}

const queryClient = new QueryClient();

const APP_WEB_MAX_WIDTH = 480;

export default function Layout() {
  const appShellStyle =
    Platform.OS === "web"
      ? ({
          flex: 1,
          width: "100%",
          maxWidth: APP_WEB_MAX_WIDTH,
          alignSelf: "center",
        } as const)
      : ({ flex: 1 } as const);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <AppThemeProvider>
            <HeroUINativeProvider>
              <View className="flex-1 bg-background">
                <BottomSheetModalProvider>
                  <PlayerProvider>
                    <View style={appShellStyle}>
                      <StackLayout />
                      <PlayerBar />
                    </View>
                  </PlayerProvider>
                </BottomSheetModalProvider>
              </View>
            </HeroUINativeProvider>
          </AppThemeProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
