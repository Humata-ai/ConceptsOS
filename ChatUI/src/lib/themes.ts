export type ThemeId =
  | "night"
  | "dawn"
  | "midnight"
  | "clean"
  | "terracotta"
  | "sage";

export interface Theme {
  id: ThemeId;
  name: string;
  dark: boolean;
  colors: string[];
}

export const themes: Record<ThemeId, Theme> = {
  night: { id: "night", name: "Dusk", dark: true, colors: ["#212121", "#a0a0a0", "#777777", "#666666"] },
  dawn: { id: "dawn", name: "Dawn", dark: true, colors: ["#1a1d26", "#7a8ab0", "#6a5a80", "#5a7a9a"] },
  midnight: { id: "midnight", name: "Midnight", dark: true, colors: ["#000000", "#5a7a9a", "#4a5565", "#4a5a72"] },
  clean: { id: "clean", name: "Clean", dark: false, colors: ["#ffffff", "#0580c4", "#007aff", "#5ac8fa"] },
  terracotta: { id: "terracotta", name: "Terracotta", dark: false, colors: ["#f4f1ec", "#b06a48", "#5c2860", "#3a6a9b"] },
  sage: { id: "sage", name: "Sage", dark: false, colors: ["#f0f2ec", "#6a7d5a", "#4a3860", "#3a6a7a"] },
};

export function applyTheme(id: ThemeId) {
  if (typeof document === "undefined") return;
  if (!themes[id]) id = "night";
  document.documentElement.setAttribute("data-theme", id);
  try { localStorage.setItem("chatui-theme", id); } catch {}
}

export function getInitialTheme(): ThemeId {
  if (typeof window === "undefined") return "night";
  try {
    const saved = localStorage.getItem("chatui-theme") as ThemeId | null;
    if (saved && themes[saved]) return saved;
  } catch {}
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) return "terracotta";
  return "night";
}
