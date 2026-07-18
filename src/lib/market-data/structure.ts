// Market structure engine — swings, BOS, CHOCH, MSS.
import type { RawCandle, Swing } from "./types";

/** Detect fractal swings: bar is a swing high if it's the highest of the
 *  surrounding `lookback` bars on both sides. */
export function detectSwings(candles: RawCandle[], lookback = 5): Swing[] {
  const out: Swing[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh) out.push({ index: i, price: candles[i].high, type: "high" });
    if (isLow)  out.push({ index: i, price: candles[i].low,  type: "low" });
  }
  return out;
}

export interface StructurePerBar {
  swingHigh: number | null;
  swingLow: number | null;
  label: "HH" | "HL" | "LH" | "LL" | null;
  bos: "bull" | "bear" | null;
  choch: "bull" | "bear" | null;
  mss: "bull" | "bear" | null;
}

/**
 * Walk the candle series once and, using detected swings, tag each bar with
 * the most recent swing, HH/HL/LH/LL classification, and detect BOS/CHOCH.
 * MSS is a CHOCH that immediately follows the opposite BOS (structure shift).
 */
export function computeStructure(candles: RawCandle[], lookback = 5): StructurePerBar[] {
  const out: StructurePerBar[] = candles.map(() => ({
    swingHigh: null, swingLow: null, label: null, bos: null, choch: null, mss: null,
  }));
  const swings = detectSwings(candles, lookback);
  if (swings.length === 0) return out;

  let lastHigh: Swing | null = null;
  let prevHigh: Swing | null = null;
  let lastLow: Swing | null = null;
  let prevLow: Swing | null = null;
  let trend: "up" | "down" | null = null;
  let lastBosDir: "bull" | "bear" | null = null;

  let sIdx = 0;
  for (let i = 0; i < candles.length; i++) {
    // Consume any swings occurring at or before this bar.
    while (sIdx < swings.length && swings[sIdx].index <= i) {
      const s = swings[sIdx++];
      if (s.type === "high") {
        prevHigh = lastHigh; lastHigh = s;
        if (prevHigh) {
          out[s.index].label = s.price > prevHigh.price ? "HH" : "LH";
        }
      } else {
        prevLow = lastLow; lastLow = s;
        if (prevLow) {
          out[s.index].label = s.price > prevLow.price ? "HL" : "LL";
        }
      }
    }
    out[i].swingHigh = lastHigh?.price ?? null;
    out[i].swingLow = lastLow?.price ?? null;

    // Break detection at close.
    const c = candles[i].close;
    if (lastHigh && c > lastHigh.price && i > lastHigh.index) {
      const dir: "bull" = "bull";
      if (trend === "down") {
        out[i].choch = dir;
        if (lastBosDir === "bear") out[i].mss = dir;
      } else {
        out[i].bos = dir;
      }
      trend = "up"; lastBosDir = dir;
    } else if (lastLow && c < lastLow.price && i > lastLow.index) {
      const dir: "bear" = "bear";
      if (trend === "up") {
        out[i].choch = dir;
        if (lastBosDir === "bull") out[i].mss = dir;
      } else {
        out[i].bos = dir;
      }
      trend = "down"; lastBosDir = dir;
    }
  }
  return out;
}
