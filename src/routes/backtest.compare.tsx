import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  backtestSilverBullet,
  backtestLiquiditySweep,
  backtestSessionsCompare,
  backtestRange,
} from "@/lib/strategy.functions";
import { DEFAULT_FILTERS } from "@/lib/strategy/filters";
import {
  StrategyPageShell,
  ResultCard,
} from "@/components/backtest-strategy-shell";
import {
  metricsFromSummary,
  readSnapshots,
  saveSnapshot,
  clearSnapshots,
  type StrategyId,
  type StrategySnapshot,
} from "@/lib/backtest-snapshots";

export const Route = createFileRoute("/backtest/compare")({
  component: ComparePage,
  head: () => ({
    meta: [
      { title: "Strategy Comparison — Backtest" },
      { name: "description", content: "Side-by-side comparison of every strategy engine." },
    ],
  }),
});

const ORDER: StrategyId[] = ["fib_zone", "silver_bullet", "asian_sweep", "orb_sessions"];
const LABELS: Record<StrategyId, string> = {
  fib_zone: "Fib Zone",
  silver_bullet: "ICT Silver Bullet",
  asian_sweep: "Asian Sweep",
  orb_sessions: "Multi-Session ORB",
};
const LINKS: Record<StrategyId, string> = {
  fib_zone: "/backtest",
  silver_bullet: "/backtest/silver-bullet",
  asian_sweep: "/backtest/asian-sweep",
  orb_sessions: "/backtest/orb",
};

