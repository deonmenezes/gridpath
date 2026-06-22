// Order + quote persistence for crypto payments (Vercel Postgres / Neon).
//
// The DB is what makes payments replay-safe: a quote is bound to an order BEFORE
// the user pays, and a UNIQUE(chain_id, tx_hash) constraint guarantees one
// on-chain payment can satisfy at most one order. Requires POSTGRES_URL (set
// automatically when the Neon integration is connected on Vercel).

import { sql } from "@vercel/postgres";
import type { SupportedChainId } from "./tokens";

export interface PaymentOrder {
  orderId: string;
  amountUsd: number;
  asset: string;
  chainId: SupportedChainId;
  recipient: string;
  /** Exact on-chain amount expected, in the token's smallest unit, as a string. */
  expectedAmount: string;
  status: "pending" | "paid";
  txHash: string | null;
  expiresAt: string;
}

let schemaReady: Promise<void> | null = null;

/** Lazily create the table once per process. */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = sql`
      CREATE TABLE IF NOT EXISTS payment_orders (
        order_id        TEXT PRIMARY KEY,
        amount_usd      NUMERIC NOT NULL,
        asset           TEXT NOT NULL,
        chain_id        INTEGER NOT NULL,
        recipient       TEXT NOT NULL,
        expected_amount TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        tx_hash         TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at      TIMESTAMPTZ NOT NULL,
        paid_at         TIMESTAMPTZ,
        UNIQUE (chain_id, tx_hash)
      );
    `.then(() => undefined);
  }
  return schemaReady;
}

export async function createOrder(order: {
  orderId: string;
  amountUsd: number;
  asset: string;
  chainId: SupportedChainId;
  recipient: string;
  expectedAmount: string;
  expiresAt: Date;
}): Promise<void> {
  await ensureSchema();
  await sql`
    INSERT INTO payment_orders
      (order_id, amount_usd, asset, chain_id, recipient, expected_amount, expires_at)
    VALUES
      (${order.orderId}, ${order.amountUsd}, ${order.asset}, ${order.chainId},
       ${order.recipient}, ${order.expectedAmount}, ${order.expiresAt.toISOString()});
  `;
}

export async function getOrder(orderId: string): Promise<PaymentOrder | null> {
  await ensureSchema();
  const { rows } = await sql`
    SELECT order_id, amount_usd, asset, chain_id, recipient, expected_amount,
           status, tx_hash, expires_at
    FROM payment_orders WHERE order_id = ${orderId};
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    orderId: r.order_id,
    amountUsd: Number(r.amount_usd),
    asset: r.asset,
    chainId: Number(r.chain_id) as SupportedChainId,
    recipient: r.recipient,
    expectedAmount: r.expected_amount,
    status: r.status,
    txHash: r.tx_hash,
    expiresAt: r.expires_at,
  };
}

/**
 * Atomically mark an order paid exactly once. Returns true on the first success.
 * The UNIQUE(chain_id, tx_hash) constraint rejects reusing a tx for another order.
 */
export async function markOrderPaidOnce(
  orderId: string,
  chainId: SupportedChainId,
  txHash: string
): Promise<boolean> {
  await ensureSchema();
  try {
    const { rowCount } = await sql`
      UPDATE payment_orders
      SET status = 'paid', tx_hash = ${txHash}, paid_at = now()
      WHERE order_id = ${orderId} AND status = 'pending';
    `;
    return (rowCount ?? 0) > 0;
  } catch (err) {
    // Unique violation => this tx was already used to settle some order.
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      return false;
    }
    throw err;
  }
}
