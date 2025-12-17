import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Uniwind } from "uniwind";

type ThemeName = "light" | "dark";

type AppThemeContextType = {
  currentTheme: string;
  isLight: boolean;
  isDark: boolean;
  setTheme: (theme: ThemeName) => void;
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
  const [currentTheme, setCurrentTheme] = useState<ThemeName>("light");

  useEffect(() => {
    Uniwind.setTheme(currentTheme);
  }, [currentTheme]);

  const setTheme = useCallback((newTheme: ThemeName) => {
    setCurrentTheme(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setCurrentTheme((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  const value = useMemo(
    () => ({
      currentTheme,
      isLight: currentTheme === "light",
      isDark: currentTheme === "dark",
      setTheme,
      toggleTheme,
    }),
    [currentTheme, setTheme, toggleTheme]
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
