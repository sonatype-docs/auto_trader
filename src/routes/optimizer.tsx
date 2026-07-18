import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip,
  XAxis, YAxis, ScatterChart, Scatter, ZAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download, Play, Sparkles, Zap } from "lucide-react";
import { queryTrades } from "@/lib/trade-intelligence.functions";
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import type {
  ObjectiveKey, ObjectiveSpec, ParamDim, SearchMethod, OptimizationResult,
} from "@/lib/optimizer/types";
import { runOptimization } from "@/lib/optimizer/engine";
import { walkForward } from "@/lib/optimizer/walk-forward";
import { monteCarlo } from "@/lib/optimizer/monte-carlo";
import { buildHeatmap, type HeatmapMetric } from "@/lib/optimizer/heatmap";
import { featureImportance } from "@/lib/optimizer/feature-importance";
import { kmeans } from "@/lib/optimizer/clustering";
import { regimeReport } from "@/lib/optimizer/regime";
import { discoverRules } from "@/lib/optimizer/filter-discovery";
import { recommend } from "@/lib/optimizer/recommendations";
import { computeMetrics } from "@/lib/optimizer/objectives";
import { extractFeatures, allNumericKeys, allCategoricalKeys } from "@/lib/optimizer/dimensions";
import { topToCsv, toJson, toMarkdown } from "@/lib/optimizer/report";
import { candidateToRule, ruleToPredicate } from "@/lib/optimizer/filters";

export const Route = createFileRoute("/optimizer")({
  head: () => ({
    meta: [
      { title: "Universal Research Optimizer — Quant Platform" },
      { name: "description", content: "Discover statistically significant trading edges: grid, random, GA, PSO, SA, walk-forward, Monte Carlo, feature importance, clustering, regime discovery." },
    ],
  }),
  component: OptimizerPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Error: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

const OBJECTIVE_OPTIONS: { key: ObjectiveKey; label: string }[] = [
  { key: "net_profit", label: "Net Profit" },
  { key: "profit_factor", label: "Profit Factor" },
  { key: "expectancy", label: "Expectancy" },
  { key: "sharpe", label: "Sharpe" },
  { key: "sortino", label: "Sortino" },
  { key: "calmar", label: "Calmar" },
  { key: "recovery_factor", label: "Recovery Factor" },
  { key: "max_drawdown_neg", label: "Minimize Max Drawdown" },
  { key: "win_rate", label: "Win Rate" },
  { key: "avg_rr", label: "Average RR" },
  { key: "risk_adjusted_return", label: "Risk-Adjusted Return" },
  { key: "ulcer_index_neg", label: "Minimize Ulcer Index" },
  { key: "custom", label: "Custom Formula" },
];

const METHODS: { key: SearchMethod; label: string }[] = [
  { key: "grid", label: "Grid Search" },
  { key: "random", label: "Random Search" },
  { key: "genetic", label: "Genetic Algorithm" },
  { key: "bayesian", label: "Bayesian (light)" },
  { key: "pso", label: "Particle Swarm" },
  { key: "annealing", label: "Simulated Annealing" },
];

function download(name: string, body: string, mime: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function OptimizerPage() {
  const qFn = useServerFn(queryTrades);
  const [limit, setLimit] = useState(2000);
  const [strategyId, setStrategyId] = useState("");
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["optimizer-trades", limit, strategyId],
    queryFn: () => qFn({ data: { limit, strategyId: strategyId || undefined, orderBy: "exit_time", order: "desc" } }),
  });
  const rows: TradeRecord[] = data?.rows ?? [];
  const total = data?.total ?? 0;
  const baseMetrics = useMemo(() => computeMetrics(rows), [rows]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6">
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-xl sm:text-2xl font-semibold tracking-tight">Universal Research Optimizer</h1>
          <p className="text-sm text-muted-foreground">
            Discover when / where / why the strategy performs best. Operates on the Trade Intelligence Database.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-xs text-muted-foreground">Strategy</Label>
          <Input placeholder="all" className="h-8 w-32 sm:w-40" value={strategyId} onChange={(e) => setStrategyId(e.target.value)} />
          <Label className="text-xs text-muted-foreground">Limit</Label>
          <Input type="number" className="h-8 w-20 sm:w-24" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 500)} />
          <Button size="sm" onClick={() => refetch()}>Reload</Button>
        </div>
      </header>


      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatCard label="Loaded" value={String(rows.length)} sub={`of ${total}`} />
        <StatCard label="Net P&L" value={`$${baseMetrics.net_profit.toFixed(0)}`} />
        <StatCard label="Win %" value={`${(baseMetrics.win_rate * 100).toFixed(1)}%`} />
        <StatCard label="Profit Factor" value={baseMetrics.profit_factor.toFixed(2)} />
        <StatCard label="Sharpe" value={baseMetrics.sharpe.toFixed(2)} />
        <StatCard label="Max DD" value={`$${baseMetrics.max_drawdown.toFixed(0)}`} />
      </div>

      {isLoading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Loading trades…</CardContent></Card>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          No trades in the Trade Intelligence database yet. Run a backtest from the Trade Intelligence page to populate it.
        </CardContent></Card>
      ) : (
        <Tabs defaultValue="optimize" className="space-y-4">
          <TabsList className="flex flex-wrap gap-1">
            <TabsTrigger value="optimize">Optimization</TabsTrigger>
            <TabsTrigger value="wf">Walk-Forward</TabsTrigger>
            <TabsTrigger value="mc">Monte Carlo</TabsTrigger>
            <TabsTrigger value="heatmap">Heatmaps</TabsTrigger>
            <TabsTrigger value="importance">Feature Importance</TabsTrigger>
            <TabsTrigger value="clusters">Clusters</TabsTrigger>
            <TabsTrigger value="regime">Regimes</TabsTrigger>
            <TabsTrigger value="rules">Rule Discovery</TabsTrigger>
            <TabsTrigger value="recs">AI Recommendations</TabsTrigger>
          </TabsList>

          <TabsContent value="optimize"><OptimizePanel rows={rows} baseMetrics={baseMetrics} /></TabsContent>
          <TabsContent value="wf"><WalkForwardPanel rows={rows} /></TabsContent>
          <TabsContent value="mc"><MonteCarloPanel rows={rows} /></TabsContent>
          <TabsContent value="heatmap"><HeatmapPanel rows={rows} /></TabsContent>
          <TabsContent value="importance"><ImportancePanel rows={rows} /></TabsContent>
          <TabsContent value="clusters"><ClusterPanel rows={rows} /></TabsContent>
          <TabsContent value="regime"><RegimePanel rows={rows} /></TabsContent>
          <TabsContent value="rules"><RulePanel rows={rows} /></TabsContent>
          <TabsContent value="recs"><RecsPanel rows={rows} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </CardContent></Card>
  );
}

