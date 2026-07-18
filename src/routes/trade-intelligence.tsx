// Trade Intelligence — browser UI.
// Record trades from a strategy+execution run, query the store, export.
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  recordTradesFromExecution, queryTrades, exportTrades,
  deleteTrade, clearStrategy, summariseTrades, listSnapshots, dedupeTrades,
} from "@/lib/trade-intelligence.functions";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";
import { EXEC_PRESETS } from "@/lib/execution-engine/presets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Download, Database, Layers } from "lucide-react";
import { MatrixGroup } from "@/components/matrix-picker";
import { useDataset } from "@/hooks/use-dataset";

const BATCH_TFS = ["1m", "3m", "5m", "15m", "30m", "1h"] as const;
const BATCH_SYMBOLS = ["XAUUSDT", "BTCUSDT"] as const;
const BATCH_SOURCES = ["yahoo", "shark"] as const;
const BATCH_TZS = ["UTC", "IST", "New_York", "London", "Tokyo", "Sydney"] as const;
type BatchRow = {
  source: string;
  symbol: string;
  presetId: string;
  execId: string;
  tf: string;
  stratTz: string;
  displayTz: string;
  inserted?: number;
  tradesInRun?: number;
  error?: string;
};

const STORAGE_KEY = "trade-intel-matrix-progress-v1";
type ComboKey = { source: string; symbol: string; presetId: string; execId: string; tf: string; stratTz: string; displayTz: string };
type Persisted = {
  combos: ComboKey[];
  done: number;
  rows: BatchRow[];
  days: number;
  tags: string;
};

export const Route = createFileRoute("/trade-intelligence")({
  component: TradeIntelligencePage,
  head: () => ({
    meta: [
      { title: "Trade Intelligence Database — Shark" },
      { name: "description", content: "Permanent, queryable database of every completed trade with rich research metadata." },
    ],
  }),
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6 space-y-3">
        <div className="text-sm text-destructive">{String(error)}</div>
        <Button onClick={() => { router.invalidate(); reset(); }}>Retry</Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6">Not found.</div>,
});

const strategyIds = Object.keys(STRATEGY_PRESETS);
const execIds = Object.keys(EXEC_PRESETS);

