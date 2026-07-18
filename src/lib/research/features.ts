// Client-safe feature derivation for the research panel.
// Pure: takes DayResult rows + the daily-bias fields they carry and produces
// per-trade tags + bucket assignments. No engine changes, no server calls.

import type { DayResult } from "@/lib/strategy/backtest-range.server";

export type QuintileBucket = "very_small" | "small" | "medium" | "large" | "very_large";
export type QuartileBucket = "low" | "medium" | "high" | "extreme";
export type TrendBucket =
  | "strong_up"
  | "weak_up"
  | "range"
  | "weak_down"
  | "strong_down";
export type PrevDayBucket = "bullish" | "bearish" | "inside" | "outside" | "doji";

/** The full per-trade feature record we derive from a DayResult. */
export interface TradeFeatures {
  ist_date: string;
  side: "long" | "short" | null;
  outcome: DayResult["outcome"];
  pnl_usd: number;
  // Phase 1 numeric features
  or_size_usd: number | null;
  or_size_pct_atr: number | null;
  or_size_percentile: number | null;
  break_distance_usd: number | null;
  break_distance_pct_or: number | null;
  break_distance_pct_atr: number | null;
  body_pct: number | null;
  upper_wick_pct: number | null;
  lower_wick_pct: number | null;
  close_position_pct: number | null;
  candle_range_usd: number | null;
  daily_atr: number | null;
  atr_percentile: number | null;
  ema20: number | null;
  ema50: number | null;
  ema100: number | null;
  ema200: number | null;
  adx14: number | null;
  prev_open: number | null;
  prev_close: number | null;
  prev_high: number | null;
  prev_low: number | null;
  prev_range: number | null;
  // Phase 1 categorical buckets
  or_bucket5: QuintileBucket | null;
  break_strength_bucket5: QuintileBucket | null;
  body_bucket5: QuintileBucket | null;
  atr_bucket4: QuartileBucket | null;
  trend_bucket: TrendBucket | null;
  prev_day_bucket: PrevDayBucket | null;
  // ---- Phase 2/3/5 features ----
  mae_r: number | null;
  mfe_r: number | null;
  duration_bars: number | null;
  time_to_fill_bars: number | null;
  retest_count: number | null;
  break_hour_ist: number | null;
  weekday: number | null;
  month: number | null;
  quarter: number | null;
  fvg_present: boolean | null;
  sweep_present: boolean | null;
  mae_bucket5: QuintileBucket | null;
  mfe_bucket5: QuintileBucket | null;
  duration_bucket5: QuintileBucket | null;
  ttl_bucket5: QuintileBucket | null;
}

const QUINTILE_LABELS: QuintileBucket[] = [
  "very_small",
  "small",
  "medium",
  "large",
  "very_large",
];
const QUARTILE_LABELS: QuartileBucket[] = ["low", "medium", "high", "extreme"];

export const QUINTILE_LABEL_MAP: Record<QuintileBucket, string> = {
  very_small: "Very Small",
  small: "Small",
  medium: "Medium",
  large: "Large",
  very_large: "Very Large",
};
export const QUARTILE_LABEL_MAP: Record<QuartileBucket, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  extreme: "Extreme",
};
export const TREND_LABEL_MAP: Record<TrendBucket, string> = {
  strong_up: "Strong Uptrend",
  weak_up: "Weak Uptrend",
  range: "Range",
  weak_down: "Weak Downtrend",
  strong_down: "Strong Downtrend",
};
export const PREV_DAY_LABEL_MAP: Record<PrevDayBucket, string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  inside: "Inside",
  outside: "Outside",
  doji: "Doji",
};

