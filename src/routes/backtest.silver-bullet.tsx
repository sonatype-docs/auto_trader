import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { backtestSilverBullet } from "@/lib/strategy.functions";
import { OptimizerPanel } from "@/components/optimizer-panel";
import {
  StrategyPageShell,
  MetricsGrid,
  ResultCard,
} from "@/components/backtest-strategy-shell";
import { metricsFromSummary, saveSnapshot } from "@/lib/backtest-snapshots";

export const Route = createFileRoute("/backtest/silver-bullet")({
  component: SilverBulletPage,
  head: () => ({
    meta: [
      { title: "ICT Silver Bullet — Backtest" },
      { name: "description", content: "Isolated backtest & optimizer for the ICT Silver Bullet window strategy." },
    ],
  }),
});

type Result = Awaited<ReturnType<typeof backtestSilverBullet>>;

function SilverBulletPage() {
  const run = useServerFn(backtestSilverBullet);
  const [form, setForm] = useState({
    symbol: "XAUUSDT",
    days: 90,
    slRiskUsd: 30,
    rr: 2,
    windowStart: "19:00",
    windowEnd: "20:00",
    holdCutoff: "22:00",
    swingLookback: 20,
    fvgMinUsd: 0,
    slBufferUsd: 0.5,
    maxTradesPerDay: 1,
    executionTf: "5m" as "3m" | "5m" | "15m",
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
          window_start_ist: form.windowStart,
          window_end_ist: form.windowEnd,
          hold_cutoff_ist: form.holdCutoff,
          swing_lookback: form.swingLookback,
          fvg_min_usd: form.fvgMinUsd,
          sl_buffer_usd: form.slBufferUsd,
          max_trades_per_day: form.maxTradesPerDay,
          execution_tf: form.executionTf,
          skip_weekdays: [0, 6],
        },
      }),
    onSuccess: (r) => {
      setData(r);
      const metrics = metricsFromSummary(r.summary);
      saveSnapshot({
        strategy: "silver_bullet",
        label: "ICT Silver Bullet",
        ranAt: Date.now(),
        params: { ...form },
        metrics,
      });
      toast.success(`Silver Bullet: ${metrics.wins}W / ${metrics.losses}L · $${metrics.netPnl.toFixed(0)}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <StrategyPageShell
      title="ICT Silver Bullet"
      subtitle="19:00 IST window · FVG + swing sweep · isolated from live settings"
    >
      <ResultCard title="Parameters">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Symbol">
            <select
              value={form.symbol}
              onChange={(e) => set("symbol", e.target.value)}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
            >
              <option value="XAUUSDT">XAUUSDT</option>
              <option value="BTCUSDT">BTCUSDT</option>
            </select>
          </Field>
          <Field label="Days back">
            <Input type="number" value={form.days} min={7} max={365}
              onChange={(e) => set("days", Math.max(7, Math.min(365, Number(e.target.value) || 90)))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="SL risk ($/trade)">
            <Input type="number" value={form.slRiskUsd}
              onChange={(e) => set("slRiskUsd", Math.max(1, Number(e.target.value) || 30))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="RR (TP=RR)">
            <Input type="number" step="0.1" value={form.rr}
              onChange={(e) => set("rr", Math.max(0.5, Number(e.target.value) || 2))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Window start (IST)">
            <Input type="time" value={form.windowStart}
              onChange={(e) => set("windowStart", e.target.value)}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Window end (IST)">
            <Input type="time" value={form.windowEnd}
              onChange={(e) => set("windowEnd", e.target.value)}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Hold cutoff (IST)">
            <Input type="time" value={form.holdCutoff}
              onChange={(e) => set("holdCutoff", e.target.value)}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Execution TF">
            <select
              value={form.executionTf}
              onChange={(e) => set("executionTf", e.target.value as "3m" | "5m" | "15m")}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
            >
              <option value="3m">3m</option>
              <option value="5m">5m</option>
              <option value="15m">15m</option>
            </select>
          </Field>
          <Field label="Swing lookback">
            <Input type="number" value={form.swingLookback}
              onChange={(e) => set("swingLookback", Number(e.target.value) || 20)}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="FVG min ($)">
            <Input type="number" step="0.1" value={form.fvgMinUsd}
              onChange={(e) => set("fvgMinUsd", Number(e.target.value) || 0)}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="SL buffer ($)">
            <Input type="number" step="0.1" value={form.slBufferUsd}
              onChange={(e) => set("slBufferUsd", Number(e.target.value) || 0)}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Max trades / day">
            <Input type="number" value={form.maxTradesPerDay}
              onChange={(e) => set("maxTradesPerDay", Math.max(1, Number(e.target.value) || 1))}
              className="h-8 font-mono text-xs" />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Running…" : "Run backtest"}
          </Button>
          {data && (
            <span className="text-xs text-muted-foreground font-mono">
              {data.summary.trades} trades · {data.summary.total_days} days
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
        strategy="silver_bullet"
        title="ICT Silver Bullet"
        defaults={{ symbol: form.symbol, slRiskUsd: form.slRiskUsd, skipWeekdays: [0, 6] }}
        onApplyPreset={(g) => {
          const start = String(g.window_start_ist);
          const [sh, sm] = start.split(":").map((n) => parseInt(n, 10));
          const startMin = sh * 60 + (sm || 0);
          const winLen = parseInt(String(g.window_len_min), 10);
          const endMin = Math.min(24 * 60 - 1, startMin + winLen);
          const holdExtra = parseInt(String(g.hold_extra_min), 10);
          const holdMin = Math.min(24 * 60 - 1, endMin + holdExtra);
          const fmt = (m: number) =>
            `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
          setForm((f) => ({
            ...f,
            windowStart: start,
            windowEnd: fmt(endMin),
            holdCutoff: fmt(holdMin),
            swingLookback: Number(g.swing_lookback),
            fvgMinUsd: Number(g.fvg_min_usd),
            slBufferUsd: Number(g.sl_buffer_usd),
            maxTradesPerDay: parseInt(String(g.max_trades_per_day), 10),
            executionTf: g.execution_tf as "3m" | "5m" | "15m",
            rr: Number(g.rr),
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
