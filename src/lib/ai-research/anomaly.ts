// Anomaly detection: |z| >= 3 on P&L, slippage, fill delay, MAE/MFE.

import type { TradeRecord } from "@/lib/trade-intelligence/types";
import type { DerivedFeatures } from "./features-ext";
import type { Insight } from "./types";
import { std, mean } from "./stats";

export interface Anomaly {
  tradeId: string;
  metric: string;
  value: number;
  z: number;
  when: number;
}

export function detectAnomalies(features: DerivedFeatures[], trades: TradeRecord[]): Anomaly[] {
  const byId = new Map(trades.map((t) => [t.tradeId, t]));
  const metrics: Array<{ name: string; get: (f: DerivedFeatures, t?: TradeRecord) => number }> = [
    { name: "netPnl", get: (f) => f.netPnl },
    { name: "mae", get: (f) => f.mae },
    { name: "mfe", get: (f) => f.mfe },
    { name: "fillDelayMs", get: (f) => f.fillDelayMs },
    { name: "slippage", get: (_, t) => t?.slippage ?? 0 },
  ];
  const out: Anomaly[] = [];
  for (const m of metrics) {
    const vals = features.map((f) => m.get(f, byId.get(f.tradeId)));
    const s = std(vals), mu = mean(vals);
    if (s <= 0) continue;
    features.forEach((f, i) => {
      const z = (vals[i] - mu) / s;
      if (Math.abs(z) >= 3) {
        const t = byId.get(f.tradeId);
        out.push({ tradeId: f.tradeId, metric: m.name, value: vals[i], z, when: t?.entryTime ?? 0 });
      }
    });
  }
  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 20);
}

export function anomalyInsights(features: DerivedFeatures[], trades: TradeRecord[]): Insight[] {
  const anomalies = detectAnomalies(features, trades);
  return anomalies.slice(0, 5).map((a) => ({
    id: `anom-${a.tradeId}-${a.metric}`,
    kind: "anomaly",
    severity: Math.abs(a.z) >= 4 ? "critical" : "warning",
    title: `Anomaly: ${a.metric} z=${a.z.toFixed(1)} (${a.value.toFixed(2)})`,
    summary: `Trade ${a.tradeId} at ${new Date(a.when).toISOString().slice(0, 16)} is an extreme outlier on ${a.metric}.`,
    evidence: { sampleSize: features.length, metric: a.metric, metricValue: a.value },
    tags: ["anomaly", a.metric],
  }));
}
