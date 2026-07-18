import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  PlayCircle, Loader2, Square, RefreshCw, CheckCircle2, XCircle, Circle,
  Pause, Play, AlertTriangle, Trash2, Info,
} from "lucide-react";
import { MatrixGroup } from "@/components/matrix-picker";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";
import { EXEC_PRESETS, DEFAULT_RISK_USD_PER_TRADE } from "@/lib/execution-engine/presets";
import { TIMEFRAMES, TIMEZONES, type Timeframe, type Timezone } from "@/lib/market-data/types";
import { recordTradesFromExecution, listSnapshots, getSnapshotPreview, deleteSnapshot } from "@/lib/trade-intelligence.functions";
import {
  startPipelineRun, updatePipelineRun, finishPipelineRun, getResumableRun, getLastFailedRun,
} from "@/lib/pipeline.functions";

import { runComboBatch } from "@/lib/pipeline-batch.functions";
import { useKeepAlive } from "@/hooks/use-keep-alive";
import type {
  ComboResult, ComboSpec, PipelineProgress, PipelineStage, SliceProgress,
} from "@/lib/pipeline/types";


const ALL_SYMBOLS = ["XAUUSDT", "BTCUSDT"];
const PIPELINE_TFS: Timeframe[] = ["1m", "2m", "3m", "5m", "10m", "15m", "30m", "45m", "1h"];
const ALL_STRATEGY_PRESETS = Object.keys(STRATEGY_PRESETS);
const ALL_EXEC_PRESETS = Object.keys(EXEC_PRESETS);

export const Route = createFileRoute("/pipeline")({
  head: () => ({
    meta: [
      { title: "Automation Pipeline — Data → Strategy → Execution → Intelligence" },
      { name: "description", content: "One-click Jenkins-style pipeline that sweeps a matrix of symbols, timeframes, strategy and execution presets end-to-end." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Automation Pipeline" },
      { property: "og:description", content: "Run all 4 engines in one click across every matrix combination." },
    ],
  }),
  component: PipelinePage,
  errorComponent: ({ error, reset }) => (
    <div className="max-w-2xl mx-auto p-6">
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Pipeline page crashed</AlertTitle>
        <AlertDescription className="space-y-3">
          <p className="text-xs font-mono break-all">{error?.message ?? "Unknown error"}</p>
          <Button size="sm" onClick={reset}><RefreshCw className="w-3 h-3 mr-1" />Recover</Button>
        </AlertDescription>
      </Alert>
    </div>
  ),
});

function fmt(n: number, d = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
}
function fmtMoney(n: number): string { return `${n < 0 ? "-" : ""}$${fmt(Math.abs(n))}`; }
function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}


function defaultDatasetName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const mo = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  return `pipeline-${y}-${mo}-${d}_${h}-${mi}-${s}`;
}


// Timestamped fallback for legacy pipeline_runs rows that don't carry a
// snapshotName in their matrix. Uses the run's started_at so re-opening the
// same historic run always resolves to the same dataset label.
function fallbackSnapshotName(startedAt: string | null | undefined): string {
  const d = startedAt ? new Date(startedAt) : new Date();
  return defaultDatasetName(Number.isFinite(d.getTime()) ? d : new Date());
}


function StageDot({ stage, current, done, failed }: {
  stage: PipelineStage; current: PipelineStage | null; done: boolean; failed: boolean;
}) {
  const active = current === stage && !done && !failed;
  return (
    <div className={`flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest ${
      failed ? "text-rose-500" : done ? "text-emerald-500" : active ? "text-primary" : "text-muted-foreground/60"
    }`}>
      {failed
        ? <XCircle className="h-3 w-3" />
        : done
          ? <CheckCircle2 className="h-3 w-3" />
          : active
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Circle className="h-3 w-3" />}
      {stage}
    </div>
  );
}

