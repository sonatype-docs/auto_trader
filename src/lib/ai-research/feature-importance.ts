// Feature importance via variance-reduction (regression on netPnl) and
// mutual information over win/loss labels for categorical features.

import type { DerivedFeatures } from "./features-ext";
import type { Insight } from "./types";
import { mean, variance } from "./stats";

interface Ranked { feature: string; label: string; score: number; kind: "numeric" | "categorical"; sampleSize: number }

const NUMERIC: Array<{ key: keyof DerivedFeatures; label: string }> = [
  { key: "mae", label: "MAE" },
  { key: "mfe", label: "MFE" },
  { key: "holdingMs", label: "Holding time" },
  { key: "fillDelayMs", label: "Fill delay" },
  { key: "hourUtc", label: "Hour" },
  { key: "atr", label: "ATR" },
  { key: "volumeZ", label: "Volume z" },
  { key: "bodyPct", label: "Body %" },
  { key: "rr", label: "Realized RR" },
];
const CATEGORICAL: Array<{ key: keyof DerivedFeatures; label: string }> = [
  { key: "session", label: "Session" },
  { key: "regime", label: "Regime" },
  { key: "direction", label: "Direction" },
  { key: "weekday", label: "Weekday" },
  { key: "month", label: "Month" },
  { key: "exitReason", label: "Exit reason" },
  { key: "entryType", label: "Entry type" },
  { key: "stopType", label: "Stop type" },
  { key: "targetType", label: "Target type" },
  { key: "fvgPresent", label: "FVG present" },
  { key: "sweepPresent", label: "Sweep present" },
];

/** Categorical variance reduction: 1 - Σ (n_g/n) * var_g / var_all. */
function categoricalScore(rows: DerivedFeatures[], key: keyof DerivedFeatures): number {
  const y = rows.map((r) => r.netPnl);
  const vAll = variance(y);
  if (vAll <= 0) return 0;
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[key]);
    const arr = groups.get(k) ?? [];
    arr.push(r.netPnl);
    groups.set(k, arr);
  }
  let weighted = 0;
  for (const arr of groups.values()) weighted += (arr.length / rows.length) * variance(arr);
  return Math.max(0, 1 - weighted / vAll);
}

/** Numeric feature score: |Pearson-like|² using bucketing (quintiles). */
function numericScore(rows: DerivedFeatures[], key: keyof DerivedFeatures): number {
  const vals = rows.map((r) => Number(r[key])).filter((v) => Number.isFinite(v));
  if (vals.length < 10) return 0;
  const y = rows.map((r) => r.netPnl);
  const vAll = variance(y);
  if (vAll <= 0) return 0;
  // Bucket into quintiles by feature value; measure between-group variance share.
  const paired = rows.map((r) => ({ x: Number(r[key]), y: r.netPnl })).filter((p) => Number.isFinite(p.x));
  paired.sort((a, b) => a.x - b.x);
  const buckets: number[][] = [[], [], [], [], []];
  paired.forEach((p, i) => buckets[Math.min(4, Math.floor((i / paired.length) * 5))].push(p.y));
  let weighted = 0;
  for (const b of buckets) if (b.length) weighted += (b.length / paired.length) * variance(b);
  return Math.max(0, 1 - weighted / vAll);
}

export function rankFeatures(features: DerivedFeatures[]): Ranked[] {
  if (features.length < 15) return [];
  const out: Ranked[] = [];
  for (const c of CATEGORICAL) {
    out.push({ feature: String(c.key), label: c.label, score: categoricalScore(features, c.key), kind: "categorical", sampleSize: features.length });
  }
  for (const n of NUMERIC) {
    out.push({ feature: String(n.key), label: n.label, score: numericScore(features, n.key), kind: "numeric", sampleSize: features.length });
  }
  return out.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
}

export function featureImportanceInsights(features: DerivedFeatures[]): Insight[] {
  const ranked = rankFeatures(features).slice(0, 5);
  return ranked.map((r) => ({
    id: `feat-${r.feature}`,
    kind: "feature",
    severity: "info",
    title: `${r.label} explains ${(r.score * 100).toFixed(1)}% of P&L variance`,
    summary: `${r.label} (${r.kind}) — importance score ${r.score.toFixed(3)} across ${r.sampleSize} trades.`,
    evidence: { sampleSize: r.sampleSize, metric: "variance_reduction", metricValue: r.score },
    tags: [r.feature],
  }));
}

export { mean };
