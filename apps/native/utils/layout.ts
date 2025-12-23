import { Platform, useWindowDimensions } from "react-native";

/**
 * Maximum width for bottom sheets on desktop/web to prevent full-screen on large monitors.
 * Approximately 448px (28rem) - similar to Tailwind's max-w-md
 */
export const SHEET_MAX_WIDTH = 448;

/**
 * Hook to check if we're on desktop (web with large screen)
 */
export function useIsDesktop() {
  const { width: screenWidth } = useWindowDimensions();
  return Platform.OS === "web" && screenWidth > SHEET_MAX_WIDTH + 100;
}

/**
 * Get margin for centering sheet on desktop
 */
export function getSheetMargin(screenWidth: number): number {
  const isDesktop =
    Platform.OS === "web" && screenWidth > SHEET_MAX_WIDTH + 100;
  if (!isDesktop) return 0;

  // Calculate margin to center the sheet
  const margin = Math.max(0, (screenWidth - SHEET_MAX_WIDTH) / 2);
  return margin;
}
