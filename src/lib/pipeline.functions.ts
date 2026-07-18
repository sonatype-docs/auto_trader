// Pipeline — server functions.
// One-click Jenkins-style pipeline that runs Data → Strategy → Execution →
// Trade Intelligence for every combo in a matrix. Client-orchestrated: the
// browser expands the matrix and calls `runComboPipeline` per combo, updating
// a `pipeline_runs` row for history/resume.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { TIMEFRAMES, TIMEZONES, type Timeframe, type Timezone } from "@/lib/market-data/types";

const MatrixSchema = z.object({
  source: z.enum(["yahoo", "shark"]),
  symbols: z.array(z.string()).min(1),
  timeframes: z.array(z.enum([...TIMEFRAMES] as [Timeframe, ...Timeframe[]])).min(1),
  strategyPresetIds: z.array(z.string()).min(1),
  execPresetIds: z.array(z.string()).min(1),
  displayTimezone: z.enum([...TIMEZONES] as [Timezone, ...Timezone[]]),
  strategyTimezone: z.enum([...TIMEZONES] as [Timezone, ...Timezone[]]),
  // Full TZ axis (matrix). Optional for backward-compat with older runs.
  strategyTimezones: z.array(z.enum([...TIMEZONES] as [Timezone, ...Timezone[]])).min(1).optional(),
  mode: z.enum(["historical", "live", "replay", "paper"]),
  lookbackDays: z.number().int().positive().max(2000),
  riskUsdPerTrade: z.number().positive(),
  // Target archive dataset — surfaces as a separate Snapshot in Research.
  snapshotName: z.string().min(1).max(120).optional(),
});

// ---------- start a run ----------

export const startPipelineRun = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ matrix: MatrixSchema, total: z.number().int().nonnegative() }).parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ownerRow } = await supabaseAdmin.from("owner").select("user_id").eq("id", true).maybeSingle();
    const userId = ownerRow?.user_id ?? "00000000-0000-0000-0000-000000000000";
    const { data: row, error } = await supabaseAdmin
      .from("pipeline_runs")
      .insert({
        user_id: userId,
        status: "running",
        matrix: data.matrix,
        progress: {
          total: data.total, completed: 0, ok: 0, failed: 0,
          totalTrades: 0, totalInserted: 0,
          currentCombo: null, currentStage: null,
        },
        log: [],
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { runId: row.id as string };
  });

// ---------- update progress ----------

const ProgressPatch = z.object({
  runId: z.string(),
  progress: z.record(z.string(), z.unknown()),
  logEntry: z
    .object({
      ts: z.number(),
      combo: z.record(z.string(), z.unknown()),
      stage: z.string().nullable(),
      status: z.string(),
      trades: z.number().optional(),
      inserted: z.number().optional(),
      netPnl: z.number().optional(),
      bars: z.number().optional(),
      signals: z.number().optional(),
      elapsedMs: z.number().optional(),
      error: z.string().nullable().optional(),
    })
    .optional(),
});

export const updatePipelineRun = createServerFn({ method: "POST" })
  .inputValidator((raw) => ProgressPatch.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = { progress: data.progress };
    if (data.logEntry) {
      const { data: existing } = await supabaseAdmin
        .from("pipeline_runs").select("log").eq("id", data.runId).maybeSingle();
      const log = Array.isArray(existing?.log) ? existing!.log as unknown[] : [];
      log.push(data.logEntry);
      // Cap log at 2000 entries — enough for large matrices without bloating the row.
      patch.log = log.slice(-2000);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabaseAdmin.from("pipeline_runs").update(patch as any).eq("id", data.runId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- finish a run ----------

export const finishPipelineRun = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({
    runId: z.string(),
    status: z.enum(["done", "failed", "stopped", "paused"]),
    error: z.string().nullable().optional(),
    progress: z.record(z.string(), z.unknown()).optional(),
  }).parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {
      status: data.status,
      finished_at: new Date().toISOString(),
    };
    if (data.error !== undefined) patch.error = data.error;
    if (data.progress) patch.progress = data.progress;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabaseAdmin.from("pipeline_runs").update(patch as any).eq("id", data.runId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- list runs ----------

export const listPipelineRuns = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ limit: z.number().int().positive().max(50).default(20) }).parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("pipeline_runs")
      .select("id,status,matrix,progress,error,started_at,finished_at")
      .order("started_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

// ---------- resumable run (latest paused/stopped/running-orphan) ----------

export const getResumableRun = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows, error } = await supabaseAdmin
    .from("pipeline_runs")
    .select("id,status,matrix,progress,log,error,started_at,finished_at")
    .in("status", ["paused", "stopped", "running"])
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return { row: rows?.[0] ?? null };
});

// ---------- latest run with failed combos (for retry-after-refresh) ----------

export const getLastFailedRun = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows, error } = await supabaseAdmin
    .from("pipeline_runs")
    .select("id,status,matrix,progress,log,started_at,finished_at")
    .order("started_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  interface FailedCombo {
    symbol: string; timeframe: string;
    strategyPresetId: string; execPresetId: string;
    strategyTimezone?: string | null;
  }
  for (const row of rows ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logArr = Array.isArray((row as any).log) ? (row as any).log as Array<any> : [];
    const failedCombos: FailedCombo[] = logArr
      .filter((e) => e && e.status === "failed" && e.combo)
      .map((e) => ({
        symbol: String(e.combo.symbol ?? ""),
        timeframe: String(e.combo.timeframe ?? ""),
        strategyPresetId: String(e.combo.strategyPresetId ?? ""),
        execPresetId: String(e.combo.execPresetId ?? ""),
        strategyTimezone: e.combo.strategyTimezone == null ? null : String(e.combo.strategyTimezone),
      }));
    if (failedCombos.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (row as any).matrix as Record<string, unknown> | null;
      return {
        runId: row.id as string,
        startedAt: row.started_at as string,
        status: row.status as string,
        snapshotName: (m && typeof m.snapshotName === "string") ? m.snapshotName as string : null,
        source: (m && typeof m.source === "string") ? m.source as string : "shark",
        displayTimezone: (m && typeof m.displayTimezone === "string") ? m.displayTimezone as string : "IST",
        lookbackDays: (m && typeof m.lookbackDays === "number") ? m.lookbackDays as number : 500,
        riskUsdPerTrade: (m && typeof m.riskUsdPerTrade === "number") ? m.riskUsdPerTrade as number : 20,
        failedCombos,
      };
    }
  }
  return null;
});