// Heavy render guard — caps the visible log to failed + most recent so the
// 1,200-combo runs don't reconcile 5k+ SVGs on every batch tick.
const RunLog = memo(function RunLog({
  results, progress, riskUsd,
}: { results: ComboResult[]; progress: PipelineProgress; riskUsd: number }) {
  const MAX_ROWS = 200;
  const failed = results.filter((r) => r.status === "failed");
  const nonFailed = results.filter((r) => r.status !== "failed");
  // Show the tail (running + recent OK) which is what users watch during a run.
  const tail = nonFailed.slice(Math.max(0, nonFailed.length - MAX_ROWS));
  const hidden = results.length - failed.length - tail.length;
  const rows = [...failed, ...tail];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono tracking-widest">
          Run log ({progress.completed}/{progress.total})
          {hidden > 0 && (
            <span className="ml-2 text-[10px] text-muted-foreground normal-case">
              showing {failed.length} failed + last {tail.length} · {hidden.toLocaleString()} completed rows hidden
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-3">Status</th>
              <th className="py-1 pr-3">Symbol</th>
              <th className="py-1 pr-3">TF</th>
              <th className="py-1 pr-3">TZ</th>
              <th className="py-1 pr-3">Strategy</th>
              <th className="py-1 pr-3">Exec</th>
              <th className="py-1 pr-3 text-right">Trades</th>
              <th className="py-1 pr-3 text-right">Inserted</th>
              <th className="py-1 pr-3 text-right">Elapsed</th>
              <th className="py-1 pr-3">Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.spec.symbol}-${r.spec.timeframe}-${r.spec.strategyPresetId}-${r.spec.execPresetId}-${r.spec.strategyTimezone ?? ""}-${i}`} className="border-t border-border/40">
                <td className="py-1 pr-3">
                  {r.status === "ok" && <Badge className="bg-emerald-500/20 text-emerald-600 text-[9px]">OK</Badge>}
                  {r.status === "failed" && <Badge variant="destructive" className="text-[9px]">FAIL</Badge>}
                  {r.status === "running" && <Badge variant="secondary" className="text-[9px]">RUN</Badge>}
                  {r.status === "pending" && <Badge variant="outline" className="text-[9px]">…</Badge>}
                </td>
                <td className="py-1 pr-3">{r.spec.symbol}</td>
                <td className="py-1 pr-3">{r.spec.timeframe}</td>
                <td className="py-1 pr-3">{r.spec.strategyTimezone ?? "—"}</td>
                <td className="py-1 pr-3">{r.spec.strategyPresetId}</td>
                <td className="py-1 pr-3">{r.spec.execPresetId}</td>
                <td className="py-1 pr-3 text-right">{r.trades.toLocaleString()}</td>
                <td className="py-1 pr-3 text-right">{r.inserted.toLocaleString()}</td>
                <td className="py-1 pr-3 text-right">{r.elapsedMs > 0 ? `${(r.elapsedMs / 1000).toFixed(1)}s` : "—"}</td>
                <td className="py-1 pr-3 text-rose-500 truncate max-w-md" title={r.error ?? ""}>{r.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {progress.failed === 0 && progress.completed === progress.total && progress.total > 0 && (
          <div className="mt-4 text-xs text-emerald-500">
            Pipeline complete — {progress.totalInserted.toLocaleString()} trades stored across {progress.ok} combos. Risk per trade was ${riskUsd.toFixed(2)}.
          </div>
        )}
      </CardContent>
    </Card>
  );
});


type Control = "idle" | "running" | "paused" | "stopping";

function PipelinePage() {
  const [source, setSource] = useState<"yahoo" | "shark">("shark");
  const [displayTz, setDisplayTz] = useState<Timezone>("IST");
  const [mode] = useState<"historical">("historical");
  const [lookbackDays, setLookbackDays] = useState<number>(500);
  const [riskUsd, setRiskUsd] = useState<number>(DEFAULT_RISK_USD_PER_TRADE);

  const [symbols, setSymbols] = useState<string[]>(ALL_SYMBOLS);
  const [tfs, setTfs] = useState<string[]>(PIPELINE_TFS);
  const [strats, setStrats] = useState<string[]>(ALL_STRATEGY_PRESETS);
  const [execs, setExecs] = useState<string[]>(ALL_EXEC_PRESETS);
  const [stratTzs, setStratTzs] = useState<string[]>([...TIMEZONES]);


  const [results, setResults] = useState<ComboResult[]>([]);
  const [progress, setProgress] = useState<PipelineProgress>({
    total: 0, completed: 0, currentCombo: null, currentStage: null,
    ok: 0, failed: 0, totalTrades: 0, totalInserted: 0,
  });
  const [runId, setRunId] = useState<string | null>(null);
  const [failFast, setFailFast] = useState(true);
  const [control, setControl] = useState<Control>("idle");
  const controlRef = useRef<Control>("idle");
  useEffect(() => { controlRef.current = control; }, [control]);

  // Dataset targeting: new vs append.
  const [datasetMode, setDatasetMode] = useState<"new" | "append">("new");
  const [newDatasetName, setNewDatasetName] = useState<string>(() => defaultDatasetName());
  const [appendTo, setAppendTo] = useState<string>("");
  // Active snapshot name used by the currently running loop (kept in a ref
  // so rerecord/resume can read it even before state updates propagate).
  const activeSnapshotRef = useRef<string>("");

  const runFn = useServerFn(recordTradesFromExecution);
  const batchFn = useServerFn(runComboBatch);
  const startFn = useServerFn(startPipelineRun);
  const updateFn = useServerFn(updatePipelineRun);
  const finishFn = useServerFn(finishPipelineRun);
  const resumableFn = useServerFn(getResumableRun);
  const lastFailedFn = useServerFn(getLastFailedRun);

  const snapshotsFn = useServerFn(listSnapshots);
  const previewFn = useServerFn(getSnapshotPreview);
  const deleteSnapFn = useServerFn(deleteSnapshot);
  const [deletingSnap, setDeletingSnap] = useState(false);
  // Batch/parallel tuning. Adaptive limiter can lower this ceiling automatically
  // when the DB slows down or errors spike.
  const [batchSize, setBatchSize] = useState<number>(12);   // combos per data-slice request
  const [parallelism, setParallelism] = useState<number>(4); // MAX concurrent slice batches (ceiling)
  const [adaptive, setAdaptive] = useState<boolean>(true);
  const [effectiveParallelism, setEffectiveParallelism] = useState<number>(4);
  const [sliceStats, setSliceStats] = useState<SliceProgress[]>([]);
  const [etaMs, setEtaMs] = useState<number>(0);
  const [runElapsedMs, setRunElapsedMs] = useState<number>(0);


  const snapshotList = useQuery({
    queryKey: ["pipeline", "snapshots"],
    queryFn: () => snapshotsFn(),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  // Preview the currently-targeted dataset (append target, or a "new" name that
  // happens to collide with an existing snapshot).
  const previewTarget = datasetMode === "append"
    ? appendTo
    : (snapshotList.data?.snapshots ?? []).some((s) => s.name === newDatasetName)
      ? newDatasetName
      : "";
  const previewQ = useQuery({
    queryKey: ["pipeline", "snapshot-preview", previewTarget],
    queryFn: () => previewFn({ data: { name: previewTarget } }),
    enabled: !!previewTarget,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const resumable = useQuery({
    queryKey: ["pipeline", "resumable"],
    queryFn: () => resumableFn(),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  // Fetch the most recent run that had failed combos so we can offer a
  // retry-after-refresh even when local results state is empty.
  const lastFailed = useQuery({
    queryKey: ["pipeline", "last-failed"],
    queryFn: () => lastFailedFn(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });




  const combos: ComboSpec[] = useMemo(() => {
    const out: ComboSpec[] = [];
    const tzList = stratTzs.length > 0 ? stratTzs : ["London"];
    for (const symbol of symbols) {
      for (const tf of tfs) {
        for (const strategyPresetId of strats) {
          for (const execPresetId of execs) {
            for (const tz of tzList) {
              out.push({
                symbol,
                timeframe: tf as Timeframe,
                strategyPresetId,
                execPresetId,
                strategyTimezone: tz as Timezone,
              });
            }
          }
        }
      }
    }
    return out;
  }, [symbols, tfs, strats, execs, stratTzs]);


  // Wait while paused; return false if user asked to stop.
  async function waitIfPaused(): Promise<boolean> {
    while (controlRef.current === "paused") {
      await new Promise((r) => setTimeout(r, 200));
    }
    return controlRef.current !== "stopping";
  }

  async function runCombosLoop(opts: {
    id: string;
    combosToRun: ComboSpec[];
    startIndex: number;
    fromMs: number;
    toMs: number;
    initialProgress: PipelineProgress;
    initialResults: ComboResult[];
  }) {
    const { id, combosToRun, startIndex, fromMs, toMs } = opts;
    const nextResults = [...opts.initialResults];
    const prog: PipelineProgress = { ...opts.initialProgress };
    const completedSlices = new Set<string>(prog.completedSlices ?? []);
    const runStartedAt = Date.now() - (prog.elapsedMs ?? 0);

    const sliceKey = (s: ComboSpec) => `${s.symbol}|${s.timeframe}|${s.strategyTimezone ?? "London"}`;

    // Skip combos whose slice was already fully completed in a previous run.
    const remaining = combosToRun
      .map((spec, idx) => ({ spec, idx }))
      .filter((c) => c.idx >= startIndex && !completedSlices.has(sliceKey(c.spec)));

    const bySlice = new Map<string, Array<{ spec: ComboSpec; idx: number }>>();
    for (const c of remaining) {
      const k = sliceKey(c.spec);
      const arr = bySlice.get(k) ?? [];
      arr.push(c);
      bySlice.set(k, arr);
    }

    // Per-slice tracker (drives progress bars + checkpointing).
    const sliceMap = new Map<string, SliceProgress>();
    for (const [k, items] of bySlice.entries()) {
      const s = items[0].spec;
      sliceMap.set(k, {
        key: k,
        symbol: s.symbol,
        timeframe: s.timeframe,
        strategyTimezone: s.strategyTimezone,
        total: items.length,
        done: 0,
        failed: 0,
        elapsedMs: 0,
        status: "pending",
      });
    }
    const pushSliceUI = () => setSliceStats(Array.from(sliceMap.values()));
    pushSliceUI();

    // Batches (each retains its slice key so we can update the tracker).
    const batches: Array<{ key: string; items: Array<{ spec: ComboSpec; idx: number }> }> = [];
    for (const [key, items] of bySlice.entries()) {
      for (let i = 0; i < items.length; i += batchSize) {
        batches.push({ key, items: items.slice(i, i + batchSize) });
      }
    }

    // ── Adaptive concurrency state ──
    let effective = Math.max(1, Math.min(parallelism, adaptive ? Math.min(3, parallelism) : parallelism));
    const ceiling = Math.max(1, parallelism);
    const recentDurations: number[] = [];   // rolling window (last 8 batches)
    let consecutiveErrors = 0;
    let fastStreak = 0;
    setEffectiveParallelism(effective);

    function noteBatchOutcome(durationMs: number, ok: boolean) {
      recentDurations.push(durationMs);
      if (recentDurations.length > 8) recentDurations.shift();
      if (!adaptive) return;
      if (!ok) {
        consecutiveErrors += 1;
        fastStreak = 0;
        // Halve on repeated errors — DB is likely under pressure.
        if (consecutiveErrors >= 2 && effective > 1) {
          effective = Math.max(1, Math.floor(effective / 2));
          setEffectiveParallelism(effective);
        }
        return;
      }
      consecutiveErrors = 0;
      const avg = recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length;
      // Back off if batches are slow or the most recent one spiked.
      if (avg > 45_000 || durationMs > 90_000) {
        if (effective > 1) {
          effective = Math.max(1, effective - 1);
          setEffectiveParallelism(effective);
        }
        fastStreak = 0;
        return;
      }
      // Grow if we've had a healthy streak and still below the ceiling.
      if (durationMs < 20_000) fastStreak += 1; else fastStreak = 0;
      if (fastStreak >= 4 && effective < ceiling && recentDurations.length >= 4) {
        effective = Math.min(ceiling, effective + 1);
        setEffectiveParallelism(effective);
        fastStreak = 0;
      }
    }

    function recomputeEta() {
      const elapsed = Date.now() - runStartedAt;
      setRunElapsedMs(elapsed);
      prog.elapsedMs = elapsed;
      if (prog.completed > 0 && prog.completed < prog.total) {
        const perCombo = elapsed / prog.completed;
        const eta = perCombo * (prog.total - prog.completed);
        setEtaMs(eta);
        prog.etaMs = eta;
      } else {
        setEtaMs(0);
        prog.etaMs = 0;
      }
      prog.effectiveParallelism = effective;
    }

    let batchCursor = 0;
    let stopped = false;

    async function processBatch(batch: { key: string; items: Array<{ spec: ComboSpec; idx: number }> }) {
      const alive = await waitIfPaused();
      if (!alive) { stopped = true; return; }
      const first = batch.items[0].spec;
      const startedBatch = Date.now();

      const slice = sliceMap.get(batch.key);
      if (slice) { slice.status = "running"; pushSliceUI(); }

      for (const it of batch.items) {
        prog.currentCombo = it.spec;
        prog.currentStage = "data";
        nextResults[it.idx] = { ...nextResults[it.idx], status: "running", stage: "data" };
      }
      setResults([...nextResults]);
      setProgress({ ...prog });

      let attempt = 0;
      let lastErr: unknown = null;
      let batchOk = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let res: any = null;
      while (attempt < 2 && !batchOk) {
        try {
          res = await batchFn({
            data: {
              source, symbol: first.symbol, timeframe: first.timeframe,
              displayTimezone: displayTz,
              strategyTimezone: (first.strategyTimezone ?? "London") as Timezone,
              fromMs, toMs,
              combos: batch.items.map((it) => ({
                strategyPresetId: it.spec.strategyPresetId,
                execPresetId: it.spec.execPresetId,
              })),
              tags: ["pipeline", `run:${id}`, `tz:${first.strategyTimezone ?? "London"}`],
              riskUsdOverride: riskUsd,
              snapshotName: activeSnapshotRef.current || defaultDatasetName(),
            },
          });
          batchOk = true;
        } catch (e) {
          lastErr = e;
          attempt += 1;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
        }
      }

      const batchDuration = Date.now() - startedBatch;

      if (!batchOk) {
        noteBatchOutcome(batchDuration, false);
        const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
        for (const it of batch.items) {
          nextResults[it.idx] = {
            ...nextResults[it.idx], status: "failed", error: msg,
            elapsedMs: batchDuration,
          };
          prog.failed += 1;
          prog.completed += 1;
        }
        if (slice) {
          slice.failed += batch.items.length;
          slice.done += batch.items.length;
          slice.elapsedMs += batchDuration;
          if (slice.done >= slice.total) slice.status = "failed";
          pushSliceUI();
        }
        recomputeEta();
        setResults([...nextResults]);
        setProgress({ ...prog });
        await updateFn({
          data: {
            runId: id,
            progress: {
              ...prog,
              currentCombo: null, currentStage: null,
              completedSlices: Array.from(completedSlices),
              sliceStats: Array.from(sliceMap.values()),
            },
            logEntry: {
              ts: Date.now(), combo: first, stage: "execution", status: "failed",
              error: msg, elapsedMs: batchDuration,
            },
          },
        }).catch(() => {});
        if (failFast) stopped = true;
        return;
      }

      noteBatchOutcome(batchDuration, true);

      let batchAllOk = true;
      for (let i = 0; i < batch.items.length; i++) {
        const it = batch.items[i];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = res.results[i] as any;
        if (r?.ok) {
          nextResults[it.idx] = {
            ...nextResults[it.idx], status: "ok", stage: "intelligence",
            trades: r.tradesInRun ?? 0, inserted: r.inserted ?? 0, netPnl: 0,
            elapsedMs: r.elapsedMs ?? 0,
          };
          prog.ok += 1;
          prog.totalTrades += r.tradesInRun ?? 0;
          prog.totalInserted += r.inserted ?? 0;
        } else {
          nextResults[it.idx] = {
            ...nextResults[it.idx], status: "failed",
            error: r?.error ?? "batch error",
            elapsedMs: r?.elapsedMs ?? 0,
          };
          prog.failed += 1;
          batchAllOk = false;
        }
        prog.completed += 1;
      }

      if (slice) {
        slice.done += batch.items.length;
        slice.elapsedMs += batchDuration;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const failedCount = (res.results as any[]).filter((r) => !r?.ok).length;
        slice.failed += failedCount;
        if (slice.done >= slice.total) {
          slice.status = slice.failed > 0 ? "failed" : "ok";
          if (slice.failed === 0) completedSlices.add(slice.key);
        }
        pushSliceUI();
      }

      recomputeEta();
      setResults([...nextResults]);
      setProgress({ ...prog });

      // Persist a summary log + slice checkpoint.
      await updateFn({
        data: {
          runId: id,
          progress: {
            ...prog,
            currentCombo: null, currentStage: null,
            completedSlices: Array.from(completedSlices),
            sliceStats: Array.from(sliceMap.values()),
          },
          logEntry: {
            ts: Date.now(), combo: first, stage: "intelligence",
            status: batchAllOk ? "ok" : "failed",
            trades: res.results.reduce((s: number, r: { tradesInRun?: number }) => s + (r.tradesInRun ?? 0), 0),
            inserted: res.results.reduce((s: number, r: { inserted?: number }) => s + (r.inserted ?? 0), 0),
            elapsedMs: batchDuration,
          },
        },
      }).catch(() => {});

      // NOTE: Removed the per-combo updateFn loop that ran here — for a 1,296
      // combo run with 3 parallel workers it fired ~1.3k HTTP POSTs each
      // carrying an ever-growing progress payload (sliceStats, completedSlices,
      // + server-side JSONB log append). That flood was the primary trigger of
      // the browser tab crash. The batch-level updateFn call above is enough
      // for resume — the slice checkpoint + summary log covers hydration.
    }

    // Adaptive scheduler — reads `effective` on every dispatch so the ceiling
    // can shrink/grow dynamically while the run is in flight.
    let active = 0;
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (stopped) { if (active === 0) resolve(); return; }
        while (active < effective && batchCursor < batches.length) {
          const my = batchCursor++;
          active += 1;
          processBatch(batches[my])
            .catch((e) => console.error("[pipeline] worker error", e))
            .finally(() => {
              active -= 1;
              if (batchCursor >= batches.length && active === 0) resolve();
              else tick();
            });
        }
        if (batchCursor >= batches.length && active === 0) resolve();
      };
      tick();
    });

    if (stopped) {
      await finishFn({
        data: {
          runId: id,
          status: controlRef.current === "stopping" ? "stopped" : "failed",
          progress: {
            ...prog,
            completedSlices: Array.from(completedSlices),
            sliceStats: Array.from(sliceMap.values()),
          },
        },
      }).catch(() => {});
      setControl("idle");
      return;
    }
    await finishFn({
      data: {
        runId: id, status: "done",
        progress: {
          ...prog,
          completedSlices: Array.from(completedSlices),
          sliceStats: Array.from(sliceMap.values()),
        },
      },
    });
    setControl("idle");
  }


  const runMut = useMutation({
    mutationFn: async () => {
      setControl("running");
      const total = combos.length;
      const initialResults: ComboResult[] = combos.map((spec) => ({
        spec, status: "pending", stage: null, bars: 0, signals: 0, trades: 0,
        inserted: 0, netPnl: 0, error: null, elapsedMs: 0,
      }));
      setResults(initialResults);
      const initialProgress: PipelineProgress = {
        total, completed: 0, currentCombo: null, currentStage: null,
        ok: 0, failed: 0, totalTrades: 0, totalInserted: 0,
        completedSlices: [], sliceStats: [], elapsedMs: 0, etaMs: 0,
      };
      setProgress(initialProgress);
      setSliceStats([]);
      setEtaMs(0);
      setRunElapsedMs(0);


      // Resolve target dataset name.
      const chosenName = datasetMode === "append"
        ? (appendTo || "").trim()
        : (newDatasetName || "").trim() || defaultDatasetName();
      if (datasetMode === "append" && !chosenName) {
        setControl("idle");
        throw new Error("Pick a dataset to append to, or switch to 'New dataset'.");
      }
      activeSnapshotRef.current = chosenName;

      const matrix = {
        source, symbols, timeframes: tfs as Timeframe[],
        strategyPresetIds: strats, execPresetIds: execs,
        displayTimezone: displayTz,
        strategyTimezone: (stratTzs[0] ?? "London") as Timezone,
        strategyTimezones: stratTzs as Timezone[],
        mode, lookbackDays, riskUsdPerTrade: riskUsd,
        snapshotName: chosenName,
      };

      const { runId: id } = await startFn({ data: { matrix, total } });
      setRunId(id);


      const toMs = Date.now();
      const fromMs = toMs - lookbackDays * 86_400_000;

      await runCombosLoop({
        id, combosToRun: combos, startIndex: 0, fromMs, toMs,
        initialProgress, initialResults,
      });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[pipeline] fatal", msg);
      if (runId) finishFn({ data: { runId, status: "failed", error: msg } }).catch(() => {});
      setControl("idle");
    },
    onSettled: () => { resumable.refetch(); snapshotList.refetch(); },
  });

  async function beginResume(restart: boolean) {
    const row = resumable.data?.row;
    if (!row) return;
    setControl("running");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = row.matrix as any;
    activeSnapshotRef.current = (typeof m.snapshotName === "string" && m.snapshotName)
      ? m.snapshotName
      : fallbackSnapshotName(row.started_at as string | null | undefined);

    const rebuilt: ComboSpec[] = [];
    const tzList: string[] = Array.isArray(m.strategyTimezones) && m.strategyTimezones.length > 0
      ? m.strategyTimezones
      : [m.strategyTimezone ?? "London"];
    for (const symbol of m.symbols) {
      for (const tf of m.timeframes) {
        for (const strategyPresetId of m.strategyPresetIds) {
          for (const execPresetId of m.execPresetIds) {
            for (const tz of tzList) {
              rebuilt.push({ symbol, timeframe: tf, strategyPresetId, execPresetId, strategyTimezone: tz as Timezone });
            }
          }
        }
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prog0 = (row.progress ?? {}) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logArr = (Array.isArray((row as any).log) ? (row as any).log : []) as Array<any>;
    // Index the log by combo signature so we can hydrate per-combo trade counts.
    const key = (c: ComboSpec) => `${c.symbol}|${c.timeframe}|${c.strategyPresetId}|${c.execPresetId}|${c.strategyTimezone ?? ""}`;

    const logByCombo = new Map<string, { trades: number; inserted: number; elapsedMs: number; status: string }>();
    for (const entry of logArr) {
      if (!entry?.combo) continue;
      const k = `${entry.combo.symbol}|${entry.combo.timeframe}|${entry.combo.strategyPresetId}|${entry.combo.execPresetId}|${entry.combo.strategyTimezone ?? ""}`;
      logByCombo.set(k, {
        trades: Number(entry.trades ?? 0),
        inserted: Number(entry.inserted ?? 0),
        elapsedMs: Number(entry.elapsedMs ?? 0),
        status: String(entry.status ?? "ok"),
      });
    }

    const completed = restart ? 0 : Number(prog0.completed ?? 0);
    const initialResults: ComboResult[] = rebuilt.map((spec, idx) => {
      if (restart || idx >= completed) {
        return {
          spec, status: "pending", stage: null, bars: 0, signals: 0, trades: 0,
          inserted: 0, netPnl: 0, error: null, elapsedMs: 0,
        };
      }
      const hit = logByCombo.get(key(spec));
      return {
        spec,
        status: hit?.status === "failed" ? "failed" : "ok",
        stage: "intelligence",
        bars: 0, signals: 0,
        trades: hit?.trades ?? 0,
        inserted: hit?.inserted ?? 0,
        netPnl: 0,
        error: null,
        elapsedMs: hit?.elapsedMs ?? 0,
      };
    });
    setResults(initialResults);
    const priorSlices: string[] = Array.isArray(prog0.completedSlices) ? prog0.completedSlices as string[] : [];
    const priorSliceStats: SliceProgress[] = Array.isArray(prog0.sliceStats) ? prog0.sliceStats as SliceProgress[] : [];
    const initialProgress: PipelineProgress = restart
      ? {
          total: rebuilt.length, completed: 0,
          currentCombo: null, currentStage: null,
          ok: 0, failed: 0, totalTrades: 0, totalInserted: 0,
          completedSlices: [], sliceStats: [], elapsedMs: 0, etaMs: 0,
        }
      : {
          total: Number(prog0.total ?? rebuilt.length),
          completed,
          currentCombo: null, currentStage: null,
          ok: Number(prog0.ok ?? 0),
          failed: Number(prog0.failed ?? 0),
          totalTrades: Number(prog0.totalTrades ?? 0),
          totalInserted: Number(prog0.totalInserted ?? 0),
          completedSlices: priorSlices,
          sliceStats: priorSliceStats,
          elapsedMs: 0, etaMs: 0,
        };
    setProgress(initialProgress);
    setSliceStats(restart ? [] : priorSliceStats);
    setEtaMs(0);
    setRunElapsedMs(0);

    setRunId(row.id as string);

    // Restore matrix into UI so users see what will run.
    setSource(m.source);
    setSymbols(m.symbols);
    setTfs(m.timeframes);
    setStrats(m.strategyPresetIds);
    setExecs(m.execPresetIds);
    setDisplayTz(m.displayTimezone);
    setStratTzs(Array.isArray(m.strategyTimezones) && m.strategyTimezones.length > 0 ? m.strategyTimezones : [m.strategyTimezone ?? "London"]);
    setLookbackDays(m.lookbackDays);
    setRiskUsd(m.riskUsdPerTrade);

    // On restart, persist the reset progress so a subsequent pause/resume
    // sees a clean slate instead of the stale "completed" count.
    if (restart) {
      await updateFn({ data: { runId: row.id as string, progress: initialProgress } }).catch(() => {});
    }

    const toMs = Date.now();
    const fromMs = toMs - Number(m.lookbackDays) * 86_400_000;
    await runCombosLoop({
      id: row.id as string,
      combosToRun: rebuilt,
      startIndex: restart ? 0 : completed,
      fromMs, toMs, initialProgress, initialResults,
    });
  }

  const resumeMut = useMutation({
    mutationFn: () => beginResume(false),
    onSettled: () => { resumable.refetch(); snapshotList.refetch(); },
  });
  const restartMut = useMutation({
    mutationFn: () => beginResume(true),
    onSettled: () => { resumable.refetch(); snapshotList.refetch(); },
  });

  // Re-record trades for every completed combo in the resume row's log.
  // Use case: live table was cleared / trades went missing while paused;
  // upserts are keyed by deterministic trade_id, so re-runs restore missing
  // rows without duplicating existing ones.
  const [reRecordState, setReRecordState] = useState<{ done: number; total: number; inserted: number } | null>(null);
  const reRecordMut = useMutation({
    mutationFn: async () => {
      const row = resumable.data?.row;
      if (!row) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = row.matrix as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const logArr = (Array.isArray((row as any).log) ? (row as any).log : []) as Array<any>;
      const completed = logArr.filter((e) => e?.combo && e.status === "ok");
      const toMs = Date.now();
      const fromMs = toMs - Number(m.lookbackDays) * 86_400_000;
      let inserted = 0;
      setReRecordState({ done: 0, total: completed.length, inserted: 0 });
      for (let i = 0; i < completed.length; i++) {
        const c = completed[i].combo;
        try {
          const res = await runFn({
            data: {
              source: m.source, symbol: c.symbol, timeframe: c.timeframe,
              displayTimezone: m.displayTimezone,
              strategyTimezone: (c.strategyTimezone ?? m.strategyTimezone) as Timezone,
              fromMs, toMs,
              strategyPresetId: c.strategyPresetId,
              execPresetId: c.execPresetId,
              tags: ["pipeline", `run:${row.id}`, "rerecord", `tz:${(c.strategyTimezone ?? m.strategyTimezone)}`],
              riskUsdOverride: Number(m.riskUsdPerTrade),
              snapshotName: (typeof m.snapshotName === "string" && m.snapshotName) ? m.snapshotName : fallbackSnapshotName(row.started_at as string | null | undefined),
            },
          });
          inserted += res.inserted ?? 0;
        } catch (e) {
          console.error("[pipeline] rerecord failed", c, e);
        }
        setReRecordState({ done: i + 1, total: completed.length, inserted });
      }
    },
    onSettled: () => { resumable.refetch(); snapshotList.refetch(); },
  });

  // Retry only the failed combos from the current results into the SAME
  // dataset (activeSnapshotRef is set at the start of every run; falls back
  // to the current dataset selection when nothing has been run yet this session).
  const retryFailedMut = useMutation({
    mutationFn: async () => {
      // Prefer in-memory failures; fall back to the most recent DB run's log
      // (so retry survives a page refresh).
      let failedSpecs: ComboSpec[] = results
        .filter((r) => r.status === "failed")
        .map((r) => r.spec);
      let snap = activeSnapshotRef.current;
      let effSource = source;
      let effDisplayTz: Timezone = displayTz;
      let effLookback = lookbackDays;
      let effRisk = riskUsd;

      if (failedSpecs.length === 0) {
        const fetched = await lastFailedFn();
        if (!fetched || fetched.failedCombos.length === 0) {
          throw new Error("No failed combos found in the last 10 pipeline runs.");
        }
        failedSpecs = fetched.failedCombos.map((c) => ({
          symbol: c.symbol,
          timeframe: c.timeframe as Timeframe,
          strategyPresetId: c.strategyPresetId,
          execPresetId: c.execPresetId,
          strategyTimezone: (c.strategyTimezone ?? "London") as Timezone,
        }));
        if (!snap) snap = fetched.snapshotName ?? "";
        effSource = (fetched.source === "yahoo" ? "yahoo" : "shark");
        effDisplayTz = fetched.displayTimezone as Timezone;
        effLookback = fetched.lookbackDays;
        effRisk = fetched.riskUsdPerTrade;
      }

      if (!snap) {
        snap = datasetMode === "append"
          ? (appendTo || "").trim()
          : (newDatasetName || "").trim() || defaultDatasetName();
      }
      if (!snap) throw new Error("No target dataset — pick one under Dataset first.");
      activeSnapshotRef.current = snap;

      setControl("running");
      const initialResults: ComboResult[] = failedSpecs.map((spec) => ({
        spec, status: "pending", stage: null, bars: 0, signals: 0, trades: 0,
        inserted: 0, netPnl: 0, error: null, elapsedMs: 0,
      }));
      setResults(initialResults);
      const initialProgress: PipelineProgress = {
        total: failedSpecs.length, completed: 0, currentCombo: null, currentStage: null,
        ok: 0, failed: 0, totalTrades: 0, totalInserted: 0,
        completedSlices: [], sliceStats: [], elapsedMs: 0, etaMs: 0,
      };
      setProgress(initialProgress);
      setSliceStats([]);
      setEtaMs(0);
      setRunElapsedMs(0);

      const matrix = {
        source: effSource,
        symbols: Array.from(new Set(failedSpecs.map((s) => s.symbol))),
        timeframes: Array.from(new Set(failedSpecs.map((s) => s.timeframe))) as Timeframe[],
        strategyPresetIds: Array.from(new Set(failedSpecs.map((s) => s.strategyPresetId))),
        execPresetIds: Array.from(new Set(failedSpecs.map((s) => s.execPresetId))),
        displayTimezone: effDisplayTz,
        strategyTimezone: (failedSpecs[0].strategyTimezone ?? "London") as Timezone,
        strategyTimezones: Array.from(new Set(failedSpecs.map((s) => s.strategyTimezone ?? "London"))) as Timezone[],
        mode, lookbackDays: effLookback, riskUsdPerTrade: effRisk,
        snapshotName: snap,
      };
      const { runId: id } = await startFn({ data: { matrix, total: failedSpecs.length } });
      setRunId(id);

      const toMs = Date.now();
      const fromMs = toMs - effLookback * 86_400_000;
      await runCombosLoop({
        id, combosToRun: failedSpecs, startIndex: 0, fromMs, toMs,
        initialProgress, initialResults,
      });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[pipeline] retry failed error", msg);
      setControl("idle");
    },
    onSettled: () => { resumable.refetch(); snapshotList.refetch(); lastFailed.refetch(); },
  });





  const totalCombos = combos.length;
  const isRunning = control === "running" || control === "paused" || control === "stopping";
  useKeepAlive(isRunning);
  const percent = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  const resumableRow = resumable.data?.row ?? null;
  const showResumeBanner = !isRunning && resumableRow != null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    && Number(((resumableRow.progress ?? {}) as any).completed ?? 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
       < Number(((resumableRow.progress ?? {}) as any).total ?? 0);

  async function handlePause() {
    setControl("paused");
    if (runId) {
      await updateFn({
        data: { runId, progress: { ...progress, currentCombo: null, currentStage: null } },
      }).catch(() => {});
      await finishFn({ data: { runId, status: "paused", progress } }).catch(() => {});
    }
  }
  function handleResumePlayback() {
    setControl("running");
  }
  function handleStop() {
    setControl("stopping");
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-16 z-20 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
              <PlayCircle className="w-4 h-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Automation</div>
              <h1 className="font-display text-sm font-semibold tracking-tight truncate">One-Click Pipeline</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="uppercase text-[9px] tracking-widest font-mono">Mode: {mode}</Badge>
            <Badge variant="outline" className="uppercase text-[9px] tracking-widest">Data → Strategy → Execution → Intelligence</Badge>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-6">
        {showResumeBanner && resumableRow && (
          <Alert>
            <RefreshCw className="h-4 w-4" />
            <AlertTitle className="flex items-center gap-2">
              Resume previous run
              <Badge variant="outline" className="text-[9px] font-mono">{(resumableRow.id as string).slice(0, 8)}</Badge>
              <Badge variant="secondary" className="text-[9px] uppercase">{String(resumableRow.status)}</Badge>
            </AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3 mt-2">
              <span className="text-xs text-muted-foreground">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {Number(((resumableRow.progress ?? {}) as any).completed ?? 0)}
                {" / "}
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {Number(((resumableRow.progress ?? {}) as any).total ?? 0)} combos completed
              </span>
              <Button size="sm" onClick={() => resumeMut.mutate()} disabled={resumeMut.isPending || restartMut.isPending}>
                {resumeMut.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
                Resume last run
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => restartMut.mutate()}
                disabled={resumeMut.isPending || restartMut.isPending || reRecordMut.isPending}
                title="Reset progress and rerun every combo from the beginning (use this if live trades were cleared while paused)."
              >
                {restartMut.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                Restart from beginning
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => reRecordMut.mutate()}
                disabled={resumeMut.isPending || restartMut.isPending || reRecordMut.isPending}
                title="Re-run every completed combo to restore trades missing from the live table. Safe — upserts dedupe by trade_id."
              >
                {reRecordMut.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                Re-record completed combos
              </Button>
              {reRecordState && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  re-recorded {reRecordState.done}/{reRecordState.total} · +{reRecordState.inserted.toLocaleString()} trades
                </span>
              )}

            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Global settings</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Source</Label>
              <Select value={source} onValueChange={(v) => setSource(v as "yahoo" | "shark")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="shark">SharkExchange</SelectItem>
                  <SelectItem value="yahoo">Yahoo Finance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Display TZ</Label>
              <Select value={displayTz} onValueChange={(v) => setDisplayTz(v as Timezone)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Strategy TZ</Label>
              <div className="text-[11px] font-mono text-muted-foreground px-2 py-1.5 rounded border border-dashed border-border/60">
                Moved to matrix ({stratTzs.length} selected)
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Lookback (days)</Label>
              <Input type="number" min={1} max={2000} value={lookbackDays}
                onChange={(e) => setLookbackDays(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Risk per trade (USD)</Label>
              <Input type="number" min={1} step={1} value={riskUsd}
                onChange={(e) => setRiskUsd(Math.max(1, Number(e.target.value) || 1))} />
              <span className="text-[10px] text-muted-foreground">
                Every trade sizes so |entry − SL| × units = ${riskUsd}. Targets untouched.
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">On error</Label>
              <Select value={failFast ? "fail" : "continue"} onValueChange={(v) => setFailFast(v === "fail")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fail">Stop on first failure</SelectItem>
                  <SelectItem value="continue">Continue on failure</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Batch size</Label>
              <Input type="number" min={1} max={48} value={batchSize} disabled={isRunning}
                onChange={(e) => setBatchSize(Math.min(48, Math.max(1, Number(e.target.value) || 1)))} />
              <span className="text-[10px] text-muted-foreground">
                Combos per data-slice request. Higher = fewer round-trips.
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Parallel batches (ceiling)
                {adaptive && isRunning && (
                  <span className="ml-2 text-primary normal-case">now: {effectiveParallelism}</span>
                )}
              </Label>
              <Input type="number" min={1} max={12} value={parallelism} disabled={isRunning}
                onChange={(e) => setParallelism(Math.min(12, Math.max(1, Number(e.target.value) || 1)))} />
              <span className="text-[10px] text-muted-foreground">
                Max concurrent slice batches. Adaptive limiter throttles down on slow batches or errors.
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Adaptive concurrency</Label>
              <Select value={adaptive ? "on" : "off"} onValueChange={(v) => setAdaptive(v === "on")} disabled={isRunning}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="on">On — auto back-off on slow DB / errors</SelectItem>
                  <SelectItem value="off">Off — always use ceiling</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-[10px] text-muted-foreground">
                Starts conservative (3), grows on healthy streaks, halves after repeated errors.
              </span>
            </div>

          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono tracking-widest flex items-center gap-2">
              Dataset
              <Badge variant="outline" className="text-[9px] uppercase">
                {datasetMode === "new" ? "New" : "Append"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Target</Label>
              <Select value={datasetMode} onValueChange={(v) => setDatasetMode(v as "new" | "append")} disabled={isRunning}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Create new dataset</SelectItem>
                  <SelectItem value="append">Append to existing</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-[10px] text-muted-foreground">
                Trades upsert by trade_id — safe to re-run into the same dataset.
              </span>
            </div>

            {datasetMode === "new" ? (
              <div className="flex flex-col gap-1 md:col-span-2">
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">New dataset name</Label>
                <div className="flex gap-2">
                  <Input
                    value={newDatasetName}
                    onChange={(e) => setNewDatasetName(e.target.value)}
                    disabled={isRunning}
                    placeholder="pipeline-YYYY-MM-DD_HH-mm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isRunning}
                    onClick={() => setNewDatasetName(defaultDatasetName())}
                    title="Regenerate timestamped name"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  Timestamped by default. Rename later from Quantitative Research.
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-1 md:col-span-2">
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Append into</Label>
                <Select value={appendTo} onValueChange={setAppendTo} disabled={isRunning}>
                  <SelectTrigger><SelectValue placeholder="Pick existing dataset…" /></SelectTrigger>
                  <SelectContent>
                    {(snapshotList.data?.snapshots ?? []).length === 0 && (
                      <SelectItem value="__none__" disabled>No datasets yet — run a new one first</SelectItem>
                    )}
                    {(snapshotList.data?.snapshots ?? []).map((s) => (
                      <SelectItem key={s.name} value={s.name}>
                        {s.name} ({s.count.toLocaleString()})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[10px] text-muted-foreground">
                  New combos add to this dataset; existing rows update in place.
                </span>
              </div>
            )}

            {previewTarget && (
              <div className="md:col-span-3 rounded-md border border-border/60 bg-muted/20 p-3 mt-1">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <Info className="h-3.5 w-3.5 text-primary" />
                    Preview · <span className="font-mono">{previewTarget}</span>
                    {previewQ.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px] text-destructive hover:text-destructive"
                    disabled={isRunning || deletingSnap}
                    onClick={async () => {
                      if (!window.confirm(`Delete dataset "${previewTarget}"? This permanently removes all its archived trades.`)) return;
                      setDeletingSnap(true);
                      try {
                        const res = await deleteSnapFn({ data: { name: previewTarget } });
                        if (datasetMode === "append") setAppendTo("");
                        await snapshotList.refetch();
                        window.alert(`Deleted ${res.deleted.toLocaleString()} rows from "${previewTarget}".`);
                      } catch (e) {
                        window.alert((e as Error).message || "Delete failed");
                      } finally {
                        setDeletingSnap(false);
                      }
                    }}
                  >
                    {deletingSnap ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3 mr-1" />}
                    Delete
                  </Button>
                </div>
                {previewQ.data ? (
                  <div className="grid gap-2 md:grid-cols-3 text-[11px]">
                    <div>
                      <div className="text-muted-foreground uppercase tracking-widest text-[9px]">Rows</div>
                      <div className="font-mono">{previewQ.data.count.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground uppercase tracking-widest text-[9px]">Last updated</div>
                      <div className="font-mono">{previewQ.data.lastUpdated ? new Date(previewQ.data.lastUpdated).toLocaleString() : "—"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground uppercase tracking-widest text-[9px]">Last trade exit</div>
                      <div className="font-mono">{previewQ.data.lastExitTime ? new Date(previewQ.data.lastExitTime).toLocaleString() : "—"}</div>
                    </div>
                    <div className="md:col-span-3 flex flex-wrap gap-1">
                      {previewQ.data.symbols.map((s) => <Badge key={`sy-${s}`} variant="secondary" className="text-[9px]">{s}</Badge>)}
                      {previewQ.data.timeframes.map((t) => <Badge key={`tf-${t}`} variant="outline" className="text-[9px]">{t}</Badge>)}
                      {previewQ.data.strategies.map((s) => <Badge key={`st-${s}`} variant="outline" className="text-[9px]">{s}</Badge>)}
                    </div>
                    <div className="md:col-span-3 text-[10px] text-muted-foreground">
                      Sampled from the 500 most recently updated rows. Row count is exact.
                    </div>
                  </div>
                ) : previewQ.error ? (
                  <div className="text-[11px] text-destructive">{(previewQ.error as Error).message}</div>
                ) : (
                  <div className="text-[11px] text-muted-foreground">Loading preview…</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>



        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono tracking-widest flex items-center gap-2">
              Matrix
              <Badge variant="outline" className="text-[9px]">
                {symbols.length} × {tfs.length} × {strats.length} × {execs.length} × {stratTzs.length} = {totalCombos} combos
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <MatrixGroup title="Symbols"
              options={ALL_SYMBOLS.map((v) => ({ value: v }))}
              selected={symbols} onChange={setSymbols} />
            <MatrixGroup title="Timeframes"
              options={PIPELINE_TFS.map((v) => ({ value: v }))}
              selected={tfs} onChange={setTfs} />
            <MatrixGroup title="Strategy TZ"
              options={TIMEZONES.map((v) => ({ value: v }))}
              selected={stratTzs} onChange={setStratTzs} />
            <MatrixGroup title="Strategy presets"

              options={ALL_STRATEGY_PRESETS.map((v) => ({ value: v, label: STRATEGY_PRESETS[v as keyof typeof STRATEGY_PRESETS]?.strategyName ?? v }))}
              selected={strats} onChange={setStrats} />
            <MatrixGroup title="Execution presets"
              options={ALL_EXEC_PRESETS.map((v) => ({ value: v, label: v.replace(/_/g, " ") }))}
              selected={execs} onChange={setExecs} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              {control === "idle" && (
                <Button
                  size="lg"
                  disabled={totalCombos === 0}
                  onClick={() => runMut.mutate()}
                  className="min-w-56"
                >
                  <PlayCircle className="w-4 h-4 mr-2" />Run pipeline ({totalCombos} combos)
                </Button>
              )}
              {control === "running" && (
                <>
                  <Button size="lg" disabled className="min-w-56">
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Running {progress.completed}/{progress.total}
                  </Button>
                  <Button variant="secondary" onClick={handlePause}>
                    <Pause className="w-4 h-4 mr-2" />Pause
                  </Button>
                  <Button variant="ghost" onClick={handleStop}>
                    <Square className="w-4 h-4 mr-2" />Stop
                  </Button>
                </>
              )}
              {control === "paused" && (
                <>
                  <Button size="lg" onClick={handleResumePlayback} className="min-w-56">
                    <Play className="w-4 h-4 mr-2" />Resume ({progress.completed}/{progress.total})
                  </Button>
                  <Button variant="ghost" onClick={handleStop}>
                    <Square className="w-4 h-4 mr-2" />Stop
                  </Button>
                </>
              )}
              {control === "stopping" && (
                <Button size="lg" disabled className="min-w-56">
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />Stopping…
                </Button>
              )}
              {!isRunning && (progress.failed > 0 || (lastFailed.data?.failedCombos.length ?? 0) > 0) && (() => {
                const localCount = progress.failed;
                const dbCount = lastFailed.data?.failedCombos.length ?? 0;
                const count = localCount > 0 ? localCount : dbCount;
                const snapLabel = activeSnapshotRef.current
                  || lastFailed.data?.snapshotName
                  || (datasetMode === "append" ? appendTo : newDatasetName)
                  || "current dataset";
                return (
                  <Button
                    variant="secondary"
                    onClick={() => retryFailedMut.mutate()}
                    disabled={retryFailedMut.isPending}
                    title={`Re-run ${count} failed combos into "${snapLabel}"`}
                  >
                    {retryFailedMut.isPending
                      ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      : <RefreshCw className="w-4 h-4 mr-2" />}
                    Retry {count} failed{localCount === 0 ? " (from last run)" : ""}
                  </Button>
                );
              })()}

              {!isRunning && results.length > 0 && (
                <Button variant="ghost" onClick={() => {
                  setResults([]);
                  setProgress({ total: 0, completed: 0, currentCombo: null, currentStage: null, ok: 0, failed: 0, totalTrades: 0, totalInserted: 0 });
                  setRunId(null);
                }}>
                  <RefreshCw className="w-4 h-4 mr-2" />Clear
                </Button>
              )}

              {runId && <Badge variant="outline" className="text-[10px] font-mono">run {runId.slice(0, 8)}</Badge>}
              <div className="ml-auto flex flex-wrap items-center gap-3 text-xs font-mono">
                <span className="text-emerald-500">✓ {progress.ok}</span>
                <span className="text-rose-500">✗ {progress.failed}</span>
                <span className="text-muted-foreground">trades {progress.totalTrades.toLocaleString()}</span>
                <span className="text-muted-foreground">inserted {progress.totalInserted.toLocaleString()}</span>
              </div>
            </div>

            {(isRunning || progress.total > 0) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  <span>
                    {control === "paused" ? "Paused" : control === "stopping" ? "Stopping" : control === "running" ? "In progress" : "Complete"}
                    {progress.currentCombo && control === "running" && (
                      <span className="ml-2 text-foreground/80 normal-case">
                        {progress.currentCombo.symbol} · {progress.currentCombo.timeframe} · {progress.currentCombo.strategyPresetId} / {progress.currentCombo.execPresetId} · tz:{progress.currentCombo.strategyTimezone ?? "—"}
                        {progress.currentStage && <span className="ml-1 text-primary">[{progress.currentStage}]</span>}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-3">
                    {isRunning && etaMs > 0 && <span className="normal-case text-foreground/80">ETA {fmtDuration(etaMs)}</span>}
                    {runElapsedMs > 0 && <span className="normal-case">elapsed {fmtDuration(runElapsedMs)}</span>}
                    {isRunning && adaptive && <span className="normal-case text-primary">×{effectiveParallelism}</span>}
                    <span>{percent}%</span>
                  </span>
                </div>
                <Progress value={percent} className={control === "running" ? "animate-pulse" : ""} />

                {sliceStats.length > 0 && (
                  <div className="mt-3 border-t border-border/40 pt-3">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                      <span>Per-slice progress ({sliceStats.filter((s) => s.status === "ok").length}/{sliceStats.length} done)</span>
                      <span>slice = symbol · timeframe · strategy TZ</span>
                    </div>
                    <div className="max-h-72 overflow-y-auto pr-1 space-y-1.5">
                      {sliceStats.map((s) => {
                        const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
                        const label = `${s.symbol} · ${s.timeframe} · ${s.strategyTimezone ?? "London"}`;
                        const color =
                          s.status === "ok" ? "text-emerald-500" :
                          s.status === "failed" ? "text-rose-500" :
                          s.status === "running" ? "text-primary" :
                          "text-muted-foreground";
                        return (
                          <div key={s.key} className="grid grid-cols-[minmax(160px,1fr)_60px_1fr_60px] items-center gap-2 text-[10px] font-mono">
                            <span className={`truncate ${color}`}>{label}</span>
                            <span className="text-muted-foreground">{s.done}/{s.total}</span>
                            <Progress value={pct} />
                            <span className="text-right text-muted-foreground">
                              {s.status === "ok" ? "✓" : s.status === "failed" ? `✗ ${s.failed}` : s.elapsedMs > 0 ? `${(s.elapsedMs / 1000).toFixed(0)}s` : "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

          </CardContent>
        </Card>

        {results.length > 0 && <RunLog results={results} progress={progress} riskUsd={riskUsd} />}
      </main>
    </div>
  );
}
