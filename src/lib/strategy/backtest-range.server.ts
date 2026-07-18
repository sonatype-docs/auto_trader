import { type Kline } from "@/lib/exchange/shark-client.server";
import { getKlineSource, type KlineSourceId } from "@/lib/exchange/kline-source.server";
import type { FilterConfig } from "@/lib/strategy/filters";

import { computeDailyBias, type DailyBiasEntry } from "@/lib/strategy/filter-bias.server";
import {
  computeEntry,
  DEFAULT_ENTRY_CONFIG,
  type EntryConfig,
} from "@/lib/strategy/entry-modes.server";
import { scoreCandidate, GRADE_ORDER, GRADE_RISK_USD, type GradeLabel } from "@/lib/research/grading";


const IST_OFFSET_MIN = 330;

function istDate(msUtc: number): string {
  return new Date(msUtc + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
function sessionOpenUtcMs(istDateStr: string, sessionStartIst: string): number {
  const [hh, mm] = sessionStartIst.split(":").map((n) => parseInt(n, 10));
  const totalMin = hh * 60 + (mm || 0) - IST_OFFSET_MIN;
  const [y, m, d] = istDateStr.split("-").map((n) => parseInt(n, 10));
  const openMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + totalMin * 60_000;
  return Math.floor(openMs / 3_600_000) * 3_600_000;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
function istWeekday(dateStr: string): Weekday {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday;
}

export type TpTarget = "swing" | "opposite" | "both" | "neither";
export type Tercile = "low" | "mid" | "high";
export type OrBucket = "small" | "medium" | "large";
export type DistBucket = "near" | "mid" | "far";

export interface DayResult {
  ist_date: string;
  weekday: Weekday;
  weekday_label: string;
  skipped: boolean;
  session_open: number | null;
  zone_high: number | null;
  zone_low: number | null;
  fib_25: number | null;
  fib_75: number | null;
  break_side: "long" | "short" | null;
  break_at: number | null;
  break_close: number | null;
  entry: number | null;
  sl: number | null;
  tp: number | null;
  qty: number | null;
  trigger_at: number | null;
  outcome:
    | "no_session"
    | "no_break"
    | "armed_no_trigger"
    | "tp"
    | "sl"
    | "open"
    | "skipped"
    | "filtered";
  filter_reason: string | null;
  pnl_usd: number;
  final_sl: number | null;
  peak_r: number;
  exit_r: number | null;
  /** Maximum Adverse Excursion in R units for a triggered trade — how far price ran against you (0 = never in the red). Null when not triggered. */
  mae_r: number | null;
  /** For armed_no_trigger days: how close price got to the entry, in R units (0 = filled, higher = further). Null when not applicable. */
  closest_approach_r: number | null;
  entry_mode?: EntryConfig["mode"];
  // Cohort inputs (populated when a break is found).
  body_pct: number | null;
  or_size_usd: number | null;
  break_distance_usd: number | null;
  swing_ref: number | null;
  opposite_ref: number | null;
  tp_target: TpTarget | null;
  // Bucket assignments (populated after tertile computation).
  body_bucket: Tercile | null;
  or_bucket: OrBucket | null;
  break_distance_bucket: DistBucket | null;
  // ---- Phase 1 research features (always populated when data is available) ----
  /** Daily ATR(14) known at start of this IST day. */
  daily_atr: number | null;
  /** EMA20 of daily closes known at start of day. */
  ema20: number | null;
  ema50: number | null;
  ema100: number | null;
  ema200: number | null;
  /** Wilder ADX(14). */
  adx14: number | null;
  /** Prior IST-day OHLC. */
  prev_open: number | null;
  prev_close: number | null;
  prev_high: number | null;
  prev_low: number | null;
  prev2_high: number | null;
  prev2_low: number | null;
  /** Breakout-candle geometry. */
  upper_wick_pct: number | null;
  lower_wick_pct: number | null;
  close_position_pct: number | null;
  candle_range_usd: number | null;
  // ---- Phase 2 trade-quality features ----
  /** Bars from break close to trigger (0 for market). Null when never triggered. */
  time_to_fill_bars: number | null;
  time_to_fill_hours: number | null;
  /** Bars from trigger to resolution (tp/sl); null if still open or missed. */
  duration_bars: number | null;
  /** Maximum favourable excursion in R (same as peak_r; kept as an explicit feature). */
  mfe_r: number | null;
  mfe_usd: number | null;
  mae_usd: number | null;
  /** Number of times price re-touched the entry line after trigger. */
  retest_count: number | null;
  // ---- Phase 3 timing features ----
  /** Hour of break in IST (0-23). */
  break_hour_ist: number | null;
  month: number | null;
  quarter: number | null;
  // ---- Phase 5 structure flags ----
  /** True when a 3-candle FVG exists on the break candle (candle[-2] vs breakBar). */
  fvg_present: boolean | null;
  /** True when the break candle swept a recent swing (broke prior high/low, then closed back). */
  sweep_present: boolean | null;
  // ---- AI grading (populated when a grading model is supplied) ----
  ai_grade?: string | null;
  ai_score?: number | null;
  ai_risk_usd?: number | null;
}


export interface WeekdayStat {
  weekday: Weekday;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  total_pnl_usd: number;
  avg_pnl_usd: number;
}

export interface CohortStat {
  bucket: string;
  trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  total_pnl_usd: number;
  avg_pnl_usd: number;
  avg_r: number;
}

export interface CohortDim {
  buckets: CohortStat[];
  /** Tertile edges [t1, t2] where bucket = low if x<=t1, mid if x<=t2, high otherwise. */
  edges: [number, number] | null;
}


export interface RangeBacktestResult {
  symbol: string;
  session_start_ist: string;
  sl_risk_usd: number;
  rr: number;
  days_requested: number;
  from_ms: number;
  to_ms: number;
  bars_scanned: number;
  trail: { enabled: boolean; activate_r: number; step_r: number };
  skip_weekdays: Weekday[];
  days: DayResult[];
  weekdays: WeekdayStat[];
  equity: { ist_date: string; cum_pnl_usd: number }[];
  summary: {
    total_days: number;
    days_with_session: number;
    skipped_days: number;
    filtered_days: number;
    breaks: number;
    triggered: number;
    tp: number;
    sl: number;
    open: number;
    armed_no_trigger: number;
    win_rate_pct: number;
    total_pnl_usd: number;
    avg_r: number;
    best_pnl_usd: number;
    worst_pnl_usd: number;
    best_weekday: { label: string; total_pnl_usd: number } | null;
    worst_weekday: { label: string; total_pnl_usd: number } | null;
    profit_factor: number;   // gross wins / gross losses
    expectancy_usd: number;  // avg $ per decided trade
    avg_win_usd: number;
    avg_loss_usd: number;
    max_drawdown_usd: number;
    max_consec_wins: number;
    max_consec_losses: number;
    /** triggered / (triggered + armed_no_trigger) as a %. */
    fill_rate_pct: number;
    /** Median R distance price got from entry on missed days (lower = would-fill with slightly deeper entry). */
    median_miss_r: number;
    /** How many missed setups would have filled if entry_depth was reduced (closest_approach_r <= 0.1). */
    near_miss_count: number;
    /** Fee model: est. total fees paid (USD) at the given per-side taker rate. */
    est_fees_usd: number;
    /** Net P&L after fees. */
    net_pnl_usd: number;
    cohorts: {
      body: CohortDim;
      or_size: CohortDim;
      break_distance: CohortDim;
      weekday: CohortDim;
      tp_target: CohortDim;
    };
    /** MAE distribution across winning (TP) trades in R units. Null when no wins. */
    mae_wins: {
      count: number;
      avg: number;
      p50: number;
      p75: number;
      p90: number;
      p95: number;
      max: number;
    } | null;
    /** MAE distribution across losing (SL) trades in R units. Null when no losses. */
    mae_losses: {
      count: number;
      avg: number;
      p50: number;
      p75: number;
      p90: number;
      p95: number;
      max: number;
    } | null;
  };
  filters?: FilterConfig;
  entry?: EntryConfig;
}



export async function runBacktestRange(opts: {
  symbol: string;
  sessionStartIst: string;
  slRiskUsd: number;
  rr: number;
  days: number;
  trailEnabled?: boolean;
  trailActivateR?: number;
  trailStepR?: number;
  skipWeekdays?: Weekday[]; // e.g. [0, 6] to skip Sun & Sat
  filters?: FilterConfig;
  entry?: EntryConfig;
  /** Per-side taker fee rate as a fraction of notional (e.g. 0.0004 = 0.04%). Default 0.0004. */
  feeRate?: number;
  /** Flat USD fee per order (applied to entry and exit separately — total = 2× this per triggered trade). */
  feeUsdPerOrder?: number;
  /** "range" = fib zone from opening range candle (default). "breakout" = fib zone from the breakout candle itself. */
  zoneSource?: "range" | "breakout";
  /** Historical candle source. "shark" (default, ~180d) or "yahoo" (GC=F, ~730d, no key). */
  dataSource?: KlineSourceId;
  /** Optional AI grading model — when provided, each candidate is graded and
   *  the day's SL$ is set from gradeRiskMap[grade] (default GRADE_RISK_USD). */
  gradingModel?: unknown;
  gradeRiskMap?: Record<string, number>;
  minGrade?: string;
}): Promise<RangeBacktestResult> {

  const source = await getKlineSource(opts.dataSource ?? "shark");
  const now = Date.now();
  const fromMs = now - opts.days * 86_400_000;
  const klines: Kline[] = await source.getKlinesRange(opts.symbol, "1h", fromMs, now);

  // Always fetch daily bias — Phase 1 research features (ATR, EMA20/50/100/200,
  // ADX14, prev-day OHL) live on every DayResult so the research panel works
  // regardless of whether pre-trade filters are enabled.
  let dailyBias: Map<string, DailyBiasEntry> | undefined;
  {
    const emaLen = opts.filters?.htf?.daily_ema_len ?? 20;
    const atrLen = opts.filters?.quality?.atr_len ?? 14;
    const emaFastLen = opts.filters?.htf?.ema_bias_fast ?? 21;
    const emaSlowLen = opts.filters?.htf?.ema_bias_slow ?? 50;
    const atrSqueezeLookback = opts.filters?.quality?.atr_squeeze_lookback ?? 20;
    // Warm-up needs enough history for EMA200 + ADX(14) to stabilise too.
    const warmupDays = Math.max(200, emaLen, atrLen, emaFastLen, emaSlowLen, atrSqueezeLookback) + 20;
    const dailyFromMs = fromMs - warmupDays * 86_400_000;
    try {
      const daily = await source.getKlinesRange(opts.symbol, "1d", dailyFromMs, now);
      dailyBias = computeDailyBias(daily, {
        emaLen,
        atrLen,
        emaFastLen,
        emaSlowLen,
        atrSqueezeLookback,
      });
    } catch {
      // Some sources may not have daily bars for the full warm-up window — fall
      // back to no bias rather than failing the whole backtest.
      dailyBias = undefined;
    }
  }

  return simulateFromKlines(klines, { ...opts, fromMs, nowMs: now, dailyBias });
}


export function simulateFromKlines(
  klines: Kline[],
  opts: {
    symbol: string;
    sessionStartIst: string;
    slRiskUsd: number;
    rr: number;
    days: number;
    fromMs: number;
    nowMs: number;
    trailEnabled?: boolean;
    trailActivateR?: number;
    trailStepR?: number;
    skipWeekdays?: Weekday[];
    filters?: FilterConfig;
    dailyBias?: Map<string, DailyBiasEntry>;
    entry?: EntryConfig;
    feeRate?: number;
    feeUsdPerOrder?: number;
    zoneSource?: "range" | "breakout";
    /** Optional AI grading model — when provided together with gradeRiskMap,
     *  each day's SL$ risk is set to gradeRiskMap[grade] (absolute USD).
     *  Rows graded below minGrade are marked filtered. */
    gradingModel?: unknown;
    gradeRiskMap?: Record<string, number>;
    minGrade?: string;
  },
): RangeBacktestResult {
  const trailEnabled = !!opts.trailEnabled;
  const trailActivateR = Math.max(0.1, opts.trailActivateR ?? 2);
  const trailStepR = Math.max(0.1, opts.trailStepR ?? 1);
  const skipSet = new Set<Weekday>(opts.skipWeekdays ?? []);
  const now = opts.nowMs;
  const fromMs = opts.fromMs;
  const filters = opts.filters?.enabled ? opts.filters : undefined;
  const htf = filters?.htf;
  const quality = filters?.quality;
  const entryCfg = opts.entry ?? DEFAULT_ENTRY_CONFIG;
  const feeRate = opts.feeRate ?? 0; // fees disabled — exchange rebates cover them once profitable
  const feeUsdPerOrder = Math.max(0, opts.feeUsdPerOrder ?? 0);



  // Restrict to the requested window (allows callers to pass a superset).
  const filtered = klines.filter((k) => k.openTime >= fromMs && k.closeTime <= now);

  // Bucket by IST date for fast session lookup.
  const byOpen = new Map<number, Kline>();
  for (const k of filtered) byOpen.set(k.openTime, k);

  // Collect the unique IST dates present in the range.
  const dates = new Set<string>();
  for (const k of filtered) dates.add(istDate(k.openTime));
  const sortedDates = [...dates].sort();

  // Precompute per-IST-date high/low from ALL 1H bars in the fetched window.
  // Used to derive prior-day extremes for the TP-target cohort without extra API calls.
  const dayExtremes = new Map<string, { high: number; low: number }>();
  for (const k of klines) {
    const d = istDate(k.openTime);
    const cur = dayExtremes.get(d);
    if (!cur) dayExtremes.set(d, { high: k.high, low: k.low });
    else {
      if (k.high > cur.high) cur.high = k.high;
      if (k.low < cur.low) cur.low = k.low;
    }
  }
  const prevDayHL = (dateStr: string): { high: number; low: number } | null => {
    const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
    const prev = new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10);
    return dayExtremes.get(prev) ?? null;
  };


  const days: DayResult[] = [];

  for (const dateStr of sortedDates) {
    const sessionOpen = sessionOpenUtcMs(dateStr, opts.sessionStartIst);
    const sessionCandle = byOpen.get(sessionOpen);
    const weekday = istWeekday(dateStr);
    const skipped = skipSet.has(weekday);
    const dr: DayResult = {
      ist_date: dateStr,
      weekday,
      weekday_label: WEEKDAY_LABELS[weekday],
      skipped,
      session_open: sessionCandle?.openTime ?? null,
      zone_high: null,
      zone_low: null,
      fib_25: null,
      fib_75: null,
      break_side: null,
      break_at: null,
      break_close: null,
      entry: null,
      sl: null,
      tp: null,
      qty: null,
      trigger_at: null,
      outcome: skipped ? "skipped" : "no_session",
      filter_reason: null,
      pnl_usd: 0,
      final_sl: null,
      peak_r: 0,
      exit_r: null,
      mae_r: null,
      closest_approach_r: null,
      body_pct: null,
      or_size_usd: null,
      break_distance_usd: null,
      swing_ref: null,
      opposite_ref: null,
      tp_target: null,
      body_bucket: null,
      or_bucket: null,
      break_distance_bucket: null,
      daily_atr: null,
      ema20: null,
      ema50: null,
      ema100: null,
      ema200: null,
      adx14: null,
      prev_open: null,
      prev_close: null,
      prev_high: null,
      prev_low: null,
      prev2_high: null,
      prev2_low: null,
      upper_wick_pct: null,
      lower_wick_pct: null,
      close_position_pct: null,
      candle_range_usd: null,
      time_to_fill_bars: null,
      time_to_fill_hours: null,
      duration_bars: null,
      mfe_r: null,
      mfe_usd: null,
      mae_usd: null,
      retest_count: null,
      break_hour_ist: null,
      month: null,
      quarter: null,
      fvg_present: null,
      sweep_present: null,
    };


    if (skipped) {
      days.push(dr);
      continue;
    }

    if (!sessionCandle || sessionCandle.closeTime > now) {
      days.push(dr);
      continue;
    }

    const zone_high = sessionCandle.high;
    const zone_low = sessionCandle.low;
    const range = zone_high - zone_low;
    const fib_25 = zone_high - range * 0.25; // near high
    const fib_75 = zone_high - range * 0.75; // near low
    dr.zone_high = zone_high;
    dr.zone_low = zone_low;
    dr.fib_25 = fib_25;
    dr.fib_75 = fib_75;

    // ---- Setup quality: zone size + ATR regime (evaluated before break search) ----
    if (quality?.zone_size_enabled) {
      const unit = quality.zone_size_unit ?? "usd";
      const val = unit === "pct" ? (range / sessionCandle.open) * 100 : range;
      const min = quality.zone_size_min ?? 0;
      const max = quality.zone_size_max ?? 0;
      if (min > 0 && val < min) {
        dr.outcome = "filtered";
        dr.filter_reason = `zone < ${min}${unit === "pct" ? "%" : "$"}`;
        days.push(dr);
        continue;
      }
      if (max > 0 && val > max) {
        dr.outcome = "filtered";
        dr.filter_reason = `zone > ${max}${unit === "pct" ? "%" : "$"}`;
        days.push(dr);
        continue;
      }
    }

    const biasEntry = opts.dailyBias?.get(dateStr);
    // Research features — always attach whatever daily bias is available.
    if (biasEntry) {
      dr.daily_atr = biasEntry.atr;
      dr.ema20 = biasEntry.ema20;
      dr.ema50 = biasEntry.ema50;
      dr.ema100 = biasEntry.ema100;
      dr.ema200 = biasEntry.ema200;
      dr.adx14 = biasEntry.adx14;
      dr.prev_open = biasEntry.prev_open;
      dr.prev_close = biasEntry.prev_close;
      dr.prev_high = biasEntry.prev_high;
      dr.prev_low = biasEntry.prev_low;
      dr.prev2_high = biasEntry.prev2_high;
      dr.prev2_low = biasEntry.prev2_low;
    }
    if (quality?.atr_enabled) {
      const atr = biasEntry?.atr ?? null;
      const min = quality.atr_min ?? 0;
      const max = quality.atr_max ?? 0;
      if (atr === null) {
        dr.outcome = "filtered";
        dr.filter_reason = "atr unavailable";
        days.push(dr);
        continue;
      }
      if (min > 0 && atr < min) {
        dr.outcome = "filtered";
        dr.filter_reason = `atr < ${min}`;
        days.push(dr);
        continue;
      }
      if (max > 0 && atr > max) {
        dr.outcome = "filtered";
        dr.filter_reason = `atr > ${max}`;
        days.push(dr);
        continue;
      }
    }

    // ATR squeeze — reject if today's ATR is not compressed enough vs the lookback average.
    if (quality?.atr_squeeze_enabled) {
      const atrNow = biasEntry?.atr ?? null;
      const atrAvg = biasEntry?.atr_lookback_avg ?? null;
      const ratio = quality.atr_squeeze_ratio ?? 0.7;
      if (atrNow === null || atrAvg === null || atrAvg <= 0) {
        dr.outcome = "filtered";
        dr.filter_reason = "atr squeeze unavailable";
        days.push(dr);
        continue;
      }
      const actual = atrNow / atrAvg;
      if (actual > ratio) {
        dr.outcome = "filtered";
        dr.filter_reason = `atr ratio ${actual.toFixed(2)} > ${ratio.toFixed(2)}`;
        days.push(dr);
        continue;
      }
    }


    // Precompute HTF bias-allowed side for this day so we can reject on break.
    let allowedSide: "long" | "short" | "both" | "none" = "both";
    if (htf) {
      const price = sessionCandle.open;
      const votes: ("long" | "short")[] = [];
      const vote = (ref: number | null | undefined) => {
        if (ref === null || ref === undefined) return;
        if (price > ref) votes.push("long");
        else if (price < ref) votes.push("short");
      };
      if (htf.daily_ema_enabled) vote(biasEntry?.ema ?? null);
      if (htf.prev_day_close_enabled) vote(biasEntry?.prev_close ?? null);
      if (htf.weekly_open_enabled) vote(biasEntry?.week_open ?? null);
      if (htf.ema_bias_enabled) {
        const mode = htf.ema_bias_mode ?? "gate_by_slow";
        if (mode === "gate_by_slow") {
          vote(biasEntry?.ema_slow ?? null);
        } else {
          // gate_by_cross — fast vs slow determines the allowed direction.
          const f = biasEntry?.ema_fast ?? null;
          const s = biasEntry?.ema_slow ?? null;
          if (f !== null && s !== null) {
            if (f > s) votes.push("long");
            else if (f < s) votes.push("short");
          }
        }
      }

      if (votes.length > 0) {
        const unique = new Set(votes);
        allowedSide = unique.size === 1 ? votes[0] : "none";
      }
    }


    // Look at bars strictly after the session candle, within THIS IST date only.
    const laterSameDay = filtered.filter(
      (k) =>
        k.openTime > sessionCandle.openTime &&
        k.closeTime <= now &&
        istDate(k.openTime) === dateStr,
    );

    // First 1H close outside the zone wins.
    let breakBar: Kline | null = null;
    let breakSide: "long" | "short" | null = null;
    for (const k of laterSameDay) {
      if (k.close > zone_high) { breakBar = k; breakSide = "long"; break; }
      if (k.close < zone_low)  { breakBar = k; breakSide = "short"; break; }
    }
    if (!breakBar || !breakSide) {
      dr.outcome = "no_break";
      days.push(dr);
      continue;
    }
    dr.break_side = breakSide;
    dr.break_at = breakBar.closeTime;
    dr.break_close = breakBar.close;
    // Phase 3 timing tags
    {
      const istMs = breakBar.openTime + IST_OFFSET_MIN * 60_000;
      const d = new Date(istMs);
      dr.break_hour_ist = d.getUTCHours();
      const [yy, mm] = dateStr.split("-").map((n) => parseInt(n, 10));
      dr.month = mm;
      dr.quarter = Math.floor((mm - 1) / 3) + 1;
      void yy;
    }
    // Phase 5 structure flags — computed from local kline neighbourhood.
    const oneHourMs = 3_600_000;
    const preBar = byOpen.get(breakBar.openTime - oneHourMs) ?? null;
    const pre2Bar = byOpen.get(breakBar.openTime - 2 * oneHourMs) ?? null;
    if (pre2Bar && preBar) {
      // 3-candle FVG: gap between candle[-2] and breakBar in the trend direction.
      const gapUp = breakBar.low > pre2Bar.high;
      const gapDn = breakBar.high < pre2Bar.low;
      dr.fvg_present = breakSide === "long" ? gapUp : gapDn;
    } else {
      dr.fvg_present = false;
    }
    if (preBar) {
      // Liquidity sweep: break candle wick pierces prior swing then closes back inside.
      const sweptLong = breakSide === "long" && breakBar.high > preBar.high && breakBar.close < preBar.high * 1.001;
      const sweptShort = breakSide === "short" && breakBar.low < preBar.low && breakBar.close > preBar.low * 0.999;
      dr.sweep_present = sweptLong || sweptShort;
    } else {
      dr.sweep_present = false;
    }

    // Cohort inputs (always recorded when a break is found).
    const barRange0 = breakBar.high - breakBar.low;
    const body0 = Math.abs(breakBar.close - breakBar.open);
    dr.body_pct = barRange0 > 0 ? (body0 / barRange0) * 100 : 0;
    // Phase 1 candle-quality features.
    dr.candle_range_usd = barRange0;
    if (barRange0 > 0) {
      const upperWick = breakBar.high - Math.max(breakBar.open, breakBar.close);
      const lowerWick = Math.min(breakBar.open, breakBar.close) - breakBar.low;
      dr.upper_wick_pct = (upperWick / barRange0) * 100;
      dr.lower_wick_pct = (lowerWick / barRange0) * 100;
      dr.close_position_pct = ((breakBar.close - breakBar.low) / barRange0) * 100;
    }
    dr.or_size_usd = range;
    dr.break_distance_usd =
      breakSide === "long" ? breakBar.close - zone_high : zone_low - breakBar.close;
    const prevHL = prevDayHL(dateStr);
    if (breakSide === "long") {
      dr.swing_ref = prevHL ? Math.max(zone_high, prevHL.high) : zone_high;
      dr.opposite_ref = prevHL ? Math.min(zone_low, prevHL.low) : zone_low;
    } else {
      dr.swing_ref = prevHL ? Math.min(zone_low, prevHL.low) : zone_low;
      dr.opposite_ref = prevHL ? Math.max(zone_high, prevHL.high) : zone_high;
    }

    // ---- Break-time filters (HTF bias side match + break quality) ----
    if (allowedSide === "none" || (allowedSide !== "both" && allowedSide !== breakSide)) {
      dr.outcome = "filtered";
      dr.filter_reason =
        allowedSide === "none" ? "htf bias conflict" : `htf bias = ${allowedSide}`;
      days.push(dr);
      continue;
    }

    if (quality?.break_strength_enabled) {
      const beyond =
        breakSide === "long" ? breakBar.close - zone_high : zone_low - breakBar.close;
      const pct = range > 0 ? (beyond / range) * 100 : 0;
      const need = quality.break_strength_pct ?? 0;
      if (pct < need) {
        dr.outcome = "filtered";
        dr.filter_reason = `break strength ${pct.toFixed(1)}% < ${need}%`;
        days.push(dr);
        continue;
      }
    }

    if (quality?.break_body_enabled) {
      const barRange = breakBar.high - breakBar.low;
      const body = Math.abs(breakBar.close - breakBar.open);
      const pct = barRange > 0 ? (body / barRange) * 100 : 0;
      const need = quality.break_body_pct ?? 0;
      if (pct < need) {
        dr.outcome = "filtered";
        dr.filter_reason = `body ${pct.toFixed(0)}% < ${need}%`;
        days.push(dr);
        continue;
      }
    }

    if (quality?.break_timing_enabled) {
      const need = quality.break_timing_hours ?? 0;
      if (need > 0) {
        const hoursAfter = (breakBar.openTime - sessionCandle.closeTime) / 3_600_000;
        if (hoursAfter > need) {
          dr.outcome = "filtered";
          dr.filter_reason = `break +${hoursAfter.toFixed(1)}h > ${need}h`;
          days.push(dr);
          continue;
        }
      }
    }


    // Zone source: default uses the opening-range candle; "breakout" swaps to
    // the breakout candle's high/low as the fib zone marker.
    let entryZoneHigh = zone_high;
    let entryZoneLow = zone_low;
    if ((opts.zoneSource ?? "range") === "breakout") {
      entryZoneHigh = breakBar.high;
      entryZoneLow = breakBar.low;
      const rng = entryZoneHigh - entryZoneLow;
      dr.zone_high = entryZoneHigh;
      dr.zone_low = entryZoneLow;
      dr.fib_25 = entryZoneHigh - rng * 0.25;
      dr.fib_75 = entryZoneHigh - rng * 0.75;
    }
    const { entry, sl, market } = computeEntry(breakSide, entryZoneHigh, entryZoneLow, breakBar.close, entryCfg);
    const risk  = Math.abs(entry - sl);
    const tp    = breakSide === "long" ? entry + risk * opts.rr : entry - risk * opts.rr;

    // Effective per-day SL$ risk. Defaults to opts.slRiskUsd. When an AI
    // grading model is supplied, we grade the candidate and scale the base
    // SL$ by opts.gradeRiskMap[grade] (interpreted as a MULTIPLIER of
    // opts.slRiskUsd, not an absolute dollar amount).
    let daySlRisk = opts.slRiskUsd;
    if (opts.gradingModel) {
      const orRangeUsd = zone_high - zone_low;
      const bcRange = breakBar.high - breakBar.low;
      const bcBody = Math.abs(breakBar.close - breakBar.open);
      const breakDistanceUsd = breakSide === "long" ? breakBar.close - zone_high : zone_low - breakBar.close;
      const breakHourIst = new Date(breakBar.openTime + IST_OFFSET_MIN * 60_000).getUTCHours();
      const istD = new Date(`${dateStr}T00:00:00Z`);
      const candidate = {
        side: breakSide,
        or_size_usd: orRangeUsd,
        break_distance_usd: breakDistanceUsd,
        break_distance_pct_or: orRangeUsd > 0 ? (breakDistanceUsd / orRangeUsd) * 100 : null,
        body_pct: bcRange > 0 ? (bcBody / bcRange) * 100 : null,
        upper_wick_pct: bcRange > 0 ? ((breakBar.high - Math.max(breakBar.open, breakBar.close)) / bcRange) * 100 : null,
        lower_wick_pct: bcRange > 0 ? ((Math.min(breakBar.open, breakBar.close) - breakBar.low) / bcRange) * 100 : null,
        break_hour_ist: breakHourIst,
        weekday: istD.getUTCDay(),
        month: istD.getUTCMonth() + 1,
        quarter: Math.floor(istD.getUTCMonth() / 3) + 1,
      };
      try {
        const graded = scoreCandidate(candidate as never, opts.gradingModel as Parameters<typeof scoreCandidate>[1]);
        const map = opts.gradeRiskMap;
        // Values are multipliers of opts.slRiskUsd. Missing grade → 1x.
        const mult = map && Number.isFinite(Number(map[graded.grade]))
          ? Number(map[graded.grade])
          : 1;
        const gradeRisk = opts.slRiskUsd * mult;
        const minGrade = opts.minGrade ?? "B";
        const gradeRank = (GRADE_ORDER as readonly string[]).indexOf(graded.grade);
        const minRank = (GRADE_ORDER as readonly string[]).indexOf(minGrade);
        if (gradeRank > minRank || gradeRisk <= 0) {
          dr.outcome = "filtered";
          dr.filter_reason = `ai grade ${graded.grade} < ${minGrade}`;
          days.push(dr);
          continue;
        }
        daySlRisk = gradeRisk;
        dr.ai_grade = graded.grade;
        dr.ai_score = graded.score;
        dr.ai_risk_usd = gradeRisk;
      } catch {
        // fall back to base risk on any grading error
      }
    }

    const qty   = risk > 0 ? daySlRisk / risk : 0;
    dr.entry = entry;
    dr.sl = sl;
    dr.tp = tp;
    dr.qty = qty;
    dr.entry_mode = entryCfg.mode;

    const post = laterSameDay.filter((k) => k.openTime > breakBar.openTime);
    let triggered = market;
    let resolved = false;
    let dynSl = sl;
    let peakR = 0;
    // Track how close price got to the entry for missed setups.
    let closestDist = Infinity;
    // MAE tracking (after trigger): worst adverse extreme in R units.
    let adverseExtreme: number | null = null;
    // Track whether price reached the swing-side / opposite-side references after trigger.
    let reachedSwing = false;
    let reachedOpposite = false;
    if (market) {
      dr.trigger_at = breakBar.closeTime;
      // Market entries: also let the break candle itself resolve TP/SL below.
    }
    const bars = market ? [breakBar, ...post] : post;
    // Phase 2 trade-quality tracking.
    let barsUntilFill = 0;
    let barsInTrade = 0;
    let retestCount = 0;
    let prevSide: 1 | -1 | 0 = 0; // side of entry line
    for (const k of bars) {
      if (!triggered) {
        barsUntilFill += 1;
        const dist = breakSide === "long" ? Math.max(0, k.low - entry) : Math.max(0, entry - k.high);
        if (dist < closestDist) closestDist = dist;
        const hit = breakSide === "long" ? k.low <= entry : k.high >= entry;
        if (hit) {
          triggered = true;
          dr.trigger_at = k.openTime;
        } else {
          continue;
        }
      }
      barsInTrade += 1;

      // Retest tracking: count sign flips of (close - entry).
      const side: 1 | -1 = k.close >= entry ? 1 : -1;
      if (prevSide !== 0 && side !== prevSide) retestCount += 1;
      prevSide = side;

      // Snapshot peak-R from PRIOR bars — the trailing SL for this bar's
      // SL/TP check must not use this bar's own favorable extreme, otherwise
      // a bar that both spikes up and dips through the initial SL is
      // incorrectly resolved as a trailed-out profit (same-bar look-ahead).
      const peakRBefore = peakR;

      // Update peak-R using bar extremes in the favorable direction (for reporting).
      const favorableExtreme = breakSide === "long" ? k.high : k.low;
      const barR = ((favorableExtreme - entry) * (breakSide === "long" ? 1 : -1)) / risk;
      if (barR > peakR) peakR = barR;

      // Update MAE using bar extremes in the adverse direction.
      const adverse = breakSide === "long" ? k.low : k.high;
      if (adverseExtreme === null) adverseExtreme = adverse;
      else adverseExtreme = breakSide === "long" ? Math.min(adverseExtreme, adverse) : Math.max(adverseExtreme, adverse);

      // TP-target tracking — did price reach swing / opposite references while the trade was live?
      if (dr.swing_ref !== null) {
        if (breakSide === "long" ? k.high >= dr.swing_ref : k.low <= dr.swing_ref) reachedSwing = true;
      }
      if (dr.opposite_ref !== null) {
        if (breakSide === "long" ? k.low <= dr.opposite_ref : k.high >= dr.opposite_ref) reachedOpposite = true;
      }


      // Advance trailing SL for THIS bar's resolution using only prior-bar peak.
      if (trailEnabled && peakRBefore >= trailActivateR) {
        const steps = Math.floor((peakRBefore - trailActivateR) / trailStepR);
        const slR = steps * trailStepR; // 0, step, 2*step, ...
        const newSl = breakSide === "long" ? entry + slR * risk : entry - slR * risk;
        if (breakSide === "long" ? newSl > dynSl : newSl < dynSl) dynSl = newSl;
      }

      const hitTp = breakSide === "long" ? k.high >= tp : k.low <= tp;
      const hitSl = breakSide === "long" ? k.low <= dynSl : k.high >= dynSl;
      const slR = ((dynSl - entry) * (breakSide === "long" ? 1 : -1)) / risk;
      if (hitTp && hitSl) {
        // Conservative same-bar assumption: SL first.
        dr.outcome = "sl";
        dr.pnl_usd = slR * daySlRisk;
        dr.exit_r = slR;
        resolved = true;
        break;
      }
      if (hitTp) {
        dr.outcome = "tp";
        dr.pnl_usd = daySlRisk * opts.rr;
        dr.exit_r = opts.rr;
        resolved = true;
        break;
      }
      if (hitSl) {
        dr.outcome = "sl";
        dr.pnl_usd = slR * daySlRisk;
        dr.exit_r = slR;
        resolved = true;
        break;
      }
    }
    dr.final_sl = dynSl;
    dr.peak_r = peakR;
    if (triggered && adverseExtreme !== null && risk > 0) {
      const adverseR = ((entry - adverseExtreme) * (breakSide === "long" ? 1 : -1)) / risk;
      dr.mae_r = Math.max(0, adverseR);
      dr.mae_usd = dr.mae_r * daySlRisk;
    }
    // Phase 2: populate MFE + duration + time-to-fill + retest count.
    if (triggered) {
      dr.mfe_r = peakR;
      dr.mfe_usd = peakR * daySlRisk;
      dr.time_to_fill_bars = market ? 0 : Math.max(0, barsUntilFill);
      dr.time_to_fill_hours = (dr.time_to_fill_bars ?? 0) * 1;
      if (resolved) dr.duration_bars = barsInTrade;
      dr.retest_count = retestCount;
    }
    if (!resolved) {
      dr.outcome = triggered ? "open" : "armed_no_trigger";
    }
    if (dr.outcome === "armed_no_trigger" && Number.isFinite(closestDist) && risk > 0) {
      dr.closest_approach_r = closestDist / risk;
    }
    // Assign tp_target for any triggered trade (tp / sl / open) that had refs.
    if (dr.trigger_at !== null && (dr.swing_ref !== null || dr.opposite_ref !== null)) {
      dr.tp_target =
        reachedSwing && reachedOpposite
          ? "both"
          : reachedSwing
            ? "swing"
            : reachedOpposite
              ? "opposite"
              : "neither";
    }
    days.push(dr);
  }

  // ---- Tertile bucketing for numeric cohorts ----
  function tertiles(vals: number[]): [number, number] | null {
    if (vals.length < 3) return null;
    const s = [...vals].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
    return [q(1 / 3), q(2 / 3)];
  }
  const bucketize = (v: number, e: [number, number] | null): Tercile => {
    if (!e) return "mid";
    if (v <= e[0]) return "low";
    if (v <= e[1]) return "mid";
    return "high";
  };
  const withBreak = days.filter((d) => d.break_side !== null);
  const bodyEdges = tertiles(withBreak.map((d) => d.body_pct as number));
  const orEdges = tertiles(withBreak.map((d) => d.or_size_usd as number));
  const distEdges = tertiles(withBreak.map((d) => d.break_distance_usd as number));
  const orMap: Record<Tercile, OrBucket> = { low: "small", mid: "medium", high: "large" };
  const distMap: Record<Tercile, DistBucket> = { low: "near", mid: "mid", high: "far" };
  for (const d of withBreak) {
    d.body_bucket = bucketize(d.body_pct as number, bodyEdges);
    d.or_bucket = orMap[bucketize(d.or_size_usd as number, orEdges)];
    d.break_distance_bucket = distMap[bucketize(d.break_distance_usd as number, distEdges)];
  }


  // Apply per-trade fees to pnl_usd so ALL downstream stats (win rate is decided by pnl sign,
  // weekday/monthly/cohort totals, streaks, equity, drawdown) reflect fees consistently.
  let estFees = 0;
  for (const d of days) {
    if (d.trigger_at === null || d.entry === null || d.qty === null) continue;
    const notionalEntry = d.qty * d.entry;
    const notionalExit = d.qty * (d.outcome === "tp" && d.tp ? d.tp : d.outcome === "sl" && d.final_sl ? d.final_sl : d.entry);
    const tradeFee = (notionalEntry + notionalExit) * feeRate + 2 * feeUsdPerOrder;
    d.pnl_usd -= tradeFee;
    estFees += tradeFee;
  }

  const daysWithSession = days.filter((d) => d.zone_high !== null).length;
  const breaks = days.filter((d) => d.break_side !== null).length;
  const triggered = days.filter((d) => d.trigger_at !== null).length;
  const tp = days.filter((d) => d.outcome === "tp").length;
  const sl = days.filter((d) => d.outcome === "sl").length;
  const openCount = days.filter((d) => d.outcome === "open").length;
  const armedNoTrigger = days.filter((d) => d.outcome === "armed_no_trigger").length;
  const decided = tp + sl;
  // Any closed trade with positive realized P&L counts as a win (includes trailed exits).
  const winCount = days.filter((d) => (d.outcome === "tp" || d.outcome === "sl") && d.pnl_usd > 0).length;
  const winRate = decided > 0 ? (winCount / decided) * 100 : 0;
  // Guard against NaN pnl on individual days (e.g. a null Yahoo bar producing NaN entry/sl).
  // Without this, one poisoned trade turns the totals into NaN even though wins/losses
  // (filtered by > 0 / < 0) still aggregate cleanly.
  const finitePnl = (d: DayResult) => Number.isFinite(d.pnl_usd) ? d.pnl_usd : 0;
  const totalPnl = days.reduce((s, d) => s + finitePnl(d), 0);
  const rMultiples = days
    .filter((d) => d.outcome === "tp" || d.outcome === "sl")
    .map((d) => (d.exit_r ?? (d.outcome === "tp" ? opts.rr : -1)))
    .filter((r) => Number.isFinite(r));
  const avgR = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0;
  const bestPnl = days.reduce((m, d) => Math.max(m, finitePnl(d)), 0);
  const worstPnl = days.reduce((m, d) => Math.min(m, finitePnl(d)), 0);
  const skippedDays = days.filter((d) => d.skipped).length;
  const filteredDays = days.filter((d) => d.outcome === "filtered").length;

  // Per-weekday stats — count only decided trades (tp/sl).
  const weekdays: WeekdayStat[] = ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((wd) => {
    const rows = days.filter((d) => d.weekday === wd && (d.outcome === "tp" || d.outcome === "sl"));
    const wins = rows.filter((d) => d.pnl_usd > 0).length;
    const losses = rows.filter((d) => d.pnl_usd <= 0).length;
    const total = rows.reduce((s, d) => s + finitePnl(d), 0);
    const trades = rows.length;
    return {
      weekday: wd,
      label: WEEKDAY_LABELS[wd],
      trades,
      wins,
      losses,
      win_rate_pct: trades > 0 ? (wins / trades) * 100 : 0,
      total_pnl_usd: total,
      avg_pnl_usd: trades > 0 ? total / trades : 0,
    };
  });
  const withTrades = weekdays.filter((w) => w.trades > 0);
  const bestWd = withTrades.length ? withTrades.reduce((a, b) => (b.total_pnl_usd > a.total_pnl_usd ? b : a)) : null;
  const worstWd = withTrades.length ? withTrades.reduce((a, b) => (b.total_pnl_usd < a.total_pnl_usd ? b : a)) : null;

  // Advanced stats over chronological decided trades.
  const decidedRows = days.filter((d) => d.outcome === "tp" || d.outcome === "sl");
  const grossWin = decidedRows.filter((d) => d.pnl_usd > 0).reduce((s, d) => s + d.pnl_usd, 0);
  const grossLoss = Math.abs(decidedRows.filter((d) => d.pnl_usd < 0).reduce((s, d) => s + d.pnl_usd, 0));
  // Clamp to a large finite value — Infinity is not JSON/Seroval serializable.
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;
  const expectancy = decidedRows.length > 0 ? (grossWin - grossLoss) / decidedRows.length : 0;
  const winRows = decidedRows.filter((d) => d.pnl_usd > 0);
  const lossRows = decidedRows.filter((d) => d.pnl_usd < 0);
  const avgWin = winRows.length ? grossWin / winRows.length : 0;
  const avgLoss = lossRows.length ? grossLoss / lossRows.length : 0;

  // Fill-rate + miss analytics.
  const potentialFills = triggered + armedNoTrigger;
  const fillRatePct = potentialFills > 0 ? (triggered / potentialFills) * 100 : 0;
  const missRs = days
    .filter((d) => d.outcome === "armed_no_trigger" && d.closest_approach_r !== null)
    .map((d) => d.closest_approach_r as number)
    .sort((a, b) => a - b);
  const medianMissR = missRs.length ? missRs[Math.floor(missRs.length / 2)] : 0;
  const nearMissCount = missRs.filter((r) => r <= 0.1).length;

  // Fees already applied per-trade above; totalPnl is already net of fees.
  const netPnl = totalPnl;



  // Streaks + equity curve + drawdown, walk chronologically.
  let curWin = 0, curLoss = 0, maxWin = 0, maxLoss = 0;
  let cum = 0, peak = 0, maxDd = 0;
  const equity: { ist_date: string; cum_pnl_usd: number }[] = [];
  for (const d of days) {
    if (d.outcome === "tp" || d.outcome === "sl") {
      if (d.pnl_usd > 0) { curWin += 1; curLoss = 0; if (curWin > maxWin) maxWin = curWin; }
      else { curLoss += 1; curWin = 0; if (curLoss > maxLoss) maxLoss = curLoss; }
    }
    cum += d.pnl_usd;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) maxDd = dd;
    equity.push({ ist_date: d.ist_date, cum_pnl_usd: cum });
  }

  // ---- Cohort aggregation over decided trades ----
  const decidedAll = days.filter((d) => d.outcome === "tp" || d.outcome === "sl");
  function statFor(rows: DayResult[], bucket: string): CohortStat {
    const wins = rows.filter((d) => d.pnl_usd > 0).length;
    const losses = rows.filter((d) => d.pnl_usd <= 0).length;
    const trades = rows.length;
    const total = rows.reduce((s, d) => s + d.pnl_usd, 0);
    const rs = rows.map((d) => d.exit_r ?? (d.outcome === "tp" ? opts.rr : -1));
    return {
      bucket,
      trades,
      wins,
      losses,
      win_rate_pct: trades > 0 ? (wins / trades) * 100 : 0,
      total_pnl_usd: total,
      avg_pnl_usd: trades > 0 ? total / trades : 0,
      avg_r: rs.length > 0 ? rs.reduce((a, b) => a + b, 0) / rs.length : 0,
    };
  }
  const dimFor = <T extends string>(
    labels: T[],
    key: (d: DayResult) => T | null,
    edges: [number, number] | null,
  ): CohortDim => ({
    buckets: labels.map((l) => statFor(decidedAll.filter((d) => key(d) === l), l)),
    edges,
  });

  const cohorts = {
    body: dimFor<Tercile>(["low", "mid", "high"], (d) => d.body_bucket, bodyEdges),
    or_size: dimFor<OrBucket>(["small", "medium", "large"], (d) => d.or_bucket, orEdges),
    break_distance: dimFor<DistBucket>(["near", "mid", "far"], (d) => d.break_distance_bucket, distEdges),
    weekday: {
      buckets: ([1, 2, 3, 4, 5, 6, 0] as Weekday[]).map((wd) =>
        statFor(decidedAll.filter((d) => d.weekday === wd), WEEKDAY_LABELS[wd]),
      ),
      edges: null,
    },
    tp_target: dimFor<TpTarget>(["swing", "opposite", "both", "neither"], (d) => d.tp_target, null),
  };

  // ---- MAE distributions across winners / losers ----
  function maeStats(outcome: "tp" | "sl") {
    const vals = days
      .filter((d) => d.outcome === outcome && d.mae_r !== null)
      .map((d) => d.mae_r as number)
      .sort((a, b) => a - b);
    if (vals.length === 0) return null;
    const pct = (p: number) => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return {
      count: vals.length,
      avg,
      p50: pct(0.5),
      p75: pct(0.75),
      p90: pct(0.9),
      p95: pct(0.95),
      max: vals[vals.length - 1],
    };
  }
  const maeWins = maeStats("tp");
  const maeLosses = maeStats("sl");

  return {
    symbol: opts.symbol,
    session_start_ist: opts.sessionStartIst,
    sl_risk_usd: opts.slRiskUsd,
    rr: opts.rr,
    days_requested: opts.days,
    from_ms: fromMs,
    to_ms: now,
    bars_scanned: filtered.length,
    trail: { enabled: trailEnabled, activate_r: trailActivateR, step_r: trailStepR },
    skip_weekdays: opts.skipWeekdays ?? [],
    days,
    weekdays,
    equity,
    summary: {
      total_days: days.length,
      days_with_session: daysWithSession,
      skipped_days: skippedDays,
      filtered_days: filteredDays,
      breaks,
      triggered,
      tp,
      sl,
      open: openCount,
      armed_no_trigger: armedNoTrigger,
      win_rate_pct: winRate,
      total_pnl_usd: totalPnl,
      avg_r: avgR,
      best_pnl_usd: bestPnl,
      worst_pnl_usd: worstPnl,
      best_weekday: bestWd ? { label: bestWd.label, total_pnl_usd: bestWd.total_pnl_usd } : null,
      worst_weekday: worstWd ? { label: worstWd.label, total_pnl_usd: worstWd.total_pnl_usd } : null,
      profit_factor: profitFactor,
      expectancy_usd: expectancy,
      avg_win_usd: avgWin,
      avg_loss_usd: avgLoss,
      max_drawdown_usd: maxDd,
      max_consec_wins: maxWin,
      max_consec_losses: maxLoss,
      fill_rate_pct: fillRatePct,
      median_miss_r: medianMissR,
      near_miss_count: nearMissCount,
      est_fees_usd: estFees,
      net_pnl_usd: netPnl,
      cohorts,
      mae_wins: maeWins,
      mae_losses: maeLosses,
    },
    filters: opts.filters,
    entry: entryCfg,
  };
}

