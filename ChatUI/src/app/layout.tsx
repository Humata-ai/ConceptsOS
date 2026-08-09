import type { Metadata, Viewport } from "next";
import KeyboardInsets from "@/components/KeyboardInsets";
import ThemeRegistry from "@/components/ThemeRegistry";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChatUI",
  description: "Chat over the tailnet",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "ChatUI", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  interactiveWidget: "resizes-content",
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <KeyboardInsets />
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
