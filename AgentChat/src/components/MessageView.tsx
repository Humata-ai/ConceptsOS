"use client";

import { memo } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Markdown from "./Markdown";
import Reasoning from "./Reasoning";
import StreamingCursor from "./StreamingCursor";
import ToolCard from "./ToolCard";
import TypingIndicator from "./TypingIndicator";
import type { UiMessage } from "@/lib/types";

function MessageViewImpl({ message }: { message: UiMessage }) {
  const isUser = message.role === "user";
  const streaming = !!message.streaming;
  const thinkingActive = streaming && !!message.thinking && !message.text;
  const showTypingDots =
    streaming &&
    !message.text &&
    !message.thinking &&
    message.toolCalls.length === 0;

  return (
    <Box
      data-testid={isUser ? "user-message" : "assistant-message"}
      data-streaming={streaming ? "true" : "false"}
      sx={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        animation: "chatui-msg-in 200ms ease both",
        "@keyframes chatui-msg-in": {
          from: { opacity: 0, transform: "translateY(4px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      }}
    >
      <Box
        sx={{
          maxWidth: isUser ? "80%" : "100%",
          width: isUser ? "auto" : "100%",
        }}
      >
        {isUser ? (
          <Paper
            variant="outlined"
            sx={{
              px: 1.5,
              py: 1,
              borderRadius: 2,
              bgcolor: (t) => (t.palette.mode === "dark" ? "#1b1d22" : "#f0f4ff"),
              borderColor: (t) => t.palette.divider,
            }}
          >
            <Typography component="pre" sx={{ whiteSpace: "pre-wrap", fontSize: 14 }}>
              {message.text}
            </Typography>
          </Paper>
        ) : (
          <Box>
            {message.thinking && (
              <Reasoning
                text={message.thinking}
                streaming={thinkingActive}
                startedAt={message.thinkingStartedAt}
                endedAt={message.thinkingEndedAt}
              />
            )}
            {message.toolCalls.map((t) => (
              <ToolCard key={t.id} tool={t} />
            ))}
            {message.text && (
              <Box data-testid="assistant-text" sx={{ position: "relative" }}>
                <Markdown>{message.text}</Markdown>
                {streaming && <StreamingCursor />}
              </Box>
            )}
            {showTypingDots && <TypingIndicator />}
          </Box>
        )}
      </Box>
    </Box>
  );
}

/**
 * Memoized so that streaming a new assistant token doesn't force every
 * historical <MessageView> in the list to re-render. Since UiMessages are
 * treated as immutable (chatReducer returns new objects on mutation),
 * default reference equality is exactly what we want.
 */
const MessageView = memo(MessageViewImpl);
export default MessageView;
