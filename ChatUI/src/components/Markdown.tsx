"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";

export default function Markdown({ children }: { children: string }) {
  return (
    <Box
      sx={{
        fontSize: 15,
        lineHeight: 1.6,
        "& p": { my: 1 },
        "& p:first-of-type": { mt: 0 },
        "& p:last-of-type": { mb: 0 },
        "& h1, & h2, & h3, & h4": { mt: 2, mb: 1, fontWeight: 600, lineHeight: 1.3 },
        "& h1": { fontSize: "1.35rem" },
        "& h2": { fontSize: "1.2rem" },
        "& h3": { fontSize: "1.05rem" },
        "& h4": { fontSize: "1rem" },
        "& ul, & ol": { pl: 3, my: 1 },
        "& li": { my: 0.25 },
        "& li > p": { my: 0.25 },
        "& hr": {
          border: "none",
          borderTop: (t) => `1px solid ${t.palette.divider}`,
          my: 2,
        },
        "& blockquote": {
          borderLeft: (t) => `3px solid ${t.palette.divider}`,
          m: 0,
          my: 1,
          pl: 1.5,
          color: "text.secondary",
        },
        "& code": {
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
          fontSize: "0.88em",
          px: 0.5,
          py: 0.1,
          borderRadius: 0.5,
          bgcolor: (t) => (t.palette.mode === "dark" ? "#1f2126" : "#f0f0f2"),
        },
        "& pre": {
          my: 1.25,
          p: 1.25,
          borderRadius: 1,
          overflow: "auto",
          bgcolor: (t) => (t.palette.mode === "dark" ? "#141519" : "#f5f5f7"),
          border: (t) => `1px solid ${t.palette.divider}`,
        },
        "& pre code": {
          bgcolor: "transparent",
          p: 0,
          fontSize: "0.85em",
        },
        "& table": {
          borderCollapse: "collapse",
          my: 1.25,
          fontSize: "0.9em",
          display: "block",
          overflowX: "auto",
        },
        "& th, & td": {
          border: (t) => `1px solid ${t.palette.divider}`,
          px: 1,
          py: 0.5,
          textAlign: "left",
        },
        "& img": { maxWidth: "100%", borderRadius: 1 },
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <Link href={href} target="_blank" rel="noreferrer noopener" underline="hover">
              {children}
            </Link>
          ),
          p: ({ children }) => <Typography component="p">{children}</Typography>,
        }}
      >
        {children}
      </ReactMarkdown>
    </Box>
  );
}
