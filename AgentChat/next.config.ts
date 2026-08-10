import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-agent-core", "@earendil-works/pi-ai"],
  experimental: {
    // Ensure the SDK loads its ESM/CJS bits correctly on the server
  },
};

export default nextConfig;
