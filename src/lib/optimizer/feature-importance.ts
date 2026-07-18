// Feature-importance engine — variance-reduction (Gini-like) & correlation
// against net PnL. Ranks every numeric & categorical feature.
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { extractFeatures, allNumericKeys, allCategoricalKeys } from "./dimensions";

export interface FeatureImportance {
  feature: string;
  kind: "numeric" | "categorical";
  score: number;      // 0-1 normalized
  bestSlice: string;
  bestScore: number;
  worstSlice: string;
  worstScore: number;
  spread: number;
}

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  const den = Math.sqrt(dx * dy);
  return den ? num / den : 0;
}

export function featureImportance(rows: TradeRecord[]): FeatureImportance[] {
  const fvs = rows.map(extractFeatures);
  const y = rows.map((t) => t.netPnl);
  const out: FeatureImportance[] = [];

  for (const key of allNumericKeys(fvs)) {
    const x = fvs.map((f) => f.numeric[key] ?? 0);
    const r = Math.abs(pearson(x, y));
    // slice by median
    const median = [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)];
    const hi = y.filter((_, i) => x[i] >= median);
    const lo = y.filter((_, i) => x[i] < median);
    const hiMean = hi.length ? hi.reduce((s, v) => s + v, 0) / hi.length : 0;
    const loMean = lo.length ? lo.reduce((s, v) => s + v, 0) / lo.length : 0;
    out.push({
      feature: key, kind: "numeric", score: r,
      bestSlice: hiMean > loMean ? `>= ${median.toFixed(2)}` : `< ${median.toFixed(2)}`,
      bestScore: Math.max(hiMean, loMean),
      worstSlice: hiMean > loMean ? `< ${median.toFixed(2)}` : `>= ${median.toFixed(2)}`,
      worstScore: Math.min(hiMean, loMean),
      spread: Math.abs(hiMean - loMean),
    });
  }
  for (const key of allCategoricalKeys(fvs)) {
    const groups = new Map<string, number[]>();
    fvs.forEach((f, i) => {
      const k = f.categorical[key] ?? "unknown";
      const arr = groups.get(k) ?? []; arr.push(y[i]); groups.set(k, arr);
    });
    if (groups.size < 2) continue;
    let best = { k: "", v: -Infinity }, worst = { k: "", v: Infinity };
    for (const [k, arr] of groups) {
      const m = arr.reduce((s, v) => s + v, 0) / arr.length;
      if (m > best.v) best = { k, v: m };
      if (m < worst.v) worst = { k, v: m };
    }
    const spread = best.v - worst.v;
    out.push({
      feature: key, kind: "categorical",
      score: 0, // set after normalization pass
      bestSlice: best.k, bestScore: best.v,
      worstSlice: worst.k, worstScore: worst.v, spread,
    });
  }
  // Normalize spread → 0-1 for categoricals; combine with r for numerics.
  const maxSpread = Math.max(...out.map((r) => r.spread), 1);
  return out
    .map((r) => ({ ...r, score: r.kind === "numeric" ? (r.score + r.spread / maxSpread) / 2 : r.spread / maxSpread }))
    .sort((a, b) => b.score - a.score);
}
