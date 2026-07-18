// Market regime performance — which regime produces highest expectancy?

import type { DerivedFeatures } from "./features-ext";
import type { Insight } from "./types";
import { mean } from "./stats";

export interface RegimeStat {
  regime: string;
  count: number;
  net: number;
  win: number;
  expectancy: number;
}

export function regimeBreakdown(features: DerivedFeatures[]): RegimeStat[] {
  const groups = new Map<string, DerivedFeatures[]>();
  for (const r of features) {
    const arr = groups.get(r.regime) ?? [];
    arr.push(r);
    groups.set(r.regime, arr);
  }
  return Array.from(groups.entries()).map(([regime, rows]) => ({
    regime, count: rows.length,
    net: rows.reduce((s, r) => s + r.netPnl, 0),
    win: rows.length ? rows.filter((r) => r.win).length / rows.length : 0,
    expectancy: mean(rows.map((r) => r.netPnl)),
  })).sort((a, b) => b.expectancy - a.expectancy);
}

export function regimeInsights(features: DerivedFeatures[]): Insight[] {
  const breakdown = regimeBreakdown(features).filter((r) => r.count >= 5);
  if (breakdown.length < 2) return [];
  const best = breakdown[0];
  const worst = breakdown[breakdown.length - 1];
  const out: Insight[] = [{
    id: `regime-best-${best.regime}`,
    kind: "regime",
    severity: "positive",
    title: `Best regime: ${best.regime} (expectancy ${best.expectancy.toFixed(2)})`,
    summary: `${best.count} trades, ${(best.win * 100).toFixed(1)}% win, net ${best.net.toFixed(2)}.`,
    evidence: { sampleSize: best.count, metric: "expectancy", metricValue: best.expectancy },
    tags: ["regime", best.regime],
  }];
  if (worst.expectancy < 0 && worst.regime !== best.regime) {
    out.push({
      id: `regime-worst-${worst.regime}`,
      kind: "regime",
      severity: "warning",
      title: `Worst regime: ${worst.regime} (expectancy ${worst.expectancy.toFixed(2)})`,
      summary: `${worst.count} trades, ${(worst.win * 100).toFixed(1)}% win, net ${worst.net.toFixed(2)}.`,
      evidence: { sampleSize: worst.count, metric: "expectancy", metricValue: worst.expectancy },
      tags: ["regime", worst.regime],
    });
  }
  return out;
}
