// Payment constants shared by client + server. Single source of truth for the
// merchant address, supported chains, and the EXACT canonical (native, NOT
// bridged) USDC contract per chain. Getting these wrong loses funds, so they
// live in one audited place.

import { base, polygon } from "viem/chains";

/** Funds land directly here (non-custodial). Back up this wallet's key. */
export const MERCHANT = "0x950739a11ba0820ceEfFFEC4682ec352058deE2d" as const;

export const SUPPORTED_CHAINS = [base.id, polygon.id] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAINS)[number];

export function isSupportedChain(id: number): id is SupportedChainId {
  return (SUPPORTED_CHAINS as readonly number[]).includes(id);
}

/** Native Circle USDC. NOT the bridged Polygon USDC.e (0x2791...). */
export const USDC: Record<SupportedChainId, `0x${string}`> = {
  [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  [polygon.id]: "0x3c499c542cef5e3811e1192cE70d8cC03d5c3359",
};

export const USDC_DECIMALS = 6;

/** Minimum confirmations before crediting an order (reorg safety). */
export const MIN_CONFIRMATIONS: Record<SupportedChainId, number> = {
  [base.id]: 12,
  [polygon.id]: 30,
};

export const CHAIN_LABEL: Record<SupportedChainId, string> = {
  [base.id]: "Base",
  [polygon.id]: "Polygon",
};

/** How long a price quote stays valid, ms. */
export const QUOTE_TTL_MS = 15 * 60 * 1000;
