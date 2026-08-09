import type { Metadata, Viewport } from "next";
import "./style.css";
import "./extra.css";
import "highlight.js/styles/github-dark.css";

export const metadata: Metadata = {
  title: "ChatUI",
  description: "A Tau-inspired chat UI, rebuilt in Next.js + React",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/tau-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f3ef",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var t = localStorage.getItem('chatui-theme');
                if (!t) {
                  t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'terracotta' : 'night';
                }
                document.documentElement.setAttribute('data-theme', t);
              } catch(e) {}
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
