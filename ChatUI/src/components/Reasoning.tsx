"use client";
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import PsychologyIcon from "@mui/icons-material/PsychologyOutlined";

type Props = {
  text: string;
  streaming: boolean;
  startedAt?: number;
  endedAt?: number;
};

/**
 * Collapsible "chain of thought" block, modeled on Vercel AI Elements'
 * <Reasoning>. While streaming, shows a shimmer + live-updating "Thinking…"
 * with a running timer, and is expanded by default. Once thinking is done
 * it collapses and shows "Thought for Xs".
 */
export default function Reasoning({ text, streaming, startedAt, endedAt }: Props) {
  const [userToggled, setUserToggled] = useState(false);
  const [open, setOpen] = useState(true);

  // Auto-collapse when thinking finishes, unless the user has explicitly
  // toggled the panel (in which case we respect their choice).
  useEffect(() => {
    if (!userToggled) setOpen(streaming);
  }, [streaming, userToggled]);

  const elapsed = useElapsedSeconds(startedAt, streaming ? undefined : endedAt);

  return (
    <Box
      sx={{
        my: 1,
        borderLeft: (t) => `2px solid ${t.palette.divider}`,
        pl: 1.25,
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        onClick={() => {
          setUserToggled(true);
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setUserToggled(true);
            setOpen((o) => !o);
          }
        }}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.75,
          cursor: "pointer",
          color: "text.secondary",
          userSelect: "none",
          "&:hover": { color: "text.primary" },
        }}
      >
        <PsychologyIcon fontSize="small" />
        <Typography
          variant="body2"
          sx={{
            fontWeight: 500,
            ...(streaming
              ? {
                  background: (t) =>
                    `linear-gradient(90deg, ${t.palette.text.secondary} 0%, ${t.palette.text.primary} 50%, ${t.palette.text.secondary} 100%)`,
                  backgroundSize: "200% 100%",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                  animation: "chatui-shimmer 2s linear infinite",
                  "@keyframes chatui-shimmer": {
                    "0%": { backgroundPosition: "200% 0" },
                    "100%": { backgroundPosition: "-200% 0" },
                  },
                }
              : {}),
          }}
        >
          {streaming
            ? `Thinking${elapsed != null ? ` · ${elapsed}s` : "…"}`
            : `Thought${elapsed != null ? ` for ${elapsed}s` : ""}`}
        </Typography>
        {open ? (
          <ExpandLessIcon fontSize="small" sx={{ opacity: 0.7 }} />
        ) : (
          <ExpandMoreIcon fontSize="small" sx={{ opacity: 0.7 }} />
        )}
      </Box>
      <Collapse in={open} unmountOnExit>
        <Typography
          component="pre"
          variant="body2"
          sx={{
            mt: 0.75,
            whiteSpace: "pre-wrap",
            fontFamily: "inherit",
            color: "text.secondary",
            fontSize: 13.5,
            lineHeight: 1.55,
          }}
        >
          {text}
        </Typography>
      </Collapse>
    </Box>
  );
}

function useElapsedSeconds(
  startedAt: number | undefined,
  endedAt: number | undefined,
): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt || endedAt) return;
    const iv = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(iv);
  }, [startedAt, endedAt]);
  if (!startedAt) return null;
  const end = endedAt ?? Date.now();
  return Math.max(0, Math.round((end - startedAt) / 1000));
}
