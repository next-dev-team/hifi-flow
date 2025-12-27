import React, { useEffect } from "react";
import { View, Text, TouchableOpacity, Platform } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useToast } from "../contexts/toast-context";
import { useThemeColor } from "heroui-native";
import { useAppTheme } from "../contexts/app-theme-context";

export const ToastContainer: React.FC = () => {
  const { toast, hideToast } = useToast();
  const themeColorForeground = useThemeColor("foreground");
  const themeColorSuccess = useThemeColor("success");
  const themeColorDanger = useThemeColor("danger");
  const themeColorAccent = useThemeColor("accent");
  const themeColorSuccessForeground = useThemeColor(
    "success-foreground" as any
  );
  const themeColorDangerForeground = useThemeColor("danger-foreground" as any);
  const themeColorAccentForeground = useThemeColor("accent-foreground" as any);
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(-100);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (toast) {
      translateY.value = withSpring(insets.top + 10, {
        damping: 15,
        stiffness: 100,
      });
      opacity.value = withTiming(1, { duration: 300 });
    } else {
      translateY.value = withTiming(-100, { duration: 300 });
      opacity.value = withTiming(0, { duration: 300 });
    }
  }, [toast, insets.top, translateY, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const getBackgroundColor = () => {
    if (!toast) return themeColorAccent;
    switch (toast.type) {
      case "success":
        return themeColorSuccess;
      case "error":
        return themeColorDanger;
      case "info":
      default:
        return themeColorAccent;
    }
  };

  const getTextColor = () => {
    if (!toast) return themeColorAccentForeground;
    switch (toast.type) {
      case "success":
        return themeColorSuccessForeground;
      case "error":
        return themeColorDangerForeground;
      case "info":
      default:
        return themeColorAccentForeground;
    }
  };

  const getIcon = () => {
    if (!toast) return "information-circle";
    switch (toast.type) {
      case "success":
        return "checkmark-circle";
      case "error":
        return "alert-circle";
      case "info":
      default:
        return "information-circle";
    }
  };

  const { isDark } = useAppTheme();

  return (
    <Animated.View
      pointerEvents={toast ? "auto" : "none"}
      style={[
        {
          position: "absolute",
          top: 0,
          left: 16,
          right: 16,
          zIndex: 9999,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: isDark ? 0.5 : 0.25,
          shadowRadius: 3.84,
          elevation: 5,
        },
        animatedStyle,
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={hideToast}
        style={{ backgroundColor: getBackgroundColor() }}
        className="rounded-2xl p-4 flex-row items-center"
      >
        <Ionicons name={getIcon() as any} size={24} color={getTextColor()} />
        <View className="ml-3 flex-1">
          <Text
            style={{ color: getTextColor() }}
            className="font-semibold text-sm"
          >
            {toast?.type === "error"
              ? "Error"
              : toast?.type === "success"
              ? "Success"
              : "Info"}
          </Text>
          <Text
            style={{ color: getTextColor() }}
            className="text-xs opacity-90"
            numberOfLines={2}
          >
            {toast?.message}
          </Text>
        </View>
        <Ionicons
          name="close"
          size={20}
          color={getTextColor()}
          className="opacity-70"
        />
      </TouchableOpacity>
    </Animated.View>
  );
};
