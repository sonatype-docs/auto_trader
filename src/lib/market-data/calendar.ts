// Market calendar — weekends, holidays, month/quarter/year boundaries.
import { localDateKey, toLocal } from "./timezone";
import type { Timezone } from "./types";

export interface CalendarFlags {
  isWeekend: boolean;
  isHoliday: boolean;
  isMonthEnd: boolean;
  isQuarterEnd: boolean;
  isYearEnd: boolean;
  isFirstTradingDay: boolean;
  isLastTradingDay: boolean;
}

/**
 * Compute per-bar calendar flags in the strategy timezone. `tradingDaysSet`
 * is the set of yyyy-mm-dd date keys that actually contain candles (so we
 * can flag first/last trading day of month accurately).
 */
export function calendarFlags(
  tsUtcMs: number,
  strategyTz: Timezone,
  holidays: Set<string>,
  tradingDaysSet: Set<string>,
  firstOfMonthByKey: Map<string, string>,
  lastOfMonthByKey: Map<string, string>,
): CalendarFlags {
  const local = toLocal(tsUtcMs, strategyTz);
  const key = localDateKey(tsUtcMs, strategyTz);
  const isWeekend = local.weekday === 0 || local.weekday === 6;
  const isHoliday = holidays.has(key);
  const monthKey = key.slice(0, 7);
  const first = firstOfMonthByKey.get(monthKey);
  const last = lastOfMonthByKey.get(monthKey);
  const nextDay = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  const nextKey = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDay.getUTCDate()).padStart(2, "0")}`;
  const isMonthEnd = nextKey.slice(0, 7) !== monthKey;
  const isQuarterEnd = isMonthEnd && [3, 6, 9, 12].includes(local.month);
  const isYearEnd = isMonthEnd && local.month === 12;
  return {
    isWeekend,
    isHoliday,
    isMonthEnd,
    isQuarterEnd,
    isYearEnd,
    isFirstTradingDay: first === key && tradingDaysSet.has(key),
    isLastTradingDay: last === key && tradingDaysSet.has(key),
  };
}

export function buildTradingDayMaps(
  timestamps: number[],
  strategyTz: Timezone,
): { set: Set<string>; firstOfMonth: Map<string, string>; lastOfMonth: Map<string, string> } {
  const set = new Set<string>();
  const firstOfMonth = new Map<string, string>();
  const lastOfMonth = new Map<string, string>();
  for (const ts of timestamps) {
    const key = localDateKey(ts, strategyTz);
    set.add(key);
    const monthKey = key.slice(0, 7);
    if (!firstOfMonth.has(monthKey) || key < (firstOfMonth.get(monthKey) as string)) {
      firstOfMonth.set(monthKey, key);
    }
    if (!lastOfMonth.has(monthKey) || key > (lastOfMonth.get(monthKey) as string)) {
      lastOfMonth.set(monthKey, key);
    }
  }
  return { set, firstOfMonth, lastOfMonth };
}
