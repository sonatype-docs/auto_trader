import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { runStrategyOptimizer } from "@/lib/strategy.functions";

type OptResult = Awaited<ReturnType<typeof runStrategyOptimizer>>;

const ALL_WINDOWS = [30, 60, 90, 180, 365];

export function OptimizerPanel(props: {
  strategy: "silver_bullet" | "asian_sweep" | "orb_sessions";
  title: string;
  defaults: { symbol: string; slRiskUsd: number; skipWeekdays: number[] };
  onApplyPreset?: (genome: Record<string, string | number | boolean>) => void;
}) {
  const run = useServerFn(runStrategyOptimizer);
  const [windows, setWindows] = useState<number[]>([...ALL_WINDOWS]);
  const [population, setPopulation] = useState(40);
  const [generations, setGenerations] = useState(25);
  const [data, setData] = useState<OptResult | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      run({
        data: {
          strategy: props.strategy,
          symbol: props.defaults.symbol,
          windows: [...windows].sort((a, b) => a - b),
          sl_risk_usd: props.defaults.slRiskUsd,
          skip_weekdays: props.defaults.skipWeekdays,
          population,
          generations,
          top_n: 20,
        },
      }),
    onSuccess: (r) => {
      setData(r);
      if (r.error) {
        toast.error(`Optimizer failed: ${r.error}`);
      } else {
        toast.success(
          r.top.length > 0
            ? `Optimizer found ${r.top.length} profitable presets · best net $${r.top[0].total_net_pnl.toFixed(0)}`
            : "Optimizer completed — no preset passed the OOS gates.",
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleWindow = (d: number) =>
    setWindows((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort((a, b) => a - b)));

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="text-sm font-mono tracking-widest">
          {props.title} · OPTIMIZER
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Genetic search across thousands of parameter combos. Every candidate is scored on
          70/30 in-sample / out-of-sample splits per selected window. Only presets that stay
          profitable OOS across all windows are surfaced.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-1">
              Windows (days)
            </div>
            <div className="flex flex-wrap gap-1">
              {ALL_WINDOWS.map((d) => (
                <Badge
                  key={d}
                  variant={windows.includes(d) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleWindow(d)}
                >
                  {d}d
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-1">
              Population
            </div>
            <input
              type="number"
              className="w-24 rounded-md border bg-background px-2 py-1 text-sm"
              value={population}
              min={20}
              max={120}
              onChange={(e) => setPopulation(Number(e.target.value) || 40)}
            />
          </div>
          <div>
            <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-1">
              Generations
            </div>
            <input
              type="number"
              className="w-24 rounded-md border bg-background px-2 py-1 text-sm"
              value={generations}
              min={5}
              max={60}
              onChange={(e) => setGenerations(Number(e.target.value) || 25)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={mut.isPending || windows.length === 0}
            onClick={() => mut.mutate()}
          >
            {mut.isPending
              ? `Running ~${population * generations} evals…`
              : "Run optimizer"}
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Symbol <span className="font-mono">{props.defaults.symbol}</span> · risk $
            {props.defaults.slRiskUsd}/trade. Runs synchronously; larger population × generations
            = deeper search but slower.
          </p>
        </div>

        {data && (
          <div className="space-y-3">
            <div className="text-[11px] text-muted-foreground font-mono">
              evaluated {data.evaluated} genomes · cache hits {data.cache_hits} · bars fetched{" "}
              {data.bars_fetched} · {(data.elapsed_ms / 1000).toFixed(1)}s
            </div>
            {data.error ? (
              <div className="rounded border border-red-500/50 bg-red-500/5 p-4 text-xs text-red-500 font-mono whitespace-pre-wrap">
                {data.error}
              </div>
            ) : data.top.length === 0 ? (
              <div className="rounded border border-dashed p-4 text-xs text-muted-foreground">
                No parameter combo passed the out-of-sample gates for every selected window.
                Try fewer / shorter windows, more generations, or relax the symbol / risk.
              </div>
            ) : (
              <div className="space-y-4">
                {data.top.map((p) => (
                  <PresetCard
                    key={p.rank}
                    preset={p}
                    strategy={props.strategy}
                    onApply={
                      props.onApplyPreset
                        ? () => {
                            props.onApplyPreset!(p.genome);
                            toast.success(`Preset #${p.rank} applied to parameters above`);
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Friendly labels mapped to the dashboard config fields
const SB_LABELS: Record<string, string> = {
  window_start_ist: "Window start (IST)",
  window_len_min: "Window length (min)",
  hold_extra_min: "Hold cutoff extra (min)",
  swing_lookback: "Swing lookback",
  fvg_min_usd: "FVG min ($)",
  sl_buffer_usd: "SL buffer ($)",
  max_trades_per_day: "Max trades / day",
  execution_tf: "Execution TF",
  rr: "RR (TP=RR)",
};
const SWEEP_LABELS: Record<string, string> = {
  asian_start_ist: "Asia start (IST hour)",
  asian_len: "Asia length (hrs)",
  entry_len: "Entry window (hrs)",
  min_range_usd: "Min Asia range ($)",
  entry_pullback_pct: "Pullback entry (% of range)",
  sl_buffer_pct: "SL buffer (% of range)",
  tp_mode: "TP mode",
  require_close_inside: "Require close back inside",
  rr: "RR (when TP=RR)",
};
const ORB_LABELS: Record<string, string> = {
  session_start_ist: "Session start (IST)",
  rr: "RR",
  entry_mode: "Entry mode",
  entry_depth_pct: "Entry depth (% of range)",
  sl_depth_pct: "SL depth (% of range)",
  retest_sl_r: "Retest SL (R)",
  trail_enabled: "Trailing SL",
  trail_activate_r: "Trail activate (R)",
  trail_step_r: "Trail step (R)",
};

function PresetCard({
  preset,
  strategy,
  onApply,
}: {
  preset: OptResult["top"][number];
  strategy: "silver_bullet" | "asian_sweep" | "orb_sessions";
  onApply?: () => void;
}) {
  const labels =
    strategy === "silver_bullet"
      ? SB_LABELS
      : strategy === "asian_sweep"
        ? SWEEP_LABELS
        : ORB_LABELS;
  const net = preset.total_net_pnl;
  return (
    <div className="rounded-md border border-border/60 p-3 space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-xs font-mono text-muted-foreground">#{preset.rank}</span>
        <span className="text-lg font-mono font-semibold">
          <span className={net >= 0 ? "text-emerald-500" : "text-red-500"}>
            ${net.toFixed(0)}
          </span>
          <span className="text-xs text-muted-foreground ml-1">total P&amp;L</span>
        </span>
        <span className="text-xs font-mono">
          <span className="text-muted-foreground">trades </span>
          {preset.total_trades}
          <span className="text-muted-foreground"> · W </span>
          <span className="text-emerald-500">{preset.total_wins}</span>
          <span className="text-muted-foreground"> · L </span>
          <span className="text-red-500">{preset.total_losses}</span>
          <span className="text-muted-foreground"> · win% </span>
          {preset.total_win_rate.toFixed(1)}
          <span className="text-muted-foreground"> · avgR </span>
          {preset.total_avg_r.toFixed(2)}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground ml-auto">
          OOS passed {preset.windows_passed}/{preset.windows.length} · score{" "}
          {preset.score.toFixed(0)}
        </span>
        {onApply && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onApply}>
            Apply to parameters
          </Button>
        )}
      </div>

      {/* Per-window P&L table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="text-left border-b text-muted-foreground">
              <th className="py-1 pr-3">Window</th>
              <th className="py-1 pr-3">P&amp;L</th>
              <th className="py-1 pr-3">Trades</th>
              <th className="py-1 pr-3">W / L</th>
              <th className="py-1 pr-3">Win %</th>
              <th className="py-1 pr-3">Avg R</th>
              <th className="py-1 pr-3">PF</th>
              <th className="py-1 pr-3">OOS $</th>
              <th className="py-1 pr-3">OOS ok</th>
            </tr>
          </thead>
          <tbody>
            {preset.windows.map((w) => (
              <tr key={w.days} className="border-b border-border/30">
                <td className="py-1 pr-3">{w.days}d</td>
                <td
                  className={`py-1 pr-3 ${w.combined.net_pnl >= 0 ? "text-emerald-500" : "text-red-500"}`}
                >
                  ${w.combined.net_pnl.toFixed(0)}
                </td>
                <td className="py-1 pr-3">{w.combined.trades}</td>
                <td className="py-1 pr-3">
                  <span className="text-emerald-500">{w.combined.wins}</span>
                  {" / "}
                  <span className="text-red-500">{w.combined.losses}</span>
                </td>
                <td className="py-1 pr-3">{w.combined.win_rate.toFixed(1)}</td>
                <td className="py-1 pr-3">{w.combined.avg_r.toFixed(2)}</td>
                <td className="py-1 pr-3">
                  {isFinite(w.combined.profit_factor)
                    ? w.combined.profit_factor.toFixed(2)
                    : "∞"}
                </td>
                <td
                  className={`py-1 pr-3 ${w.oos.net_pnl >= 0 ? "text-emerald-500" : "text-red-500"}`}
                >
                  ${w.oos.net_pnl.toFixed(0)}
                </td>
                <td className="py-1 pr-3">
                  {w.oos_pass ? (
                    <span className="text-emerald-500">✓</span>
                  ) : (
                    <span className="text-muted-foreground">·</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Settings mapped to dashboard field names */}
      <div>
        <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-1">
          Settings to use
        </div>
        <div className="grid gap-x-4 gap-y-1 text-[11px] font-mono md:grid-cols-3 lg:grid-cols-4">
          {Object.entries(preset.genome).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-dashed border-border/40 py-0.5">
              <span className="text-muted-foreground">{labels[k] ?? k}</span>
              <span>{String(v)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
