// Data API — the clean read-side used by strategies. Strategies never touch
// the raw kline source; they consume this instead.
import type { EnrichedCandle } from "./types";

export class MarketDataApi {
  constructor(private readonly bars: EnrichedCandle[]) {}

  get length(): number { return this.bars.length; }
  all(): EnrichedCandle[] { return this.bars; }

  at(i: number): EnrichedCandle | null { return this.bars[i] ?? null; }
  current(i: number): EnrichedCandle | null { return this.at(i); }
  previous(i: number): EnrichedCandle | null { return this.at(i - 1); }
  next(i: number): EnrichedCandle | null { return this.at(i + 1); }

  currentAtr(i: number): number | null { return this.at(i)?.atr ?? null; }
  currentSession(i: number) { return this.at(i)?.session ?? null; }
  currentTrend(i: number): "up" | "down" | "flat" | null {
    const b = this.at(i); if (!b) return null;
    if (b.ema50 === null || b.ema200 === null) return null;
    if (b.ema50 > b.ema200) return "up";
    if (b.ema50 < b.ema200) return "down";
    return "flat";
  }
  currentVwap(i: number): number | null { return this.at(i)?.vwapSession ?? null; }
  currentVolume(i: number): number | null { return this.at(i)?.volume ?? null; }
  currentSwing(i: number) {
    const b = this.at(i);
    return b ? { high: b.swingHigh, low: b.swingLow } : null;
  }
  currentLiquidity(i: number) {
    const b = this.at(i);
    if (!b) return null;
    return {
      prevDayHigh: b.prevDayHigh, prevDayLow: b.prevDayLow,
      prevWeekHigh: b.prevWeekHigh, prevWeekLow: b.prevWeekLow,
      prevMonthHigh: b.prevMonthHigh, prevMonthLow: b.prevMonthLow,
      equalHigh: b.equalHigh, equalLow: b.equalLow,
    };
  }
  currentStructure(i: number) {
    const b = this.at(i);
    if (!b) return null;
    return { label: b.structure, bos: b.bos, choch: b.choch, mss: b.mss };
  }

  /** Slice by inclusive-exclusive UTC-ms range. */
  slice(fromMs: number, toMs: number): EnrichedCandle[] {
    return this.bars.filter((b) => b.ts >= fromMs && b.ts < toMs);
  }
}
