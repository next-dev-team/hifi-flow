import "@/global.css";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { PortalProvider } from "@gorhom/portal";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { HeroUINativeProvider } from "heroui-native";
import React, { useEffect } from "react";
import { Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import type {} from "uniwind/types";
import { PlayerBar } from "@/components/player-bar";
import { TimerStatus } from "@/components/timer-status";
import { ToastContainer } from "@/components/toast-container";
import { AppThemeProvider } from "@/contexts/app-theme-context";
import { PlayerProvider } from "@/contexts/player-context";
import { ToastProvider } from "@/contexts/toast-context";

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

  React.useEffect(() => {
    if (Platform.OS === "web") {
      // Initialize VConsole for web debugging
      import("vconsole").then((VConsole) => {
        new VConsole.default();
        console.log("VConsole initialized");
      });

      if ("serviceWorker" in navigator) {
        const registerServiceWorker = () => {
          navigator.serviceWorker
            .register("/sw.js")
            .then((registration) => {
              console.log(
                "Service Worker registered with scope:",
                registration.scope
              );
            })
            .catch((error) => {
              console.error("Service Worker registration failed:", error);
            });
        };

        registerServiceWorker();
      }
    }
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PortalProvider>
        <KeyboardProvider>
          <QueryClientProvider client={queryClient}>
            <AppThemeProvider>
              <ToastProvider>
                <HeroUINativeProvider>
                  <PlayerProvider>
                    <BottomSheetModalProvider>
                      <View className="flex-1 bg-background">
                        <View style={appShellStyle}>
                          <StackLayout />
                          <PlayerBar />
                        </View>
                        <ToastContainer />
                      </View>
                    </BottomSheetModalProvider>
                  </PlayerProvider>
                </HeroUINativeProvider>
              </ToastProvider>
            </AppThemeProvider>
          </QueryClientProvider>
        </KeyboardProvider>
      </PortalProvider>
    </GestureHandlerRootView>
  );
}
