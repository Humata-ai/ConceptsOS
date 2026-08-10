"use client";
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import CheckCircleIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorIcon from "@mui/icons-material/ErrorOutline";
import BuildIcon from "@mui/icons-material/BuildOutlined";
import type { UiToolCall } from "@/lib/types";

type Status = "running" | "error" | "done";

// One accent palette-color per status. Used both as an sx path string
// (`accent.main`) and as a theme-palette key (`t.palette[accent].main`),
// so both call sites stay in lockstep.
const STATUS_ACCENT: Record<Status, "primary" | "error" | "success"> = {
  running: "primary",
  error: "error",
  done: "success",
};

export default function ToolCard({ tool }: { tool: UiToolCall }) {
  // Auto-expand while running, collapse once done — but respect user override.
  const [userToggled, setUserToggled] = useState(false);
  const [open, setOpen] = useState(!tool.done);
  useEffect(() => {
    if (!userToggled) setOpen(!tool.done);
  }, [tool.done, userToggled]);

  const inputStr = safeJson(tool.input);
  const summary = firstLine(inputStr) || "…";
  const status: Status = tool.isError ? "error" : tool.done ? "done" : "running";
  const accent = STATUS_ACCENT[status];

  return (
    <Paper
      variant="outlined"
      data-testid="tool-card"
      data-tool-name={tool.name}
      data-tool-status={status}
      sx={{
        my: 1,
        px: 1.25,
        py: 0.75,
        borderColor: (t) =>
          status === "running" ? t.palette.primary.main : t.palette.divider,
        borderLeft: (t) => `3px solid ${t.palette[accent].main}`,
        bgcolor: "transparent",
        transition: "border-color 0.2s ease",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box
          sx={{
            width: 20,
            height: 20,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: `${accent}.main`,
            flexShrink: 0,
          }}
        >
          {status === "running" ? (
            <CircularProgress size={14} thickness={5} />
          ) : status === "error" ? (
            <ErrorIcon fontSize="small" />
          ) : (
            <CheckCircleIcon fontSize="small" />
          )}
        </Box>
        <BuildIcon
          fontSize="inherit"
          sx={{ color: "text.secondary", fontSize: 14, flexShrink: 0 }}
        />
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, fontSize: 13, mr: 0.5, flexShrink: 0 }}
        >
          {tool.name}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            flex: 1,
            color: "text.secondary",
            fontSize: 13,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          }}
        >
          {summary}
        </Typography>
        <IconButton
          size="small"
          onClick={() => {
            setUserToggled(true);
            setOpen((o) => !o);
          }}
          aria-label="toggle"
        >
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            Input
          </Typography>
          <Box
            component="pre"
            sx={{
              fontSize: 12,
              my: 0.5,
              px: 1,
              py: 0.75,
              borderRadius: 0.75,
              bgcolor: (t) => (t.palette.mode === "dark" ? "#141519" : "#f5f5f7"),
              border: (t) => `1px solid ${t.palette.divider}`,
              overflow: "auto",
              maxHeight: 200,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            }}
          >
            {inputStr}
          </Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 0.5 }}
          >
            {status === "running" ? (
              <>
                <CircularProgress size={10} thickness={5} /> Streaming…
              </>
            ) : status === "error" ? (
              "Error"
            ) : (
              "Output"
            )}
          </Typography>
          <Box
            component="pre"
            sx={{
              fontSize: 12,
              my: 0.5,
              px: 1,
              py: 0.75,
              borderRadius: 0.75,
              bgcolor: (t) => (t.palette.mode === "dark" ? "#141519" : "#f5f5f7"),
              border: (t) => `1px solid ${t.palette.divider}`,
              color: status === "error" ? "error.main" : "text.primary",
              maxHeight: 300,
              overflow: "auto",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              whiteSpace: "pre-wrap",
            }}
          >
            {tool.output || (status === "running" ? " " : "(no output)")}
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
  return l.length > 140 ? l.slice(0, 140) + "…" : l;
}
