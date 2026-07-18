// Strategy comparison: rank multiple strategies on edge, robustness, safety.

import type { DerivedFeatures } from "./features-ext";
import type { Insight } from "./types";
import { mean, std } from "./stats";
import { monteCarlo } from "./monte-carlo";
import { walkForward } from "./walk-forward";

export interface StrategyScorecard {
  strategyId: string;
  trades: number;
  net: number;
  expectancy: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  wfStability: number;   // 1 / (1+CV)
  probLoss: number;
  compositeScore: number;
}

export function scoreStrategy(features: DerivedFeatures[]): Omit<StrategyScorecard, "strategyId"> {
  const pnls = features.map((r) => r.netPnl);
  const winners = features.filter((r) => r.netPnl > 0);
  const losers = features.filter((r) => r.netPnl < 0);
  const gross = winners.reduce((s, r) => s + r.netPnl, 0);
  const loss = Math.abs(losers.reduce((s, r) => s + r.netPnl, 0));
  const pf = loss > 0 ? gross / loss : gross > 0 ? Infinity : 0;
  const winRate = features.length ? winners.length / features.length : 0;
  let cum = 0, peak = 0, maxDd = 0;
  for (const v of pnls) { cum += v; if (cum > peak) peak = cum; if (peak - cum > maxDd) maxDd = peak - cum; }
  const folds = walkForward(features, 5);
  const foldExp = folds.map((f) => f.expectancy);
  const cv = foldExp.length && mean(foldExp) !== 0 ? Math.abs(std(foldExp) / mean(foldExp)) : Infinity;
  const stability = 1 / (1 + (Number.isFinite(cv) ? cv : 5));
  const mc = monteCarlo(features, 500);
  const expectancy = mean(pnls);
  const composite =
    (Number.isFinite(pf) ? Math.min(pf, 5) / 5 : 1) * 0.30 +
    Math.max(0, Math.min(1, expectancy / (Math.abs(expectancy) + 1))) * 0.20 +
    stability * 0.25 +
    (1 - mc.probLoss) * 0.15 +
    (1 - Math.min(1, maxDd / (Math.abs(cum) + 1))) * 0.10;
  return {
    trades: features.length, net: cum, expectancy, winRate,
    profitFactor: pf, maxDrawdown: maxDd,
    wfStability: stability, probLoss: mc.probLoss,
    compositeScore: composite * 100,
  };
}

export function compareStrategies(byStrategy: Map<string, DerivedFeatures[]>): StrategyScorecard[] {
  const out: StrategyScorecard[] = [];
  for (const [strategyId, features] of byStrategy) {
    if (features.length < 10) continue;
    out.push({ strategyId, ...scoreStrategy(features) });
  }
  return out.sort((a, b) => b.compositeScore - a.compositeScore);
}

export function comparisonInsights(byStrategy: Map<string, DerivedFeatures[]>): Insight[] {
  const cards = compareStrategies(byStrategy);
  if (cards.length < 2) return [];
  const best = cards[0], worst = cards[cards.length - 1];
  return [{
    id: `cmp-best-${best.strategyId}`,
    kind: "comparison",
    severity: "positive",
    title: `Best composite: ${best.strategyId} (${best.compositeScore.toFixed(1)}/100)`,
    summary: `PF ${best.profitFactor.toFixed(2)}, stability ${best.wfStability.toFixed(2)}, prob loss ${(best.probLoss * 100).toFixed(1)}%. ${cards.length} strategies scored.`,
    evidence: { sampleSize: best.trades, metric: "composite", metricValue: best.compositeScore },
    tags: ["comparison", best.strategyId],
  }, {
    id: `cmp-worst-${worst.strategyId}`,
    kind: "comparison",
    severity: "warning",
    title: `Weakest: ${worst.strategyId} (${worst.compositeScore.toFixed(1)}/100)`,
    summary: `PF ${worst.profitFactor.toFixed(2)}, stability ${worst.wfStability.toFixed(2)}, prob loss ${(worst.probLoss * 100).toFixed(1)}%.`,
    evidence: { sampleSize: worst.trades, metric: "composite", metricValue: worst.compositeScore },
    tags: ["comparison", worst.strategyId],
  }];
}
