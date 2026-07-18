import { createSharkClient, type Kline } from "@/lib/exchange/shark-client.server";
import { simulateFromKlines, type RangeBacktestResult } from "@/lib/strategy/backtest-range.server";
import type { FilterConfig } from "@/lib/strategy/filters";
import { needsDailyBias } from "@/lib/strategy/filters";
import { computeDailyBias, type DailyBiasEntry } from "@/lib/strategy/filter-bias.server";
import type { EntryMode } from "@/lib/strategy/entry-modes.server";

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type Cohorts = RangeBacktestResult["summary"]["cohorts"];


export interface HourStat {
  hour: string; // "HH:00"
  trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  total_pnl_usd: number;
  max_drawdown_usd: number;
  best_day: { ist_date: string; pnl_usd: number } | null;
  worst_day: { ist_date: string; pnl_usd: number } | null;
  profit_factor: number;
  expectancy_usd: number;
  avg_r: number;
  cohorts: Cohorts;
}

export interface SweepRangeResult {
  days: number;
  hours: HourStat[];
}

export interface SweepResult {
  symbol: string;
  sl_risk_usd: number;
  rr: number;
  trail: { enabled: boolean; activate_r: number; step_r: number };
  skip_weekdays: Weekday[];
  ranges: SweepRangeResult[];
  generated_at: number;
}

