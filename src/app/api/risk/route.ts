// Investment-risk endpoint — the Clean-Connect Pool's three-concept risk view,
// powered by the Xerberus V7 MCP server-side (key never reaches the browser).
// Always returns a complete assessment; falls back to bundled fixtures offline.

import { NextResponse } from "next/server";
import { buildRiskAssessment } from "@/lib/risk";
import { diagnose } from "@/lib/xerberusMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  // /api/risk?debug=1 — surfaces what the MCP handshake sees from THIS runtime.
  if (url.searchParams.get("debug") === "1") {
    return NextResponse.json(await diagnose(), { headers: { "Cache-Control": "no-store" } });
  }
  const raw = Number(url.searchParams.get("size"));
  const size = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 50_000_000) : 100_000;
  try {
    const assessment = await buildRiskAssessment(size);
    return NextResponse.json(assessment, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (err) {
    console.error("risk assessment failed", err);
    return NextResponse.json({ error: "risk_unavailable" }, { status: 503 });
  }
}