function quintileEdges(vals: number[]): number[] | null {
  const s = vals.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length < 5) return null;
  const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
  return [q(0.2), q(0.4), q(0.6), q(0.8)];
}
function quartileEdges(vals: number[]): number[] | null {
  const s = vals.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length < 4) return null;
  const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
  return [q(0.25), q(0.5), q(0.75)];
}
function bucketOf<L extends string>(v: number | null, edges: number[] | null, labels: L[]): L | null {
  if (v === null || !Number.isFinite(v) || !edges) return null;
  for (let i = 0; i < edges.length; i++) if (v <= edges[i]) return labels[i];
  return labels[labels.length - 1];
}
function percentileRank(v: number | null, sortedVals: number[]): number | null {
  if (v === null || !Number.isFinite(v) || sortedVals.length === 0) return null;
  // binary search for count <= v
  let lo = 0, hi = sortedVals.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedVals[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return (lo / sortedVals.length) * 100;
}

function classifyTrend(
  price: number,
  ema20: number | null,
  ema50: number | null,
  ema200: number | null,
  adx: number | null,
): TrendBucket | null {
  if (ema20 === null || ema50 === null || ema200 === null) return null;
  const stackedUp = ema20 > ema50 && ema50 > ema200 && price > ema20;
  const stackedDn = ema20 < ema50 && ema50 < ema200 && price < ema20;
  const strong = (adx ?? 0) >= 25;
  const range = (adx ?? 100) < 18;
  if (range) return "range";
  if (stackedUp) return strong ? "strong_up" : "weak_up";
  if (stackedDn) return strong ? "strong_down" : "weak_down";
  // Mixed structure — call it range unless the fast/slow disagree strongly.
  return "range";
}

function classifyPrevDay(
  po: number | null,
  ph: number | null,
  pl: number | null,
  pc: number | null,
  p2h: number | null,
  p2l: number | null,
): PrevDayBucket | null {
  if (po === null || pc === null || ph === null || pl === null) return null;
  const range = ph - pl;
  if (range <= 0) return null;
  const bodyPct = (Math.abs(pc - po) / range) * 100;
  if (bodyPct < 10) return "doji";
  if (p2h !== null && p2l !== null) {
    if (ph <= p2h && pl >= p2l) return "inside";
    if (ph > p2h && pl < p2l) return "outside";
  }
  return pc > po ? "bullish" : "bearish";
}

/**
 * Build a feature record per DayResult. Buckets are computed from the
 * cross-sectional distribution of the (finite-only) feature values across
 * all trading days — quintiles for 5-bucket features, quartiles for ATR.
 */
export function extractFeatures(days: DayResult[]): TradeFeatures[] {
  // Gather distributions.
  const orSizes: number[] = [];
  const breakDistPctOr: number[] = [];
  const bodyPct: number[] = [];
  const atrVals: number[] = [];
  const maeVals: number[] = [];
  const mfeVals: number[] = [];
  const durVals: number[] = [];
  const ttlVals: number[] = [];
  for (const d of days) {
    const or = d.or_size_usd;
    const atr = (d as unknown as { daily_atr?: number | null }).daily_atr ?? null;
    if (or !== null && Number.isFinite(or)) orSizes.push(or);
    if (atr !== null && Number.isFinite(atr)) atrVals.push(atr);
    if (d.body_pct !== null && Number.isFinite(d.body_pct)) bodyPct.push(d.body_pct);
    if (
      d.break_distance_usd !== null &&
      d.or_size_usd !== null &&
      d.or_size_usd > 0 &&
      Number.isFinite(d.break_distance_usd)
    ) {
      breakDistPctOr.push((d.break_distance_usd / d.or_size_usd) * 100);
    }
    const dr = d as unknown as {
      mae_r?: number | null;
      mfe_r?: number | null;
      duration_bars?: number | null;
      time_to_fill_bars?: number | null;
    };
    if (dr.mae_r !== null && dr.mae_r !== undefined && Number.isFinite(dr.mae_r)) maeVals.push(dr.mae_r);
    if (dr.mfe_r !== null && dr.mfe_r !== undefined && Number.isFinite(dr.mfe_r)) mfeVals.push(dr.mfe_r);
    if (dr.duration_bars !== null && dr.duration_bars !== undefined && Number.isFinite(dr.duration_bars)) durVals.push(dr.duration_bars);
    if (dr.time_to_fill_bars !== null && dr.time_to_fill_bars !== undefined && Number.isFinite(dr.time_to_fill_bars)) ttlVals.push(dr.time_to_fill_bars);
  }
  const sortedOr = [...orSizes].sort((a, b) => a - b);
  const sortedAtr = [...atrVals].sort((a, b) => a - b);
  const orEdges = quintileEdges(orSizes);
  const distEdges = quintileEdges(breakDistPctOr);
  const bodyEdges = quintileEdges(bodyPct);
  const atrEdges = quartileEdges(atrVals);
  const maeEdges = quintileEdges(maeVals);
  const mfeEdges = quintileEdges(mfeVals);
  const durEdges = quintileEdges(durVals);
  const ttlEdges = quintileEdges(ttlVals);

  const out: TradeFeatures[] = [];
  for (const d of days) {
    const daily_atr = (d as unknown as { daily_atr?: number | null }).daily_atr ?? null;
    const ema20 = (d as unknown as { ema20?: number | null }).ema20 ?? null;
    const ema50 = (d as unknown as { ema50?: number | null }).ema50 ?? null;
    const ema100 = (d as unknown as { ema100?: number | null }).ema100 ?? null;
    const ema200 = (d as unknown as { ema200?: number | null }).ema200 ?? null;
    const adx14 = (d as unknown as { adx14?: number | null }).adx14 ?? null;
    const upper_wick_pct = (d as unknown as { upper_wick_pct?: number | null }).upper_wick_pct ?? null;
    const lower_wick_pct = (d as unknown as { lower_wick_pct?: number | null }).lower_wick_pct ?? null;
    const close_position_pct =
      (d as unknown as { close_position_pct?: number | null }).close_position_pct ?? null;
    const candle_range_usd =
      (d as unknown as { candle_range_usd?: number | null }).candle_range_usd ?? null;
    const prev_open = (d as unknown as { prev_open?: number | null }).prev_open ?? null;
    const prev_close = (d as unknown as { prev_close?: number | null }).prev_close ?? null;
    const prev_high = (d as unknown as { prev_high?: number | null }).prev_high ?? null;
    const prev_low = (d as unknown as { prev_low?: number | null }).prev_low ?? null;
    const prev2_high = (d as unknown as { prev2_high?: number | null }).prev2_high ?? null;
    const prev2_low = (d as unknown as { prev2_low?: number | null }).prev2_low ?? null;
    const ex = d as unknown as {
      mae_r?: number | null;
      mfe_r?: number | null;
      duration_bars?: number | null;
      time_to_fill_bars?: number | null;
      retest_count?: number | null;
      break_hour_ist?: number | null;
      weekday?: number | null;
      month?: number | null;
      quarter?: number | null;
      fvg_present?: boolean | null;
      sweep_present?: boolean | null;
    };

    const or = d.or_size_usd;
    const break_dist_pct_or =
      d.break_distance_usd !== null && or !== null && or > 0
        ? (d.break_distance_usd / or) * 100
        : null;
    const break_dist_pct_atr =
      d.break_distance_usd !== null && daily_atr !== null && daily_atr > 0
        ? (d.break_distance_usd / daily_atr) * 100
        : null;
    const or_pct_atr =
      or !== null && daily_atr !== null && daily_atr > 0 ? (or / daily_atr) * 100 : null;

    const or_bucket5 = bucketOf(or, orEdges, QUINTILE_LABELS);
    const break_strength_bucket5 = bucketOf(break_dist_pct_or, distEdges, QUINTILE_LABELS);
    const body_bucket5 = bucketOf(d.body_pct, bodyEdges, QUINTILE_LABELS);
    const atr_bucket4 = bucketOf(daily_atr, atrEdges, QUARTILE_LABELS);
    const price = d.session_open ?? d.break_close ?? d.entry;
    const trend_bucket =
      price !== null ? classifyTrend(price, ema20, ema50, ema200, adx14) : null;
    const prev_day_bucket = classifyPrevDay(
      prev_open,
      prev_high,
      prev_low,
      prev_close,
      prev2_high,
      prev2_low,
    );

    const mae_r = ex.mae_r ?? null;
    const mfe_r = ex.mfe_r ?? null;
    const duration_bars = ex.duration_bars ?? null;
    const time_to_fill_bars = ex.time_to_fill_bars ?? null;

    out.push({
      ist_date: d.ist_date,
      side: d.break_side,
      outcome: d.outcome,
      pnl_usd: Number.isFinite(d.pnl_usd) ? d.pnl_usd : 0,
      or_size_usd: or,
      or_size_pct_atr: or_pct_atr,
      or_size_percentile: percentileRank(or, sortedOr),
      break_distance_usd: d.break_distance_usd,
      break_distance_pct_or: break_dist_pct_or,
      break_distance_pct_atr: break_dist_pct_atr,
      body_pct: d.body_pct,
      upper_wick_pct,
      lower_wick_pct,
      close_position_pct,
      candle_range_usd,
      daily_atr,
      atr_percentile: percentileRank(daily_atr, sortedAtr),
      ema20,
      ema50,
      ema100,
      ema200,
      adx14,
      prev_open,
      prev_close,
      prev_high,
      prev_low,
      prev_range: prev_high !== null && prev_low !== null ? prev_high - prev_low : null,
      or_bucket5,
      break_strength_bucket5,
      body_bucket5,
      atr_bucket4,
      trend_bucket,
      prev_day_bucket,
      mae_r,
      mfe_r,
      duration_bars,
      time_to_fill_bars,
      retest_count: ex.retest_count ?? null,
      break_hour_ist: ex.break_hour_ist ?? null,
      weekday: (d as unknown as { weekday?: number | null }).weekday ?? null,
      month: ex.month ?? null,
      quarter: ex.quarter ?? null,
      fvg_present: ex.fvg_present ?? null,
      sweep_present: ex.sweep_present ?? null,
      mae_bucket5: bucketOf(mae_r, maeEdges, QUINTILE_LABELS),
      mfe_bucket5: bucketOf(mfe_r, mfeEdges, QUINTILE_LABELS),
      duration_bucket5: bucketOf(duration_bars, durEdges, QUINTILE_LABELS),
      ttl_bucket5: bucketOf(time_to_fill_bars, ttlEdges, QUINTILE_LABELS),
    });
  }
  return out;
}

/** Bucket label lookup for a given filter id + bucket key. */
export function labelForBucket(kind: "quintile" | "quartile" | "trend" | "prev_day", key: string): string {
  if (kind === "quintile") return QUINTILE_LABEL_MAP[key as QuintileBucket] ?? key;
  if (kind === "quartile") return QUARTILE_LABEL_MAP[key as QuartileBucket] ?? key;
  if (kind === "trend") return TREND_LABEL_MAP[key as TrendBucket] ?? key;
  if (kind === "prev_day") return PREV_DAY_LABEL_MAP[key as PrevDayBucket] ?? key;
  return key;
}