// ---------------- Optimize panel ----------------
function OptimizePanel({ rows, baseMetrics }: { rows: TradeRecord[]; baseMetrics: ReturnType<typeof computeMetrics> }) {
  const fv = useMemo(() => rows.map(extractFeatures), [rows]);
  const numericKeys = useMemo(() => allNumericKeys(fv), [fv]);
  const categoricalKeys = useMemo(() => allCategoricalKeys(fv), [fv]);
  const [method, setMethod] = useState<SearchMethod>("random");
  const [objectiveKey, setObjectiveKey] = useState<ObjectiveKey>("expectancy");
  const [formula, setFormula] = useState("net_profit / (max_drawdown + 1)");
  const [minTrades, setMinTrades] = useState(20);
  const [budget, setBudget] = useState(400);
  const [selectedNumeric, setSelectedNumeric] = useState<string[]>(numericKeys.slice(0, 3));
  const [selectedCat, setSelectedCat] = useState<string[]>(categoricalKeys.slice(0, 2));
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const dims: ParamDim[] = useMemo(() => {
    const out: ParamDim[] = [];
    for (const k of selectedNumeric) {
      const values = fv.map((f) => f.numeric[k] ?? 0).filter(Number.isFinite);
      if (!values.length) continue;
      const min = Math.min(...values), max = Math.max(...values);
      out.push({ kind: "numeric", id: k, label: k, min, max, step: (max - min) / 8 });
    }
    for (const k of selectedCat) {
      const uniq = Array.from(new Set(fv.map((f) => f.categorical[k] ?? "unknown")));
      out.push({ kind: "categorical", id: k, label: k, values: uniq });
    }
    return out;
  }, [fv, selectedNumeric, selectedCat]);

  const run = async () => {
    setRunning(true); setProgress(0);
    const spec: ObjectiveSpec = { key: objectiveKey, formula: objectiveKey === "custom" ? formula : undefined, minTrades };
    // let the UI paint first
    await new Promise((r) => setTimeout(r, 20));
    const res = runOptimization(rows, {
      method, dims, objective: spec, budget,
      onProgress: (done, total) => setProgress(Math.round((done / total) * 100)),
    });
    setResult(res); setRunning(false);
  };

  const originalScore = useMemo(() => {
    const m = baseMetrics as unknown as Record<string, number>;
    return m[objectiveKey === "max_drawdown_neg" ? "max_drawdown" : objectiveKey === "ulcer_index_neg" ? "ulcer_index" : objectiveKey] ?? 0;
  }, [baseMetrics, objectiveKey]);

  return (
    <div className="grid gap-4 md:grid-cols-[380px_1fr]">
      <Card>
        <CardHeader><CardTitle className="text-base">Search Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as SearchMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Objective</Label>
            <Select value={objectiveKey} onValueChange={(v) => setObjectiveKey(v as ObjectiveKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{OBJECTIVE_OPTIONS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {objectiveKey === "custom" && (
            <div>
              <Label>Custom formula</Label>
              <Input value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="net_profit / (max_drawdown + 1)" />
              <p className="mt-1 text-[11px] text-muted-foreground">Vars: net_profit, profit_factor, expectancy, sharpe, sortino, calmar, max_drawdown, win_rate, avg_rr, ulcer_index, recovery_factor, trades.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Budget</Label>
              <Input type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value) || 100)} />
            </div>
            <div>
              <Label>Min trades</Label>
              <Input type="number" value={minTrades} onChange={(e) => setMinTrades(Number(e.target.value) || 1)} />
            </div>
          </div>
          <div>
            <Label>Numeric dimensions</Label>
            <MultiSelect items={numericKeys} value={selectedNumeric} onChange={setSelectedNumeric} />
          </div>
          <div>
            <Label>Categorical dimensions</Label>
            <MultiSelect items={categoricalKeys} value={selectedCat} onChange={setSelectedCat} />
          </div>
          <Button onClick={run} disabled={running || dims.length === 0} className="w-full">
            <Play className="mr-2 h-4 w-4" /> {running ? `Running… ${progress}%` : "Run Optimization"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {result && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4" /> Best Candidate
                </CardTitle>
                <CardDescription>
                  Score {result.best?.score.toFixed(4)} · vs original {Number(originalScore).toFixed(4)} · {result.evaluated} evaluated in {result.elapsedMs} ms
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-2 flex flex-wrap gap-1">
                  {result.best && Object.entries(result.best.candidate).map(([k, v]) => (
                    <Badge key={k} variant="outline">{k}: {String(v)}</Badge>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                  {result.best && Object.entries(result.best.metrics).slice(0, 12).map(([k, v]) => (
                    <div key={k} className="rounded border bg-card px-2 py-1">
                      <div className="text-[10px] uppercase text-muted-foreground">{k}</div>
                      <div className="font-mono">{Number(v).toFixed(3)}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => download("optimizer.json", toJson(result), "application/json")}>
                    <Download className="mr-1 h-4 w-4" /> JSON
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => download("optimizer-top.csv", topToCsv(result.top), "text/csv")}>
                    <Download className="mr-1 h-4 w-4" /> CSV
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => download("optimizer.md", toMarkdown(result), "text/markdown")}>
                    <Download className="mr-1 h-4 w-4" /> Markdown
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Top 25 · Original vs Optimized</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>#</TableHead><TableHead>Score</TableHead><TableHead>Trades</TableHead>
                    <TableHead>Net</TableHead><TableHead>PF</TableHead><TableHead>Win%</TableHead>
                    <TableHead>Sharpe</TableHead><TableHead>Max DD</TableHead><TableHead>Candidate</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {result.top.map((r, i) => (
                      <TableRow key={r.id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-mono">{r.score.toFixed(3)}</TableCell>
                        <TableCell>{r.trades}</TableCell>
                        <TableCell>${(r.metrics.net_profit ?? 0).toFixed(0)}</TableCell>
                        <TableCell>{(r.metrics.profit_factor ?? 0).toFixed(2)}</TableCell>
                        <TableCell>{((r.metrics.win_rate ?? 0) * 100).toFixed(1)}%</TableCell>
                        <TableCell>{(r.metrics.sharpe ?? 0).toFixed(2)}</TableCell>
                        <TableCell>${(r.metrics.max_drawdown ?? 0).toFixed(0)}</TableCell>
                        <TableCell className="text-xs">{Object.entries(r.candidate).map(([k, v]) => `${k}=${v}`).join(", ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
        {!result && (
          <Card><CardContent className="p-8 text-center text-muted-foreground">Configure a search and press Run.</CardContent></Card>
        )}
      </div>
    </div>
  );
}

function MultiSelect({ items, value, onChange }: { items: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((v) => v !== k) : [...value, k]);
  return (
    <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded border p-2">
      {items.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => toggle(k)}
          className={`rounded px-2 py-0.5 text-xs ${value.includes(k) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
        >{k}</button>
      ))}
    </div>
  );
}

// ---------------- Walk-Forward ----------------
function WalkForwardPanel({ rows }: { rows: TradeRecord[] }) {
  const [folds, setFolds] = useState(4);
  const [objectiveKey, setObjectiveKey] = useState<ObjectiveKey>("expectancy");
  const segments = useMemo(() => {
    return walkForward(
      rows,
      // very simple optimizer: keep best categorical session
      (train) => {
        const bySession = new Map<string, TradeRecord[]>();
        for (const t of train) {
          const s = t.session ?? "unknown";
          const arr = bySession.get(s) ?? []; arr.push(t); bySession.set(s, arr);
        }
        let best = "unknown", bestVal = -Infinity;
        for (const [s, arr] of bySession) {
          const m = computeMetrics(arr);
          const v = (m as unknown as Record<string, number>)[objectiveKey] ?? m.net_profit;
          if (v > bestVal) { bestVal = v; best = s; }
        }
        const rule = candidateToRule({ session: best }, [{ kind: "categorical", id: "session", label: "session", values: [] }]);
        return ruleToPredicate(rule);
      },
      { key: objectiveKey },
      folds,
    );
  }, [rows, folds, objectiveKey]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Walk-Forward Validation</CardTitle>
        <CardDescription>Optimize on train fold, score on out-of-sample test fold.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-3">
          <div><Label>Folds</Label><Input type="number" value={folds} onChange={(e) => setFolds(Math.max(2, Number(e.target.value) || 4))} className="w-24" /></div>
          <div><Label>Objective</Label>
            <Select value={objectiveKey} onValueChange={(v) => setObjectiveKey(v as ObjectiveKey)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{OBJECTIVE_OPTIONS.filter((o) => o.key !== "custom").map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fold</TableHead><TableHead>Train range</TableHead><TableHead>Test range</TableHead>
            <TableHead>Train score</TableHead><TableHead>Test score</TableHead>
            <TableHead>Train / Test trades</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {segments.map((s) => (
              <TableRow key={s.index}>
                <TableCell>{s.index}</TableCell>
                <TableCell className="text-xs">{new Date(s.trainStart).toLocaleDateString()} → {new Date(s.trainEnd).toLocaleDateString()}</TableCell>
                <TableCell className="text-xs">{new Date(s.testStart).toLocaleDateString()} → {new Date(s.testEnd).toLocaleDateString()}</TableCell>
                <TableCell className="font-mono">{s.trainScore.toFixed(3)}</TableCell>
                <TableCell className={`font-mono ${s.testScore > 0 ? "text-emerald-500" : "text-destructive"}`}>{s.testScore.toFixed(3)}</TableCell>
                <TableCell>{s.trainTrades} / {s.testTrades}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {segments.length === 0 && <div className="text-sm text-muted-foreground">Not enough trades for {folds} folds.</div>}
      </CardContent>
    </Card>
  );
}

// ---------------- Monte Carlo ----------------
function MonteCarloPanel({ rows }: { rows: TradeRecord[] }) {
  const [runs, setRuns] = useState(1000);
  const [initial, setInitial] = useState(10000);
  const [ruinFrac, setRuinFrac] = useState(0.5);
  const result = useMemo(() => monteCarlo(rows, { runs, initialEquity: initial, ruinFractionOfInitial: ruinFrac }), [rows, runs, initial, ruinFrac]);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Monte Carlo Simulation</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div><Label>Runs</Label>
            <Select value={String(runs)} onValueChange={(v) => setRuns(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{[100, 500, 1000, 5000, 10000].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Initial equity</Label><Input type="number" value={initial} onChange={(e) => setInitial(Number(e.target.value) || 10000)} className="w-32" /></div>
          <div><Label>Ruin @ DD frac</Label><Input type="number" step="0.05" value={ruinFrac} onChange={(e) => setRuinFrac(Number(e.target.value) || 0.5)} className="w-32" /></div>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatCard label="Expected Net" value={`$${result.expectedNet.toFixed(0)}`} />
          <StatCard label="CI 5% / 50% / 95%" value={`${result.ci05.toFixed(0)} / ${result.ci50.toFixed(0)} / ${result.ci95.toFixed(0)}`} />
          <StatCard label="Worst Net" value={`$${result.worstNet.toFixed(0)}`} />
          <StatCard label="Best Net" value={`$${result.bestNet.toFixed(0)}`} />
          <StatCard label="Expected Max DD" value={`$${result.expectedMaxDd.toFixed(0)}`} />
          <StatCard label="Worst Max DD" value={`$${result.worstMaxDd.toFixed(0)}`} />
          <StatCard label="Prob of Ruin" value={`${(result.probRuin * 100).toFixed(1)}%`} />
          <StatCard label="Exp. Win/Loss Streak" value={`${result.expectedWinStreak.toFixed(1)} / ${result.expectedLossStreak.toFixed(1)}`} />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------- Heatmap ----------------
function HeatmapPanel({ rows }: { rows: TradeRecord[] }) {
  const fv = useMemo(() => rows.map(extractFeatures), [rows]);
  const numKeys = allNumericKeys(fv);
  const catKeys = allCategoricalKeys(fv);
  const allDims = [...numKeys, ...catKeys];
  const [xDim, setXDim] = useState<string>(allDims[0] ?? "hour");
  const [yDim, setYDim] = useState<string>(allDims[1] ?? "weekday");
  const [metric, setMetric] = useState<HeatmapMetric>("net_profit");
  const isNumericX = numKeys.includes(xDim);
  const isNumericY = numKeys.includes(yDim);
  const bins = (key: string) => {
    const values = fv.map((f) => f.numeric[key] ?? NaN).filter(Number.isFinite);
    if (!values.length) return undefined;
    const min = Math.min(...values), max = Math.max(...values);
    const step = (max - min) / 6;
    return Array.from({ length: 7 }, (_, i) => Number((min + i * step).toFixed(2)));
  };
  const heat = useMemo(() => buildHeatmap(rows, xDim, yDim, metric, isNumericX ? bins(xDim) : undefined, isNumericY ? bins(yDim) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, xDim, yDim, metric]);
  const color = (v: number) => {
    if (heat.max === heat.min) return "hsl(220 15% 30%)";
    const t = (v - heat.min) / (heat.max - heat.min);
    const hue = t * 130; // red→green
    return `hsl(${hue} 65% ${45 - t * 15}%)`;
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Interactive Heatmap</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div><Label>X</Label>
            <Select value={xDim} onValueChange={setXDim}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{allDims.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Y</Label>
            <Select value={yDim} onValueChange={setYDim}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{allDims.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Metric</Label>
            <Select value={metric} onValueChange={(v) => setMetric(v as HeatmapMetric)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["net_profit", "profit_factor", "expectancy", "win_rate", "sharpe", "max_drawdown", "trades"].map((m) =>
                  <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="text-xs">
            <thead>
              <tr><th></th>{heat.xLabels.map((x) => <th key={x} className="px-2 py-1 text-muted-foreground">{x}</th>)}</tr>
            </thead>
            <tbody>
              {heat.yLabels.map((y) => (
                <tr key={y}>
                  <td className="pr-2 text-muted-foreground">{y}</td>
                  {heat.xLabels.map((x) => {
                    const c = heat.cells.find((c) => c.x === x && c.y === y);
                    if (!c) return <td key={x} className="border border-border/40 px-2 py-1" />;
                    return (
                      <td key={x} className="border border-border/40 px-2 py-1 text-center" title={`${x} × ${y}: ${c.value.toFixed(2)} (${c.trades} trades)`}
                        style={{ background: color(c.value), color: "white" }}>
                        {c.value.toFixed(1)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------- Feature Importance ----------------
function ImportancePanel({ rows }: { rows: TradeRecord[] }) {
  const ranks = useMemo(() => featureImportance(rows), [rows]);
  const chart = ranks.slice(0, 15).map((r) => ({ name: r.feature, score: Number((r.score * 100).toFixed(1)) }));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Zap className="h-4 w-4" /> Feature Importance</CardTitle>
        <CardDescription>Contribution of each feature to profitability (0–100).</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 100]} />
              <YAxis dataKey="name" type="category" width={120} />
              <RTooltip />
              <Bar dataKey="score" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Table className="mt-4">
          <TableHeader><TableRow>
            <TableHead>Feature</TableHead><TableHead>Kind</TableHead><TableHead>Score</TableHead>
            <TableHead>Best slice</TableHead><TableHead>Best mean $</TableHead><TableHead>Worst slice</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {ranks.slice(0, 25).map((r) => (
              <TableRow key={r.feature}>
                <TableCell>{r.feature}</TableCell>
                <TableCell><Badge variant="outline">{r.kind}</Badge></TableCell>
                <TableCell className="font-mono">{(r.score * 100).toFixed(1)}</TableCell>
                <TableCell>{r.bestSlice}</TableCell>
                <TableCell className="text-emerald-500">${r.bestScore.toFixed(1)}</TableCell>
                <TableCell className="text-destructive">{r.worstSlice}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------- Clusters ----------------
function ClusterPanel({ rows }: { rows: TradeRecord[] }) {
  const [k, setK] = useState(4);
  const clusters = useMemo(() => kmeans(rows, k), [rows, k]);
  const scatter = useMemo(() => {
    const pts: { x: number; y: number; cluster: number; pnl: number }[] = [];
    clusters.forEach((c) => c.members.forEach((idx) => {
      const t = rows[idx]; const f = extractFeatures(t);
      pts.push({ x: f.numeric.atr_pct || f.numeric.atr || 0, y: f.numeric.adx || 0, cluster: c.index, pnl: t.netPnl });
    }));
    return pts;
  }, [clusters, rows]);
  const colors = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#84cc16"];
  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <Card>
        <CardHeader><CardTitle className="text-base">Trade Clustering</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>K (number of clusters)</Label><Input type="number" value={k} onChange={(e) => setK(Math.max(2, Math.min(8, Number(e.target.value) || 4)))} /></div>
          {clusters.map((c) => (
            <div key={c.index} className="rounded border bg-card p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium" style={{ color: colors[c.index] }}>Cluster {c.index + 1}</span>
                <span className="text-muted-foreground">{c.size} trades</span>
              </div>
              <div className="font-mono">Net ${c.metrics.net_profit.toFixed(0)} · Win {(c.metrics.win_rate * 100).toFixed(0)}% · PF {c.metrics.profit_factor.toFixed(2)}</div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">ATR × ADX projection (colored by cluster)</CardTitle></CardHeader>
        <CardContent>
          <div className="h-96">
            <ResponsiveContainer>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" dataKey="x" name="ATR" />
                <YAxis type="number" dataKey="y" name="ADX" />
                <ZAxis range={[40, 40]} />
                <RTooltip cursor={{ strokeDasharray: "3 3" }} />
                {clusters.map((c) => (
                  <Scatter key={c.index} name={`Cluster ${c.index + 1}`} data={scatter.filter((p) => p.cluster === c.index)} fill={colors[c.index]} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------- Regime ----------------
function RegimePanel({ rows }: { rows: TradeRecord[] }) {
  const report = useMemo(() => regimeReport(rows), [rows]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Market Regime Discovery</CardTitle>
        <CardDescription>Trades tagged by ATR percentile + ADX. Highest-expectancy regime is on top.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Regime</TableHead><TableHead>Trades</TableHead><TableHead>Net</TableHead>
            <TableHead>PF</TableHead><TableHead>Win%</TableHead><TableHead>Expectancy</TableHead>
            <TableHead>Max DD</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {report.map((r) => (
              <TableRow key={r.regime}>
                <TableCell><Badge>{r.regime}</Badge></TableCell>
                <TableCell>{r.trades}</TableCell>
                <TableCell>${r.metrics.net_profit.toFixed(0)}</TableCell>
                <TableCell>{r.metrics.profit_factor.toFixed(2)}</TableCell>
                <TableCell>{(r.metrics.win_rate * 100).toFixed(1)}%</TableCell>
                <TableCell>${r.metrics.expectancy.toFixed(2)}</TableCell>
                <TableCell>${r.metrics.max_drawdown.toFixed(0)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------- Rule Discovery ----------------
function RulePanel({ rows }: { rows: TradeRecord[] }) {
  const [depth, setDepth] = useState(3);
  const [objectiveKey, setObjectiveKey] = useState<ObjectiveKey>("expectancy");
  const [minTrades, setMinTrades] = useState(20);
  const rules = useMemo(() => discoverRules(rows, { key: objectiveKey, minTrades }, { maxDepth: depth, minTrades }), [rows, depth, objectiveKey, minTrades]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Automatic Filter / Rule Discovery</CardTitle>
        <CardDescription>Beam-search over feature slices that lift the objective.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div><Label>Depth</Label><Input type="number" value={depth} onChange={(e) => setDepth(Math.max(1, Math.min(4, Number(e.target.value) || 3)))} className="w-24" /></div>
          <div><Label>Objective</Label>
            <Select value={objectiveKey} onValueChange={(v) => setObjectiveKey(v as ObjectiveKey)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{OBJECTIVE_OPTIONS.filter((o) => o.key !== "custom").map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Min trades</Label><Input type="number" value={minTrades} onChange={(e) => setMinTrades(Number(e.target.value) || 10)} className="w-24" /></div>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>#</TableHead><TableHead>Rule</TableHead><TableHead>Trades</TableHead>
            <TableHead>Score</TableHead><TableHead>Lift vs base</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rules.map((r, i) => (
              <TableRow key={i}>
                <TableCell>{i + 1}</TableCell>
                <TableCell className="text-xs">{r.description}</TableCell>
                <TableCell>{r.trades}</TableCell>
                <TableCell className="font-mono">{r.score.toFixed(3)}</TableCell>
                <TableCell className="text-emerald-500">+{r.liftPct.toFixed(1)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------- Recommendations ----------------
function RecsPanel({ rows }: { rows: TradeRecord[] }) {
  const [objectiveKey, setObjectiveKey] = useState<ObjectiveKey>("profit_factor");
  const recs = useMemo(() => recommend(rows, { key: objectiveKey }), [rows, objectiveKey]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI Recommendations</CardTitle>
        <CardDescription>Actions that measurably improve the objective on this dataset.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-3">
          <div><Label>Objective</Label>
            <Select value={objectiveKey} onValueChange={(v) => setObjectiveKey(v as ObjectiveKey)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{OBJECTIVE_OPTIONS.filter((o) => o.key !== "custom").map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        {recs.length === 0 ? (
          <div className="text-sm text-muted-foreground">No high-impact recommendations found for this objective on the current dataset.</div>
        ) : (
          <div className="space-y-2">
            {recs.map((r, i) => (
              <div key={i} className="rounded border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{r.action}</div>
                    <div className="text-xs text-muted-foreground">{r.detail}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-500 font-mono">+{r.liftPct.toFixed(1)}%</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{r.before.toFixed(2)} → {r.after.toFixed(2)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <CellPlaceholder />
      </CardContent>
    </Card>
  );
}

// silences an unused-import warning if the app strips them
function CellPlaceholder() { return <Cell />; }
