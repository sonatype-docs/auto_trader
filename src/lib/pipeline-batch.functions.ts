// Pipeline batch runner — the big optimization.
//
// Instead of the client calling recordTradesFromExecution once per combo
// (which re-fetches + re-enriches the same candles for every combo sharing
// the same symbol/tf/tz slice), this server function loads and enriches
// the candles ONCE per (symbol, timeframe, strategyTimezone, from, to)
// slice, then loops N strategy×exec combos against that in-memory data.
//
// Typical matrix (2 symbols × 9 TFs × 6 TZs × 12 strats × 2 execs = 2592):
//   before → 2592 fetches + 2592 enrichments
//   after  → 108 fetches + 108 enrichments   (~20× less data work)
//
// The client still calls one batch per data-slice, and can run several
// batches concurrently (different slices don't share state).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { TIMEFRAMES, TIMEZONES, type Timeframe, type Timezone } from "@/lib/market-data/types";

const ComboItem = z.object({
  strategyPresetId: z.string(),
  execPresetId: z.string(),
});

const BatchInput = z.object({
  source: z.enum(["yahoo", "shark"]).default("shark"),
  symbol: z.string(),
  timeframe: z.enum([...TIMEFRAMES] as [Timeframe, ...Timeframe[]]),
  displayTimezone: z.enum([...TIMEZONES] as [Timezone, ...Timezone[]]).default("IST"),
  strategyTimezone: z.enum([...TIMEZONES] as [Timezone, ...Timezone[]]).default("London"),
  fromMs: z.number(),
  toMs: z.number(),
  combos: z.array(ComboItem).min(1).max(48),
  tags: z.array(z.string()).optional(),
  riskUsdOverride: z.number().positive().optional(),
  snapshotName: z.string().min(1).max(120).optional(),
});

export interface BatchComboResult {
  strategyPresetId: string;
  execPresetId: string;
  ok: boolean;
  inserted: number;
  tradesInRun: number;
  error: string | null;
  elapsedMs: number;
}

export interface BatchResult {
  results: BatchComboResult[];
  bars: number;
  dataMs: number;
  totalMs: number;
}

export const runComboBatch = createServerFn({ method: "POST" })
  .inputValidator((raw) => BatchInput.parse(raw))
  .handler(async ({ data }): Promise<BatchResult> => {
    const startedAll = Date.now();
    const { supabaseAdmin: supabase } = await import("@/integrations/supabase/client.server");
    const [
      { loadRawCandles },
      { enrichCandles },
      { DEFAULT_CONFIG },
      { runStrategy },
      { runExecution },
      { STRATEGY_PRESETS },
      { EXEC_PRESETS, withRiskUsd },
      { recordToRow },
      { toTradeRecord },
    ] = await Promise.all([
      import("@/lib/market-data/loader.server"),
      import("@/lib/market-data/enrich"),
      import("@/lib/market-data/types"),
      import("@/lib/strategy-engine/engine"),
      import("@/lib/execution-engine/engine"),
      import("@/lib/strategy-engine/presets"),
      import("@/lib/execution-engine/presets"),
      import("@/lib/trade-intelligence/mapper"),
      import("@/lib/trade-intelligence/recorder"),
    ]);

    // ── 1) Data slice loaded ONCE for the whole batch ──
    const dataStart = Date.now();
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
    const dataMs = Date.now() - dataStart;

    // ── 2) Cache strategy runs per strategyPresetId (execs re-use them) ──
    const strategyCache = new Map<string, ReturnType<typeof runStrategy>>();

    const results: BatchComboResult[] = [];
    const targetTable = data.snapshotName ? "trade_intelligence_archive" : "trade_intelligence";
    const onConflict = data.snapshotName ? "snapshot_name,trade_id" : "trade_id";
    const CHUNK = 500;

    for (const combo of data.combos) {
      const startedCombo = Date.now();
      try {
        const scfg = STRATEGY_PRESETS[combo.strategyPresetId as keyof typeof STRATEGY_PRESETS];
        if (!scfg) throw new Error(`Unknown strategy preset: ${combo.strategyPresetId}`);
        const baseEcfg = EXEC_PRESETS[combo.execPresetId as keyof typeof EXEC_PRESETS];
        if (!baseEcfg) throw new Error(`Unknown execution preset: ${combo.execPresetId}`);
        const ecfg = data.riskUsdOverride != null ? withRiskUsd(baseEcfg, data.riskUsdOverride) : baseEcfg;

        let sres = strategyCache.get(combo.strategyPresetId);
        if (!sres) {
          sres = runStrategy(enriched, scfg, { mode: "historical", symbol: data.symbol });
          strategyCache.set(combo.strategyPresetId, sres);
        }
        const eres = runExecution(enriched, sres.signals, ecfg, { symbol: data.symbol });

        const signalsById = new Map(sres.signals.map((s) => [s.signalId, s]));
        const records = eres.trades.map((t) =>
          toTradeRecord(t, {
            strategyId: combo.strategyPresetId,
            strategyVersion: "1",
            symbol: data.symbol,
            timeframe: data.timeframe,
            bars: enriched,
            signalsById,
            extraTags: data.tags ?? [],
          }),
        );
        for (const r of records) {
          const ts = r.signalTime ?? r.entryTime;
          r.tradeId = `ti_${combo.strategyPresetId}_${combo.execPresetId}_${r.symbol}_${r.timeframe ?? "na"}_${data.strategyTimezone}_${r.direction}_${ts}`;
        }

        let inserted = 0;
        if (records.length > 0) {
          const rows = records.map(recordToRow);
          if (data.snapshotName) {
            for (const row of rows as Record<string, unknown>[]) row.snapshot_name = data.snapshotName;
          }
          for (let i = 0; i < rows.length; i += CHUNK) {
            const slice = rows.slice(i, i + CHUNK);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error, count } = await supabase
              .from(targetTable)
              .upsert(slice as any, { onConflict, count: "exact" });
            if (error) throw new Error(error.message);
            inserted += count ?? slice.length;
          }
        }
        results.push({
          strategyPresetId: combo.strategyPresetId,
          execPresetId: combo.execPresetId,
          ok: true,
          inserted,
          tradesInRun: eres.trades.length,
          error: null,
          elapsedMs: Date.now() - startedCombo,
        });
      } catch (e) {
        results.push({
          strategyPresetId: combo.strategyPresetId,
          execPresetId: combo.execPresetId,
          ok: false,
          inserted: 0,
          tradesInRun: 0,
          error: e instanceof Error ? e.message : String(e),
          elapsedMs: Date.now() - startedCombo,
        });
      }
    }

    return {
      results,
      bars: enriched.length,
      dataMs,
      totalMs: Date.now() - startedAll,
    };
  });
