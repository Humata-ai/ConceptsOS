"use client";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { createContext, useEffect, useMemo, useState } from "react";
import { buildTheme } from "@/lib/theme";

type Mode = "light" | "dark";
export const ColorModeContext = createContext<{ mode: Mode; toggle: () => void }>({
  mode: "light",
  toggle: () => {},
});

export default function ThemeRegistry({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    const saved = (localStorage.getItem("chatui-mode") as Mode | null) ?? null;
    if (saved) setMode(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem("chatui-mode", mode);
  }, [mode]);

  const theme = useMemo(() => buildTheme(mode), [mode]);
  const ctx = useMemo(
    () => ({ mode, toggle: () => setMode((m) => (m === "light" ? "dark" : "light")) }),
    [mode],
  );

  return (
    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
      <ColorModeContext.Provider value={ctx}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </ThemeProvider>
      </ColorModeContext.Provider>
    </AppRouterCacheProvider>
  );
}
