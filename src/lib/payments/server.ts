// Server-side viem clients used to VERIFY payments independently of anything the
// browser claims. Always uses our own RPC (env override) or a public fallback.

import { createPublicClient, http } from "viem";
import { base, polygon } from "viem/chains";
import type { SupportedChainId } from "./tokens";

const RPC: Record<SupportedChainId, string> = {
  [base.id]: process.env.RPC_BASE || "https://mainnet.base.org",
  [polygon.id]: process.env.RPC_POLYGON || "https://polygon-rpc.com",
};

const CHAINS = { [base.id]: base, [polygon.id]: polygon } as const;

export function publicClientFor(chainId: SupportedChainId) {
  return createPublicClient({
    chain: CHAINS[chainId],
    transport: http(RPC[chainId]),
  });
}
