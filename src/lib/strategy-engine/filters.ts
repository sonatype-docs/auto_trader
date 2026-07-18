// Filter engine — session, trend, volatility. Pure predicates.
// Each returns { pass, reason } so the engine can log filtersPassed/Failed.
import type { EnrichedCandle } from "@/lib/market-data/types";
import type { SessionFilter, TrendFilter, VolatilityFilter } from "./types";

export interface FilterResult { pass: boolean; reason?: string; label: string }

export function evalSessionFilter(bar: EnrichedCandle, f: SessionFilter | undefined): FilterResult {
  if (!f) return { pass: true, label: "session" };
  if (f.allowedSessions && !f.allowedSessions.includes(bar.session))
    return { pass: false, label: "session.allowed", reason: `session=${bar.session}` };
  if (f.allowedWeekdays && !f.allowedWeekdays.includes(bar.weekday))
    return { pass: false, label: "session.weekday", reason: `weekday=${bar.weekday}` };
  if (f.blockWeekend && bar.isWeekend) return { pass: false, label: "session.weekend" };
  if (f.blockHoliday && bar.isHoliday) return { pass: false, label: "session.holiday" };
  if (f.blockMonthEnd && bar.isMonthEnd) return { pass: false, label: "session.monthEnd" };
  if (f.blockQuarterEnd && bar.isQuarterEnd) return { pass: false, label: "session.quarterEnd" };
  if (f.blockFirstTradingDay && bar.isFirstTradingDay) return { pass: false, label: "session.firstTradingDay" };
  if (f.blockLastTradingDay && bar.isLastTradingDay) return { pass: false, label: "session.lastTradingDay" };
  if (f.customSessions?.length && !f.customSessions.every((c) => bar.customSessions.includes(c)))
    return { pass: false, label: "session.custom" };
  if (f.hoursOfDay && !f.hoursOfDay.includes(bar.hour))
    return { pass: false, label: "session.hour", reason: `hour=${bar.hour}` };
  return { pass: true, label: "session" };
}

function emaField(len: number): keyof EnrichedCandle | null {
  if (len === 20) return "ema20";
  if (len === 50) return "ema50";
  if (len === 100) return "ema100";
  if (len === 200) return "ema200";
  return null;
}

export function evalTrendFilter(
  bar: EnrichedCandle,
  bars: EnrichedCandle[],
  index: number,
  f: TrendFilter | undefined,
): FilterResult {
  if (!f) return { pass: true, label: "trend" };
  if (f.emaAlignment) {
    for (const len of f.emaAlignment.above ?? []) {
      const key = emaField(len); if (!key) continue;
      const v = bar[key] as number | null;
      if (v === null || bar.close <= v) return { pass: false, label: `trend.above_ema${len}` };
    }
    for (const len of f.emaAlignment.below ?? []) {
      const key = emaField(len); if (!key) continue;
      const v = bar[key] as number | null;
      if (v === null || bar.close >= v) return { pass: false, label: `trend.below_ema${len}` };
    }
  }
  if (f.emaCrossover) {
    const fastKey = emaField(f.emaCrossover.fast);
    const slowKey = emaField(f.emaCrossover.slow);
    if (fastKey && slowKey) {
      const fast = bar[fastKey] as number | null;
      const slow = bar[slowKey] as number | null;
      if (fast === null || slow === null) return { pass: false, label: "trend.ema_data" };
      if (f.emaCrossover.direction === "bull" && fast <= slow) return { pass: false, label: "trend.ema_cross_bull" };
      if (f.emaCrossover.direction === "bear" && fast >= slow) return { pass: false, label: "trend.ema_cross_bear" };
    }
  }
  if (f.vwapSide && bar.vwapDaily !== null) {
    if (f.vwapSide === "above" && bar.close <= bar.vwapDaily) return { pass: false, label: "trend.vwap_above" };
    if (f.vwapSide === "below" && bar.close >= bar.vwapDaily) return { pass: false, label: "trend.vwap_below" };
  }
  if (f.adxMin !== undefined && (bar.adx === null || bar.adx < f.adxMin))
    return { pass: false, label: "trend.adx_min" };
  if (f.adxMax !== undefined && (bar.adx === null || bar.adx > f.adxMax))
    return { pass: false, label: "trend.adx_max" };
  if (f.requireStructure && bar.structure && !f.requireStructure.includes(bar.structure))
    return { pass: false, label: "trend.structure" };
  if (f.trendSlopeLen && f.trendSlopeMin !== undefined) {
    const prev = bars[index - f.trendSlopeLen];
    if (!prev || prev.ema50 === null || bar.ema50 === null) return { pass: false, label: "trend.slope_data" };
    const slope = (bar.ema50 - prev.ema50) / f.trendSlopeLen;
    if (Math.abs(slope) < f.trendSlopeMin) return { pass: false, label: "trend.slope" };
  }
  return { pass: true, label: "trend" };
}

export function evalVolatilityFilter(
  bar: EnrichedCandle,
  prev: EnrichedCandle | null,
  f: VolatilityFilter | undefined,
): FilterResult {
  if (!f) return { pass: true, label: "vol" };
  if (f.atrMin !== undefined && (bar.atr === null || bar.atr < f.atrMin))
    return { pass: false, label: "vol.atr_min" };
  if (f.atrMax !== undefined && (bar.atr === null || bar.atr > f.atrMax))
    return { pass: false, label: "vol.atr_max" };
  if (f.atrPercentileMin !== undefined && (bar.atrPercentile === null || bar.atrPercentile < f.atrPercentileMin))
    return { pass: false, label: "vol.atr_pct_min" };
  if (f.atrPercentileMax !== undefined && (bar.atrPercentile === null || bar.atrPercentile > f.atrPercentileMax))
    return { pass: false, label: "vol.atr_pct_max" };
  if (f.openingRangeMin !== undefined && (bar.openingRangeSize === null || bar.openingRangeSize < f.openingRangeMin))
    return { pass: false, label: "vol.or_min" };
  if (f.openingRangeMax !== undefined && (bar.openingRangeSize === null || bar.openingRangeSize > f.openingRangeMax))
    return { pass: false, label: "vol.or_max" };
  if (f.dailyRangeMin !== undefined && (bar.dailyRange === null || bar.dailyRange < f.dailyRangeMin))
    return { pass: false, label: "vol.day_range" };
  if (f.weeklyRangeMin !== undefined && (bar.weeklyRange === null || bar.weeklyRange < f.weeklyRangeMin))
    return { pass: false, label: "vol.week_range" };
  if (f.requireExpansion && (prev?.atr == null || bar.atr == null || bar.atr <= prev.atr))
    return { pass: false, label: "vol.expansion" };
  if (f.requireCompression && (prev?.atr == null || bar.atr == null || bar.atr >= prev.atr))
    return { pass: false, label: "vol.compression" };
  return { pass: true, label: "vol" };
}
