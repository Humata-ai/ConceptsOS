// WireGuard helpers.
//
// The gateway assigns each user a /32 inside the WG_CLIENT_SUBNET (default
// 10.10.0.0/16). .1 is the gateway itself; .2 through .254 in each /24 are
// user slots, so we skip .0/.1/.255 while iterating.

import { adminClient } from "./supabase";
import { env } from "./env";

// Very small subset of WireGuard math — we only need "next free /32 in
// the /16, skipping .0/.1/.255 in every /24, plus the row already stored
// for this user (if any)".

export async function allocateClientIp(userId: string): Promise<string> {
  const db = adminClient();

  // Already have one?
  const { data: existing } = await db
    .from("vms")
    .select("wg_client_ip")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.wg_client_ip) return existing.wg_client_ip as string;

  // Pull the whole set of taken IPs. At V1 scale (thousands) this is fine.
  const { data: taken, error } = await db.from("vms").select("wg_client_ip");
  if (error) throw new Error(`db read failed: ${error.message}`);

  const takenSet = new Set<string>();
  for (const r of taken ?? []) {
    if (r.wg_client_ip) takenSet.add(String(r.wg_client_ip));
  }

  // Parse /16 base. We only support /16 in V1.
  const [baseStr, maskStr] = env.wgClientSubnet().split("/");
  if (maskStr !== "16") {
    throw new Error(`WG_CLIENT_SUBNET must be a /16 in V1, got ${env.wgClientSubnet()}`);
  }
  const [a, b] = baseStr.split(".").map(Number);

  for (let third = 0; third <= 255; third++) {
    for (let fourth = 2; fourth <= 254; fourth++) {
      // .1 in third=0 is the gateway itself.
      if (third === 0 && fourth === 1) continue;
      const ip = `${a}.${b}.${third}.${fourth}`;
      if (!takenSet.has(ip)) return ip;
    }
  }
  throw new Error("wg address pool exhausted");
}

// Generate a random 32-byte value, base64-encoded, matching what
// `wg genpsk` outputs. Wire format: 44 chars ending in '='.
export function generatePreSharedKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // Node 20+ has Buffer, but for portability use btoa on the raw bytes.
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return typeof btoa === "function"
    ? btoa(bin)
    : Buffer.from(bytes).toString("base64");
}

export interface ClientConfig {
  privateKeyHint: string;    // never a real private key from us — see note
  address: string;           // "10.10.0.42/32"
  serverPubkey: string;
  presharedKey: string;
  endpoint: string;
  allowedIps: string;
  // Rendered .conf text with a PrivateKey placeholder the iOS app fills in.
  configTemplate: string;
}

// iOS generates its own private key and never sends it to us; we return a
// config template with `PrivateKey = <FILL_IN_ON_DEVICE>` so the iOS side
// can substitute its own key and hand the finished string to the WireGuard
// framework.
export function buildClientConfig(args: {
  clientIp: string;
  serverPubkey: string;
  presharedKey: string;
  endpoint: string;
}): ClientConfig {
  const allowedIps = env.wgClientSubnet(); // route only tunnel subnet
  const configTemplate = `[Interface]
PrivateKey = <FILL_IN_ON_DEVICE>
Address = ${args.clientIp}/32

[Peer]
PublicKey = ${args.serverPubkey}
PresharedKey = ${args.presharedKey}
Endpoint = ${args.endpoint}
AllowedIPs = ${allowedIps}
PersistentKeepalive = 25
`;
  return {
    privateKeyHint: "generated on device",
    address: `${args.clientIp}/32`,
    serverPubkey: args.serverPubkey,
    presharedKey: args.presharedKey,
    endpoint: args.endpoint,
    allowedIps,
    configTemplate,
  };
}
