// Pipeline — public types shared by client + server.
import type { Timeframe, Timezone } from "@/lib/market-data/types";

export type PipelineStage = "data" | "strategy" | "execution" | "intelligence";
export const PIPELINE_STAGES: PipelineStage[] = [
  "data", "strategy", "execution", "intelligence",
];

export type PipelineStatus = "pending" | "running" | "done" | "failed" | "stopped";
export type ComboStatus = "pending" | "running" | "ok" | "failed" | "skipped";

export interface PipelineMatrix {
  source: "yahoo" | "shark";
  symbols: string[];
  timeframes: Timeframe[];
  strategyPresetIds: string[];
  execPresetIds: string[];
  displayTimezone: Timezone;
  strategyTimezone: Timezone;              // kept for backwards-compat with older runs
  strategyTimezones?: Timezone[];          // new: full matrix axis
  mode: "historical" | "live" | "replay" | "paper";
  lookbackDays: number;
  riskUsdPerTrade: number;
}

export interface ComboSpec {
  symbol: string;
  timeframe: Timeframe;
  strategyPresetId: string;
  execPresetId: string;
  strategyTimezone?: Timezone;
}


export interface ComboResult {
  spec: ComboSpec;
  status: ComboStatus;
  stage: PipelineStage | null;
  bars: number;
  signals: number;
  trades: number;
  inserted: number;
  netPnl: number;
  error: string | null;
  elapsedMs: number;
}

export interface SliceProgress {
  key: string;
  symbol: string;
  timeframe: Timeframe;
  strategyTimezone?: Timezone;
  total: number;
  done: number;
  failed: number;
  elapsedMs: number;
  status: "pending" | "running" | "ok" | "failed";
}

export interface PipelineProgress {
  total: number;
  completed: number;
  currentCombo: ComboSpec | null;
  currentStage: PipelineStage | null;
  ok: number;
  failed: number;
  totalTrades: number;
  totalInserted: number;
  /** Slice keys that have been fully completed (all batches OK). Used for
   *  per-slice resume checkpointing. */
  completedSlices?: string[];
  /** Per-slice progress snapshots (for UI restoration on resume). */
  sliceStats?: SliceProgress[];
  /** Milliseconds since the run started. */
  elapsedMs?: number;
  /** Estimated milliseconds remaining. */
  etaMs?: number;
  /** Current adaptive concurrency (may differ from user ceiling). */
  effectiveParallelism?: number;
}