function ComparePage() {
  const [snaps, setSnaps] = useState<Partial<Record<StrategyId, StrategySnapshot>>>({});
  const [shared, setShared] = useState({
    symbol: "XAUUSDT",
    days: 90,
    slRiskUsd: 30,
    rr: 2,
    sessionStart: "06:30",
  });

  useEffect(() => setSnaps(readSnapshots()), []);

  const runFib = useServerFn(backtestRange);
  const runSb = useServerFn(backtestSilverBullet);
  const runSweep = useServerFn(backtestLiquiditySweep);
  const runOrb = useServerFn(backtestSessionsCompare);

  const runAll = useMutation({
    mutationFn: async () => {
      const base = {
        symbol: shared.symbol,
        days: shared.days,
        sl_risk_usd: shared.slRiskUsd,
        rr: shared.rr,
        skip_weekdays: [0, 6],
      };
      const [fib, sb, sweep, orb] = await Promise.allSettled([
        runFib({
          data: {
            ...base,
            session_start_ist: shared.sessionStart,
            filters: DEFAULT_FILTERS,
          },
        }),
        runSb({ data: { ...base } }),
        runSweep({
          data: {
            ...base,
            asian_start_ist: 3,
            asian_end_ist: 13,
            entry_end_ist: 24,
            tp_mode: "rr" as const,
            require_close_inside: true,
            sl_buffer_pct: 0.1,
          },
        }),
        runOrb({
          data: {
            ...base,
            sessions: ["04:30", "05:30", "06:30", "09:30", "12:30"],
            filters: DEFAULT_FILTERS,
          },
        }),
      ]);
      return { fib, sb, sweep, orb };
    },
    onSuccess: ({ fib, sb, sweep, orb }) => {
      const now = Date.now();
      const paramsBase = { ...shared };
      if (fib.status === "fulfilled") {
        saveSnapshot({
          strategy: "fib_zone",
          label: LABELS.fib_zone,
          ranAt: now,
          params: paramsBase,
          metrics: metricsFromSummary(fib.value.summary),
        });
      }
      if (sb.status === "fulfilled") {
        saveSnapshot({
          strategy: "silver_bullet",
          label: LABELS.silver_bullet,
          ranAt: now,
          params: paramsBase,
          metrics: metricsFromSummary(sb.value.summary),
        });
      }
      if (sweep.status === "fulfilled") {
        saveSnapshot({
          strategy: "asian_sweep",
          label: LABELS.asian_sweep,
          ranAt: now,
          params: paramsBase,
          metrics: metricsFromSummary(sweep.value.summary),
        });
      }
      if (orb.status === "fulfilled") {
        const best = [...orb.value.sessions].sort(
          (a, b) => b.summary.net_pnl_usd - a.summary.net_pnl_usd,
        )[0];
        if (best) {
          saveSnapshot({
            strategy: "orb_sessions",
            label: LABELS.orb_sessions,
            ranAt: now,
            params: { ...paramsBase, bestSession: best.session },
            metrics: metricsFromSummary(best.summary),
            note: `Best session: ${best.session} IST`,
          });
        }
      }
      setSnaps(readSnapshots());
      const failed = [fib, sb, sweep, orb].filter((x) => x.status === "rejected").length;
      if (failed === 0) toast.success("All 4 strategies ran successfully");
      else toast.warning(`${4 - failed}/4 succeeded — see individual pages for errors`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof typeof shared>(k: K, v: (typeof shared)[K]) =>
    setShared((s) => ({ ...s, [k]: v }));

  const filled = ORDER.filter((k) => snaps[k]);
  const best = filled.length > 0
    ? filled.reduce((best, k) =>
        (snaps[k]!.metrics.netPnl > snaps[best]!.metrics.netPnl ? k : best),
      filled[0])
    : null;

  return (
    <StrategyPageShell
      title="Strategy Comparison"
      subtitle="Side-by-side ranking of every engine — from latest run per strategy or a fresh apples-to-apples run"
    >
      <ResultCard title="Run all with shared inputs">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Field label="Symbol">
            <select value={shared.symbol} onChange={(e) => set("symbol", e.target.value)}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs">
              <option value="XAUUSDT">XAUUSDT</option>
              <option value="BTCUSDT">BTCUSDT</option>
            </select>
          </Field>
          <Field label="Days back">
            <Input type="number" value={shared.days}
              onChange={(e) => set("days", Math.max(7, Math.min(365, Number(e.target.value) || 90)))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="SL risk ($)">
            <Input type="number" value={shared.slRiskUsd}
              onChange={(e) => set("slRiskUsd", Math.max(1, Number(e.target.value) || 30))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="RR">
            <Input type="number" step="0.1" value={shared.rr}
              onChange={(e) => set("rr", Math.max(0.5, Number(e.target.value) || 2))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Fib session start (IST)">
            <Input type="time" value={shared.sessionStart}
              onChange={(e) => set("sessionStart", e.target.value)}
              className="h-8 font-mono text-xs" />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => runAll.mutate()} disabled={runAll.isPending}>
            {runAll.isPending ? "Running all 4 engines…" : "Run all with these inputs"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { clearSnapshots(); setSnaps({}); }}>
            Clear snapshots
          </Button>
          <p className="text-[11px] text-muted-foreground">
            This runs Fib Zone, Silver Bullet, Asian Sweep, and Multi-Session ORB in parallel
            with the same symbol / days / risk / RR — the fairest cross-strategy comparison.
          </p>
        </div>
      </ResultCard>

      <ResultCard title="Comparison table">
        {filled.length === 0 ? (
          <div className="rounded border border-dashed p-6 text-center text-xs text-muted-foreground">
            No runs yet. Either use “Run all” above, or visit each strategy page and run a backtest —
            results auto-populate here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] font-mono">
              <thead>
                <tr className="text-left border-b text-muted-foreground text-[10px] uppercase tracking-widest">
                  <th className="py-2 pr-3">Strategy</th>
                  <th className="py-2 pr-3">Net P&amp;L</th>
                  <th className="py-2 pr-3">Trades</th>
                  <th className="py-2 pr-3">W / L</th>
                  <th className="py-2 pr-3">Win %</th>
                  <th className="py-2 pr-3">PF</th>
                  <th className="py-2 pr-3">Avg R</th>
                  <th className="py-2 pr-3">Max DD</th>
                  <th className="py-2 pr-3">Ran</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {ORDER.filter((k) => snaps[k]).map((k) => {
                  const s = snaps[k]!;
                  const m = s.metrics;
                  const isBest = k === best;
                  return (
                    <tr
                      key={k}
                      className={`border-b border-border/30 ${isBest ? "bg-emerald-500/5" : ""}`}
                    >
                      <td className="py-2 pr-3 font-semibold">
                        {s.label}
                        {isBest && (
                          <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] text-emerald-500">
                            BEST
                          </span>
                        )}
                        {s.note && (
                          <div className="text-[10px] font-normal text-muted-foreground mt-0.5">
                            {s.note}
                          </div>
                        )}
                      </td>
                      <td className={`py-2 pr-3 ${m.netPnl >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                        ${m.netPnl.toFixed(0)}
                      </td>
                      <td className="py-2 pr-3">{m.trades}</td>
                      <td className="py-2 pr-3">
                        <span className="text-emerald-500">{m.wins}</span>
                        {" / "}
                        <span className="text-red-500">{m.losses}</span>
                      </td>
                      <td className="py-2 pr-3">{m.winRatePct.toFixed(1)}</td>
                      <td className="py-2 pr-3">
                        {isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : "∞"}
                      </td>
                      <td className="py-2 pr-3">{m.avgR.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-red-500">${m.maxDd.toFixed(0)}</td>
                      <td className="py-2 pr-3 text-muted-foreground text-[10px]">
                        {new Date(s.ranAt).toLocaleTimeString()}
                      </td>
                      <td className="py-2 pr-3">
                        <Link to={LINKS[k]} className="text-primary hover:underline text-[11px]">
                          open →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ResultCard>

      <ResultCard title="All strategies">
        <div className="grid gap-2 md:grid-cols-4">
          {ORDER.map((k) => (
            <Link
              key={k}
              to={LINKS[k]}
              className="rounded-md border border-border/60 p-3 hover:border-primary/60 hover:bg-primary/5 transition"
            >
              <div className="text-sm font-semibold">{LABELS[k]}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {snaps[k]
                  ? `last: $${snaps[k]!.metrics.netPnl.toFixed(0)} · ${snaps[k]!.metrics.winRatePct.toFixed(0)}% win`
                  : "no run yet"}
              </div>
            </Link>
          ))}
        </div>
      </ResultCard>
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
