// AI Grading Engine — learns from historical trades to score & grade candidate
// setups. Post-hoc, deterministic, no external ML deps. Uses per-bucket
// expectancy (avg $ pnl per decided trade) as a weight-of-evidence model
// (naive-Bayes-ish). At scoring time we sum the expectancy of the buckets a
// candidate falls into, normalize to 0–100, then map to a grade tier.
//
// Grades and default risk multipliers:
//   A+++  (top 5%)   → 2.0x risk
//   A++   (next 10%) → 1.5x
//   A+    (next 15%) → 1.25x
//   A     (next 30%) → 1.0x  (baseline)
//   B     (next 30%) → 0.5x
//   C     (bottom 10%) → 0.0x  (skip)

import type { TradeFeatures } from "./features";
import { FILTERS, type FilterId } from "./filters";

export const GRADE_ORDER = ["A+++", "A++", "A+", "A", "B", "C"] as const;
export type GradeLabel = (typeof GRADE_ORDER)[number];

export const DEFAULT_RISK_MULTIPLIERS: Record<GradeLabel, number> = {
  "A+++": 2.0,
  "A++": 1.5,
  "A+": 1.25,
  A: 1.0,
  B: 0.5,
  C: 0.0,
};

/**
 * Absolute per-grade SL risk in USD. This is the source of truth for
 * position sizing when AI grading is enabled — the live engine and
 * backtester both size trades to lose exactly this much on stop-out,
 * bypassing the legacy multiplier-based approach.
 * C-grade stays at 0 (skip).
 */
export const GRADE_RISK_USD: Record<GradeLabel, number> = {
  "A+++": 40,
  "A++": 35,
  "A+": 30,
  A: 28,
  B: 25,
  C: 0,
};

// Percentile share (in 0..1) for each grade, top-down.
const GRADE_SHARES: Array<[GradeLabel, number]> = [
  ["A+++", 0.05],
  ["A++", 0.1],
  ["A+", 0.15],
  ["A", 0.3],
  ["B", 0.3],
  ["C", 0.1],
];

// Numeric filters whose buckets require training-time percentile edges.
// We store the numeric field they come from so we can re-bucketize live values.
const NUMERIC_FILTER_ACCESSORS: Partial<
  Record<FilterId, (f: Partial<TradeFeatures>) => number | null | undefined>
> = {
  or_size: (f) => f.or_size_usd,
  break_strength: (f) => f.break_distance_pct_or,
  candle_body: (f) => f.body_pct,
  atr_regime: (f) => f.daily_atr,
  mae: (f) => f.mae_r,
  mfe: (f) => f.mfe_r,
  duration: (f) => f.duration_bars,
  time_to_fill: (f) => f.time_to_fill_bars,
};

export interface GradingModel {
  version: 1;
  trained_at: number;
  symbol: string | null;
  sample_size: number;
  /** expectancy ($ per decided trade) per `filterId::bucket`. */
  bucketExpectancy: Record<string, number>;
  /** win rate (0..100) per `filterId::bucket`. */
  bucketWinRate: Record<string, number>;
  /** sample count per `filterId::bucket`. */
  bucketCount: Record<string, number>;
  /** Percentile edges (5 values → 4 buckets, 4 values → 3 buckets etc.) per numeric filter. */
  edges: Partial<Record<FilterId, number[]>>;
  /** Score cutoffs: score >= cutoff of grade G means that grade. */
  thresholds: Record<GradeLabel, number>;
  /** Score-normalization anchors. */
  scoreMin: number;
  scoreMax: number;
}

const DECIDED = new Set<TradeFeatures["outcome"]>(["tp", "sl"]);

function bucketFromEdges(value: number | null | undefined, edges: number[], labels: string[]): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (edges.length < 2 || labels.length === 0) return null;
  for (let i = 0; i < labels.length; i++) {
    const hi = edges[i + 1];
    if (value <= hi) return labels[i];
  }
  return labels[labels.length - 1];
}

function computeEdgesFromValues(values: number[], buckets: number): number[] {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const edges = [sorted[0]];
  for (let i = 1; i < buckets; i++) {
    const idx = Math.floor((sorted.length * i) / buckets);
    edges.push(sorted[Math.min(idx, sorted.length - 1)]);
  }
  edges.push(sorted[sorted.length - 1]);
  return edges;
}

