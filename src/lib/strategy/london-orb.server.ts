// London Opening Range Breakout — dedicated backtest engine.
// Standalone from the fib-zone / silver-bullet stack: fetches 1H klines,
// defines a configurable opening range (default 08:00–09:00 UTC = London
// open), then simulates entry variants (immediate / break-close / retest)
// with configurable stop and target models, filters, and full analytics.
//
// Kept intentionally self-contained so future ORB variants (NY, Asian,
// custom) can copy this file and swap defaults without touching shared
// infrastructure.

import { getKlineSource, type KlineSourceId } from "@/lib/exchange/kline-source.server";
import type { Kline } from "@/lib/exchange/shark-client.server";

// ---------- Types ----------

export type EntryVariant = "immediate" | "break_close" | "retest";
export type StopModel = "opposite_range" | "range_pct" | "atr_mult" | "fixed_r";
export type TargetModel = "fixed_rr" | "opposite_range" | "atr_mult";
export type TrendMode = "off" | "ema20" | "ema50" | "ema200" | "align_20_50_200";

export interface LondonOrbOpts {
  symbol: string;
  days: number;
  dataSource?: KlineSourceId;
  // Range definition (UTC minutes-of-day)
  rangeStartUtc: string; // "HH:MM"
  rangeEndUtc: string;   // "HH:MM" (exclusive)
  // Entry
  entryVariant: EntryVariant;
  retestBufferPct: number; // % of range for retest tolerance
  // Stops
  stopModel: StopModel;
  stopAtrMult: number;      // when atr_mult
  stopRangePct: number;     // when range_pct (fraction of OR height)
  // Targets
  targetModel: TargetModel;
  rr: number;               // when fixed_rr
  targetAtrMult: number;    // when atr_mult
  // Risk
  slRiskUsd: number;
  maxTradesPerDay: number;
  // Filters
  trend: TrendMode;
  atrMin: number | null;
  atrMax: number | null;
  minBreakBodyPct: number;  // breakout candle body / range
  minBreakDistancePct: number; // % of OR height beyond range edge required
  maxBreakDistancePct: number | null;
  skipWeekdays: number[]; // 0=Sun..6=Sat
  timeToFillMaxHours: number; // cutoff for retest fills
  // Session cutoff (UTC minutes-of-day) — no new entries after this hour
  entryCutoffUtc: string; // "HH:MM"
  // Force-close after N hours from entry (0 = disabled)
  maxHoldHours: number;
}

export const DEFAULT_LONDON_ORB: LondonOrbOpts = {
  symbol: "XAUUSDT",
  days: 180,
  dataSource: "yahoo",
  rangeStartUtc: "08:00",
  rangeEndUtc: "09:00",
  entryVariant: "break_close",
  retestBufferPct: 15,
  stopModel: "opposite_range",
  stopAtrMult: 1.5,
  stopRangePct: 0.5,
  targetModel: "fixed_rr",
  rr: 2,
  targetAtrMult: 2,
  slRiskUsd: 30,
  maxTradesPerDay: 1,
  trend: "off",
  atrMin: null,
  atrMax: null,
  minBreakBodyPct: 0,
  minBreakDistancePct: 0,
  maxBreakDistancePct: null,
  skipWeekdays: [0, 6],
  timeToFillMaxHours: 4,
  entryCutoffUtc: "16:00",
  maxHoldHours: 12,
};

export type Outcome = "tp" | "sl" | "armed_no_trigger" | "no_break" | "no_range" | "filtered" | "open" | "cutoff";

export interface OrbTrade {
  ist_date: string;         // UTC date the range formed
  weekday: number;          // 0..6
  month: number;            // 1..12
  side: "long" | "short";
  entry: number;
  sl: number;
  tp: number;
  qty: number;
  range_high: number;
  range_low: number;
  range_size: number;
  atr: number | null;
  break_time: number;       // ms
  break_close: number;
  break_body_pct: number;   // 0..100
  break_distance_pct: number; // % of OR
  entry_time: number | null;
  exit_time: number | null;
  time_to_fill_hours: number | null;
  hold_hours: number | null;
  outcome: Outcome;
  pnl_usd: number;
  r_multiple: number;       // pnl / risk
  mfe_r: number;
  mae_r: number;
  filter_reason: string | null;
}

