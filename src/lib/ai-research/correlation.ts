// Numeric feature correlation matrix + top strongest relationships.

import type { DerivedFeatures } from "./features-ext";
import type { Insight } from "./types";
import { pearson } from "./stats";

const COLS: Array<{ key: keyof DerivedFeatures; label: string }> = [
  { key: "netPnl", label: "Net P&L" },
  { key: "rr", label: "Realized RR" },
  { key: "mae", label: "MAE" },
  { key: "mfe", label: "MFE" },
  { key: "holdingMs", label: "Holding" },
  { key: "fillDelayMs", label: "Fill delay" },
  { key: "hourUtc", label: "Hour" },
  { key: "atr", label: "ATR" },
  { key: "volumeZ", label: "Volume z" },
  { key: "bodyPct", label: "Body %" },
];

export interface CorrelationCell { a: string; b: string; r: number }

export function correlationMatrix(features: DerivedFeatures[]): CorrelationCell[] {
  const cells: CorrelationCell[] = [];
  for (let i = 0; i < COLS.length; i++) {
    for (let j = i + 1; j < COLS.length; j++) {
      const xs = features.map((f) => Number(f[COLS[i].key]) || 0);
      const ys = features.map((f) => Number(f[COLS[j].key]) || 0);
      cells.push({ a: COLS[i].label, b: COLS[j].label, r: pearson(xs, ys) });
    }
  }
  return cells.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}

export function correlationInsights(features: DerivedFeatures[]): Insight[] {
  const cells = correlationMatrix(features).filter((c) => Math.abs(c.r) >= 0.35).slice(0, 5);
  return cells.map((c) => ({
    id: `corr-${c.a}-${c.b}`,
    kind: "correlation",
    severity: "info",
    title: `${c.a} ↔ ${c.b}: r=${c.r.toFixed(2)}`,
    summary: `Correlation coefficient ${c.r.toFixed(3)} over ${features.length} trades. ${Math.abs(c.r) >= 0.6 ? "Strong" : "Moderate"} ${c.r > 0 ? "positive" : "negative"} relationship.`,
    evidence: { sampleSize: features.length, metric: "pearson_r", metricValue: c.r },
    tags: ["correlation"],
  }));
}
