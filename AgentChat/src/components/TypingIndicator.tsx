"use client";
import Box from "@mui/material/Box";

/**
 * Three-dot "assistant is thinking" indicator. Shown before any tokens
 * arrive so the UI doesn't look frozen between send and first delta.
 */
export default function TypingIndicator() {
  return (
    <Box
      aria-label="assistant is thinking"
      data-testid="typing-indicator"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.6,
        py: 0.75,
        "@keyframes chatui-typing-bounce": {
          "0%, 80%, 100%": { transform: "translateY(0)", opacity: 0.4 },
          "40%": { transform: "translateY(-3px)", opacity: 1 },
        },
        "& > span": {
          width: 6,
          height: 6,
          borderRadius: "50%",
          bgcolor: "text.secondary",
          display: "inline-block",
          animation: "chatui-typing-bounce 1.2s ease-in-out infinite",
        },
        "& > span:nth-of-type(2)": { animationDelay: "0.15s" },
        "& > span:nth-of-type(3)": { animationDelay: "0.3s" },
      }}
    >
      <span />
      <span />
      <span />
    </Box>
  );
}
