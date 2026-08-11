// wg-gateway admin server.
//
// A tiny HTTP server on :8080 (cluster-internal only) that the api service
// calls to add/remove WireGuard peers and their per-user DNAT rules.
//
// Routes:
//   GET  /pubkey         -> { pubkey }
//   POST /peers          -> upsert peer + DNAT (idempotent)
//   POST /peers/delete   -> remove peer + DNAT
//   GET  /peers          -> list peers (debug)
//   GET  /health
//
// Auth: if WG_GATEWAY_TOKEN is set, requests must carry
// `Authorization: Bearer <token>`.

import http from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const exec = promisify(execFile);

const PORT = Number(process.env.PORT ?? 8080);
const TOKEN = process.env.WG_GATEWAY_TOKEN ?? "";
const SERVER_PUB = process.env.WG_SERVER_PUBKEY ?? "";
const STATE_DIR = process.env.WG_STATE_DIR ?? "/var/lib/wg-gateway";
const PEERS_FILE = path.join(STATE_DIR, "peers.json");

// In-memory state, mirrored to disk so peers survive gateway restarts.
//
// Shape: { [userId]: { userId, wgPubkey, presharedKey, clientIp,
//                      podServiceIp, podPort } }
let peers = loadPeers();

function loadPeers() {
  try {
    return JSON.parse(fs.readFileSync(PEERS_FILE, "utf8"));
  } catch {
    return {};
  }
}
function savePeers() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(PEERS_FILE, JSON.stringify(peers, null, 2), { mode: 0o600 });
}

// Re-apply all peers on boot so we recover state after a pod restart.
async function reapplyAll() {
  for (const p of Object.values(peers)) {
    try { await applyPeer(p); }
    catch (e) { console.error("[reapply]", p.userId, e.message); }
  }
}

async function applyPeer(p) {
  // 1. Configure the WireGuard peer.
  //    We stash the PSK in a temp file because `wg set` reads it from a
  //    path, not stdin.
  const pskFile = path.join(STATE_DIR, `psk-${p.userId}`);
  fs.writeFileSync(pskFile, p.presharedKey, { mode: 0o600 });
  try {
    await exec("wg", [
      "set", "wg0",
      "peer", p.wgPubkey,
      "preshared-key", pskFile,
      "allowed-ips", `${p.clientIp}/32`,
      "persistent-keepalive", "25",
    ]);
  } finally {
    try { fs.unlinkSync(pskFile); } catch {}
  }

  // 2. Add DNAT rule: source = this user's tunnel IP, ANY tcp port,
  //    forward to their pod's ClusterIP (preserving the original
  //    destination port). We match on source so each user can dial the
  //    same "gateway" address (10.10.0.1) and land in their own pod.
  //
  //    Tailscale-style magic-port routing: <gateway-ip>:PORT →
  //    <pod>:PORT for any TCP port. The k8s Service on the target must
  //    list every port that should be reachable — see ensureService() in
  //    api/src/lib/k8s.ts.
  //
  //    p.podPort is intentionally ignored here; kept in state for
  //    backward compat with older API deployments.
  await ensureIptables([
    "-t", "nat", "-A", "PREROUTING",
    "-i", "wg0",
    "-s", p.clientIp,
    "-p", "tcp",
    "-j", "DNAT", "--to-destination", p.podServiceIp,
  ]);
  // Also allow the return path via FORWARD.
  await ensureIptables([
    "-A", "FORWARD",
    "-s", p.clientIp,
    "-j", "ACCEPT",
  ]);
  await ensureIptables([
    "-A", "FORWARD",
    "-d", p.clientIp,
    "-j", "ACCEPT",
  ]);
}

async function removePeerRules(p) {
  await exec("wg", ["set", "wg0", "peer", p.wgPubkey, "remove"]).catch(() => {});
  // Match the new any-port DNAT shape.
  await deleteIptables([
    "-t", "nat", "-D", "PREROUTING",
    "-i", "wg0",
    "-s", p.clientIp,
    "-p", "tcp",
    "-j", "DNAT", "--to-destination", p.podServiceIp,
  ]);
  // Also try the legacy dport-3000/port-pinned shape in case we're
  // downgrading state that was written by the previous gateway version.
  await deleteIptables([
    "-t", "nat", "-D", "PREROUTING",
    "-i", "wg0",
    "-s", p.clientIp,
    "-p", "tcp", "--dport", "3000",
    "-j", "DNAT", "--to-destination", `${p.podServiceIp}:${p.podPort}`,
  ]);
  await deleteIptables(["-D", "FORWARD", "-s", p.clientIp, "-j", "ACCEPT"]);
  await deleteIptables(["-D", "FORWARD", "-d", p.clientIp, "-j", "ACCEPT"]);
}

// Idempotent iptables: use -C to check first, then -A if missing.
async function ensureIptables(args) {
  const checkArgs = args.slice();
  // Replace -A / -I with -C for the check.
  for (let i = 0; i < checkArgs.length; i++) {
    if (checkArgs[i] === "-A" || checkArgs[i] === "-I") { checkArgs[i] = "-C"; break; }
  }
  try {
    await exec("iptables", checkArgs);
    return; // already exists
  } catch {
    /* missing -> add */
  }
  await exec("iptables", args);
}

async function deleteIptables(args) {
  try { await exec("iptables", args); } catch { /* not present */ }
}

// -------------------------- HTTP ------------------------------------------

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error(`bad json: ${e.message}`)); }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function authed(req) {
  if (!TOKEN) return true;
  const h = req.headers.authorization ?? "";
  return h === `Bearer ${TOKEN}`;
}

const server = http.createServer(async (req, res) => {
  if (!authed(req) && req.url !== "/health") {
    return send(res, 401, { error: "unauthorized" });
  }

  try {
    if (req.method === "GET" && req.url === "/health") {
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && req.url === "/pubkey") {
      return send(res, 200, { pubkey: SERVER_PUB });
    }
    if (req.method === "GET" && req.url === "/peers") {
      return send(res, 200, { peers });
    }
    if (req.method === "POST" && req.url === "/peers") {
      const body = await readJson(req);
      const required = ["userId", "wgPubkey", "presharedKey", "clientIp", "podServiceIp", "podPort"];
      for (const k of required) {
        if (!body[k]) return send(res, 400, { error: `missing ${k}` });
      }
      // If the peer already exists with different pod IP, tear down old
      // DNAT rules first to avoid stale routes.
      const prev = peers[body.userId];
      if (prev && (prev.podServiceIp !== body.podServiceIp || prev.clientIp !== body.clientIp)) {
        await removePeerRules(prev);
      }
      peers[body.userId] = { ...body };
      savePeers();
      await applyPeer(peers[body.userId]);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/peers/delete") {
      const body = await readJson(req);
      const p = peers[body.userId];
      if (!p) return send(res, 200, { ok: true, noop: true });
      await removePeerRules(p);
      delete peers[body.userId];
      savePeers();
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "not_found" });
  } catch (e) {
    console.error("[server] error:", e);
    return send(res, 500, { error: String(e?.message ?? e) });
  }
});

reapplyAll()
  .catch((e) => console.error("[reapply] failed:", e))
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`[wg-gateway] admin listening on :${PORT} (pubkey ${SERVER_PUB.slice(0, 10)}…)`);
    });
  });
