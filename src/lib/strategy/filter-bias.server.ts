// Server-only helpers that compute the daily bias / ATR / trend map used by
// backtest filters AND by the research/analytics layer. All fields optional
// so callers can request only what they need; extra work is cheap because
// we already fetch the daily kline series.
import type { Kline } from "@/lib/exchange/shark-client.server";

const IST_OFFSET_MIN = 330;

function istDate(msUtc: number): string {
  return new Date(msUtc + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
function addDaysIso(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
function isoWeekMonday(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay(); // 0=Sun..6=Sat
  const diff = (dow + 6) % 7; // days back to Monday
  return new Date(t.getTime() - diff * 86_400_000).toISOString().slice(0, 10);
}

export interface DailyBiasEntry {
  prev_close: number | null;
  ema: number | null;
  week_open: number | null;
  atr: number | null;
  /** Fast EMA of daily close (regime gate). */
  ema_fast: number | null;
  /** Slow EMA of daily close (regime gate). */
  ema_slow: number | null;
  /** SMA of ATR over `atrSqueezeLookback` bars — used by the ATR squeeze filter. */
  atr_lookback_avg: number | null;
  /** Prior-day close (same as prev_close, alias for clarity in gates that need the previous close). */
  prev_price: number | null;
  // ---- Phase 1 research fields (always populated) ----
  ema20: number | null;
  ema50: number | null;
  ema100: number | null;
  ema200: number | null;
  /** Wilder ADX(14) of the daily series — trend strength. */
  adx14: number | null;
  /** Prior IST-day open / high / low (paired with prev_close). */
  prev_open: number | null;
  prev_high: number | null;
  prev_low: number | null;
  /** IST-day-before-prev high/low — used by "outside day" classification. */
  prev2_high: number | null;
  prev2_low: number | null;
}

/**
 * Compute an IST-date-keyed bias map. Each entry describes the state that was
 * KNOWN AT THE START of that IST day (yesterday's close/ema/atr + this week's
 * Monday open), so callers never risk lookahead.
 */
export function computeDailyBias(
  daily: Kline[],
  opts: {
    emaLen: number;
    atrLen: number;
    emaFastLen?: number;
    emaSlowLen?: number;
    atrSqueezeLookback?: number;
  },
): Map<string, DailyBiasEntry> {
  const sorted = [...daily].sort((a, b) => a.openTime - b.openTime);
  const map = new Map<string, DailyBiasEntry>();

  const emaLen = Math.max(1, Math.floor(opts.emaLen));
  const k = 2 / (emaLen + 1);
  let ema: number | null = null;
  const closeWarmup: number[] = [];

  const emaFastLen = Math.max(1, Math.floor(opts.emaFastLen ?? 21));
  const emaSlowLen = Math.max(1, Math.floor(opts.emaSlowLen ?? 50));
  const kFast = 2 / (emaFastLen + 1);
  const kSlow = 2 / (emaSlowLen + 1);
  let emaFast: number | null = null;
  let emaSlow: number | null = null;
  const fastWarmup: number[] = [];
  const slowWarmup: number[] = [];

  // Phase 1 research EMAs (20/50/100/200) — always on.
  const emaState: Array<{ len: number; k: number; warm: number[]; val: number | null }> = [
    { len: 20, k: 2 / 21, warm: [], val: null },
    { len: 50, k: 2 / 51, warm: [], val: null },
    { len: 100, k: 2 / 101, warm: [], val: null },
    { len: 200, k: 2 / 201, warm: [], val: null },
  ];

  const atrLen = Math.max(1, Math.floor(opts.atrLen));
  const trWarmup: number[] = [];
  let atr: number | null = null;

  const squeezeLookback = Math.max(2, Math.floor(opts.atrSqueezeLookback ?? 20));
  const atrHistory: number[] = [];

  // Wilder ADX(14)
  const adxLen = 14;
  const dmPlusWarm: number[] = [];
  const dmMinusWarm: number[] = [];
  const trAdxWarm: number[] = [];
  let smPlus: number | null = null;
  let smMinus: number | null = null;
  let smTr: number | null = null;
  const dxHistory: number[] = [];
  let adx: number | null = null;

  const weekOpenByMonday = new Map<string, number>();

  // Track prev/prev-2 OHL for classification.
  let prev1: { open: number; high: number; low: number; close: number } | null = null;
  let prev2: { high: number; low: number } | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const date = istDate(c.openTime);

    // True range
    const prev = i > 0 ? sorted[i - 1] : null;
    const tr = prev
      ? Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close))
      : c.high - c.low;
    if (atr === null) {
      trWarmup.push(tr);
      if (trWarmup.length >= atrLen) {
        atr = trWarmup.reduce((s, x) => s + x, 0) / atrLen;
      }
    } else {
      atr = (atr * (atrLen - 1) + tr) / atrLen;
    }

    if (atr !== null) {
      atrHistory.push(atr);
      if (atrHistory.length > squeezeLookback) atrHistory.shift();
    }
    const atrLookbackAvg =
      atrHistory.length >= squeezeLookback
        ? atrHistory.reduce((s, x) => s + x, 0) / atrHistory.length
        : null;

    // ADX(14) with Wilder smoothing.
    if (prev) {
      const upMove = c.high - prev.high;
      const downMove = prev.low - c.low;
      const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
      const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
      if (smPlus === null) {
        dmPlusWarm.push(plusDM);
        dmMinusWarm.push(minusDM);
        trAdxWarm.push(tr);
        if (dmPlusWarm.length >= adxLen) {
          smPlus = dmPlusWarm.reduce((s, x) => s + x, 0);
          smMinus = dmMinusWarm.reduce((s, x) => s + x, 0);
          smTr = trAdxWarm.reduce((s, x) => s + x, 0);
        }
      } else {
        smPlus = smPlus - smPlus / adxLen + plusDM;
        smMinus = (smMinus as number) - (smMinus as number) / adxLen + minusDM;
        smTr = (smTr as number) - (smTr as number) / adxLen + tr;
      }
      if (smPlus !== null && smMinus !== null && smTr && smTr > 0) {
        const diPlus = 100 * (smPlus / smTr);
        const diMinus = 100 * (smMinus / smTr);
        const denom = diPlus + diMinus;
        const dx = denom > 0 ? (100 * Math.abs(diPlus - diMinus)) / denom : 0;
        dxHistory.push(dx);
        if (adx === null) {
          if (dxHistory.length >= adxLen) {
            adx = dxHistory.slice(-adxLen).reduce((s, x) => s + x, 0) / adxLen;
          }
        } else {
          adx = (adx * (adxLen - 1) + dx) / adxLen;
        }
      }
    }

    // EMA of close (single, legacy)
    if (ema === null) {
      closeWarmup.push(c.close);
      if (closeWarmup.length >= emaLen) {
        ema = closeWarmup.reduce((s, x) => s + x, 0) / emaLen;
      }
    } else {
      ema = c.close * k + ema * (1 - k);
    }

    // Fast + slow EMAs for regime gate
    if (emaFast === null) {
      fastWarmup.push(c.close);
      if (fastWarmup.length >= emaFastLen) {
        emaFast = fastWarmup.reduce((s, x) => s + x, 0) / emaFastLen;
      }
    } else {
      emaFast = c.close * kFast + emaFast * (1 - kFast);
    }
    if (emaSlow === null) {
      slowWarmup.push(c.close);
      if (slowWarmup.length >= emaSlowLen) {
        emaSlow = slowWarmup.reduce((s, x) => s + x, 0) / emaSlowLen;
      }
    } else {
      emaSlow = c.close * kSlow + emaSlow * (1 - kSlow);
    }

    // Phase 1 EMAs
    for (const e of emaState) {
      if (e.val === null) {
        e.warm.push(c.close);
        if (e.warm.length >= e.len) {
          e.val = e.warm.reduce((s, x) => s + x, 0) / e.len;
        }
      } else {
        e.val = c.close * e.k + e.val * (1 - e.k);
      }
    }

    // Weekly open cache — first candle whose IST date maps to this Monday
    const monday = isoWeekMonday(date);
    if (!weekOpenByMonday.has(monday)) weekOpenByMonday.set(monday, c.open);

    // Attach bias to the NEXT IST date so it reflects known-yesterday values.
    const nextDate = addDaysIso(date, 1);
    map.set(nextDate, {
      prev_close: c.close,
      prev_price: c.close,
      ema,
      ema_fast: emaFast,
      ema_slow: emaSlow,
      week_open: weekOpenByMonday.get(isoWeekMonday(nextDate)) ?? null,
      atr,
      atr_lookback_avg: atrLookbackAvg,
      ema20: emaState[0].val,
      ema50: emaState[1].val,
      ema100: emaState[2].val,
      ema200: emaState[3].val,
      adx14: adx,
      prev_open: c.open,
      prev_high: c.high,
      prev_low: c.low,
      prev2_high: prev1?.high ?? null,
      prev2_low: prev1?.low ?? null,
    });

    prev2 = prev1 ? { high: prev1.high, low: prev1.low } : null;
    prev1 = { open: c.open, high: c.high, low: c.low, close: c.close };
    // Silence "assigned but never used" warnings for prev2 (kept for clarity of intent).
    void prev2;
  }

  return map;
}
