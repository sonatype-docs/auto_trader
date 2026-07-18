// Monte Carlo bootstrap over historical trade P&L.
// Reports probability of ruin, expected drawdown, and CI on final equity.

import type { DerivedFeatures } from "./features-ext";
import type { Insight } from "./types";
import { mean, quantile } from "./stats";

export interface MonteCarloResult {
  runs: number;
  probLoss: number;
  probRuin: number;
  netMean: number;
  netP05: number;
  netP95: number;
  ddMean: number;
  ddP95: number;
  maxLossStreakP95: number;
  maxWinStreakP95: number;
}

export function monteCarlo(features: DerivedFeatures[], runs = 2000, ruinThreshold?: number): MonteCarloResult {
  if (features.length < 10) {
    return { runs: 0, probLoss: 0, probRuin: 0, netMean: 0, netP05: 0, netP95: 0, ddMean: 0, ddP95: 0, maxLossStreakP95: 0, maxWinStreakP95: 0 };
  }
  const pnls = features.map((r) => r.netPnl);
  const ruin = ruinThreshold ?? Math.abs(pnls.reduce((s, x) => s + x, 0)) * 0.5;
  const nets: number[] = [], dds: number[] = [], lStreaks: number[] = [], wStreaks: number[] = [];
  let losses = 0, ruins = 0;
  for (let run = 0; run < runs; run++) {
    let cum = 0, peak = 0, maxDd = 0, curL = 0, curW = 0, maxL = 0, maxW = 0;
    let ruined = false;
    for (let i = 0; i < pnls.length; i++) {
      const v = pnls[Math.floor(Math.random() * pnls.length)];
      cum += v;
      if (cum > peak) peak = cum;
      const dd = peak - cum;
      if (dd > maxDd) maxDd = dd;
      if (maxDd >= ruin) ruined = true;
      if (v > 0) { curW++; if (curW > maxW) maxW = curW; curL = 0; }
      else if (v < 0) { curL++; if (curL > maxL) maxL = curL; curW = 0; }
    }
    nets.push(cum); dds.push(maxDd); lStreaks.push(maxL); wStreaks.push(maxW);
    if (cum < 0) losses++;
    if (ruined) ruins++;
  }
  return {
    runs,
    probLoss: losses / runs,
    probRuin: ruins / runs,
    netMean: mean(nets),
    netP05: quantile(nets, 0.05),
    netP95: quantile(nets, 0.95),
    ddMean: mean(dds),
    ddP95: quantile(dds, 0.95),
    maxLossStreakP95: quantile(lStreaks, 0.95),
    maxWinStreakP95: quantile(wStreaks, 0.95),
  };
}

export function monteCarloInsights(features: DerivedFeatures[]): Insight[] {
  const mc = monteCarlo(features);
  if (mc.runs === 0) return [];
  return [{
    id: "mc-summary",
    kind: "monte_carlo",
    severity: mc.probLoss > 0.3 ? "warning" : "info",
    title: `Monte Carlo (${mc.runs} runs): ${(mc.probLoss * 100).toFixed(1)}% probability of losing, ${(mc.probRuin * 100).toFixed(1)}% ruin`,
    summary: `Net P05 ${mc.netP05.toFixed(2)} / mean ${mc.netMean.toFixed(2)} / P95 ${mc.netP95.toFixed(2)}. Expected max DD ${mc.ddMean.toFixed(2)} (P95 ${mc.ddP95.toFixed(2)}). Expected loss streak ≤ ${mc.maxLossStreakP95.toFixed(0)}.`,
    evidence: { sampleSize: features.length, metric: "prob_loss", metricValue: mc.probLoss },
    tags: ["monte_carlo"],
  }];
}
