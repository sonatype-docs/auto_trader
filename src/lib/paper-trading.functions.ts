// Client-callable server functions for the Paper Trading dashboard.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export interface RunnerDTO {
  id: string;
  label: string;
  source: string;
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  exec_preset: string;
  risk_usd: number;
  lookback_days: number;
  running: boolean;
  score: number | null;
  started_at: string | null;
  last_tick_at: string | null;
  last_tick_error: string | null;
}

export interface PositionDTO {
  runner_id: string;
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  direction: string;
  entry_ts: string;
  entry_price: number;
  stop_price: number;
  target_price: number;
  last_price: number;
  unrealized_pnl: number;
  updated_at: string;
}

export interface TradeDTO {
  id: string;
  runner_id: string;
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  direction: string;
  entry_ts: string;
  entry_price: number;
  fill_price: number;
  stop_price: number;
  target_price: number;
  exit_ts: string;
  exit_price: number;
  exit_reason: string;
  rr: number;
  net_pnl: number;
  gross_pnl: number;
  fees: number;
}

export const listPaperRunners = createServerFn({ method: "GET" })
  .handler(async (): Promise<RunnerDTO[]> => {
    const supabase = await admin();
    const { data, error } = await supabase
      .from("paper_runners")
      .select("*")
      .order("score", { ascending: false, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as RunnerDTO[];
  });

export const listPaperPositions = createServerFn({ method: "GET" })
  .handler(async (): Promise<PositionDTO[]> => {
    const supabase = await admin();
    const { data, error } = await supabase.from("paper_positions").select("*");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PositionDTO[];
  });

export const listPaperTrades = createServerFn({ method: "GET" })
  .inputValidator((raw) => z.object({ limit: z.number().int().min(1).max(2000).default(500) }).parse(raw))
  .handler(async ({ data }): Promise<TradeDTO[]> => {
    const supabase = await admin();
    const { data: rows, error } = await supabase
      .from("paper_trades")
      .select("*")
      .order("exit_ts", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as TradeDTO[];
  });

export const setRunnerRunning = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ id: z.string().uuid(), running: z.boolean() }).parse(raw))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const patch = data.running
      ? { running: true, started_at: new Date().toISOString() }
      : { running: false };
    const { error } = await supabase.from("paper_runners").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setAllRunnersRunning = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ running: z.boolean() }).parse(raw))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const patch = data.running
      ? { running: true, started_at: new Date().toISOString() }
      : { running: false };
    const { error } = await supabase
      .from("paper_runners")
      .update(patch)
      .not("id", "is", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const runPaperTickNow = createServerFn({ method: "POST" })
  .handler(async () => {
    const { runPaperTradingTick } = await import("@/lib/paper-trading/tick.server");
    return await runPaperTradingTick();
  });

export const backfillPaperTradesFromBacktest = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({
    topN: z.number().int().min(1).max(50).default(10),
    days: z.number().int().min(7).max(365).default(180),
  }).parse(raw))
  .handler(async ({ data }) => {
    const { backfillTopRunners } = await import("@/lib/paper-trading/backfill.server");
    return await backfillTopRunners({ topN: data.topN, days: data.days });
  });


export const resetPaperRunner = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { error: e1 } = await supabase.from("paper_trades").delete().eq("runner_id", data.id);
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await supabase.from("paper_positions").delete().eq("runner_id", data.id);
    if (e2) throw new Error(e2.message);
    return { ok: true };
  });
