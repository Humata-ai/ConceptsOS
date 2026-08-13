"use client";

import { memo, useCallback } from "react";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Skeleton from "@mui/material/Skeleton";
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
  loading?: boolean;
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

// Placeholder rows shown before the first /api/sessions response lands,
// so the sidebar isn't jarringly empty on cold start. Pulses via MUI's
// built-in Skeleton animation.
const SKELETON_ROWS = 6;

function SidebarImpl({
  width,
  sessions,
  activeId,
  mode,
  loading = false,
  onNew,
  onSelect,
  onDelete,
  onToggleTheme,
}: Props) {
  return (
    <Box sx={{ width, display: "flex", flexDirection: "column", height: "100%" }}>
      <Box
        sx={{
          px: 1.5,
          pt: 0,
          pb: 0.5,
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Typography variant="h6" sx={{ flex: 1 }}>My Agent</Typography>
        <Tooltip title="New chat">
          <IconButton size="small" onClick={onNew}><AddIcon fontSize="small" /></IconButton>
        </Tooltip>
      </Box>
      <Divider />
      <List sx={{ flex: 1, overflowY: "auto", py: 0.5 }} dense>
        {loading && sessions.length === 0
          ? Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Box
                key={`sk-${i}`}
                data-testid="sidebar-skeleton"
                sx={{ mx: 2, my: 1 }}
              >
                <Skeleton
                  variant="text"
                  width={`${60 + ((i * 13) % 30)}%`}
                  height={20}
                />
              </Box>
            ))
          : sessions.map((s) => (
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
      <Box
        sx={{
          p: 1,
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
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
