// Pure aggregation over an already-extracted TradeFeatures list.
// Everything here runs client-side so filter toggles re-compute instantly.

import type { TradeFeatures } from "./features";
import { FILTERS, gate, passesAllFilters, type FilterDef, type FilterId, type FilterState } from "./filters";

/** The canonical 13-metric summary used by the StatsGrid. */
export interface StatsRow {
  total: number;          // rows in the input set (all candidate days)
  filled: number;         // trades that actually triggered (tp + sl + open)
  missed: number;         // armed_no_trigger + filtered + no_break
  wins: number;
  losses: number;
  win_rate_pct: number;
  loss_rate_pct: number;
  profit_factor: number;
  expectancy_usd: number;
  net_pnl_usd: number;
  avg_r: number;
  max_drawdown_usd: number;
  max_consec_wins: number;
  max_consec_losses: number;
  avg_hold_hours: number; // placeholder; needs per-bar durations (Phase 2)
}

const DECIDED = new Set<TradeFeatures["outcome"]>(["tp", "sl"]);

/**
 * Chronological equity-curve derivation → the drawdown/streak stats.
 * The input list should already be date-sorted (we sort defensively).
 */
export function computeStats(features: TradeFeatures[], rr = 2): StatsRow {
  const sorted = [...features].sort((a, b) => (a.ist_date < b.ist_date ? -1 : 1));
  const filled = sorted.filter((f) => f.outcome === "tp" || f.outcome === "sl" || f.outcome === "open");
  const decided = sorted.filter((f) => DECIDED.has(f.outcome));
  const wins = decided.filter((f) => f.pnl_usd > 0);
  const losses = decided.filter((f) => f.pnl_usd <= 0);
  const grossWin = wins.reduce((s, f) => s + f.pnl_usd, 0);
  const grossLoss = Math.abs(losses.reduce((s, f) => s + f.pnl_usd, 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;
  const expectancy = decided.length ? (grossWin - grossLoss) / decided.length : 0;
  const netPnl = decided.reduce((s, f) => s + f.pnl_usd, 0);
  const missed = sorted.length - filled.length;
  const winRate = decided.length ? (wins.length / decided.length) * 100 : 0;
  const lossRate = decided.length ? (losses.length / decided.length) * 100 : 0;

  // Streaks + drawdown over chronological decided trades.
  let curW = 0, curL = 0, maxW = 0, maxL = 0;
  let cum = 0, peak = 0, maxDd = 0;
  let rSum = 0, rCount = 0;
  for (const f of decided) {
    if (f.pnl_usd > 0) { curW += 1; curL = 0; if (curW > maxW) maxW = curW; }
    else { curL += 1; curW = 0; if (curL > maxL) maxL = curL; }
    cum += f.pnl_usd;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) maxDd = dd;
    // R multiple from pnl_usd requires knowing sl_risk_usd — fall back to +rr / -1 default.
    rSum += f.pnl_usd > 0 ? rr : -1;
    rCount += 1;
  }
  const avgR = rCount ? rSum / rCount : 0;

  return {
    total: sorted.length,
    filled: filled.length,
    missed,
    wins: wins.length,
    losses: losses.length,
    win_rate_pct: winRate,
    loss_rate_pct: lossRate,
    profit_factor: pf,
    expectancy_usd: expectancy,
    net_pnl_usd: netPnl,
    avg_r: avgR,
    max_drawdown_usd: maxDd,
    max_consec_wins: maxW,
    max_consec_losses: maxL,
    avg_hold_hours: 0, // Phase 2 will populate from per-bar duration tracking
  };
}

/** Rows for a single feature dimension's bucket breakdown. */
export interface BucketRow extends StatsRow {
  bucket: string;
  label: string;
}

export function computeBuckets(
  features: TradeFeatures[],
  def: FilterDef,
  rr = 2,
): BucketRow[] {
  return def.buckets.map((b) => {
    const rows = features.filter((f) => def.tag(f) === b);
    const s = computeStats(rows, rr);
    return { bucket: b, label: def.bucketLabel(b), ...s };
  });
}

/** Apply enabled filters and return the filtered subset. */
export function applyFilters(
  features: TradeFeatures[],
  filters: Record<FilterId, FilterState>,
): TradeFeatures[] {
  return features.filter((f) => passesAllFilters(filters, f));
}

/** Equity curve points (date, cumulative net pnl). */
export interface EquityPoint {
  ist_date: string;
  cum_pnl_usd: number;
}
export function equityCurve(features: TradeFeatures[]): EquityPoint[] {
  const sorted = [...features].sort((a, b) => (a.ist_date < b.ist_date ? -1 : 1));
  let cum = 0;
  const out: EquityPoint[] = [];
  for (const f of sorted) {
    cum += Number.isFinite(f.pnl_usd) ? f.pnl_usd : 0;
    out.push({ ist_date: f.ist_date, cum_pnl_usd: cum });
  }
  return out;
}

/** Drawdown curve (date, current dd from peak). */
export function drawdownCurve(features: TradeFeatures[]): EquityPoint[] {
  const eq = equityCurve(features);
  let peak = 0;
  return eq.map((p) => {
    if (p.cum_pnl_usd > peak) peak = p.cum_pnl_usd;
    return { ist_date: p.ist_date, cum_pnl_usd: p.cum_pnl_usd - peak };
  });
}

/** Uniform histogram bins over the given numeric extractor. */
export interface HistogramBin {
  bucket: string;
  count: number;
  wins: number;
  losses: number;
  net_pnl_usd: number;
  x0: number;
  x1: number;
}
export function histogram(
  features: TradeFeatures[],
  accessor: (f: TradeFeatures) => number | null,
  bins = 12,
): HistogramBin[] {
  const vals: Array<{ v: number; f: TradeFeatures }> = [];
  for (const f of features) {
    const v = accessor(f);
    if (v === null || !Number.isFinite(v)) continue;
    vals.push({ v, f });
  }
  if (vals.length === 0) return [];
  const min = Math.min(...vals.map((x) => x.v));
  const max = Math.max(...vals.map((x) => x.v));
  if (max === min) {
    return [{ bucket: min.toFixed(2), count: vals.length, wins: 0, losses: 0, net_pnl_usd: 0, x0: min, x1: max }];
  }
  const step = (max - min) / bins;
  const out: HistogramBin[] = [];
  for (let i = 0; i < bins; i++) {
    const x0 = min + i * step;
    const x1 = i === bins - 1 ? max : min + (i + 1) * step;
    const rows = vals.filter((x) => x.v >= x0 && (i === bins - 1 ? x.v <= x1 : x.v < x1));
    const wins = rows.filter((x) => x.f.pnl_usd > 0 && DECIDED.has(x.f.outcome)).length;
    const losses = rows.filter((x) => x.f.pnl_usd <= 0 && DECIDED.has(x.f.outcome)).length;
    const net = rows
      .filter((x) => DECIDED.has(x.f.outcome))
      .reduce((s, x) => s + x.f.pnl_usd, 0);
    out.push({
      bucket: `${x0.toFixed(1)}–${x1.toFixed(1)}`,
      count: rows.length,
      wins,
      losses,
      net_pnl_usd: net,
      x0,
      x1,
    });
  }
  return out;
}

export { FILTERS, gate };
