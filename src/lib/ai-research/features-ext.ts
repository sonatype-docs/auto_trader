// Derive analysis-friendly features from TradeRecord.
// Zero side-effects. All features are strategy-agnostic.

import type { TradeRecord } from "@/lib/trade-intelligence/types";

export type Session = "asia" | "london" | "ny" | "other";

export interface DerivedFeatures {
  tradeId: string;
  strategyId: string;
  symbol: string;
  direction: "long" | "short";
  netPnl: number;
  win: 0 | 1;
  rr: number;
  mae: number;
  mfe: number;
  holdingMs: number;
  fillDelayMs: number;
  hourUtc: number;
  weekday: number;
  isWeekend: 0 | 1;
  month: number;
  quarter: number;
  year: number;
  session: Session;
  exitReason: string;
  entryType: string;
  stopType: string;
  targetType: string;
  regime: string;         // "trending"|"range"|"volatile"|"quiet"|"unknown"
  fvgPresent: 0 | 1;
  sweepPresent: 0 | 1;
  atr: number;            // 0 if unknown
  atrPercentile: number;  // 0 if unknown
  adx: number;            // 0 if unknown
  volumeZ: number;        // 0 if unknown
  bodyPct: number;        // 0 if unknown
}

function readNum(obj: unknown, path: string[]): number {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return 0;
    cur = (cur as Record<string, unknown>)[k];
  }
  const n = typeof cur === "number" ? cur : Number(cur);
  return Number.isFinite(n) ? n : 0;
}
function readBool(obj: unknown, path: string[]): 0 | 1 {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return 0;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur ? 1 : 0;
}

function sessionOf(hourUtc: number): Session {
  if (hourUtc >= 0 && hourUtc < 7) return "asia";
  if (hourUtc >= 7 && hourUtc < 13) return "london";
  if (hourUtc >= 13 && hourUtc < 21) return "ny";
  return "other";
}

/** Heuristic regime classifier from ATR percentile + ADX-ish fields when present. */
function classifyRegime(t: TradeRecord): string {
  const adx = readNum(t, ["trend", "adx"]) || readNum(t, ["trend", "adx14"]);
  const atrPct = readNum(t, ["volatility", "atr_percentile"]);
  if (adx >= 25 && atrPct >= 60) return "trending_volatile";
  if (adx >= 25) return "trending";
  if (atrPct >= 75) return "volatile";
  if (atrPct <= 25) return "quiet";
  if (adx > 0 && adx < 18) return "range";
  return "unknown";
}

export function derive(t: TradeRecord): DerivedFeatures {
  const entry = t.entryTime ?? 0;
  const d = new Date(entry);
  const hour = d.getUTCHours();
  const weekday = t.weekday ?? d.getUTCDay();
  return {
    tradeId: t.tradeId,
    strategyId: t.strategyId,
    symbol: t.symbol,
    direction: t.direction,
    netPnl: Number.isFinite(t.netPnl) ? t.netPnl : 0,
    win: t.netPnl > 0 ? 1 : 0,
    rr: t.actualRr ?? 0,
    mae: t.mae ?? 0,
    mfe: t.mfe ?? 0,
    holdingMs: t.durationMs ?? 0,
    fillDelayMs: t.fillTime && t.orderTime ? t.fillTime - t.orderTime : 0,
    hourUtc: hour,
    weekday,
    isWeekend: weekday === 0 || weekday === 6 ? 1 : 0,
    month: t.month ?? d.getUTCMonth() + 1,
    quarter: t.quarter ?? Math.floor(d.getUTCMonth() / 3) + 1,
    year: t.year ?? d.getUTCFullYear(),
    session: (t.session as Session | null) ?? sessionOf(hour),
    exitReason: t.exitReason ?? "unknown",
    entryType: t.entryType ?? "unknown",
    stopType: t.stopType ?? "unknown",
    targetType: t.targetType ?? "unknown",
    regime: classifyRegime(t),
    fvgPresent: readBool(t, ["smartMoney", "fvg_present"]),
    sweepPresent: readBool(t, ["liquidity", "sweep_present"]) || readBool(t, ["smartMoney", "sweep_present"]),
    atr: readNum(t, ["volatility", "atr"]) || readNum(t, ["volatility", "daily_atr"]),
    atrPercentile: readNum(t, ["volatility", "atrPercentile"]) || readNum(t, ["volatility", "atr_percentile"]),
    adx: readNum(t, ["trend", "adx"]) || readNum(t, ["trend", "adx14"]),
    volumeZ: readNum(t, ["volumeProfile", "z"]),
    bodyPct: readNum(t, ["structure", "body_pct"]) || readNum(t, ["breakout", "body_pct"]),
  };
}

export function deriveAll(trades: TradeRecord[]): DerivedFeatures[] {
  return trades.map(derive);
}