export async function runSweep(opts: {
  symbol: string;
  ranges: number[];
  slRiskUsd: number;
  rr: number;
  trailEnabled?: boolean;
  trailActivateR?: number;
  trailStepR?: number;
  skipWeekdays?: Weekday[];
  filters?: FilterConfig;
}): Promise<SweepResult> {
  const maxDays = Math.max(...opts.ranges, 1);
  const client = createSharkClient();
  const now = Date.now();
  const fromMs = now - maxDays * 86_400_000;
  const klines: Kline[] = await client.getKlinesRange(opts.symbol, "1h", fromMs, now);

  let dailyBias: Map<string, DailyBiasEntry> | undefined;
  if (needsDailyBias(opts.filters)) {
    const emaLen = opts.filters?.htf?.daily_ema_len ?? 20;
    const atrLen = opts.filters?.quality?.atr_len ?? 14;
    const warmupDays = Math.max(emaLen, atrLen) + 10;
    const daily = await client.getKlinesRange(
      opts.symbol,
      "1d",
      fromMs - warmupDays * 86_400_000,
      now,
    );
    dailyBias = computeDailyBias(daily, { emaLen, atrLen });
  }

  // IST candles open at HH:30 (UTC hour boundaries + 5:30). Use :30 slots so each
  // sweep hour maps to a real candle instead of getting floored onto the previous one.
  const hours: string[] = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:30`);
  const rangeResults: SweepRangeResult[] = [];

  for (const days of opts.ranges) {
    const rangeFromMs = now - days * 86_400_000;
    const hourStats: HourStat[] = [];
    for (const hour of hours) {
      const r = simulateFromKlines(klines, {
        symbol: opts.symbol,
        sessionStartIst: hour,
        slRiskUsd: opts.slRiskUsd,
        rr: opts.rr,
        days,
        fromMs: rangeFromMs,
        nowMs: now,
        trailEnabled: opts.trailEnabled,
        trailActivateR: opts.trailActivateR,
        trailStepR: opts.trailStepR,
        skipWeekdays: opts.skipWeekdays,
        filters: opts.filters,
        dailyBias,
      });
      const decidedDays = r.days.filter((d) => d.outcome === "tp" || d.outcome === "sl");
      const best = r.days.length
        ? r.days.reduce((a, b) => (b.pnl_usd > a.pnl_usd ? b : a))
        : null;
      const worst = r.days.length
        ? r.days.reduce((a, b) => (b.pnl_usd < a.pnl_usd ? b : a))
        : null;
      hourStats.push({
        hour,
        trades: decidedDays.length,
        wins: r.summary.tp,
        losses: r.summary.sl,
        win_rate_pct: r.summary.win_rate_pct,
        total_pnl_usd: r.summary.total_pnl_usd,
        max_drawdown_usd: r.summary.max_drawdown_usd,
        best_day:
          best && best.pnl_usd !== 0
            ? { ist_date: best.ist_date, pnl_usd: best.pnl_usd }
            : null,
        worst_day:
          worst && worst.pnl_usd !== 0
            ? { ist_date: worst.ist_date, pnl_usd: worst.pnl_usd }
            : null,
        profit_factor: r.summary.profit_factor,
        expectancy_usd: r.summary.expectancy_usd,
        avg_r: r.summary.avg_r,
        cohorts: r.summary.cohorts,
      });
    }
    rangeResults.push({ days, hours: hourStats });
  }

  return {
    symbol: opts.symbol,
    sl_risk_usd: opts.slRiskUsd,
    rr: opts.rr,
    trail: {
      enabled: !!opts.trailEnabled,
      activate_r: opts.trailActivateR ?? 2,
      step_r: opts.trailStepR ?? 1,
    },
    skip_weekdays: opts.skipWeekdays ?? [],
    ranges: rangeResults,
    generated_at: now,
  };
}

// -----------------------------------------------------------------------------
// Entry-zone grid sweep — varies (mode, entry_depth, sl_depth) at a fixed hour.
// -----------------------------------------------------------------------------

export interface EntryZoneCell {
  mode: EntryMode;
  entry_depth: number;
  sl_depth: number;
  trades: number;
  fill_rate_pct: number;
  win_rate_pct: number;
  gross_pnl_usd: number;
  fees_usd: number;
  net_pnl_usd: number;
  expectancy_usd: number;
  avg_r: number;
  triggered: number;
  missed: number;
  cohorts: Cohorts;
}

export interface EntryZoneSweepResult {
  symbol: string;
  session_start_ist: string;
  days: number;
  sl_risk_usd: number;
  rr: number;
  modes: EntryMode[];
  entry_depths: number[];
  sl_depths: number[];
  cells: EntryZoneCell[];
  generated_at: number;
}

export async function runEntryZoneSweep(opts: {
  symbol: string;
  days: number;
  sessionStartIst: string;
  slRiskUsd: number;
  rr: number;
  modes: EntryMode[];
  entryDepths: number[];
  slDepths: number[];
  trailEnabled?: boolean;
  trailActivateR?: number;
  trailStepR?: number;
  skipWeekdays?: Weekday[];
  filters?: FilterConfig;
  feeRate?: number;
}): Promise<EntryZoneSweepResult> {
  const client = createSharkClient();
  const now = Date.now();
  const fromMs = now - opts.days * 86_400_000;
  const klines: Kline[] = await client.getKlinesRange(opts.symbol, "1h", fromMs, now);

  let dailyBias: Map<string, DailyBiasEntry> | undefined;
  if (needsDailyBias(opts.filters)) {
    const emaLen = opts.filters?.htf?.daily_ema_len ?? 20;
    const atrLen = opts.filters?.quality?.atr_len ?? 14;
    const warmupDays = Math.max(emaLen, atrLen) + 10;
    const daily = await client.getKlinesRange(opts.symbol, "1d", fromMs - warmupDays * 86_400_000, now);
    dailyBias = computeDailyBias(daily, { emaLen, atrLen });
  }

  const cells: EntryZoneCell[] = [];

  const runOne = (mode: EntryMode, entryDepth: number, slDepth: number) => {
    return simulateFromKlines(klines, {
      symbol: opts.symbol,
      sessionStartIst: opts.sessionStartIst,
      slRiskUsd: opts.slRiskUsd,
      rr: opts.rr,
      days: opts.days,
      fromMs,
      nowMs: now,
      trailEnabled: opts.trailEnabled,
      trailActivateR: opts.trailActivateR,
      trailStepR: opts.trailStepR,
      skipWeekdays: opts.skipWeekdays,
      filters: opts.filters,
      dailyBias,
      entry: {
        mode,
        entryDepthPct: entryDepth,
        slDepthPct: slDepth,
        adaptiveStrongBreakPct: 30,
        adaptiveShallowDepth: Math.max(0.05, entryDepth / 2),
        adaptiveDeepDepth: Math.max(entryDepth, 0.1),
        retestSlR: 0.5,
      },
      feeRate: opts.feeRate,
    });
  };

  const finite = (n: number) => (Number.isFinite(n) ? n : 0);
  const pushCell = (mode: EntryMode, entryDepth: number, slDepth: number, r: ReturnType<typeof runOne>) => {
    const decided = r.summary.tp + r.summary.sl;
    cells.push({
      mode,
      entry_depth: entryDepth,
      sl_depth: slDepth,
      trades: decided,
      fill_rate_pct: finite(r.summary.fill_rate_pct),
      win_rate_pct: finite(r.summary.win_rate_pct),
      gross_pnl_usd: finite(r.summary.total_pnl_usd),
      fees_usd: finite(r.summary.est_fees_usd),
      net_pnl_usd: finite(r.summary.net_pnl_usd),
      expectancy_usd: finite(r.summary.expectancy_usd),
      avg_r: finite(r.summary.avg_r),
      triggered: r.summary.triggered,
      missed: r.summary.armed_no_trigger,
      cohorts: r.summary.cohorts,
    });
  };

  for (const mode of opts.modes) {
    if (mode === "retest" || mode === "market") {
      // These modes ignore entry_depth / sl_depth pair — single cell per mode.
      pushCell(mode, 0, mode === "retest" ? 0 : 0.75, runOne(mode, 0, 0.75));
      continue;
    }
    for (const entryDepth of opts.entryDepths) {
      for (const slDepth of opts.slDepths) {
        if (slDepth <= entryDepth) continue;
        pushCell(mode, entryDepth, slDepth, runOne(mode, entryDepth, slDepth));
      }
    }
  }

  const result = {
    symbol: opts.symbol,
    session_start_ist: opts.sessionStartIst,
    days: opts.days,
    sl_risk_usd: opts.slRiskUsd,
    rr: opts.rr,
    modes: opts.modes,
    entry_depths: opts.entryDepths,
    sl_depths: opts.slDepths,
    cells,
    generated_at: now,
  };
  return JSON.parse(JSON.stringify(result, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? 0 : v)));
}

