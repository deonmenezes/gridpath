// Verify a payment against the blockchain — never trusting the client's claim of
// what was paid. Re-derives recipient, token, amount, chain, and confirmations
// from our own RPC, then marks the order paid exactly once (replay-safe).

import { NextResponse } from "next/server";
import { erc20Abi, parseEventLogs } from "viem";
import { getOrder, markOrderPaidOnce } from "@/lib/payments/db";
import { publicClientFor } from "@/lib/payments/server";
import { USDC, MERCHANT, MIN_CONFIRMATIONS, isSupportedChain } from "@/lib/payments/tokens";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { orderId?: string; txHash?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { orderId, txHash } = body;
  if (typeof orderId !== "string" || typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "orderId and a valid txHash are required" }, { status: 400 });
  }

  const order = await getOrder(orderId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.status === "paid") return NextResponse.json({ ok: true, status: "paid" });
  if (!isSupportedChain(order.chainId)) {
    return NextResponse.json({ error: "Unsupported chain" }, { status: 400 });
  }

  const client = publicClientFor(order.chainId);
  const hash = txHash as `0x${string}`;

  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) return NextResponse.json({ status: "pending" }, { status: 202 });
  if (receipt.status !== "success") {
    return NextResponse.json({ ok: false, reason: "Transaction reverted" }, { status: 400 });
  }

  const confirmations = await client.getTransactionConfirmations({ hash });
  if (confirmations < BigInt(MIN_CONFIRMATIONS[order.chainId])) {
    return NextResponse.json(
      { status: "pending", confirmations: Number(confirmations) },
      { status: 202 }
    );
  }

  // Match a USDC Transfer to the merchant for the EXACT expected amount, on the
  // canonical token contract only (blocks fake/bridged tokens).
  const token = USDC[order.chainId].toLowerCase();
  const logs = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs });
  const matched = logs.some(
    (l) =>
      l.address.toLowerCase() === token &&
      l.args.to?.toLowerCase() === MERCHANT.toLowerCase() &&
      l.args.value === BigInt(order.expectedAmount)
  );
  if (!matched) {
    return NextResponse.json(
      { ok: false, reason: "No matching USDC payment found in this transaction" },
      { status: 400 }
    );
  }

  const settled = await markOrderPaidOnce(order.orderId, order.chainId, hash);
  if (!settled) {
    return NextResponse.json({ ok: false, reason: "Already settled" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, status: "paid" });
}
