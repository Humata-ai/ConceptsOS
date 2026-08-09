"use client";
import * as React from "react";
import { CacheProvider } from "@emotion/react";
import createCache from "@emotion/cache";
import { useServerInsertedHTML } from "next/navigation";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { makeTheme } from "@/lib/theme";

// Minimal Next.js App Router + MUI/emotion integration.
export function ThemeRegistry({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = React.useState<"light" | "dark">("light");
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem("chatui-mode") as "light" | "dark" | null;
      if (saved) setMode(saved);
      else if (window.matchMedia("(prefers-color-scheme: dark)").matches) setMode("dark");
    } catch {}
  }, []);
  React.useEffect(() => {
    try { localStorage.setItem("chatui-mode", mode); } catch {}
    document.documentElement.style.setProperty(
      "--code-bg", mode === "dark" ? "#0a0a0a" : "#f5f5f5"
    );
    document.documentElement.style.setProperty(
      "--divider", mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"
    );
    document.documentElement.style.setProperty(
      "--text-2", mode === "dark" ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.55)"
    );
  }, [mode]);

  const [{ cache, flush }] = React.useState(() => {
    const c = createCache({ key: "mui", prepend: true });
    c.compat = true;
    const prevInsert = c.insert;
    let inserted: string[] = [];
    c.insert = (...args) => {
      const serialized = args[1];
      if ((c as any).inserted[serialized.name] === undefined) inserted.push(serialized.name);
      return prevInsert(...args);
    };
    return { cache: c, flush: () => { const p = inserted; inserted = []; return p; } };
  });

  useServerInsertedHTML(() => {
    const names = flush();
    if (names.length === 0) return null;
    let styles = "";
    for (const name of names) styles += cache.inserted[name];
    return (
      <style
        data-emotion={`${cache.key} ${names.join(" ")}`}
        dangerouslySetInnerHTML={{ __html: styles }}
      />
    );
  });

  const theme = React.useMemo(() => makeTheme(mode), [mode]);

  return (
    <CacheProvider value={cache}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>
      </ThemeProvider>
    </CacheProvider>
  );
}

export const ModeContext = React.createContext<{
  mode: "light" | "dark";
  setMode: (m: "light" | "dark") => void;
}>({ mode: "light", setMode: () => {} });

export function useMode() { return React.useContext(ModeContext); }
