// Clean-energy advisor endpoint: address + point -> ranked clean-energy plan.
// Pipeline: Google Solar API (optional) -> grounded signals -> Claude (optional)
// -> deterministic fallback. Always returns a usable plan.

import { NextResponse } from "next/server";
import { buildSignals, fallbackPlan } from "@/lib/cleanenergy";
import { fetchSolar } from "@/lib/google";
import { recommendWithClaude } from "@/lib/claude";
import { buildRoi, isSolarOption } from "@/lib/roi";
import { roiNarrate } from "@/lib/roiNarrate";

interface RecommendRequest {
  address?: string;
  lat?: number;
  lon?: number;
}

export async function POST(request: Request) {
  let body: RecommendRequest;
  try {
    body = (await request.json()) as RecommendRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { address, lat, lon } = body;
  if (!address || typeof lat !== "number" || typeof lon !== "number") {
    return NextResponse.json(
      { error: "address, lat, and lon are required" },
      { status: 400 }
    );
  }

  try {
    const solar = await fetchSolar(lat, lon); // null without a Google key/coverage
    const signals = buildSignals(address, solar);

    const claudePlan = await recommendWithClaude(signals);
    const plan = claudePlan ?? fallbackPlan(signals);

    // "Is going solar worth it?" — compute the ROI deterministically from the
    // recommended solar option (never from the LLM). Match by solar key/name so
    // an LLM-renamed key (e.g. "solar") still resolves; only then fall back to
    // the top-priority recommended option.
    const solarOption =
      plan.options.find(isSolarOption) ??
      [...plan.options]
        .filter((o) => o.recommended)
        .sort((a, b) => a.priority - b.priority)[0];

    if (solarOption) {
      const roi = buildRoi(solarOption, signals);
      // Optional plain-language framing; null without an Anthropic key.
      roi.narrative = await roiNarrate(roi, signals);
      plan.roi = roi;
    }

    return NextResponse.json(plan);
  } catch (err) {
    console.error("recommend failed", err);
    return NextResponse.json({ error: "Failed to build plan." }, { status: 500 });
  }
}
