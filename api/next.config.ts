import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The k8s client and Anthropic SDK are pure Node deps that should not be
  // bundled by Next's server compiler.
  serverExternalPackages: ["@kubernetes/client-node", "@anthropic-ai/sdk"],
  // The reconcile loop is started from an instrumentation hook (see
  // src/instrumentation.ts). Next.js gates that behind this flag on <15.1.
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
