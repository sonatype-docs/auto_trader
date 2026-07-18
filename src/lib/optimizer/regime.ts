// Regime classification — heuristic tagging from ATR percentile & trend/ADX.
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { extractFeatures, percentile } from "./dimensions";
import { computeMetrics, type Metrics } from "./objectives";

export type Regime =
  | "trending_expansion" | "trending_quiet"
  | "ranging_compression" | "ranging_volatile"
  | "unknown";

export function classifyRegime(rows: TradeRecord[]): Regime[] {
  const fv = rows.map(extractFeatures);
  const atr = fv.map((f) => f.numeric.atr_pct ?? f.numeric.atr ?? 0);
  const adx = fv.map((f) => f.numeric.adx ?? 0);
  const atrP60 = percentile(atr, 0.6);
  const atrP40 = percentile(atr, 0.4);
  return fv.map((f, i) => {
    const a = atr[i] ?? 0, x = adx[i] ?? 0;
    if (x >= 25 && a >= atrP60) return "trending_expansion";
    if (x >= 25 && a <= atrP40) return "trending_quiet";
    if (x < 20 && a >= atrP60) return "ranging_volatile";
    if (x < 20 && a <= atrP40) return "ranging_compression";
    return "unknown";
  });
}

export interface RegimeReport {
  regime: Regime;
  trades: number;
  metrics: Metrics;
}
export function regimeReport(rows: TradeRecord[]): RegimeReport[] {
  const tags = classifyRegime(rows);
  const groups = new Map<Regime, TradeRecord[]>();
  rows.forEach((r, i) => {
    const g = groups.get(tags[i]) ?? []; g.push(r); groups.set(tags[i], g);
  });
  return Array.from(groups.entries()).map(([regime, arr]) => ({
    regime, trades: arr.length, metrics: computeMetrics(arr),
  })).sort((a, b) => b.metrics.expectancy - a.metrics.expectancy);
}
