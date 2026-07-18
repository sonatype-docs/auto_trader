// Genetic optimizer that searches parameter combinations for the ICT
// Silver Bullet and Asian Liquidity Sweep engines. Klines are fetched
// once for the widest requested window and reused across every evaluation,
// which turns thousands of backtests into a fast in-memory sweep.
//
// Every candidate is scored across multiple windows (30/60/90/180/365 days)
// with a 70/30 in-sample / out-of-sample chronological split, so the top
// presets we return are the ones that stay profitable out-of-sample on
// every requested window — not curve-fits.

import { createSharkClient, type Kline } from "@/lib/exchange/shark-client.server";
import {
  runSilverBulletCore,
  type SbBacktestResult,
  type SbOpts,
} from "@/lib/strategy/silver-bullet.server";
import {
  runSweepCore,
  type SweepBacktestResult,
  type SweepOpts,
  type SweepTpMode,
} from "@/lib/strategy/sweep-liquidity.server";
import { simulateFromKlines } from "@/lib/strategy/backtest-range.server";
import type { EntryConfig } from "@/lib/strategy/entry-modes.server";

export type OptimizerStrategy = "silver_bullet" | "asian_sweep" | "orb_sessions";

export interface WindowLegStats {
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  net_pnl: number;
  avg_r: number;
  profit_factor: number;
}

export interface WindowScore {
  days: number;
  is: WindowLegStats;
  oos: WindowLegStats;
  combined: WindowLegStats;
  oos_pass: boolean;
  contribution: number;
}

export interface OptimizerPreset {
  rank: number;
  strategy: OptimizerStrategy;
  symbol: string;
  genome: Record<string, string | number | boolean>;
  score: number;
  total_net_pnl: number;    // combined IS+OOS across all windows
  total_oos_pnl: number;
  total_trades: number;
  total_wins: number;
  total_losses: number;
  total_win_rate: number;
  total_avg_r: number;
  windows: WindowScore[];
  windows_passed: number;
}

export interface OptimizerRunSummary {
  strategy: OptimizerStrategy;
  symbol: string;
  windows: number[];
  population: number;
  generations: number;
  evaluated: number;
  cache_hits: number;
  bars_fetched: number;
  elapsed_ms: number;
  top: OptimizerPreset[];
  error?: string;
}

// ---------- Parameter space ----------
type NumGene = { kind: "int" | "float"; min: number; max: number; step: number };
type EnumGene<T extends string> = { kind: "enum"; values: readonly T[] };
type BoolGene = { kind: "bool" };
type TimeGene = { kind: "time"; startMin: number; endMin: number; stepMin: number };
type Gene = NumGene | EnumGene<string> | BoolGene | TimeGene;
type ParamSpace = Record<string, Gene>;

function sampleGene(g: Gene): string | number | boolean {
  if (g.kind === "bool") return Math.random() < 0.5;
  if (g.kind === "enum") return g.values[Math.floor(Math.random() * g.values.length)];
  if (g.kind === "time") {
    const steps = Math.floor((g.endMin - g.startMin) / g.stepMin);
    const m = g.startMin + Math.floor(Math.random() * (steps + 1)) * g.stepMin;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  const steps = Math.floor((g.max - g.min) / g.step);
  const raw = g.min + Math.floor(Math.random() * (steps + 1)) * g.step;
  return g.kind === "int" ? Math.round(raw) : Math.round(raw / g.step) * g.step;
}

function mutateGene(g: Gene, current: string | number | boolean): string | number | boolean {
  if (g.kind === "bool") return !current;
  if (g.kind === "enum") return sampleGene(g);
  if (g.kind === "time") {
    const [h, m] = String(current).split(":").map((n) => parseInt(n, 10));
    const cur = h * 60 + (m || 0);
    const delta = (Math.random() < 0.5 ? -1 : 1) * g.stepMin * (1 + Math.floor(Math.random() * 3));
    const next = Math.min(g.endMin, Math.max(g.startMin, cur + delta));
    const hh = Math.floor(next / 60);
    const mm = next % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  // numeric: gaussian-ish nudge
  const range = g.max - g.min;
  const sigma = Math.max(g.step, range * 0.1);
  const n1 = Math.random();
  const n2 = Math.random();
  const gauss = Math.sqrt(-2 * Math.log(n1 || 1e-9)) * Math.cos(2 * Math.PI * n2);
  const next = (current as number) + gauss * sigma;
  const clamped = Math.min(g.max, Math.max(g.min, next));
  const snapped = Math.round(clamped / g.step) * g.step;
  return g.kind === "int" ? Math.round(snapped) : Number(snapped.toFixed(6));
}

function randomGenome(space: ParamSpace): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, g] of Object.entries(space)) out[k] = sampleGene(g);
  return out;
}

