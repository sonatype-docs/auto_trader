// Recommendation engine — for each categorical bucket, measure objective
// lift when that bucket is removed. Surfaces "removing X improves Y by Z%".
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { extractFeatures, allCategoricalKeys, allNumericKeys, percentile } from "./dimensions";
import { computeMetrics, objectiveScore } from "./objectives";
import type { ObjectiveSpec } from "./types";

export interface Recommendation {
  action: string;
  liftPct: number;
  before: number;
  after: number;
  tradesRemoved: number;
  detail: string;
}

export function recommend(rows: TradeRecord[], objective: ObjectiveSpec): Recommendation[] {
  const fvs = rows.map(extractFeatures);
  const base = objectiveScore(computeMetrics(rows), objective);
  const out: Recommendation[] = [];

  // remove each categorical bucket
  for (const key of allCategoricalKeys(fvs)) {
    const uniq = new Set<string>();
    fvs.forEach((f) => uniq.add(f.categorical[key] ?? "unknown"));
    for (const v of uniq) {
      const kept = rows.filter((_, i) => (fvs[i].categorical[key] ?? "unknown") !== v);
      if (kept.length < rows.length * 0.3) continue;
      const s = objectiveScore(computeMetrics(kept), objective);
      const lift = base !== 0 ? ((s - base) / Math.abs(base)) * 100 : 0;
      if (lift > 5) {
        out.push({
          action: `Remove ${key} = ${v}`,
          liftPct: lift, before: base, after: s,
          tradesRemoved: rows.length - kept.length,
          detail: `Removes ${rows.length - kept.length} trades.`,
        });
      }
    }
  }
  // numeric — try tail-drop (bottom 20% by objective correlation)
  for (const key of allNumericKeys(fvs)) {
    const values = fvs.map((f) => f.numeric[key] ?? NaN).filter(Number.isFinite);
    if (values.length < 20) continue;
    const p20 = percentile(values, 0.2);
    const p80 = percentile(values, 0.8);
    for (const cut of [{ label: `>= ${p20.toFixed(2)}`, keep: (v: number) => v >= p20 },
                       { label: `<= ${p80.toFixed(2)}`, keep: (v: number) => v <= p80 }]) {
      const kept = rows.filter((_, i) => cut.keep(fvs[i].numeric[key] ?? 0));
      if (kept.length < rows.length * 0.3) continue;
      const s = objectiveScore(computeMetrics(kept), objective);
      const lift = base !== 0 ? ((s - base) / Math.abs(base)) * 100 : 0;
      if (lift > 8) {
        out.push({
          action: `Require ${key} ${cut.label}`,
          liftPct: lift, before: base, after: s,
          tradesRemoved: rows.length - kept.length,
          detail: `Keeps ${kept.length} trades of ${rows.length}.`,
        });
      }
    }
  }
  return out.sort((a, b) => b.liftPct - a.liftPct).slice(0, 10);
}
