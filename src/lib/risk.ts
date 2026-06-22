// Investment-risk assembly for the Clean-Connect Pool — the financial-risk layer
// that complements the physical connection estimate.
//
// THE STORY: a normal utility bill carries ~zero financial risk. The moment a
// clean-energy connection is FINANCED on-chain (an investor pool settling in
// stablecoins + staking yield), it inherits price / liquidity / depeg risk. This
// module quantifies that, three ways, every number traceable to a source:
//
//   A. Clean-Connect Pool   — a backing basket of REAL Xerberus-rated instruments
//                             -> a blended AAA–D grade + a liquidity exit clock.
//   B. Green Energy Risk     — normal grid vs each on-chain green option, graded.
//   C. Crisis replay         — Xerberus's real historical shock baskets applied
//                             to the pool with transparent local math.
//
// Live data comes from the Xerberus V7 MCP (src/lib/xerberusMcp.ts). Every field
// degrades to a bundled fixture so a live pitch never dies on a flaky API — the
// same "demo insurance" philosophy as the Overpass client.

import {
  hasXerberusMcp,
  hypotheticalExit,
  rateToken,
  scenarioLibrary,
  type McpEpisode,
} from "@/lib/xerberusMcp";
import snapshot from "@/lib/xerberus-snapshot.json";

// ---- Types ----

export interface PoolComponent {
  symbol: string;
  label: string;
  /** Allocation weight 0..1. */
  weight: number;
  /** Real Xerberus grade (AAA–D). */
  grade: string;
  /** Riskiness percentile 0..1 (higher = riskier). */
  percentile: number;
}

export interface PoolExit {
  /** Notional of the (illiquid) green-staking sleeve priced for the clock. */
  sleeveUsd: number;
  maxSalePerDayUsd: number;
  daysToExit: number;
  classification: string;
}

export interface InvestmentPool {
  sizeUsd: number;
  components: PoolComponent[];
  blendedGrade: string;
  blendedPercentile: number;
  exit: PoolExit;
}

export interface ComparisonRow {
  option: string;
  detail: string;
  onChain: boolean;
  grade: string | null;
  percentile: number | null;
  note: string;
}

export interface StressEpisode {
  id: string;
  label: string;
  period: string;
  kind: string;
  /** Modeled pool loss for this episode, % of NAV. */
  poolLossPct: number;
  /** The shock basket that produced it (symbol -> % drop). */
  basket: Record<string, number>;
}

export interface RiskAssessment {
  pool: InvestmentPool;
  comparison: ComparisonRow[];
  stress: StressEpisode[];
  /** "live" = per-request Xerberus call; "snapshot" = committed real Xerberus data. */
  source: "live" | "snapshot";
  /** When the served snapshot was captured from the MCP (ISO). */
  snapshotAt: string;
  /** The Xerberus 12h data window the snapshot reflects. */
  window: string;
  generatedAt: string;
}

// ---- The Clean-Connect Pool definition ----
//
// 70% stable rail + 20% green proof-of-stake yield + 10% stable rail. The
// staking sleeve is the green-yield engine AND the risk/illiquidity it carries.

const POOL = [
  { symbol: "USDC", label: "USD Coin — stable settlement rail", weight: 0.7 },
  { symbol: "rETH", label: "Rocket Pool ETH — green staking yield", weight: 0.2 },
  { symbol: "DAI", label: "Dai — stable settlement rail", weight: 0.1 },
];

const STAKING_SLEEVE = "rETH"; // the illiquid sleeve we price the exit clock on

// REAL Xerberus data, captured from the live MCP (src/lib/xerberus-snapshot.json,
// refreshed by `npm run snapshot`). Served whenever a per-request live call can't
// reach the MCP — which on Vercel is always, because mcp.xerberus.io is behind a
// Cloudflare JS challenge that 403s datacenter egress. NOT invented numbers: the
// same grades / exit depth / scenario baskets the live API returns, just dated.
const SNAP_GRADES: Record<string, { grade: string; percentile: number }> =
  Object.fromEntries(
    Object.entries(snapshot.tokens).map(([sym, v]) => [
      sym,
      { grade: v.grade, percentile: typeof v.percentile === "number" ? v.percentile : 0.5 },
    ])
  );