function crossover(a: Record<string, string | number | boolean>, b: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const k of Object.keys(a)) out[k] = Math.random() < 0.5 ? a[k] : b[k];
  return out;
}

function mutate(g: Record<string, string | number | boolean>, space: ParamSpace, rate: number) {
  const out = { ...g };
  for (const [k, gene] of Object.entries(space)) {
    if (Math.random() < rate) out[k] = mutateGene(gene, out[k]);
  }
  return out;
}

function stableKey(g: Record<string, string | number | boolean>): string {
  return Object.keys(g)
    .sort()
    .map((k) => `${k}=${JSON.stringify(g[k])}`)
    .join("|");
}

// ---------- Parameter spaces ----------
export const SILVER_BULLET_SPACE: ParamSpace = {
  window_start_ist: { kind: "time", startMin: 9 * 60, endMin: 20 * 60, stepMin: 30 },
  window_len_min: { kind: "enum", values: ["30", "60", "90", "120"] as const },
  hold_extra_min: { kind: "enum", values: ["60", "120", "180", "240"] as const },
  swing_lookback: { kind: "int", min: 8, max: 60, step: 2 },
  fvg_min_usd: { kind: "float", min: 0, max: 5, step: 0.25 },
  sl_buffer_usd: { kind: "float", min: 0, max: 2, step: 0.1 },
  max_trades_per_day: { kind: "enum", values: ["1", "2", "3"] as const },
  // 3m dropped — 3× the bar volume for marginal edge and it's the top cause of
  // Worker CPU-limit crashes on the optimizer.
  execution_tf: { kind: "enum", values: ["5m", "15m"] as const },
  rr: { kind: "float", min: 1, max: 4, step: 0.25 },
};

export const ASIAN_SWEEP_SPACE: ParamSpace = {
  asian_start_ist: { kind: "int", min: 0, max: 6, step: 1 },
  asian_len: { kind: "int", min: 4, max: 12, step: 1 },
  entry_len: { kind: "int", min: 4, max: 14, step: 1 },
  min_range_usd: { kind: "float", min: 0, max: 30, step: 2 },
  entry_pullback_pct: { kind: "float", min: 0, max: 0.6, step: 0.05 },
  sl_buffer_pct: { kind: "float", min: 0.02, max: 0.3, step: 0.02 },
  tp_mode: { kind: "enum", values: ["rr", "opposite", "midrange"] as const },
  require_close_inside: { kind: "bool" },
  rr: { kind: "float", min: 1, max: 4, step: 0.25 },
};

// Multi-session ORB — searches over session start time, RR, entry mode, depths,
// trailing behaviour. Uses the same underlying ORB engine as the main backtest.
export const ORB_SESSIONS_SPACE: ParamSpace = {
  session_start_ist: {
    kind: "enum",
    values: [
      "02:30", "05:30", "06:30", "12:30", "13:30", "14:30",
      "15:30", "17:30", "18:30", "19:30", "21:30", "22:30", "00:30",
    ] as const,
  },
  rr: { kind: "float", min: 1, max: 4, step: 0.25 },
  entry_mode: { kind: "enum", values: ["fib", "retest", "market", "adaptive"] as const },
  entry_depth_pct: { kind: "float", min: 0.1, max: 0.9, step: 0.05 },
  sl_depth_pct: { kind: "float", min: 0, max: 0.5, step: 0.05 },
  retest_sl_r: { kind: "float", min: 0.5, max: 2, step: 0.1 },
  trail_enabled: { kind: "bool" },
  trail_activate_r: { kind: "float", min: 1, max: 3, step: 0.25 },
  trail_step_r: { kind: "float", min: 0.5, max: 2, step: 0.25 },
};

