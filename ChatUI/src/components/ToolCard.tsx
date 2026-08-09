"use client";
import { useState } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import type { UiToolCall } from "@/lib/types";

export default function ToolCard({ tool }: { tool: UiToolCall }) {
  const [open, setOpen] = useState(false);
  const inputStr = safeJson(tool.input);
  const summary = firstLine(inputStr) || "…";
  return (
    <Paper
      variant="outlined"
      sx={{
        my: 1,
        px: 1.25,
        py: 0.75,
        borderColor: (t) => t.palette.divider,
        bgcolor: "transparent",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Chip
          size="small"
          label={tool.name}
          color={tool.isError ? "error" : tool.done ? "default" : "primary"}
          variant="outlined"
          sx={{ height: 22 }}
        />
        <Typography
          variant="body2"
          sx={{
            flex: 1,
            color: "text.secondary",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </Typography>
        <IconButton size="small" onClick={() => setOpen((o) => !o)} aria-label="toggle">
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            input
          </Typography>
          <Box
            component="pre"
            sx={{ fontSize: 12, my: 0.5, color: "text.primary", opacity: 0.9 }}
          >
            {inputStr}
          </Box>
          <Typography variant="caption" color="text.secondary">
            {tool.done ? "output" : "streaming…"}
          </Typography>
          <Box
            component="pre"
            sx={{
              fontSize: 12,
              my: 0.5,
              color: tool.isError ? "error.main" : "text.primary",
              opacity: 0.9,
              maxHeight: 300,
              overflow: "auto",
            }}
          >
            {tool.output || " "}
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}

function safeJson(x: unknown): string {
  try {
    if (typeof x === "string") return x;
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}
function firstLine(s: string): string {
  const l = s.split("\n")[0] ?? "";
  return l.length > 120 ? l.slice(0, 120) + "…" : l;
}
