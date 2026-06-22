// Refresh the committed Xerberus snapshot served by /api/risk on Vercel.
//
// WHY: mcp.xerberus.io is behind a Cloudflare JS challenge that 403s datacenter
// egress (Vercel's serverless IPs), so the deployed site can't call the MCP live.
// This script runs from a machine that CAN reach the MCP (your laptop), pulls the
// real grades / exit depth / scenario library, and writes src/lib/xerberus-snapshot.json.
//
// Usage:  npm run snapshot      (needs XERBERUS_MCP_KEY in .env.local or the env)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// --- minimal .env.local loader (no dep) ---
try {
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env.local — rely on real env */
}

const KEY = process.env.XERBERUS_MCP_KEY;
const URL = process.env.XERBERUS_MCP_URL || "https://mcp.xerberus.io/enterprise/mcp";
if (!KEY) {
  console.error("✗ XERBERUS_MCP_KEY not set (.env.local or env). Aborting.");
  process.exit(1);
}

const HEADERS = {
  "x-api-key": KEY,
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
};

function parseSse(body) {
  for (const line of body.split("\n")) {
    const s = line.trim();
    if (s.startsWith("data:")) {
      const p = s.slice(5).trim();
      if (p[0] === "{") { try { return JSON.parse(p); } catch {} }
    }
  }
  return null;
}

async function call(tool, args) {
  const init = await fetch(URL, {
    method: "POST", headers: HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "snapshot", version: "1" } } }),
  });
  if (!init.ok) throw new Error(`initialize ${init.status} (Cloudflare block? run from a non-datacenter network)`);
  const sid = init.headers.get("mcp-session-id");
  await init.text();
  const h = sid ? { ...HEADERS, "mcp-session-id": sid } : HEADERS;
  await fetch(URL, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  const res = await fetch(URL, { method: "POST", headers: h,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }) });
  const msg = parseSse(await res.text());
  const text = msg?.result?.content?.find((c) => c.type === "text")?.text;
  return text ? JSON.parse(text) : null;
}

const snap = { _comment: "REAL Xerberus V7 data — refresh with `npm run snapshot`.", capturedAt: null, window: null, tokens: {}, exit: {}, episodes: [] };

for (const sym of ["USDC", "rETH", "DAI", "wstETH"]) {
  const d = await call("rate_token", { token: sym });
  if (d?.rating) {
    snap.tokens[sym] = { grade: d.rating, percentile: d.riskiness_percentile ?? null, description: d.description ?? null };
    snap.window = d.window ?? snap.window;
  }
  console.log(`  ${sym} → ${d?.rating ?? "—"}`);
}

const e = await call("hypothetical_position", { collateral_token: "rETH", collateral_usd: 20000 });
snap.exit.rETH = { maxSalePerDayUsd: e?.unwind?.max_sale_per_day_usd ?? null, refClassification: e?.exit_classification ?? null };

const lib = await call("scenario_library", {});
for (const ep of lib?.episodes ?? []) {
  if (ep.shock_basket_pct_drops && Object.keys(ep.shock_basket_pct_drops).length) {
    snap.episodes.push({ id: ep.id, label: ep.label, kind: ep.kind ?? "", period: ep.period ?? "", basket: ep.shock_basket_pct_drops });
  }
}

snap.capturedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const out = join(root, "src/lib/xerberus-snapshot.json");
writeFileSync(out, JSON.stringify(snap, null, 2) + "\n");
console.log(`✓ wrote ${out}  (window ${snap.window}, ${snap.episodes.length} episodes)`);
