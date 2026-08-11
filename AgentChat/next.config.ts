import type { NextConfig } from "next";

// In the ConceptsOS-VM pod, AgentChat is mounted behind caddy at
// /agent/*. Setting basePath makes Next emit correct asset URLs
// (/agent/_next/...) so the whole app works under the prefix.
// Override with NEXT_PUBLIC_BASE_PATH="" for standalone dev.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/agent";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath,
  // Inline basePath into the client bundle so fetch("/api/...") calls
  // can prefix it (Next.js does not auto-prefix fetch, only next/link
  // and next/image).
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  serverExternalPackages: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-agent-core", "@earendil-works/pi-ai"],
  experimental: {
    // Ensure the SDK loads its ESM/CJS bits correctly on the server
  },
};

export default nextConfig;
