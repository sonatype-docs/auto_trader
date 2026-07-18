// Runs one "paper trading" tick for every active runner. Fetches the last
// lookback_days of candles, re-runs the strategy + execution engine, then
// inserts any newly closed trades and refreshes the runner's live open
// position. Idempotent — a trade is keyed by runner_id + signalId.
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
  source: string;
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  exec_preset: string;
  risk_usd: number;
  lookback_days: number;
}

export interface TickReport {
  ok: boolean;
  runners: number;
  results: Array<{
    runner_id: string;
    label: string;
    inserted: number;
    open: boolean;
    error?: string;
  }>;
}

export async function runPaperTradingTick(): Promise<TickReport> {
  const { data: runners, error } = await supabaseAdmin
    .from("paper_runners")
    .select("id, label, source, symbol, timeframe, strategy_preset, exec_preset, risk_usd, lookback_days")
    .eq("running", true);
  if (error) throw new Error(error.message);

  const results: TickReport["results"] = [];
  for (const r of (runners ?? []) as (RunnerRow & { label: string })[]) {
    try {
      const out = await tickOne(r);
      results.push({ runner_id: r.id, label: r.label, ...out });
      await supabaseAdmin
        .from("paper_runners")
        .update({ last_tick_at: new Date().toISOString(), last_tick_error: null })
        .eq("id", r.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ runner_id: r.id, label: r.label, inserted: 0, open: false, error: msg });
      await supabaseAdmin
        .from("paper_runners")
        .update({ last_tick_at: new Date().toISOString(), last_tick_error: msg })
        .eq("id", r.id);
    }
  }
  return { ok: true, runners: results.length, results };
}

async function tickOne(r: RunnerRow): Promise<{ inserted: number; open: boolean }> {
  const scfg = STRATEGY_PRESETS[r.strategy_preset];
  if (!scfg) throw new Error(`Unknown strategy preset ${r.strategy_preset}`);
  const baseE = EXEC_PRESETS[r.exec_preset];
  if (!baseE) throw new Error(`Unknown exec preset ${r.exec_preset}`);
  const ecfg = withRiskUsd(baseE, Number(r.risk_usd));

  const toMs = Date.now();
  const fromMs = toMs - Number(r.lookback_days) * 24 * 60 * 60 * 1000;

  const { candles } = await loadRawCandles({
    source: r.source as KlineSourceId,
    symbol: r.symbol,
    timeframe: r.timeframe as Timeframe,
    fromMs,
    toMs,
  });
  if (!candles.length) return { inserted: 0, open: false };

  const enriched = enrichCandles(candles, {
    ...DEFAULT_CONFIG,
    symbol: r.symbol,
    timeframe: r.timeframe as Timeframe,
  });

  const sres = runStrategy(enriched, scfg, { mode: "paper", symbol: r.symbol });
  const eres = runExecution(enriched, sres.signals, ecfg, { symbol: r.symbol });

  const lastBar = enriched[enriched.length - 1];
  // Split flushed end-of-data trades (still-open positions) from real closes.
  const closed = eres.trades.filter((t) => t.exitReason !== "end_of_data");
  const openFlush = eres.trades.find((t) => t.exitReason === "end_of_data");

  // Insert only new closed trades. Dedup on runner_id + signalId.
  let inserted = 0;
  if (closed.length) {
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
    const { data, error: insErr } = await supabaseAdmin
      .from("paper_trades")
      .upsert(rows, { onConflict: "runner_id,dedup_key", ignoreDuplicates: true })
      .select("id");
    if (insErr) throw new Error(insErr.message);
    inserted = data?.length ?? 0;
  }

  // Refresh live open position row (or clear it).
  if (openFlush) {
    const unreal =
      (openFlush.direction === "long"
        ? lastBar.close - openFlush.fillPrice
        : openFlush.fillPrice - lastBar.close) * 1;
    await supabaseAdmin.from("paper_positions").upsert({
      runner_id: r.id,
      symbol: r.symbol,
      timeframe: r.timeframe,
      strategy_preset: r.strategy_preset,
      direction: openFlush.direction,
      entry_ts: new Date(openFlush.entryTime).toISOString(),
      entry_price: openFlush.fillPrice,
      stop_price: openFlush.stopPrice,
      target_price: openFlush.targetPrice,
      units: 1,
      last_price: lastBar.close,
      unrealized_pnl: unreal,
      updated_at: new Date().toISOString(),
    });
    return { inserted, open: true };
  }
  await supabaseAdmin.from("paper_positions").delete().eq("runner_id", r.id);
  return { inserted, open: false };
}
