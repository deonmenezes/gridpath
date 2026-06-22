"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { formatUsd } from "@/lib/cost";
import type { ConnectionEstimate } from "@/lib/types";
import type { RiskAssessment } from "@/lib/risk";

/** "2026-06-21T12:00:00+00:00" -> "Jun 21, 2026". */
function fmtWindow(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Map an AAA–D grade to the existing risk-badge tone (good / mid / bad). */
function tone(grade: string | null): "good" | "mid" | "bad" | "unrated" {
  if (!grade) return "unrated";
  if (/^(AAA|AA|A)$/i.test(grade)) return "good";
  if (/^(BBB|BB|B)$/i.test(grade)) return "mid";
  return "bad";
}

function GradeChip({ grade }: { grade: string | null }) {
  const t = tone(grade);
  return <span className={`grade-chip ${t}`}>{grade ?? "N/A"}</span>;
}

/**
 * The financial-risk layer beside the physical estimate: if a homeowner can't
 * pay the connection upfront, GridPath finances it through an investor pool — and
 * renewable-energy investment is genuinely riskier than a utility bill, so we
 * grade it. Three concepts, one Xerberus-powered call. Degrades to fixtures.
 */
export default function InvestmentRisk({ estimate }: { estimate: ConnectionEstimate }) {
  const [data, setData] = useState<RiskAssessment | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  // A pool that finances ~7 connections at this net cost (illustrative size).
  const poolSize = 100_000;

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    fetch(`/api/risk?size=${poolSize}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("risk unavailable"))))
      .then((d: RiskAssessment) => !cancelled && setData(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [estimate.id]);

  if (failed) return null; // never break the page on a risk hiccup
  if (!data) {
    return (
      <div className="invrisk loading-inline">
        <span className="spinner" /> Grading the investment side…
      </div>
    );
  }

  const { pool, comparison, stress, source, window: dataWindow } = data;
  const maxLoss = Math.max(...stress.map((s) => s.poolLossPct), 1);
  const sourceLabel =
    source === "live"
      ? "Live · Xerberus V7"
      : `Xerberus V7 · real data, ${fmtWindow(dataWindow)} window`;

  return (
    <div className="invrisk">
      <div className="invrisk-head">
        <div className="invrisk-icon"><Icon name="leaf" size={18} /></div>
        <div>
          <div className="invrisk-title">Can&apos;t pay upfront? Fund it through the Clean-Connect Pool</div>
          <div className="invrisk-sub">
            Investors finance the connection and earn green yield. Renewable-energy
            investment is riskier than a utility bill — so here&apos;s the 4th honest
            number: a <strong>risk grade</strong>, powered by Xerberus.
          </div>
        </div>
      </div>

      {/* ---- Concept A — Clean-Connect Pool grade + exit clock ---- */}
      <div className="invrisk-pool">
        <div className="pool-grade">
          <div className="pool-grade-k">Pool risk grade</div>
          <div className="pool-grade-v">
            <GradeChip grade={pool.blendedGrade} />
            <span className="pool-grade-pct">
              {(pool.blendedPercentile * 100).toFixed(0)}th-pctile risk
            </span>
          </div>
        </div>
        <div className="pool-exit">
          <div className="pool-grade-k">Investor exit clock</div>
          <div className="pool-exit-v">
            ~{pool.exit.daysToExit} days <span className="pool-exit-tag">{pool.exit.classification}</span>
          </div>
          <div className="pool-exit-sub">
            to unwind the {formatUsd(pool.exit.sleeveUsd)} staking sleeve · a utility bill exits instantly
          </div>
        </div>
      </div>

      {/* Pool backing basket */}
      <div className="invrisk-basket">
        {pool.components.map((c) => (
          <div className="basket-row" key={c.symbol}>
            <span className="basket-w">{(c.weight * 100).toFixed(0)}%</span>
            <span className="basket-sym">{c.symbol}</span>
            <span className="basket-label">{c.label}</span>
            <GradeChip grade={c.grade} />
          </div>
        ))}
      </div>

      <button className="invrisk-toggle" onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? "info" : "info"} size={14} />{" "}
        {open ? "Hide" : "Compare options & stress-test the pool"}
      </button>

      {open && (
        <>
          {/* ---- Concept B — Green Energy Risk Score comparison ---- */}
          <div className="invrisk-block-title">Green energy vs the grid — graded</div>
          <table className="invrisk-table">
            <tbody>
              {comparison.map((row) => (
                <tr key={row.option} className={!row.onChain ? "baseline" : ""}>
                  <td>
                    <div className="cmp-opt">{row.option}</div>
                    <div className="cmp-detail">{row.detail}</div>
                  </td>
                  <td className="cmp-grade"><GradeChip grade={row.grade} /></td>
                  <td className="cmp-note">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ---- Concept C — Crisis replay ---- */}
          <div className="invrisk-block-title">
            If a real crisis hit the pool today
            <span className="invrisk-block-sub">Xerberus historical shock baskets · transparent local math</span>
          </div>
          <div className="invrisk-stress">
            {stress.map((s) => (
              <div className="stress-row" key={s.id}>
                <div className="stress-meta">
                  <span className="stress-label">{s.label}</span>
                  <span className="stress-period">{s.period}</span>
                </div>
                <div className="stress-bartrack">
                  <div
                    className="stress-bar"
                    style={{ width: `${Math.max(6, (s.poolLossPct / maxLoss) * 100)}%` }}
                  />
                </div>
                <div className="stress-loss">−{s.poolLossPct}%</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="invrisk-foot">
        <span className="invrisk-source">{sourceLabel}</span>
        <span>
          A weighted-percentile blend of real on-chain instruments — explainable,
          not a guarantee. Xerberus rates on-chain DeFi only.
        </span>
      </div>
    </div>
  );
}
