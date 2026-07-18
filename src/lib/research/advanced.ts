// Phase 4/6/7 analytics — pure, client-side computations over TradeFeatures.

import type { TradeFeatures } from "./features";
import { FILTERS, type FilterId } from "./filters";
import { computeStats, type StatsRow } from "./aggregate";

const DECIDED = new Set<TradeFeatures["outcome"]>(["tp", "sl"]);

// ---------- Phase 4: Target / partial simulator ----------
export interface SimConfig {
  rr: number;                     // base RR (e.g. 2)
  moveToBEAtR: number | null;     // move SL to BE when peakR >= x (null = off)
  partialTakeAtR: number | null;  // take partial when peakR >= x
  partialSizePct: number;         // 0-100
  trailAfterR: number | null;     // start trailing after peakR >= x
  trailStepR: number;             // trail step in R
}
export const DEFAULT_SIM: SimConfig = {
  rr: 2,
  moveToBEAtR: null,
  partialTakeAtR: null,
  partialSizePct: 50,
  trailAfterR: null,
  trailStepR: 0.5,
};

/**
 * Approximate re-simulation of decided trades using recorded MFE (peak_r) and
 * MAE (mae_r). For each trade with peak_r>=X we apply the BE / partial /
 * trail rules and recompute a per-trade R multiple, then convert to $ at
 * $slRisk = 1R.
 */
export function simulateVariant(features: TradeFeatures[], slRiskUsd: number, cfg: SimConfig): StatsRow {
  const remapped: TradeFeatures[] = features.map((f) => {
    if (!DECIDED.has(f.outcome) || f.mfe_r === null || f.mae_r === null) return f;
    const peak = f.mfe_r;
    const mae = f.mae_r;
    let R = f.pnl_usd / slRiskUsd; // original R
    // Partial take.
    let partialR = 0;
    if (cfg.partialTakeAtR !== null && peak >= cfg.partialTakeAtR) {
      partialR = cfg.partialTakeAtR * (cfg.partialSizePct / 100);
    }
    // Move to BE.
    const beActive = cfg.moveToBEAtR !== null && peak >= cfg.moveToBEAtR;
    // Trailing.
    const trailActive = cfg.trailAfterR !== null && peak >= cfg.trailAfterR;
    if (trailActive) {
      const trailSlR = Math.floor((peak - (cfg.trailAfterR as number)) / cfg.trailStepR) * cfg.trailStepR;
      // If original was a TP: still TP for remainder → runner captured RR.
      if (f.outcome === "tp") R = cfg.rr;
      else {
        // For losses: if BE armed and mae never reversed peak enough, treat runner as trailSl.
        R = beActive ? trailSlR : Math.max(-1, trailSlR);
      }
    } else if (beActive) {
      // BE only: if trade eventually hit SL after peak past BE trigger, treat runner as 0R.
      if (f.outcome === "sl" && peak >= (cfg.moveToBEAtR as number) && mae < peak * 0.5) {
        R = 0;
      }
    }
    const runnerFrac = 1 - (cfg.partialTakeAtR !== null && peak >= cfg.partialTakeAtR ? cfg.partialSizePct / 100 : 0);
    const totalR = partialR + R * runnerFrac;
    return { ...f, pnl_usd: totalR * slRiskUsd };
  });
  return computeStats(remapped);
}

// ---------- Phase 6: Monte Carlo ----------
export interface MonteCarloResult {
  runs: number;
  netMean: number;
  netStd: number;
  netP05: number;
  netP50: number;
  netP95: number;
  ddMean: number;
  ddP95: number;
  probLoss: number;
}

