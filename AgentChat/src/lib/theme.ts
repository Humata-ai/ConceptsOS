"use client";
import { createTheme, type Theme } from "@mui/material/styles";

export function buildTheme(mode: "light" | "dark"): Theme {
  const accent = "#3b82f6";
  return createTheme({
    palette: {
      mode,
      primary: { main: accent },
      background:
        mode === "light"
          ? { default: "#fafafa", paper: "#ffffff" }
          : { default: "#0b0b0c", paper: "#141416" },
      divider: mode === "light" ? "#e5e5e5" : "#26262a",
      text:
        mode === "light"
          ? { primary: "#111", secondary: "#555" }
          : { primary: "#f5f5f5", secondary: "#a3a3a8" },
    },
    typography: {
      fontFamily:
        'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, "Helvetica Neue", Arial, sans-serif',
      fontSize: 14,
      h6: { fontWeight: 600, fontSize: "0.95rem" },
      body1: { fontSize: "0.95rem", lineHeight: 1.55 },
      body2: { fontSize: "0.85rem", lineHeight: 1.5 },
    },
    shape: { borderRadius: 8 },
    shadows: Array(25).fill("none") as unknown as Theme["shadows"],
    components: {
      MuiButton: { styleOverrides: { root: { textTransform: "none", boxShadow: "none" } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiAppBar: {
        styleOverrides: {
          root: { boxShadow: "none", backgroundImage: "none" },
        },
      },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 6 } } },
    },
  });
}
