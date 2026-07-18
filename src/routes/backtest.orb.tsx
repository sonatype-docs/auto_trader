import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { backtestSessionsCompare } from "@/lib/strategy.functions";
import { OptimizerPanel } from "@/components/optimizer-panel";
import { DEFAULT_FILTERS } from "@/lib/strategy/filters";
import {
  StrategyPageShell,
  MetricsGrid,
  ResultCard,
} from "@/components/backtest-strategy-shell";
import { metricsFromSummary, saveSnapshot } from "@/lib/backtest-snapshots";

export const Route = createFileRoute("/backtest/orb")({
  component: OrbPage,
  head: () => ({
    meta: [
      { title: "Multi-Session ORB — Backtest" },
      { name: "description", content: "Compare opening-range breakout across multiple session start times." },
    ],
  }),
});

type Result = Awaited<ReturnType<typeof backtestSessionsCompare>>;

const DEFAULT_SESSIONS = ["04:30", "05:30", "06:30", "09:30", "12:30"];

function OrbPage() {
  const run = useServerFn(backtestSessionsCompare);
  const [form, setForm] = useState({
    symbol: "XAUUSDT",
    days: 90,
    slRiskUsd: 30,
    rr: 2,
    trailEnabled: false,
    trailActivateR: 2,
    trailStepR: 1,
    sessions: [...DEFAULT_SESSIONS],
    newSession: "",
  });
  const [data, setData] = useState<Result | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      run({
        data: {
          days: form.days,
          symbol: form.symbol,
          sl_risk_usd: form.slRiskUsd,
          rr: form.rr,
          trail_enabled: form.trailEnabled,
          trail_activate_r: form.trailActivateR,
          trail_step_r: form.trailStepR,
          skip_weekdays: [0, 6],
          sessions: form.sessions,
          filters: DEFAULT_FILTERS,
        },
      }),
    onSuccess: (r) => {
      setData(r);
      // Use best session by net P&L as the representative snapshot.
      const best = [...r.sessions].sort(
        (a, b) => b.summary.net_pnl_usd - a.summary.net_pnl_usd,
      )[0];
      if (best) {
        const metrics = metricsFromSummary(best.summary);
        saveSnapshot({
          strategy: "orb_sessions",
          label: "Multi-Session ORB",
          ranAt: Date.now(),
          params: { ...form, bestSession: best.session },
          metrics,
          note: `Best session: ${best.session} IST`,
        });
      }
      toast.success(`Ran ${r.sessions.length} sessions — best ${best?.session} ($${best?.summary.net_pnl_usd.toFixed(0)})`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const addSession = () => {
    const s = form.newSession.trim();
    if (!/^\d{2}:\d{2}$/.test(s)) {
      toast.error("Use HH:MM format");
      return;
    }
    if (form.sessions.includes(s)) return;
    setForm({ ...form, sessions: [...form.sessions, s].sort(), newSession: "" });
  };

  const removeSession = (s: string) =>
    setForm({ ...form, sessions: form.sessions.filter((x) => x !== s) });

  const sorted = data
    ? [...data.sessions].sort((a, b) => b.summary.net_pnl_usd - a.summary.net_pnl_usd)
    : [];

  return (
    <StrategyPageShell
      title="Multi-Session ORB"
      subtitle="Fib-zone engine replayed across multiple session start times to find the best hour"
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
        </div>

        <div className="mt-4 space-y-2">
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Sessions (IST) — one backtest per entry
          </Label>
          <div className="flex flex-wrap gap-1">
            {form.sessions.map((s) => (
              <Badge key={s} variant="secondary" className="cursor-pointer"
                onClick={() => removeSession(s)}>
                {s} ✕
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input placeholder="HH:MM" value={form.newSession}
              onChange={(e) => set("newSession", e.target.value)}
              className="h-8 w-28 font-mono text-xs" />
            <Button size="sm" variant="outline" onClick={addSession}>Add</Button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" onClick={() => mut.mutate()} disabled={mut.isPending || form.sessions.length === 0}>
            {mut.isPending ? `Running ${form.sessions.length} sessions…` : "Run backtest"}
          </Button>
        </div>
      </ResultCard>

      {sorted.length > 0 && (
        <ResultCard title="Best session">
          <MetricsGrid m={metricsFromSummary(sorted[0].summary)} />
          <p className="mt-2 text-xs text-muted-foreground font-mono">
            Best session start: <span className="text-primary">{sorted[0].session} IST</span>
          </p>
        </ResultCard>
      )}

      {sorted.length > 0 && (
        <ResultCard title="Per-session ranking">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-left border-b text-muted-foreground">
                  <th className="py-1 pr-3">Session</th>
                  <th className="py-1 pr-3">Net P&amp;L</th>
                  <th className="py-1 pr-3">Trades</th>
                  <th className="py-1 pr-3">W / L</th>
                  <th className="py-1 pr-3">Win %</th>
                  <th className="py-1 pr-3">PF</th>
                  <th className="py-1 pr-3">Avg R</th>
                  <th className="py-1 pr-3">Max DD</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.session} className="border-b border-border/30">
                    <td className="py-1 pr-3 font-semibold">{s.session}</td>
                    <td className={`py-1 pr-3 ${s.summary.net_pnl_usd >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      ${s.summary.net_pnl_usd.toFixed(0)}
                    </td>
                    <td className="py-1 pr-3">{s.summary.triggered}</td>
                    <td className="py-1 pr-3">
                      <span className="text-emerald-500">{s.summary.tp}</span>
                      {" / "}
                      <span className="text-red-500">{s.summary.sl}</span>
                    </td>
                    <td className="py-1 pr-3">{s.summary.win_rate_pct.toFixed(1)}</td>
                    <td className="py-1 pr-3">
                      {isFinite(s.summary.profit_factor) ? s.summary.profit_factor.toFixed(2) : "∞"}
                    </td>
                    <td className="py-1 pr-3">{s.summary.avg_r.toFixed(2)}</td>
                    <td className="py-1 pr-3 text-red-500">${s.summary.max_drawdown_usd.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ResultCard>
      )}

      <OptimizerPanel
        strategy="orb_sessions"
        title="Multi-Session ORB"
        defaults={{ symbol: form.symbol, slRiskUsd: form.slRiskUsd, skipWeekdays: [0, 6] }}
        onApplyPreset={(g) => {
          const session = String(g.session_start_ist);
          setForm((f) => ({
            ...f,
            rr: Number(g.rr),
            trailEnabled: Boolean(g.trail_enabled),
            trailActivateR: Number(g.trail_activate_r),
            trailStepR: Number(g.trail_step_r),
            sessions: f.sessions.includes(session) ? f.sessions : [session, ...f.sessions],
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
