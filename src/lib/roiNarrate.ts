// Optional Claude narration for the ROI analysis.
//
// Claude ONLY explains the numbers the deterministic engine (roi.ts) already
// computed — it never produces, recomputes, or inflates a figure, and it is
// forbidden from any guarantee language. Returns null when no ANTHROPIC_API_KEY
// is set or the call fails, so the feature degrades to numbers-only gracefully.

import Anthropic from "@anthropic-ai/sdk";
import type { PropertySignals, RoiAnalysis } from "./types";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

export function hasClaude(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM = `You are GridPath's clean-energy ROI explainer. You are given a FULLY COMPUTED ROI analysis for one property and must write a short, plain-language explanation of what it means and how risky/robust it is.

HARD RULES:
- Use ONLY the numbers provided. Never invent, recompute, round differently, or state a figure that is not in the input. If a value is null, say it does not pay back within the horizon.
- This is an ESTIMATE under assumptions. Never state or imply that any outcome is certain, guaranteed, assured, risk-free, or that the homeowner WILL save or earn a specific amount. Avoid second-person promissory phrasing ("you will save", "you'll earn", "certain to pay back", "no downside", "definitely", "always pays off"). Use conditional language instead: "under these assumptions", "estimated", "if utility rates rise as modeled".
- Frame the IRR/NPV as an "estimated equivalent annual return / value if assumptions hold" — never as a guaranteed or expected yield.
- Explicitly acknowledge the main uncertainty: the payback/return depends on electricity prices, weather, usage, equipment lifetime, and policy (ITC/NEM) — and show that the sensitivity range already reflects this.
- 3–5 sentences, tight and honest. No hype, no emoji, no markdown headers.`;

// Defense-in-depth: if the model slips a promissory/guarantee phrase past the
// prompt, drop the narration entirely rather than show it.
const BANNED = [
  /guarantee/i,
  /risk[-\s]?free/i,
  /\bno\s+risk\b/i,
  /\bno\s+downside\b/i,
  /\bassured\b/i,
  /\bprofit\s+you\s+will\b/i,
  /\byou\s*('ll|\s+will)\s+(save|earn|make|get|profit)/i,
  /\bdefinitely\b/i,
  /\balways\s+pays?\s+off\b/i,
];

function isCompliant(text: string): boolean {
  return !BANNED.some((re) => re.test(text));
}

/**
 * Returns a plain-language paragraph explaining the ROI, or null to fall back to
 * numbers only. Never throws.
 */
export async function roiNarrate(
  roi: RoiAnalysis,
  signals: PropertySignals
): Promise<string | null> {
  if (!hasClaude()) return null;

  const client = new Anthropic();
  const facts = {
    option: roi.optionName,
    region: signals.region,
    netCost: roi.netCost,
    firstYearSavings: roi.firstYearSavings,
    simplePaybackYears: roi.simplePaybackYears,
    discountedPaybackYears: roi.discountedPaybackYears,
    lifetimeNetSavings: roi.lifetimeNetSavings,
    npv: roi.npv,
    estimatedAnnualReturnPct: roi.irrPct,
    analysisYears: roi.analysisYears,
    assumptions: roi.assumptions,
    sensitivity: roi.sensitivity,
    confidence: roi.confidence,
    dataSource: signals.fromSolarApi
      ? "Google Solar API roof data for this address"
      : "regional estimates",
  };

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Computed ROI analysis (JSON — use these exact numbers only):\n${JSON.stringify(
            facts,
            null,
            2
          )}\n\nWrite the 3–5 sentence explanation.`,
        },
      ],
    } as Anthropic.MessageCreateParamsNonStreaming);

    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return null;
    const out = text.text.trim();
    if (!out || !isCompliant(out)) return null; // numbers-only fallback
    return out;
  } catch (err) {
    console.error("ROI narration failed; showing numbers only.", err);
    return null;
  }
}
