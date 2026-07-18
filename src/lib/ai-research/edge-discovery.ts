// Edge discovery: search categorical feature slices for statistically
// significant differences vs the baseline (Welch t-test on netPnl +
// two-proportion z-test on win rate).

import type { DerivedFeatures } from "./features-ext";
import type { Insight, Recommendation } from "./types";
import { mean, propZ, welchT } from "./stats";

type Getter = { name: string; label: string; get: (r: DerivedFeatures) => string | null };

const GETTERS: Getter[] = [
  { name: "session", label: "Session", get: (r) => r.session },
  { name: "regime", label: "Regime", get: (r) => r.regime },
  { name: "direction", label: "Direction", get: (r) => r.direction },
  { name: "hour", label: "Hour UTC", get: (r) => String(r.hourUtc).padStart(2, "0") },
  { name: "weekday", label: "Weekday", get: (r) => String(r.weekday) },
  { name: "exitReason", label: "Exit reason", get: (r) => r.exitReason },
  { name: "entryType", label: "Entry type", get: (r) => r.entryType },
  { name: "stopType", label: "Stop type", get: (r) => r.stopType },
  { name: "targetType", label: "Target type", get: (r) => r.targetType },
  { name: "fvg", label: "FVG present", get: (r) => (r.fvgPresent ? "yes" : "no") },
  { name: "sweep", label: "Liquidity sweep", get: (r) => (r.sweepPresent ? "yes" : "no") },
];

export interface EdgeCandidate {
  feature: string;
  featureLabel: string;
  bucket: string;
  n: number;
  netInBucket: number;
  winRateInBucket: number;
  winRateBaseline: number;
  expectancyInBucket: number;
  expectancyBaseline: number;
  pValueMean: number;
  pValueWin: number;
  confidence: number; // 1 - min(p)
}

