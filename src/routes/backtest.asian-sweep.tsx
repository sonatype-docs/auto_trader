import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { backtestLiquiditySweep } from "@/lib/strategy.functions";
import { OptimizerPanel } from "@/components/optimizer-panel";
import {
  StrategyPageShell,
  MetricsGrid,
  ResultCard,
} from "@/components/backtest-strategy-shell";
import { metricsFromSummary, saveSnapshot } from "@/lib/backtest-snapshots";

export const Route = createFileRoute("/backtest/asian-sweep")({
  component: AsianSweepPage,
  head: () => ({
    meta: [
      { title: "Asian Sweep — Backtest" },
      { name: "description", content: "Isolated backtest & optimizer for the Asian range liquidity sweep strategy." },
    ],
  }),
});

type Result = Awaited<ReturnType<typeof backtestLiquiditySweep>>;

function AsianSweepPage() {
  const run = useServerFn(backtestLiquiditySweep);
  const [form, setForm] = useState({
    symbol: "XAUUSDT",
    days: 90,
    slRiskUsd: 30,
    rr: 2,
    asianStart: 3,
    asianEnd: 13,
    entryEnd: 24,
    minRangeUsd: 5,
    entryPullbackPct: 0,
    slBufferPct: 0.1,
    tpMode: "rr" as "rr" | "opposite" | "midrange",
    requireCloseInside: true,
  });
  const [data, setData] = useState<Result | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      run({
        data: {
          symbol: form.symbol,
          days: form.days,
          sl_risk_usd: form.slRiskUsd,
          rr: form.rr,
          asian_start_ist: form.asianStart,
          asian_end_ist: form.asianEnd,
          entry_end_ist: form.entryEnd,
          min_range_usd: form.minRangeUsd,
          entry_pullback_pct: form.entryPullbackPct,
          sl_buffer_pct: form.slBufferPct,
          tp_mode: form.tpMode,
          require_close_inside: form.requireCloseInside,
          skip_weekdays: [0, 6],
        },
      }),
    onSuccess: (r) => {
      setData(r);
      const metrics = metricsFromSummary(r.summary);
      saveSnapshot({
        strategy: "asian_sweep",
        label: "Asian Sweep",
        ranAt: Date.now(),
        params: { ...form },
        metrics,
      });
      toast.success(`Asian Sweep: ${metrics.wins}W / ${metrics.losses}L · $${metrics.netPnl.toFixed(0)}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <StrategyPageShell
      title="Asian Sweep"
      subtitle="Sweep of Asian session range · London/NY entry · isolated from live settings"
    >
      <ResultCard title="Parameters">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Symbol">
            <select value={form.symbol} onChange={(e) => set("symbol", e.target.value)}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs">
              <option value="XAUUSDT">XAUUSDT</option>
              <option value="BTCUSDT">BTCUSDT</option>
            </select>
          </Field>
          <Field label="Days back">
            <Input type="number" value={form.days}
              onChange={(e) => set("days", Math.max(7, Math.min(365, Number(e.target.value) || 90)))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="SL risk ($)">
            <Input type="number" value={form.slRiskUsd}
              onChange={(e) => set("slRiskUsd", Math.max(1, Number(e.target.value) || 30))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="RR">
            <Input type="number" step="0.1" value={form.rr}
              onChange={(e) => set("rr", Math.max(0.5, Number(e.target.value) || 2))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Asia start (IST hr)">
            <Input type="number" min={0} max={23} value={form.asianStart}
              onChange={(e) => set("asianStart", Number(e.target.value) || 0)}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Asia end (IST hr)">
            <Input type="number" min={1} max={24} value={form.asianEnd}
              onChange={(e) => set("asianEnd", Number(e.target.value) || 13)}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Entry end (IST hr)">
            <Input type="number" min={1} max={24} value={form.entryEnd}
              onChange={(e) => set("entryEnd", Number(e.target.value) || 24)}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Min Asia range ($)">
            <Input type="number" value={form.minRangeUsd}
              onChange={(e) => set("minRangeUsd", Number(e.target.value) || 0)}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Pullback (% of range)">
            <Input type="number" step="0.05" value={form.entryPullbackPct}
              onChange={(e) => set("entryPullbackPct", Math.max(0, Math.min(1, Number(e.target.value) || 0)))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="SL buffer (% of range)">
            <Input type="number" step="0.05" value={form.slBufferPct}
              onChange={(e) => set("slBufferPct", Math.max(0, Math.min(1, Number(e.target.value) || 0.1)))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="TP mode">
            <select value={form.tpMode} onChange={(e) => set("tpMode", e.target.value as typeof form.tpMode)}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs">
              <option value="rr">RR multiple</option>
              <option value="opposite">Opposite Asia level</option>
              <option value="midrange">Asia midrange</option>
            </select>
          </Field>
          <Field label="Require close inside">
            <select value={form.requireCloseInside ? "y" : "n"}
              onChange={(e) => set("requireCloseInside", e.target.value === "y")}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs">
              <option value="y">Yes</option>
              <option value="n">No</option>
            </select>
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Running…" : "Run backtest"}
          </Button>
          {data && (
            <span className="text-xs text-muted-foreground font-mono">
              {data.summary.sweeps} sweeps · {data.summary.triggered} triggered
            </span>
          )}
        </div>
      </ResultCard>

      {data && (
        <ResultCard title="Results">
          <MetricsGrid m={metricsFromSummary(data.summary)} />
        </ResultCard>
      )}

      <OptimizerPanel
        strategy="asian_sweep"
        title="Asian Sweep"
        defaults={{ symbol: form.symbol, slRiskUsd: form.slRiskUsd, skipWeekdays: [0, 6] }}
        onApplyPreset={(g) => {
          const asianStart = Number(g.asian_start_ist);
          const asianEnd = Math.min(23, asianStart + Number(g.asian_len));
          const entryEnd = Math.min(24, asianEnd + Number(g.entry_len));
          setForm((f) => ({
            ...f,
            rr: Number(g.rr),
            asianStart,
            asianEnd,
            entryEnd,
            minRangeUsd: Number(g.min_range_usd),
            entryPullbackPct: Number(g.entry_pullback_pct),
            slBufferPct: Number(g.sl_buffer_pct),
            tpMode: g.tp_mode as "rr" | "opposite" | "midrange",
            requireCloseInside: Boolean(g.require_close_inside),
          }));
        }}
      />
    </StrategyPageShell>
  );
}


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
