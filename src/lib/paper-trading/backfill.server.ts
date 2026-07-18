// Backfills paper_trades for the top-N paper runners by re-running each
// runner's strategy + execution engine over a large historical window and
// upserting the resulting closed trades. Idempotent: dedup on
// runner_id + signalId, so re-running merges new trades without duplicates.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadRawCandles } from "@/lib/market-data/loader.server";
import { enrichCandles } from "@/lib/market-data/enrich";
import { DEFAULT_CONFIG, type Timeframe } from "@/lib/market-data/types";
import { runStrategy } from "@/lib/strategy-engine/engine";
import { runExecution } from "@/lib/execution-engine/engine";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";
import { EXEC_PRESETS, withRiskUsd } from "@/lib/execution-engine/presets";
import type { KlineSourceId } from "@/lib/exchange/kline-source.server";

interface RunnerRow {
  id: string;
  label: string;
  source: string;
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  exec_preset: string;
  risk_usd: number;
  lookback_days: number;
}

export interface BackfillReport {
  ok: boolean;
  runners: number;
  totalInserted: number;
  results: Array<{
    runner_id: string;
    label: string;
    inserted: number;
    considered: number;
    error?: string;
  }>;
}

export async function backfillTopRunners(opts: { topN: number; days: number }): Promise<BackfillReport> {
  const { data: runners, error } = await supabaseAdmin
    .from("paper_runners")
    .select("id, label, source, symbol, timeframe, strategy_preset, exec_preset, risk_usd, lookback_days, score, running")
    .order("score", { ascending: false, nullsFirst: false })
    .order("running", { ascending: false })
    .limit(opts.topN);
  if (error) throw new Error(error.message);

  const results: BackfillReport["results"] = [];
  let totalInserted = 0;

  for (const r of (runners ?? []) as RunnerRow[]) {
    try {
      const out = await backfillOne(r, opts.days);
      totalInserted += out.inserted;
      results.push({ runner_id: r.id, label: r.label, ...out });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ runner_id: r.id, label: r.label, inserted: 0, considered: 0, error: msg });
    }
  }

  return { ok: true, runners: results.length, totalInserted, results };
}

async function backfillOne(r: RunnerRow, days: number): Promise<{ inserted: number; considered: number }> {
  const scfg = STRATEGY_PRESETS[r.strategy_preset];
  if (!scfg) throw new Error(`Unknown strategy preset ${r.strategy_preset}`);
  const baseE = EXEC_PRESETS[r.exec_preset];
  if (!baseE) throw new Error(`Unknown exec preset ${r.exec_preset}`);
  const ecfg = withRiskUsd(baseE, Number(r.risk_usd));

  const toMs = Date.now();
  const fromMs = toMs - days * 24 * 60 * 60 * 1000;

  const { candles } = await loadRawCandles({
    source: r.source as KlineSourceId,
    symbol: r.symbol,
    timeframe: r.timeframe as Timeframe,
    fromMs,
    toMs,
  });
  if (!candles.length) return { inserted: 0, considered: 0 };

  const enriched = enrichCandles(candles, {
    ...DEFAULT_CONFIG,
    symbol: r.symbol,
    timeframe: r.timeframe as Timeframe,
  });

  const sres = runStrategy(enriched, scfg, { mode: "paper", symbol: r.symbol });
  const eres = runExecution(enriched, sres.signals, ecfg, { symbol: r.symbol });

  // Only insert real closes; skip the trailing still-open flush trade.
  const closed = eres.trades.filter((t) => t.exitReason !== "end_of_data");
  if (!closed.length) return { inserted: 0, considered: 0 };

  const rows = closed.map((t) => ({
    runner_id: r.id,
    symbol: r.symbol,
    timeframe: r.timeframe,
    strategy_preset: r.strategy_preset,
    dedup_key: t.signalId,
    direction: t.direction,
    entry_ts: new Date(t.entryTime).toISOString(),
    entry_price: t.entryPrice,
    fill_price: t.fillPrice,
    stop_price: t.stopPrice,
    target_price: t.targetPrice,
    exit_ts: new Date(t.exitTime).toISOString(),
    exit_price: t.exitPrice,
    exit_reason: t.exitReason,
    rr: t.rr,
    gross_pnl: t.grossPnL,
    net_pnl: t.netPnL,
    fees: t.fees,
    units: 0,
  }));

  const { data, error } = await supabaseAdmin
    .from("paper_trades")
    .upsert(rows, { onConflict: "runner_id,dedup_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(error.message);

  return { inserted: data?.length ?? 0, considered: closed.length };
}
