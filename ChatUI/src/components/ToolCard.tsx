"use client";
import * as React from "react";
import { Box, Chip, Collapse, IconButton, Paper, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";

export function ToolCard({
  name, input, output, error, running,
}: {
  name: string;
  input?: unknown;
  output?: string;
  error?: boolean;
  running?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const inputStr = React.useMemo(() => {
    if (input == null) return "";
    if (typeof input === "string") return input;
    try { return JSON.stringify(input, null, 2); } catch { return String(input); }
  }, [input]);

  return (
    <Paper
      variant="outlined"
      sx={{
        px: 1.5, py: 0.75,
        my: 0.5,
        maxWidth: 720,
        borderColor: error ? "error.main" : "divider",
        bgcolor: "transparent",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Chip
          size="small"
          label={running ? `${name}…` : name}
          color={error ? "error" : "default"}
          variant="outlined"
          sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, height: 22 }}
        />
        <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1, fontSize: 12 }}>
          {inputStr.split("\n")[0].slice(0, 120)}
        </Typography>
        {(inputStr || output) && (
          <IconButton onClick={() => setOpen(o => !o)} sx={{ p: 0.25 }}>
            {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        )}
      </Box>
      <Collapse in={open} unmountOnExit>
        {inputStr && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">input</Typography>
            <pre style={{
              margin: "2px 0 0",
              padding: "8px 10px",
              background: "var(--code-bg, #f5f5f5)",
              borderRadius: 6,
              overflowX: "auto",
              fontSize: 12,
              lineHeight: 1.45,
            }}>{inputStr}</pre>
          </Box>
        )}
        {output && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">output</Typography>
            <pre style={{
              margin: "2px 0 0",
              padding: "8px 10px",
              background: "var(--code-bg, #f5f5f5)",
              borderRadius: 6,
              overflowX: "auto",
              fontSize: 12,
              lineHeight: 1.45,
              whiteSpace: "pre-wrap",
              maxHeight: 320,
            }}>{output}</pre>
          </Box>
        )}
      </Collapse>
    </Paper>
  );
}