function shuffleInPlace<T>(arr: T[], rand: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function stats(arr: number[]) {
  const s = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((x, y) => x + y, 0) / arr.length;
  const std = Math.sqrt(arr.reduce((x, y) => x + (y - mean) ** 2, 0) / arr.length);
  const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
  return { mean, std, p05: q(0.05), p50: q(0.5), p95: q(0.95) };
}
export function monteCarlo(features: TradeFeatures[], runs = 2000, seed = 42): MonteCarloResult {
  const pnls = features.filter((f) => DECIDED.has(f.outcome)).map((f) => f.pnl_usd);
  if (pnls.length === 0) {
    return { runs: 0, netMean: 0, netStd: 0, netP05: 0, netP50: 0, netP95: 0, ddMean: 0, ddP95: 0, probLoss: 0 };
  }
  const rand = mulberry32(seed);
  const nets: number[] = [];
  const dds: number[] = [];
  let losses = 0;
  for (let r = 0; r < runs; r++) {
    const shuf = [...pnls];
    shuffleInPlace(shuf, rand);
    let cum = 0, peak = 0, maxDd = 0;
    for (const v of shuf) {
      cum += v;
      if (cum > peak) peak = cum;
      const dd = peak - cum;
      if (dd > maxDd) maxDd = dd;
    }
    nets.push(cum);
    dds.push(maxDd);
    if (cum < 0) losses += 1;
  }
  const n = stats(nets);
  const d = stats(dds);
  return {
    runs,
    netMean: n.mean, netStd: n.std, netP05: n.p05, netP50: n.p50, netP95: n.p95,
    ddMean: d.mean, ddP95: d.p95,
    probLoss: losses / runs,
  };
}

// ---------- Phase 6: Walk-forward ----------
export interface WalkForwardFold {
  index: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  trainStats: StatsRow;
  testStats: StatsRow;
}
export function walkForward(features: TradeFeatures[], folds = 5): WalkForwardFold[] {
  const sorted = [...features].sort((a, b) => (a.ist_date < b.ist_date ? -1 : 1));
  if (sorted.length < folds * 2) return [];
  const size = Math.floor(sorted.length / (folds + 1));
  const out: WalkForwardFold[] = [];
  for (let i = 0; i < folds; i++) {
    const trainEnd = (i + 1) * size;
    const testStart = trainEnd;
    const testEnd = Math.min(sorted.length, testStart + size);
    const train = sorted.slice(0, trainEnd);
    const test = sorted.slice(testStart, testEnd);
    if (test.length === 0) break;
    out.push({
      index: i + 1,
      trainStart: train[0].ist_date,
      trainEnd: train[train.length - 1].ist_date,
      testStart: test[0].ist_date,
      testEnd: test[test.length - 1].ist_date,
      trainStats: computeStats(train),
      testStats: computeStats(test),
    });
  }
  return out;
}

// ---------- Phase 6: Robustness score ----------
export function robustnessScore(features: TradeFeatures[]): { score: number; components: Record<string, number>; warning: string | null } {
  const decided = features.filter((f) => DECIDED.has(f.outcome));
  if (decided.length < 30) {
    return {
      score: 0,
      components: { sample: 0 },
      warning: "Fewer than 30 decided trades — statistical confidence is low.",
    };
  }
  const stat = computeStats(decided);
  const mc = monteCarlo(decided, 500);
  const wf = walkForward(decided, 3);
  const wfConsistency = wf.length
    ? wf.reduce((s, f) => s + (f.testStats.net_pnl_usd > 0 ? 1 : 0), 0) / wf.length
    : 0;
  const netPos = stat.net_pnl_usd > 0 ? 1 : 0;
  const pf = Math.min(1, (stat.profit_factor || 0) / 2);
  const drawdownRatio = stat.max_drawdown_usd > 0 ? Math.min(1, stat.net_pnl_usd / (stat.max_drawdown_usd * 3)) : 1;
  const mcConfidence = 1 - mc.probLoss;
  const sample = Math.min(1, decided.length / 100);
  const components = {
    net_positive: netPos,
    profit_factor: pf,
    return_over_dd: Math.max(0, drawdownRatio),
    mc_confidence: mcConfidence,
    walk_forward_consistency: wfConsistency,
    sample_size: sample,
  };
  const raw = Object.values(components).reduce((a, b) => a + b, 0) / Object.keys(components).length;
  const score = Math.round(raw * 100);
  let warning: string | null = null;
  if (mc.probLoss > 0.3) warning = "High Monte Carlo loss probability — likely curve-fit.";
  else if (wfConsistency < 0.5 && wf.length) warning = "Walk-forward folds inconsistent — strategy may not generalise.";
  else if (stat.max_drawdown_usd > stat.net_pnl_usd * 2 && stat.net_pnl_usd > 0) warning = "Drawdown is large vs net P&L.";
  return { score, components, warning };
}

// ---------- Phase 7: Feature importance ----------
export interface FeatureImportanceRow {
  filterId: FilterId;
  label: string;
  score: number;        // 0-1 relative importance
  bestBucket: string;
  bestBucketNet: number;
  spread: number;       // best-worst spread in $
}
export function featureImportance(features: TradeFeatures[]): FeatureImportanceRow[] {
  const rows: FeatureImportanceRow[] = [];
  for (const def of FILTERS) {
    const perBucket = def.buckets.map((b) => {
      const sub = features.filter((f) => def.tag(f) === b);
      const stat = computeStats(sub);
      return { b, net: stat.net_pnl_usd, count: sub.length };
    });
    const withData = perBucket.filter((p) => p.count > 0);
    if (withData.length < 2) continue;
    const nets = withData.map((p) => p.net);
    const best = withData.reduce((a, b) => (a.net > b.net ? a : b));
    const worst = withData.reduce((a, b) => (a.net < b.net ? a : b));
    const spread = best.net - worst.net;
    const range = Math.max(...nets) - Math.min(...nets);
    rows.push({
      filterId: def.id,
      label: def.label,
      score: range,
      bestBucket: def.bucketLabel(best.b),
      bestBucketNet: best.net,
      spread,
    });
  }
  const maxScore = Math.max(...rows.map((r) => r.score), 1);
  return rows
    .map((r) => ({ ...r, score: r.score / maxScore }))
    .sort((a, b) => b.score - a.score);
}

// ---------- Phase 7: Trade quality score ----------
export interface QualityScoredTrade {
  ist_date: string;
  pnl_usd: number;
  outcome: TradeFeatures["outcome"];
  score: number; // 0-100
}
export function tradeQualityScore(features: TradeFeatures[]): { scored: QualityScoredTrade[]; bands: Array<{ band: string; count: number; win_rate_pct: number; net_pnl_usd: number }> } {
  // Score = weighted sum of z-scored bucket net-pnl for each feature.
  const bucketNet = new Map<string, number>();
  for (const def of FILTERS) {
    for (const b of def.buckets) {
      const sub = features.filter((f) => def.tag(f) === b);
      const stat = computeStats(sub);
      bucketNet.set(`${def.id}::${b}`, stat.net_pnl_usd);
    }
  }
  const rawScores: number[] = [];
  const perTrade = features.map((f) => {
    let s = 0;
    let n = 0;
    for (const def of FILTERS) {
      const b = def.tag(f);
      if (b === null) continue;
      const v = bucketNet.get(`${def.id}::${b}`) ?? 0;
      s += v;
      n += 1;
    }
    const raw = n > 0 ? s / n : 0;
    rawScores.push(raw);
    return { ist_date: f.ist_date, pnl_usd: f.pnl_usd, outcome: f.outcome, raw };
  });
  const sorted = [...rawScores].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 1;
  const range = max - min || 1;
  const scored: QualityScoredTrade[] = perTrade.map((t) => ({
    ist_date: t.ist_date,
    pnl_usd: t.pnl_usd,
    outcome: t.outcome,
    score: Math.round(((t.raw - min) / range) * 100),
  }));
  const bandEdges = [0, 20, 40, 60, 80, 100];
  const bandLabels = ["0-20", "20-40", "40-60", "60-80", "80-100"];
  const bands = bandLabels.map((band, i) => {
    const rows = scored.filter((t) => t.score >= bandEdges[i] && t.score <= bandEdges[i + 1] && DECIDED.has(t.outcome));
    const wins = rows.filter((r) => r.pnl_usd > 0).length;
    const net = rows.reduce((a, r) => a + r.pnl_usd, 0);
    return {
      band,
      count: rows.length,
      win_rate_pct: rows.length ? (wins / rows.length) * 100 : 0,
      net_pnl_usd: net,
    };
  });
  return { scored, bands };
}
