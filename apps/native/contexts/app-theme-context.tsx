import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
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
  useEffect(() => {
    Uniwind.setTheme("light");
  }, []);

  const setTheme = useCallback((newTheme: ThemeName) => {
    void newTheme;
    Uniwind.setTheme("light");
  }, []);

  const toggleTheme = useCallback(() => {
    Uniwind.setTheme("light");
  }, []);

  const value = useMemo(
    () => ({
      currentTheme: "light",
      isLight: true,
      isDark: false,
      setTheme,
      toggleTheme,
    }),
    [setTheme, toggleTheme]
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
