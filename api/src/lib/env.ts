// Centralized env-var access with fail-fast validation on server boot.
//
// We intentionally do NOT use zod's env parser here so that dev tooling
// (`next build` in CI, `next dev` without k8s creds) can still work with
// partial env — only the code path that actually needs a var will throw.

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export const env = {
  // --- Supabase ------------------------------------------------------------
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseAnonKey: () => required("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),

  // --- Anthropic -----------------------------------------------------------
  // Shared org key used by the LLM reverse proxy (`/api/llm/v1/*`).
  // User pods never see this — they call the proxy, which injects it.
  anthropicSharedKey: () => optional("ANTHROPIC_API_KEY"),

  // --- WireGuard gateway ---------------------------------------------------
  // These are populated at deploy time from the wg-gateway ConfigMap /
  // Secret. The controller needs them to build the client config it hands
  // back to iOS at signup.
  wgServerPubkey:  () => required("WG_SERVER_PUBKEY"),
  wgEndpoint:      () => required("WG_ENDPOINT"), // "api.conceptsos.com:51820"
  // The /16 we hand out client tunnel IPs from. First host (10.10.0.1) is
  // the gateway itself.
  wgClientSubnet:  () => process.env.WG_CLIENT_SUBNET ?? "10.10.0.0/16",

  // --- Kubernetes ----------------------------------------------------------
  k8sUsersNamespace: () => process.env.K8S_USERS_NAMESPACE ?? "users",
  userPodImage:      () => required("USER_POD_IMAGE"), // e.g. us-central1-docker.pkg.dev/conceptsos-prd/conceptsos/vm:latest
  userPodStorageGb:  () => Number(process.env.USER_POD_STORAGE_GB ?? "10"),

  // --- Reconcile loop ------------------------------------------------------
  reconcileEnabled:      () => process.env.RECONCILE_ENABLED !== "false",
  reconcileIntervalMs:   () => Number(process.env.RECONCILE_INTERVAL_MS ?? "5000"),

  // --- Misc ----------------------------------------------------------------
  nodeEnv: () => process.env.NODE_ENV ?? "development",
};

export function isProd(): boolean {
  return env.nodeEnv() === "production";
}
