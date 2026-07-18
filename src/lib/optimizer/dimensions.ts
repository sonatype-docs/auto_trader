// Dimension extraction — turns each TradeRecord into a numeric/categorical
// feature vector for optimization, clustering, and importance analysis.
import type { TradeRecord } from "@/lib/trade-intelligence/types";

export interface FeatureVector {
  numeric: Record<string, number>;
  categorical: Record<string, string>;
}

function safeNum(x: unknown): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : NaN;
}

export function extractFeatures(t: TradeRecord): FeatureVector {
  const dt = new Date(t.entryTime);
  const hour = dt.getUTCHours();
  const numeric: Record<string, number> = {
    hour,
    weekday: t.weekday ?? dt.getUTCDay(),
    month: t.month ?? dt.getUTCMonth() + 1,
    quarter: t.quarter ?? Math.floor(dt.getUTCMonth() / 3) + 1,
    duration_min: (t.durationMs ?? 0) / 60000,
    holding_bars: t.holdingBars ?? 0,
    risk_usd: t.riskUsd ?? 0,
    actual_rr: t.actualRr ?? 0,
    mae: t.mae ?? 0,
    mfe: t.mfe ?? 0,
    net_pnl: t.netPnl,
    atr: safeNum((t.volatility as { atr?: number })?.atr),
    atr_pct: safeNum((t.volatility as { atrPct?: number })?.atrPct),
    adx: safeNum((t.trend as { adx?: number })?.adx),
    body_pct: safeNum((t.entryQuality as { bodyPct?: number })?.bodyPct),
    or_pct: safeNum((t.breakout as { orPct?: number })?.orPct),
    break_dist: safeNum((t.breakout as { breakDistance?: number })?.breakDistance),
    volume_spike: safeNum((t.entryQuality as { volumeSpike?: number })?.volumeSpike),
  };
  const categorical: Record<string, string> = {
    direction: t.direction,
    session: t.session ?? "unknown",
    strategy: t.strategyId,
    symbol: t.symbol,
    trade_type: t.tradeType ?? "unknown",
    exit_reason: t.exitReason ?? "unknown",
    ema_alignment: String((t.trend as { emaAlignment?: string })?.emaAlignment ?? "unknown"),
    vwap_side: String((t.trend as { vwapSide?: string })?.vwapSide ?? "unknown"),
    fvg: String((t.smartMoney as { fvg?: boolean })?.fvg ?? "unknown"),
    order_block: String((t.smartMoney as { orderBlock?: boolean })?.orderBlock ?? "unknown"),
    choch: String((t.smartMoney as { choch?: boolean })?.choch ?? "unknown"),
    mss: String((t.smartMoney as { mss?: boolean })?.mss ?? "unknown"),
    sweep: String((t.liquidity as { sweep?: boolean })?.sweep ?? "unknown"),
  };
  return { numeric, categorical };
}

export function featuresFor(rows: TradeRecord[]): FeatureVector[] {
  return rows.map(extractFeatures);
}

export function allNumericKeys(vecs: FeatureVector[]): string[] {
  const s = new Set<string>();
  for (const v of vecs) for (const k of Object.keys(v.numeric)) s.add(k);
  return Array.from(s);
}
export function allCategoricalKeys(vecs: FeatureVector[]): string[] {
  const s = new Set<string>();
  for (const v of vecs) for (const k of Object.keys(v.categorical)) s.add(k);
  return Array.from(s);
}

export function percentile(values: number[], p: number): number {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return NaN;
  const idx = Math.min(clean.length - 1, Math.max(0, Math.floor(clean.length * p)));
  return clean[idx];
}
