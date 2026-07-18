// Asian Liquidity Sweep engine.
// Idea: institutions run stops beyond the Asian session high/low, then reverse.
// Setup: after the Asian window closes, watch London/NY for a bar that wicks
// past the Asian H (or L) but closes back inside — a bearish (or bullish)
// rejection. Enter counter-trend at close (or a % pullback), SL beyond the
// wick extreme + buffer, TP at a chosen R multiple or opposite Asian level.

import { createSharkClient, type Kline } from "@/lib/exchange/shark-client.server";

const IST_OFFSET_MIN = 330;

function istDate(msUtc: number): string {
  return new Date(msUtc + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
function istHour(msUtc: number): number {
  return new Date(msUtc + IST_OFFSET_MIN * 60_000).getUTCHours();
}
function istWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export type SweepSide = "short" | "long";
export type SweepTpMode = "rr" | "opposite" | "midrange";

export interface SweepDayResult {
  ist_date: string;
  weekday: number;
  asia_high: number | null;
  asia_low: number | null;
  asia_range_usd: number | null;
  skipped: boolean;
  skip_reason: string | null;
  side: SweepSide | null;
  sweep_bar_at: number | null;
  sweep_extreme: number | null;
  entry: number | null;
  sl: number | null;
  tp: number | null;
  qty: number | null;
  trigger_at: number | null;
  outcome:
    | "no_asia_range"
    | "no_sweep"
    | "armed_no_trigger"
    | "tp"
    | "sl"
    | "open"
    | "skipped";
  pnl_usd: number;
  mae_r: number | null;
}

export interface SweepBacktestResult {
  symbol: string;
  days_requested: number;
  from_ms: number;
  to_ms: number;
  bars_scanned: number;
  config: {
    asian_start_ist: number;
    asian_end_ist: number;
    entry_end_ist: number;
    min_range_usd: number;
    entry_pullback_pct: number;
    sl_buffer_pct: number;
    rr: number;
    tp_mode: SweepTpMode;
    sl_risk_usd: number;
    require_close_inside: boolean;
    skip_weekdays: number[];
  };
  days: SweepDayResult[];
  equity: { ist_date: string; cum_pnl_usd: number }[];
  summary: {
    total_days: number;
    days_with_range: number;
    skipped_days: number;
    sweeps: number;
    triggered: number;
    tp: number;
    sl: number;
    open: number;
    armed_no_trigger: number;
    win_rate_pct: number;
    total_pnl_usd: number;
    profit_factor: number;
    expectancy_usd: number;
    avg_r: number;
    max_drawdown_usd: number;
    max_consec_wins: number;
    max_consec_losses: number;
    fill_rate_pct: number;
    mae_wins: { count: number; avg: number; p50: number; p75: number; p90: number; p95: number; max: number } | null;
    mae_losses: { count: number; avg: number; p50: number; p75: number; p90: number; p95: number; max: number } | null;
  };
}

export interface SweepOpts {
  symbol: string;
  days: number;
  /** IST hour when Asian window starts (inclusive), default 3 (03:00 IST ≈ Tokyo open). */
  asianStartIst?: number;
  /** IST hour when Asian window ends (exclusive), default 13 (13:00 IST ≈ London pre-open). */
  asianEndIst?: number;
  /** IST hour after which sweeps are ignored (exclusive), default 24 = whole rest of day. */
  entryEndIst?: number;
  /** Minimum Asian range in USD to consider setup. */
  minRangeUsd?: number;
  /** Optional pullback from sweep close before filling entry, as % of Asian range (0 = enter at close). */
  entryPullbackPct?: number;
  /** SL buffer beyond wick extreme, as % of Asian range. Default 0.10 = 10%. */
  slBufferPct?: number;
  /** Reward:risk multiple when tpMode = 'rr'. */
  rr?: number;
  /** How to size TP. */
  tpMode?: SweepTpMode;
  /** $ risk per trade for P&L accounting. */
  slRiskUsd: number;
  /** Require the sweep bar to close back inside the Asian range. Default true. */
  requireCloseInside?: boolean;
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

function distStats(values: number[]) {
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

export async function runSweepBacktest(opts: SweepOpts): Promise<SweepBacktestResult> {
  const client = createSharkClient();
  const now = Date.now();
  const fromMs = now - opts.days * 86_400_000;
  const klines: Kline[] = await client.getKlinesRange(opts.symbol, "1h", fromMs, now);
  return runSweepCore(klines, opts, fromMs, now);
}

/** Pure core — same logic but takes pre-fetched klines. Used by the optimizer. */
export function runSweepCore(
  klines: Kline[],
  opts: SweepOpts,
  fromMs: number,
  toMs: number,
): SweepBacktestResult {
  const asianStart = opts.asianStartIst ?? 3;
  const asianEnd = opts.asianEndIst ?? 13;
  const entryEnd = opts.entryEndIst ?? 24;
  const minRangeUsd = opts.minRangeUsd ?? 0;
  const entryPullbackPct = opts.entryPullbackPct ?? 0;
  const slBufferPct = opts.slBufferPct ?? 0.10;
  const rr = opts.rr ?? 2;
  const tpMode: SweepTpMode = opts.tpMode ?? "rr";
  const requireCloseInside = opts.requireCloseInside ?? true;
  const skipWeekdays = new Set(opts.skipWeekdays ?? []);
  const now = toMs;


  // Group bars by IST date.
  const byDate = new Map<string, Kline[]>();
  for (const k of klines) {
    const d = istDate(k.openTime);
    const arr = byDate.get(d) ?? [];
    arr.push(k);
    byDate.set(d, arr);
  }
  const dates = [...byDate.keys()].sort();

  const days: SweepDayResult[] = [];

  for (const dateStr of dates) {
    const bars = (byDate.get(dateStr) ?? []).sort((a, b) => a.openTime - b.openTime);
    const wd = istWeekday(dateStr);

    // Build a base day record; we mutate as we discover state.
    const day: SweepDayResult = {
      ist_date: dateStr,
      weekday: wd,
      asia_high: null,
      asia_low: null,
      asia_range_usd: null,
      skipped: false,
      skip_reason: null,
      side: null,
      sweep_bar_at: null,
      sweep_extreme: null,
      entry: null,
      sl: null,
      tp: null,
      qty: null,
      trigger_at: null,
      outcome: "no_asia_range",
      pnl_usd: 0,
      mae_r: null,
    };

    if (skipWeekdays.has(wd)) {
      day.skipped = true;
      day.skip_reason = "weekday";
      day.outcome = "skipped";
      days.push(day);
      continue;
    }

    const asiaBars = bars.filter((b) => {
      const h = istHour(b.openTime);
      return h >= asianStart && h < asianEnd;
    });
    if (!asiaBars.length) {
      days.push(day);
      continue;
    }
    const asiaHigh = Math.max(...asiaBars.map((b) => b.high));
    const asiaLow = Math.min(...asiaBars.map((b) => b.low));
    const asiaRange = asiaHigh - asiaLow;
    day.asia_high = asiaHigh;
    day.asia_low = asiaLow;
    day.asia_range_usd = asiaRange;

    if (asiaRange < minRangeUsd) {
      day.skipped = true;
      day.skip_reason = `range<${minRangeUsd}`;
      day.outcome = "skipped";
      days.push(day);
      continue;
    }

    // Post-Asia bars, up to entryEnd IST hour.
    const postBars = bars.filter((b) => {
      const h = istHour(b.openTime);
      return h >= asianEnd && h < entryEnd;
    });
    if (!postBars.length) {
      day.outcome = "no_sweep";
      days.push(day);
      continue;
    }

    // First-sweep-wins. Look for high wick beyond asiaHigh with close inside,
    // or low wick beyond asiaLow with close inside.
    let sweepBar: Kline | null = null;
    let side: SweepSide | null = null;
    let sweepExtreme = 0;
    for (const b of postBars) {
      const brokeHigh = b.high > asiaHigh;
      const brokeLow = b.low < asiaLow;
      const closedInsideFromHigh = requireCloseInside ? b.close < asiaHigh : true;
      const closedInsideFromLow = requireCloseInside ? b.close > asiaLow : true;
      if (brokeHigh && closedInsideFromHigh) {
        sweepBar = b;
        side = "short";
        sweepExtreme = b.high;
        break;
      }
      if (brokeLow && closedInsideFromLow) {
        sweepBar = b;
        side = "long";
        sweepExtreme = b.low;
        break;
      }
    }

    if (!sweepBar || !side) {
      day.outcome = "no_sweep";
      days.push(day);
      continue;
    }

    day.side = side;
    day.sweep_bar_at = sweepBar.closeTime;
    day.sweep_extreme = sweepExtreme;

    // Entry pricing: sweep close ± pullback fraction of range.
    const pullback = asiaRange * entryPullbackPct;
    const entry = side === "short" ? sweepBar.close + pullback : sweepBar.close - pullback;
    const buffer = asiaRange * slBufferPct;
    const sl = side === "short" ? sweepExtreme + buffer : sweepExtreme - buffer;
    const risk = Math.abs(entry - sl);
    if (risk <= 0) {
      day.outcome = "no_sweep";
      days.push(day);
      continue;
    }
    let tp: number;
    if (tpMode === "rr") {
      tp = side === "short" ? entry - risk * rr : entry + risk * rr;
    } else if (tpMode === "opposite") {
      tp = side === "short" ? asiaLow : asiaHigh;
    } else {
      // midrange
      tp = (asiaHigh + asiaLow) / 2;
    }
    // If mid/opposite yields negative R, fall back to RR mode.
    const rewardR = side === "short" ? (entry - tp) / risk : (tp - entry) / risk;
    if (rewardR <= 0) {
      tp = side === "short" ? entry - risk * rr : entry + risk * rr;
    }

    const qty = opts.slRiskUsd / risk;
    day.entry = entry;
    day.sl = sl;
    day.tp = tp;
    day.qty = qty;

    // Walk bars after the sweep. Entry may be pending if pullback > 0.
    const walk = postBars.filter((b) => b.openTime > sweepBar.openTime);
    let triggered = entryPullbackPct <= 0; // enter at sweep close
    if (triggered) day.trigger_at = sweepBar.closeTime;
    let mae = 0;
    let resolved = false;
    for (const b of walk) {
      if (!triggered) {
        const hit = side === "short" ? b.high >= entry : b.low <= entry;
        if (hit) {
          triggered = true;
          day.trigger_at = b.openTime;
        } else {
          continue;
        }
      }
      // Track MAE in R units.
      const adverse = side === "short" ? b.high - entry : entry - b.low;
      const adverseR = adverse / risk;
      if (adverseR > mae) mae = adverseR;

      const hitTp = side === "short" ? b.low <= tp : b.high >= tp;
      const hitSl = side === "short" ? b.high >= sl : b.low <= sl;
      if (hitTp && hitSl) {
        // Conservative: assume SL first when both hit in same bar.
        day.outcome = "sl";
        day.pnl_usd = -opts.slRiskUsd;
        day.mae_r = mae;
        resolved = true;
        break;
      }
      if (hitTp) {
        day.outcome = "tp";
        const rewardMult = Math.abs(tp - entry) / risk;
        day.pnl_usd = opts.slRiskUsd * rewardMult;
        day.mae_r = mae;
        resolved = true;
        break;
      }
      if (hitSl) {
        day.outcome = "sl";
        day.pnl_usd = -opts.slRiskUsd;
        day.mae_r = mae;
        resolved = true;
        break;
      }
    }
    if (!resolved) {
      if (!triggered) {
        day.outcome = "armed_no_trigger";
      } else {
        day.outcome = "open";
        day.mae_r = mae;
      }
    }

    days.push(day);
  }

  // Aggregate.
  let equity = 0;
  const equityCurve: { ist_date: string; cum_pnl_usd: number }[] = [];
  let tp = 0,
    sl = 0,
    open = 0,
    armed = 0,
    sweeps = 0,
    triggered = 0,
    skipped = 0,
    daysWithRange = 0;
  let grossWins = 0,
    grossLosses = 0;
  let consecWins = 0,
    consecLosses = 0,
    maxConsecWins = 0,
    maxConsecLosses = 0;
  let peakEquity = 0,
    maxDrawdown = 0;
  const rMult: number[] = [];
  const maeWins: number[] = [];
  const maeLosses: number[] = [];

  for (const d of days) {
    if (d.asia_range_usd !== null) daysWithRange++;
    if (d.skipped) skipped++;
    if (d.side) sweeps++;
    if (d.trigger_at !== null) triggered++;
    if (d.outcome === "tp") {
      tp++;
      grossWins += d.pnl_usd;
      consecWins++;
      consecLosses = 0;
      if (consecWins > maxConsecWins) maxConsecWins = consecWins;
      rMult.push(d.pnl_usd / opts.slRiskUsd);
      if (d.mae_r !== null) maeWins.push(d.mae_r);
    } else if (d.outcome === "sl") {
      sl++;
      grossLosses += Math.abs(d.pnl_usd);
      consecLosses++;
      consecWins = 0;
      if (consecLosses > maxConsecLosses) maxConsecLosses = consecLosses;
      rMult.push(d.pnl_usd / opts.slRiskUsd);
      if (d.mae_r !== null) maeLosses.push(d.mae_r);
    } else if (d.outcome === "open") open++;
    else if (d.outcome === "armed_no_trigger") armed++;

    equity += d.pnl_usd;
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
  const fillRate = sweeps > 0 ? (triggered / sweeps) * 100 : 0;

  return {
    symbol: opts.symbol,
    days_requested: opts.days,
    from_ms: fromMs,
    to_ms: now,
    bars_scanned: klines.length,
    config: {
      asian_start_ist: asianStart,
      asian_end_ist: asianEnd,
      entry_end_ist: entryEnd,
      min_range_usd: minRangeUsd,
      entry_pullback_pct: entryPullbackPct,
      sl_buffer_pct: slBufferPct,
      rr,
      tp_mode: tpMode,
      sl_risk_usd: opts.slRiskUsd,
      require_close_inside: requireCloseInside,
      skip_weekdays: opts.skipWeekdays ?? [],
    },
    days,
    equity: equityCurve,
    summary: {
      total_days: days.length,
      days_with_range: daysWithRange,
      skipped_days: skipped,
      sweeps,
      triggered,
      tp,
      sl,
      open,
      armed_no_trigger: armed,
      win_rate_pct: winRate,
      total_pnl_usd: equity,
      profit_factor: profitFactor,
      expectancy_usd: expectancy,
      avg_r: avgR,
      max_drawdown_usd: maxDrawdown,
      max_consec_wins: maxConsecWins,
      max_consec_losses: maxConsecLosses,
      fill_rate_pct: fillRate,
      mae_wins: distStats(maeWins),
      mae_losses: distStats(maeLosses),
    },
  };
}
