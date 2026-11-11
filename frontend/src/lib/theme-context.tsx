"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "theme";

interface ThemeContextValue {
  theme: Theme;
  mounted: boolean;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Starts "dark" unconditionally so server and first client render match;
  // the inline bootstrap script in layout.tsx has already set the real
  // theme on <html> before paint, and this effect just syncs React state to it.
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Read-after-mount is intentional here: the server always renders "dark"
    // (it has no access to the bootstrap script's DOM mutation), so the real
    // theme can only be read once mounted.
    const current = document.documentElement.dataset.theme;
    if (current === "light" || current === "dark") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTheme(current);
    }
    setMounted(true);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Storage may be unavailable (private mode); theme still applies for this tab.
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, mounted, toggle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
