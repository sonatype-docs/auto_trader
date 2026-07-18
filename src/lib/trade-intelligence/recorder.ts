// Trade Recorder — turns an execution-engine Trade + surrounding market
// context into a rich TradeRecord ready for the database.
// Never invents data; only copies what the engines already computed.

import type { Trade } from "@/lib/execution-engine/types";
import type { EnrichedCandle } from "@/lib/market-data/types";
import type { StrategySignal } from "@/lib/strategy-engine/types";
import type { JsonMap, TradeRecord } from "./types";

export interface RecorderContext {
  strategyId: string;
  strategyVersion?: string;
  symbol: string;
  timeframe?: string;
  bars: EnrichedCandle[];
  signalsById?: Map<string, StrategySignal>;
  extraTags?: string[];
  customFields?: JsonMap;
}

function findBarAt(bars: EnrichedCandle[], ts: number): EnrichedCandle | null {
  // Binary search on ts (ascending).
  let lo = 0, hi = bars.length - 1, res: EnrichedCandle | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].ts <= ts) { res = bars[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return res;
}

function slice(bars: EnrichedCandle[], fromTs: number, toTs: number): EnrichedCandle[] {
  const out: EnrichedCandle[] = [];
  for (const b of bars) { if (b.ts >= fromTs && b.ts <= toTs) out.push(b); }
  return out;
}

export function toTradeRecord(trade: Trade, ctx: RecorderContext): TradeRecord {
  const entryBar = findBarAt(ctx.bars, trade.entryTime) ?? ctx.bars[0];
  const exitBar = findBarAt(ctx.bars, trade.exitTime) ?? entryBar;
  void exitBar;
  const inTrade = slice(ctx.bars, trade.entryTime, trade.exitTime);
  const sig = ctx.signalsById?.get(trade.signalId);
  const meta = (sig?.metadata ?? {}) as unknown as JsonMap;


  const risk = trade.risk;
  const riskPct = risk > 0 ? (Math.abs(trade.netPnL) / risk) * (trade.netPnL < 0 ? -1 : 1) : null;

  let highDuring = -Infinity, lowDuring = Infinity;
  let mfCandle = 0, maCandle = 0;
  for (let i = 0; i < inTrade.length; i++) {
    const b = inTrade[i];
    if (b.high > highDuring) { highDuring = b.high; mfCandle = i; }
    if (b.low < lowDuring)  { lowDuring = b.low; maCandle = i; }
  }
  if (!isFinite(highDuring)) highDuring = trade.fillPrice;
  if (!isFinite(lowDuring)) lowDuring = trade.fillPrice;

  const weekday = entryBar.weekday;
  const record: TradeRecord = {
    tradeId: trade.tradeId,
    strategyId: ctx.strategyId,
    strategyVersion: ctx.strategyVersion ?? null,
    symbol: ctx.symbol,
    timeframe: ctx.timeframe ?? null,
    direction: trade.direction,
    tradeType: (meta.tradeType as string | undefined) ?? null,
    entryType: trade.entryType,
    stopType: (meta.stopType as string | undefined) ?? null,
    targetType: (meta.targetType as string | undefined) ?? null,
    status: "closed",
    session: entryBar.session,

    signalTime: sig?.timestamp ?? null,
    orderTime: trade.entryTime,
    fillTime: trade.entryTime,
    entryTime: trade.entryTime,
    exitTime: trade.exitTime,
    weekday,
    weekNumber: entryBar.weekNumber,
    month: entryBar.month,
    quarter: entryBar.quarter,
    year: new Date(trade.entryTime).getUTCFullYear(),

    entryPrice: trade.entryPrice,
    fillPrice: trade.fillPrice,
    exitPrice: trade.exitPrice,
    stopPrice: trade.stopPrice,
    targetPrice: trade.targetPrice,
    positionSize: (meta.positionSize as number | undefined) ?? null,
    riskUsd: trade.risk,
    riskPct,
    actualRr: trade.rr,
    grossPnl: trade.grossPnL,
    netPnl: trade.netPnL,
    pnlPct: null,
    pnlR: trade.rr,
    mae: trade.mae,
    mfe: trade.mfe,
    fees: trade.fees,
    commission: trade.commission,
    slippage: trade.slippage,
    spreadCost: trade.spreadCost,
    holdingBars: trade.holdingTime,
    durationMs: trade.duration,
    exitReason: trade.exitReason,

    price: {
      signalPrice: sig?.entryPrice ?? null,
      averageEntry: trade.fillPrice,
      averageExit: trade.exitPrice,
      highestDuring: highDuring,
      lowestDuring: lowDuring,
    },
    risk: {
      riskUsd: trade.risk,
      reward: trade.reward,
      targetRr: meta.targetRr ?? null,
      actualRr: trade.rr,
    },
    performance: {
      grossPnL: trade.grossPnL,
      netPnL: trade.netPnL,
      pnlR: trade.rr,
      mae: trade.mae,
      mfe: trade.mfe,
      tradeEfficiency: trade.mfe > 0 ? (trade.netPnL / trade.mfe) : null,
      partials: trade.partialExits,
      runnerProfit: trade.runnerProfit,
    },
    duration: {
      timeToFill: trade.fillDelay,
      holdingBars: trade.holdingTime,
      durationMs: trade.duration,
      candlesInTrade: inTrade.length,
      maxFavorableCandle: mfCandle,
      maxAdverseCandle: maCandle,
    },
    volatility: {
      atr: entryBar.atr,
      atrPercentile: entryBar.atrPercentile,
      trueRange: entryBar.trueRange,
      openingRange: entryBar.openingRangeSize,
      openingRangePercentile: entryBar.openingRangePercentile,
      dailyRange: entryBar.dailyRange,
      weeklyRange: entryBar.weeklyRange,
      monthlyRange: entryBar.monthlyRange,
    },
    trend: {
      ema20: entryBar.ema20, ema50: entryBar.ema50,
      ema100: entryBar.ema100, ema200: entryBar.ema200,
      sma20: entryBar.sma20, sma50: entryBar.sma50,
      emaAligned: alignment(entryBar),
      adx: entryBar.adx, rsi: entryBar.rsi, macd: entryBar.macd,
      vwapSession: entryBar.vwapSession,
      vwapDaily: entryBar.vwapDaily,
      vwapWeekly: entryBar.vwapWeekly,
      vwapMonthly: entryBar.vwapMonthly,
      trendDirection: entryBar.structure,
    },
    structure: {
      structure: entryBar.structure,
      bos: entryBar.bos,
      choch: entryBar.choch,
      mss: entryBar.mss,
      swingHigh: entryBar.swingHigh,
      swingLow: entryBar.swingLow,
    },
    liquidity: {
      prevDayHigh: entryBar.prevDayHigh,
      prevDayLow: entryBar.prevDayLow,
      prevWeekHigh: entryBar.prevWeekHigh,
      prevWeekLow: entryBar.prevWeekLow,
      prevMonthHigh: entryBar.prevMonthHigh,
      prevMonthLow: entryBar.prevMonthLow,
      equalHigh: entryBar.equalHigh,
      equalLow: entryBar.equalLow,
      liquiditySweep: (meta.liquiditySweep as boolean | null) ?? null,
      liquidityDirection: (meta.liquidityDirection as string | null) ?? null,
    },
    smartMoney: {
      orderBlock: meta.orderBlock ?? null,
      mitigationBlock: meta.mitigationBlock ?? null,
      breakerBlock: meta.breakerBlock ?? null,
      bullishFVG: meta.bullishFVG ?? null,
      bearishFVG: meta.bearishFVG ?? null,
      ifvg: meta.ifvg ?? null,
      displacement: meta.displacement ?? null,
      imbalanceSize: meta.imbalanceSize ?? null,
    },
    volumeProfile: {
      poc: meta.poc ?? null,
      vah: meta.vah ?? null,
      val: meta.val ?? null,
      hvn: meta.hvn ?? null,
      lvn: meta.lvn ?? null,
    },
    breakout: {
      breakDistance: entryBar.breakDistance,
      breakVolume: entryBar.volume,
    },
    entryQuality: {
      entryDelayBars: trade.fillDelay,
      fillPrice: trade.fillPrice,
      signalPrice: sig?.entryPrice ?? trade.entryPrice,
      slipPoints: trade.fillPrice - trade.entryPrice,
    },
    stop: {
      stopDistance: Math.abs(trade.fillPrice - trade.stopPrice),
      atrStop: entryBar.atr,
      trailingUsed: (trade.metadata?.trailingApplied as boolean | undefined) ?? false,
      breakEvenUsed: (trade.metadata?.breakEvenApplied as boolean | undefined) ?? false,
    },
    target: {
      targetDistance: Math.abs(trade.targetPrice - trade.fillPrice),
      targetHit: trade.exitReason?.startsWith("take_profit") ?? false,
      partialTP: trade.partialExits.length > 0,
      runner: trade.runnerProfit !== 0,
      exitReason: trade.exitReason,
    },
    filters: (meta.filtersPassed as JsonMap | undefined) ?? {},
    news: { isNews: entryBar.isNews, isHoliday: entryBar.isHoliday },
    regime: {
      isTrending: entryBar.adx != null ? entryBar.adx > 20 : null,
      volatilityBucket: entryBar.atrPercentile == null ? null
        : entryBar.atrPercentile > 70 ? "high"
        : entryBar.atrPercentile < 30 ? "low" : "mid",
    },
    custom: { ...(meta.custom as JsonMap | undefined ?? {}), ...(ctx.customFields ?? {}) },
    tags: [...(meta.tags as string[] | undefined ?? []), ...(ctx.extraTags ?? [])],
    raw: {
      signalMetadata: sig?.metadata ?? {},
      tradeMetadata: trade.metadata,
    },
  };
  return record;
}

function alignment(b: EnrichedCandle): "bull" | "bear" | "mixed" | null {
  const e = [b.ema20, b.ema50, b.ema100, b.ema200];
  if (e.some((x) => x == null)) return null;
  const [e20, e50, e100, e200] = e as number[];
  if (e20 > e50 && e50 > e100 && e100 > e200) return "bull";
  if (e20 < e50 && e50 < e100 && e100 < e200) return "bear";
  return "mixed";
}
