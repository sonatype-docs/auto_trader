// Pattern discovery: repeated 2-token slice combinations with above-average
// expectancy. Confidence = 1 - p (t-test vs baseline).

import type { DerivedFeatures } from "./features-ext";
import type { Insight } from "./types";
import { mean, welchT } from "./stats";

const DIMS: Array<{ name: string; label: string; get: (r: DerivedFeatures) => string }> = [
  { name: "session", label: "Session", get: (r) => r.session },
  { name: "regime", label: "Regime", get: (r) => r.regime },
  { name: "direction", label: "Direction", get: (r) => r.direction },
  { name: "fvg", label: "FVG", get: (r) => (r.fvgPresent ? "yes" : "no") },
  { name: "sweep", label: "Sweep", get: (r) => (r.sweepPresent ? "yes" : "no") },
  { name: "entry", label: "Entry", get: (r) => r.entryType },
];

export interface Pattern {
  key: string;
  n: number;
  expectancy: number;
  baseline: number;
  win: number;
  pValue: number;
  confidence: number;
}

export function discoverPatterns(features: DerivedFeatures[], minN = 8): Pattern[] {
  if (features.length < 30) return [];
  const baseNet = features.map((r) => r.netPnl);
  const baseExp = mean(baseNet);
  const patterns: Pattern[] = [];
  for (let i = 0; i < DIMS.length; i++) {
    for (let j = i + 1; j < DIMS.length; j++) {
      const map = new Map<string, DerivedFeatures[]>();
      for (const r of features) {
        const k = `${DIMS[i].label}=${DIMS[i].get(r)} ∧ ${DIMS[j].label}=${DIMS[j].get(r)}`;
        const arr = map.get(k) ?? []; arr.push(r); map.set(k, arr);
      }
      for (const [key, rows] of map) {
        if (rows.length < minN) continue;
        const inNet = rows.map((r) => r.netPnl);
        const outside = features.filter((r) => !rows.includes(r)).map((r) => r.netPnl);
        const tt = welchT(inNet, outside);
        patterns.push({
          key, n: rows.length,
          expectancy: mean(inNet),
          baseline: baseExp,
          win: rows.filter((r) => r.win).length / rows.length,
          pValue: tt.p,
          confidence: 1 - tt.p,
        });
      }
    }
  }
  return patterns.filter((p) => p.confidence >= 0.85).sort((a, b) => b.expectancy - a.expectancy).slice(0, 12);
}

export function patternInsights(features: DerivedFeatures[]): Insight[] {
  return discoverPatterns(features).map((p) => ({
    id: `pattern-${p.key}`,
    kind: "pattern",
    severity: p.expectancy > p.baseline ? "positive" : "warning",
    title: `Pattern: ${p.key} → expectancy ${p.expectancy.toFixed(2)}`,
    summary: `${p.n} trades, win ${(p.win * 100).toFixed(1)}%, baseline ${p.baseline.toFixed(2)}. p=${p.pValue.toFixed(3)}.`,
    evidence: { sampleSize: p.n, metric: "expectancy", metricValue: p.expectancy, baselineValue: p.baseline, delta: p.expectancy - p.baseline, pValue: p.pValue, confidence: p.confidence },
    tags: ["pattern"],
  }));
}
