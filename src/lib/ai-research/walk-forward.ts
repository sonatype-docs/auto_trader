// Walk-forward stability: split chronologically into folds and compare
// per-fold expectancy / win rate to detect drift.

import type { DerivedFeatures } from "./features-ext";
import type { Insight } from "./types";
import { mean, std } from "./stats";

export interface Fold {
  index: number;
  count: number;
  net: number;
  win: number;
  expectancy: number;
}

export function walkForward(features: DerivedFeatures[], folds = 5): Fold[] {
  if (features.length < folds * 5) return [];
  const size = Math.floor(features.length / folds);
  const out: Fold[] = [];
  for (let i = 0; i < folds; i++) {
    const start = i * size;
    const end = i === folds - 1 ? features.length : start + size;
    const chunk = features.slice(start, end);
    out.push({
      index: i + 1,
      count: chunk.length,
      net: chunk.reduce((s, r) => s + r.netPnl, 0),
      win: chunk.length ? chunk.filter((r) => r.win).length / chunk.length : 0,
      expectancy: mean(chunk.map((r) => r.netPnl)),
    });
  }
  return out;
}

export function walkForwardInsights(features: DerivedFeatures[]): Insight[] {
  const folds = walkForward(features, 5);
  if (folds.length < 2) return [];
  const exp = folds.map((f) => f.expectancy);
  const s = std(exp);
  const m = mean(exp);
  const cv = m !== 0 ? Math.abs(s / m) : Infinity;
  const positive = folds.filter((f) => f.net > 0).length;
  return [{
    id: "wf-summary",
    kind: "walk_forward",
    severity: cv > 1 ? "warning" : "info",
    title: `Walk-forward: ${positive}/${folds.length} folds positive, expectancy CV ${cv.toFixed(2)}`,
    summary: `Fold expectancies: ${folds.map((f) => f.expectancy.toFixed(2)).join(" / ")}. High CV signals unstable edge across time.`,
    evidence: { sampleSize: features.length, metric: "expectancy_cv", metricValue: cv },
    tags: ["walk_forward"],
  }];
}
