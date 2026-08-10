"use client";
import Box from "@mui/material/Box";

/**
 * Blinking block caret rendered inline at the end of streaming text.
 * Kept as a component so we can tweak the animation timing in one place.
 */
export default function StreamingCursor() {
  return (
    <Box
      component="span"
      aria-hidden
      data-testid="streaming-cursor"
      sx={{
        display: "inline-block",
        width: "0.55em",
        height: "1em",
        ml: "2px",
        verticalAlign: "-0.15em",
        borderRadius: "1px",
        bgcolor: "text.primary",
        opacity: 0.75,
        animation: "chatui-caret-blink 1s steps(1) infinite",
        "@keyframes chatui-caret-blink": {
          "0%, 50%": { opacity: 0.75 },
          "50.01%, 100%": { opacity: 0 },
        },
      }}
    />
  );
}