export function discoverEdges(features: DerivedFeatures[], minN = 8): EdgeCandidate[] {
  if (features.length < 20) return [];
  const baseWins = features.filter((r) => r.win).length;
  const baseWinRate = baseWins / features.length;
  const baseExp = mean(features.map((r) => r.netPnl));
  const netAll = features.map((r) => r.netPnl);

  const out: EdgeCandidate[] = [];
  for (const g of GETTERS) {
    const groups = new Map<string, DerivedFeatures[]>();
    for (const r of features) {
      const k = g.get(r);
      if (!k) continue;
      const arr = groups.get(k) ?? [];
      arr.push(r);
      groups.set(k, arr);
    }
    for (const [bucket, rows] of groups) {
      if (rows.length < minN) continue;
      const outside = features.filter((r) => !rows.includes(r));
      if (outside.length < minN) continue;
      const inNet = rows.map((r) => r.netPnl);
      const outNet = outside.map((r) => r.netPnl);
      const tt = welchT(inNet, outNet);
      const wins = rows.filter((r) => r.win).length;
      const outWins = outside.filter((r) => r.win).length;
      const pz = propZ(wins, rows.length, outWins, outside.length);
      const conf = 1 - Math.min(tt.p, pz.p);
      out.push({
        feature: g.name,
        featureLabel: g.label,
        bucket,
        n: rows.length,
        netInBucket: inNet.reduce((s, x) => s + x, 0),
        winRateInBucket: wins / rows.length,
        winRateBaseline: baseWinRate,
        expectancyInBucket: mean(inNet),
        expectancyBaseline: baseExp,
        pValueMean: tt.p,
        pValueWin: pz.p,
        confidence: conf,
      });
    }
    // silence unused variable
    void netAll;
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

export function edgeInsights(features: DerivedFeatures[]): Insight[] {
  return discoverEdges(features)
    .filter((e) => e.confidence >= 0.9)   // ≥90% (i.e. p ≤ 0.10 on at least one test)
    .slice(0, 12)
    .map((e) => ({
      id: `edge-${e.feature}-${e.bucket}`,
      kind: "edge",
      severity: e.expectancyInBucket > e.expectancyBaseline ? "positive" : "warning",
      title: `${e.featureLabel} = ${e.bucket} → expectancy ${e.expectancyInBucket.toFixed(2)} vs baseline ${e.expectancyBaseline.toFixed(2)}`,
      summary: `${e.n} trades. Win rate ${(e.winRateInBucket * 100).toFixed(1)}% vs baseline ${(e.winRateBaseline * 100).toFixed(1)}%. p(mean)=${e.pValueMean.toFixed(3)}, p(win)=${e.pValueWin.toFixed(3)}.`,
      evidence: {
        sampleSize: e.n,
        metric: "expectancy",
        metricValue: e.expectancyInBucket,
        baselineValue: e.expectancyBaseline,
        delta: e.expectancyInBucket - e.expectancyBaseline,
        pValue: Math.min(e.pValueMean, e.pValueWin),
        confidence: e.confidence,
      },
      tags: [e.feature, e.bucket],
    }));
}

/** Filter suggestions: excluding a slice with negative expectancy + p<=0.10. */
export function filterRecommendations(features: DerivedFeatures[]): Recommendation[] {
  const edges = discoverEdges(features);
  const baseNet = features.reduce((s, r) => s + r.netPnl, 0);
  const basePf = profitFactor(features);
  const recs: Recommendation[] = [];

  for (const e of edges) {
    const worseThanBase = e.expectancyInBucket < e.expectancyBaseline;
    if (!worseThanBase) continue;
    if (e.confidence < 0.9) continue;
    const remaining = features.filter((r) => {
      switch (e.feature) {
        case "session": return r.session !== e.bucket;
        case "regime": return r.regime !== e.bucket;
        case "direction": return r.direction !== e.bucket;
        case "hour": return String(r.hourUtc).padStart(2, "0") !== e.bucket;
        case "weekday": return String(r.weekday) !== e.bucket;
        case "exitReason": return r.exitReason !== e.bucket;
        case "entryType": return r.entryType !== e.bucket;
        case "stopType": return r.stopType !== e.bucket;
        case "targetType": return r.targetType !== e.bucket;
        case "fvg": return (r.fvgPresent ? "yes" : "no") !== e.bucket;
        case "sweep": return (r.sweepPresent ? "yes" : "no") !== e.bucket;
      }
      return true;
    });
    const newNet = remaining.reduce((s, r) => s + r.netPnl, 0);
    const newPf = profitFactor(remaining);
    const deltaNet = newNet - baseNet;
    const deltaPfPct = basePf > 0 ? ((newPf - basePf) / basePf) * 100 : 0;
    if (deltaNet <= 0 && deltaPfPct <= 0) continue;
    recs.push({
      id: `rec-exclude-${e.feature}-${e.bucket}`,
      kind: "filter",
      severity: "positive",
      title: `Exclude ${e.featureLabel} = ${e.bucket}`,
      summary: `Removes ${e.n} trades. Net Δ ${deltaNet.toFixed(2)}, PF ${basePf.toFixed(2)} → ${newPf.toFixed(2)} (${deltaPfPct.toFixed(1)}%).`,
      action: `Add rule: ${e.feature} ≠ ${e.bucket}`,
      expectedImpact: `Net +${deltaNet.toFixed(2)}, PF ${deltaPfPct >= 0 ? "+" : ""}${deltaPfPct.toFixed(1)}%.`,
      evidence: {
        sampleSize: e.n,
        metric: "profit_factor",
        metricValue: newPf,
        baselineValue: basePf,
        delta: newPf - basePf,
        pValue: Math.min(e.pValueMean, e.pValueWin),
        confidence: e.confidence,
      },
      tags: [e.feature, e.bucket, "exclude"],
    });
  }
  return recs.sort((a, b) => (b.evidence.delta ?? 0) - (a.evidence.delta ?? 0)).slice(0, 8);
}

function profitFactor(rows: DerivedFeatures[]): number {
  const w = rows.filter((r) => r.netPnl > 0).reduce((s, r) => s + r.netPnl, 0);
  const l = Math.abs(rows.filter((r) => r.netPnl < 0).reduce((s, r) => s + r.netPnl, 0));
  return l > 0 ? w / l : w > 0 ? Infinity : 0;
}