/** Compute the raw expectancy-sum score for a set of bucket tags. */
function rawScoreFromTags(tags: Partial<Record<FilterId, string | null>>, model: GradingModel): number {
  let sum = 0;
  let n = 0;
  for (const def of FILTERS) {
    const bucket = tags[def.id];
    if (bucket === null || bucket === undefined) continue;
    const key = `${def.id}::${bucket}`;
    const v = model.bucketExpectancy[key];
    if (v === undefined) continue;
    sum += v;
    n += 1;
  }
  return n > 0 ? sum / n : 0;
}

function normalize(raw: number, min: number, max: number): number {
  if (!Number.isFinite(raw)) return 50;
  if (max - min < 1e-9) return 50;
  const s = ((raw - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, Math.round(s)));
}

function gradeFromScore(score: number, thresholds: Record<GradeLabel, number>): GradeLabel {
  for (const g of GRADE_ORDER) {
    if (score >= thresholds[g]) return g;
  }
  return "C";
}

export interface TrainOptions {
  symbol?: string | null;
  /** Minimum decided trades required per bucket to trust its expectancy (else 0). */
  minSamplesPerBucket?: number;
}

export function trainGradingModel(features: TradeFeatures[], opts: TrainOptions = {}): GradingModel {
  const minSamples = opts.minSamplesPerBucket ?? 3;
  const decided = features.filter((f) => DECIDED.has(f.outcome));

  // 1) bucket expectancy tables using each filter's tag()
  const bucketExpectancy: Record<string, number> = {};
  const bucketWinRate: Record<string, number> = {};
  const bucketCount: Record<string, number> = {};
  for (const def of FILTERS) {
    for (const b of def.buckets) {
      const sub = decided.filter((f) => def.tag(f) === b);
      const n = sub.length;
      bucketCount[`${def.id}::${b}`] = n;
      if (n >= minSamples) {
        const wins = sub.filter((f) => f.pnl_usd > 0).length;
        const expectancy = sub.reduce((a, f) => a + f.pnl_usd, 0) / n;
        bucketExpectancy[`${def.id}::${b}`] = expectancy;
        bucketWinRate[`${def.id}::${b}`] = (wins / n) * 100;
      } else {
        bucketExpectancy[`${def.id}::${b}`] = 0;
        bucketWinRate[`${def.id}::${b}`] = 0;
      }
    }
  }

  // 2) Store percentile edges for numeric filters so live scoring can re-bucket.
  const edges: Partial<Record<FilterId, number[]>> = {};
  for (const [fid, accessor] of Object.entries(NUMERIC_FILTER_ACCESSORS) as Array<
    [FilterId, (f: Partial<TradeFeatures>) => number | null | undefined]
  >) {
    const values: number[] = [];
    for (const f of features) {
      const v = accessor(f);
      if (v !== null && v !== undefined && Number.isFinite(v)) values.push(v);
    }
    const def = FILTERS.find((d) => d.id === fid);
    if (!def || values.length === 0) continue;
    edges[fid] = computeEdgesFromValues(values, def.buckets.length);
  }

  // 3) Compute raw scores over training set, then thresholds via percentiles.
  const rawScores = features.map((f) => {
    const tags: Partial<Record<FilterId, string | null>> = {};
    for (const def of FILTERS) tags[def.id] = def.tag(f);
    return rawScoreFromTags(tags, {
      version: 1,
      trained_at: 0,
      symbol: null,
      sample_size: 0,
      bucketExpectancy,
      bucketWinRate,
      bucketCount,
      edges,
      thresholds: { "A+++": 0, "A++": 0, "A+": 0, A: 0, B: 0, C: 0 },
      scoreMin: 0,
      scoreMax: 1,
    });
  });
  const scoreMin = rawScores.length ? Math.min(...rawScores) : 0;
  const scoreMax = rawScores.length ? Math.max(...rawScores) : 1;
  const normalized = rawScores.map((r) => normalize(r, scoreMin, scoreMax));
  const sortedDesc = [...normalized].sort((a, b) => b - a);

  const thresholds: Record<GradeLabel, number> = {
    "A+++": 100,
    "A++": 100,
    "A+": 100,
    A: 100,
    B: 100,
    C: 0,
  };
  let cumIdx = 0;
  for (const [grade, share] of GRADE_SHARES) {
    if (grade === "C") {
      thresholds[grade] = 0;
      continue;
    }
    cumIdx += Math.max(1, Math.round(sortedDesc.length * share));
    const idx = Math.min(cumIdx, sortedDesc.length) - 1;
    thresholds[grade] = sortedDesc[Math.max(0, idx)] ?? 0;
  }

  return {
    version: 1,
    trained_at: Date.now(),
    symbol: opts.symbol ?? null,
    sample_size: decided.length,
    bucketExpectancy,
    bucketWinRate,
    bucketCount,
    edges,
    thresholds,
    scoreMin,
    scoreMax,
  };
}