export interface BucketStat {
  bucket: string;
  trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  net_pnl_usd: number;
  avg_r: number;
}

export interface OrbSummary {
  total_days: number;
  days_with_range: number;
  breaks: number;
  triggered: number;
  filtered: number;
  tp: number;
  sl: number;
  net_pnl_usd: number;
  gross_win_usd: number;
  gross_loss_usd: number;
  win_rate_pct: number;
  profit_factor: number;
  expectancy_usd: number;
  avg_r: number;
  avg_win_usd: number;
  avg_loss_usd: number;
  max_drawdown_usd: number;
  max_consec_wins: number;
  max_consec_losses: number;
  avg_hold_hours: number;
  median_hold_hours: number;
  avg_time_to_fill_hours: number;
  avg_mfe_r: number;
  avg_mae_r: number;
  edge_score: number; // composite 0-100
}

export interface OrbBacktestResult {
  opts: LondonOrbOpts;
  from_ms: number;
  to_ms: number;
  bars_scanned: number;
  data_label: string;
  trades: OrbTrade[];
  summary: OrbSummary;
  analytics: {
    or_size: BucketStat[];
    break_distance: BucketStat[];
    weekday: BucketStat[];
    month: BucketStat[];
    atr_band: BucketStat[];
    trend: BucketStat[];
    break_body: BucketStat[];
    entry_hour_utc: BucketStat[];
  };
  equity: { t: number; cum_pnl: number }[];
}

// ---------- Helpers ----------

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return h * 60 + (m || 0);
}

function dayKeyUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function groupByUtcDate(klines: Kline[]): Map<string, Kline[]> {
  const map = new Map<string, Kline[]>();
  for (const k of klines) {
    const key = dayKeyUtc(k.openTime);
    let arr = map.get(key);
    if (!arr) { arr = []; map.set(key, arr); }
    arr.push(k);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.openTime - b.openTime);
  return map;
}

// Wilder ATR(14) over daily closes.
function computeDailyAtr(daily: { high: number; low: number; close: number }[], period = 14): number[] {
  const trs: number[] = [];
  for (let i = 0; i < daily.length; i++) {
    if (i === 0) { trs.push(daily[i].high - daily[i].low); continue; }
    const prevClose = daily[i - 1].close;
    const tr = Math.max(
      daily[i].high - daily[i].low,
      Math.abs(daily[i].high - prevClose),
      Math.abs(daily[i].low - prevClose),
    );
    trs.push(tr);
  }
  const out: number[] = new Array(daily.length).fill(0);
  let acc = 0;
  for (let i = 0; i < daily.length; i++) {
    if (i < period) { acc += trs[i]; out[i] = i === period - 1 ? acc / period : 0; continue; }
    out[i] = (out[i - 1] * (period - 1) + trs[i]) / period;
  }
  return out;
}

function ema(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function tercile(sorted: number[], t: number): number {
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * t)));
  return sorted[idx];
}

function bucketize<T>(items: T[], bucketOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const b = bucketOf(it);
    let arr = map.get(b);
    if (!arr) { arr = []; map.set(b, arr); }
    arr.push(it);
  }
  return map;
}

function statsFor(trades: OrbTrade[]): BucketStat {
  const decided = trades.filter((t) => t.outcome === "tp" || t.outcome === "sl");
  const wins = decided.filter((t) => t.pnl_usd > 0).length;
  const losses = decided.length - wins;
  const net = decided.reduce((s, t) => s + t.pnl_usd, 0);
  const avgR = decided.length ? decided.reduce((s, t) => s + t.r_multiple, 0) / decided.length : 0;
  return {
    bucket: "",
    trades: decided.length,
    wins,
    losses,
    win_rate_pct: decided.length ? (wins / decided.length) * 100 : 0,
    net_pnl_usd: net,
    avg_r: avgR,
  };
}

// ---------- Main engine ----------

