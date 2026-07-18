// Phase 4/6/7 advanced-analysis UI. Kept as a self-contained subsection so
// the top-level research panel stays readable.

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { TradeFeatures } from "@/lib/research/features";
import {
  DEFAULT_SIM,
  featureImportance,
  monteCarlo,
  robustnessScore,
  simulateVariant,
  tradeQualityScore,
  walkForward,
  type SimConfig,
} from "@/lib/research/advanced";
import { computeStats } from "@/lib/research/aggregate";
import { GradingTab } from "./grading-tab";


function fmtUsd(n: number, d = 0) {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(d)}`;
}
function fmtPct(n: number, d = 1) {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(d)}%`;
}
function pnlClass(n: number) {
  if (n > 0) return "text-emerald-400";
  if (n < 0) return "text-red-400";
  return "text-muted-foreground";
}

// ---------- Simulator (Phase 4) ----------
function SimulatorTab({ features, slRiskUsd }: { features: TradeFeatures[]; slRiskUsd: number }) {
  const [cfg, setCfg] = useState<SimConfig>(DEFAULT_SIM);
  const base = useMemo(() => computeStats(features), [features]);
  const sim = useMemo(() => simulateVariant(features, slRiskUsd, cfg), [features, slRiskUsd, cfg]);

  const num = (v: number | null): string => (v === null ? "" : String(v));
  const parseNum = (s: string): number | null => {
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted-foreground">
        Re-simulate every recorded trade under a different exit plan (move-to-BE, partial take, trailing stop) using the
        captured MFE / MAE. Approximates the outcome without changing the strategy or requiring a re-run.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded border border-border p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Move to BE at</div>
          <Input
            type="number"
            step="0.1"
            placeholder="off"
            value={num(cfg.moveToBEAtR)}
            onChange={(e) => setCfg({ ...cfg, moveToBEAtR: parseNum(e.target.value) })}
          />
          <div className="text-[10px] text-muted-foreground">R multiple (e.g. 1.0)</div>
        </div>
        <div className="rounded border border-border p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Partial take at</div>
          <Input
            type="number"
            step="0.1"
            placeholder="off"
            value={num(cfg.partialTakeAtR)}
            onChange={(e) => setCfg({ ...cfg, partialTakeAtR: parseNum(e.target.value) })}
          />
          <Input
            type="number"
            step="5"
            placeholder="size %"
            value={cfg.partialSizePct}
            onChange={(e) => setCfg({ ...cfg, partialSizePct: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="rounded border border-border p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Trail after</div>
          <Input
            type="number"
            step="0.1"
            placeholder="off"
            value={num(cfg.trailAfterR)}
            onChange={(e) => setCfg({ ...cfg, trailAfterR: parseNum(e.target.value) })}
          />
          <Input
            type="number"
            step="0.1"
            placeholder="step R"
            value={cfg.trailStepR}
            onChange={(e) => setCfg({ ...cfg, trailStepR: Number(e.target.value) || 0.5 })}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded border border-border p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Baseline</div>
          <div className="grid grid-cols-3 gap-2 font-mono text-xs">
            <div>Net: <span className={pnlClass(base.net_pnl_usd)}>{fmtUsd(base.net_pnl_usd)}</span></div>
            <div>Win %: {fmtPct(base.win_rate_pct)}</div>
            <div>PF: {base.profit_factor >= 999 ? "∞" : base.profit_factor.toFixed(2)}</div>
            <div>Exp: <span className={pnlClass(base.expectancy_usd)}>{fmtUsd(base.expectancy_usd, 2)}</span></div>
            <div>Max DD: <span className="text-red-400">{fmtUsd(-base.max_drawdown_usd)}</span></div>
            <div>Trades: {base.filled}</div>
          </div>
        </div>
        <div className="rounded border border-primary/40 p-3">
          <div className="text-[10px] uppercase tracking-widest text-primary mb-1">Simulated variant</div>
          <div className="grid grid-cols-3 gap-2 font-mono text-xs">
            <div>Net: <span className={pnlClass(sim.net_pnl_usd)}>{fmtUsd(sim.net_pnl_usd)}</span></div>
            <div>Win %: {fmtPct(sim.win_rate_pct)}</div>
            <div>PF: {sim.profit_factor >= 999 ? "∞" : sim.profit_factor.toFixed(2)}</div>
            <div>Exp: <span className={pnlClass(sim.expectancy_usd)}>{fmtUsd(sim.expectancy_usd, 2)}</span></div>
            <div>Max DD: <span className="text-red-400">{fmtUsd(-sim.max_drawdown_usd)}</span></div>
            <div>Δ Net: <span className={pnlClass(sim.net_pnl_usd - base.net_pnl_usd)}>{fmtUsd(sim.net_pnl_usd - base.net_pnl_usd)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Monte Carlo + Walk-Forward (Phase 6) ----------
function RobustnessTab({ features }: { features: TradeFeatures[] }) {
  const [runs, setRuns] = useState(2000);
  const [folds, setFolds] = useState(5);
  const mc = useMemo(() => monteCarlo(features, runs), [features, runs]);
  const wf = useMemo(() => walkForward(features, folds), [features, folds]);
  const rob = useMemo(() => robustnessScore(features), [features]);
  const wfData = wf.map((f) => ({
    fold: `F${f.index}`,
    train: f.trainStats.net_pnl_usd,
    test: f.testStats.net_pnl_usd,
  }));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="rounded border border-primary/40 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Robustness score</div>
          <div className={`font-display text-4xl mt-1 ${rob.score >= 70 ? "text-emerald-400" : rob.score >= 40 ? "text-amber-400" : "text-red-400"}`}>
            {rob.score}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">out of 100</div>
          {rob.warning && (
            <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-400">
              ⚠ {rob.warning}
            </div>
          )}
          <div className="mt-2 space-y-0.5 font-mono text-[11px]">
            {Object.entries(rob.components).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-muted-foreground">{k}</span>
                <span>{(v * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded border border-border p-3 md:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Monte Carlo — {mc.runs} runs</div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-muted-foreground">runs</span>
              <Input className="h-7 w-20 font-mono text-[11px]" type="number" value={runs} onChange={(e) => setRuns(Math.max(100, Math.min(10000, Number(e.target.value) || 2000)))} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 font-mono text-xs">
            <div>Net mean: <span className={pnlClass(mc.netMean)}>{fmtUsd(mc.netMean)}</span></div>
            <div>Net p05: <span className={pnlClass(mc.netP05)}>{fmtUsd(mc.netP05)}</span></div>
            <div>Net p95: <span className={pnlClass(mc.netP95)}>{fmtUsd(mc.netP95)}</span></div>
            <div>DD mean: <span className="text-red-400">{fmtUsd(-mc.ddMean)}</span></div>
            <div>DD p95: <span className="text-red-400">{fmtUsd(-mc.ddP95)}</span></div>
            <div>Prob loss: <span className={mc.probLoss > 0.3 ? "text-red-400" : "text-emerald-400"}>{(mc.probLoss * 100).toFixed(1)}%</span></div>
          </div>
        </div>
      </div>
      <div className="rounded border border-border p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Walk-forward (train → test)</div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-muted-foreground">folds</span>
            <Input className="h-7 w-20 font-mono text-[11px]" type="number" value={folds} onChange={(e) => setFolds(Math.max(2, Math.min(10, Number(e.target.value) || 5)))} />
          </div>
        </div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={wfData} margin={{ top: 4, right: 12, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" />
              <XAxis dataKey="fold" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
              <Bar dataKey="train" fill="hsl(var(--muted-foreground) / 0.6)" name="Train net" />
              <Bar dataKey="test" fill="hsl(var(--primary))" name="Test net" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[11px] font-mono">
            <thead className="text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left py-1 px-2">Fold</th>
                <th className="text-left py-1 px-2">Train range</th>
                <th className="text-left py-1 px-2">Test range</th>
                <th className="text-right py-1 px-2">Train net</th>
                <th className="text-right py-1 px-2">Test net</th>
                <th className="text-right py-1 px-2">Test PF</th>
                <th className="text-right py-1 px-2">Test Win %</th>
              </tr>
            </thead>
            <tbody>
              {wf.map((f) => (
                <tr key={f.index} className="border-t border-border">
                  <td className="py-1 px-2">F{f.index}</td>
                  <td className="py-1 px-2">{f.trainStart} → {f.trainEnd}</td>
                  <td className="py-1 px-2">{f.testStart} → {f.testEnd}</td>
                  <td className={`text-right py-1 px-2 ${pnlClass(f.trainStats.net_pnl_usd)}`}>{fmtUsd(f.trainStats.net_pnl_usd)}</td>
                  <td className={`text-right py-1 px-2 ${pnlClass(f.testStats.net_pnl_usd)}`}>{fmtUsd(f.testStats.net_pnl_usd)}</td>
                  <td className="text-right py-1 px-2">{f.testStats.profit_factor >= 999 ? "∞" : f.testStats.profit_factor.toFixed(2)}</td>
                  <td className="text-right py-1 px-2">{fmtPct(f.testStats.win_rate_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- Feature importance + Trade quality (Phase 7) ----------
function AITab({ features }: { features: TradeFeatures[] }) {
  const imp = useMemo(() => featureImportance(features), [features]);
  const q = useMemo(() => tradeQualityScore(features), [features]);
  const [minScore, setMinScore] = useState(0);
  const filteredScored = q.scored.filter((s) => s.score >= minScore && (s.outcome === "tp" || s.outcome === "sl"));
  const filteredStats = {
    trades: filteredScored.length,
    wins: filteredScored.filter((s) => s.pnl_usd > 0).length,
    net: filteredScored.reduce((a, s) => a + s.pnl_usd, 0),
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded border border-border p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Feature importance (relative)</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={imp.map((r) => ({ name: r.label, score: r.score * 100 }))} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={140} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
                <Bar dataKey="score" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead className="text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-left py-1 px-2">Feature</th>
                  <th className="text-left py-1 px-2">Best bucket</th>
                  <th className="text-right py-1 px-2">Best net</th>
                  <th className="text-right py-1 px-2">Spread</th>
                </tr>
              </thead>
              <tbody>
                {imp.map((r) => (
                  <tr key={r.filterId} className="border-t border-border">
                    <td className="py-1 px-2">{r.label}</td>
                    <td className="py-1 px-2">{r.bestBucket}</td>
                    <td className={`text-right py-1 px-2 ${pnlClass(r.bestBucketNet)}`}>{fmtUsd(r.bestBucketNet)}</td>
                    <td className="text-right py-1 px-2">{fmtUsd(r.spread)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded border border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Trade Quality Score — bands</div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-muted-foreground">min score</span>
              <Input className="h-7 w-20 font-mono text-[11px]" type="number" value={minScore} onChange={(e) => setMinScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
            </div>
          </div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={q.bands} margin={{ top: 4, right: 12, bottom: 4, left: -20 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" />
                <XAxis dataKey="band" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis yAxisId="l" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
                <Bar yAxisId="l" dataKey="count" fill="hsl(var(--muted-foreground) / 0.5)" name="Trades" />
                <Bar yAxisId="r" dataKey="net_pnl_usd" name="Net P&L">
                  {q.bands.map((b, i) => (
                    <Cell key={i} fill={b.net_pnl_usd >= 0 ? "hsl(142 71% 45%)" : "hsl(0 72% 55%)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 rounded border border-primary/30 bg-primary/5 p-2 text-[11px] font-mono">
            Filter ≥ {minScore}: {filteredStats.trades} trades ·
            {" "}Wins {filteredStats.wins}
            {filteredStats.trades > 0 ? ` (${((filteredStats.wins / filteredStats.trades) * 100).toFixed(0)}%)` : ""} ·
            {" "}Net <span className={pnlClass(filteredStats.net)}>{fmtUsd(filteredStats.net)}</span>
          </div>
          <div className="mt-2 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={q.scored.map((s, i) => ({ i, cum: q.scored.slice(0, i + 1).filter((x) => x.score >= minScore && (x.outcome === "tp" || x.outcome === "sl")).reduce((a, x) => a + x.pnl_usd, 0) }))} margin={{ top: 4, right: 12, bottom: 4, left: -20 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" />
                <XAxis dataKey="i" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
                <Line type="monotone" dataKey="cum" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} name="Equity (filtered)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdvancedResearch({ features, slRiskUsd, symbol }: { features: TradeFeatures[]; slRiskUsd: number; symbol?: string }) {
  const [enabled, setEnabled] = useState(false);
  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="font-display text-base">Advanced Research — Phases 4/6/7 + AI Grading</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              Exit-plan simulator, Monte Carlo, walk-forward, feature importance, per-trade quality score, and an AI
              grading engine (A+++ → C) with per-grade risk sizing.
            </p>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            {enabled ? "Loaded" : "Load"}
          </label>
        </div>
      </CardHeader>
      {enabled && (
        <CardContent>
          <Tabs defaultValue="grading" className="w-full">
            <TabsList className="bg-muted/60">
              <TabsTrigger value="grading" className="text-xs">AI Grading (A+++ → C)</TabsTrigger>
              <TabsTrigger value="sim" className="text-xs">Exit simulator</TabsTrigger>
              <TabsTrigger value="rob" className="text-xs">Robustness (MC + WF)</TabsTrigger>
              <TabsTrigger value="ai" className="text-xs">AI — importance + quality</TabsTrigger>
            </TabsList>
            <TabsContent value="grading" className="mt-4"><GradingTab features={features} slRiskUsd={slRiskUsd} symbol={symbol} /></TabsContent>
            <TabsContent value="sim" className="mt-4"><SimulatorTab features={features} slRiskUsd={slRiskUsd} /></TabsContent>
            <TabsContent value="rob" className="mt-4"><RobustnessTab features={features} /></TabsContent>
            <TabsContent value="ai" className="mt-4"><AITab features={features} /></TabsContent>
          </Tabs>
        </CardContent>
      )}
    </Card>
  );
}


// Prevent unused-warning helper.
export { Button as _Btn };