const SNAP_EPISODES: McpEpisode[] = snapshot.episodes.map((e) => ({
  id: e.id,
  label: e.label,
  kind: e.kind,
  period: e.period,
  basket: e.basket as unknown as Record<string, number>,
}));

const SNAP_PERDAY = snapshot.exit?.rETH?.maxSalePerDayUsd ?? 6060.67;

// ---- Pure helpers (transparent math — never an LLM) ----

/**
 * Approximate AAA–D band for a BLENDED percentile. Components always carry their
 * exact Xerberus grade; this banding is only used for the pool composite, which
 * has no canonical single grade. Monotonic and disclosed as an approximation.
 */
export function gradeFromPercentile(p: number): string {
  if (p < 0.1) return "AAA";
  if (p < 0.3) return "AA";
  if (p < 0.5) return "A";
  if (p < 0.68) return "BBB";
  if (p < 0.82) return "BB";
  if (p < 0.92) return "B";
  if (p < 0.97) return "CCC";
  if (p < 0.995) return "CC";
  return "D";
}

/** Allocation-weighted percentile across the pool's components. */
function blendPercentile(components: PoolComponent[]): number {
  const total = components.reduce((s, c) => s + c.weight, 0) || 1;
  return components.reduce((s, c) => s + c.weight * c.percentile, 0) / total;
}

/**
 * Model a pool's NAV loss under a historical shock basket. Each pool component is
 * matched to the basket's drop for its symbol; the green-staking sleeve (rETH)
 * proxies onto the basket's wstETH/WETH leg (both are ETH-staking beta). Loss is
 * the allocation-weighted sum of drops — explainable, no black box.
 */
function poolLossUnder(
  basket: Record<string, number>,
  components: PoolComponent[]
): number {
  let loss = 0;
  for (const c of components) {
    let drop = basket[c.symbol] ?? 0;
    if (!drop && c.symbol === STAKING_SLEEVE) {
      drop = basket.wstETH ?? basket.stETH ?? basket.WETH ?? 0;
    }
    loss += c.weight * drop;
  }
  return Math.round(loss * 100) / 100;
}

// ---- Assembly ----

/** Resolve a component's grade+percentile, live first then fixture. */
async function gradeFor(symbol: string, live: boolean) {
  if (live) {
    const r = await rateToken(symbol);
    if (r && r.percentile != null) {
      return { grade: r.rating, percentile: r.percentile, live: true };
    }
  }
  const f = SNAP_GRADES[symbol] ?? { grade: "NR", percentile: 0.5 };
  return { ...f, live: false };
}

/**
 * Build the full three-concept risk assessment for a pool of `sizeUsd`.
 * Always returns a complete object; `source` flags how much came live.
 */
