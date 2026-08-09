"use client";
import { createTheme } from "@mui/material/styles";

// A single minimalist theme — neutral grays, one accent, no shadows,
// small border radius, tight typography.
export function makeTheme(mode: "light" | "dark") {
  const dark = mode === "dark";
  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? "#e5e5e5" : "#111111" },
      secondary: { main: dark ? "#9aa0a6" : "#5f6368" },
      background: {
        default: dark ? "#0e0e0e" : "#fafafa",
        paper: dark ? "#151515" : "#ffffff",
      },
      divider: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
      text: {
        primary: dark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.87)",
        secondary: dark ? "rgba(255,255,255,0.60)" : "rgba(0,0,0,0.55)",
      },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: [
        "-apple-system",
        "BlinkMacSystemFont",
        "Inter",
        "Segoe UI",
        "Roboto",
        "Helvetica Neue",
        "sans-serif",
      ].join(","),
      fontSize: 14,
      h6: { fontWeight: 600, letterSpacing: "-0.01em" },
      button: { textTransform: "none", fontWeight: 500 },
    },
    shadows: Array(25).fill("none") as any,
    components: {
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: "none" },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: "transparent" },
      },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiIconButton: { defaultProps: { size: "small" } },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            marginLeft: 8,
            marginRight: 8,
            paddingTop: 6,
            paddingBottom: 6,
          },
        },
      },
      MuiTextField: {
        defaultProps: { variant: "outlined", size: "small" },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          notchedOutline: {
            borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)",
          },
        },
      },
    },
  });
}
