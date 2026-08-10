"use client";

import { memo, useCallback } from "react";
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

/**
 * One row. Memoized on (session, active, callbacks) so typing in the
 * message input — which re-renders <Page> — doesn't re-render 767 rows.
 * The callbacks are stable by construction (useCallback in the parent
 * that owns state) so the memo is effectively keyed on the session
 * object and the `active` boolean.
 */
const SidebarRow = memo(function SidebarRow({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: SessionSummary;
  active: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const handleClick = useCallback(
    () => onSelect(session.id),
    [onSelect, session.id],
  );
  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete(session.id);
    },
    [onDelete, session.id],
  );
  return (
    <ListItemButton
      selected={active}
      onClick={handleClick}
      sx={{ mx: 1, my: 0.25 }}
    >
      <ListItemText
        primary={session.title}
        primaryTypographyProps={{
          noWrap: true,
          fontSize: 13,
          fontWeight: active ? 600 : 400,
        }}
      />
      <IconButton
        size="small"
        onClick={handleDelete}
        sx={{ opacity: 0.5, "&:hover": { opacity: 1 } }}
      >
        <DeleteIcon fontSize="inherit" />
      </IconButton>
    </ListItemButton>
  );
});

function SidebarImpl({
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
          <SidebarRow
            key={s.id}
            session={s}
            active={s.id === activeId}
            onSelect={onSelect}
            onDelete={onDelete}
          />
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

/**
 * Memoized so keystrokes in <Page>'s message input don't re-render the
 * sidebar (which owns ~hundreds of DOM nodes). Callbacks passed in are
 * expected to be stable via useCallback in the parent.
 */
const Sidebar = memo(SidebarImpl);
export default Sidebar;
