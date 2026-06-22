"use client";

import { formatUsd } from "@/lib/cost";
import Icon from "@/components/Icon";
import type { RoiAnalysis } from "@/lib/types";

/** Payback ("how long until it pays for itself") wording, honest about "never". */
function paybackLabel(years: number | null, horizon: number): string {
  if (years == null) return `> ${horizon} yrs`;
  return `${years} yrs`;
}

function pctLabel(pct: number | null): string {
  return pct == null ? "—" : `${pct}%`;
}

/** Tiny inline-SVG cumulative-savings curve with a break-even marker. */
function PaybackChart({ roi }: { roi: RoiAnalysis }) {
  const W = 300;
  const H = 132;
  const padL = 6;
  const padR = 6;
  const padT = 10;
  const padB = 18;

  // year 0 = -netCost, then each modeled year's cumulative position.
  const pts = [
    { year: 0, cum: -roi.netCost },
    ...roi.years.map((y) => ({ year: y.year, cum: y.cumulative })),
  ];
  const N = roi.analysisYears;
  const denom = N || 1; // guard: never divide by a zero horizon
  const vals = pts.map((p) => p.cum);
  const minY = Math.min(...vals, 0);
  const maxY = Math.max(...vals, 0);
  const span = maxY - minY || 1;

  const sx = (year: number) => padL + (year / denom) * (W - padL - padR);
  const sy = (v: number) => padT + (1 - (v - minY) / span) * (H - padT - padB);

  const line = pts.map((p) => `${sx(p.year)},${sy(p.cum)}`).join(" ");
  const zeroY = sy(0);
  // Marker uses the same crossing as the payback metric, so they always agree.
  const be = roi.simplePaybackYears;

  return (
    <svg
      className="roi-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Cumulative savings over ${N} years${
        be != null ? `, breaking even around year ${be}` : ""
      }`}
    >
      {/* break-even baseline */}
      <line
        x1={padL}
        x2={W - padR}
        y1={zeroY}
        y2={zeroY}
        stroke="var(--border-strong, #c9c2b4)"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      {/* area + curve */}
      <polyline
        points={`${sx(0)},${zeroY} ${line} ${sx(N)},${zeroY}`}
        fill="var(--green-50, #ecf6f1)"
        stroke="none"
        opacity={0.7}
      />
      <polyline
        points={line}
        fill="none"
        stroke="var(--green, #1c845a)"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* break-even marker */}
      {be != null && (
        <>
          <line
            x1={sx(be)}
            x2={sx(be)}
            y1={padT}
            y2={H - padB}
            stroke="var(--amber, #c08a2e)"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
          <circle cx={sx(be)} cy={zeroY} r={3.5} fill="var(--amber, #c08a2e)" />
        </>
      )}
      {/* axis labels */}
      <text x={padL} y={H - 5} className="roi-axis">Yr 0</text>
      {be != null && (
        <text x={sx(be)} y={H - 5} textAnchor="middle" className="roi-axis">
          break-even ~{Math.round(be)}
        </text>
      )}
      <text x={W - padR} y={H - 5} textAnchor="end" className="roi-axis">
        Yr {N}
      </text>
    </svg>
  );
}

export default function RoiAnalysisView({ roi }: { roi: RoiAnalysis }) {
  const a = roi.assumptions;
  const isSolar = /solar/i.test(roi.optionKey) || /solar/i.test(roi.optionName);
  const subject = isSolar ? "going solar" : roi.optionName.toLowerCase();

  return (
    <div className="roi">
      <div className="roi-head">
        <span className="roi-title">Is {subject} worth it?</span>
        <span className="roi-badge">estimate</span>
      </div>

      <p className="roi-lede">
        An estimated {roi.analysisYears}-year outlook for {roi.optionName.toLowerCase()} on
        this home, based on the {formatUsd(roi.netCost)} net cost and the assumptions below.
      </p>

      {/* non-guarantee disclaimer, kept with the figures it qualifies */}
      <div className="roi-estimate-note">
        <Icon name="info" size={13} /> Estimates, not a guarantee — actual results vary.
      </div>

      {/* headline metrics */}
      <div className="roi-metrics">
        <div className="roi-metric">
          <span className="roi-k">Est. payback</span>
          <span className="roi-v">{paybackLabel(roi.simplePaybackYears, roi.analysisYears)}</span>
          <span className="roi-sub">
            {paybackLabel(roi.discountedPaybackYears, roi.analysisYears)} with time value
          </span>
        </div>
        <div className="roi-metric">
          <span className="roi-k">Est. {roi.analysisYears}-yr net savings</span>
          <span className="roi-v green">{formatUsd(roi.lifetimeNetSavings)}</span>
          <span className="roi-sub">if assumptions hold</span>
        </div>
        <div className="roi-metric">
          <span className="roi-k">Est. annual return</span>
          <span className="roi-v">{pctLabel(roi.irrPct)}</span>
          <span className="roi-sub">if assumptions hold</span>
        </div>
        <div className="roi-metric">
          <span className="roi-k">Est. net present value</span>
          <span className="roi-v">{formatUsd(roi.npv)}</span>
          <span className="roi-sub">at {a.discountRatePct}% discount</span>
        </div>
      </div>

      <PaybackChart roi={roi} />

      {roi.narrative && <p className="roi-narrative">{roi.narrative}</p>}

      {/* sensitivity to electricity prices */}
      <div className="roi-sens">
        <div className="roi-sens-title">
          If electricity prices rise faster or slower
        </div>
        <table className="roi-table">
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Rate rise</th>
              <th>Payback</th>
              <th>{roi.analysisYears}-yr net</th>
            </tr>
          </thead>
          <tbody>
            {roi.sensitivity.map((s) => (
              <tr key={s.label} className={s.label === "Base" ? "base" : ""}>
                <td>{s.label}</td>
                <td>{s.escalationPct}%/yr</td>
                <td>{paybackLabel(s.simplePaybackYears, roi.analysisYears)}</td>
                <td>{formatUsd(s.lifetimeNetSavings)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={`roi-confidence ${roi.confidence.toLowerCase()}`}>
        <Icon name="info" size={13} /> {roi.confidence} confidence — based on{" "}
        {roi.confidence === "High" || roi.confidence === "Medium"
          ? "this address's data and a range of price scenarios"
          : "regional estimates; results vary by home"}
        .
      </div>

      <details className="roi-assumptions">
        <summary>Assumptions behind these numbers</summary>
        <ul>
          <li>Electricity prices rise ~{a.electricityEscalationPct}%/yr (varied ±2% above)</li>
          <li>Panel output fades ~{a.panelDegradationPct}%/yr</li>
          <li>Discount rate {a.discountRatePct}%/yr for present-value figures</li>
          <li>Upkeep ~{formatUsd(a.annualOmCost)}/yr</li>
          {a.inverterReplacementYear > 0 && (
            <li>
              Inverter replacement ~{formatUsd(a.inverterReplacementCost)} around year{" "}
              {a.inverterReplacementYear}
            </li>
          )}
          <li>{a.analysisYears}-year horizon</li>
        </ul>
      </details>

      <div className="roi-disclaimer">
        These are illustrative estimates for educational purposes — not financial,
        tax, or investment advice, and not a guarantee of returns. Actual results
        depend on your utility rates, weather, usage, equipment, and policy (ITC /
        net metering) changes. Consult a qualified professional and your utility
        before deciding.
      </div>
    </div>
  );
}
