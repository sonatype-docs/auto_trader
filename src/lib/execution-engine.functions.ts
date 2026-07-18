// Server function — runs the Universal Execution Engine.
// It first produces signals via the Strategy Engine using the SAME data slice,
// then feeds those signals into the Execution Engine.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { TIMEFRAMES, TIMEZONES, type Timeframe, type Timezone } from "@/lib/market-data/types";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";
import { EXEC_PRESETS, withRiskUsd } from "@/lib/execution-engine/presets";
import type { ExecRunResult } from "@/lib/execution-engine/types";

const Input = z.object({
  source: z.enum(["yahoo", "shark"]).default("yahoo"),
  symbol: z.string().default("XAUUSDT"),
  timeframe: z.enum([...TIMEFRAMES] as [Timeframe, ...Timeframe[]]).default("15m"),
  displayTimezone: z.enum([...TIMEZONES] as [Timezone, ...Timezone[]]).default("IST"),
  strategyTimezone: z.enum([...TIMEZONES] as [Timezone, ...Timezone[]]).default("London"),
  fromMs: z.number(),
  toMs: z.number(),
  strategyPresetId: z.string(),
  execPresetId: z.string(),
  mode: z.enum(["historical", "live", "replay", "paper"]).default("historical"),
  /** Optional override — every trade risks this many USD. */
  riskUsdOverride: z.number().positive().optional(),
});

export interface RunExecutionResult {
  strategyPresetId: string;
  execPresetId: string;
  result: ExecRunResult;
  barsIn: number;
  signalsIn: number;
}

export const runExecutionEngine = createServerFn({ method: "POST" })
  .inputValidator((raw) => Input.parse(raw))
  .handler(async ({ data }): Promise<RunExecutionResult> => {
    const scfg = STRATEGY_PRESETS[data.strategyPresetId as keyof typeof STRATEGY_PRESETS];
    if (!scfg) throw new Error(`Unknown strategy preset: ${data.strategyPresetId}`);
    const baseEcfg = EXEC_PRESETS[data.execPresetId as keyof typeof EXEC_PRESETS];
    if (!baseEcfg) throw new Error(`Unknown execution preset: ${data.execPresetId}`);
    const ecfg = data.riskUsdOverride != null ? withRiskUsd(baseEcfg, data.riskUsdOverride) : baseEcfg;

    const [{ loadRawCandles }, { enrichCandles }, { DEFAULT_CONFIG }, { runStrategy }, { runExecution }] =
      await Promise.all([
        import("@/lib/market-data/loader.server"),
        import("@/lib/market-data/enrich"),
        import("@/lib/market-data/types"),
        import("@/lib/strategy-engine/engine"),
        import("@/lib/execution-engine/engine"),
      ]);

    const { candles } = await loadRawCandles({
      source: data.source, symbol: data.symbol, timeframe: data.timeframe,
      fromMs: data.fromMs, toMs: data.toMs,
    });

    const enriched = enrichCandles(candles, {
      ...DEFAULT_CONFIG,
      symbol: data.symbol, timeframe: data.timeframe,
      displayTimezone: data.displayTimezone,
      strategyTimezone: data.strategyTimezone,
    });

    const sres = runStrategy(enriched, scfg, { mode: data.mode, symbol: data.symbol });
    const result = runExecution(enriched, sres.signals, ecfg, { symbol: data.symbol });
    // Trim wire payload so massive runs (many days / 1m TF) don't OOM the worker.
    // Stats are computed against the full arrays before trimming.
    result.events = result.events.slice(-500);
    result.equityCurve = downsample(result.equityCurve, 500);
    if (result.trades.length > 2000) result.trades = result.trades.slice(-2000);
    if (result.cancelledOrders.length > 500) result.cancelledOrders = result.cancelledOrders.slice(-500);
    return {
      strategyPresetId: data.strategyPresetId,
      execPresetId: data.execPresetId,
      result,
      barsIn: enriched.length,
      signalsIn: sres.signals.length,
    };
  });

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}
