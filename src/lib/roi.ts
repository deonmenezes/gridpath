// Deterministic "is going solar worth it?" ROI/risk engine.
//
// Layers an honest, multi-year cash-flow model on top of a single
// CleanEnergyOption. Everything is an ESTIMATE under stated, disclosed
// assumptions — never a guarantee. This file does NO LLM calls and invents no
// numbers: every figure traces to the option's cost/savings and the assumptions
// below. The optional Claude pass (roiNarrate.ts) only *explains* this output.

import type {
  CleanEnergyOption,
  PropertySignals,
  RoiAnalysis,
  RoiAssumptions,
  RoiYear,
  SensitivityScenario,
} from "./types";

/** Conservative defaults. Surfaced to the user; tune here, not in the UI. */
export const DEFAULT_ASSUMPTIONS: RoiAssumptions = {
  electricityEscalationPct: 3, // utility rates have risen ~2–5%/yr historically
  panelDegradationPct: 0.5, // typical panel output loss per year (solar only)
  discountRatePct: 5, // time value of money for NPV / discounted payback
  analysisYears: 25, // standard panel warranty horizon
  annualOmCost: 150, // monitoring, occasional cleaning/service
  inverterReplacementYear: 13, // inverters usually need replacing ~yr 12–15
  inverterReplacementCost: 2500,
};

const round = (n: number) => Math.round(n);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Present value of a cash-flow array where index i is year i. */
function npvAt(cashflows: number[], rate: number): number {
  let npv = 0;
  for (let i = 0; i < cashflows.length; i++) {
    npv += cashflows[i] / Math.pow(1 + rate, i);
  }
  return npv;
}

/**
 * Internal rate of return via bisection. Returns the rate (decimal) where NPV=0,
 * or null when no sign change exists in the search window (e.g. never profitable
 * or pathological cash flows). Never throws, never returns NaN.
 */
function solveIrr(cashflows: number[]): number | null {
  let lo = -0.9999;
  let hi = 100; // 10,000% upper bound — generous
  let flo = npvAt(cashflows, lo);
  let fhi = npvAt(cashflows, hi);
  if (!isFinite(flo) || !isFinite(fhi)) return null;
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  // Need a sign change to bracket a root.
  if (flo > 0 === fhi > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = npvAt(cashflows, mid);
    if (!isFinite(fmid)) return null;
    if (Math.abs(fmid) < 1e-7 || (hi - lo) / 2 < 1e-9) return mid;
    if (fmid > 0 === flo > 0) {
      lo = mid;
      flo = fmid;
    } else {
      hi = mid;
      fhi = fmid;
    }
  }
  return (lo + hi) / 2;
}

/** First year a running cumulative array (indexed by year, [0]=year0) turns >= 0,
 *  linearly interpolated to a fraction of a year. null if it never does. */
function crossingYear(cumulative: number[]): number | null {
  if (cumulative[0] >= 0) return 0; // zero upfront cost => instant payback
  for (let y = 1; y < cumulative.length; y++) {
    if (cumulative[y] >= 0) {
      const prev = cumulative[y - 1];
      const curr = cumulative[y];
      // Interpolate within the year the sign flips.
      if (prev < 0 && curr !== prev) {
        return round2((y - 1) + prev / (prev - curr));
      }
      return y;
    }
  }
  return null;
}

interface RoiCore {
  years: RoiYear[];
  cashflows: number[]; // year0..N, for IRR/NPV
  simplePaybackYears: number | null;
  discountedPaybackYears: number | null;
  lifetimeNetSavings: number;
  npv: number;
  irrPct: number | null;
  firstYearSavings: number;
  breakEvenYear: number | null;
}

