import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  listPaperRunners, listPaperPositions, listPaperTrades,
  setRunnerRunning, setAllRunnersRunning, runPaperTickNow, resetPaperRunner,
  backfillPaperTradesFromBacktest,
  type RunnerDTO, type PositionDTO, type TradeDTO,
} from "@/lib/paper-trading.functions";
import { PlayCircle, StopCircle, RefreshCw, Trash2, Activity, History } from "lucide-react";

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StrategyPerformanceCard } from "@/components/strategy-performance-card";
import { PnlCalendarCard } from "@/components/pnl-calendar-card";
import { PaperStatsCard } from "@/components/paper-stats-card";
import { useNewTradeToasts } from "@/hooks/use-new-trade-toasts";

export const Route = createFileRoute("/paper-trading")({
  head: () => ({ meta: [{ title: "Paper Trading" }, { name: "description", content: "Live paper trading dashboard for automated strategies." }] }),
  component: PaperTradingPage,
});

const fmtUsd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const fmtTs = (s: string) => new Date(s).toLocaleString();

function PaperTradingPage() {
  const qc = useQueryClient();
  const runnersFn = useServerFn(listPaperRunners);
  const positionsFn = useServerFn(listPaperPositions);
  const tradesFn = useServerFn(listPaperTrades);
  const setRun = useServerFn(setRunnerRunning);
  const setAll = useServerFn(setAllRunnersRunning);
  const tickNow = useServerFn(runPaperTickNow);
  const reset = useServerFn(resetPaperRunner);
  const backfill = useServerFn(backfillPaperTradesFromBacktest);


  const runners = useQuery({
    queryKey: ["paper-runners"], queryFn: () => runnersFn(), refetchInterval: 5000,
  });
  const positions = useQuery({
    queryKey: ["paper-positions"], queryFn: () => positionsFn(), refetchInterval: 5000,
  });
  const trades = useQuery({
    queryKey: ["paper-trades"], queryFn: () => tradesFn({ data: { limit: 500 } }), refetchInterval: 10_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["paper-runners"] });
    qc.invalidateQueries({ queryKey: ["paper-positions"] });
    qc.invalidateQueries({ queryKey: ["paper-trades"] });
  };

  const toggle = useMutation({
    mutationFn: (v: { id: string; running: boolean }) => setRun({ data: v }),
    onSuccess: invalidate,
  });
  const toggleAll = useMutation({
    mutationFn: (running: boolean) => setAll({ data: { running } }),
    onSuccess: invalidate,
  });
  const tick = useMutation({ mutationFn: () => tickNow(), onSuccess: invalidate });
  const resetOne = useMutation({
    mutationFn: (id: string) => reset({ data: { id } }),
    onSuccess: invalidate,
  });
  const backfillMut = useMutation({
    mutationFn: () => backfill({ data: { topN: 10, days: 180 } }),
    onSuccess: (res) => {
      invalidate();
      const inserted = (res as { totalInserted?: number })?.totalInserted ?? 0;
      alert(`Backfill complete — inserted ${inserted} historical trades across top 10 runners.`);
    },
    onError: (e) => alert(e instanceof Error ? e.message : String(e)),
  });


  const runnersList = runners.data ?? [];
  const positionsList = positions.data ?? [];
  const tradesList = trades.data ?? [];
  useNewTradeToasts(positionsList, "Paper", {
    keyFn: (p) => `${p.runner_id}:${p.symbol}:${p.entry_ts}`,
  });
  const anyRunning = runnersList.some((r) => r.running);

  return (
    <div className="p-4 sm:p-6">
      <Tabs defaultValue="dashboard" className="space-y-6">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="performance">Strategy performance</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="space-y-6">
        <PaperStatsCard trades={tradesList} positions={positionsList} />
        <PnlCalendarCard defaultMode="paper" lockMode showStrategyFilter={false} showKpis={false} />
        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle>Runners</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => tick.mutate()} disabled={tick.isPending}>
                <RefreshCw className={`h-4 w-4 mr-1 ${tick.isPending ? "animate-spin" : ""}`} />
                Tick now
              </Button>
              <Button size="sm" variant="outline" onClick={() => backfillMut.mutate()} disabled={backfillMut.isPending}>
                <History className={`h-4 w-4 mr-1 ${backfillMut.isPending ? "animate-spin" : ""}`} />
                {backfillMut.isPending ? "Backfilling…" : "Backfill top 10 (180d)"}
              </Button>

              {anyRunning ? (
                <Button size="sm" variant="destructive" onClick={() => toggleAll.mutate(false)}>
                  <StopCircle className="h-4 w-4 mr-1" /> Stop all
                </Button>
              ) : (
                <Button size="sm" onClick={() => toggleAll.mutate(true)}>
                  <PlayCircle className="h-4 w-4 mr-1" /> Start all
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <RunnersTable
              runners={runnersList}
              onToggle={(r) => toggle.mutate({ id: r.id, running: !r.running })}
              onReset={(r) => resetOne.mutate(r.id)}
            />
            <p className="text-xs text-muted-foreground mt-3">
              Cron polls every minute and re-runs each active strategy on fresh candles. Positions & trades update automatically.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4" /> Open positions</CardTitle></CardHeader>
          <CardContent>
            <PositionsTable runners={runnersList} positions={positionsList} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Equity curves</CardTitle></CardHeader>
          <CardContent>
            <EquityChart runners={runnersList} trades={tradesList} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Closed trades log</CardTitle></CardHeader>
          <CardContent>
            <TradesTable runners={runnersList} trades={tradesList} />
          </CardContent>
        </Card>
        </TabsContent>
        <TabsContent value="performance">
          <div className="space-y-6">
            <StrategyPerformanceCard defaultMode="paper" lockMode showStrategyFilter />
            <PnlCalendarCard defaultMode="paper" lockMode />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RunnersTable({ runners, onToggle, onReset }: {
  runners: RunnerDTO[];
  onToggle: (r: RunnerDTO) => void;
  onReset: (r: RunnerDTO) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Score</TableHead>
          <TableHead>Label</TableHead>
          <TableHead>Symbol</TableHead>
          <TableHead>TF</TableHead>
          <TableHead>Strategy</TableHead>
          <TableHead>Risk $</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last tick</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runners.map((r, i) => (
          <TableRow key={r.id}>
            <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
            <TableCell>
              {r.score != null ? (
                <Badge variant={r.score >= 90 ? "default" : r.score >= 75 ? "secondary" : "outline"}>
                  {Number(r.score).toFixed(1)}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="font-medium">{r.label}</TableCell>
            <TableCell>{r.symbol}</TableCell>
            <TableCell>{r.timeframe}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{r.strategy_preset}</TableCell>
            <TableCell>${Number(r.risk_usd).toFixed(0)}</TableCell>
            <TableCell>
              {r.running ? <Badge>Running</Badge> : <Badge variant="outline">Stopped</Badge>}
              {r.last_tick_error ? <div className="text-xs text-destructive mt-1">{r.last_tick_error}</div> : null}
            </TableCell>
            <TableCell className="text-xs">{r.last_tick_at ? fmtTs(r.last_tick_at) : "—"}</TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
                <Button size="sm" variant={r.running ? "destructive" : "default"} onClick={() => onToggle(r)}>
                  {r.running ? <><StopCircle className="h-3.5 w-3.5 mr-1" />Stop</> : <><PlayCircle className="h-3.5 w-3.5 mr-1" />Start</>}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete all trades for this runner?")) onReset(r); }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
        {runners.length === 0 && (
          <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">No runners</TableCell></TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function PositionsTable({ runners, positions }: { runners: RunnerDTO[]; positions: PositionDTO[] }) {
  const label = (id: string) => runners.find((r) => r.id === id)?.label ?? id;
  if (!positions.length) {
    return <p className="text-sm text-muted-foreground">No open positions right now.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Runner</TableHead>
          <TableHead>Dir</TableHead>
          <TableHead>Entry</TableHead>
          <TableHead>Stop</TableHead>
          <TableHead>Target</TableHead>
          <TableHead>Last</TableHead>
          <TableHead className="text-right">Unrealized</TableHead>
          <TableHead>Since</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((p) => (
          <TableRow key={p.runner_id}>
            <TableCell className="font-medium">{label(p.runner_id)}</TableCell>
            <TableCell>
              <Badge variant={p.direction === "long" ? "default" : "destructive"}>{p.direction}</Badge>
            </TableCell>
            <TableCell>{Number(p.entry_price).toFixed(2)}</TableCell>
            <TableCell>{Number(p.stop_price).toFixed(2)}</TableCell>
            <TableCell>{Number(p.target_price).toFixed(2)}</TableCell>
            <TableCell>{Number(p.last_price).toFixed(2)}</TableCell>
            <TableCell className={`text-right font-medium ${Number(p.unrealized_pnl) >= 0 ? "text-emerald-500" : "text-destructive"}`}>
              {fmtUsd(Number(p.unrealized_pnl))}
            </TableCell>
            <TableCell className="text-xs">{fmtTs(p.entry_ts)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function EquityChart({ runners, trades }: { runners: RunnerDTO[]; trades: TradeDTO[] }) {
  const data = useMemo(() => buildEquityData(runners, trades), [runners, trades]);
  if (!data.rows.length) return <p className="text-sm text-muted-foreground">Not enough trades yet.</p>;
  const colors = ["#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#ef4444"];
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={data.rows}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="t" tickFormatter={(v) => new Date(v).toLocaleDateString()} minTickGap={40} />
          <YAxis tickFormatter={(v) => `$${v}`} />
          <Tooltip labelFormatter={(v) => new Date(Number(v)).toLocaleString()} formatter={(v: number) => fmtUsd(v)} />
          <Legend />
          <Line type="monotone" dataKey="combined" stroke="#fff" strokeWidth={2} dot={false} name="Combined" />
          {data.keys.map((k, i) => (
            <Line key={k.id} type="monotone" dataKey={k.id} stroke={colors[i % colors.length]} strokeWidth={1.5} dot={false} name={k.label} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function buildEquityData(runners: RunnerDTO[], trades: TradeDTO[]) {
  const keys = runners.map((r) => ({ id: r.id, label: r.label }));
  const sorted = [...trades].sort((a, b) => +new Date(a.exit_ts) - +new Date(b.exit_ts));
  const cum: Record<string, number> = {};
  keys.forEach((k) => (cum[k.id] = 0));
  let combined = 0;
  const rows = sorted.map((t) => {
    cum[t.runner_id] = (cum[t.runner_id] ?? 0) + Number(t.net_pnl);
    combined += Number(t.net_pnl);
    const row: Record<string, number | string> = { t: +new Date(t.exit_ts), combined };
    keys.forEach((k) => (row[k.id] = cum[k.id] ?? 0));
    return row;
  });
  return { rows, keys };
}

function TradesTable({ runners, trades }: { runners: RunnerDTO[]; trades: TradeDTO[] }) {
  const label = (id: string) => runners.find((r) => r.id === id)?.label ?? id;
  if (!trades.length) return <p className="text-sm text-muted-foreground">No closed trades yet.</p>;
  return (
    <div className="max-h-[500px] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Runner</TableHead>
            <TableHead>Dir</TableHead>
            <TableHead>Entry</TableHead>
            <TableHead>Exit</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>RR</TableHead>
            <TableHead className="text-right">Net PnL</TableHead>
            <TableHead>Closed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{label(t.runner_id)}</TableCell>
              <TableCell>
                <Badge variant={t.direction === "long" ? "default" : "destructive"}>{t.direction}</Badge>
              </TableCell>
              <TableCell>{Number(t.fill_price).toFixed(2)}</TableCell>
              <TableCell>{Number(t.exit_price).toFixed(2)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{t.exit_reason}</TableCell>
              <TableCell>{Number(t.rr).toFixed(2)}</TableCell>
              <TableCell className={`text-right font-medium ${Number(t.net_pnl) >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                {fmtUsd(Number(t.net_pnl))}
              </TableCell>
              <TableCell className="text-xs">{fmtTs(t.exit_ts)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
