// Resample raw candles to any target timeframe by bucketing on UTC ms.
import { TIMEFRAME_MS, type RawCandle, type Timeframe } from "./types";

export function resample(base: RawCandle[], target: Timeframe): RawCandle[] {
  if (base.length === 0) return [];
  // Weekly / monthly use calendar bucketing.
  if (target === "1w") return resampleByBucket(base, weekBucket);
  if (target === "1M") return resampleByBucket(base, monthBucket);
  const size = TIMEFRAME_MS[target];
  return resampleByBucket(base, (ts) => Math.floor(ts / size) * size);
}

function resampleByBucket(base: RawCandle[], bucketOf: (ts: number) => number): RawCandle[] {
  const out: RawCandle[] = [];
  let cur: RawCandle | null = null;
  let curKey = -1;
  for (const c of base) {
    const key = bucketOf(c.ts);
    if (key !== curKey) {
      if (cur) out.push(cur);
      cur = { ts: key, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
      curKey = key;
    } else if (cur) {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function weekBucket(ts: number): number {
  const d = new Date(ts);
  const day = d.getUTCDay();
  const mondayOffset = (day + 6) % 7;
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - mondayOffset);
  return monday;
}
function monthBucket(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
