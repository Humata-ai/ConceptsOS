"use client";

import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import DarkIcon from "@mui/icons-material/DarkMode";
import LightIcon from "@mui/icons-material/LightMode";
import type { SessionSummary } from "@/lib/types";

type Props = {
  width: number;
  sessions: SessionSummary[];
  activeId: string | null;
  mode: "light" | "dark";
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleTheme: () => void;
};

export default function Sidebar({
  width,
  sessions,
  activeId,
  mode,
  onNew,
  onSelect,
  onDelete,
  onToggleTheme,
}: Props) {
  return (
    <Box sx={{ width, display: "flex", flexDirection: "column", height: "100%" }}>
      <Box sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>ChatUI</Typography>
        <Tooltip title="New chat">
          <IconButton size="small" onClick={onNew}><AddIcon fontSize="small" /></IconButton>
        </Tooltip>
      </Box>
      <Divider />
      <List sx={{ flex: 1, overflowY: "auto", py: 0.5 }} dense>
        {sessions.map((s) => (
          <ListItemButton
            key={s.id}
            selected={s.id === activeId}
            onClick={() => onSelect(s.id)}
            sx={{ mx: 1, my: 0.25 }}
          >
            <ListItemText
              primary={s.title}
              primaryTypographyProps={{
                noWrap: true,
                fontSize: 13,
                fontWeight: s.id === activeId ? 600 : 400,
              }}
            />
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(s.id);
              }}
              sx={{ opacity: 0.5, "&:hover": { opacity: 1 } }}
            >
              <DeleteIcon fontSize="inherit" />
            </IconButton>
          </ListItemButton>
        ))}
      </List>
      <Divider />
      <Box sx={{ p: 1, display: "flex", alignItems: "center", gap: 1 }}>
        <IconButton size="small" onClick={onToggleTheme} aria-label="toggle theme">
          {mode === "dark" ? <LightIcon fontSize="small" /> : <DarkIcon fontSize="small" />}
        </IconButton>
        <Typography variant="caption" color="text.secondary">
          {mode === "dark" ? "dark" : "light"}
        </Typography>
      </Box>
    </Box>
  );
}
