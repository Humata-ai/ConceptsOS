import type { Metadata, Viewport } from "next";
import "./globals.css";
import "highlight.js/styles/github.css";
import { ThemeRegistry } from "@/components/ThemeRegistry";

export const metadata: Metadata = {
  title: "ChatUI",
  description: "A minimalist Pi chat UI",
  manifest: "/manifest.json",
  icons: { icon: "/icons/tau-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