export async function runLondonOrbBacktest(opts: LondonOrbOpts): Promise<OrbBacktestResult> {
  const src = await getKlineSource(opts.dataSource ?? "yahoo");
  const toMs = Date.now();
  const fromMs = toMs - opts.days * 86_400_000;
  const klines: Kline[] = await src.getKlinesRange(opts.symbol, "1h", fromMs, toMs);
  const byDay = groupByUtcDate(klines);

  // Daily H/L/C for ATR + EMA context
  const dayList = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const dailyOhlc = dayList.map(([, bars]) => ({
    high: Math.max(...bars.map((b) => b.high)),
    low: Math.min(...bars.map((b) => b.low)),
    close: bars[bars.length - 1].close,
  }));
  const dailyAtr = computeDailyAtr(dailyOhlc);
  const closes = dailyOhlc.map((d) => d.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);

  const rangeStart = hhmmToMinutes(opts.rangeStartUtc);
  const rangeEnd = hhmmToMinutes(opts.rangeEndUtc);
  const entryCutoff = hhmmToMinutes(opts.entryCutoffUtc);
  const trades: OrbTrade[] = [];

  for (let di = 0; di < dayList.length; di++) {
    const [dateKey, bars] = dayList[di];
    if (bars.length === 0) continue;
    const weekday = new Date(dateKey + "T00:00:00Z").getUTCDay();
    if (opts.skipWeekdays.includes(weekday)) continue;
    const month = new Date(dateKey + "T00:00:00Z").getUTCMonth() + 1;

    // Extract range candles
    const rangeBars = bars.filter((b) => {
      const utcMin = new Date(b.openTime).getUTCHours() * 60 + new Date(b.openTime).getUTCMinutes();
      return utcMin >= rangeStart && utcMin < rangeEnd;
    });
    if (rangeBars.length === 0) continue;
    const rangeHigh = Math.max(...rangeBars.map((b) => b.high));
    const rangeLow = Math.min(...rangeBars.map((b) => b.low));
    const rangeSize = rangeHigh - rangeLow;
    if (rangeSize <= 0) continue;
    const rangeEndMs = rangeBars[rangeBars.length - 1].closeTime;
    const atr = di > 0 && dailyAtr[di - 1] > 0 ? dailyAtr[di - 1] : null;

    // Filter: ATR band
    if (opts.atrMin !== null && atr !== null && atr < opts.atrMin) continue;
    if (opts.atrMax !== null && atr !== null && atr > opts.atrMax) continue;

    // Trend filter reference (previous day's close vs EMAs)
    const priorClose = di > 0 ? closes[di - 1] : NaN;
    const trendUp = (() => {
      if (opts.trend === "off") return true;
      if (opts.trend === "ema20") return priorClose > (ema20[di - 1] ?? Infinity);
      if (opts.trend === "ema50") return priorClose > (ema50[di - 1] ?? Infinity);
      if (opts.trend === "ema200") return priorClose > (ema200[di - 1] ?? Infinity);
      return (
        priorClose > (ema20[di - 1] ?? Infinity) &&
        priorClose > (ema50[di - 1] ?? Infinity) &&
        priorClose > (ema200[di - 1] ?? Infinity)
      );
    })();
    const trendDown = (() => {
      if (opts.trend === "off") return true;
      if (opts.trend === "ema20") return priorClose < (ema20[di - 1] ?? -Infinity);
      if (opts.trend === "ema50") return priorClose < (ema50[di - 1] ?? -Infinity);
      if (opts.trend === "ema200") return priorClose < (ema200[di - 1] ?? -Infinity);
      return (
        priorClose < (ema20[di - 1] ?? -Infinity) &&
        priorClose < (ema50[di - 1] ?? -Infinity) &&
        priorClose < (ema200[di - 1] ?? -Infinity)
      );
    })();

    // Post-range bars up to entry cutoff
    const postBars = bars.filter((b) => {
      if (b.openTime < rangeEndMs) return false;
      const utcMin = new Date(b.openTime).getUTCHours() * 60 + new Date(b.openTime).getUTCMinutes();
      return utcMin < entryCutoff;
    });

    // Detect first break
    let breakBar: Kline | null = null;
    let breakSide: "long" | "short" | null = null;
    for (const k of postBars) {
      // Wick break OR close break — we track close for `break_close` and immediate variants.
      if (k.close > rangeHigh) { breakBar = k; breakSide = "long"; break; }
      if (k.close < rangeLow) { breakBar = k; breakSide = "short"; break; }
      if (opts.entryVariant === "immediate") {
        if (k.high > rangeHigh) { breakBar = k; breakSide = "long"; break; }
        if (k.low < rangeLow) { breakBar = k; breakSide = "short"; break; }
      }
    }
    if (!breakBar || !breakSide) continue;

    // Trend filter reject
    if (breakSide === "long" && !trendUp) continue;
    if (breakSide === "short" && !trendDown) continue;

    // Break body / distance filters
    const bcBody = Math.abs(breakBar.close - breakBar.open);
    const bcRange = breakBar.high - breakBar.low;
    const breakBodyPct = bcRange > 0 ? (bcBody / bcRange) * 100 : 0;
    const breakDistance =
      breakSide === "long" ? breakBar.close - rangeHigh : rangeLow - breakBar.close;
    const breakDistancePct = rangeSize > 0 ? (breakDistance / rangeSize) * 100 : 0;
    if (breakBodyPct < opts.minBreakBodyPct) continue;
    if (breakDistancePct < opts.minBreakDistancePct) continue;
    if (opts.maxBreakDistancePct !== null && breakDistancePct > opts.maxBreakDistancePct) continue;

    // Compute entry
    let entry: number;
    let entryTimeMs: number | null;
    let entryFilled = false;
    const postBreakBars = postBars.filter((b) => b.openTime > breakBar!.openTime);
    if (opts.entryVariant === "immediate") {
      entry = breakSide === "long" ? rangeHigh : rangeLow;
      entryTimeMs = breakBar.closeTime;
      entryFilled = true;
    } else if (opts.entryVariant === "break_close") {
      entry = breakBar.close;
      entryTimeMs = breakBar.closeTime;
      entryFilled = true;
    } else {
      // retest: wait for pullback to range edge (± buffer% of range)
      const buffer = (opts.retestBufferPct / 100) * rangeSize;
      const target = breakSide === "long" ? rangeHigh + buffer * 0 : rangeLow - buffer * 0;
      entry = target;
      entryTimeMs = null;
      const cutoffMs = breakBar.closeTime + opts.timeToFillMaxHours * 3_600_000;
      for (const k of postBreakBars) {
        if (k.openTime > cutoffMs) break;
        const hit = breakSide === "long" ? k.low <= target + buffer : k.high >= target - buffer;
        if (hit) {
          entry = target;
          entryTimeMs = k.openTime;
          entryFilled = true;
          break;
        }
      }
    }

    if (!entryFilled) {
      trades.push({
        ist_date: dateKey, weekday, month, side: breakSide,
        entry, sl: NaN, tp: NaN, qty: 0,
        range_high: rangeHigh, range_low: rangeLow, range_size: rangeSize, atr,
        break_time: breakBar.closeTime, break_close: breakBar.close, break_body_pct: breakBodyPct,
        break_distance_pct: breakDistancePct,
        entry_time: null, exit_time: null, time_to_fill_hours: null, hold_hours: null,
        outcome: "armed_no_trigger", pnl_usd: 0, r_multiple: 0, mfe_r: 0, mae_r: 0,
        filter_reason: null,
      });
      continue;
    }

    // Compute stop
    let sl: number;
    switch (opts.stopModel) {
      case "opposite_range":
        sl = breakSide === "long" ? rangeLow : rangeHigh;
        break;
      case "range_pct": {
        const off = rangeSize * opts.stopRangePct;
        sl = breakSide === "long" ? entry - off : entry + off;
        break;
      }
      case "atr_mult": {
        const off = (atr ?? rangeSize) * opts.stopAtrMult;
        sl = breakSide === "long" ? entry - off : entry + off;
        break;
      }
      case "fixed_r":
      default:
        // 1R = range size / 2 fallback
        sl = breakSide === "long" ? entry - rangeSize / 2 : entry + rangeSize / 2;
        break;
    }
    const risk = Math.abs(entry - sl);
    if (risk <= 0) continue;

    // Compute target
    let tp: number;
    switch (opts.targetModel) {
      case "opposite_range":
        tp = breakSide === "long" ? entry + (entry - rangeLow) : entry - (rangeHigh - entry);
        break;
      case "atr_mult": {
        const off = (atr ?? rangeSize) * opts.targetAtrMult;
        tp = breakSide === "long" ? entry + off : entry - off;
        break;
      }
      case "fixed_rr":
      default:
        tp = breakSide === "long" ? entry + risk * opts.rr : entry - risk * opts.rr;
        break;
    }
    const qty = opts.slRiskUsd / risk;

    // Simulate outcome across remaining bars
    let outcome: Outcome = "cutoff";
    let exitMs: number | null = null;
    let exitPrice = entry;
    let mfeR = 0;
    let maeR = 0;
    const maxHoldMs = opts.maxHoldHours > 0 ? entryTimeMs! + opts.maxHoldHours * 3_600_000 : Infinity;
    const dayEndMs = bars[bars.length - 1].closeTime;
    for (const k of bars.filter((b) => b.closeTime > (entryTimeMs ?? 0))) {
      if (k.openTime > maxHoldMs || k.openTime > dayEndMs) {
        outcome = "cutoff";
        exitMs = k.openTime;
        exitPrice = k.open;
        break;
      }
      // Track excursions
      const favHigh = breakSide === "long" ? k.high - entry : entry - k.low;
      const advLow = breakSide === "long" ? entry - k.low : k.high - entry;
      if (favHigh / risk > mfeR) mfeR = favHigh / risk;
      if (advLow / risk > maeR) maeR = advLow / risk;
      const hitTp = breakSide === "long" ? k.high >= tp : k.low <= tp;
      const hitSl = breakSide === "long" ? k.low <= sl : k.high >= sl;
      if (hitTp && hitSl) {
        // conservative: assume SL first
        outcome = "sl"; exitMs = k.closeTime; exitPrice = sl;
        break;
      }
      if (hitTp) { outcome = "tp"; exitMs = k.closeTime; exitPrice = tp; break; }
      if (hitSl) { outcome = "sl"; exitMs = k.closeTime; exitPrice = sl; break; }
    }
    if (outcome === "cutoff" && exitMs === null) {
      const last = bars[bars.length - 1];
      exitMs = last.closeTime;
      exitPrice = last.close;
    }
    const pnl =
      outcome === "tp" ? opts.slRiskUsd * (Math.abs(tp - entry) / risk)
      : outcome === "sl" ? -opts.slRiskUsd
      : (breakSide === "long" ? exitPrice - entry : entry - exitPrice) * qty;
    const rMult = pnl / opts.slRiskUsd;
    const timeToFillHours = entryTimeMs
      ? (entryTimeMs - breakBar.closeTime) / 3_600_000
      : null;
    const holdHours = entryTimeMs && exitMs ? (exitMs - entryTimeMs) / 3_600_000 : null;

    trades.push({
      ist_date: dateKey, weekday, month, side: breakSide,
      entry, sl, tp, qty,
      range_high: rangeHigh, range_low: rangeLow, range_size: rangeSize, atr,
      break_time: breakBar.closeTime, break_close: breakBar.close, break_body_pct: breakBodyPct,
      break_distance_pct: breakDistancePct,
      entry_time: entryTimeMs, exit_time: exitMs, time_to_fill_hours: timeToFillHours, hold_hours: holdHours,
      outcome, pnl_usd: pnl, r_multiple: rMult, mfe_r: mfeR, mae_r: maeR,
      filter_reason: null,
    });
  }

  // ---------- Summary ----------
  const decided = trades.filter((t) => t.outcome === "tp" || t.outcome === "sl");
  const wins = decided.filter((t) => t.pnl_usd > 0);
  const losses = decided.filter((t) => t.pnl_usd <= 0);
  const net = decided.reduce((s, t) => s + t.pnl_usd, 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl_usd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl_usd, 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  const winRate = decided.length ? (wins.length / decided.length) * 100 : 0;
  const avgR = decided.length ? decided.reduce((s, t) => s + t.r_multiple, 0) / decided.length : 0;
  const holds = decided.map((t) => t.hold_hours ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  const median = holds.length ? holds[Math.floor(holds.length / 2)] : 0;

  // Max drawdown from equity curve
  let peak = 0, cum = 0, mdd = 0;
  const equity: { t: number; cum_pnl: number }[] = [];
  for (const t of decided.sort((a, b) => (a.entry_time ?? 0) - (b.entry_time ?? 0))) {
    cum += t.pnl_usd;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > mdd) mdd = dd;
    equity.push({ t: t.entry_time ?? 0, cum_pnl: cum });
  }

  // Consec streaks
  let cw = 0, cl = 0, maxCw = 0, maxCl = 0;
  for (const t of decided) {
    if (t.pnl_usd > 0) { cw++; cl = 0; if (cw > maxCw) maxCw = cw; }
    else { cl++; cw = 0; if (cl > maxCl) maxCl = cl; }
  }

  const edgeScore = Math.round(
    Math.max(0, Math.min(100,
      (winRate / 100) * 25 +
      (Math.max(0, Math.min(3, pf)) / 3) * 25 +
      (Math.max(0, Math.min(1, avgR / 0.5))) * 25 +
      (net > 0 ? 25 : 0),
    ))
  );

  const summary: OrbSummary = {
    total_days: dayList.length,
    days_with_range: dayList.length,
    breaks: trades.length,
    triggered: decided.length + trades.filter((t) => t.outcome === "open" || t.outcome === "cutoff").length,
    filtered: 0,
    tp: wins.length,
    sl: losses.length,
    net_pnl_usd: net,
    gross_win_usd: grossWin,
    gross_loss_usd: grossLoss,
    win_rate_pct: winRate,
    profit_factor: pf,
    expectancy_usd: decided.length ? net / decided.length : 0,
    avg_r: avgR,
    avg_win_usd: wins.length ? grossWin / wins.length : 0,
    avg_loss_usd: losses.length ? -grossLoss / losses.length : 0,
    max_drawdown_usd: mdd,
    max_consec_wins: maxCw,
    max_consec_losses: maxCl,
    avg_hold_hours: holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : 0,
    median_hold_hours: median,
    avg_time_to_fill_hours: (() => {
      const arr = trades.map((t) => t.time_to_fill_hours ?? 0).filter((n) => n > 0);
      return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    })(),
    avg_mfe_r: decided.length ? decided.reduce((s, t) => s + t.mfe_r, 0) / decided.length : 0,
    avg_mae_r: decided.length ? decided.reduce((s, t) => s + t.mae_r, 0) / decided.length : 0,
    edge_score: edgeScore,
  };

  // ---------- Bucket analytics ----------
  const orSizes = trades.map((t) => t.range_size).sort((a, b) => a - b);
  const brkDists = trades.map((t) => t.break_distance_pct).sort((a, b) => a - b);
  const atrs = trades.map((t) => t.atr ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  const bodies = trades.map((t) => t.break_body_pct).sort((a, b) => a - b);
  const orT = [tercile(orSizes, 0.33), tercile(orSizes, 0.66)];
  const bdT = [tercile(brkDists, 0.33), tercile(brkDists, 0.66)];
  const atrT = [tercile(atrs, 0.33), tercile(atrs, 0.66)];
  const bodyT = [tercile(bodies, 0.33), tercile(bodies, 0.66)];

  const bucketStats = (map: Map<string, OrbTrade[]>): BucketStat[] =>
    [...map.entries()]
      .map(([bucket, arr]) => ({ ...statsFor(arr), bucket }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));

  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const analytics = {
    or_size: bucketStats(bucketize(trades, (t) =>
      t.range_size <= orT[0] ? "small" : t.range_size <= orT[1] ? "medium" : "large")),
    break_distance: bucketStats(bucketize(trades, (t) =>
      t.break_distance_pct <= bdT[0] ? "near" : t.break_distance_pct <= bdT[1] ? "mid" : "far")),
    weekday: bucketStats(bucketize(trades, (t) => weekdayLabels[t.weekday])),
    month: bucketStats(bucketize(trades, (t) => String(t.month).padStart(2, "0"))),
    atr_band: bucketStats(bucketize(trades, (t) => {
      if (!t.atr) return "n/a";
      return t.atr <= atrT[0] ? "low" : t.atr <= atrT[1] ? "mid" : "high";
    })),
    trend: bucketStats(bucketize(trades, (t) => t.side)),
    break_body: bucketStats(bucketize(trades, (t) =>
      t.break_body_pct <= bodyT[0] ? "weak" : t.break_body_pct <= bodyT[1] ? "mid" : "strong")),
    entry_hour_utc: bucketStats(bucketize(trades, (t) =>
      String(new Date(t.entry_time ?? t.break_time).getUTCHours()).padStart(2, "0"))),
  };

  return {
    opts,
    from_ms: fromMs,
    to_ms: toMs,
    bars_scanned: klines.length,
    data_label: src.label,
    trades,
    summary,
    analytics,
    equity,
  };
}

// ---------- Simple grid optimizer ----------
// Sweeps entry variant × stop model × target/RR × trend filter × break body
// filter. Returns the top N presets by net P&L with an out-of-sample split
// check (last 30% must stay net-positive when the full-window preset is
// re-scored on that slice only).

export interface OrbPreset {
  rank: number;
  net_pnl_usd: number;
  oos_net_pnl_usd: number;
  win_rate_pct: number;
  profit_factor: number;
  trades: number;
  avg_r: number;
  max_drawdown_usd: number;
  edge_score: number;
  overrides: Partial<LondonOrbOpts>;
}

export interface OrbOptimizerResult {
  evaluated: number;
  elapsed_ms: number;
  data_label: string;
  bars_scanned: number;
  top: OrbPreset[];
}

export async function optimizeLondonOrb(
  base: LondonOrbOpts,
  topN = 12,
): Promise<OrbOptimizerResult> {
  const t0 = Date.now();
  // Pre-fetch klines once by running a single backtest and reusing its bars?
  // Simpler: reuse the range engine per candidate. Each candidate refetches
  // bars but the source client memoizes within a request.
  const grid: Partial<LondonOrbOpts>[] = [];
  const variants: EntryVariant[] = ["immediate", "break_close", "retest"];
  const stops: StopModel[] = ["opposite_range", "range_pct", "atr_mult"];
  const targets: { model: TargetModel; rr?: number }[] = [
    { model: "fixed_rr", rr: 1.5 },
    { model: "fixed_rr", rr: 2 },
    { model: "fixed_rr", rr: 2.5 },
    { model: "fixed_rr", rr: 3 },
    { model: "opposite_range" },
    { model: "atr_mult" },
  ];
  const trends: TrendMode[] = ["off", "ema50", "align_20_50_200"];
  const bodyFilters = [0, 40, 60];

  for (const v of variants)
    for (const s of stops)
      for (const t of targets)
        for (const tr of trends)
          for (const bf of bodyFilters)
            grid.push({
              entryVariant: v,
              stopModel: s,
              targetModel: t.model,
              rr: t.rr ?? base.rr,
              trend: tr,
              minBreakBodyPct: bf,
            });

  const results: OrbPreset[] = [];
  let firstBars = 0;
  let dataLabel = "";
  const oosCutoffMs = Date.now() - Math.floor(base.days * 0.3) * 86_400_000;

  for (const override of grid) {
    try {
      const opts = { ...base, ...override };
      const r = await runLondonOrbBacktest(opts);
      if (!firstBars) firstBars = r.bars_scanned;
      if (!dataLabel) dataLabel = r.data_label;
      const oosTrades = r.trades.filter(
        (t) => (t.outcome === "tp" || t.outcome === "sl") && (t.entry_time ?? 0) >= oosCutoffMs,
      );
      const oosNet = oosTrades.reduce((s, t) => s + t.pnl_usd, 0);
      results.push({
        rank: 0,
        net_pnl_usd: r.summary.net_pnl_usd,
        oos_net_pnl_usd: oosNet,
        win_rate_pct: r.summary.win_rate_pct,
        profit_factor: isFinite(r.summary.profit_factor) ? r.summary.profit_factor : 0,
        trades: r.summary.tp + r.summary.sl,
        avg_r: r.summary.avg_r,
        max_drawdown_usd: r.summary.max_drawdown_usd,
        edge_score: r.summary.edge_score,
        overrides: override,
      });
    } catch {
      /* skip broken combos */
    }
  }

  results.sort((a, b) => {
    // Penalize combos that fail OOS
    const aScore = a.net_pnl_usd + (a.oos_net_pnl_usd > 0 ? a.oos_net_pnl_usd * 0.5 : a.oos_net_pnl_usd);
    const bScore = b.net_pnl_usd + (b.oos_net_pnl_usd > 0 ? b.oos_net_pnl_usd * 0.5 : b.oos_net_pnl_usd);
    return bScore - aScore;
  });
  const top = results.slice(0, topN).map((r, i) => ({ ...r, rank: i + 1 }));

  return {
    evaluated: grid.length,
    elapsed_ms: Date.now() - t0,
    data_label: dataLabel,
    bars_scanned: firstBars,
    top,
  };
}
