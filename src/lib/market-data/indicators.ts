// Indicator engine — pure. All functions return arrays aligned with input.
// Values before the required lookback return null.
import type { RawCandle } from "./types";

export function ema(values: number[], length: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length === 0) return out;
  const k = 2 / (length + 1);
  let prev: number | null = null;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i < length - 1) continue;
    if (prev === null) {
      prev = sum / length;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

export function sma(values: number[], length: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= length) sum -= values[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

export function trueRange(candles: RawCandle[]): number[] {
  const out = new Array(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) { out[i] = c.high - c.low; continue; }
    const prev = candles[i - 1];
    out[i] = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  }
  return out;
}

export function atr(candles: RawCandle[], length: number): (number | null)[] {
  const tr = trueRange(candles);
  // Wilder's smoothing.
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let prev: number | null = null;
  let sum = 0;
  for (let i = 0; i < tr.length; i++) {
    sum += tr[i];
    if (i < length - 1) continue;
    if (prev === null) prev = sum / length;
    else prev = (prev * (length - 1) + tr[i]) / length;
    out[i] = prev;
  }
  return out;
}

export function rollingPercentile(values: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const buf: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) continue;
    buf.push(v);
    if (buf.length > window) buf.shift();
    if (buf.length < 10) continue;
    const sorted = [...buf].sort((a, b) => a - b);
    const rank = sorted.findIndex((x) => x >= v);
    out[i] = ((rank < 0 ? sorted.length - 1 : rank) / (sorted.length - 1)) * 100;
  }
  return out;
}

export function rsi(closes: number[], length = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i < closes.length; i++) {
    const chg = closes[i] - closes[i - 1];
    const gain = Math.max(0, chg);
    const loss = Math.max(0, -chg);
    if (i <= length) {
      gainSum += gain; lossSum += loss;
      if (i === length) {
        const rs = lossSum === 0 ? 100 : gainSum / lossSum;
        out[i] = 100 - 100 / (1 + rs);
      }
      continue;
    }
    gainSum = (gainSum * (length - 1) + gain) / length;
    lossSum = (lossSum * (length - 1) + loss) / length;
    const rs = lossSum === 0 ? 100 : gainSum / lossSum;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

export function macd(
  closes: number[],
  fast = 12, slow = 26, signal = 9,
): Array<{ macd: number; signal: number; hist: number } | null> {
  const fastE = ema(closes, fast);
  const slowE = ema(closes, slow);
  const macdLine: number[] = closes.map((_, i) => {
    const f = fastE[i]; const s = slowE[i];
    return f !== null && s !== null ? f - s : 0;
  });
  const sigLine = ema(macdLine, signal);
  return closes.map((_, i) => {
    const m = fastE[i] !== null && slowE[i] !== null ? (fastE[i] as number) - (slowE[i] as number) : null;
    const s = sigLine[i];
    if (m === null || s === null) return null;
    return { macd: m, signal: s, hist: m - s };
  });
}

export function adx(candles: RawCandle[], length = 14): (number | null)[] {
  const n = candles.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < length + 1) return out;
  const tr: number[] = new Array(n).fill(0);
  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
  }
  let trS = 0, pS = 0, mS = 0;
  for (let i = 1; i <= length; i++) { trS += tr[i]; pS += plusDM[i]; mS += minusDM[i]; }
  const dx: number[] = new Array(n).fill(0);
  for (let i = length + 1; i < n; i++) {
    trS = trS - trS / length + tr[i];
    pS = pS - pS / length + plusDM[i];
    mS = mS - mS / length + minusDM[i];
    const pDI = (pS / trS) * 100;
    const mDI = (mS / trS) * 100;
    dx[i] = (Math.abs(pDI - mDI) / (pDI + mDI || 1)) * 100;
  }
  // ADX = smoothed DX
  let adxVal: number | null = null;
  let sum = 0;
  for (let i = length + 1; i < n; i++) {
    sum += dx[i];
    const filled = i - length;
    if (filled < length) continue;
    if (adxVal === null) adxVal = sum / length;
    else adxVal = (adxVal * (length - 1) + dx[i]) / length;
    out[i] = adxVal;
  }
  return out;
}

/**
 * Anchored VWAP that resets whenever `bucketKey(i)` differs from previous.
 * Common uses: session/daily/weekly/monthly VWAP.
 */
export function anchoredVwap(candles: RawCandle[], bucketKey: (i: number) => string): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let curKey = "";
  let pv = 0, vol = 0;
  for (let i = 0; i < candles.length; i++) {
    const key = bucketKey(i);
    if (key !== curKey) { curKey = key; pv = 0; vol = 0; }
    const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const v = candles[i].volume || 1;
    pv += typical * v;
    vol += v;
    out[i] = vol > 0 ? pv / vol : null;
  }
  return out;
}
