// Liquidity engine — previous-period highs/lows and equal-highs/lows.
import { localDateKey, toLocal, isoWeekNumber } from "./timezone";
import type { RawCandle, Timezone } from "./types";

export interface LiquidityPerBar {
  prevDayHigh: number | null;
  prevDayLow: number | null;
  prevWeekHigh: number | null;
  prevWeekLow: number | null;
  prevMonthHigh: number | null;
  prevMonthLow: number | null;
  equalHigh: boolean;
  equalLow: boolean;
}

interface HL { high: number; low: number }

export function computeLiquidity(
  candles: RawCandle[],
  strategyTz: Timezone,
  eqTolerancePct = 0.05, // 0.05% equal-level tolerance
): LiquidityPerBar[] {
  const out: LiquidityPerBar[] = candles.map(() => ({
    prevDayHigh: null, prevDayLow: null,
    prevWeekHigh: null, prevWeekLow: null,
    prevMonthHigh: null, prevMonthLow: null,
    equalHigh: false, equalLow: false,
  }));

  const dayMap = new Map<string, HL>();
  const weekMap = new Map<string, HL>();
  const monthMap = new Map<string, HL>();

  const dayKeys: string[] = [];
  const weekKeys: string[] = [];
  const monthKeys: string[] = [];

  for (const c of candles) {
    const dk = localDateKey(c.ts, strategyTz);
    const mk = dk.slice(0, 7);
    const local = toLocal(c.ts, strategyTz);
    const wk = `${local.year}-W${String(isoWeekNumber(c.ts, strategyTz)).padStart(2, "0")}`;
    for (const [key, arr, map] of [
      [dk, dayKeys, dayMap], [wk, weekKeys, weekMap], [mk, monthKeys, monthMap],
    ] as const) {
      const cur = map.get(key);
      if (!cur) {
        map.set(key, { high: c.high, low: c.low });
        arr.push(key);
      } else {
        if (c.high > cur.high) cur.high = c.high;
        if (c.low < cur.low) cur.low = c.low;
      }
    }
  }

  const prev = (arr: string[], map: Map<string, HL>, cur: string): HL | null => {
    const i = arr.indexOf(cur);
    if (i <= 0) return null;
    return map.get(arr[i - 1]) ?? null;
  };

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const dk = localDateKey(c.ts, strategyTz);
    const local = toLocal(c.ts, strategyTz);
    const wk = `${local.year}-W${String(isoWeekNumber(c.ts, strategyTz)).padStart(2, "0")}`;
    const mk = dk.slice(0, 7);
    const pd = prev(dayKeys, dayMap, dk);
    const pw = prev(weekKeys, weekMap, wk);
    const pm = prev(monthKeys, monthMap, mk);
    out[i].prevDayHigh = pd?.high ?? null;
    out[i].prevDayLow = pd?.low ?? null;
    out[i].prevWeekHigh = pw?.high ?? null;
    out[i].prevWeekLow = pw?.low ?? null;
    out[i].prevMonthHigh = pm?.high ?? null;
    out[i].prevMonthLow = pm?.low ?? null;

    // Equal high / low against previous 20 bars.
    const tolHigh = c.high * (eqTolerancePct / 100);
    const tolLow = c.low * (eqTolerancePct / 100);
    for (let j = Math.max(0, i - 20); j < i; j++) {
      if (Math.abs(candles[j].high - c.high) <= tolHigh) { out[i].equalHigh = true; break; }
    }
    for (let j = Math.max(0, i - 20); j < i; j++) {
      if (Math.abs(candles[j].low - c.low) <= tolLow) { out[i].equalLow = true; break; }
    }
  }
  return out;
}
