// Sweet-spot analytics: bucket a numeric feature (ATR, ADX, ATR percentile,
// MAE, MFE, holding) into quintiles and surface the range with the best
// expectancy. Also emits Insight rows for the strongest buckets.

import type { DerivedFeatures } from "./features-ext";
import type { Insight } from "./types";
import { mean } from "./stats";

export interface Bucket {
  key: string;
  label: string;
  lo: number;
  hi: number;
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  expectancy: number;
  netPnl: number;
  avgR: number;
  profitFactor: number;
  isSweetSpot: boolean;
}

export interface SweetSpotAnalysis {
  id: string;              // stable id, e.g. "atr", "adx"
  label: string;           // display label
  unit?: string;
  totalSamples: number;
  baselineExpectancy: number;
  sweetSpot: Bucket | null;
  buckets: Bucket[];
}

function quintileEdges(vals: number[]): number[] | null {
  const s = vals.filter((v) => Number.isFinite(v) && v !== 0).sort((a, b) => a - b);
  if (s.length < 10) return null;
  const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
  return [q(0.2), q(0.4), q(0.6), q(0.8)];
}

function bucketIndex(v: number, edges: number[]): number {
  for (let i = 0; i < edges.length; i++) if (v <= edges[i]) return i;
  return edges.length;
}

function fmt(n: number, unit?: string): string {
  const s = Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2);
  return unit ? `${s}${unit}` : s;
}

export function bucketPerformance(
  features: DerivedFeatures[],
  accessor: (r: DerivedFeatures) => number,
  id: string,
  label: string,
  unit?: string,
): SweetSpotAnalysis {
  const usable = features.filter((r) => Number.isFinite(accessor(r)) && accessor(r) !== 0);
  const vals = usable.map(accessor);
  const edges = quintileEdges(vals);
  const baseline = mean(features.map((r) => r.netPnl));
  if (!edges || usable.length < 10) {
    return {
      id, label, unit,
      totalSamples: usable.length,
      baselineExpectancy: baseline,
      sweetSpot: null,
      buckets: [],
    };
  }
  const bucketRows: DerivedFeatures[][] = [[], [], [], [], []];
  for (const r of usable) bucketRows[bucketIndex(accessor(r), edges)].push(r);

  const boundaries = [-Infinity, ...edges, Infinity];
  const labels = ["Very Low", "Low", "Medium", "High", "Very High"];
  const buckets: Bucket[] = bucketRows.map((rows, i) => {
    const wins = rows.filter((r) => r.win).length;
    const losses = rows.length - wins;
    const net = rows.reduce((s, r) => s + r.netPnl, 0);
    const winsSum = rows.filter((r) => r.win).reduce((s, r) => s + r.netPnl, 0);
    const lossSum = Math.abs(rows.filter((r) => !r.win).reduce((s, r) => s + r.netPnl, 0));
    return {
      key: `q${i + 1}`,
      label: `${labels[i]} (${fmt(boundaries[i] === -Infinity ? (rows[0] ? accessor(rows[0]) : 0) : boundaries[i], unit)}–${fmt(boundaries[i + 1] === Infinity ? (rows[rows.length - 1] ? accessor(rows[rows.length - 1]) : 0) : boundaries[i + 1], unit)})`,
      lo: boundaries[i],
      hi: boundaries[i + 1],
      count: rows.length,
      wins,
      losses,
      winRate: rows.length ? wins / rows.length : 0,
      expectancy: rows.length ? net / rows.length : 0,
      netPnl: net,
      avgR: mean(rows.map((r) => r.rr)),
      profitFactor: lossSum > 0 ? winsSum / lossSum : winsSum > 0 ? 999 : 0,
      isSweetSpot: false,
    };
  });

  const eligible = buckets.filter((b) => b.count >= 5);
  let sweet: Bucket | null = null;
  if (eligible.length) {
    sweet = [...eligible].sort((a, b) => b.expectancy - a.expectancy)[0];
    if (sweet) sweet.isSweetSpot = true;
  }
  return {
    id, label, unit,
    totalSamples: usable.length,
    baselineExpectancy: baseline,
    sweetSpot: sweet,
    buckets,
  };
}

const DIMENSIONS: Array<{ id: string; label: string; unit?: string; get: (r: DerivedFeatures) => number }> = [
  { id: "atr", label: "ATR at entry", unit: "", get: (r) => r.atr },
  { id: "adx", label: "ADX at entry", unit: "", get: (r) => r.adx },
  { id: "atr_pct", label: "ATR percentile", unit: "%", get: (r) => r.atrPercentile },
  { id: "mae", label: "Max Adverse Excursion", unit: "R", get: (r) => r.mae },
  { id: "mfe", label: "Max Favourable Excursion", unit: "R", get: (r) => r.mfe },
  { id: "holding_min", label: "Holding time", unit: "m", get: (r) => r.holdingMs / 60000 },
];

export function sweetSpotAnalyses(features: DerivedFeatures[]): SweetSpotAnalysis[] {
  return DIMENSIONS.map((d) => bucketPerformance(features, d.get, d.id, d.label, d.unit));
}

export function sweetSpotInsights(features: DerivedFeatures[]): Insight[] {
  if (features.length < 20) return [];
  const analyses = sweetSpotAnalyses(features);
  const baseline = mean(features.map((r) => r.netPnl));
  const out: Insight[] = [];
  for (const a of analyses) {
    if (!a.sweetSpot) continue;
    const s = a.sweetSpot;
    const delta = s.expectancy - baseline;
    if (s.count < 5) continue;
    const strong = baseline !== 0 && s.expectancy > baseline * 1.5;
    out.push({
      id: `sweet-${a.id}`,
      kind: "edge",
      severity: strong ? "positive" : "info",
      title: `Sweet spot on ${a.label}: ${s.label}`,
      summary: `${s.count} trades, ${(s.winRate * 100).toFixed(1)}% win, expectancy ${s.expectancy.toFixed(2)} vs baseline ${baseline.toFixed(2)} (Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}).`,
      evidence: {
        sampleSize: s.count,
        metric: "expectancy",
        metricValue: s.expectancy,
        baselineValue: baseline,
        delta,
      },
      tags: ["sweet_spot", a.id],
    });
    // Warning for worst bucket if clearly negative
    const worst = [...a.buckets].filter((b) => b.count >= 5).sort((x, y) => x.expectancy - y.expectancy)[0];
    if (worst && worst.expectancy < 0 && worst.key !== s.key) {
      out.push({
        id: `sweet-${a.id}-avoid`,
        kind: "failure",
        severity: "warning",
        title: `Avoid ${a.label}: ${worst.label}`,
        summary: `${worst.count} trades, ${(worst.winRate * 100).toFixed(1)}% win, expectancy ${worst.expectancy.toFixed(2)}, net ${worst.netPnl.toFixed(2)}.`,
        evidence: {
          sampleSize: worst.count,
          metric: "expectancy",
          metricValue: worst.expectancy,
          baselineValue: baseline,
          delta: worst.expectancy - baseline,
        },
        tags: ["avoid", a.id],
      });
    }
  }
  return out;
}
