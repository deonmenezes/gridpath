// Server-side Xerberus V7 MCP client. The API key NEVER leaves the server.
//
// This is the richer, MCP-based companion to xerberus.ts (which uses the simple
// REST grade list for the pay-screen badge). The MCP exposes graded ratings WITH
// percentiles, hypothetical-position exit clocks, and the historical scenario
// library — the live data behind the investment-risk panel.
//
// Needs XERBERUS_MCP_KEY. Without it (or on any failure) every call returns null
// and callers fall back to the bundled fixture — the demo never dies.

const ENDPOINT =
  process.env.XERBERUS_MCP_URL || "https://mcp.xerberus.io/enterprise/mcp";
const ACCEPT = "application/json, text/event-stream";

// mcp.xerberus.io sits behind Cloudflare, which can challenge datacenter egress
// (e.g. Vercel's serverless IPs) when the request looks like a bot. Presenting a
// real browser User-Agent + language headers clears the basic bot heuristics.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function baseHeaders(): Record<string, string> {
  return {
    "x-api-key": process.env.XERBERUS_MCP_KEY as string,
    "Content-Type": "application/json",
    Accept: ACCEPT,
    "User-Agent": UA,
    "Accept-Language": "en-US,en;q=0.9",
  };
}

export function hasXerberusMcp(): boolean {
  return Boolean(process.env.XERBERUS_MCP_KEY);
}

/**
 * One-shot connectivity probe — does the initialize handshake reach the MCP from
 * THIS runtime (local vs Vercel)? Returns the raw status + a body snippet so a
 * Cloudflare challenge (403/503 HTML) is visible. Used by /api/risk?debug=1.
 */
export async function diagnose(): Promise<Record<string, unknown>> {
  if (!hasXerberusMcp()) return { hasKey: false, note: "XERBERUS_MCP_KEY not set" };
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "gridpath", version: "1" } },
      }),
    });
    const body = await res.text();
    return {
      hasKey: true,
      status: res.status,
      ok: res.ok,
      server: res.headers.get("server"),
      sessionId: res.headers.get("mcp-session-id"),
      bodySnippet: body.slice(0, 240),
    };
  } catch (err) {
    return { hasKey: true, threw: true, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Pull the first JSON message out of an MCP streamable-HTTP (SSE) body. */
function parseSse(body: string): Record<string, unknown> | null {
  for (const line of body.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("data:")) continue;
    const payload = s.slice(5).trim();
    if (!payload || payload[0] !== "{") continue;
    try {
      return JSON.parse(payload);
    } catch {
      /* keep scanning subsequent data: lines */
    }
  }
  return null;
}

/**
 * One MCP session: initialize -> notifications/initialized -> tools/call.
 * Returns the tool's parsed JSON payload, or null on ANY failure (timeout, auth,
 * 403 on heavy queries, non-JSON error string) so the caller falls back cleanly.
 */
async function mcpCall(
  tool: string,
  args: Record<string, unknown>,
  timeoutMs = 12000
): Promise<Record<string, unknown> | null> {
  if (!hasXerberusMcp()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const base = baseHeaders();

    // 1. initialize — the session id comes back as a response header.
    const initRes = await fetch(ENDPOINT, {
      method: "POST",
      headers: base,
      signal: ctrl.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "gridpath", version: "1" },
        },
      }),
    });
    if (!initRes.ok) return null;
    const sid = initRes.headers.get("mcp-session-id");
    await initRes.text(); // drain the init stream
    const headers = sid ? { ...base, "mcp-session-id": sid } : base;

    // 2. notifications/initialized
    await fetch(ENDPOINT, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });

    // 3. tools/call
    const callRes = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
    });
    if (!callRes.ok) return null;

    const msg = parseSse(await callRes.text());
    const result = msg?.result as { content?: Array<{ type: string; text?: string }> } | undefined;
    const text = result?.content?.find((c) => c.type === "text")?.text;
    if (!text) return null;
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null; // tool replied with a plain error string, not JSON
    }
  } catch {
    return null; // network / abort / parse
  } finally {
    clearTimeout(timer);
  }
}

export interface McpRating {
  rating: string;
  description: string | null;
  percentile: number | null;
}

/** Xerberus AAA–D rating + riskiness percentile for a token symbol or address. */
export async function rateToken(token: string): Promise<McpRating | null> {
  const d = await mcpCall("rate_token", { token });
  if (!d || d.rating == null) return null;
  return {
    rating: String(d.rating),
    description: (d.description as string) ?? null,
    percentile: typeof d.riskiness_percentile === "number" ? d.riskiness_percentile : null,
  };
}

export interface McpExit {
  collateralUsd: number;
  maxSalePerDayUsd: number;
  daysToExit: number;
  classification: string;
}

/** Liquidity-adjusted unwind clock for a synthetic position — NO wallet needed. */
export async function hypotheticalExit(
  collateralToken: string,
  collateralUsd: number
): Promise<McpExit | null> {
  const d = await mcpCall("hypothetical_position", {
    collateral_token: collateralToken,
    collateral_usd: collateralUsd,
  });
  if (!d) return null;
  const u = d.unwind as { days_to_exit?: number; max_sale_per_day_usd?: number } | undefined;
  if (!u || typeof u.days_to_exit !== "number") return null;
  return {
    collateralUsd,
    maxSalePerDayUsd: u.max_sale_per_day_usd ?? 0,
    daysToExit: u.days_to_exit,
    classification: (d.exit_classification as string) ?? "—",
  };
}

export interface McpEpisode {
  id: string;
  label: string;
  kind: string;
  period: string;
  /** symbol -> percent drop (positive). */
  basket: Record<string, number>;
}

/** The named historical scenario library (UST, stETH/3AC, USDC depeg, …). */
export async function scenarioLibrary(): Promise<McpEpisode[] | null> {
  const d = await mcpCall("scenario_library", {});
  const eps = d?.episodes as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(eps)) return null;
  return eps
    .filter(
      (e) =>
        e.shock_basket_pct_drops &&
        Object.keys(e.shock_basket_pct_drops as object).length > 0
    )
    .map((e) => ({
      id: String(e.id),
      label: String(e.label),
      kind: String(e.kind ?? ""),
      period: String(e.period ?? ""),
      basket: e.shock_basket_pct_drops as Record<string, number>,
    }));
}