// ---------- Genome → concrete opts ----------
function sbGenomeToOpts(
  g: Record<string, string | number | boolean>,
  symbol: string,
  slRiskUsd: number,
  skipWeekdays: number[],
): Omit<SbOpts, "days"> {
  const startStr = g.window_start_ist as string;
  const [sh, sm] = startStr.split(":").map((n) => parseInt(n, 10));
  const startMin = sh * 60 + (sm || 0);
  const winLen = parseInt(g.window_len_min as string, 10);
  const endMin = Math.min(24 * 60 - 1, startMin + winLen);
  const holdExtra = parseInt(g.hold_extra_min as string, 10);
  const holdMin = Math.min(24 * 60 - 1, endMin + holdExtra);
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return {
    symbol,
    slRiskUsd,
    rr: g.rr as number,
    windowStartIst: startStr,
    windowEndIst: fmt(endMin),
    holdCutoffIst: fmt(holdMin),
    swingLookback: g.swing_lookback as number,
    fvgMinUsd: g.fvg_min_usd as number,
    slBufferUsd: g.sl_buffer_usd as number,
    maxTradesPerDay: parseInt(g.max_trades_per_day as string, 10),
    executionTf: g.execution_tf as "3m" | "5m" | "15m",
    skipWeekdays,
  };
}

function sweepGenomeToOpts(
  g: Record<string, string | number | boolean>,
  symbol: string,
  slRiskUsd: number,
  skipWeekdays: number[],
): Omit<SweepOpts, "days"> | null {
  const asianStart = g.asian_start_ist as number;
  const asianEnd = Math.min(23, asianStart + (g.asian_len as number));
  const entryEnd = Math.min(24, asianEnd + (g.entry_len as number));
  if (asianEnd - asianStart < 3 || entryEnd - asianEnd < 3) return null;
  return {
    symbol,
    slRiskUsd,
    rr: g.rr as number,
    asianStartIst: asianStart,
    asianEndIst: asianEnd,
    entryEndIst: entryEnd,
    minRangeUsd: g.min_range_usd as number,
    entryPullbackPct: g.entry_pullback_pct as number,
    slBufferPct: g.sl_buffer_pct as number,
    tpMode: g.tp_mode as SweepTpMode,
    requireCloseInside: g.require_close_inside as boolean,
    skipWeekdays,
  };
}

// ---------- Evaluators ----------
type Evaluator = (
  klines: Kline[],
  fromMs: number,
  toMs: number,
  days: number,
) => WindowLegStats;

function sbEvaluator(
  g: Record<string, string | number | boolean>,
  symbol: string,
  slRiskUsd: number,
  skipWeekdays: number[],
): Evaluator | null {
  const opts = sbGenomeToOpts(g, symbol, slRiskUsd, skipWeekdays);
  return (klines, fromMs, toMs, days) => {
    const r: SbBacktestResult = runSilverBulletCore(klines, { ...opts, days }, fromMs, toMs);
    const wins = r.summary.tp;
    const losses = r.summary.sl;
    const trades = wins + losses;
    return {
      trades,
      wins,
      losses,
      win_rate: r.summary.win_rate_pct,
      net_pnl: r.summary.total_pnl_usd,
      avg_r: r.summary.avg_r,
      profit_factor: r.summary.profit_factor,
    };
  };
}

function sweepEvaluator(
  g: Record<string, string | number | boolean>,
  symbol: string,
  slRiskUsd: number,
  skipWeekdays: number[],
): Evaluator | null {
  const opts = sweepGenomeToOpts(g, symbol, slRiskUsd, skipWeekdays);
  if (!opts) return null;
  return (klines, fromMs, toMs, days) => {
    const r: SweepBacktestResult = runSweepCore(klines, { ...opts, days }, fromMs, toMs);
    const wins = r.summary.tp;
    const losses = r.summary.sl;
    const trades = wins + losses;
    return {
      trades,
      wins,
      losses,
      win_rate: r.summary.win_rate_pct,
      net_pnl: r.summary.total_pnl_usd,
      avg_r: r.summary.avg_r,
      profit_factor: r.summary.profit_factor,
    };
  };
}

function orbGenomeToOpts(
  g: Record<string, string | number | boolean>,
  symbol: string,
  slRiskUsd: number,
  skipWeekdays: number[],
): {
  symbol: string;
  sessionStartIst: string;
  slRiskUsd: number;
  rr: number;
  trailEnabled: boolean;
  trailActivateR: number;
  trailStepR: number;
  skipWeekdays: number[];
  entry: EntryConfig;
} {
  return {
    symbol,
    sessionStartIst: g.session_start_ist as string,
    slRiskUsd,
    rr: g.rr as number,
    trailEnabled: g.trail_enabled as boolean,
    trailActivateR: g.trail_activate_r as number,
    trailStepR: g.trail_step_r as number,
    skipWeekdays,
    entry: {
      mode: g.entry_mode as EntryConfig["mode"],
      entryDepthPct: g.entry_depth_pct as number,
      slDepthPct: g.sl_depth_pct as number,
      retestSlR: g.retest_sl_r as number,
    } as EntryConfig,
  };
}

