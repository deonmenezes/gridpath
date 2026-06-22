// wagmi config for GridPath crypto checkout.
//
// Non-custodial EVM payments on Base + Polygon. Uses injected (MetaMask, Rabby,
// Brave, etc.) + Coinbase Wallet connectors — NO WalletConnect projectId needed,
// so this works with zero third-party signup. Public RPCs by default; override
// with NEXT_PUBLIC_RPC_* for reliability at volume.

import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { base, polygon } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";

export const config = createConfig({
  chains: [base, polygon],
  connectors: [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: "GridPath" }),
  ],
  // cookieStorage + ssr fixes the React 19 / Next 15 "storage.removeItem" error.
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_RPC_BASE || "https://mainnet.base.org"),
    [polygon.id]: http(process.env.NEXT_PUBLIC_RPC_POLYGON || "https://polygon-rpc.com"),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
