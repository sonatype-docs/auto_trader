import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { runLondonOrb, optimizeLondonOrbFn } from "@/lib/london-orb.functions";
import { saveSnapshot, type StrategyMetrics } from "@/lib/backtest-snapshots";
import { DEFAULT_LONDON_ORB, type LondonOrbOpts } from "@/lib/strategy/london-orb.server";

type RunResult = Awaited<ReturnType<typeof runLondonOrb>>;
type OptResult = Awaited<ReturnType<typeof optimizeLondonOrbFn>>;

export function LondonOrbBacktester() {
  const run = useServerFn(runLondonOrb);
  const opt = useServerFn(optimizeLondonOrbFn);
  const [form, setForm] = useState<LondonOrbOpts>({ ...DEFAULT_LONDON_ORB });
  const [data, setData] = useState<RunResult | null>(null);
  const [optData, setOptData] = useState<OptResult | null>(null);

  const runMut = useMutation({
    mutationFn: () => run({ data: form }),
    onSuccess: (r) => {
      setData(r);
      const s = r.summary;
      const metrics: StrategyMetrics = {
        trades: s.tp + s.sl,
        wins: s.tp,
        losses: s.sl,
        winRatePct: s.win_rate_pct,
        netPnl: s.net_pnl_usd,
        profitFactor: isFinite(s.profit_factor) ? s.profit_factor : 0,
        avgR: s.avg_r,
        maxDd: s.max_drawdown_usd,
      };
      saveSnapshot({
        // Reuse orb_sessions slot in the shared compare hub.
        strategy: "orb_sessions",
        label: "London ORB",
        ranAt: Date.now(),
        params: { ...form },
        metrics,
        note: `Range ${form.rangeStartUtc}-${form.rangeEndUtc} UTC · ${form.entryVariant}/${form.stopModel}/${form.targetModel}`,
      });
      toast.success(
        `London ORB · ${metrics.wins}W / ${metrics.losses}L · $${metrics.netPnl.toFixed(0)} · edge ${s.edge_score}`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const optMut = useMutation({
    mutationFn: () => opt({ data: { ...form, topN: 12 } }),
    onSuccess: (r) => {
      setOptData(r);
      toast.success(`Evaluated ${r.evaluated} presets in ${(r.elapsed_ms / 1000).toFixed(1)}s`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof LondonOrbOpts>(k: K, v: LondonOrbOpts[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      {/* Parameters */}
      <div className="space-y-4">
        <ParamGroup label="Range">
          <Field label="Symbol">
            <select
              value={form.symbol}
              onChange={(e) => set("symbol", e.target.value)}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
            >
              <option value="XAUUSDT">XAUUSDT (Gold)</option>
              <option value="BTCUSDT">BTCUSDT</option>
            </select>
          </Field>
          <Field label="Data source">
            <select
              value={form.dataSource ?? "yahoo"}
              onChange={(e) => set("dataSource", e.target.value as "shark" | "yahoo")}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
            >
              <option value="yahoo">Yahoo (GC=F, ~730d)</option>
              <option value="shark">Shark (perp, ~180d)</option>
            </select>
          </Field>
          <Field label="Days back">
            <Input type="number" min={14} max={720} value={form.days}
              onChange={(e) => set("days", Math.max(14, Math.min(720, Number(e.target.value) || 180)))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Range start (UTC)">
            <Input type="time" value={form.rangeStartUtc}
              onChange={(e) => set("rangeStartUtc", e.target.value)}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Range end (UTC)">
            <Input type="time" value={form.rangeEndUtc}
              onChange={(e) => set("rangeEndUtc", e.target.value)}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Entry cutoff (UTC)">
            <Input type="time" value={form.entryCutoffUtc}
              onChange={(e) => set("entryCutoffUtc", e.target.value)}
              className="h-8 font-mono text-xs" />
          </Field>
        </ParamGroup>

        <ParamGroup label="Entry">
          <Field label="Variant">
            <select
              value={form.entryVariant}
              onChange={(e) => set("entryVariant", e.target.value as LondonOrbOpts["entryVariant"])}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
            >
              <option value="immediate">A · Immediate wick break</option>
              <option value="break_close">B · Break candle close</option>
              <option value="retest">C · Retest range edge</option>
            </select>
          </Field>
          <Field label="Retest buffer (% of OR)">
            <Input type="number" step="1" value={form.retestBufferPct}
              onChange={(e) => set("retestBufferPct", Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Time-to-fill max (h)">
            <Input type="number" step="0.5" value={form.timeToFillMaxHours}
              onChange={(e) => set("timeToFillMaxHours", Math.max(0.5, Number(e.target.value) || 4))}
              className="h-8 font-mono text-xs" />
          </Field>
        </ParamGroup>

        <ParamGroup label="Stops">
          <Field label="Model">
            <select
              value={form.stopModel}
              onChange={(e) => set("stopModel", e.target.value as LondonOrbOpts["stopModel"])}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
            >
              <option value="opposite_range">Opposite range edge</option>
              <option value="range_pct">% of OR height</option>
              <option value="atr_mult">ATR multiple</option>
              <option value="fixed_r">Fixed R (½ OR)</option>
            </select>
          </Field>
          <Field label="Range %">
            <Input type="number" step="0.05" value={form.stopRangePct}
              onChange={(e) => set("stopRangePct", Math.max(0.05, Number(e.target.value) || 0.5))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="ATR mult">
            <Input type="number" step="0.1" value={form.stopAtrMult}
              onChange={(e) => set("stopAtrMult", Math.max(0.1, Number(e.target.value) || 1.5))}
              className="h-8 font-mono text-xs" />
          </Field>
        </ParamGroup>

        <ParamGroup label="Targets & Risk">
          <Field label="Target model">
            <select
              value={form.targetModel}
              onChange={(e) => set("targetModel", e.target.value as LondonOrbOpts["targetModel"])}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
            >
              <option value="fixed_rr">Fixed RR</option>
              <option value="opposite_range">Opposite range edge</option>
              <option value="atr_mult">ATR multiple</option>
            </select>
          </Field>
          <Field label="RR">
            <Input type="number" step="0.1" value={form.rr}
              onChange={(e) => set("rr", Math.max(0.5, Number(e.target.value) || 2))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Target ATR mult">
            <Input type="number" step="0.1" value={form.targetAtrMult}
              onChange={(e) => set("targetAtrMult", Math.max(0.1, Number(e.target.value) || 2))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="SL risk ($)">
            <Input type="number" value={form.slRiskUsd}
              onChange={(e) => set("slRiskUsd", Math.max(1, Number(e.target.value) || 30))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Max hold (h)">
            <Input type="number" step="0.5" value={form.maxHoldHours}
              onChange={(e) => set("maxHoldHours", Math.max(0, Number(e.target.value) || 12))}
              className="h-8 font-mono text-xs" />
          </Field>
        </ParamGroup>

        <ParamGroup label="Filters">
          <Field label="Trend">
            <select
              value={form.trend}
              onChange={(e) => set("trend", e.target.value as LondonOrbOpts["trend"])}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
            >
              <option value="off">Off</option>
              <option value="ema20">EMA20</option>
              <option value="ema50">EMA50</option>
              <option value="ema200">EMA200</option>
              <option value="align_20_50_200">Aligned 20/50/200</option>
            </select>
          </Field>
          <Field label="Min break body %">
            <Input type="number" step="5" value={form.minBreakBodyPct}
              onChange={(e) => set("minBreakBodyPct", Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Min break dist % of OR">
            <Input type="number" step="1" value={form.minBreakDistancePct}
              onChange={(e) => set("minBreakDistancePct", Math.max(0, Number(e.target.value) || 0))}
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Max break dist % of OR">
            <Input type="number" step="5"
              value={form.maxBreakDistancePct ?? ""}
              onChange={(e) => {
                const v = e.target.value.trim();
                set("maxBreakDistancePct", v === "" ? null : Number(v));
              }}
              placeholder="none"
              className="h-8 font-mono text-xs" />
          </Field>
          <Field label="Skip weekdays">
            <div className="flex flex-wrap gap-1">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => (
                <Badge key={d}
                  variant={form.skipWeekdays.includes(i) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => set("skipWeekdays",
                    form.skipWeekdays.includes(i)
                      ? form.skipWeekdays.filter((x) => x !== i)
                      : [...form.skipWeekdays, i].sort())}
                >
                  {d}
                </Badge>
              ))}
            </div>
          </Field>
        </ParamGroup>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => runMut.mutate()} disabled={runMut.isPending}>
          {runMut.isPending ? "Running…" : "Run backtest"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => optMut.mutate()} disabled={optMut.isPending}>
          {optMut.isPending ? "Optimizing…" : "Optimize (grid sweep)"}
        </Button>
        {data && (
          <span className="text-[11px] text-muted-foreground font-mono">
            {data.bars_scanned} bars · {data.data_label} · {data.trades.length} setups
          </span>
        )}
      </div>

      {data && <ResultsPanel data={data} />}
      {optData && <OptimizerResults data={optData} onApply={(o) => setForm((f) => ({ ...f, ...o }))} />}
    </div>
  );
}

function ParamGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/50 p-3">
      <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-2">
        {label}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">{children}</div>
    </div>
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

function ResultsPanel({ data }: { data: RunResult }) {
  const s = data.summary;
  const metric = (label: string, value: string, tone?: "pos" | "neg") => (
    <div className="rounded-md border border-border/60 p-2.5">
      <div className="text-[9px] uppercase font-mono tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-base font-mono font-semibold ${tone === "pos" ? "text-emerald-500" : tone === "neg" ? "text-red-500" : ""}`}>
        {value}
      </div>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-2 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
        {metric("Net P&L", `$${s.net_pnl_usd.toFixed(0)}`, s.net_pnl_usd >= 0 ? "pos" : "neg")}
        {metric("Trades", String(s.tp + s.sl))}
        {metric("Wins", String(s.tp), "pos")}
        {metric("Losses", String(s.sl), "neg")}
        {metric("Win %", `${s.win_rate_pct.toFixed(1)}%`)}
        {metric("PF", isFinite(s.profit_factor) ? s.profit_factor.toFixed(2) : "∞")}
        {metric("Avg R", s.avg_r.toFixed(2))}
        {metric("Expectancy", `$${s.expectancy_usd.toFixed(1)}`)}
        {metric("Max DD", `$${s.max_drawdown_usd.toFixed(0)}`, "neg")}
        {metric("Consec W", String(s.max_consec_wins))}
        {metric("Consec L", String(s.max_consec_losses))}
        {metric("Avg hold", `${s.avg_hold_hours.toFixed(1)}h`)}
        {metric("Avg TTFill", `${s.avg_time_to_fill_hours.toFixed(1)}h`)}
        {metric("Avg MFE", `${s.avg_mfe_r.toFixed(2)}R`)}
        {metric("Avg MAE", `${s.avg_mae_r.toFixed(2)}R`)}
        {metric("Edge", `${s.edge_score}/100`, s.edge_score >= 60 ? "pos" : s.edge_score >= 40 ? undefined : "neg")}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BucketTable title="OR size" rows={data.analytics.or_size} />
        <BucketTable title="Break distance" rows={data.analytics.break_distance} />
        <BucketTable title="Weekday" rows={data.analytics.weekday} />
        <BucketTable title="Month" rows={data.analytics.month} />
        <BucketTable title="ATR band" rows={data.analytics.atr_band} />
        <BucketTable title="Break body %" rows={data.analytics.break_body} />
        <BucketTable title="Side (trend cohort)" rows={data.analytics.trend} />
        <BucketTable title="Entry hour (UTC)" rows={data.analytics.entry_hour_utc} />
      </div>
    </div>
  );
}

function BucketTable({ title, rows }: { title: string; rows: { bucket: string; trades: number; win_rate_pct: number; net_pnl_usd: number; avg_r: number }[] }) {
  return (
    <div className="rounded-md border border-border/50 p-3">
      <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-2">
        {title}
      </div>
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="text-left border-b text-muted-foreground">
            <th className="py-1 pr-2">Bucket</th>
            <th className="py-1 pr-2">N</th>
            <th className="py-1 pr-2">Win %</th>
            <th className="py-1 pr-2">Net</th>
            <th className="py-1 pr-2">Avg R</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={5} className="py-2 text-muted-foreground text-center">no data</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.bucket} className="border-b border-border/30">
              <td className="py-1 pr-2">{r.bucket}</td>
              <td className="py-1 pr-2">{r.trades}</td>
              <td className="py-1 pr-2">{r.win_rate_pct.toFixed(0)}</td>
              <td className={`py-1 pr-2 ${r.net_pnl_usd >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                ${r.net_pnl_usd.toFixed(0)}
              </td>
              <td className="py-1 pr-2">{r.avg_r.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OptimizerResults({ data, onApply }: { data: OptResult; onApply: (o: Partial<LondonOrbOpts>) => void }) {
  return (
    <div className="rounded-md border border-primary/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground">
          Top presets · {data.evaluated} evaluated · {(data.elapsed_ms / 1000).toFixed(1)}s
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="text-left border-b text-muted-foreground">
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">Net</th>
              <th className="py-1 pr-2">OOS Net</th>
              <th className="py-1 pr-2">Trades</th>
              <th className="py-1 pr-2">Win %</th>
              <th className="py-1 pr-2">PF</th>
              <th className="py-1 pr-2">Avg R</th>
              <th className="py-1 pr-2">Max DD</th>
              <th className="py-1 pr-2">Edge</th>
              <th className="py-1 pr-2">Settings</th>
              <th className="py-1 pr-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.top.map((p) => (
              <tr key={p.rank} className="border-b border-border/30">
                <td className="py-1 pr-2">{p.rank}</td>
                <td className={`py-1 pr-2 ${p.net_pnl_usd >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                  ${p.net_pnl_usd.toFixed(0)}
                </td>
                <td className={`py-1 pr-2 ${p.oos_net_pnl_usd >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                  ${p.oos_net_pnl_usd.toFixed(0)}
                </td>
                <td className="py-1 pr-2">{p.trades}</td>
                <td className="py-1 pr-2">{p.win_rate_pct.toFixed(1)}</td>
                <td className="py-1 pr-2">{p.profit_factor.toFixed(2)}</td>
                <td className="py-1 pr-2">{p.avg_r.toFixed(2)}</td>
                <td className="py-1 pr-2 text-red-500">${p.max_drawdown_usd.toFixed(0)}</td>
                <td className="py-1 pr-2">{p.edge_score}</td>
                <td className="py-1 pr-2 text-[10px] text-muted-foreground">
                  {Object.entries(p.overrides).map(([k, v]) => `${k}=${v}`).join(" · ")}
                </td>
                <td className="py-1 pr-2">
                  <Button
                    size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                    onClick={() => { onApply(p.overrides); toast.success(`Preset #${p.rank} applied`); }}
                  >
                    Apply
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