export interface ScoredTrade {
  ist_date: string;
  outcome: TradeFeatures["outcome"];
  pnl_usd: number;
  score: number;
  grade: GradeLabel;
}

export function scoreTrades(features: TradeFeatures[], model: GradingModel): ScoredTrade[] {
  return features.map((f) => {
    const tags: Partial<Record<FilterId, string | null>> = {};
    for (const def of FILTERS) tags[def.id] = def.tag(f);
    const raw = rawScoreFromTags(tags, model);
    const score = normalize(raw, model.scoreMin, model.scoreMax);
    return {
      ist_date: f.ist_date,
      outcome: f.outcome,
      pnl_usd: f.pnl_usd,
      score,
      grade: gradeFromScore(score, model.thresholds),
    };
  });
}

/**
 * Live scoring: caller supplies a partial feature record. Numeric fields are
 * bucketed via stored `edges`; categorical fields are used as-is.
 */
export function scoreCandidate(
  candidate: Partial<TradeFeatures>,
  model: GradingModel,
): { score: number; grade: GradeLabel; riskMultiplier: number; tags: Partial<Record<FilterId, string | null>> } {
  const tags: Partial<Record<FilterId, string | null>> = {};
  for (const def of FILTERS) {
    // Numeric filters → derive bucket from stored edges.
    if (NUMERIC_FILTER_ACCESSORS[def.id]) {
      const accessor = NUMERIC_FILTER_ACCESSORS[def.id]!;
      const value = accessor(candidate) ?? null;
      const eds = model.edges[def.id];
      tags[def.id] = eds && value !== null ? bucketFromEdges(value, eds, def.buckets) : null;
      continue;
    }
    // Categorical filters → use def.tag if candidate has enough fields; else try raw casts.
    try {
      tags[def.id] = def.tag(candidate as TradeFeatures);
    } catch {
      tags[def.id] = null;
    }
  }
  const raw = rawScoreFromTags(tags, model);
  const score = normalize(raw, model.scoreMin, model.scoreMax);
  const grade = gradeFromScore(score, model.thresholds);
  return { score, grade, riskMultiplier: DEFAULT_RISK_MULTIPLIERS[grade], tags };
}

export interface GradeStatRow {
  grade: GradeLabel;
  count: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  expectancy_usd: number;
  net_pnl_usd: number;
  avg_score: number;
}

export function gradeStats(scored: ScoredTrade[]): GradeStatRow[] {
  return GRADE_ORDER.map((g) => {
    const rows = scored.filter((s) => s.grade === g && DECIDED.has(s.outcome));
    const wins = rows.filter((r) => r.pnl_usd > 0).length;
    const losses = rows.length - wins;
    const net = rows.reduce((a, r) => a + r.pnl_usd, 0);
    const avgScore = rows.length ? rows.reduce((a, r) => a + r.score, 0) / rows.length : 0;
    return {
      grade: g,
      count: rows.length,
      wins,
      losses,
      win_rate_pct: rows.length ? (wins / rows.length) * 100 : 0,
      expectancy_usd: rows.length ? net / rows.length : 0,
      net_pnl_usd: net,
      avg_score: avgScore,
    };
  });
}

/**
 * Re-simulate equity if we had applied per-grade risk multipliers (and skipped
 * grades whose multiplier is 0 or below a min-grade gate).
 */
export function simulateWithGrading(
  scored: ScoredTrade[],
  multipliers: Record<GradeLabel, number>,
  minGrade: GradeLabel | null = null,
): { net_pnl_usd: number; trades: number; win_rate_pct: number; equity: Array<{ ist_date: string; equity: number }> } {
  const minRank = minGrade ? GRADE_ORDER.indexOf(minGrade) : Infinity;
  let equity = 0;
  let wins = 0;
  let trades = 0;
  const curve: Array<{ ist_date: string; equity: number }> = [];
  for (const s of scored.filter((r) => DECIDED.has(r.outcome))) {
    const rank = GRADE_ORDER.indexOf(s.grade);
    if (rank > minRank) continue;
    const mult = multipliers[s.grade] ?? 0;
    if (mult <= 0) continue;
    const pnl = s.pnl_usd * mult;
    equity += pnl;
    if (pnl > 0) wins += 1;
    trades += 1;
    curve.push({ ist_date: s.ist_date, equity });
  }
  return {
    net_pnl_usd: equity,
    trades,
    win_rate_pct: trades ? (wins / trades) * 100 : 0,
    equity: curve,
  };
}
