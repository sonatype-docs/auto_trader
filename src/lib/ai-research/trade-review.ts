// Per-trade review: score, why-it-won/lost, filters passed/failed.

import type { TradeRecord } from "@/lib/trade-intelligence/types";
import type { DerivedFeatures } from "./features-ext";
import { derive } from "./features-ext";
import { mean, std } from "./stats";

export interface TradeReview {
  tradeId: string;
  score: number;             // 0..100 relative to peers
  outcome: "win" | "loss" | "flat";
  whyWon?: string[];
  whyLost?: string[];
  filtersPassed: string[];
  filtersFailed: string[];
  suggestions: string[];
}

/** Score a single trade against the peer feature set. */
export function reviewTrade(trade: TradeRecord, peers: DerivedFeatures[]): TradeReview {
  const t = derive(trade);
  const netPeers = peers.map((r) => r.netPnl);
  const mu = mean(netPeers), s = std(netPeers) || 1;
  const z = (t.netPnl - mu) / s;
  const score = Math.max(0, Math.min(100, 50 + z * 15));

  const outcome: TradeReview["outcome"] = t.netPnl > 0 ? "win" : t.netPnl < 0 ? "loss" : "flat";
  const whyWon: string[] = [];
  const whyLost: string[] = [];
  const passed: string[] = [];
  const failed: string[] = [];
  const suggestions: string[] = [];

  const shareRegime = peers.filter((r) => r.regime === t.regime && r.win).length / Math.max(1, peers.filter((r) => r.regime === t.regime).length);
  if (outcome === "win") {
    whyWon.push(`Executed in "${t.regime}" regime where peer win rate is ${(shareRegime * 100).toFixed(0)}%.`);
    if (t.fvgPresent) whyWon.push("Fair Value Gap was present at entry.");
    if (t.sweepPresent) whyWon.push("Liquidity sweep confirmed prior to entry.");
    if (t.mfe > Math.abs(t.mae)) whyWon.push(`MFE ${t.mfe.toFixed(2)} exceeded MAE ${t.mae.toFixed(2)}.`);
  } else if (outcome === "loss") {
    whyLost.push(`Peer win rate in "${t.regime}" regime is ${(shareRegime * 100).toFixed(0)}%.`);
    if (Math.abs(t.mae) > t.mfe) whyLost.push(`MAE (${t.mae.toFixed(2)}) exceeded MFE (${t.mfe.toFixed(2)}) — trade never reached favourable territory.`);
    if (t.fillDelayMs > mean(peers.map((r) => r.fillDelayMs)) * 2) whyLost.push("Fill delay was ~2× peer average — possible slippage.");
    if (t.exitReason === "stop" || t.exitReason === "sl") whyLost.push("Exited on stop-loss.");
    suggestions.push(`Consider avoiding entries in "${t.regime}" if this regime dominates your losers.`);
  }

  // Filter tags derived from raw record (best-effort).
  const filters = trade.filters ?? {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === true) passed.push(k);
    else if (v === false) failed.push(k);
  }

  return { tradeId: trade.tradeId, score, outcome, whyWon, whyLost, filtersPassed: passed, filtersFailed: failed, suggestions };
}