/** Build the year-by-year cash flow for one option under one set of assumptions. */
function modelCashflow(
  option: CleanEnergyOption,
  assumptions: RoiAssumptions,
  isSolar: boolean
): RoiCore {
  const {
    electricityEscalationPct,
    panelDegradationPct,
    discountRatePct,
    analysisYears,
    annualOmCost,
    inverterReplacementYear,
    inverterReplacementCost,
  } = assumptions;

  const esc = electricityEscalationPct / 100;
  const deg = isSolar ? panelDegradationPct / 100 : 0;
  const r = discountRatePct / 100;
  const om = isSolar ? annualOmCost : 0; // O&M only modeled for solar
  const netCost = option.estimatedCost;
  const baseSavings = option.annualSavings;

  const years: RoiYear[] = [];
  const cashflows: number[] = [-netCost]; // year 0 outflow
  const cumulativeArr: number[] = [-netCost];
  const cumulativeDiscArr: number[] = [-netCost];

  let cumulative = -netCost;
  let cumulativeDiscounted = -netCost;
  let firstYearSavings = 0;

  for (let y = 1; y <= analysisYears; y++) {
    // Savings escalate with utility prices; solar output also degrades.
    const grossSavings =
      baseSavings * Math.pow(1 + esc, y - 1) * Math.pow(1 - deg, y - 1);
    let netCashflow = grossSavings - om;
    // A replacement year beyond the horizon is intentionally never charged.
    if (isSolar && inverterReplacementYear > 0 && y === inverterReplacementYear) {
      netCashflow -= inverterReplacementCost;
    }
    if (y === 1) firstYearSavings = grossSavings;

    cumulative += netCashflow;
    cumulativeDiscounted += netCashflow / Math.pow(1 + r, y);
    cashflows.push(netCashflow);
    cumulativeArr.push(cumulative);
    cumulativeDiscArr.push(cumulativeDiscounted);

    years.push({
      year: y,
      grossSavings: round(grossSavings),
      netCashflow: round(netCashflow),
      cumulative: round(cumulative),
      cumulativeDiscounted: round(cumulativeDiscounted),
    });
  }

  const irr = solveIrr(cashflows);
  const simplePaybackYears = crossingYear(cumulativeArr);

  return {
    years,
    cashflows,
    simplePaybackYears,
    discountedPaybackYears: crossingYear(cumulativeDiscArr),
    lifetimeNetSavings: round(cumulative),
    npv: round(npvAt(cashflows, r)),
    irrPct: irr == null ? null : round2(irr * 100),
    firstYearSavings: round(firstYearSavings),
    // Rounded break-even year; matches the chart's "~N" label (uses Math.round).
    breakEvenYear: simplePaybackYears == null ? null : Math.round(simplePaybackYears),
  };
}

/** Provenance + spread → a qualitative confidence label (no false precision). */
function confidenceLabel(
  signals: PropertySignals,
  sensitivity: SensitivityScenario[]
): "High" | "Medium" | "Low" {
  const paybacks = sensitivity
    .map((s) => s.simplePaybackYears)
    .filter((v): v is number => v != null);
  // Wide payback spread across price scenarios => lower confidence.
  const spread =
    paybacks.length >= 2 ? Math.max(...paybacks) - Math.min(...paybacks) : 0;
  if (signals.fromSolarApi && spread <= 3) return "High";
  if (signals.fromSolarApi || spread <= 4) return "Medium";
  return "Low";
}

/**
 * Build the full ROI analysis for one option. Pure + deterministic.
 * `narrative` is left null here; the route may fill it via roiNarrate().
 */
/** Solar detection that tolerates LLM-renamed keys (e.g. "solar", "Rooftop Solar"). */
export function isSolarOption(option: CleanEnergyOption): boolean {
  return /solar/i.test(option.key) || /solar/i.test(option.name);
}

export function buildRoi(
  option: CleanEnergyOption,
  signals: PropertySignals,
  assumptions: RoiAssumptions = DEFAULT_ASSUMPTIONS
): RoiAnalysis {
  const isSolar = isSolarOption(option);
  const core = modelCashflow(option, assumptions, isSolar);

  // Electricity-price sensitivity: vary escalation low / base / high.
  const escBase = assumptions.electricityEscalationPct;
  const scenarios: { label: SensitivityScenario["label"]; esc: number }[] = [
    { label: "Low", esc: Math.max(0, escBase - 2) },
    { label: "Base", esc: escBase },
    { label: "High", esc: escBase + 2 },
  ];
  const sensitivity: SensitivityScenario[] = scenarios.map(({ label, esc }) => {
    const c = modelCashflow(
      option,
      { ...assumptions, electricityEscalationPct: esc },
      isSolar
    );
    return {
      label,
      escalationPct: esc,
      simplePaybackYears: c.simplePaybackYears,
      lifetimeNetSavings: c.lifetimeNetSavings,
      irrPct: c.irrPct,
    };
  });

  const firstYearReturnPct =
    option.estimatedCost > 0
      ? round2((core.firstYearSavings / option.estimatedCost) * 100)
      : 0;

  return {
    optionKey: option.key,
    optionName: option.name,
    netCost: option.estimatedCost,
    analysisYears: assumptions.analysisYears,
    assumptions,
    simplePaybackYears: core.simplePaybackYears,
    discountedPaybackYears: core.discountedPaybackYears,
    lifetimeNetSavings: core.lifetimeNetSavings,
    npv: core.npv,
    irrPct: core.irrPct,
    firstYearSavings: core.firstYearSavings,
    firstYearReturnPct,
    breakEvenYear: core.breakEvenYear,
    years: core.years,
    sensitivity,
    confidence: confidenceLabel(signals, sensitivity),
    narrative: null,
  };
}