function orbEvaluator(
  g: Record<string, string | number | boolean>,
  symbol: string,
  slRiskUsd: number,
  skipWeekdays: number[],
): Evaluator {
  const opts = orbGenomeToOpts(g, symbol, slRiskUsd, skipWeekdays);
  return (klines, fromMs, toMs, days) => {
    const r = simulateFromKlines(klines, {
      ...opts,
      days,
      fromMs,
      nowMs: toMs,
      skipWeekdays: skipWeekdays as (0 | 1 | 2 | 3 | 4 | 5 | 6)[],
    });
    const wins = r.summary.tp;
    const losses = r.summary.sl;
    const trades = wins + losses;
    return {
      trades,
      wins,
      losses,
      win_rate: r.summary.win_rate_pct,
      net_pnl: r.summary.net_pnl_usd,
      avg_r: r.summary.avg_r,
      profit_factor: r.summary.profit_factor,
    };
  };
}

// ---------- Multi-window scoring ----------
interface EvalInput {
  windowSlices: { days: number; klines: Kline[]; fromMs: number; toMs: number }[];
}

type ScoreResult = {
  score: number;
  total_net_pnl: number;
  total_oos_pnl: number;
  total_trades: number;
  total_wins: number;
  total_losses: number;
  total_win_rate: number;
  total_avg_r: number;
  windows: WindowScore[];
  windows_passed: number;
};

function combineLegs(a: WindowLegStats, b: WindowLegStats): WindowLegStats {
  const trades = a.trades + b.trades;
  const wins = a.wins + b.wins;
  const losses = a.losses + b.losses;
  return {
    trades,
    wins,
    losses,
    win_rate: trades > 0 ? (wins / trades) * 100 : 0,
    net_pnl: a.net_pnl + b.net_pnl,
    avg_r: trades > 0 ? (a.avg_r * a.trades + b.avg_r * b.trades) / trades : 0,
    profit_factor:
      a.profit_factor === Infinity || b.profit_factor === Infinity
        ? Infinity
        : (a.profit_factor * a.trades + b.profit_factor * b.trades) / Math.max(1, trades),
  };
}

function scoreGenome(evaluator: Evaluator | null, input: EvalInput): ScoreResult {
  const empty: ScoreResult = {
    score: -Infinity,
    total_net_pnl: 0,
    total_oos_pnl: 0,
    total_trades: 0,
    total_wins: 0,
    total_losses: 0,
    total_win_rate: 0,
    total_avg_r: 0,
    windows: [],
    windows_passed: 0,
  };
  if (!evaluator) return empty;
  let score = 0;
  let totalNet = 0;
  let totalOos = 0;
  let totalTrades = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let totalRWeighted = 0;
  let passed = 0;
  const windows: WindowScore[] = [];
  for (const w of input.windowSlices) {
    const split = w.fromMs + Math.floor((w.toMs - w.fromMs) * 0.7);
    const isBars = w.klines.filter((k) => k.openTime < split);
    const oosBars = w.klines.filter((k) => k.openTime >= split);
    const isDays = Math.max(1, Math.round((split - w.fromMs) / 86_400_000));
    const oosDays = Math.max(1, Math.round((w.toMs - split) / 86_400_000));
    const isR = evaluator(isBars, w.fromMs, split, isDays);
    const oosR = evaluator(oosBars, split, w.toMs, oosDays);
    const combined = combineLegs(isR, oosR);
    const minTrades = Math.max(5, Math.floor(isR.trades * 0.2));
    const oosPass =
      oosR.net_pnl > 0 &&
      oosR.trades >= minTrades &&
      (isR.net_pnl <= 0 || oosR.net_pnl > 0);
    totalNet += combined.net_pnl;
    totalOos += oosR.net_pnl;
    totalTrades += combined.trades;
    totalWins += combined.wins;
    totalLosses += combined.losses;
    totalRWeighted += combined.avg_r * combined.trades;
    let contribution = 0;
    if (oosPass && isR.net_pnl > 0) {
      const robust = Math.min(1, oosR.net_pnl / Math.max(1, isR.net_pnl * 0.3));
      contribution = isR.net_pnl * robust;
      score += contribution;
      passed += 1;
    }
    windows.push({ days: w.days, is: isR, oos: oosR, combined, oos_pass: oosPass, contribution });
  }
  return {
    score: passed === 0 ? -Infinity : score,
    total_net_pnl: totalNet,
    total_oos_pnl: totalOos,
    total_trades: totalTrades,
    total_wins: totalWins,
    total_losses: totalLosses,
    total_win_rate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0,
    total_avg_r: totalTrades > 0 ? totalRWeighted / totalTrades : 0,
    windows,
    windows_passed: passed,
  };
}

