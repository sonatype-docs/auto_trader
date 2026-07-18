import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  listLiveRunners, listLiveTrades, setLiveRunnerRunning,
  runLiveTickNow, updateLiveRunner, cancelLiveOrder, testLiveConnection,
  diagnoseLiveRunners, importTopPaperRunnersToLive,
  type LiveRunnerDTO, type LiveTradeDTO, type RunnerDiagnosticsDTO,
} from "@/lib/live-trading.functions";
import { PlayCircle, StopCircle, RefreshCw, AlertTriangle, X, Plug, Clock, Info, Activity, CheckCircle2, XCircle, Search, ChevronDown, MoreVertical, Download } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StrategyPerformanceCard } from "@/components/strategy-performance-card";
import { PnlCalendarCard } from "@/components/pnl-calendar-card";
import { StrategyDetailsDialog } from "@/components/strategy-details-dialog";
import {
  windowsForPreset, isWindowActive, minutesUntilOpen, fmtDuration,
  type IstWindow,
} from "@/lib/session-windows";
import { AllRunnersStatusCard } from "@/components/live-chart-card";
import { ExchangeOrdersCard } from "@/components/exchange-orders-card";
import { TopRunnersVerificationCard } from "@/components/top-runners-verification";
import { useNewTradeToasts } from "@/hooks/use-new-trade-toasts";

export const Route = createFileRoute("/live-trading")({
  head: () => ({
    meta: [
      { title: "Live Trading Bot" },
      { name: "description", content: "Real-money trading bot on SharkExchange." },
    ],
  }),
  component: LiveTradingPage,
});

const fmtTs = (s: string | null) => (s ? new Date(s).toLocaleString() : "—");