export async function buildRiskAssessment(sizeUsd = 100_000): Promise<RiskAssessment> {
  const live = hasXerberusMcp();
  let anyLive = false;
  let anySnapshot = false;

  // --- A. Pool components + blended grade ---
  const components: PoolComponent[] = [];
  for (const p of POOL) {
    const g = await gradeFor(p.symbol, live);
    g.live ? (anyLive = true) : (anySnapshot = true);
    components.push({ symbol: p.symbol, label: p.label, weight: p.weight, grade: g.grade, percentile: g.percentile });
  }
  const blendedPercentile = blendPercentile(components);

  // --- A. Exit clock on the green-staking sleeve ---
  const sleeveUsd = Math.round(sizeUsd * (POOL.find((p) => p.symbol === STAKING_SLEEVE)?.weight ?? 0.2));
  let exit: PoolExit | null = live ? await prefixedExit(STAKING_SLEEVE, sleeveUsd) : null;
  if (exit) anyLive = true;
  else {
    anySnapshot = true;
    // Real rETH exit depth from the snapshot; days scale with the sleeve notional.
    const perDay = SNAP_PERDAY;
    const days = Math.round((sleeveUsd / perDay) * 10) / 10;
    exit = {
      sleeveUsd,
      maxSalePerDayUsd: perDay,
      daysToExit: days,
      classification: days > 30 ? "illiquid (<1 month)" : days > 7 ? "exit in weeks" : "exit in days",
    };
  }

  // --- B. Green Energy Risk comparison ---
  const wsteth = await gradeFor("wstETH", live);
  wsteth.live ? (anyLive = true) : (anySnapshot = true);
  const usdc = components.find((c) => c.symbol === "USDC")!;
  const reth = components.find((c) => c.symbol === "rETH")!;
  const comparison: ComparisonRow[] = [
    {
      option: "Normal grid electricity",
      detail: "Regulated utility tariff",
      onChain: false,
      grade: null,
      percentile: null,
      note: "Baseline — a fixed bill, no market, liquidity or depeg risk.",
    },
    {
      option: "Stablecoin rail",
      detail: "USDC — pool settlement currency",
      onChain: true,
      grade: usdc.grade,
      percentile: usdc.percentile,
      note: "Looks risk-free; it carries elevated systemic risk-flow.",
    },
    {
      option: "Green staking yield",
      detail: "rETH — Rocket Pool ETH",
      onChain: true,
      grade: reth.grade,
      percentile: reth.percentile,
      note: "Clean low-energy yield — but very high relative risk.",
    },
    {
      option: "Liquid staking",
      detail: "wstETH — Lido",
      onChain: true,
      grade: wsteth.grade,
      percentile: wsteth.percentile,
      note: "The largest 'green' yield token rates distressed.",
    },
    {
      option: "Clean-Connect Pool",
      detail: "Blended GridPath basket",
      onChain: true,
      grade: gradeFromPercentile(blendedPercentile),
      percentile: blendedPercentile,
      note: "Diversification pulls the blended grade up from its CCC sleeve.",
    },
  ];

  // --- C. Crisis replay against the pool ---
  let episodes = live ? await scenarioLibrary() : null;
  if (episodes && episodes.length) anyLive = true;
  else {
    anySnapshot = true;
    episodes = SNAP_EPISODES;
  }
  const stress: StressEpisode[] = episodes
    .map((e) => ({
      id: e.id,
      label: e.label,
      period: e.period,
      kind: e.kind,
      basket: e.basket,
      poolLossPct: poolLossUnder(e.basket, components),
    }))
    .filter((e) => e.poolLossPct > 0)
    .sort((a, b) => b.poolLossPct - a.poolLossPct)
    .slice(0, 5);

  // "live" only if EVERY field came from a per-request call; any snapshot fill
  // (always, on Vercel) means we honestly label it as the dated snapshot.
  const source: RiskAssessment["source"] = anyLive && !anySnapshot ? "live" : "snapshot";

  return {
    pool: {
      sizeUsd,
      components,
      blendedGrade: gradeFromPercentile(blendedPercentile),
      blendedPercentile,
      exit,
    },
    comparison,
    stress,
    source,
    snapshotAt: snapshot.capturedAt,
    window: snapshot.window,
    generatedAt: new Date().toISOString(),
  };
}

/** hypotheticalExit wrapper kept separate so the main flow reads cleanly. */
async function prefixedExit(symbol: string, usd: number): Promise<PoolExit | null> {
  const e = await hypotheticalExit(symbol, usd);
  if (!e) return null;
  return {
    sleeveUsd: usd,
    maxSalePerDayUsd: e.maxSalePerDayUsd,
    daysToExit: Math.round(e.daysToExit * 10) / 10,
    classification: e.classification,
  };
}
