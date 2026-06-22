// Create a server-bound payment quote. The SERVER decides the recipient and the
// exact on-chain amount; the client is never trusted to set them. Stored before
// the user pays so a tx can only ever settle the order it was quoted for.

import { NextResponse } from "next/server";
import { parseUnits } from "viem";
import {
  MERCHANT,
  USDC,
  USDC_DECIMALS,
  QUOTE_TTL_MS,
  isSupportedChain,
} from "@/lib/payments/tokens";
import { createOrder } from "@/lib/payments/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { amountUsd?: number; chainId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { amountUsd, chainId } = body;
  if (typeof amountUsd !== "number" || !(amountUsd > 0) || amountUsd > 1_000_000) {
    return NextResponse.json({ error: "amountUsd is invalid" }, { status: 400 });
  }
  if (typeof chainId !== "number" || !isSupportedChain(chainId)) {
    return NextResponse.json({ error: "Unsupported chain" }, { status: 400 });
  }

  // USDC is priced 1:1 with USD; convert to 6-decimal base units.
  const expectedAmount = parseUnits(amountUsd.toFixed(USDC_DECIMALS), USDC_DECIMALS).toString();
  const orderId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);

  try {
    await createOrder({
      orderId,
      amountUsd,
      asset: "USDC",
      chainId,
      recipient: MERCHANT,
      expectedAmount,
      expiresAt,
    });
  } catch (err) {
    console.error("quote create failed (DB not connected?)", err);
    return NextResponse.json(
      { error: "Payments aren't fully configured yet. Try again shortly." },
      { status: 503 }
    );
  }

  return NextResponse.json({
    orderId,
    recipient: MERCHANT,
    chainId,
    asset: "USDC",
    token: USDC[chainId],
    expectedAmount,
    amountUsd,
    expiresAt: expiresAt.toISOString(),
  });
}
