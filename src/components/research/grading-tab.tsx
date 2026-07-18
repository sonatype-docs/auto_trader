// AI Grading tab — train a per-bucket expectancy model from filtered trades,
// grade each historical trade (A+++ … C), and simulate the equity curve when
// applying per-grade risk multipliers + a min-grade gate. Optionally push the
// trained model to the live engine.

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import type { TradeFeatures } from "@/lib/research/features";
import {
  DEFAULT_RISK_MULTIPLIERS,
  GRADE_ORDER,
  gradeStats,
  scoreTrades,
  simulateWithGrading,
  trainGradingModel,
  type GradeLabel,
  type GradingModel,
} from "@/lib/research/grading";
import { saveGradingModel, clearGradingModel } from "@/lib/strategy.functions";
import { useServerFn } from "@tanstack/react-start";

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

const GRADE_COLORS: Record<GradeLabel, string> = {
  "A+++": "#10b981",
  "A++": "#22c55e",
  "A+": "#84cc16",
  A: "#eab308",
  B: "#f97316",
  C: "#ef4444",
};

export function GradingTab({
  features,
  slRiskUsd,
  symbol,
}: {
  features: TradeFeatures[];
  slRiskUsd: number;
  symbol?: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState<GradingModel | null>(null);
  const [multipliers, setMultipliers] = useState<Record<GradeLabel, number>>({ ...DEFAULT_RISK_MULTIPLIERS });
  const [minGrade, setMinGrade] = useState<GradeLabel>("B");
  const [saving, setSaving] = useState(false);
  const save = useServerFn(saveGradingModel);
  const clear = useServerFn(clearGradingModel);

  const train = () => {
    if (features.length < 20) {
      toast.error(`Need at least 20 trades to train (currently ${features.length}).`);
      return;
    }
    const m = trainGradingModel(features, { symbol: symbol ?? null });
    setModel(m);
    toast.success(`Trained on ${m.sample_size} decided trades.`);
  };

  const scored = useMemo(() => (model ? scoreTrades(features, model) : []), [features, model]);
  const stats = useMemo(() => (model ? gradeStats(scored) : []), [model, scored]);
  const sim = useMemo(
    () => (model && enabled ? simulateWithGrading(scored, multipliers, minGrade) : null),
    [model, enabled, scored, multipliers, minGrade],
  );
  const baseline = useMemo(
    () =>
      model
        ? simulateWithGrading(
            scored,
            Object.fromEntries(GRADE_ORDER.map((g) => [g, 1])) as Record<GradeLabel, number>,
            "C",
          )
        : null,
    [model, scored],
  );

  const chartData = useMemo(() => {
    if (!sim || !baseline) return [];
    // Align by ist_date
    const base = new Map(baseline.equity.map((p) => [p.ist_date, p.equity]));
    const graded = new Map(sim.equity.map((p) => [p.ist_date, p.equity]));
    const all = new Set([...base.keys(), ...graded.keys()]);
    return [...all].sort().map((d) => ({
      ist_date: d,
      baseline: base.get(d) ?? null,
      graded: graded.get(d) ?? null,
    }));
  }, [sim, baseline]);

  const onSave = async () => {
    if (!model) return;
    setSaving(true);
    try {
      await save({ data: model as never });
      toast.success("Model saved. Enable AI grading in strategy settings to use it live.");
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const onClear = async () => {
    setSaving(true);
    try {
      await clear();
      toast.success("Live AI model cleared.");
    } catch (e) {
      toast.error(`Clear failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-muted-foreground">
        Train an AI grading model from the currently filtered trades. Each trade is scored 0–100 using per-bucket
        expectancy across all research filters, then assigned a grade (A+++ → C). Apply per-grade risk multipliers to
        aggressively size only the top-tier setups.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={train}>Train on {features.length} candidates</Button>
        {model && (
          <>
            <span className="text-[11px] text-muted-foreground">
              Trained on {model.sample_size} decided • {new Date(model.trained_at).toLocaleString()}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={onSave} disabled={saving}>Save to live</Button>
              <Button size="sm" variant="outline" onClick={onClear} disabled={saving}>Clear live</Button>
            </div>
          </>
        )}
      </div>

      {model && (
        <>
          {/* Grade stats table */}
          <div className="rounded border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Grade</th>
                  <th className="text-right px-3 py-2">Trades</th>
                  <th className="text-right px-3 py-2">Win rate</th>
                  <th className="text-right px-3 py-2">Expectancy</th>
                  <th className="text-right px-3 py-2">Net P&amp;L</th>
                  <th className="text-right px-3 py-2">Avg score</th>
                  <th className="text-right px-3 py-2">Risk mult</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((row) => (
                  <tr key={row.grade} className="border-t border-border">
                    <td className="px-3 py-2 font-mono font-semibold" style={{ color: GRADE_COLORS[row.grade] }}>
                      {row.grade}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums">{row.count}</td>
                    <td className="text-right px-3 py-2 tabular-nums">{fmtPct(row.win_rate_pct)}</td>
                    <td className={`text-right px-3 py-2 tabular-nums ${pnlClass(row.expectancy_usd)}`}>
                      {fmtUsd(row.expectancy_usd, 1)}
                    </td>
                    <td className={`text-right px-3 py-2 tabular-nums ${pnlClass(row.net_pnl_usd)}`}>
                      {fmtUsd(row.net_pnl_usd)}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums">{row.avg_score.toFixed(0)}</td>
                    <td className="text-right px-3 py-2 tabular-nums">
                      <Input
                        type="number"
                        min={0}
                        max={10}
                        step={0.25}
                        value={multipliers[row.grade]}
                        onChange={(e) =>
                          setMultipliers((prev) => ({ ...prev, [row.grade]: Number(e.target.value) || 0 }))
                        }
                        className="h-7 w-20 text-xs text-right"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Distribution chart */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-mono">Grade distribution (net P&amp;L)</CardTitle>
              </CardHeader>
              <CardContent className="h-[220px] pt-0">
                <ResponsiveContainer>
                  <BarChart data={stats}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="grade" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtUsd(v)} />
                    <Tooltip formatter={(v: number) => fmtUsd(v)} />
                    <Bar dataKey="net_pnl_usd">
                      {stats.map((s) => (
                        <rect key={s.grade} fill={GRADE_COLORS[s.grade]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-mono">Grade counts</CardTitle>
              </CardHeader>
              <CardContent className="h-[220px] pt-0">
                <ResponsiveContainer>
                  <BarChart data={stats}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="grade" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#6366f1" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Equity simulator */}
          <div className="rounded border border-border p-3 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                Apply AI grade sizing
              </label>
              <div className="flex items-center gap-2 text-xs">
                <span>Min grade:</span>
                <Select value={minGrade} onValueChange={(v) => setMinGrade(v as GradeLabel)}>
                  <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GRADE_ORDER.map((g) => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <span className="text-[11px] text-muted-foreground">1R = ${slRiskUsd}</span>
              {enabled && sim && baseline && (
                <div className="ml-auto flex gap-4 text-xs">
                  <span>Baseline: <span className={pnlClass(baseline.net_pnl_usd)}>{fmtUsd(baseline.net_pnl_usd)}</span> ({baseline.trades} trades)</span>
                  <span>Graded: <span className={pnlClass(sim.net_pnl_usd)}>{fmtUsd(sim.net_pnl_usd)}</span> ({sim.trades} trades, {fmtPct(sim.win_rate_pct)})</span>
                </div>
              )}
            </div>
            {enabled && chartData.length > 0 && (
              <div className="h-[240px]">
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="ist_date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtUsd(v)} />
                    <Tooltip formatter={(v: number) => fmtUsd(v)} />
                    <Line dataKey="baseline" stroke="#64748b" strokeWidth={1.5} dot={false} name="Baseline (1x)" connectNulls />
                    <Line dataKey="graded" stroke="#10b981" strokeWidth={2} dot={false} name="AI-graded" connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
