"use client";

import { useState } from "react";
import { erc20Abi } from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { base, polygon } from "wagmi/chains";
import { CHAIN_LABEL, USDC, type SupportedChainId } from "@/lib/payments/tokens";
import RiskBadge from "./RiskBadge";
import Icon from "@/components/Icon";

const CHAINS: SupportedChainId[] = [base.id, polygon.id];

type Phase = "idle" | "quoting" | "paying" | "verifying" | "paid" | "error";

interface Quote {
  orderId: string;
  recipient: `0x${string}`;
  expectedAmount: string;
  error?: string;
}

/** Non-custodial USDC checkout on Base/Polygon. Pays the merchant wallet directly. */
export default function CryptoCheckout({
  amountUsd,
  label = "Reserve your install",
}: {
  amountUsd: number;
  label?: string;
}) {
  const { isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [selectedChain, setSelectedChain] = useState<SupportedChainId>(base.id);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  async function pay() {
    setPhase("quoting");
    setMessage(null);
    try {
      // 1) Server-bound quote — server owns recipient + exact amount.
      const qres = await fetch("/api/pay/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsd, chainId: selectedChain }),
      });
      const quote = (await qres.json().catch(() => ({}))) as Quote;
      if (!qres.ok) throw new Error(quote.error ?? "Could not create a payment quote");

      // 2) Make sure the wallet is on the chain we quoted for.
      if (chainId !== selectedChain) await switchChainAsync({ chainId: selectedChain });

      // 3) Send the USDC transfer to the merchant.
      setPhase("paying");
      const hash = await writeContractAsync({
        address: USDC[selectedChain],
        abi: erc20Abi,
        functionName: "transfer",
        args: [quote.recipient, BigInt(quote.expectedAmount)],
        chainId: selectedChain,
      });
      setTxHash(hash);

      // 4) Poll the server, which confirms the payment on-chain itself.
      setPhase("verifying");
      for (let i = 0; i < 45; i++) {
        const vres = await fetch("/api/pay/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: quote.orderId, txHash: hash }),
        });
        const v = (await vres.json().catch(() => ({}))) as { ok?: boolean; reason?: string; error?: string };
        if (vres.ok && v.ok) {
          setPhase("paid");
          return;
        }
        if (vres.status >= 400 && vres.status !== 202) {
          throw new Error(v.reason ?? v.error ?? "Verification failed");
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
      throw new Error("Still confirming on-chain — we'll credit it once it settles.");
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Payment failed");
    }
  }

  const busy = phase === "quoting" || phase === "paying" || phase === "verifying";

  if (phase === "paid") {
    return (
      <div className="cc cc-paid">
        <Icon name="check" size={18} /> Payment received — thank you! Your install is reserved.
        {txHash && <div className="cc-tx">tx {txHash.slice(0, 10)}…{txHash.slice(-8)}</div>}
      </div>
    );
  }

  return (
    <div className="cc">
      <div className="cc-head">
        <span className="cc-title">{label}</span>
        <span className="cc-amount">${amountUsd.toLocaleString()} in USDC</span>
      </div>

      <div className="cc-risk">
        <RiskBadge symbol="USDC" />
        <span className="cc-risk-note">Pay in a stablecoin — risk grade by Xerberus.</span>
      </div>

      {!isConnected ? (
        <div className="cc-connectors">
          {connectors.map((c) => (
            <button key={c.uid} className="cc-connect" disabled={connecting} onClick={() => connect({ connector: c })}>
              <Icon name="plug" size={16} /> {c.name}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="cc-chains">
            {CHAINS.map((id) => (
              <button
                key={id}
                className={`cc-chain ${selectedChain === id ? "active" : ""}`}
                onClick={() => setSelectedChain(id)}
                disabled={busy}
              >
                {CHAIN_LABEL[id]}
              </button>
            ))}
          </div>

          <button className="btn green cc-pay" onClick={pay} disabled={busy}>
            {phase === "quoting" && "Preparing…"}
            {phase === "paying" && "Confirm in your wallet…"}
            {phase === "verifying" && "Confirming on-chain…"}
            {(phase === "idle" || phase === "error") && (
              <>
                Pay ${amountUsd.toLocaleString()} on {CHAIN_LABEL[selectedChain]} <Icon name="arrow-right" size={15} />
              </>
            )}
          </button>

          <button className="cc-disconnect" onClick={() => disconnect()} disabled={busy}>
            Disconnect wallet
          </button>
        </>
      )}

      {message && <div className="cc-error">{message}</div>}
      <div className="cc-foot">
        <Icon name="lock" size={12} /> Paid directly to GridPath on-chain. Crypto payments are
        final — there are no chargebacks or refunds.
      </div>
    </div>
  );
}
