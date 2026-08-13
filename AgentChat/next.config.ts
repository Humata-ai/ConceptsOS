import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Hide the floating Next.js dev indicator ("N" badge) in the browser,
  // including when AgentChat is embedded in the DesktopUI webview.
  devIndicators: false,
  serverExternalPackages: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-agent-core", "@earendil-works/pi-ai"],
  experimental: {
    // Ensure the SDK loads its ESM/CJS bits correctly on the server
  },
};

export default nextConfig;
