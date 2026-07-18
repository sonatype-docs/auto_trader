// ICT Silver Bullet — NY AM kill zone (approx 19:00–21:00 IST).
// Simplified rule set (backtest-oriented):
//   1. Restrict activity to a configurable IST window.
//   2. Detect Market Structure Shift (MSS): close breaks the most recent
//      swing high (bullish) or swing low (bearish) within a lookback.
//   3. In the impulse leg that caused the MSS, find the freshest 3-bar
//      Fair Value Gap (FVG). Bullish FVG: bar[i-2].high < bar[i].low, so
//      the gap zone is [bar[i-2].high, bar[i].low]. Bearish is mirrored.
//   4. Arm a limit entry at the near edge of the FVG. SL beyond the MSS
//      swing extreme + a small buffer. TP by R multiple.
//   5. Walk subsequent bars in the window (+ a configurable holding
//      cutoff hour) until TP / SL / cutoff.
//
// Uses 5m klines fetched via SharkExchange for detection and execution.

import { createSharkClient, type Kline } from "@/lib/exchange/shark-client.server";

const IST_OFFSET_MIN = 330;
function istDate(msUtc: number): string {
  return new Date(msUtc + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
function istMinutes(msUtc: number): number {
  const d = new Date(msUtc + IST_OFFSET_MIN * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function istWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function parseHhMm(s: string): number {
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return h * 60 + (m || 0);
}

export type SbSide = "long" | "short";

export interface SbTrade {
  ist_date: string;
  weekday: number;
  side: SbSide;
  mss_at: number;
  swing_ref: number;
  fvg_top: number;
  fvg_bot: number;
  entry: number;
  sl: number;
  tp: number;
  qty: number;
  trigger_at: number | null;
  outcome: "tp" | "sl" | "armed_no_trigger" | "open";
  pnl_usd: number;
  mae_r: number | null;
}

export interface SbDayResult {
  ist_date: string;
  weekday: number;
  skipped: boolean;
  skip_reason: string | null;
  trades: SbTrade[];
}

export interface SbBacktestResult {
  symbol: string;
  days_requested: number;
  from_ms: number;
  to_ms: number;
  bars_scanned: number;
  config: {
    window_start_ist: string;
    window_end_ist: string;
    hold_cutoff_ist: string;
    swing_lookback: number;
    fvg_min_usd: number;
    sl_buffer_usd: number;
    rr: number;
    sl_risk_usd: number;
    max_trades_per_day: number;
    execution_tf: string;
    skip_weekdays: number[];
  };
  days: SbDayResult[];
  equity: { ist_date: string; cum_pnl_usd: number }[];
  summary: {
    total_days: number;
    active_days: number;
    trades: number;
    triggered: number;
    tp: number;
    sl: number;
    open: number;
    armed_no_trigger: number;
    win_rate_pct: number;
    fill_rate_pct: number;
    total_pnl_usd: number;
    profit_factor: number;
    expectancy_usd: number;
    avg_r: number;
    max_drawdown_usd: number;
    max_consec_wins: number;
    max_consec_losses: number;
    mae_wins: DistStats | null;
    mae_losses: DistStats | null;
  };
}

interface DistStats {
  count: number;
  avg: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  max: number;
}

export interface SbOpts {
  symbol: string;
  days: number;
  /** IST window start "HH:MM". Default "19:00". */
  windowStartIst?: string;
  /** IST window end "HH:MM" (no new entries after). Default "21:00". */
  windowEndIst?: string;
  /** IST hard-close all open trades by this time. Default "23:00". */
  holdCutoffIst?: string;
  /** Bars to look back for swing pivots. Default 20. */
  swingLookback?: number;
  /** Minimum FVG size in USD to qualify. Default 0.30. */
  fvgMinUsd?: number;
  /** Extra SL buffer beyond swing extreme in USD. Default 0.20. */
  slBufferUsd?: number;
  /** Reward:risk multiple. Default 3. */
  rr?: number;
  /** $ risk per trade for P&L accounting. */
  slRiskUsd: number;
  /** Max trades per day (once one triggers, no more that day). Default 1. */
  maxTradesPerDay?: number;
  /** Execution timeframe: "5m" (default) or "3m" or "15m". */
  executionTf?: "3m" | "5m" | "15m";
  skipWeekdays?: number[];
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}
function distStats(values: number[]): DistStats | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const avg = values.reduce((s, x) => s + x, 0) / values.length;
  return {
    count: values.length,
    avg,
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
  };
}

/** Basic swing detector: bar i is a swing high if its high is strictly
 * greater than the highs of the k bars on each side. */
function findSwings(bars: Kline[], k: number) {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = k; i < bars.length - k; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= k; j++) {
      if (bars[i - j].high >= bars[i].high || bars[i + j].high >= bars[i].high) isHigh = false;
      if (bars[i - j].low <= bars[i].low || bars[i + j].low <= bars[i].low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }
  return { highs, lows };
}

/** Scan for the freshest 3-bar FVG within [fromIdx, toIdx] matching side.
 * Bullish gap: bars[i-2].high < bars[i].low. Bearish: bars[i-2].low > bars[i].high. */
function findFvg(
  bars: Kline[],
  fromIdx: number,
  toIdx: number,
  side: SbSide,
  minSize: number,
): { top: number; bot: number; at: number } | null {
  for (let i = toIdx; i >= Math.max(fromIdx + 2, 2); i--) {
    if (side === "long") {
      const a = bars[i - 2].high;
      const c = bars[i].low;
      if (c > a && c - a >= minSize) return { top: c, bot: a, at: bars[i - 1].openTime };
    } else {
      const a = bars[i - 2].low;
      const c = bars[i].high;
      if (a > c && a - c >= minSize) return { top: a, bot: c, at: bars[i - 1].openTime };
    }
  }
  return null;
}

export async function runSilverBulletBacktest(opts: SbOpts): Promise<SbBacktestResult> {
  const executionTf = opts.executionTf ?? "5m";
  const client = createSharkClient();
  const now = Date.now();
  const fromMs = now - opts.days * 86_400_000;
  const klines: Kline[] = await client.getKlinesRange(opts.symbol, executionTf, fromMs, now);
  return runSilverBulletCore(klines, opts, fromMs, now);
}

/** Pure core — same logic but takes pre-fetched klines. Used by the optimizer. */
export function runSilverBulletCore(
  klines: Kline[],
  opts: SbOpts,
  fromMs: number,
  toMs: number,
): SbBacktestResult {
  const winStart = parseHhMm(opts.windowStartIst ?? "19:00");
  const winEnd = parseHhMm(opts.windowEndIst ?? "21:00");
  const holdCutoff = parseHhMm(opts.holdCutoffIst ?? "23:00");
  const swingLookback = Math.max(3, opts.swingLookback ?? 20);
  const fvgMinUsd = opts.fvgMinUsd ?? 0.30;
  const slBufferUsd = opts.slBufferUsd ?? 0.20;
  const rr = opts.rr ?? 3;
  const maxTradesPerDay = Math.max(1, opts.maxTradesPerDay ?? 1);
  const executionTf = opts.executionTf ?? "5m";
  const skipWeekdays = new Set(opts.skipWeekdays ?? []);
  const now = toMs;


  // Group by IST date.
  const byDate = new Map<string, Kline[]>();
  for (const k of klines) {
    const d = istDate(k.openTime);
    const arr = byDate.get(d) ?? [];
    arr.push(k);
    byDate.set(d, arr);
  }
  const dates = [...byDate.keys()].sort();

  const days: SbDayResult[] = [];

  for (const dateStr of dates) {
    const bars = (byDate.get(dateStr) ?? []).sort((a, b) => a.openTime - b.openTime);
    const wd = istWeekday(dateStr);
    const day: SbDayResult = {
      ist_date: dateStr,
      weekday: wd,
      skipped: false,
      skip_reason: null,
      trades: [],
    };
    if (skipWeekdays.has(wd)) {
      day.skipped = true;
      day.skip_reason = "weekday";
      days.push(day);
      continue;
    }
    // Bars inside the entry window.
    const winIdxs: number[] = [];
    for (let i = 0; i < bars.length; i++) {
      const m = istMinutes(bars[i].openTime);
      if (m >= winStart && m < winEnd) winIdxs.push(i);
    }
    if (!winIdxs.length) {
      days.push(day);
      continue;
    }

    // Iterate window bars looking for MSS closes.
    let trades = 0;
    let cursor = 0; // scan pointer inside winIdxs
    while (cursor < winIdxs.length && trades < maxTradesPerDay) {
      const i = winIdxs[cursor];
      cursor++;
      const priorBars = bars.slice(Math.max(0, i - swingLookback * 2), i);
      if (priorBars.length < swingLookback) continue;
      const { highs, lows } = findSwings(priorBars, Math.min(3, Math.floor(swingLookback / 4)));
      const lastSwingHighIdx = highs.length ? highs[highs.length - 1] : -1;
      const lastSwingLowIdx = lows.length ? lows[lows.length - 1] : -1;
      const swingHigh = lastSwingHighIdx >= 0 ? priorBars[lastSwingHighIdx].high : null;
      const swingLow = lastSwingLowIdx >= 0 ? priorBars[lastSwingLowIdx].low : null;

      const bar = bars[i];
      let side: SbSide | null = null;
      let swingRef = 0;
      let impulseStartIdx = 0;
      if (swingHigh !== null && bar.close > swingHigh) {
        side = "long";
        swingRef = priorBars[lastSwingLowIdx >= 0 ? lastSwingLowIdx : 0].low;
        impulseStartIdx = Math.max(0, i - swingLookback);
      } else if (swingLow !== null && bar.close < swingLow) {
        side = "short";
        swingRef = priorBars[lastSwingHighIdx >= 0 ? lastSwingHighIdx : 0].high;
        impulseStartIdx = Math.max(0, i - swingLookback);
      }
      if (!side) continue;

      // Find FVG in the impulse leg between impulseStartIdx and i.
      const fvg = findFvg(bars, impulseStartIdx, i, side, fvgMinUsd);
      if (!fvg) continue;

      // Entry at near edge of FVG (retest).
      const entry = side === "long" ? fvg.top : fvg.bot;
      const slRaw = side === "long" ? Math.min(swingRef, fvg.bot) : Math.max(swingRef, fvg.top);
      const sl = side === "long" ? slRaw - slBufferUsd : slRaw + slBufferUsd;
      const risk = Math.abs(entry - sl);
      if (risk <= 0) continue;
      const tp = side === "long" ? entry + risk * rr : entry - risk * rr;
      const qty = opts.slRiskUsd / risk;

      const trade: SbTrade = {
        ist_date: dateStr,
        weekday: wd,
        side,
        mss_at: bar.openTime,
        swing_ref: swingRef,
        fvg_top: fvg.top,
        fvg_bot: fvg.bot,
        entry,
        sl,
        tp,
        qty,
        trigger_at: null,
        outcome: "armed_no_trigger",
        pnl_usd: 0,
        mae_r: null,
      };

      // Walk from i+1 onwards until hold cutoff.
      let triggered = false;
      let mae = 0;
      for (let j = i + 1; j < bars.length; j++) {
        const b = bars[j];
        const bMin = istMinutes(b.openTime);
        // Bars past midnight in IST — istDate handles them; break if new date and past cutoff.
        if (istDate(b.openTime) !== dateStr) break;
        if (bMin >= holdCutoff) break;

        if (!triggered) {
          const hit = side === "long" ? b.low <= entry : b.high >= entry;
          // Only allow arming while still inside entry window OR immediately after.
          if (hit && bMin < winEnd + 30) {
            triggered = true;
            trade.trigger_at = b.openTime;
            trade.outcome = "open";
          } else if (bMin >= winEnd + 30) {
            break;
          } else {
            continue;
          }
        }

        const adverse = side === "long" ? entry - b.low : b.high - entry;
        const adverseR = adverse / risk;
        if (adverseR > mae) mae = adverseR;

        const hitTp = side === "long" ? b.high >= tp : b.low <= tp;
        const hitSl = side === "long" ? b.low <= sl : b.high >= sl;
        if (hitTp && hitSl) {
          trade.outcome = "sl";
          trade.pnl_usd = -opts.slRiskUsd;
          trade.mae_r = mae;
          break;
        }
        if (hitTp) {
          trade.outcome = "tp";
          trade.pnl_usd = opts.slRiskUsd * rr;
          trade.mae_r = mae;
          break;
        }
        if (hitSl) {
          trade.outcome = "sl";
          trade.pnl_usd = -opts.slRiskUsd;
          trade.mae_r = mae;
          break;
        }
      }
      if (trade.outcome === "open") trade.mae_r = mae;

      day.trades.push(trade);
      trades++;
      // Move cursor past this bar; if trade triggered, block re-entry until next window bar past resolution.
      // Simple: continue scanning from the next window bar.
    }

    days.push(day);
  }

  // Aggregate.
  let equity = 0;
  const equityCurve: { ist_date: string; cum_pnl_usd: number }[] = [];
  let tp = 0, sl = 0, open = 0, armed = 0, triggered = 0;
  let grossWins = 0, grossLosses = 0;
  let consecWins = 0, consecLosses = 0, maxConsecWins = 0, maxConsecLosses = 0;
  let peakEquity = 0, maxDrawdown = 0;
  const rMult: number[] = [];
  const maeWins: number[] = [];
  const maeLosses: number[] = [];
  let activeDays = 0;
  let totalTrades = 0;

  for (const d of days) {
    if (d.trades.length) activeDays++;
    for (const t of d.trades) {
      totalTrades++;
      if (t.trigger_at !== null) triggered++;
      if (t.outcome === "tp") {
        tp++;
        grossWins += t.pnl_usd;
        consecWins++;
        consecLosses = 0;
        if (consecWins > maxConsecWins) maxConsecWins = consecWins;
        rMult.push(t.pnl_usd / opts.slRiskUsd);
        if (t.mae_r !== null) maeWins.push(t.mae_r);
      } else if (t.outcome === "sl") {
        sl++;
        grossLosses += Math.abs(t.pnl_usd);
        consecLosses++;
        consecWins = 0;
        if (consecLosses > maxConsecLosses) maxConsecLosses = consecLosses;
        rMult.push(t.pnl_usd / opts.slRiskUsd);
        if (t.mae_r !== null) maeLosses.push(t.mae_r);
      } else if (t.outcome === "open") open++;
      else if (t.outcome === "armed_no_trigger") armed++;

      equity += t.pnl_usd;
    }
    equityCurve.push({ ist_date: d.ist_date, cum_pnl_usd: equity });
    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity - equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const decided = tp + sl;
  const winRate = decided > 0 ? (tp / decided) * 100 : 0;
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
  const expectancy = decided > 0 ? (grossWins - grossLosses) / decided : 0;
  const avgR = rMult.length ? rMult.reduce((s, x) => s + x, 0) / rMult.length : 0;
  const fillRate = totalTrades > 0 ? (triggered / totalTrades) * 100 : 0;

  return {
    symbol: opts.symbol,
    days_requested: opts.days,
    from_ms: fromMs,
    to_ms: now,
    bars_scanned: klines.length,
    config: {
      window_start_ist: opts.windowStartIst ?? "19:00",
      window_end_ist: opts.windowEndIst ?? "21:00",
      hold_cutoff_ist: opts.holdCutoffIst ?? "23:00",
      swing_lookback: swingLookback,
      fvg_min_usd: fvgMinUsd,
      sl_buffer_usd: slBufferUsd,
      rr,
      sl_risk_usd: opts.slRiskUsd,
      max_trades_per_day: maxTradesPerDay,
      execution_tf: executionTf,
      skip_weekdays: opts.skipWeekdays ?? [],
    },
    days,
    equity: equityCurve,
    summary: {
      total_days: days.length,
      active_days: activeDays,
      trades: totalTrades,
      triggered,
      tp,
      sl,
      open,
      armed_no_trigger: armed,
      win_rate_pct: winRate,
      fill_rate_pct: fillRate,
      total_pnl_usd: equity,
      profit_factor: profitFactor,
      expectancy_usd: expectancy,
      avg_r: avgR,
      max_drawdown_usd: maxDrawdown,
      max_consec_wins: maxConsecWins,
      max_consec_losses: maxConsecLosses,
      mae_wins: distStats(maeWins),
      mae_losses: distStats(maeLosses),
    },
  };
}
