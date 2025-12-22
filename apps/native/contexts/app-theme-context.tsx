import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from "react";
import { useColorScheme } from "react-native";
import { Uniwind } from "uniwind";
import { usePersistentState } from "@/hooks/use-persistent-state";

type ThemeMode = "light" | "dark" | "auto";
type ThemeName = "light" | "dark";

const THEME_STORAGE_KEY = "app_theme_mode";

type AppThemeContextType = {
  currentTheme: ThemeName;
  themeMode: ThemeMode;
  isLight: boolean;
  isDark: boolean;
  isAuto: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
};

const AppThemeContext = createContext<AppThemeContextType | undefined>(
  undefined
);

export const AppThemeProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeMode, isLoaded] = usePersistentState<ThemeMode>(
    THEME_STORAGE_KEY,
    "auto"
  );

  // Compute actual theme based on mode
  const currentTheme: ThemeName = useMemo(() => {
    if (themeMode === "auto") {
      return systemColorScheme === "dark" ? "dark" : "light";
    }
    return themeMode;
  }, [themeMode, systemColorScheme]);

  // Apply theme to Uniwind when it changes
  useEffect(() => {
    if (isLoaded) {
      Uniwind.setTheme(currentTheme);
    }
  }, [currentTheme, isLoaded]);

  const setTheme = useCallback(
    (newMode: ThemeMode) => {
      setThemeMode(newMode);
    },
    [setThemeMode]
  );

  const toggleTheme = useCallback(() => {
    setThemeMode((prev) => {
      // Cycle: auto -> light -> dark -> auto
      if (prev === "auto") {
        return "light";
      } else if (prev === "light") {
        return "dark";
      } else {
        return "auto";
      }
    });
  }, [setThemeMode]);

  const value = useMemo(
    () => ({
      currentTheme,
      themeMode,
      isLight: currentTheme === "light",
      isDark: currentTheme === "dark",
      isAuto: themeMode === "auto",
      setTheme,
      toggleTheme,
    }),
    [currentTheme, themeMode, setTheme, toggleTheme]
  );

  return (
    <AppThemeContext.Provider value={value}>
      {children}
    </AppThemeContext.Provider>
  );
};

export function useAppTheme() {
  const context = useContext(AppThemeContext);
  if (!context) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }
  return context;
}
