"use client";

import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import SendIcon from "@mui/icons-material/ArrowUpward";
import { useStickToBottomContext } from "use-stick-to-bottom";

export default function ScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <Box
      sx={{
        position: "absolute",
        bottom: 12,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <IconButton
        size="small"
        onClick={() => scrollToBottom()}
        sx={{
          pointerEvents: "auto",
          bgcolor: "background.paper",
          border: (t) => `1px solid ${t.palette.divider}`,
          boxShadow: 1,
          "&:hover": { bgcolor: "background.paper" },
        }}
        aria-label="scroll to bottom"
      >
        <SendIcon sx={{ transform: "rotate(180deg)", fontSize: 18 }} />
      </IconButton>
    </Box>
  );
}