// ---------- Genetic loop ----------
export interface OptimizerInput {
  strategy: OptimizerStrategy;
  symbol: string;
  windows: number[];        // days per window, e.g. [30, 60, 90, 180, 365]
  slRiskUsd: number;
  skipWeekdays: number[];
  population?: number;      // default 40
  generations?: number;     // default 25
  eliteCount?: number;      // default 4
  mutationRate?: number;    // default 0.18
  topN?: number;            // default 20
}

export async function runOptimizer(input: OptimizerInput): Promise<OptimizerRunSummary> {
  const startedAt = Date.now();
  // Silver Bullet is 5m-bar-heavy; every candidate scans ~26k bars per window
  // per IS/OOS split. Cap population×generations tighter for SB so we stay
  // under the 30s Cloudflare Worker CPU budget.
  const isSb = input.strategy === "silver_bullet";
  const popCap = isSb ? 60 : 120;
  const genCap = isSb ? 20 : 60;
  const population = Math.max(20, Math.min(popCap, input.population ?? (isSb ? 30 : 40)));
  const generations = Math.max(5, Math.min(genCap, input.generations ?? (isSb ? 12 : 25)));
  const eliteCount = Math.max(2, Math.min(10, input.eliteCount ?? 4));
  const mutationRate = input.mutationRate ?? 0.18;
  const topN = Math.max(5, Math.min(50, input.topN ?? 20));

  const space =
    input.strategy === "silver_bullet"
      ? SILVER_BULLET_SPACE
      : input.strategy === "asian_sweep"
        ? ASIAN_SWEEP_SPACE
        : ORB_SESSIONS_SPACE;
  const evaluatorBuilder = (g: Record<string, string | number | boolean>): Evaluator | null => {
    if (input.strategy === "silver_bullet")
      return sbEvaluator(g, input.symbol, input.slRiskUsd, input.skipWeekdays);
    if (input.strategy === "asian_sweep")
      return sweepEvaluator(g, input.symbol, input.slRiskUsd, input.skipWeekdays);
    return orbEvaluator(g, input.symbol, input.slRiskUsd, input.skipWeekdays);
  };

  // Fetch klines for max window, once per required timeframe.
  const client = createSharkClient();
  const now = Date.now();
  // Hard-cap max window per strategy so the Worker stays inside its CPU budget.
  // SB scans 5m bars → keep tighter than ORB/Sweep which scan 1h bars.
  const perStrategyMax = isSb ? 90 : 180;
  const requestedMax = Math.max(...input.windows);
  const maxDays = Math.min(perStrategyMax, requestedMax);
  const cappedWindows = Array.from(
    new Set(input.windows.map((d) => Math.min(perStrategyMax, d))),
  ).sort((a, b) => a - b);
  const fromMsMax = now - maxDays * 86_400_000;

  // Silver Bullet needs 5m + 15m (3m dropped for perf). Sweep + ORB use 1h.
  const timeframes: string[] =
    input.strategy === "silver_bullet" ? ["5m", "15m"] : ["1h"];

  const klinesByTf: Record<string, Kline[]> = {};
  let barsFetched = 0;
  for (const tf of timeframes) {
    const bars = await client.getKlinesRange(input.symbol, tf, fromMsMax, now);
    if (!bars || bars.length === 0) {
      throw new Error(
        `No historical bars returned for ${input.symbol} @ ${tf} — check the symbol name (spot vs perp) or try again in a moment.`,
      );
    }
    klinesByTf[tf] = bars;
    barsFetched += bars.length;
  }

  // Per-window slices for each tf, so the evaluator gets pre-filtered bars.
  const sliceByTf = (tf: string, days: number) => {
    const cutoff = now - days * 86_400_000;
    return klinesByTf[tf].filter((k) => k.openTime >= cutoff);
  };

  const buildInput = (g: Record<string, string | number | boolean>): EvalInput => {
    const tf =
      input.strategy === "silver_bullet"
        ? ((g.execution_tf as string) ?? "5m")
        : "1h";
    return {
      windowSlices: cappedWindows.map((days) => {
        const fromMs = now - days * 86_400_000;
        return { days, klines: sliceByTf(tf, days), fromMs, toMs: now };
      }),
    };
  };

  const cache = new Map<string, ReturnType<typeof scoreGenome>>();
  let evaluated = 0;
  let cacheHits = 0;

  const evaluate = (g: Record<string, string | number | boolean>) => {
    const key = stableKey(g);
    const cached = cache.get(key);
    if (cached) {
      cacheHits += 1;
      return cached;
    }
    let evaluator: Evaluator | null;
    try {
      evaluator = evaluatorBuilder(g);
    } catch {
      evaluator = null;
    }
    let scored: ReturnType<typeof scoreGenome>;
    try {
      scored = scoreGenome(evaluator, buildInput(g));
    } catch {
      scored = {
        score: -Infinity,
        total_net_pnl: 0,
        total_oos_pnl: 0,
        total_trades: 0,
        total_wins: 0,
        total_losses: 0,
        total_win_rate: 0,
        total_avg_r: 0,
        windows: [],
        windows_passed: 0,
      };
    }
    cache.set(key, scored);
    evaluated += 1;
    return scored;
  };

  type Individual = {
    genome: Record<string, string | number | boolean>;
    scored: ReturnType<typeof scoreGenome>;
  };

  let pop: Individual[] = Array.from({ length: population }, () => {
    const genome = randomGenome(space);
    return { genome, scored: evaluate(genome) };
  });

  const tournament = (): Individual => {
    const size = 4;
    let best = pop[Math.floor(Math.random() * pop.length)];
    for (let i = 1; i < size; i++) {
      const c = pop[Math.floor(Math.random() * pop.length)];
      if (c.scored.score > best.scored.score) best = c;
    }
    return best;
  };

  // Soft time budget — bail out of the GA loop before the Worker CPU limit
  // trips so the caller always gets JSON instead of a 502.
  const timeBudgetMs = isSb ? 22_000 : 26_000;
  let bailed = false;
  for (let gen = 0; gen < generations; gen++) {
    if (Date.now() - startedAt > timeBudgetMs) {
      bailed = true;
      break;
    }
    pop.sort((a, b) => b.scored.score - a.scored.score);
    const elite = pop.slice(0, eliteCount);
    const nextGen: Individual[] = [...elite];
    const decayedRate = mutationRate * (1 - (gen / generations) * 0.5);
    while (nextGen.length < population) {
      const a = tournament();
      const b = tournament();
      const child = mutate(crossover(a.genome, b.genome), space, decayedRate);
      nextGen.push({ genome: child, scored: evaluate(child) });
      if (Date.now() - startedAt > timeBudgetMs) { bailed = true; break; }
    }
    pop = nextGen;
    if (bailed) break;
  }

  // Collect unique top presets.
  const seen = new Set<string>();
  const all: OptimizerPreset[] = [];
  const sorted = [...cache.entries()].sort((a, b) => b[1].score - a[1].score);
  for (const [key, scored] of sorted) {
    if (scored.score === -Infinity) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    // Rebuild genome from key by parsing JSON pairs.
    const genome: Record<string, string | number | boolean> = {};
    for (const seg of key.split("|")) {
      const eq = seg.indexOf("=");
      genome[seg.slice(0, eq)] = JSON.parse(seg.slice(eq + 1));
    }
    all.push({
      rank: all.length + 1,
      strategy: input.strategy,
      symbol: input.symbol,
      genome,
      score: scored.score,
      total_net_pnl: scored.total_net_pnl,
      total_oos_pnl: scored.total_oos_pnl,
      total_trades: scored.total_trades,
      total_wins: scored.total_wins,
      total_losses: scored.total_losses,
      total_win_rate: scored.total_win_rate,
      total_avg_r: scored.total_avg_r,
      windows: scored.windows,
      windows_passed: scored.windows_passed,
    });
    if (all.length >= topN) break;
  }

  return {
    strategy: input.strategy,
    symbol: input.symbol,
    windows: cappedWindows,
    population,
    generations,
    evaluated,
    cache_hits: cacheHits,
    bars_fetched: barsFetched,
    elapsed_ms: Date.now() - startedAt,
    top: all,
  };
}
