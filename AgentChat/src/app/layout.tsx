import type { Metadata, Viewport } from "next";
import ThemeRegistry from "@/components/ThemeRegistry";
import "./globals.css";

// Everything in this app is user-specific and streamed; nothing to prerender.
// Also avoids Next 15 build errors from MUI transitively importing next/document
// during static /404 and /_error generation.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My Agent",
  description: "Chat over the tailnet",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "My Agent", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
