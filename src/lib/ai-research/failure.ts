// Failure analysis: characterise losing trades and drawdown episodes.

import type { DerivedFeatures } from "./features-ext";
import type { Insight } from "./types";
import { mean } from "./stats";

interface DrawdownEpisode {
  startIdx: number;
  endIdx: number;
  troughIdx: number;
  depth: number;
  length: number;
}

export function drawdownEpisodes(features: DerivedFeatures[]): DrawdownEpisode[] {
  const sorted = [...features]; // caller sorts
  const eq: number[] = [];
  let cum = 0;
  for (const f of sorted) { cum += f.netPnl; eq.push(cum); }
  const episodes: DrawdownEpisode[] = [];
  let peak = eq[0] ?? 0, peakIdx = 0, troughIdx = 0, trough = peak;
  for (let i = 1; i < eq.length; i++) {
    if (eq[i] > peak) {
      if (peak - trough > 0) {
        episodes.push({ startIdx: peakIdx, endIdx: i, troughIdx, depth: peak - trough, length: i - peakIdx });
      }
      peak = eq[i]; peakIdx = i; trough = peak; troughIdx = i;
    } else if (eq[i] < trough) { trough = eq[i]; troughIdx = i; }
  }
  if (peak - trough > 0) episodes.push({ startIdx: peakIdx, endIdx: eq.length - 1, troughIdx, depth: peak - trough, length: eq.length - 1 - peakIdx });
  return episodes.sort((a, b) => b.depth - a.depth);
}

export function failureInsights(features: DerivedFeatures[]): Insight[] {
  if (features.length < 20) return [];
  const losers = features.filter((r) => r.netPnl < 0);
  if (losers.length < 5) return [];
  const winners = features.filter((r) => r.netPnl > 0);
  const out: Insight[] = [];

  // Regime concentration
  const regCounts = new Map<string, number>();
  for (const r of losers) regCounts.set(r.regime, (regCounts.get(r.regime) ?? 0) + 1);
  const dom = Array.from(regCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (dom && dom[1] / losers.length >= 0.35) {
    out.push({
      id: `fail-regime-${dom[0]}`,
      kind: "failure",
      severity: "warning",
      title: `${((dom[1] / losers.length) * 100).toFixed(0)}% of losers occur in "${dom[0]}" regime`,
      summary: `${dom[1]} of ${losers.length} losing trades happened in ${dom[0]}. Consider avoiding entries in this regime.`,
      evidence: { sampleSize: losers.length, metric: "loser_share", metricValue: dom[1] / losers.length },
      tags: ["regime", dom[0]],
    });
  }

  // Direction bias in losers
  const shortLosers = losers.filter((r) => r.direction === "short").length;
  const longLosers = losers.length - shortLosers;
  const shortWinners = winners.filter((r) => r.direction === "short").length;
  const shareShort = losers.length ? shortLosers / losers.length : 0;
  const shareShortWinners = winners.length ? shortWinners / winners.length : 0;
  if (Math.abs(shareShort - shareShortWinners) >= 0.15) {
    const worse = shareShort > shareShortWinners ? "short" : "long";
    out.push({
      id: `fail-dir-${worse}`,
      kind: "failure",
      severity: "warning",
      title: `${worse === "short" ? "Shorts" : "Longs"} disproportionately loss-heavy`,
      summary: `Losers are ${(shareShort * 100).toFixed(0)}% short / ${(100 - shareShort * 100).toFixed(0)}% long; winners are ${(shareShortWinners * 100).toFixed(0)}% short.`,
      evidence: { sampleSize: losers.length + winners.length, metric: "direction_skew", delta: shareShort - shareShortWinners },
      tags: ["direction", worse],
    });
  }
  void longLosers;

  // Exit-reason clusters in losers
  const exit = new Map<string, number>();
  for (const r of losers) exit.set(r.exitReason, (exit.get(r.exitReason) ?? 0) + 1);
  const topExit = Array.from(exit.entries()).sort((a, b) => b[1] - a[1])[0];
  if (topExit && topExit[1] / losers.length >= 0.4) {
    out.push({
      id: `fail-exit-${topExit[0]}`,
      kind: "failure",
      severity: "warning",
      title: `Most losers exit via "${topExit[0]}"`,
      summary: `${topExit[1]} of ${losers.length} losers (${((topExit[1] / losers.length) * 100).toFixed(0)}%) close with reason "${topExit[0]}".`,
      evidence: { sampleSize: losers.length, metric: "exit_share", metricValue: topExit[1] / losers.length },
      tags: ["exit_reason", topExit[0]],
    });
  }

  // Deepest drawdown breakdown
  const dds = drawdownEpisodes(features);
  const deepest = dds[0];
  if (deepest) {
    const window = features.slice(deepest.startIdx, deepest.troughIdx + 1);
    const winLose = window.filter((r) => r.win).length / Math.max(1, window.length);
    out.push({
      id: `fail-dd-deepest`,
      kind: "failure",
      severity: "critical",
      title: `Deepest drawdown: ${deepest.depth.toFixed(2)} over ${deepest.length} trades`,
      summary: `Win rate inside episode: ${(winLose * 100).toFixed(0)}%. Avg trade in episode: ${mean(window.map((r) => r.netPnl)).toFixed(2)}.`,
      evidence: { sampleSize: window.length, metric: "drawdown_depth", metricValue: deepest.depth },
      tags: ["drawdown"],
    });
  }
  return out;
}
