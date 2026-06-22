"use client";

import { useEffect, useState } from "react";

/** Shows the Xerberus AAA–D risk grade for a payment token. Renders nothing
 *  while loading or when Xerberus isn't configured (grade null => "Unrated",
 *  shown neutrally — absence of a rating is not a bad rating). */
export default function RiskBadge({ symbol = "USDC" }: { symbol?: string }) {
  const [grade, setGrade] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/token-risk?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d: { grade?: string | null }) => {
        if (!cancelled) setGrade(d.grade ?? null);
      })
      .catch(() => {
        if (!cancelled) setGrade(null);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (grade === undefined) return null;

  const rated = Boolean(grade);
  const tone = !rated
    ? "unrated"
    : /^(AAA|AA|A)$/i.test(grade as string)
      ? "good"
      : /^(BBB|BB|B)/i.test(grade as string)
        ? "mid"
        : "bad";

  return (
    <span className={`risk-badge ${tone}`} title="Token risk rating by Xerberus">
      {symbol} · {rated ? grade : "Unrated"}
    </span>
  );
}
