// Anthropic reverse proxy.
//
// Sits at `/api/llm/v1/*` and forwards to `https://api.anthropic.com/v1/*`
// with the org's Anthropic key injected server-side.
//
// Why: user pods must not hold the org key (they're user-controlled
// userland), and Anthropic doesn't expose a create-api-key endpoint on
// the Admin API — so per-user native keys aren't possible. Instead the
// pod treats us as an Anthropic-compatible endpoint. To it:
//
//   CONCEPTSOS_BASE_URL = http://conceptsos-api.conceptsos-system.svc/api/llm
//   CONCEPTSOS_API_KEY  = <per-user key, sent as `Authorization: Bearer ...`>
//
// The pi `conceptsos-provider` extension (baked into the pod image) is
// what rewires the built-in anthropic provider to those env vars.
//
// V1 scope: plain passthrough. Per-user auth (source-pod-IP →
// vms.user_id lookup) and real-time metering (parse SSE usage deltas
// and decrement profiles.credit_usd_remaining) are TODO. In this V1 the
// route is reachable from *inside* the cluster only — the public
// Ingress only routes `/api/*` paths, and user pods reach us over the
// cluster service DNS, not via a public URL — but a user who is root
// in their own pod could still burn credits without limit. Land the
// metering layer before opening real signups.

import { env } from "@/lib/env";
import { withLogging, type LogMeta } from "@/lib/log";
import { requireApiKey } from "@/lib/authn";
import { teeAnthropicUsage } from "@/lib/anthropic-usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPSTREAM = "https://api.anthropic.com";

// Headers we forward from client → Anthropic. Everything else is stripped
// so we don't leak identifiers or accidentally pass a client-supplied
// x-api-key upstream.
const FORWARD_REQ_HEADERS = new Set([
  "content-type",
  "accept",
  "accept-encoding",
  "anthropic-version",
  "anthropic-beta",
  "anthropic-dangerous-direct-browser-access",
]);

// Headers we forward from Anthropic → client.
const FORWARD_RES_HEADERS = new Set([
  "content-type",
  "cache-control",
  "anthropic-organization-id",
  "anthropic-ratelimit-requests-limit",
  "anthropic-ratelimit-requests-remaining",
  "anthropic-ratelimit-requests-reset",
  "anthropic-ratelimit-tokens-limit",
  "anthropic-ratelimit-tokens-remaining",
  "anthropic-ratelimit-tokens-reset",
  "request-id",
  "retry-after",
]);

async function proxy(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
  log: LogMeta,
): Promise<Response> {
  // Authenticate the calling pod. On failure, return the 401 as-is.
  const auth = await requireApiKey(req, log);
  if (auth instanceof Response) return auth;

  const key = env.anthropicSharedKey();
  if (!key) {
    return new Response(
      JSON.stringify({ type: "error", error: { type: "server_error", message: "proxy_key_unset" } }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const { path } = await ctx.params;
  const url = new URL(req.url);
  const upstreamUrl = `${UPSTREAM}/v1/${path.join("/")}${url.search}`;

  const headers = new Headers();
  for (const [k, v] of req.headers) {
    if (FORWARD_REQ_HEADERS.has(k.toLowerCase())) headers.set(k, v);
  }
  headers.set("x-api-key", key);
  if (!headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");

  const init: RequestInit = {
    method: req.method,
    headers,
    // @ts-expect-error - `duplex` is required by undici/node for streaming request bodies
    duplex: "half",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
  }

  const upstream = await fetch(upstreamUrl, init);

  const outHeaders = new Headers();
  for (const [k, v] of upstream.headers) {
    if (FORWARD_RES_HEADERS.has(k.toLowerCase())) outHeaders.set(k, v);
  }

  // Tee the response body so we can extract usage tokens without
  // buffering or blocking the stream. Best-effort: if parsing fails, the
  // request still succeeds and we just log without tokens.
  const body = upstream.body ? teeAnthropicUsage(upstream.body, log) : null;

  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

const wrapped = withLogging<{ params: Promise<{ path: string[] }> }>("llm.proxy", proxy);
export const GET = wrapped;
export const POST = wrapped;
export const DELETE = wrapped;
export const PATCH = wrapped;
export const PUT = wrapped;