function LiveTradingPage() {
  const qc = useQueryClient();
  const runnersFn = useServerFn(listLiveRunners);
  const tradesFn = useServerFn(listLiveTrades);
  const setRun = useServerFn(setLiveRunnerRunning);
  const tickNow = useServerFn(runLiveTickNow);
  const update = useServerFn(updateLiveRunner);
  const cancel = useServerFn(cancelLiveOrder);
  const testConn = useServerFn(testLiveConnection);
  const importTop = useServerFn(importTopPaperRunnersToLive);
  const [connMsg, setConnMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const testMut = useMutation({
    mutationFn: () => testConn(),
    onSuccess: (r) => setConnMsg({ ok: r.ok, text: `[${r.status}] ${r.message}` }),
    onError: (e: unknown) => setConnMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }),
  });
  const importMut = useMutation({
    mutationFn: () => importTop({ data: { topN: 10, leverage: 5 } }),
    onSuccess: (r) => {
      alert(`Imported ${r.imported} runner(s): ${r.inserted} new, ${r.updated} updated. Toggle each ON to start live.`);
      qc.invalidateQueries({ queryKey: ["live-runners"] });
    },
    onError: (e: unknown) => alert(e instanceof Error ? e.message : String(e)),
  });

  const runners = useQuery({
    queryKey: ["live-runners"], queryFn: () => runnersFn(), refetchInterval: 5000,
  });
  const trades = useQuery({
    queryKey: ["live-trades"], queryFn: () => tradesFn({ data: { limit: 500 } }), refetchInterval: 5000,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["live-runners"] });
    qc.invalidateQueries({ queryKey: ["live-trades"] });
  };

  const toggle = useMutation({
    mutationFn: (v: { id: string; running: boolean }) => setRun({ data: v }),
    onSuccess: invalidate,
  });
  const tick = useMutation({ mutationFn: () => tickNow(), onSuccess: invalidate });
  const upd = useMutation({
    mutationFn: (v: { id: string; risk_usd?: number; leverage?: number }) => update({ data: v }),
    onSuccess: invalidate,
  });
  const cx = useMutation({
    mutationFn: (id: string) => cancel({ data: { trade_id: id } }),
    onSuccess: invalidate,
  });

  const runnersList = runners.data ?? [];
  const tradesList = trades.data ?? [];
  useNewTradeToasts(tradesList, "Live");
  const openTrades = tradesList.filter((t) => t.status === "open" || t.status === "pending");


  // Multi-select for bulk start / stop.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Prune ids that no longer exist (e.g. after import/refresh).
  useEffect(() => {
    setSelected((prev) => {
      const known = new Set(runnersList.map((r) => r.id));
      const next = new Set<string>();
      for (const id of prev) if (known.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [runnersList]);
  const toggleSelect = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectAll = () => setSelected(new Set(runnersList.map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());
  const selectedRunners = runnersList.filter((r) => selected.has(r.id));
  const selectedStopped = selectedRunners.filter((r) => !r.running).length;
  const selectedRunning = selectedRunners.filter((r) => r.running).length;

  const bulkStart = useMutation({
    mutationFn: async () => {
      const targets = selectedRunners.filter((r) => !r.running);
      await Promise.all(targets.map((r) => setRun({ data: { id: r.id, running: true } })));
      return targets.length;
    },
    onSuccess: () => { clearSelection(); invalidate(); },
    onError: (e: unknown) => alert(e instanceof Error ? e.message : String(e)),
  });
  const bulkStop = useMutation({
    mutationFn: async () => {
      const targets = selectedRunners.filter((r) => r.running);
      await Promise.all(targets.map((r) => setRun({ data: { id: r.id, running: false } })));
      return targets.length;
    },
    onSuccess: () => { clearSelection(); invalidate(); },
    onError: (e: unknown) => alert(e instanceof Error ? e.message : String(e)),
  });

  
  const [showDiag, setShowDiag] = useState(false);
  const [showRunners, setShowRunners] = useState(false);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <OpenOrdersMiniWidget trades={openTrades} />
      <TickStatusCard runners={runnersList} />
      <Tabs defaultValue="dashboard" className="space-y-6">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="performance">Strategy performance</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="space-y-6">

        <AllRunnersStatusCard />

        <ExchangeOrdersCard />


        <Card>
          <CardHeader>
            <CardTitle>Open live orders ({openTrades.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <OpenTable trades={openTrades} onCancel={(id) => {
              if (confirm("Cancel this live order on the exchange?")) cx.mutate(id);
            }} />
          </CardContent>
        </Card>

        <TopRunnersVerificationCard />






        <CollapsedShell title="Live runners" open={showRunners} onToggle={() => setShowRunners((v) => !v)}>




        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="truncate">Live runners</CardTitle>
            <div className="hidden sm:flex items-center gap-2">
              {connMsg && (
                <span className={`text-xs ${connMsg.ok ? "text-emerald-500" : "text-destructive"} max-w-[280px] truncate`} title={connMsg.text}>
                  {connMsg.ok ? "✓ " : "✗ "}{connMsg.text}
                </span>
              )}
              <Button size="sm" variant="outline" onClick={() => testMut.mutate()} disabled={testMut.isPending}>
                <Plug className={`h-4 w-4 mr-1 ${testMut.isPending ? "animate-pulse" : ""}`} />
                Test connection
              </Button>
              <Button size="sm" variant="outline" onClick={() => importMut.mutate()} disabled={importMut.isPending}>
                <Download className={`h-4 w-4 mr-1 ${importMut.isPending ? "animate-pulse" : ""}`} />
                Import top 10 from Paper
              </Button>
              <Button size="sm" variant="outline" onClick={() => tick.mutate()} disabled={tick.isPending}>
                <RefreshCw className={`h-4 w-4 mr-1 ${tick.isPending ? "animate-spin" : ""}`} />
                Tick now
              </Button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild className="sm:hidden">
                <Button size="icon" variant="outline" className="h-8 w-8 shrink-0"><MoreVertical className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => testMut.mutate()} disabled={testMut.isPending}>
                  <Plug className="h-4 w-4 mr-2" /> Test connection
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => importMut.mutate()} disabled={importMut.isPending}>
                  <Download className="h-4 w-4 mr-2" /> Import top 10 from Paper
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => tick.mutate()} disabled={tick.isPending}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Tick now
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent>
            {connMsg && (
              <div className={`sm:hidden mb-2 text-xs ${connMsg.ok ? "text-emerald-500" : "text-destructive"} truncate`} title={connMsg.text}>
                {connMsg.ok ? "✓ " : "✗ "}{connMsg.text}
              </div>
            )}
            {selected.size > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
                <span className="text-xs font-medium">
                  {selected.size} selected
                  {selectedStopped > 0 && ` · ${selectedStopped} stopped`}
                  {selectedRunning > 0 && ` · ${selectedRunning} running`}
                </span>
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={selectedStopped === 0 || bulkStart.isPending}
                    onClick={() => {
                      if (!confirm(`Start LIVE trading on ${selectedStopped} runner(s)? Real orders will be placed.`)) return;
                      bulkStart.mutate();
                    }}
                  >
                    <PlayCircle className={`h-4 w-4 mr-1 ${bulkStart.isPending ? "animate-pulse" : ""}`} />
                    Start {selectedStopped || ""}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={selectedRunning === 0 || bulkStop.isPending}
                    onClick={() => {
                      if (!confirm(`Stop ${selectedRunning} running runner(s)?`)) return;
                      bulkStop.mutate();
                    }}
                  >
                    <StopCircle className={`h-4 w-4 mr-1 ${bulkStop.isPending ? "animate-pulse" : ""}`} />
                    Stop {selectedRunning || ""}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearSelection}>
                    <X className="h-4 w-4 mr-1" /> Clear
                  </Button>
                </div>
              </div>
            )}
            <RunnersTable
              runners={runnersList}
              selected={selected}
              onSelectToggle={toggleSelect}
              onSelectAll={selectAll}
              onClearSelection={clearSelection}
              onToggle={(r) => {
                if (!r.running && !confirm(`Start LIVE trading for ${r.label}? Real orders will be placed.`)) return;
                toggle.mutate({ id: r.id, running: !r.running });
              }}
              onSave={(v) => upd.mutate(v)}
            />
            <p className="text-xs text-muted-foreground mt-3">
              A background job polls every minute. When the strategy fires an entry, a limit order is sent to SharkExchange
              with the stop &amp; target attached after the symbol slot is free. Exits are detected on the next tick.
            </p>
          </CardContent>
        </Card>
        </CollapsedShell>



        <CollapsedShell title="Why isn't a trade triggering? (diagnostics)" open={showDiag} onToggle={() => setShowDiag((v) => !v)}>
          <DiagnosticsCard />
        </CollapsedShell>
        </TabsContent>
        <TabsContent value="performance">
          <div className="space-y-6">
            <StrategyPerformanceCard defaultMode="live" lockMode showStrategyFilter />
            <PnlCalendarCard defaultMode="live" lockMode showStrategyFilter={false} showToday />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CollapsedShell({ title, open, onToggle, children }: {
  title: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        className="flex flex-row items-center justify-between gap-2 cursor-pointer select-none py-3"
        onClick={onToggle}
      >
        <CardTitle className="text-sm font-medium truncate">{title}</CardTitle>
        <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

function RunnersTable({ runners, selected, onSelectToggle, onSelectAll, onClearSelection, onToggle, onSave }: {
  runners: LiveRunnerDTO[];
  selected: Set<string>;
  onSelectToggle: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onToggle: (r: LiveRunnerDTO) => void;
  onSave: (v: { id: string; risk_usd?: number; leverage?: number }) => void;
}) {
  const allSelected = runners.length > 0 && runners.every((r) => selected.has(r.id));
  const someSelected = runners.some((r) => selected.has(r.id));
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={(v) => (v ? onSelectAll() : onClearSelection())}
                  aria-label="Select all runners"
                />
              </TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Symbol / TF</TableHead>
              <TableHead>Strategy</TableHead>
              <TableHead>Entry window (IST)</TableHead>
              <TableHead>Risk $</TableHead>
              <TableHead>Leverage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last tick</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runners.map((r) => (
              <RunnerRow
                key={r.id}
                r={r}
                selected={selected.has(r.id)}
                onSelectToggle={onSelectToggle}
                onToggle={onToggle}
                onSave={onSave}
              />
            ))}
            {runners.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">No live runners</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden space-y-2">
        {runners.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-4">No live runners</div>
        )}
        {runners.map((r) => (
          <RunnerCardMobile
            key={r.id}
            r={r}
            selected={selected.has(r.id)}
            onSelectToggle={onSelectToggle}
            onToggle={onToggle}
            onSave={onSave}
          />
        ))}
      </div>
    </>
  );
}

function RunnerCardMobile({ r, selected, onSelectToggle, onToggle, onSave }: {
  r: LiveRunnerDTO;
  selected: boolean;
  onSelectToggle: (id: string) => void;
  onToggle: (r: LiveRunnerDTO) => void;
  onSave: (v: { id: string; risk_usd?: number; leverage?: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [risk, setRisk] = useState(String(r.risk_usd));
  const [lev, setLev] = useState(String(r.leverage));
  const [showStrategy, setShowStrategy] = useState(false);
  const dirty = Number(risk) !== Number(r.risk_usd) || Number(lev) !== Number(r.leverage);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <div className="flex items-center gap-2 p-2.5">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onSelectToggle(r.id)}
          aria-label={`Select ${r.label}`}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{r.label}</span>
            {r.running
              ? <Badge className="bg-destructive text-destructive-foreground text-[10px] shrink-0">LIVE</Badge>
              : <Badge variant="outline" className="text-[10px] shrink-0">Stopped</Badge>}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {r.symbol} · {r.timeframe} · {r.strategy_preset}
          </div>
        </div>
        <Button
          size="sm"
          variant={r.running ? "destructive" : "default"}
          className="shrink-0 h-8 px-2"
          onClick={() => onToggle(r)}
        >
          {r.running
            ? <><StopCircle className="h-3.5 w-3.5 mr-1" />Stop</>
            : <><PlayCircle className="h-3.5 w-3.5 mr-1" />Start</>}
        </Button>
        <CollapsibleTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0">
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="px-2.5 pb-2.5 space-y-2.5 border-t pt-2.5">
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-mono">Risk $</span>
            <Input value={risk} onChange={(e) => setRisk(e.target.value)}
              disabled={r.running} className="h-8" inputMode="decimal" />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-mono">Leverage</span>
            <Input value={lev} onChange={(e) => setLev(e.target.value)}
              disabled={r.running} className="h-8" inputMode="numeric" />
          </label>
        </div>
        {dirty && !r.running && (
          <Button size="sm" variant="secondary" className="w-full" onClick={() =>
            onSave({ id: r.id, risk_usd: Number(risk), leverage: Number(lev) })
          }>Save changes</Button>
        )}
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-mono">Entry window (IST)</div>
          <EntryWindowCell preset={r.strategy_preset} />
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Last tick: {fmtTs(r.last_tick_at)}</span>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setShowStrategy(true)}>
            <Info className="h-3.5 w-3.5 mr-1" /> Strategy
          </Button>
        </div>
        {r.last_tick_error && (
          <div className="text-[11px] text-destructive break-words">{r.last_tick_error}</div>
        )}
        <StrategyDetailsDialog preset={r.strategy_preset} open={showStrategy} onOpenChange={setShowStrategy} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function RunnerRow({ r, selected, onSelectToggle, onToggle, onSave }: {
  r: LiveRunnerDTO;
  selected: boolean;
  onSelectToggle: (id: string) => void;
  onToggle: (r: LiveRunnerDTO) => void;
  onSave: (v: { id: string; risk_usd?: number; leverage?: number }) => void;
}) {
  const [risk, setRisk] = useState(String(r.risk_usd));
  const [lev, setLev] = useState(String(r.leverage));
  const [showStrategy, setShowStrategy] = useState(false);
  const dirty = Number(risk) !== Number(r.risk_usd) || Number(lev) !== Number(r.leverage);
  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell className="w-8">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onSelectToggle(r.id)}
          aria-label={`Select ${r.label}`}
        />
      </TableCell>
      <TableCell className="font-medium">{r.label}</TableCell>
      <TableCell>{r.symbol} · {r.timeframe}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{r.strategy_preset}</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setShowStrategy(true)}
            aria-label="View strategy details"
            title="View strategy details"
          >
            <Info className="h-3.5 w-3.5" />
          </Button>
          <StrategyDetailsDialog preset={r.strategy_preset} open={showStrategy} onOpenChange={setShowStrategy} />
        </div>
      </TableCell>
      <TableCell><EntryWindowCell preset={r.strategy_preset} /></TableCell>
      <TableCell>
        <Input value={risk} onChange={(e) => setRisk(e.target.value)}
          disabled={r.running} className="h-8 w-20" inputMode="decimal" />
      </TableCell>
      <TableCell>
        <Input value={lev} onChange={(e) => setLev(e.target.value)}
          disabled={r.running} className="h-8 w-16" inputMode="numeric" />
      </TableCell>
      <TableCell>
        {r.running ? <Badge className="bg-destructive text-destructive-foreground">LIVE</Badge> : <Badge variant="outline">Stopped</Badge>}
        {r.last_tick_error ? <div className="text-xs text-destructive mt-1 max-w-xs truncate" title={r.last_tick_error}>{r.last_tick_error}</div> : null}
      </TableCell>
      <TableCell className="text-xs">{fmtTs(r.last_tick_at)}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          {dirty && !r.running && (
            <Button size="sm" variant="secondary" onClick={() =>
              onSave({ id: r.id, risk_usd: Number(risk), leverage: Number(lev) })
            }>Save</Button>
          )}
          <Button size="sm" variant={r.running ? "destructive" : "default"} onClick={() => onToggle(r)}>
            {r.running
              ? <><StopCircle className="h-3.5 w-3.5 mr-1" />Stop</>
              : <><PlayCircle className="h-3.5 w-3.5 mr-1" />Start</>}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function EntryWindowCell({ preset }: { preset: string }) {
  const windows = windowsForPreset(preset);
  // Re-render every minute so active/next-open indicators stay accurate.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (!windows.length) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const anyActive = windows.some((w) => isWindowActive(w));
  const nextOpen = anyActive
    ? null
    : windows.reduce<{ w: IstWindow; m: number } | null>((best, w) => {
        const m = minutesUntilOpen(w);
        if (!best || m < best.m) return { w, m };
        return best;
      }, null);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {windows.map((w) => {
          const active = isWindowActive(w);
          return (
            <Badge
              key={w.session}
              variant={active ? "default" : "outline"}
              className={`gap-1 font-mono text-[10px] ${active ? "" : "text-muted-foreground"}`}
              title={`${w.session.replace(/_/g, " ")} · ${w.label}`}
            >
              {active && <Clock className="h-3 w-3" />}
              {w.label.replace(" IST", "")}
            </Badge>
          );
        })}
      </div>
      <span className="text-[10px] text-muted-foreground">
        {anyActive
          ? "✓ Entry window open now"
          : nextOpen
            ? `Next open in ${fmtDuration(nextOpen.m)}`
            : ""}
      </span>
    </div>
  );
}

function TickStatusCard({ runners }: { runners: LiveRunnerDTO[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const hook = useQuery({
    queryKey: ["live-tick-hook-health"],
    queryFn: async () => {
      const t0 = performance.now();
      const res = await fetch("/api/public/hooks/live-tick", { method: "GET" });
      return { ok: res.ok, status: res.status, ms: Math.round(performance.now() - t0) };
    },
    refetchInterval: 30_000,
    retry: false,
  });

  // Most recent tick across all runners.
  const lastTickMs = runners.reduce<number | null>((best, r) => {
    if (!r.last_tick_at) return best;
    const t = new Date(r.last_tick_at).getTime();
    return best == null || t > best ? t : best;
  }, null);
  const ageMin = lastTickMs == null ? null : Math.floor((now - lastTickMs) / 60_000);
  const tickFresh = ageMin != null && ageMin <= 2;
  const tickStale = ageMin != null && ageMin > 5;

  // Aggregated window state across running runners (fall back to all if none running).
  const active = runners.length ? runners.filter((r) => r.running) : [];
  const source = active.length ? active : runners;
  const allWindows = source.flatMap((r) => windowsForPreset(r.strategy_preset));
  const anyActive = allWindows.some((w) => isWindowActive(w));
  const nextOpenMin = anyActive
    ? null
    : allWindows.reduce<number | null>((best, w) => {
        const m = minutesUntilOpen(w);
        return best == null || m < best ? m : best;
      }, null);

  const hookOk = hook.data?.ok === true;
  const hookLoading = hook.isPending;

  const lastTickLabel = ageMin == null ? "never" : ageMin < 1 ? "just now" : `${ageMin}m ago`;
  const windowLabel =
    allWindows.length === 0 ? "—"
    : anyActive ? "open now"
    : nextOpenMin != null ? `opens in ${fmtDuration(nextOpenMin)}`
    : "closed";

  return (
    <div className="relative flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-1.5 text-xs bg-card ring-1 ring-[color-mix(in_oklch,var(--brand-copper)_25%,transparent)]">
      <div className="flex items-center gap-1.5">
        <Activity className="h-3 w-3 text-muted-foreground" />
        <span className="text-muted-foreground">Tick</span>
      </div>
      <div className="flex items-center gap-1.5" title={lastTickMs ? new Date(lastTickMs).toLocaleString() : "no ticks yet"}>
        <span className={`h-1.5 w-1.5 rounded-full ${tickFresh ? "bg-emerald-500" : tickStale ? "bg-destructive" : "bg-amber-500"}`} />
        <span>last {lastTickLabel}</span>
      </div>
      <div className="flex items-center gap-1.5" title={hook.data ? `HTTP ${hook.data.status} · ${hook.data.ms}ms` : "GET /api/public/hooks/live-tick"}>
        {hookLoading ? (
          <span className="h-1.5 w-1.5 rounded-full bg-muted animate-pulse" />
        ) : hookOk ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
        ) : (
          <XCircle className="h-3 w-3 text-destructive" />
        )}
        <span className={hookOk ? "" : "text-destructive"}>
          hook {hookLoading ? "…" : hookOk ? "ok" : "down"}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${anyActive ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
        <span>window {windowLabel}</span>
      </div>
      {active.length > 0 && (
        <span className="text-muted-foreground ml-auto">
          {active.length} running
        </span>
      )}
    </div>
  );
}




function OpenTable({ trades, onCancel }: { trades: LiveTradeDTO[]; onCancel: (id: string) => void }) {
  if (!trades.length) return <p className="text-sm text-muted-foreground">No open live orders.</p>;
  return (
    <Table>
      <TableHeader><TableRow>
        <TableHead>Symbol</TableHead><TableHead>Dir</TableHead><TableHead>Qty</TableHead>
        <TableHead>Entry</TableHead><TableHead>Stop</TableHead><TableHead>Target</TableHead>
        <TableHead>Status</TableHead><TableHead>Since</TableHead><TableHead className="text-right"> </TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {trades.map((t) => (
          <TableRow key={t.id}>
            <TableCell>{t.symbol}</TableCell>
            <TableCell><Badge variant={t.direction === "long" ? "default" : "destructive"}>{t.direction}</Badge></TableCell>
            <TableCell>{Number(t.qty).toFixed(3)}</TableCell>
            <TableCell>{Number(t.fill_price ?? t.entry_price).toFixed(2)}</TableCell>
            <TableCell>{Number(t.stop_price).toFixed(2)}</TableCell>
            <TableCell>{Number(t.target_price).toFixed(2)}</TableCell>
            <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
            <TableCell className="text-xs">{fmtTs(t.entry_ts)}</TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="ghost" onClick={() => onCancel(t.id)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DiagnosticsCard() {
  const diagnoseFn = useServerFn(diagnoseLiveRunners);
  const q = useQuery({
    queryKey: ["live-diagnostics"],
    queryFn: () => diagnoseFn(),
    refetchInterval: 15_000,
  });
  const rows = q.data ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            Why isn&apos;t a trade triggering?
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Live view of each runner&apos;s strategy pipeline: what conditions are met on
            the latest bar, what&apos;s failing, pending signals, and rejection counts.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`h-4 w-4 mr-1 ${q.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isPending && <p className="text-sm text-muted-foreground">Loading diagnostics…</p>}
        {!q.isPending && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No runners configured.</p>
        )}
        {rows.map((d) => <RunnerDiagnostics key={d.runner_id} d={d} />)}
      </CardContent>
    </Card>
  );
}

function RunnerDiagnostics({ d }: { d: RunnerDiagnosticsDTO }) {
  const rulesPassed = d.rules.filter((r) => r.pass).length;
  const rulesFailed = d.rules.filter((r) => !r.pass);
  const gatesOk = d.running && d.windowActive && rulesFailed.length === 0;

  // Group rules by category for a clearer layout.
  const groups: Array<{ key: string; label: string }> = [
    { key: "session", label: "Session" },
    { key: "trend", label: "Trend" },
    { key: "volatility", label: "Volatility" },
    { key: "setup", label: "Setup" },
    { key: "entry", label: "Entry" },
    { key: "risk", label: "Risk" },
  ];

  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger asChild>
        <button className="w-full text-left p-3 flex items-start justify-between gap-2 hover:bg-muted/30 transition-colors">
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">
              {d.label} <span className="text-xs text-muted-foreground">· {d.symbol} · {d.timeframe}</span>
            </div>
            {d.lastBar && (
              <div className="text-[11px] text-muted-foreground truncate">
                {new Date(d.lastBar.ts).toLocaleTimeString()} · close {d.lastBar.close.toFixed(2)} · {d.barsProcessed} bars
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              {rulesPassed}/{d.rules.length} pass
            </span>
            <Badge variant={gatesOk ? "default" : "outline"} className={`text-[10px] ${gatesOk ? "" : "text-muted-foreground"}`}>
              {!d.running ? "Stopped"
                : !d.windowActive ? "Closed"
                : rulesFailed.length > 0 ? `${rulesFailed.length} block`
                : "Ready"}
            </Badge>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 space-y-3 border-t pt-3">


      {d.error && <div className="text-xs text-destructive">Error: {d.error}</div>}

      {/* Top-level gates */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <GateChip label="Runner running" pass={d.running} />
        <GateChip label="Entry window open" pass={d.windowActive}
          hint={!d.windowActive && d.nextOpenMinutes != null ? `opens in ${fmtDuration(d.nextOpenMinutes)}` : undefined} />
        <GateChip label={`Setup detected (${d.setupsDetected} in lookback)`} pass={d.setupsDetected > 0} />
        <GateChip label={`Signal created (${d.signalsCreated})`} pass={d.signalsCreated > 0} />
      </div>

      {/* Rules table grouped by category */}
      <div className="space-y-2">
        {groups.map((g) => {
          const rs = d.rules.filter((r) => r.group === g.key);
          if (!rs.length) return null;
          return (
            <div key={g.key} className="rounded-md border bg-muted/20">
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b">
                {g.label}
              </div>
              <div className="divide-y">
                {rs.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                    {r.pass
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      : <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                    <span className={`flex-1 min-w-0 truncate ${r.pass ? "" : "font-medium"}`}>
                      {r.label}
                    </span>
                    <span className="text-muted-foreground font-mono hidden sm:inline shrink-0">
                      need: {r.requirement}
                    </span>
                    <span className={`font-mono shrink-0 ${r.pass ? "text-emerald-500" : "text-destructive"}`}>
                      now: {r.actual}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {d.pending && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/40 p-2 text-xs">
          <div className="font-medium">Pending order (waiting to fill)</div>
          <div className="text-muted-foreground">
            {d.pending.direction.toUpperCase()} @ {d.pending.entryPrice.toFixed(2)} ·
            SL {d.pending.stop.toFixed(2)} · TP {d.pending.target.toFixed(2)} ·
            age {d.pending.ageBars} bars
          </div>
        </div>
      )}

      {d.lastSignal && (
        <div className="text-xs">
          <span className="text-muted-foreground">Last signal: </span>
          <span className="font-mono">
            {new Date(d.lastSignal.ts).toLocaleString()} · {d.lastSignal.type} @ {d.lastSignal.entryPrice.toFixed(2)} · SL {d.lastSignal.stop.toFixed(2)} · TP {d.lastSignal.target.toFixed(2)} · strength {d.lastSignal.strength.toFixed(2)}
          </span>
        </div>
      )}

      {d.filterRejects.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">
            Top reasons bars were skipped across the lookback:
          </div>
          <div className="flex flex-wrap gap-1">
            {d.filterRejects.map((f) => (
              <Badge key={f.label} variant="outline" className="font-mono text-[10px]">
                {f.label} · {f.count}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground">
        Setups: {d.setupsDetected} · Signals: {d.signalsCreated} · Invalidated: {d.signalsInvalidated}
      </div>
      </CollapsibleContent>
    </Collapsible>

  );
}

function GateChip({ label, pass, hint }: { label: string; pass: boolean; hint?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {pass
        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        : <XCircle className="h-3.5 w-3.5 text-destructive" />}
      <span className={pass ? "" : "text-muted-foreground"}>{label}</span>
      {hint && <span className="text-muted-foreground/70">— {hint}</span>}
    </div>
  );
}

function OpenOrdersMiniWidget({ trades }: { trades: LiveTradeDTO[] }) {
  const open = trades.filter((t) => t.status === "open").length;
  const pending = trades.filter((t) => t.status === "pending").length;
  const total = trades.length;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Activity className="h-4 w-4 text-primary shrink-0" />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Open live orders</span>
        <span className="text-lg font-semibold tabular-nums">{total}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Badge variant="outline" className="text-[10px] font-mono">Open {open}</Badge>
        <Badge variant="outline" className="text-[10px] font-mono">Pending {pending}</Badge>
      </div>
    </div>
  );
}
