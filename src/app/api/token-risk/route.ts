// Proxy for the Xerberus token risk grade so the API key stays server-side.

import { NextResponse } from "next/server";
import { getTokenGrade } from "@/lib/xerberus";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol") || "USDC";
  const grade = await getTokenGrade(symbol);
  return NextResponse.json(
    { symbol: symbol.toUpperCase(), grade },
    { headers: { "Cache-Control": "public, max-age=900" } }
  );
}