function TradeIntelligencePage() {
  const qc = useQueryClient();
  const record = useServerFn(recordTradesFromExecution);
  const query = useServerFn(queryTrades);
  const exportFn = useServerFn(exportTrades);
  const del = useServerFn(deleteTrade);
  const clear = useServerFn(clearStrategy);
  const summary = useServerFn(summariseTrades);
  const snapshots = useServerFn(listSnapshots);
  const dedupe = useServerFn(dedupeTrades);
  const [dedupeResult, setDedupeResult] = useState<{ scanned: number; duplicateGroups: number; deleted: number } | null>(null);
  const dedupeMut = useMutation({
    mutationFn: async () => dedupe({ data: { dataset: "live" } }),
    onSuccess: (r) => {
      setDedupeResult(r);
      qc.invalidateQueries({ queryKey: ["trade-intel"] });
    },
  });

  // "live" = current writable trade_intelligence table (still being appended
  // to by any running pipeline). Anything else = an archived snapshot label.
  // Shared with /research via useDataset (localStorage-backed).
  const [dataset, setDataset] = useDataset();

  const [form, setForm] = useState({
    strategyPresetId: strategyIds[0] ?? "",
    execPresetId: execIds[0] ?? "",
    symbol: "XAUUSDT",
    timeframe: "15m",
    days: 200,
    source: "shark" as "yahoo" | "shark",
    tags: "",
  });

  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [mxSources, setMxSources] = useState<string[]>([...BATCH_SOURCES]);
  const [mxSymbols, setMxSymbols] = useState<string[]>([...BATCH_SYMBOLS]);
  const [mxTfs, setMxTfs] = useState<string[]>([...BATCH_TFS]);
  const [mxStrategies, setMxStrategies] = useState<string[]>(strategyIds);
  const [mxExecs, setMxExecs] = useState<string[]>(execIds);
  const [mxStratTzs, setMxStratTzs] = useState<string[]>(["London"]);
  const [mxDisplayTzs, setMxDisplayTzs] = useState<string[]>(["IST"]);

  const abortRef = useRef(false);
  const [resumable, setResumable] = useState<Persisted | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Persisted;
      if (p && Array.isArray(p.combos) && p.combos.length > 0) {
        setBatchRows(p.rows ?? []);
        setBatchProgress({ done: p.done ?? 0, total: p.combos.length });
        if ((p.done ?? 0) < p.combos.length) setResumable(p);
      }
    } catch { /* ignore */ }
  }, []);

  const saveProgress = (p: Persisted) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* quota */ }
  };
  const clearProgress = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setResumable(null);
    setBatchRows([]);
    setBatchProgress({ done: 0, total: 0 });
  };

  const [filter, setFilter] = useState({
    strategyId: "",
    direction: "" as "" | "long" | "short",
    session: "",
    winnersOnly: false,
    losersOnly: false,
    orderBy: "entry_time" as "entry_time" | "exit_time" | "net_pnl" | "actual_rr",
    order: "desc" as "asc" | "desc",
    limit: 100,
  });

  const spec = useMemo(() => ({
    strategyId: filter.strategyId || undefined,
    direction: filter.direction || undefined,
    session: filter.session || undefined,
    winnersOnly: filter.winnersOnly || undefined,
    losersOnly: filter.losersOnly || undefined,
    orderBy: filter.orderBy,
    order: filter.order,
    limit: filter.limit,
    offset: 0,
    dataset,
  }), [filter, dataset]);

  const trades = useQuery({
    queryKey: ["trade-intel", "query", spec],
    queryFn: () => query({ data: spec }),
  });
  const stats = useQuery({
    queryKey: ["trade-intel", "summary", dataset],
    queryFn: () => summary({ data: { dataset } }),
  });
  const snapshotList = useQuery({
    queryKey: ["trade-intel", "snapshots"],
    queryFn: () => snapshots(),
    staleTime: 60_000,
  });

  const recordMut = useMutation({
    mutationFn: async () => {
      const to = Date.now();
      const from = to - form.days * 24 * 60 * 60 * 1000;
      return record({
        data: {
          source: form.source, symbol: form.symbol,
          timeframe: form.timeframe as "15m",
          displayTimezone: "IST", strategyTimezone: "London",
          fromMs: from, toMs: to,
          strategyPresetId: form.strategyPresetId,
          execPresetId: form.execPresetId,
          tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trade-intel"] });
    },
  });

  const runCombos = async (combos: ComboKey[], seedRows: BatchRow[], seedDone: number, days: number, tags: string) => {
    abortRef.current = false;
    const to = Date.now();
    const from = to - days * 24 * 60 * 60 * 1000;
    const rows: BatchRow[] = [...seedRows];
    setBatchRows(rows);
    setBatchProgress({ done: seedDone, total: combos.length });
    saveProgress({ combos, done: seedDone, rows, days, tags });

    const runOne = async (combo: ComboKey) => {
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (abortRef.current) throw new Error("aborted");
        try {
          return await record({
            data: {
              source: combo.source as "yahoo" | "shark", symbol: combo.symbol,
              timeframe: combo.tf as "15m",
              displayTimezone: combo.displayTz as "IST", strategyTimezone: combo.stratTz as "London",
              fromMs: from, toMs: to,
              strategyPresetId: combo.presetId,
              execPresetId: combo.execId,
              tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
            },
          });
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 750 * (attempt + 1) * (attempt + 1)));
        }
      }
      throw lastErr;
    };

    for (let i = seedDone; i < combos.length; i++) {
      if (abortRef.current) break;
      const combo = combos[i];
      try {
        const res = await runOne(combo);
        rows.push({ ...combo, inserted: res.inserted, tradesInRun: res.tradesInRun });
      } catch (e) {
        rows.push({ ...combo, error: e instanceof Error ? e.message : String(e) });
      }
      setBatchRows([...rows]);
      const done = i + 1;
      setBatchProgress({ done, total: combos.length });
      saveProgress({ combos, done, rows, days, tags });
      await new Promise((r) => setTimeout(r, 150));
    }
    setResumable(null);
    return rows;
  };

  const batchMut = useMutation({
    mutationFn: async () => {
      const combos: ComboKey[] = [];
      for (const source of mxSources)
        for (const symbol of mxSymbols)
          for (const presetId of mxStrategies)
            for (const execId of mxExecs)
              for (const tf of mxTfs)
                for (const stratTz of mxStratTzs)
                  for (const displayTz of mxDisplayTzs)
                    combos.push({ source, symbol, presetId, execId, tf, stratTz, displayTz });
      return runCombos(combos, [], 0, form.days, form.tags);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trade-intel"] }); },
  });

  const resumeMut = useMutation({
    mutationFn: async () => {
      if (!resumable) return [];
      return runCombos(resumable.combos, resumable.rows, resumable.done, resumable.days, resumable.tags);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trade-intel"] }); },
  });


  const doExport = async (format: "json" | "csv") => {
    const out = await exportFn({ data: { ...spec, format } });
    const blob = new Blob([out.body], { type: out.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = out.filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <header className="flex flex-wrap items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <Database className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-2xl font-semibold tracking-tight">Trade Intelligence Database</h1>
          <p className="text-sm text-muted-foreground">
            Permanent, queryable store of every completed trade with full market context.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <Label className="text-xs uppercase text-muted-foreground">Dataset</Label>
          <Select value={dataset} onValueChange={setDataset}>
            <SelectTrigger className="w-full sm:w-[260px]"><SelectValue /></SelectTrigger>

            <SelectContent>
              <SelectItem value="live">Live (current, appended by pipeline)</SelectItem>
              {(snapshotList.data?.snapshots ?? []).map((s) => (
                <SelectItem key={s.name} value={s.name}>
                  Snapshot · {s.name} ({s.count.toLocaleString()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {dataset !== "live" ? <Badge variant="secondary">read-only</Badge> : null}
          {dataset === "live" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setDedupeResult(null); dedupeMut.mutate(); }}
              disabled={dedupeMut.isPending}
              title="Remove exact-duplicate trades (same strategy, symbol, timeframe, direction, entry/exit time & PnL)"
            >
              {dedupeMut.isPending ? "Deduping…" : "Remove duplicates"}
            </Button>
          ) : null}
          {dedupeResult ? (
            <span className="text-xs text-muted-foreground">
              scanned {dedupeResult.scanned.toLocaleString()} · {dedupeResult.duplicateGroups} groups · removed {dedupeResult.deleted}
            </span>
          ) : null}
          {dedupeMut.isError ? (
            <span className="text-xs text-destructive">{String(dedupeMut.error)}</span>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardHeader><CardTitle className="text-xs uppercase text-muted-foreground">Total trades</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.data?.total ?? "—"}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-xs uppercase text-muted-foreground">Winners / Losers</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">
            {stats.data ? `${stats.data.winners} / ${stats.data.losers}` : "—"}
          </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-xs uppercase text-muted-foreground">Net PnL</CardTitle></CardHeader>
          <CardContent className={`text-2xl font-semibold ${(stats.data?.netPnl ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
            {stats.data ? stats.data.netPnl.toFixed(2) : "—"}
          </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-xs uppercase text-muted-foreground">Strategies / Symbols</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">
            {stats.data ? `${stats.data.strategies.length} / ${stats.data.symbols.length}` : "—"}
          </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Record trades from a run</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-6">
          <div className="space-y-1"><Label>Strategy preset</Label>
            <Select value={form.strategyPresetId} onValueChange={(v) => setForm((f) => ({ ...f, strategyPresetId: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{strategyIds.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Execution preset</Label>
            <Select value={form.execPresetId} onValueChange={(v) => setForm((f) => ({ ...f, execPresetId: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{execIds.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Symbol</Label>
            <Select value={form.symbol} onValueChange={(v) => setForm((f) => ({ ...f, symbol: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="XAUUSDT">XAUUSDT</SelectItem>
                <SelectItem value="BTCUSDT">BTCUSDT</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Timeframe</Label>
            <Input value={form.timeframe} onChange={(e) => setForm((f) => ({ ...f, timeframe: e.target.value }))} />
          </div>
          <div className="space-y-1"><Label>Days back</Label>
            <Input type="number" min={1} max={1000} value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: Number(e.target.value) }))} />
          </div>
          <div className="space-y-1"><Label>Source</Label>
            <Select value={form.source} onValueChange={(v) => setForm((f) => ({ ...f, source: v as "yahoo" | "shark" }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yahoo">Yahoo</SelectItem>
                <SelectItem value="shark">SharkExchange</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Tags (csv)</Label>
            <Input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="research,london" />
          </div>
          <div className="md:col-span-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <MatrixGroup title="Sources"
              options={BATCH_SOURCES.map((v) => ({ value: v }))}
              selected={mxSources} onChange={setMxSources} />
            <MatrixGroup title="Symbols"
              options={BATCH_SYMBOLS.map((v) => ({ value: v }))}
              selected={mxSymbols} onChange={setMxSymbols} />
            <MatrixGroup title="Timeframes"
              options={BATCH_TFS.map((v) => ({ value: v }))}
              selected={mxTfs} onChange={setMxTfs} />
            <MatrixGroup title="Strategies"
              options={strategyIds.map((v) => ({ value: v, label: STRATEGY_PRESETS[v as keyof typeof STRATEGY_PRESETS]?.strategyName ?? v }))}
              selected={mxStrategies} onChange={setMxStrategies} />
            <MatrixGroup title="Execution presets"
              options={execIds.map((v) => ({ value: v, label: v.replace(/_/g, " ") }))}
              selected={mxExecs} onChange={setMxExecs} />
            <MatrixGroup title="Strategy TZ"
              options={BATCH_TZS.map((v) => ({ value: v }))}
              selected={mxStratTzs} onChange={setMxStratTzs} />
            <MatrixGroup title="Display TZ"
              options={BATCH_TZS.map((v) => ({ value: v }))}
              selected={mxDisplayTzs} onChange={setMxDisplayTzs} />
          </div>
          <div className="md:col-span-6 flex flex-col md:flex-row items-start md:items-center gap-3">
            <Button onClick={() => recordMut.mutate()} disabled={recordMut.isPending || batchMut.isPending}>
              {recordMut.isPending ? "Recording…" : "Run & record"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => batchMut.mutate()}
              disabled={recordMut.isPending || batchMut.isPending || mxSources.length === 0 || mxSymbols.length === 0 || mxTfs.length === 0 || mxStrategies.length === 0 || mxExecs.length === 0 || mxStratTzs.length === 0 || mxDisplayTzs.length === 0}
            >
              <Layers className="h-4 w-4 mr-1" />
              {batchMut.isPending
                ? `Recording matrix ${batchProgress.done}/${batchProgress.total}…`
                : `Record Matrix (${mxSources.length}×${mxSymbols.length}×${mxStrategies.length}×${mxExecs.length}×${mxTfs.length}×${mxStratTzs.length}×${mxDisplayTzs.length} = ${mxSources.length * mxSymbols.length * mxStrategies.length * mxExecs.length * mxTfs.length * mxStratTzs.length * mxDisplayTzs.length})`}
            </Button>
            {resumable && !batchMut.isPending && !resumeMut.isPending ? (
              <Button variant="outline" onClick={() => resumeMut.mutate()}>
                Resume ({resumable.done}/{resumable.combos.length})
              </Button>
            ) : null}
            {resumeMut.isPending ? (
              <Badge variant="secondary" className="text-[10px]">Resuming {batchProgress.done}/{batchProgress.total}…</Badge>
            ) : null}
            {(batchMut.isPending || resumeMut.isPending) ? (
              <Button variant="destructive" size="sm" onClick={() => { abortRef.current = true; }}>Stop</Button>
            ) : null}
            {batchRows.length > 0 && !batchMut.isPending && !resumeMut.isPending ? (
              <Button variant="ghost" size="sm" onClick={clearProgress}>Clear</Button>
            ) : null}
            {recordMut.data ? (
              <span className="text-sm text-muted-foreground">
                Inserted {recordMut.data.inserted} of {recordMut.data.tradesInRun} trades.
              </span>
            ) : null}
            {recordMut.error ? <span className="text-sm text-destructive">{String(recordMut.error)}</span> : null}
          </div>
        </CardContent>
      </Card>

      {batchRows.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Matrix results</CardTitle></CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Strategy</TableHead>
                    <TableHead>Exec</TableHead>
                    <TableHead>TF</TableHead>
                    <TableHead>Strat TZ</TableHead>
                    <TableHead>Disp TZ</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">Inserted</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batchRows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{r.source}</TableCell>
                      <TableCell className="text-xs">{r.symbol}</TableCell>
                      <TableCell className="text-xs">{r.presetId}</TableCell>
                      <TableCell className="text-xs">{r.execId}</TableCell>
                      <TableCell className="text-xs">{r.tf}</TableCell>
                      <TableCell className="text-xs">{r.stratTz}</TableCell>
                      <TableCell className="text-xs">{r.displayTz}</TableCell>
                      <TableCell className="text-right text-xs">{r.tradesInRun ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs">{r.inserted ?? "—"}</TableCell>
                      <TableCell>
                        {r.error
                          ? <Badge variant="destructive" className="text-[10px]">{r.error.slice(0, 40)}</Badge>
                          : <Badge className="text-[10px] bg-emerald-600">ok</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle>Query</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => doExport("csv")}><Download className="h-4 w-4 mr-1" />CSV</Button>
            <Button variant="outline" size="sm" onClick={() => doExport("json")}><Download className="h-4 w-4 mr-1" />JSON</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-6">
            <div className="space-y-1"><Label>Strategy</Label>
              <Input value={filter.strategyId} onChange={(e) => setFilter((f) => ({ ...f, strategyId: e.target.value }))} placeholder="any" />
            </div>
            <div className="space-y-1"><Label>Direction</Label>
              <Select value={filter.direction || "any"} onValueChange={(v) => setFilter((f) => ({ ...f, direction: v === "any" ? "" : v as "long" | "short" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="long">Long</SelectItem>
                  <SelectItem value="short">Short</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Session</Label>
              <Input value={filter.session} onChange={(e) => setFilter((f) => ({ ...f, session: e.target.value }))} placeholder="london / asian / …" />
            </div>
            <div className="space-y-1"><Label>Winners</Label>
              <Select value={filter.winnersOnly ? "yes" : filter.losersOnly ? "loss" : "any"}
                      onValueChange={(v) => setFilter((f) => ({ ...f, winnersOnly: v === "yes", losersOnly: v === "loss" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">All</SelectItem>
                  <SelectItem value="yes">Winners only</SelectItem>
                  <SelectItem value="loss">Losers only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Order by</Label>
              <Select value={filter.orderBy} onValueChange={(v) => setFilter((f) => ({ ...f, orderBy: v as typeof filter.orderBy }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="entry_time">Entry time</SelectItem>
                  <SelectItem value="exit_time">Exit time</SelectItem>
                  <SelectItem value="net_pnl">Net PnL</SelectItem>
                  <SelectItem value="actual_rr">R multiple</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Limit</Label>
              <Input type="number" min={1} max={20000} value={filter.limit} onChange={(e) => setFilter((f) => ({ ...f, limit: Math.min(20000, Math.max(1, Number(e.target.value) || 1)) }))} />
              <p className="text-[10px] text-muted-foreground">Max 10,000</p>
            </div>
          </div>
          <Separator />
          <div className="text-xs text-muted-foreground">
            Showing {trades.data?.rows.length ?? 0} of {trades.data?.total ?? 0}
          </div>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entry</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Dir</TableHead>
                  <TableHead>Session</TableHead>
                  <TableHead className="text-right">Entry</TableHead>
                  <TableHead className="text-right">Exit</TableHead>
                  <TableHead className="text-right">Net PnL</TableHead>
                  <TableHead className="text-right">R</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(trades.data?.rows ?? []).map((t) => (
                  <TableRow key={t.tradeId}>
                    <TableCell className="whitespace-nowrap text-xs">{new Date(t.entryTime).toISOString().slice(0, 16).replace("T", " ")}</TableCell>
                    <TableCell className="text-xs">{t.strategyId}</TableCell>
                    <TableCell className="text-xs">{t.symbol}</TableCell>
                    <TableCell><Badge variant={t.direction === "long" ? "default" : "secondary"}>{t.direction}</Badge></TableCell>
                    <TableCell className="text-xs">{t.session}</TableCell>
                    <TableCell className="text-right text-xs">{t.fillPrice?.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-xs">{t.exitPrice.toFixed(2)}</TableCell>
                    <TableCell className={`text-right text-xs ${t.netPnl >= 0 ? "text-green-600" : "text-red-600"}`}>{t.netPnl.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-xs">{t.actualRr?.toFixed(2) ?? "—"}</TableCell>
                    <TableCell className="text-xs">{t.exitReason}</TableCell>
                    <TableCell className="text-xs">{t.tags.join(", ")}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={async () => { await del({ data: { tradeId: t.tradeId } }); qc.invalidateQueries({ queryKey: ["trade-intel"] }); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {filter.strategyId ? (
            <div className="flex items-center justify-end">
              <Button
                variant="destructive" size="sm"
                onClick={async () => {
                  if (!confirm(`Delete ALL trades for ${filter.strategyId}?`)) return;
                  await clear({ data: { strategyId: filter.strategyId } });
                  qc.invalidateQueries({ queryKey: ["trade-intel"] });
                }}
              >
                Clear "{filter.strategyId}"
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
