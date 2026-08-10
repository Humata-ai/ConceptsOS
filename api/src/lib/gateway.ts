// Talks to the wg-gateway pod to add/remove WireGuard peers and DNAT rules.
//
// The gateway exposes a small admin HTTP surface on its ClusterIP Service
// port 8080, reachable only from within the cluster. See
// docker/wg-gateway/server.ts.

import { env } from "./env";

const GATEWAY_URL = process.env.WG_GATEWAY_URL ?? "http://wg-gateway.conceptsos-system.svc.cluster.local:8080";
const GATEWAY_TOKEN = process.env.WG_GATEWAY_TOKEN ?? "";

async function call(path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(GATEWAY_TOKEN ? { authorization: `Bearer ${GATEWAY_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`wg-gateway ${path} failed: ${res.status} ${text}`);
  }
  return res;
}

export interface UpsertPeerArgs {
  userId: string;
  wgPubkey: string;
  presharedKey: string;
  clientIp: string;       // "10.10.0.42"
  podServiceIp: string;   // ClusterIP of the user's Service
  podPort: number;        // 3000
}

export async function upsertPeer(args: UpsertPeerArgs): Promise<void> {
  await call("/peers", args);
}

export async function removePeer(userId: string): Promise<void> {
  await call("/peers/delete", { userId });
}

// The gateway advertises its own pubkey via /pubkey; used at signup so we
// can populate WG_SERVER_PUBKEY without hardcoding it in env if it wasn't
// pre-supplied.
export async function fetchGatewayPubkey(): Promise<string | null> {
  try {
    const res = await fetch(`${GATEWAY_URL}/pubkey`, {
      headers: GATEWAY_TOKEN ? { authorization: `Bearer ${GATEWAY_TOKEN}` } : undefined,
    });
    if (!res.ok) return null;
    const { pubkey } = (await res.json()) as { pubkey?: string };
    return pubkey ?? null;
  } catch {
    return null;
  }
}

// Convenience: prefer the env-configured pubkey; fall back to querying the
// gateway. This lets us bootstrap without a chicken-and-egg on first apply.
export async function serverPubkey(): Promise<string> {
  try {
    return env.wgServerPubkey();
  } catch {
    const p = await fetchGatewayPubkey();
    if (!p) throw new Error("WG_SERVER_PUBKEY unset and gateway did not answer /pubkey");
    return p;
  }
}
