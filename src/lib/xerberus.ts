// Server-side Xerberus risk-grade lookup. The API key NEVER leaves the server.
//
// Xerberus rates crypto TOKENS (AAA best -> D worst), like a credit agency. We
// use it to show how safe the coin a customer pays with is. It is NOT a returns
// predictor and has nothing to do with the solar ROI math.
//
// Needs XERBERUS_API_KEY + XERBERUS_USER_EMAIL. Without them this returns null
// and the UI shows nothing / "Unrated" — it degrades gracefully.

const BASE = "https://api.xerberus.io/public/v1";
const CACHE_TTL_MS = 15 * 60 * 1000;

type GradeMap = Record<string, string>;
let cache: { at: number; bySymbol: GradeMap } | null = null;

export function hasXerberus(): boolean {
  return Boolean(process.env.XERBERUS_API_KEY && process.env.XERBERUS_USER_EMAIL);
}

interface XerberusAsset {
  asset_name?: string;
  symbol?: string;
  risk_category?: string;
  risk_rating?: string;
}

/** Fetch + cache the full Ethereum asset list, indexed by uppercase symbol. */
async function loadGrades(): Promise<GradeMap> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.bySymbol;

  const res = await fetch(`${BASE}/risk/ethereum`, {
    headers: {
      "x-api-key": process.env.XERBERUS_API_KEY as string,
      "x-user-email": process.env.XERBERUS_USER_EMAIL as string,
    },
  });
  if (!res.ok) throw new Error(`Xerberus responded ${res.status}`);

  const data = (await res.json()) as { data?: XerberusAsset[] };
  const list = Array.isArray(data?.data) ? data.data : [];
  const bySymbol: GradeMap = {};
  for (const a of list) {
    const sym = (a.asset_name || a.symbol || "").toUpperCase();
    const grade = a.risk_category || a.risk_rating;
    if (sym && grade) bySymbol[sym] = grade;
  }
  cache = { at: Date.now(), bySymbol };
  return bySymbol;
}

/** AAA–D grade for a token symbol, or null when unrated / unavailable. */
export async function getTokenGrade(symbol: string): Promise<string | null> {
  if (!hasXerberus()) return null;
  try {
    const map = await loadGrades();
    return map[symbol.toUpperCase()] ?? null;
  } catch (err) {
    console.error("Xerberus lookup failed", err);
    return null;
  }
}
