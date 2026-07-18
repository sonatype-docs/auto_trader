import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getStrategyState, backtestRange, sweepHoursBacktest, runEntryZoneSweep, backtestSessionsCompare, backtestLiquiditySweep, backtestSilverBullet } from "@/lib/strategy.functions";
import { DEFAULT_FILTERS, type FilterConfig } from "@/lib/strategy/filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { OptimizerPanel } from "@/components/optimizer-panel";
import { GridSweepPanel } from "@/components/grid-sweep-panel";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ArrowLeft, Beaker, ChevronRight } from "lucide-react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { BacktestAnalytics } from "@/components/backtest-analytics";
import { exportBacktest } from "@/lib/backtest-export";
import { ResearchPanel } from "@/components/research/research-panel";
import { HourFilterBar } from "@/components/research/hour-filter-bar";


export const Route = createFileRoute("/backtest/")({
  component: BacktestLab,
  head: () => ({
    meta: [
      { title: "Backtest Lab — Shark Auto-Trader" },
      {
        name: "description",
        content:
          "Replay the fib zone strategy across custom date ranges with configurable RR, trailing SL, risk, and session filters.",
      },
    ],
  }),
});

type RangeData = Awaited<ReturnType<typeof backtestRange>>;

const WD_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const BACKTEST_SNAPSHOT_KEY = "shark:auto-trader:backtest-snapshot:v1";

interface FormState {
  days: number;
  symbol: string;
  sessionStartIst: string;
  slRiskUsd: number;
  rr: number;
  trailEnabled: boolean;
  trailActivateR: number;
  trailStepR: number;
  skipWeekdays: number[]; // 0=Sun..6=Sat
  entryMode: "fib" | "retest" | "market" | "adaptive";
  entryDepthPct: number;
  slDepthPct: number;
  retestSlR: number;
  zoneSource: "range" | "breakout";
  feeUsdPerOrder: number;
  dataSource: "shark" | "yahoo";
}

type BacktestSnapshot = {
  savedAt: number;
  form: FormState;
  filters: NonNullable<FilterConfig>;
  result: RangeData | null;
};

function readBacktestSnapshot(): BacktestSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(BACKTEST_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BacktestSnapshot>;
    if (!parsed.form || !parsed.savedAt) return null;
    // Backtest results are session-scoped and expire after 12 hours so stale
    // market-analysis output does not reappear on a later work session.
    if (Date.now() - parsed.savedAt > 12 * 60 * 60 * 1000) {
      window.sessionStorage.removeItem(BACKTEST_SNAPSHOT_KEY);
      return null;
    }
    return {
      savedAt: parsed.savedAt,
      form: parsed.form,
      filters: parsed.filters ?? DEFAULT_FILTERS,
      result: parsed.result ?? null,
    };
  } catch {
    return null;
  }
}

function writeBacktestSnapshot(snapshot: BacktestSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(BACKTEST_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    try {
      window.sessionStorage.setItem(
        BACKTEST_SNAPSHOT_KEY,
        JSON.stringify({ ...snapshot, result: null }),
      );
    } catch {
      // Ignore storage quota/private-mode failures; the live in-memory state still works.
    }
  }
}

function BacktestLab() {
  const getState = useServerFn(getStrategyState);
  const runRange = useServerFn(backtestRange);
  const settingsQ = useQuery({ queryKey: ["strategy-state"], queryFn: () => getState() });

  const [form, setForm] = useState<FormState | null>(null);
  const [result, setResult] = useState<RangeData | null>(null);
  const [filters, setFilters] = useState<NonNullable<FilterConfig>>(DEFAULT_FILTERS);
  const [hourFilter, setHourFilter] = useState<number | null>(null);
  // Cache per-hour re-runs so switching between hours is instant after
  // the first request. Key: hour number (0-23). "All" = the base `result`.
  const [hourCache, setHourCache] = useState<Record<number, RangeData>>({});
  const [hourLoading, setHourLoading] = useState<number | null>(null);
  const [hasRestoredSnapshot, setHasRestoredSnapshot] = useState(false);

  // Seed the form once settings load.
  const s = settingsQ.data?.settings as
    | {
        symbol: string;
        session_start_ist: string;
        sl_risk_usd: number;
        rr: number;
        trail_enabled?: boolean;
        trail_activate_r?: number;
        trail_step_r?: number;
        skip_weekends?: boolean;
        entry_mode?: string;
        entry_depth_pct?: number;
        sl_depth_pct?: number;
        retest_sl_r?: number;
      }
    | null
    | undefined;

  useEffect(() => {
    const snapshot = readBacktestSnapshot();
    if (snapshot) {
      setForm(snapshot.form);
      setFilters(snapshot.filters);
      setResult(snapshot.result);
      setHourCache({});
      setHourFilter(null);
    }
    setHasRestoredSnapshot(true);
  }, []);

  useEffect(() => {
    if (!hasRestoredSnapshot || !s || form) return;
    setForm({
      days: 90,
      symbol: s.symbol,
      sessionStartIst: String(s.session_start_ist).slice(0, 5),
      slRiskUsd: Number(s.sl_risk_usd),
      rr: Number(s.rr),
      trailEnabled: !!s.trail_enabled,
      trailActivateR: Number(s.trail_activate_r ?? 2),
      trailStepR: Number(s.trail_step_r ?? 1),
      skipWeekdays: s.skip_weekends ? [0, 6] : [0, 6],
      entryMode: ((s.entry_mode ?? "fib") as FormState["entryMode"]),
      entryDepthPct: Number(s.entry_depth_pct ?? 0.15),
      slDepthPct: Number(s.sl_depth_pct ?? 0.60),
      retestSlR: Number(s.retest_sl_r ?? 0.5),
      zoneSource: "range",
      feeUsdPerOrder: 0,
      dataSource: "shark",
    });
  }, [form, hasRestoredSnapshot, s]);

  useEffect(() => {
    if (!hasRestoredSnapshot || !form) return;
    writeBacktestSnapshot({
      savedAt: Date.now(),
      form,
      filters,
      result,
    });
  }, [filters, form, hasRestoredSnapshot, result]);

  const resultsRef = useRef<HTMLDivElement | null>(null);

  const runMut = useMutation({
    mutationFn: (f: FormState) =>
      runRange({
        data: {
          days: f.days,
          symbol: f.symbol,
          session_start_ist: f.sessionStartIst,
          sl_risk_usd: f.slRiskUsd,
          rr: f.rr,
          trail_enabled: f.trailEnabled,
          trail_activate_r: f.trailActivateR,
          trail_step_r: f.trailStepR,
          skip_weekdays: f.skipWeekdays,
          filters,
          entry: {
            mode: f.entryMode,
            entry_depth_pct: f.entryDepthPct,
            sl_depth_pct: f.slDepthPct,
            retest_sl_r: f.retestSlR,
          },
          zone_source: f.zoneSource,
          fee_usd_per_order: f.feeUsdPerOrder,
          data_source: f.dataSource,
        },
      }),
    onSuccess: (r) => {
      setResult(r);
      setHourCache({});
      setHourFilter(null);
      // Publish Fib-Zone snapshot for the /backtest/compare view.
      import("@/lib/backtest-snapshots").then(({ saveSnapshot, metricsFromSummary }) => {
        saveSnapshot({
          strategy: "fib_zone",
          label: "Fib Zone",
          ranAt: Date.now(),
          params: (form ? { ...form } : {}) as Record<string, unknown>,
          metrics: metricsFromSummary(r.summary),
        });
      }).catch(() => { /* snapshot save is best-effort */ });
      toast.success(`Backtest done — ${r.summary.tp}W / ${r.summary.sl}L · fill ${r.summary.fill_rate_pct.toFixed(0)}%`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Auto-scroll to results whenever a new result lands.
  useEffect(() => {
    if (result && resultsRef.current) {
      const y = resultsRef.current.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  }, [result]);


  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    if (!form) return;
    setForm({ ...form, [k]: v });
  };

  const toggleWd = (wd: number) => {
    if (!form) return;
    const has = form.skipWeekdays.includes(wd);
    setForm({
      ...form,
      skipWeekdays: has ? form.skipWeekdays.filter((x) => x !== wd) : [...form.skipWeekdays, wd].sort(),
    });
  };

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-14 z-20 border-b border-border/70 bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/50">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-[0_6px_18px_-8px_var(--color-primary)]">
              <Beaker className="w-4 h-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="font-display text-sm font-semibold tracking-tight">Backtest Lab</div>
              <div className="text-[11px] text-muted-foreground truncate">Isolated replays · live settings untouched</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {result && (
              <button
                type="button"
                onClick={() => {
                  if (resultsRef.current) {
                    const y = resultsRef.current.getBoundingClientRect().top + window.scrollY - 72;
                    window.scrollTo({ top: y, behavior: "smooth" });
                  }
                }}
                className="hidden sm:inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 h-8 text-xs font-mono tracking-wide text-primary hover:bg-primary/20"
              >
                Jump to results
                <span className={result.summary.net_pnl_usd >= 0 ? "text-long" : "text-short"}>
                  {result.summary.net_pnl_usd >= 0 ? "+" : ""}${result.summary.net_pnl_usd.toFixed(2)}
                </span>
              </button>
            )}
            <Link to="/">
              <Button variant="ghost" size="sm" className="shrink-0">
                <ArrowLeft className="w-4 h-4 md:mr-2" /> <span className="hidden sm:inline">Dashboard</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-4 md:space-y-6">

        {!form ? (
          <p className="font-mono text-xs text-muted-foreground">Loading strategy defaults…</p>
        ) : (
          <>

            <Section
              title="Parameters"
              subtitle="Live strategy settings are not modified — every run is isolated."
              defaultOpen
              badge={
                <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-primary">
                  {form.symbol} · {form.days}d · RR 1:{form.rr}
                </span>
              }
            >
              <div className="space-y-4">

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="Symbol">
                    <select
                      value={form.symbol}
                      onChange={(e) => set("symbol", e.target.value)}
                      className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
                    >
                      <option value="XAUUSDT">XAUUSDT · Gold</option>
                      <option value="BTCUSDT">BTCUSDT · Bitcoin</option>
                    </select>
                  </Field>

                  <Field label="Session start (IST)">
                    <Input
                      type="time"
                      value={form.sessionStartIst}
                      onChange={(e) => set("sessionStartIst", e.target.value)}
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                  <Field label="Days back">
                    <div className="flex gap-1">
                      <Input
                        type="number"
                        min={1}
                        max={730}
                        value={form.days}
                        onChange={(e) => set("days", Math.min(730, Math.max(1, Number(e.target.value) || 1)))}
                        className="h-8 font-mono text-xs"
                      />
                      <select
                        className="h-8 rounded-md border border-input bg-transparent px-2 text-xs font-mono"
                        value={form.days}
                        onChange={(e) => set("days", Number(e.target.value))}
                      >
                        {[7, 30, 60, 90, 180, 270, 365, 540, 720].map((d) => (
                          <option key={d} value={d}>
                            {d}d
                          </option>
                        ))}
                      </select>
                    </div>
                  </Field>
                  <Field label="SL risk ($ per trade)">
                    <Input
                      type="number"
                      step="1"
                      min="1"
                      value={form.slRiskUsd}
                      onChange={(e) => set("slRiskUsd", Math.max(1, Number(e.target.value) || 1))}
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                  <Field label="Initial R:R (1 : X)">
                    <Input
                      type="number"
                      step="0.1"
                      min="0.5"
                      value={form.rr}
                      onChange={(e) => set("rr", Math.max(0.5, Number(e.target.value) || 0.5))}
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                  <Field label="Trailing SL">
                    <label className="flex items-center gap-2 h-8">
                      <Switch
                        checked={form.trailEnabled}
                        onCheckedChange={(v) => set("trailEnabled", v)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {form.trailEnabled ? "enabled" : "off"}
                      </span>
                    </label>
                  </Field>
                  <Field label="Trail activate (R)">
                    <Input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={form.trailActivateR}
                      onChange={(e) => set("trailActivateR", Math.max(0.1, Number(e.target.value) || 0.1))}
                      className="h-8 font-mono text-xs"
                      disabled={!form.trailEnabled}
                    />
                  </Field>
                  <Field label="Trail step (R)">
                    <Input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={form.trailStepR}
                      onChange={(e) => set("trailStepR", Math.max(0.1, Number(e.target.value) || 0.1))}
                      className="h-8 font-mono text-xs"
                      disabled={!form.trailEnabled}
                    />
                  </Field>
                  <Field label="Fee $ per order (entry & exit)">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.feeUsdPerOrder}
                      onChange={(e) => set("feeUsdPerOrder", Math.max(0, Number(e.target.value) || 0))}
                      className="h-8 font-mono text-xs"
                      placeholder="0.00"
                    />
                  </Field>
                </div>

                <div className="border-t border-border pt-3 space-y-3">
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Candle data source
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {([
                      { v: "shark", label: "Shark (XAUUSDT)", hint: "Live perp — ~180 days of 1h data" },
                      { v: "yahoo", label: "Yahoo (GC=F)", hint: "Gold futures — ~730 days, no API key" },
                    ] as const).map((o) => (
                      <button
                        key={o.v}
                        type="button"
                        onClick={() => set("dataSource", o.v)}
                        title={o.hint}
                        className={`px-3 h-7 rounded font-mono text-[11px] border uppercase tracking-wider ${
                          form.dataSource === o.v
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {form.dataSource === "yahoo"
                      ? "Yahoo Finance COMEX gold futures (GC=F). Deeper history (~2 years of 1h). Session gaps present — some hours missing vs. a 24×7 perp. Prices ≈ spot ± small futures basis."
                      : "SharkExchange XAUUSDT perp — live market data, up to ~180 days of 1h bars."}
                  </p>
                </div>


                <div className="border-t border-border pt-3 space-y-3">
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Fib zone source
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {([
                      { v: "range", label: "Range candle", hint: "Fib zone drawn from opening range" },
                      { v: "breakout", label: "Breakout candle", hint: "Fib zone drawn from the candle that breaks out" },
                    ] as const).map((o) => (
                      <button
                        key={o.v}
                        type="button"
                        onClick={() => set("zoneSource", o.v)}
                        title={o.hint}
                        className={`px-3 h-7 rounded font-mono text-[11px] border uppercase tracking-wider ${
                          form.zoneSource === o.v
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {form.zoneSource === "breakout"
                      ? "Adaptive/fib entries pull back into the breakout candle's high/low."
                      : "Adaptive/fib entries pull back into the opening range candle (default)."}
                  </p>
                </div>

                <div className="border-t border-border pt-3 space-y-3">
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Entry mechanics
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {(["fib", "retest", "market", "adaptive"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => set("entryMode", m)}
                        className={`px-3 h-7 rounded font-mono text-[11px] border uppercase tracking-wider ${
                          form.entryMode === m
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  {(form.entryMode === "fib" || form.entryMode === "market") && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {form.entryMode === "fib" && (
                        <Field label="Entry depth (% of range, 0–300, step 10)">
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              max={300}
                              step={10}
                              value={Math.round(form.entryDepthPct * 100)}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                if (!Number.isFinite(n)) return;
                                const clamped = Math.max(0, Math.min(300, n));
                                set("entryDepthPct", clamped / 100);
                              }}
                              className="h-9 w-28 font-mono"
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                        </Field>
                      )}
                      <Field label="SL depth (% of range, 10–300, step 10)">
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={10}
                            max={300}
                            step={10}
                            value={Math.round(form.slDepthPct * 100)}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n)) return;
                              const clamped = Math.max(10, Math.min(300, n));
                              set("slDepthPct", clamped / 100);
                            }}
                            className="h-9 w-28 font-mono"
                          />
                          <span className="text-xs text-muted-foreground">%</span>
                        </div>
                      </Field>
                    </div>
                  )}

                  {form.entryMode === "retest" && (
                    <Field label={`Retest SL distance (R × range) — ${form.retestSlR.toFixed(2)}`}>
                      <input
                        type="range"
                        min={0.1}
                        max={2}
                        step={0.1}
                        value={form.retestSlR}
                        onChange={(e) => set("retestSlR", Number(e.target.value))}
                        className="w-full"
                      />
                    </Field>
                  )}
                </div>

                <div>

                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Skip weekdays
                  </Label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {WD_LABELS.map((wd, i) => {
                      const active = form.skipWeekdays.includes(i);
                      return (
                        <button
                          key={wd}
                          onClick={() => toggleWd(i)}
                          type="button"
                          className={`px-2 h-7 rounded font-mono text-[11px] border ${
                            active
                              ? "bg-destructive-soft border-destructive text-destructive"
                              : "bg-background border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {wd}
                        </button>
                      );
                    })}
                    <span className="text-[10px] text-muted-foreground self-center ml-2">
                      Days highlighted are excluded from the simulation.
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={runMut.isPending}
                    onClick={() => runMut.mutate(form)}
                  >
                    {runMut.isPending ? "Replaying…" : `Run backtest — ${form.days}d`}
                  </Button>
                  <p className="text-[10px] text-muted-foreground">
                    Fetches 1H candles from SharkExchange and replays every session with the rules above.
                  </p>
                </div>
              </div>
            </Section>

            <Section title="Filters" subtitle="Session bias, volatility, and ATR gates for this run." defaultOpen>
              <FiltersCard value={filters} onChange={setFilters} />
            </Section>


            {/* Results anchor — appears immediately below Parameters/Filters after a run */}
            <div ref={resultsRef} className="scroll-mt-32 space-y-4 md:space-y-6">
              {result ? (
                <>
                  <HourFilterBar
                    value={hourFilter}
                    loadingHour={hourLoading}
                    cachedHours={new Set<number | "all">(Object.keys(hourCache).map((k) => Number(k)))}
                    configuredSessionLabel={form ? `${form.sessionStartIst} IST` : undefined}
                    onChange={async (h) => {
                      if (h == null) {
                        setHourFilter(null);
                        return;
                      }
                      setHourFilter(h);
                      if (hourCache[h] || !form) return;
                      setHourLoading(h);
                      try {
                        const r = await runRange({
                          data: {
                            days: form.days,
                            symbol: form.symbol,
                            session_start_ist: `${String(h).padStart(2, "0")}:00`,
                            sl_risk_usd: form.slRiskUsd,
                            rr: form.rr,
                            trail_enabled: form.trailEnabled,
                            trail_activate_r: form.trailActivateR,
                            trail_step_r: form.trailStepR,
                            skip_weekdays: form.skipWeekdays,
                            filters,
                            entry: {
                              mode: form.entryMode,
                              entry_depth_pct: form.entryDepthPct,
                              sl_depth_pct: form.slDepthPct,
                              retest_sl_r: form.retestSlR,
                            },
                            zone_source: form.zoneSource,
                            fee_usd_per_order: form.feeUsdPerOrder,
                            data_source: form.dataSource,
                          },
                        });
                        setHourCache((prev) => ({ ...prev, [h]: r }));
                      } catch (e) {
                        toast.error((e as Error).message);
                      } finally {
                        setHourLoading(null);
                      }
                    }}
                  />
                  {(() => {
                    const view = hourFilter == null ? result : hourCache[hourFilter] ?? result;
                    return (
                      <>
                        <ResultsView data={view} hourFilter={hourFilter} />
                        <ResearchPanel data={view} />
                      </>
                    );
                  })()}
                </>
              ) : (
                <Card className="border-dashed">
                  <CardContent className="py-10 text-center">
                    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                      Run a backtest to see results here
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Adjust parameters above, hit <span className="text-foreground">Run backtest</span>, and results will land right in this spot.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Secondary exploration — grouped into tabs so users don't scroll a mile */}
            <Section
              title="Explore"
              subtitle="Compare sessions, sweep hours, optimize parameters, and inspect alternative strategies."
            >

                <Tabs defaultValue="sessions" className="w-full">
                  <div className="-mx-1 overflow-x-auto pb-1">
                    <TabsList className="h-auto flex-wrap justify-start gap-1 bg-muted/60 p-1">
                      <TabsTrigger value="sessions" className="text-xs">Sessions</TabsTrigger>
                      <TabsTrigger value="hours" className="text-xs">Hour sweep</TabsTrigger>
                      <TabsTrigger value="zones" className="text-xs">Entry zones</TabsTrigger>
                      <TabsTrigger value="sweep" className="text-xs">Liquidity sweep</TabsTrigger>
                      <TabsTrigger value="silver" className="text-xs">Silver bullet</TabsTrigger>
                      <TabsTrigger value="grid" className="text-xs">Grid sweep</TabsTrigger>
                      <TabsTrigger value="optimize" className="text-xs">Optimize</TabsTrigger>
                      <TabsTrigger value="roadmap" className="text-xs">Roadmap</TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent value="grid" className="mt-4">
                    <GridSweepPanel
                      defaults={{
                        symbol: form.symbol,
                        days: form.days,
                        slRiskUsd: form.slRiskUsd,
                        rr: form.rr,
                        sessionStartIst: form.sessionStartIst,
                        entryMode: form.entryMode,
                        entryDepthPct: form.entryDepthPct,
                        slDepthPct: form.slDepthPct,
                        retestSlR: form.retestSlR,
                        trailEnabled: form.trailEnabled,
                        trailActivateR: form.trailActivateR,
                        trailStepR: form.trailStepR,
                        feeUsdPerOrder: form.feeUsdPerOrder,
                        zoneSource: form.zoneSource,
                        dataSource: form.dataSource,
                        skipWeekdays: form.skipWeekdays,
                      }}
                    />
                  </TabsContent>


                  <TabsContent value="sessions" className="mt-4">
                    <MultiSessionComparePanel
                      defaults={{
                        symbol: form.symbol,
                        days: form.days,
                        slRiskUsd: form.slRiskUsd,
                        rr: form.rr,
                        trailEnabled: form.trailEnabled,
                        trailActivateR: form.trailActivateR,
                        trailStepR: form.trailStepR,
                        skipWeekdays: form.skipWeekdays,
                        entryMode: form.entryMode,
                        entryDepthPct: form.entryDepthPct,
                        slDepthPct: form.slDepthPct,
                        retestSlR: form.retestSlR,
                      }}
                      filters={filters}
                    />
                  </TabsContent>

                  <TabsContent value="hours" className="mt-4">
                    <HourSweepPanel
                      defaults={{
                        symbol: form.symbol,
                        slRiskUsd: form.slRiskUsd,
                        rr: form.rr,
                        trailEnabled: form.trailEnabled,
                        trailActivateR: form.trailActivateR,
                        trailStepR: form.trailStepR,
                        skipWeekdays: form.skipWeekdays,
                      }}
                      filters={filters}
                    />
                  </TabsContent>

                  <TabsContent value="zones" className="mt-4">
                    <EntryZoneGridPanel
                      defaults={{
                        symbol: form.symbol,
                        sessionStartIst: form.sessionStartIst,
                        slRiskUsd: form.slRiskUsd,
                        rr: form.rr,
                        trailEnabled: form.trailEnabled,
                        trailActivateR: form.trailActivateR,
                        trailStepR: form.trailStepR,
                        skipWeekdays: form.skipWeekdays,
                      }}
                      filters={filters}
                    />
                  </TabsContent>

                  <TabsContent value="sweep" className="mt-4">
                    <LiquiditySweepPanel
                      defaults={{
                        symbol: form.symbol,
                        days: form.days,
                        slRiskUsd: form.slRiskUsd,
                        rr: form.rr,
                        skipWeekdays: form.skipWeekdays,
                      }}
                    />
                  </TabsContent>

                  <TabsContent value="silver" className="mt-4">
                    <SilverBulletPanel
                      defaults={{
                        symbol: form.symbol,
                        days: form.days,
                        slRiskUsd: form.slRiskUsd,
                        rr: form.rr,
                        skipWeekdays: form.skipWeekdays,
                      }}
                    />
                  </TabsContent>

                  <TabsContent value="optimize" className="mt-4 space-y-4">
                    <OptimizerPanel
                      strategy="orb_sessions"
                      title="Multi-Session ORB"
                      defaults={{
                        symbol: form.symbol,
                        slRiskUsd: form.slRiskUsd,
                        skipWeekdays: form.skipWeekdays,
                      }}
                    />
                    <OptimizerPanel
                      strategy="asian_sweep"
                      title="Asian Liquidity Sweep"
                      defaults={{
                        symbol: form.symbol,
                        slRiskUsd: form.slRiskUsd,
                        skipWeekdays: form.skipWeekdays,
                      }}
                    />
                    <OptimizerPanel
                      strategy="silver_bullet"
                      title="ICT Silver Bullet"
                      defaults={{
                        symbol: form.symbol,
                        slRiskUsd: form.slRiskUsd,
                        skipWeekdays: form.skipWeekdays,
                      }}
                    />
                  </TabsContent>

                  <TabsContent value="roadmap" className="mt-4">
                    <StrategiesRoadmapCard />
                  </TabsContent>
                </Tabs>
            </Section>


          </>
        )}

      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden py-0 gap-0">
      <details open={defaultOpen} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-6 py-4 hover:bg-muted/40 transition-colors [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-sm font-semibold tracking-tight">{title}</h3>
              {badge}
            </div>
            {subtitle && (
              <p className="mt-0.5 text-[11px] text-muted-foreground truncate group-open:whitespace-normal">
                {subtitle}
              </p>
            )}
          </div>
        </summary>
        <div className="border-t border-border px-6 py-4">{children}</div>
      </details>
    </Card>
  );
}


type CohortDimKey = "body" | "or_size" | "break_distance" | "weekday" | "tp_target";
type CohortFilter = { dim: CohortDimKey; bucket: string } | null;

const COHORT_DIM_LABELS: Record<CohortDimKey, string> = {
  body: "Body strength",
  or_size: "Opening range",
  break_distance: "Break distance",
  weekday: "Weekday",
  tp_target: "TP target",
};

function dayMatchesCohort(d: RangeData["days"][number], f: NonNullable<CohortFilter>): boolean {
  switch (f.dim) {
    case "body":
      return d.body_bucket === f.bucket;
    case "or_size":
      return d.or_bucket === f.bucket;
    case "break_distance":
      return d.break_distance_bucket === f.bucket;
    case "weekday":
      return WD_LABELS[d.weekday] === f.bucket;
    case "tp_target":
      return d.tp_target === f.bucket;
  }
}

function ResultsView({ data, hourFilter }: { data: RangeData; hourFilter?: number | null }) {
  const s = data.summary;
  const [cohort, setCohort] = useState<CohortFilter>(null);
  const fmt = (n: number | null) => (n == null ? "—" : n.toFixed(2));
  const fmtUsd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
  const fmtTime = (ms: number | null) =>
    ms == null ? "—" : new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const outcomeCls = (o: string) =>
    o === "tp"
      ? "text-long"
      : o === "sl"
        ? "text-short"
        : o === "open"
          ? "text-warning"
          : "text-muted-foreground";
  const totalTone = s.total_pnl_usd >= 0 ? "text-long" : "text-short";
  const pf = s.profit_factor;
  const pfText = !isFinite(pf) ? "∞" : pf.toFixed(2);

  const filteredDays = useMemo(
    () => (cohort ? data.days.filter((d) => dayMatchesCohort(d, cohort)) : data.days),
    [data.days, cohort],
  );

  const equityChart = useMemo(() => {
    if (!cohort) return data.equity.map((e) => ({ date: e.ist_date, pnl: Number(e.cum_pnl_usd.toFixed(2)) }));
    let cum = 0;
    return filteredDays.map((d) => {
      cum += d.pnl_usd;
      return { date: d.ist_date, pnl: Number(cum.toFixed(2)) };
    });
  }, [data.equity, filteredDays, cohort]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-mono tracking-widest">
              RESULTS
              {hourFilter != null && (
                <span className="ml-2 rounded border border-primary/60 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-primary">
                  Session {String(hourFilter).padStart(2, "0")}:00 IST
                </span>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {data.symbol} · IST {data.session_start_ist} · SL ${data.sl_risk_usd} · RR 1:{data.rr}
              {" · "}
              {new Date(data.from_ms).toISOString().slice(0, 10)} → {new Date(data.to_ms).toISOString().slice(0, 10)}
              {data.trail.enabled
                ? ` · trail on (act ${data.trail.activate_r}R / step ${data.trail.step_r}R)`
                : " · trail off"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 font-mono text-[11px] uppercase tracking-wider"
              onClick={() => { exportBacktest(data, "csv"); }}
              title="Download all tables (summary, weekdays, monthly, cohorts, MAE, equity, trades) as one CSV"
            >
              Export CSV
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 font-mono text-[11px] uppercase tracking-wider"
              onClick={() => { exportBacktest(data, "json"); }}
              title="Download the complete raw result as JSON"
            >
              JSON
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 font-mono text-xs">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Kv k="net p&l (after fees)" v={fmtUsd(s.net_pnl_usd)} tone={s.net_pnl_usd >= 0 ? "text-long" : "text-short"} />
          <Kv k="gross p&l" v={fmtUsd(s.total_pnl_usd)} tone={totalTone} />
          <Kv k="est. fees" v={`-$${s.est_fees_usd.toFixed(2)}`} tone="text-short" />
          <Kv k="fill rate" v={`${s.fill_rate_pct.toFixed(0)}%`} tone={s.fill_rate_pct >= 60 ? "text-long" : s.fill_rate_pct >= 30 ? "text-warning" : "text-short"} />
          <Kv k="win rate" v={`${s.win_rate_pct.toFixed(1)}%`} tone={s.win_rate_pct >= 50 ? "text-long" : "text-short"} />
          <Kv k="profit factor" v={pfText} tone={pf >= 1 ? "text-long" : "text-short"} />
          <Kv k="expectancy / trade" v={fmtUsd(s.expectancy_usd)} tone={s.expectancy_usd >= 0 ? "text-long" : "text-short"} />
          <Kv k="avg R" v={s.avg_r.toFixed(2)} tone={s.avg_r >= 0 ? "text-long" : "text-short"} />
          <Kv k="avg win / loss" v={`${fmtUsd(s.avg_win_usd)} / ${fmtUsd(-s.avg_loss_usd)}`} />
          <Kv k="max drawdown" v={`-${s.max_drawdown_usd.toFixed(2)}`} tone="text-short" />
          <Kv k="max streak W / L" v={`${s.max_consec_wins} / ${s.max_consec_losses}`} />
          <Kv k="sessions" v={`${s.days_with_session} / ${s.total_days}`} />
          <Kv k="breaks / triggered" v={`${s.breaks} / ${s.triggered}`} />
          <Kv k="missed / near-miss" v={`${s.armed_no_trigger} / ${s.near_miss_count}`} tone={s.near_miss_count > 0 ? "text-warning" : undefined} />
          {(() => {
            const closed = data.days.filter((d) => d.outcome === "tp" || d.outcome === "sl");
            const winCnt = closed.filter((d) => d.pnl_usd > 0).length;
            const lossCnt = closed.filter((d) => d.pnl_usd < 0).length;
            const beCnt = closed.length - winCnt - lossCnt;
            return <Kv k="wins / losses" v={`${winCnt} / ${lossCnt}${beCnt > 0 ? ` (+${beCnt} BE)` : ""}`} />;
          })()}
          <Kv k="open / skipped / filtered" v={`${s.open} / ${s.skipped_days} / ${s.filtered_days ?? 0}`} />
          <Kv k="best / worst day $" v={`+${s.best_pnl_usd.toFixed(0)} / ${s.worst_pnl_usd.toFixed(0)}`} />

          <Kv k="best / worst day $" v={`+${s.best_pnl_usd.toFixed(0)} / ${s.worst_pnl_usd.toFixed(0)}`} />
          <Kv
            k="best weekday"
            v={s.best_weekday ? `${s.best_weekday.label} ${fmtUsd(s.best_weekday.total_pnl_usd)}` : "—"}
            tone="text-long"
          />
          <Kv
            k="worst weekday"
            v={s.worst_weekday ? `${s.worst_weekday.label} ${fmtUsd(s.worst_weekday.total_pnl_usd)}` : "—"}
            tone="text-short"
          />
          <Kv k="bars scanned" v={String(data.bars_scanned)} />
        </div>

        {equityChart.length > 1 && (
          <div className="border border-border rounded p-2 bg-muted/30">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              Equity curve (cumulative $ P&amp;L)
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityChart}>
                  <XAxis dataKey="date" hide />
                  <YAxis width={40} tickFormatter={(v: number) => `${v}`} tick={{ fontSize: 10 }} />
                  <ReTooltip
                    formatter={(v: number) => [fmtUsd(Number(v)), "P&L"]}
                    labelFormatter={(l) => `Date: ${l}`}
                  />
                  <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.2} />
                  <Line
                    type="monotone"
                    dataKey="pnl"
                    stroke={s.total_pnl_usd >= 0 ? "hsl(var(--primary))" : "hsl(var(--destructive))"}
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {cohort && (
          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className="text-muted-foreground uppercase tracking-widest">Filter:</span>
            <span className="px-2 py-0.5 rounded border border-primary/60 bg-primary/10 text-primary">
              {COHORT_DIM_LABELS[cohort.dim]}: {cohort.bucket}
            </span>
            <span className="text-muted-foreground">
              ({filteredDays.filter((d) => d.outcome === "tp" || d.outcome === "sl").length} trades)
            </span>
            <button
              type="button"
              onClick={() => setCohort(null)}
              className="text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              clear
            </button>
          </div>
        )}

        <CohortBreakdowns cohorts={s.cohorts} active={cohort} onSelect={setCohort} />

        <MaeBreakdown wins={s.mae_wins} losses={s.mae_losses} />

        <CalendarView data={data} />




        <div className="max-h-96 overflow-y-auto border border-border rounded">
          <table className="w-full text-[11px]">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-muted/60 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1">Date</th>
                <th className="text-left px-2 py-1">Day</th>
                <th className="text-right px-2 py-1">H/L</th>
                <th className="text-right px-2 py-1">Break</th>
                <th className="text-right px-2 py-1">Entry / SL / TP</th>
                <th className="text-right px-2 py-1">Trig</th>
                <th className="text-right px-2 py-1">Peak R</th>
                <th className="text-right px-2 py-1">MAE R</th>
                <th className="text-left px-2 py-1">Outcome</th>
                <th className="text-right px-2 py-1">P&amp;L $</th>
              </tr>
            </thead>
            <tbody>
              {filteredDays
                .slice()
                .reverse()
                .map((d) => (
                  <tr key={d.ist_date} className="border-t border-border">
                    <td className="px-2 py-1">{d.ist_date}</td>
                    <td className="px-2 py-1 text-muted-foreground">{d.weekday_label}</td>
                    <td className="text-right px-2 py-1">
                      {d.zone_high != null ? `${fmt(d.zone_high)} / ${fmt(d.zone_low)}` : "—"}
                    </td>
                    <td
                      className={`text-right px-2 py-1 ${
                        d.break_side === "long" ? "text-long" : d.break_side === "short" ? "text-short" : ""
                      }`}
                    >
                      {d.break_side ? `${d.break_side.toUpperCase()} @ ${fmt(d.break_close)}` : "—"}
                    </td>
                    <td className="text-right px-2 py-1">
                      {d.entry != null ? `${fmt(d.entry)} / ${fmt(d.sl)} / ${fmt(d.tp)}` : "—"}
                    </td>
                    <td className="text-right px-2 py-1">{fmtTime(d.trigger_at)}</td>
                    <td className="text-right px-2 py-1">{d.peak_r > 0 ? d.peak_r.toFixed(2) : "—"}</td>
                    <td className={`text-right px-2 py-1 ${d.mae_r != null && d.mae_r >= 0.6 ? "text-warning" : ""}`}>
                      {d.mae_r != null ? d.mae_r.toFixed(2) : "—"}
                    </td>
                    <td className={`px-2 py-1 uppercase ${outcomeCls(d.outcome)}`}>
                      {d.outcome.replace(/_/g, " ")}
                    </td>
                    <td
                      className={`text-right px-2 py-1 ${
                        d.pnl_usd > 0 ? "text-long" : d.pnl_usd < 0 ? "text-short" : ""
                      }`}
                    >
                      {d.pnl_usd === 0 ? "—" : fmtUsd(d.pnl_usd)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <p className="text-muted-foreground text-[10px]">
          Read-only replay of {data.bars_scanned} 1H bars using the parameters above. Does not touch live orders.
          Same-bar TP+SL is treated as SL (conservative).
        </p>
      </CardContent>
    </Card>
  );
}

function Kv({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="border border-border rounded px-2 py-1.5 bg-background">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</div>
      <div className={`text-xs ${tone ?? ""}`}>{v}</div>
    </div>
  );
}

type MaeStats = RangeData["summary"]["mae_wins"];

function MaeRow({ label, stats, tone }: { label: string; stats: MaeStats; tone?: string }) {
  if (!stats) {
    return (
      <tr className="border-t border-border">
        <td className="px-2 py-1 text-muted-foreground">{label}</td>
        <td colSpan={7} className="px-2 py-1 text-muted-foreground text-center">no trades</td>
      </tr>
    );
  }
  const cell = (v: number) => v.toFixed(2);
  return (
    <tr className="border-t border-border">
      <td className={`px-2 py-1 uppercase ${tone ?? ""}`}>{label}</td>
      <td className="text-right px-2 py-1 text-muted-foreground">{stats.count}</td>
      <td className="text-right px-2 py-1">{cell(stats.avg)}</td>
      <td className="text-right px-2 py-1">{cell(stats.p50)}</td>
      <td className="text-right px-2 py-1">{cell(stats.p75)}</td>
      <td className="text-right px-2 py-1">{cell(stats.p90)}</td>
      <td className="text-right px-2 py-1">{cell(stats.p95)}</td>
      <td className="text-right px-2 py-1">{cell(stats.max)}</td>
    </tr>
  );
}

function MaeBreakdown({ wins, losses }: { wins: MaeStats; losses: MaeStats }) {
  const insight = (() => {
    if (!wins || wins.count < 5) return null;
    const p95pct = Math.round(wins.p95 * 100);
    const suggested = Math.max(10, Math.ceil((wins.p95 + 0.1) * 10) * 10);
    return `95% of winning trades pulled back ≤ ${wins.p95.toFixed(2)}R (${p95pct}% into stop). A tighter SL around ~${suggested}% of current risk would still have captured them.`;
  })();
  return (
    <div className="border border-border rounded p-3 bg-muted/20 space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        MAE — Maximum Adverse Excursion (R units, per trade)
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="text-left px-2 py-1">Outcome</th>
              <th className="text-right px-2 py-1">n</th>
              <th className="text-right px-2 py-1">avg</th>
              <th className="text-right px-2 py-1">p50</th>
              <th className="text-right px-2 py-1">p75</th>
              <th className="text-right px-2 py-1">p90</th>
              <th className="text-right px-2 py-1">p95</th>
              <th className="text-right px-2 py-1">max</th>
            </tr>
          </thead>
          <tbody>
            <MaeRow label="Wins" stats={wins} tone="text-long" />
            <MaeRow label="Losses" stats={losses} tone="text-short" />
          </tbody>
        </table>
      </div>
      {insight && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">💡 {insight}</p>
      )}
      <p className="text-[10px] text-muted-foreground">
        MAE = worst drawdown against the trade before it resolved. 1.00R = full stop.
      </p>
    </div>
  );
}


type CohortsPayload = RangeData["summary"]["cohorts"];

const COHORT_DIM_ORDER: { key: CohortDimKey; label: string; edgeSuffix?: string }[] = [
  { key: "body", label: "Body strength (breakout candle body / range)", edgeSuffix: "%" },
  { key: "or_size", label: "Opening range size (session $)", edgeSuffix: "$" },
  { key: "break_distance", label: "Break distance beyond level", edgeSuffix: "$" },
  { key: "weekday", label: "Weekday" },
  { key: "tp_target", label: "TP target reached (swing / opposite liquidity)" },
];

function CohortBreakdowns({
  cohorts,
  active,
  onSelect,
}: {
  cohorts: CohortsPayload;
  active: CohortFilter;
  onSelect: (f: CohortFilter) => void;
}) {
  const fmtUsd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Cohort breakdowns — click a bucket to filter the trade table &amp; equity curve
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {COHORT_DIM_ORDER.map(({ key, label, edgeSuffix }) => {
          const dim = cohorts[key];
          const rows = dim.buckets;
          const withTrades = rows.filter((r) => r.trades > 0);
          const bestBucket = withTrades.length
            ? withTrades.reduce((a, b) => (b.total_pnl_usd > a.total_pnl_usd ? b : a)).bucket
            : null;
          return (
            <div key={key} className="border border-border rounded overflow-hidden">
              <div className="flex items-center justify-between px-2 py-1 bg-muted/60">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
                {dim.edges && (
                  <span className="text-[9px] font-mono text-muted-foreground">
                    tertiles: {dim.edges[0].toFixed(1)}{edgeSuffix} / {dim.edges[1].toFixed(1)}{edgeSuffix}
                  </span>
                )}
              </div>
              <table className="w-full text-[11px] font-mono">
                <thead className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-1">Bucket</th>
                    <th className="text-right px-2 py-1">Trades</th>
                    <th className="text-right px-2 py-1">Win %</th>
                    <th className="text-right px-2 py-1">Total $</th>
                    <th className="text-right px-2 py-1">Avg R</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isActive = active?.dim === key && active?.bucket === r.bucket;
                    const isBest = r.bucket === bestBucket && r.trades > 0;
                    const tone =
                      r.trades === 0
                        ? "text-muted-foreground"
                        : r.total_pnl_usd > 0
                          ? "text-long"
                          : r.total_pnl_usd < 0
                            ? "text-short"
                            : "";
                    return (
                      <tr
                        key={r.bucket}
                        onClick={() => {
                          if (r.trades === 0) return;
                          onSelect(isActive ? null : { dim: key, bucket: r.bucket });
                        }}
                        className={`border-t border-border cursor-pointer hover:bg-muted/40 ${
                          isActive ? "bg-primary/10" : isBest ? "bg-emerald-500/5" : ""
                        } ${r.trades === 0 ? "opacity-60 cursor-default" : ""}`}
                      >
                        <td className="px-2 py-1 capitalize">
                          {r.bucket}
                          {isBest && <span className="ml-1 text-[9px] text-emerald-400">★</span>}
                        </td>
                        <td className="text-right px-2 py-1">{r.trades}</td>
                        <td className="text-right px-2 py-1">
                          {r.trades > 0 ? `${r.win_rate_pct.toFixed(0)}%` : "—"}
                        </td>
                        <td className={`text-right px-2 py-1 ${tone}`}>
                          {r.trades > 0 ? fmtUsd(r.total_pnl_usd) : "—"}
                        </td>
                        <td className={`text-right px-2 py-1 ${tone}`}>
                          {r.trades > 0 ? r.avg_r.toFixed(2) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}


const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

type DayRow = RangeData["days"][number];

function CalendarView({ data }: { data: RangeData }) {
  const fmtUsd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

  const months = useMemo(() => {
    const byMonth = new Map<string, { year: number; month: number; days: Map<number, DayRow> }>();
    for (const d of data.days) {
      const [y, m, dd] = d.ist_date.split("-").map((n) => parseInt(n, 10));
      const key = `${y}-${String(m).padStart(2, "0")}`;
      let bucket = byMonth.get(key);
      if (!bucket) {
        bucket = { year: y, month: m, days: new Map() };
        byMonth.set(key, bucket);
      }
      bucket.days.set(dd, d);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([, v]) => v);
  }, [data.days]);

  const monthTotals = useMemo(
    () =>
      months.map((m) => {
        const rows = [...m.days.values()];
        const total = rows.reduce((s, r) => s + r.pnl_usd, 0);
        const closed = rows.filter((r) => r.outcome === "tp" || r.outcome === "sl");
        const wins = closed.filter((r) => r.pnl_usd > 0).length;
        const losses = closed.filter((r) => r.pnl_usd < 0).length;
        return { year: m.year, month: m.month, total, wins, losses, trades: wins + losses };
      }),
    [months],
  );

  const bestMonth = monthTotals.reduce<typeof monthTotals[number] | null>(
    (b, m) => (b == null || m.total > b.total ? m : b),
    null,
  );
  const worstMonth = monthTotals.reduce<typeof monthTotals[number] | null>(
    (b, m) => (b == null || m.total < b.total ? m : b),
    null,
  );

  // Month navigation (most recent first).
  const [monthIdx, setMonthIdx] = useState(0);
  const activeIdx = Math.min(monthIdx, Math.max(0, months.length - 1));
  const active = months[activeIdx];
  const [selected, setSelected] = useState<DayRow | null>(null);

  const jumpYear = (dir: 1 | -1) => {
    if (!active) return;
    const target = active.year - dir; // dir=1 = older year (higher idx)
    const found = months.findIndex((m) => m.year === target);
    if (found >= 0) setMonthIdx(found);
    else {
      // fallback: nearest month whose year <= target (older) or >= target (newer)
      const idx = dir === 1
        ? months.findIndex((m) => m.year <= target)
        : [...months].reverse().findIndex((m) => m.year >= target);
      if (idx >= 0) setMonthIdx(dir === 1 ? idx : months.length - 1 - idx);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Calendar — daily P&amp;L
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kv k="months covered" v={String(monthTotals.length)} />
        <Kv
          k="best month"
          v={
            bestMonth
              ? `${MONTH_LABELS[bestMonth.month - 1].slice(0, 3)} ${bestMonth.year} ${fmtUsd(bestMonth.total)}`
              : "—"
          }
          tone="text-long"
        />
        <Kv
          k="worst month"
          v={
            worstMonth
              ? `${MONTH_LABELS[worstMonth.month - 1].slice(0, 3)} ${worstMonth.year} ${fmtUsd(worstMonth.total)}`
              : "—"
          }
          tone="text-short"
        />
        <Kv
          k="avg month"
          v={
            monthTotals.length
              ? fmtUsd(monthTotals.reduce((s, m) => s + m.total, 0) / monthTotals.length)
              : "—"
          }
        />
      </div>

      <div className="border border-border rounded overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-muted/60">
            <tr>
              <th className="text-left px-2 py-1">Month</th>
              <th className="text-right px-2 py-1">Trades</th>
              <th className="text-right px-2 py-1">W / L</th>
              <th className="text-right px-2 py-1">Win %</th>
              <th className="text-right px-2 py-1">Total $</th>
            </tr>
          </thead>
          <tbody>
            {monthTotals.map((m, i) => {
              const winRate = m.trades > 0 ? (m.wins / m.trades) * 100 : 0;
              const tone =
                m.total > 0 ? "text-long" : m.total < 0 ? "text-short" : "text-muted-foreground";
              const isActive = i === activeIdx;
              return (
                <tr
                  key={`${m.year}-${m.month}`}
                  className={`border-t border-border cursor-pointer hover:bg-muted/40 ${
                    isActive ? "bg-muted/40" : ""
                  }`}
                  onClick={() => setMonthIdx(i)}
                >
                  <td className="px-2 py-1">
                    {MONTH_LABELS[m.month - 1]} {m.year}
                  </td>
                  <td className="text-right px-2 py-1">{m.trades}</td>
                  <td className="text-right px-2 py-1">
                    {m.wins} / {m.losses}
                  </td>
                  <td className="text-right px-2 py-1">
                    {m.trades > 0 ? `${winRate.toFixed(0)}%` : "—"}
                  </td>
                  <td className={`text-right px-2 py-1 ${tone}`}>
                    {m.trades > 0 ? fmtUsd(m.total) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-muted-foreground border border-border rounded px-3 py-2 bg-muted/20">
        <span className="uppercase tracking-widest">Legend</span>
        <div className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--primary) / 0.2)" }} />
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--primary) / 0.45)" }} />
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--primary) / 0.7)" }} />
          <span className="text-long">Win (darker = bigger $)</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--destructive) / 0.2)" }} />
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--destructive) / 0.45)" }} />
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--destructive) / 0.7)" }} />
          <span className="text-short">Loss (darker = bigger $)</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--warning, var(--primary)) / 0.15)" }} />
          <span className="text-warning">Open</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-border" style={{ backgroundColor: "hsl(var(--muted) / 0.4)" }} />
          <span>Skipped</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-border bg-transparent" />
          <span>No trade / no data</span>
        </div>
      </div>

      {/* Month nav */}
      {active && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => jumpYear(1)} disabled={activeIdx >= months.length - 1}>
              « Year
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMonthIdx(Math.min(months.length - 1, activeIdx + 1))}
              disabled={activeIdx >= months.length - 1}
            >
              ‹ Prev
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs font-mono"
              value={activeIdx}
              onChange={(e) => setMonthIdx(Number(e.target.value))}
            >
              {months.map((m, i) => (
                <option key={`${m.year}-${m.month}`} value={i}>
                  {MONTH_LABELS[m.month - 1]} {m.year}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMonthIdx(Math.max(0, activeIdx - 1))}
              disabled={activeIdx <= 0}
            >
              Next ›
            </Button>
            <Button variant="outline" size="sm" onClick={() => jumpYear(-1)} disabled={activeIdx <= 0}>
              Year »
            </Button>
          </div>
        </div>
      )}

      {active && (
        <div className="max-w-md">
          <MonthGrid
            year={active.year}
            month={active.month}
            days={active.days}
            onDayClick={(d) => setSelected(d)}
          />
        </div>
      )}

      <DayDetailSheet
        day={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        symbol={data.symbol}
        rr={data.rr}
      />
    </div>
  );
}

function DayDetailSheet({
  day,
  open,
  onOpenChange,
  symbol,
  rr,
}: {
  day: DayRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  symbol: string;
  rr: number;
}) {
  const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));
  const fmtUsd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
  const fmtTime = (ms: number | null | undefined) =>
    ms == null ? "—" : new Date(ms).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "2-digit" });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono text-sm tracking-widest">
            {day ? `${day.ist_date} · ${day.weekday_label}` : "Trade detail"}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {symbol} · target 1:{rr}
          </SheetDescription>
        </SheetHeader>

        {day && (
          <div className="mt-4 space-y-3 font-mono text-xs">
            {day.outcome === "no_session" || day.outcome === "skipped" || day.zone_high == null ? (
              <p className="text-muted-foreground">
                {day.skipped
                  ? "Weekday excluded from the simulation — no trade taken."
                  : "No session candle available for this day."}
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Kv
                    k="outcome"
                    v={day.outcome.replace(/_/g, " ").toUpperCase()}
                    tone={
                      day.outcome === "tp"
                        ? "text-long"
                        : day.outcome === "sl"
                          ? "text-short"
                          : day.outcome === "open"
                            ? "text-warning"
                            : "text-muted-foreground"
                    }
                  />
                  <Kv
                    k="p&l"
                    v={day.pnl_usd === 0 ? "—" : fmtUsd(day.pnl_usd)}
                    tone={day.pnl_usd > 0 ? "text-long" : day.pnl_usd < 0 ? "text-short" : ""}
                  />
                  <Kv
                    k="side"
                    v={day.break_side ? day.break_side.toUpperCase() : "—"}
                    tone={day.break_side === "long" ? "text-long" : day.break_side === "short" ? "text-short" : ""}
                  />
                  <Kv k="peak R" v={day.peak_r > 0 ? day.peak_r.toFixed(2) : "—"} />
                </div>

                <div className="border border-border rounded">
                  <table className="w-full text-[11px]">
                    <tbody>
                      <Row k="Zone High / Low" v={`${fmt(day.zone_high)} / ${fmt(day.zone_low)}`} />
                      <Row k="Fib 25% / 75%" v={`${fmt(day.fib_25)} / ${fmt(day.fib_75)}`} />
                      <Row
                        k="Break"
                        v={day.break_side ? `${day.break_side.toUpperCase()} @ ${fmt(day.break_close)}` : "—"}
                      />
                      <Row k="Break time" v={fmtTime(day.break_at)} />
                      <Row k="Entry" v={fmt(day.entry)} />
                      <Row k="Initial SL" v={fmt(day.sl)} />
                      <Row k="Final SL" v={fmt(day.final_sl)} />
                      <Row k="TP" v={fmt(day.tp)} />
                      <Row k="Qty" v={day.qty != null ? day.qty.toFixed(4) : "—"} />
                      <Row k="Triggered at" v={fmtTime(day.trigger_at)} />
                      <Row k="Exit R" v={day.exit_r != null ? day.exit_r.toFixed(2) : "—"} />
                    </tbody>
                  </table>
                </div>

                {day.outcome === "no_break" && (
                  <p className="text-muted-foreground">Price never closed outside the session range — no setup armed.</p>
                )}
                {day.outcome === "armed_no_trigger" && (
                  <p className="text-muted-foreground">Setup armed but price never pulled back to the entry.</p>
                )}
                {day.outcome === "open" && (
                  <p className="text-warning">Trade is still open in this replay window.</p>
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr className="border-t border-border first:border-t-0">
      <td className="px-2 py-1 text-muted-foreground">{k}</td>
      <td className="px-2 py-1 text-right">{v}</td>
    </tr>
  );
}

function MonthGrid({
  year,
  month,
  days,
  onDayClick,
}: {
  year: number;
  month: number;
  days: Map<number, DayRow>;
  onDayClick?: (d: DayRow) => void;
}) {
  const fmtUsd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(0)}`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=Sun
  const rows = [...days.values()];
  const total = rows.reduce((s, r) => s + r.pnl_usd, 0);
  // Classify by realized P&L sign so trailed-stop exits above entry count as wins
  // (engine still tags those "sl" because the stop-loss order fired).
  const closedRows = rows.filter((r) => r.outcome === "tp" || r.outcome === "sl");
  const wins = closedRows.filter((r) => r.pnl_usd > 0).length;
  const losses = closedRows.filter((r) => r.pnl_usd < 0).length;
  const totalTone = total > 0 ? "text-long" : total < 0 ? "text-short" : "text-muted-foreground";

  // Extremes for color intensity scaling.
  const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.pnl_usd)), 0) || 1;

  const cells: (DayRow | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(days.get(d) ?? null);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="border border-border rounded p-2 bg-muted/20">
      <div className="flex items-center justify-between mb-2">
        <div className="font-mono text-[11px] tracking-widest uppercase">
          {MONTH_LABELS[month - 1]} {year}
        </div>
        <div className={`font-mono text-[11px] ${totalTone}`}>
          {fmtUsd(total)} · {wins}W/{losses}L
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {(["S", "M", "T", "W", "T", "F", "S"] as const).map((d, i) => (
          <div
            key={i}
            className="text-[9px] uppercase text-muted-foreground text-center tracking-widest"
          >
            {d}
          </div>
        ))}
        {cells.map((c, i) => {
          if (!c) return <div key={i} className="h-11 rounded bg-transparent" />;
          const dayNum = parseInt(c.ist_date.slice(8, 10), 10);
          const pnl = c.pnl_usd;
          const intensity = Math.min(1, Math.abs(pnl) / maxAbs);
          const alpha = 0.15 + intensity * 0.55;
          let bg = "transparent";
          let textCls = "text-muted-foreground";
          // Color by realized P&L sign, not the outcome tag: trailed-stop exits
          // above entry are tagged "sl" but should render green.
          if (c.outcome === "tp" || c.outcome === "sl") {
            if (pnl > 0) {
              bg = `hsl(var(--primary) / ${alpha})`;
              textCls = "text-long";
            } else if (pnl < 0) {
              bg = `hsl(var(--destructive) / ${alpha})`;
              textCls = "text-short";
            } else {
              bg = "hsl(var(--muted) / 0.4)";
            }
          } else if (c.skipped) {
            bg = "hsl(var(--muted) / 0.4)";
          } else if (c.outcome === "open") {
            bg = "hsl(var(--warning, var(--primary)) / 0.15)";
            textCls = "text-warning";
          }
          const outcomeLabel = (c.outcome === "sl" && pnl > 0) ? "trail win" : c.outcome.replace(/_/g, " ");
          const title = `${c.ist_date} · ${outcomeLabel}${pnl !== 0 ? ` · ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}` : ""}`;
          const clickable = !!onDayClick;
          return (
            <button
              key={i}
              type="button"
              title={title}
              onClick={clickable ? () => onDayClick!(c) : undefined}
              className={`h-11 rounded border border-border/60 px-1 py-0.5 flex flex-col justify-between text-left transition ${
                clickable ? "hover:ring-1 hover:ring-primary/50 cursor-pointer" : "cursor-default"
              }`}
              style={{ backgroundColor: bg }}
            >
              <div className="text-[9px] font-mono text-foreground/70">{dayNum}</div>
              <div className={`text-[9px] font-mono text-right ${textCls}`}>
                {pnl !== 0 ? fmtUsd(pnl) : c.skipped ? "·" : ""}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}


type SweepData = Awaited<ReturnType<typeof sweepHoursBacktest>>;

const SWEEP_RANGE_OPTIONS = [7, 30, 60, 90, 180, 365];

function HourSweepPanel({
  defaults,
  filters,
}: {
  defaults: {
    symbol: string;
    slRiskUsd: number;
    rr: number;
    trailEnabled: boolean;
    trailActivateR: number;
    trailStepR: number;
    skipWeekdays: number[];
  };
  filters: FilterConfig;
}) {
  const runSweepFn = useServerFn(sweepHoursBacktest);
  const [symbol, setSymbol] = useState<string>(defaults.symbol);
  const [ranges, setRanges] = useState<number[]>([7, 30, 60, 90]);
  const [slRiskUsd, setSl] = useState<number>(defaults.slRiskUsd);
  const [rr, setRr] = useState<number>(defaults.rr);
  const [skipWeekdays, setSkipWeekdays] = useState<number[]>(defaults.skipWeekdays ?? [0]);
  const [data, setData] = useState<SweepData | null>(null);
  const [activeRange, setActiveRange] = useState<number>(90);
  const [sortKey, setSortKey] = useState<"pnl" | "wr" | "dd" | "hour">("pnl");
  const [cohortDim, setCohortDim] = useState<"none" | CohortDimKey>("none");

  const runMut = useMutation({
    mutationFn: () =>
      runSweepFn({
        data: {
          symbol,
          ranges,
          sl_risk_usd: slRiskUsd,
          rr,
          trail_enabled: defaults.trailEnabled,
          trail_activate_r: defaults.trailActivateR,
          trail_step_r: defaults.trailStepR,
          skip_weekdays: skipWeekdays,
          filters,
        },
      }),
    onSuccess: (r) => {
      setData(r);
      const first = r.ranges[0]?.days;
      if (first) setActiveRange(first);
      toast.success(`Sweep done — ${r.ranges.length} range(s) × 24 hours`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleRange = (d: number) => {
    setRanges((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    );
  };

  const active = data?.ranges.find((r) => r.days === activeRange) ?? data?.ranges[0] ?? null;

  const sortedHours = useMemo(() => {
    if (!active) return [];
    const rows = [...active.hours];
    rows.sort((a, b) => {
      switch (sortKey) {
        case "pnl":
          return b.total_pnl_usd - a.total_pnl_usd;
        case "wr":
          return b.win_rate_pct - a.win_rate_pct;
        case "dd":
          return a.max_drawdown_usd - b.max_drawdown_usd;
        case "hour":
        default:
          return a.hour.localeCompare(b.hour);
      }
    });
    return rows;
  }, [active, sortKey]);

  const fmtUsd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
  const tone = (n: number) => (n > 0 ? "text-long" : n < 0 ? "text-short" : "text-muted-foreground");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono tracking-widest">24-HOUR SWEEP</CardTitle>
        <p className="text-xs text-muted-foreground">
          Auto-run the backtest for every hourly session start (00:00 → 23:00) across selected day windows,
          then rank hours by total P&amp;L.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Symbol">
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
            >
              <option value="XAUUSDT">XAUUSDT · Gold</option>
              <option value="BTCUSDT">BTCUSDT · Bitcoin</option>
            </select>
          </Field>
          <Field label="SL risk ($/trade)">
            <Input
              type="number"
              min={1}
              step={1}
              value={slRiskUsd}
              onChange={(e) => setSl(Math.max(1, Number(e.target.value) || 1))}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label="R:R (1 : X)">
            <Input
              type="number"
              min={0.5}
              step={0.1}
              value={rr}
              onChange={(e) => setRr(Math.max(0.5, Number(e.target.value) || 0.5))}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label="Ranges (days)">
            <div className="flex flex-wrap gap-1 pt-1">
              {SWEEP_RANGE_OPTIONS.map((d) => {
                const on = ranges.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleRange(d)}
                    className={`px-2 h-7 rounded font-mono text-[11px] border ${
                      on
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-background border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {d}d
                  </button>
                );
              })}
            </div>
          </Field>
        </div>

        <Field label="Skip weekdays (IST)">
          <div className="flex flex-wrap gap-1 pt-1">
            {(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const).map((label, idx) => {
              const on = skipWeekdays.includes(idx);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() =>
                    setSkipWeekdays((prev) =>
                      prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx].sort(),
                    )
                  }
                  className={`px-2 h-7 rounded font-mono text-[11px] border ${
                    on
                      ? "bg-short/10 border-short text-short"
                      : "bg-background border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={runMut.isPending || ranges.length === 0}
            onClick={() => runMut.mutate()}
          >
            {runMut.isPending ? "Sweeping 24 hours…" : "Run 24-hour sweep"}
          </Button>
          <p className="text-[10px] text-muted-foreground">
            Fetches candles once per symbol and reuses them across all hour/range combinations.
          </p>
        </div>

        {data && active && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-mono tracking-widest text-muted-foreground">RANGE:</span>
              {data.ranges.map((r) => (
                <button
                  key={r.days}
                  type="button"
                  onClick={() => setActiveRange(r.days)}
                  className={`px-2 h-7 rounded font-mono text-[11px] border ${
                    r.days === active.days
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {r.days}d
                </button>
              ))}
              <span className="ml-auto text-[10px] font-mono tracking-widest text-muted-foreground">SORT:</span>
              {(
                [
                  ["pnl", "P&L"],
                  ["wr", "Win rate"],
                  ["dd", "Max DD"],
                  ["hour", "Hour"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSortKey(k)}
                  className={`px-2 h-7 rounded font-mono text-[11px] border ${
                    sortKey === k
                      ? "bg-muted border-foreground/30"
                      : "bg-background border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono tracking-widest text-muted-foreground">COHORT:</span>
              <select
                value={cohortDim}
                onChange={(e) => setCohortDim(e.target.value as "none" | CohortDimKey)}
                className="h-7 rounded border border-input bg-background px-2 font-mono text-[11px]"
              >
                <option value="none">Overall</option>
                {(Object.keys(COHORT_DIM_LABELS) as CohortDimKey[]).map((k) => (
                  <option key={k} value={k}>{COHORT_DIM_LABELS[k]}</option>
                ))}
              </select>
              {cohortDim !== "none" && (
                <span className="text-[10px] text-muted-foreground">
                  Best bucket per hour (by $ P&amp;L within that hour's slice).
                </span>
              )}
            </div>

            <div className="overflow-x-auto border border-border rounded">
              <table className="w-full font-mono text-[11px]">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-1.5">Hour (IST)</th>
                    <th className="text-right px-2 py-1.5">Trades</th>
                    <th className="text-right px-2 py-1.5">Win rate</th>
                    <th className="text-right px-2 py-1.5">Total P&amp;L</th>
                    <th className="text-right px-2 py-1.5">Max DD</th>
                    <th className="text-right px-2 py-1.5">PF</th>
                    <th className="text-right px-2 py-1.5">Avg R</th>
                    {cohortDim !== "none" && (
                      <th className="text-left px-2 py-1.5">Best {COHORT_DIM_LABELS[cohortDim]}</th>
                    )}
                    <th className="text-left px-2 py-1.5">Best day</th>
                    <th className="text-left px-2 py-1.5">Worst day</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedHours.map((h) => (
                    <tr key={h.hour} className="border-t border-border">
                      <td className="px-2 py-1.5 font-semibold">{h.hour}</td>
                      <td className="px-2 py-1.5 text-right">
                        {h.trades}
                        <span className="text-muted-foreground"> ({h.wins}W/{h.losses}L)</span>
                      </td>
                      <td className={`px-2 py-1.5 text-right ${h.win_rate_pct >= 50 ? "text-long" : "text-short"}`}>
                        {h.win_rate_pct.toFixed(1)}%
                      </td>
                      <td className={`px-2 py-1.5 text-right ${tone(h.total_pnl_usd)}`}>
                        {fmtUsd(h.total_pnl_usd)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-short">
                        {h.max_drawdown_usd > 0 ? `-${h.max_drawdown_usd.toFixed(2)}` : "0.00"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {isFinite(h.profit_factor) ? h.profit_factor.toFixed(2) : "∞"}
                      </td>
                      <td className="px-2 py-1.5 text-right">{h.avg_r.toFixed(2)}</td>
                      {cohortDim !== "none" && (
                        <td className="px-2 py-1.5 text-left">
                          {(() => {
                            const buckets = h.cohorts[cohortDim].buckets.filter((b) => b.trades > 0);
                            if (!buckets.length) return <span className="text-muted-foreground">—</span>;
                            const b = buckets.reduce((a, c) => (c.total_pnl_usd > a.total_pnl_usd ? c : a));
                            return (
                              <span className={tone(b.total_pnl_usd)}>
                                <span className="uppercase">{b.bucket}</span>{" "}
                                <span className="text-muted-foreground">
                                  · {b.trades}t · {b.win_rate_pct.toFixed(0)}% · {fmtUsd(b.total_pnl_usd)}
                                </span>
                              </span>
                            );
                          })()}
                        </td>
                      )}
                      <td className="px-2 py-1.5 text-left">
                        {h.best_day ? (
                          <span className={tone(h.best_day.pnl_usd)}>
                            {h.best_day.ist_date} · {fmtUsd(h.best_day.pnl_usd)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-left">
                        {h.worst_day ? (
                          <span className={tone(h.worst_day.pnl_usd)}>
                            {h.worst_day.ist_date} · {fmtUsd(h.worst_day.pnl_usd)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">
              {data.symbol} · SL ${data.sl_risk_usd} · RR 1:{data.rr} · window {active.days}d ·
              {data.trail.enabled
                ? ` trail on (act ${data.trail.activate_r}R / step ${data.trail.step_r}R)`
                : " trail off"}
              {data.skip_weekdays.length > 0
                ? ` · skip [${data.skip_weekdays.map((w) => WD_LABELS[w]).join(", ")}]`
                : ""}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FiltersCard({
  value,
  onChange,
}: {
  value: NonNullable<FilterConfig>;
  onChange: (v: NonNullable<FilterConfig>) => void;
}) {
  const htf = value.htf ?? {};
  const q = value.quality ?? {};
  const setHtf = (patch: Partial<typeof htf>) =>
    onChange({ ...value, htf: { ...htf, ...patch } });
  const setQ = (patch: Partial<typeof q>) =>
    onChange({ ...value, quality: { ...q, ...patch } });
  const numOr = (v: string, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-mono tracking-widest">FILTERS</CardTitle>
            <p className="text-xs text-muted-foreground">
              Applied to the single-run backtest and the 24-hour sweep. Live rules are unchanged.
            </p>
          </div>
          <label className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Master
            </span>
            <Switch
              checked={!!value.enabled}
              onCheckedChange={(v) => onChange({ ...value, enabled: v })}
            />
          </label>
        </div>
      </CardHeader>
      <CardContent className={`space-y-5 ${value.enabled ? "" : "opacity-60"}`}>
        {/* HTF BIAS */}
        <section className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            HTF Bias — only take trades that agree with all enabled references
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={!!htf.daily_ema_enabled}
                onCheckedChange={(v) => setHtf({ daily_ema_enabled: v })}
                disabled={!value.enabled}
              />
              <span className="text-xs">Daily EMA</span>
              <Input
                type="number"
                min={2}
                max={400}
                value={htf.daily_ema_len ?? 20}
                onChange={(e) => setHtf({ daily_ema_len: Math.max(2, numOr(e.target.value, 20)) })}
                className="h-7 w-16 font-mono text-xs"
                disabled={!value.enabled || !htf.daily_ema_enabled}
              />
              <span className="text-[10px] text-muted-foreground">len</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={!!htf.prev_day_close_enabled}
                onCheckedChange={(v) => setHtf({ prev_day_close_enabled: v })}
                disabled={!value.enabled}
              />
              <span className="text-xs">Prior-day close</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={!!htf.weekly_open_enabled}
                onCheckedChange={(v) => setHtf({ weekly_open_enabled: v })}
                disabled={!value.enabled}
              />
              <span className="text-xs">Weekly open</span>
            </div>
          </div>

          {/* D1 EMA regime gate — highest-EV filter from research (PF 1.85 on XAUUSD). */}
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40 mt-2 pt-3">
            <Switch
              checked={!!htf.ema_bias_enabled}
              onCheckedChange={(v) => setHtf({ ema_bias_enabled: v })}
              disabled={!value.enabled}
            />
            <span className="text-xs w-28">D1 EMA regime</span>
            <Input
              type="number"
              min={2}
              max={400}
              value={htf.ema_bias_fast ?? 21}
              onChange={(e) => setHtf({ ema_bias_fast: Math.max(2, numOr(e.target.value, 21)) })}
              className="h-7 w-16 font-mono text-xs"
              disabled={!value.enabled || !htf.ema_bias_enabled}
            />
            <span className="text-[10px] text-muted-foreground">fast</span>
            <Input
              type="number"
              min={2}
              max={400}
              value={htf.ema_bias_slow ?? 50}
              onChange={(e) => setHtf({ ema_bias_slow: Math.max(2, numOr(e.target.value, 50)) })}
              className="h-7 w-16 font-mono text-xs"
              disabled={!value.enabled || !htf.ema_bias_enabled}
            />
            <span className="text-[10px] text-muted-foreground">slow</span>
            <select
              value={htf.ema_bias_mode ?? "gate_by_slow"}
              onChange={(e) =>
                setHtf({ ema_bias_mode: e.target.value as "gate_by_slow" | "gate_by_cross" })
              }
              className="h-7 rounded border border-input bg-background px-2 text-xs font-mono"
              disabled={!value.enabled || !htf.ema_bias_enabled}
            >
              <option value="gate_by_slow">price vs slow</option>
              <option value="gate_by_cross">fast vs slow cross</option>
            </select>
          </div>

        </section>

        {/* SETUP QUALITY */}
        <section className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Setup Quality
          </div>

          {/* Zone size */}
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={!!q.zone_size_enabled}
              onCheckedChange={(v) => setQ({ zone_size_enabled: v })}
              disabled={!value.enabled}
            />
            <span className="text-xs w-28">Zone size</span>
            <Input
              type="number"
              min={0}
              value={q.zone_size_min ?? 0}
              onChange={(e) => setQ({ zone_size_min: Math.max(0, numOr(e.target.value, 0)) })}
              className="h-7 w-20 font-mono text-xs"
              placeholder="min"
              disabled={!value.enabled || !q.zone_size_enabled}
            />
            <span className="text-[10px] text-muted-foreground">min</span>
            <Input
              type="number"
              min={0}
              value={q.zone_size_max ?? 0}
              onChange={(e) => setQ({ zone_size_max: Math.max(0, numOr(e.target.value, 0)) })}
              className="h-7 w-20 font-mono text-xs"
              placeholder="max"
              disabled={!value.enabled || !q.zone_size_enabled}
            />
            <span className="text-[10px] text-muted-foreground">max</span>
            <select
              value={q.zone_size_unit ?? "usd"}
              onChange={(e) => setQ({ zone_size_unit: e.target.value as "usd" | "pct" })}
              className="h-7 rounded border border-input bg-background px-2 text-xs font-mono"
              disabled={!value.enabled || !q.zone_size_enabled}
            >
              <option value="usd">$</option>
              <option value="pct">%</option>
            </select>
            <span className="text-[10px] text-muted-foreground">0 = off</span>
          </div>

          {/* ATR regime */}
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={!!q.atr_enabled}
              onCheckedChange={(v) => setQ({ atr_enabled: v })}
              disabled={!value.enabled}
            />
            <span className="text-xs w-28">Daily ATR</span>
            <Input
              type="number"
              min={2}
              max={200}
              value={q.atr_len ?? 14}
              onChange={(e) => setQ({ atr_len: Math.max(2, numOr(e.target.value, 14)) })}
              className="h-7 w-16 font-mono text-xs"
              disabled={!value.enabled || !q.atr_enabled}
            />
            <span className="text-[10px] text-muted-foreground">len</span>
            <Input
              type="number"
              min={0}
              value={q.atr_min ?? 0}
              onChange={(e) => setQ({ atr_min: Math.max(0, numOr(e.target.value, 0)) })}
              className="h-7 w-20 font-mono text-xs"
              disabled={!value.enabled || !q.atr_enabled}
            />
            <span className="text-[10px] text-muted-foreground">min $</span>
            <Input
              type="number"
              min={0}
              value={q.atr_max ?? 0}
              onChange={(e) => setQ({ atr_max: Math.max(0, numOr(e.target.value, 0)) })}
              className="h-7 w-20 font-mono text-xs"
              disabled={!value.enabled || !q.atr_enabled}
            />
            <span className="text-[10px] text-muted-foreground">max $ · 0 = off</span>
          </div>

          {/* ATR squeeze — only take setups when today's ATR is compressed vs its recent average. */}
          <div className="flex flex-wrap items-center gap-2 pl-8">
            <Switch
              checked={!!q.atr_squeeze_enabled}
              onCheckedChange={(v) => setQ({ atr_squeeze_enabled: v })}
              disabled={!value.enabled}
            />
            <span className="text-xs w-24">ATR squeeze</span>
            <Input
              type="number"
              min={3}
              max={200}
              value={q.atr_squeeze_lookback ?? 20}
              onChange={(e) =>
                setQ({ atr_squeeze_lookback: Math.max(3, numOr(e.target.value, 20)) })
              }
              className="h-7 w-16 font-mono text-xs"
              disabled={!value.enabled || !q.atr_squeeze_enabled}
            />
            <span className="text-[10px] text-muted-foreground">lookback</span>
            <Input
              type="number"
              min={0.1}
              max={2}
              step={0.05}
              value={q.atr_squeeze_ratio ?? 0.7}
              onChange={(e) =>
                setQ({
                  atr_squeeze_ratio: Math.max(0.1, Math.min(2, numOr(e.target.value, 0.7))),
                })
              }
              className="h-7 w-20 font-mono text-xs"
              disabled={!value.enabled || !q.atr_squeeze_enabled}
            />
            <span className="text-[10px] text-muted-foreground">
              ratio (atr / avg ≤ ratio → take trade)
            </span>
          </div>


          {/* Break strength */}
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={!!q.break_strength_enabled}
              onCheckedChange={(v) => setQ({ break_strength_enabled: v })}
              disabled={!value.enabled}
            />
            <span className="text-xs w-28">Break strength</span>
            <Input
              type="number"
              min={0}
              max={500}
              value={q.break_strength_pct ?? 25}
              onChange={(e) => setQ({ break_strength_pct: Math.max(0, numOr(e.target.value, 0)) })}
              className="h-7 w-20 font-mono text-xs"
              disabled={!value.enabled || !q.break_strength_enabled}
            />
            <span className="text-[10px] text-muted-foreground">% of zone range beyond level</span>
          </div>

          {/* Break body */}
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={!!q.break_body_enabled}
              onCheckedChange={(v) => setQ({ break_body_enabled: v })}
              disabled={!value.enabled}
            />
            <span className="text-xs w-28">Break body</span>
            <Input
              type="number"
              min={0}
              max={100}
              value={q.break_body_pct ?? 50}
              onChange={(e) => setQ({ break_body_pct: Math.max(0, Math.min(100, numOr(e.target.value, 0))) })}
              className="h-7 w-20 font-mono text-xs"
              disabled={!value.enabled || !q.break_body_enabled}
            />
            <span className="text-[10px] text-muted-foreground">% body / bar range</span>
          </div>

          {/* Break timing */}
          <div className="flex flex-wrap items-center gap-2">
            <Switch
              checked={!!q.break_timing_enabled}
              onCheckedChange={(v) => setQ({ break_timing_enabled: v })}
              disabled={!value.enabled}
            />
            <span className="text-xs w-28">Break timing</span>
            <Input
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={q.break_timing_hours ?? 6}
              onChange={(e) => setQ({ break_timing_hours: Math.max(0, Math.min(24, numOr(e.target.value, 0))) })}
              className="h-7 w-20 font-mono text-xs"
              disabled={!value.enabled || !q.break_timing_enabled}
            />
            <span className="text-[10px] text-muted-foreground">within N hours after session</span>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Strategies roadmap card — surfaces the 5 researched gold strategies so the
// user can see the full plan. Phase 1 (EMA regime gate + ATR squeeze) is live
// in the Filters card above. Phases 2-3 land in follow-up turns.
// -----------------------------------------------------------------------------
function StrategiesRoadmapCard() {
  const rows: Array<{
    name: string;
    status: "live" | "next" | "planned";
    detail: string;
  }> = [
    {
      name: "D1 EMA regime gate",
      status: "live",
      detail:
        "Filters → HTF Bias → D1 EMA regime. Best-backtested XAUUSD filter (PF 1.85, 3% DD, +0.524R on 8,693 trades). Modes: price vs slow, or fast/slow cross.",
    },
    {
      name: "ATR squeeze pre-session filter",
      status: "live",
      detail:
        "Filters → Setup Quality → ATR squeeze. Only takes ORB when today's ATR ≤ ratio × SMA(ATR, lookback). Tune lookback + ratio to skip already-expanded sessions.",
    },
    {
      name: "Multi-session ORB (Asian / London / NY)",
      status: "next",
      detail:
        "Loops your existing ORB engine over configurable session windows (05:30 / 13:30 / 18:30 IST). Each session gets its own entry mode + RR overrides. Backtest-only.",
    },
    {
      name: "Asian Liquidity Sweep + Reversal",
      status: "next",
      detail:
        "New setup engine. Detects wick sweeps of PDH/PDL, Asian H/L, equal H/L, round numbers (10/25/50 USD grid) with body-back-inside confirmation. Two-target RR (nearest FVG → opposite liquidity).",
    },
    {
      name: "ICT Silver Bullet — NY AM (19:30–20:30 IST)",
      status: "planned",
      detail:
        "MSS + 3-bar FVG detector inside the 60-min kill zone with premium/discount validation. Needs 1m/3m kline fetch added to the pipeline; largest scope, saved for last.",
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono tracking-widest">STRATEGIES</CardTitle>
        <p className="text-xs text-muted-foreground">
          Five gold strategies from the research report. Phase 1 filters below are wired into the
          current ORB backtest — toggle them in the Filters card above.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.name}
            className="flex items-start gap-3 text-xs border-l-2 pl-3 py-1"
            style={{
              borderColor:
                r.status === "live"
                  ? "hsl(var(--success, 142 76% 36%))"
                  : r.status === "next"
                    ? "hsl(var(--warning, 38 92% 50%))"
                    : "hsl(var(--muted-foreground))",
            }}
          >
            <span
              className={`font-mono text-[10px] uppercase tracking-widest w-16 shrink-0 ${
                r.status === "live"
                  ? "text-emerald-500"
                  : r.status === "next"
                    ? "text-amber-500"
                    : "text-muted-foreground"
              }`}
            >
              {r.status === "live" ? "● live" : r.status === "next" ? "○ next" : "· planned"}
            </span>
            <div className="min-w-0">
              <div className="font-semibold">{r.name}</div>
              <div className="text-muted-foreground">{r.detail}</div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}


// -----------------------------------------------------------------------------
// Entry-zone grid sweep panel — scans (mode, entry_depth, sl_depth) combos.
// -----------------------------------------------------------------------------
function EntryZoneGridPanel(props: {
  defaults: {
    symbol: string;
    sessionStartIst: string;
    slRiskUsd: number;
    rr: number;
    trailEnabled: boolean;
    trailActivateR: number;
    trailStepR: number;
    skipWeekdays: number[];
  };
  filters: NonNullable<FilterConfig>;
}) {
  const run = useServerFn(runEntryZoneSweep);
  const [days, setDays] = useState(90);
  const [modes, setModes] = useState<Array<"fib" | "retest" | "market" | "adaptive">>(["fib"]);
  const [entryDepthsStr, setEntryDepthsStr] = useState("0, 0.1, 0.2, 0.25, 0.35, 0.5");
  const [slDepthsStr, setSlDepthsStr] = useState("0.5, 0.75, 1.0");
  const [result, setResult] = useState<Awaited<ReturnType<typeof runEntryZoneSweep>> | null>(null);
  const [cohortDim, setCohortDim] = useState<"none" | CohortDimKey>("none");

  const parseList = (s: string) =>
    s.split(/[,\s]+/).map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));

  const mut = useMutation({
    mutationFn: () =>
      run({
        data: {
          symbol: props.defaults.symbol,
          days,
          session_start_ist: props.defaults.sessionStartIst,
          sl_risk_usd: props.defaults.slRiskUsd,
          rr: props.defaults.rr,
          entry_depths: parseList(entryDepthsStr),
          sl_depths: parseList(slDepthsStr),
          modes,
          trail_enabled: props.defaults.trailEnabled,
          trail_activate_r: props.defaults.trailActivateR,
          trail_step_r: props.defaults.trailStepR,
          skip_weekdays: props.defaults.skipWeekdays,
          filters: props.filters,
        },
      }),
    onSuccess: (r) => {
      setResult(r);
      const best = r.cells.reduce<(typeof r.cells)[number] | null>(
        (a, b) => (a == null || b.net_pnl_usd > a.net_pnl_usd ? b : a),
        null,
      );
      if (best) {
        toast.success(
          `Best: ${best.mode} depth=${(best.entry_depth * 100).toFixed(0)}%/${(best.sl_depth * 100).toFixed(0)}% net $${best.net_pnl_usd.toFixed(2)}`,
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bestNet = result
    ? Math.max(...result.cells.map((c) => c.net_pnl_usd), 0)
    : 0;
  const worstNet = result
    ? Math.min(...result.cells.map((c) => c.net_pnl_usd), 0)
    : 0;
  const cellTone = (net: number) => {
    if (net >= bestNet * 0.85 && net > 0) return "bg-emerald-500/25 text-emerald-300";
    if (net > 0) return "bg-emerald-500/10 text-emerald-400";
    if (net <= worstNet * 0.85 && net < 0) return "bg-red-500/25 text-red-300";
    if (net < 0) return "bg-red-500/10 text-red-400";
    return "text-muted-foreground";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono tracking-widest">ENTRY / SL GRID SWEEP</CardTitle>
        <p className="text-xs text-muted-foreground">
          Backtests every combination of entry mode and depth on your history. Optimized on <b>net</b> P&L (after fees).
        </p>
      </CardHeader>
      <CardContent className="space-y-4 font-mono text-xs">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label={`Days — ${days}`}>
            <input type="range" min={14} max={730} step={7} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full" />
          </Field>
          <div className="md:col-span-3 space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Modes</Label>
            <div className="flex flex-wrap gap-1">
              {(["fib", "retest", "market", "adaptive"] as const).map((m) => {
                const on = modes.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModes(on ? modes.filter((x) => x !== m) : [...modes, m])}
                    className={`px-3 h-7 rounded font-mono text-[11px] border uppercase tracking-wider ${
                      on
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="md:col-span-2 space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Entry depths (0–0.5)
            </Label>
            <Input value={entryDepthsStr} onChange={(e) => setEntryDepthsStr(e.target.value)} className="h-7 font-mono text-xs" />
          </div>
          <div className="md:col-span-2 space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
              SL depths (0.1–1.0)
            </Label>
            <Input value={slDepthsStr} onChange={(e) => setSlDepthsStr(e.target.value)} className="h-7 font-mono text-xs" />
          </div>
        </div>
        <div>
          <Button size="sm" disabled={mut.isPending || modes.length === 0} onClick={() => mut.mutate()}>
            {mut.isPending ? "Sweeping…" : `Run grid — ${days}d × ${modes.length} modes`}
          </Button>
        </div>

        {result && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] tracking-widest text-muted-foreground">COHORT:</span>
              <select
                value={cohortDim}
                onChange={(e) => setCohortDim(e.target.value as "none" | CohortDimKey)}
                className="h-7 rounded border border-input bg-background px-2 text-[11px]"
              >
                <option value="none">Overall</option>
                {(Object.keys(COHORT_DIM_LABELS) as CohortDimKey[]).map((k) => (
                  <option key={k} value={k}>{COHORT_DIM_LABELS[k]}</option>
                ))}
              </select>
              {cohortDim !== "none" && (
                <span className="text-[10px] text-muted-foreground">Shows best bucket in that dimension per cell.</span>
              )}
            </div>
            <div className="overflow-x-auto border border-border rounded">
              <table className="w-full text-[11px]">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border text-left">
                    <th className="py-1.5 px-2">Mode</th>
                    <th className="py-1.5 px-2 text-right">Entry %</th>
                    <th className="py-1.5 px-2 text-right">SL %</th>
                    <th className="py-1.5 px-2 text-right">Fills</th>
                    <th className="py-1.5 px-2 text-right">Miss</th>
                    <th className="py-1.5 px-2 text-right">Fill %</th>
                    <th className="py-1.5 px-2 text-right">Win %</th>
                    <th className="py-1.5 px-2 text-right">Trades</th>
                    <th className="py-1.5 px-2 text-right">Gross</th>
                    <th className="py-1.5 px-2 text-right">Fees</th>
                    <th className="py-1.5 px-2 text-right">Net</th>
                    <th className="py-1.5 px-2 text-right">Expect</th>
                    {cohortDim !== "none" && (
                      <th className="py-1.5 px-2 text-left">Best {COHORT_DIM_LABELS[cohortDim]}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[...result.cells]
                    .sort((a, b) => b.net_pnl_usd - a.net_pnl_usd)
                    .map((c, i) => (
                      <tr key={i} className="border-b border-border/40">
                        <td className="py-1 px-2 uppercase">{c.mode}</td>
                        <td className="py-1 px-2 text-right">{(c.entry_depth * 100).toFixed(0)}%</td>
                        <td className="py-1 px-2 text-right">{(c.sl_depth * 100).toFixed(0)}%</td>
                        <td className="py-1 px-2 text-right">{c.triggered}</td>
                        <td className="py-1 px-2 text-right">{c.missed}</td>
                        <td className="py-1 px-2 text-right">{c.fill_rate_pct.toFixed(0)}%</td>
                        <td className="py-1 px-2 text-right">{c.win_rate_pct.toFixed(0)}%</td>
                        <td className="py-1 px-2 text-right">{c.trades}</td>
                        <td className="py-1 px-2 text-right">{c.gross_pnl_usd >= 0 ? "+" : ""}{c.gross_pnl_usd.toFixed(1)}</td>
                        <td className="py-1 px-2 text-right text-muted-foreground">-{c.fees_usd.toFixed(1)}</td>
                        <td className={`py-1 px-2 text-right font-semibold ${cellTone(c.net_pnl_usd)}`}>
                          {c.net_pnl_usd >= 0 ? "+" : ""}{c.net_pnl_usd.toFixed(1)}
                        </td>
                        <td className="py-1 px-2 text-right">{c.expectancy_usd >= 0 ? "+" : ""}{c.expectancy_usd.toFixed(2)}</td>
                        {cohortDim !== "none" && (
                          <td className="py-1 px-2 text-left">
                            {(() => {
                              const buckets = c.cohorts[cohortDim].buckets.filter((b) => b.trades > 0);
                              if (!buckets.length) return <span className="text-muted-foreground">—</span>;
                              const b = buckets.reduce((a, x) => (x.total_pnl_usd > a.total_pnl_usd ? x : a));
                              const t = b.total_pnl_usd > 0 ? "text-emerald-400" : b.total_pnl_usd < 0 ? "text-red-400" : "text-muted-foreground";
                              return (
                                <span className={t}>
                                  <span className="uppercase">{b.bucket}</span>
                                  <span className="text-muted-foreground"> · {b.trades}t · {b.win_rate_pct.toFixed(0)}% · {b.total_pnl_usd >= 0 ? "+" : ""}{b.total_pnl_usd.toFixed(0)}</span>
                                </span>
                              );
                            })()}
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------
// Multi-Session Comparison — runs the same rules against several session
// start times in parallel so the user can see London vs NY vs Asia head-to-head.
// ------------------------------------------------------------------

type MultiSessData = Awaited<ReturnType<typeof backtestSessionsCompare>>;
type MultiSessRow = MultiSessData["sessions"][number];

const SESSION_PRESETS: { label: string; time: string; hint: string }[] = [
  { label: "Sydney", time: "02:30", hint: "Sydney open" },
  { label: "Tokyo", time: "05:30", hint: "Tokyo open" },
  { label: "Asia Open", time: "06:30", hint: "Tokyo/Sydney overlap" },
  { label: "Frankfurt", time: "12:30", hint: "EU pre-open liquidity" },
  { label: "London Open", time: "13:30", hint: "First major EU push" },
  { label: "London Kill Zone", time: "14:30", hint: "1H after London" },
  { label: "London Fix", time: "15:30", hint: "London PM fix window" },
  { label: "NY Pre-open", time: "17:30", hint: "1H before US session" },
  { label: "NY Open", time: "18:30", hint: "US session start" },
  { label: "NY AM (Silver Bullet)", time: "19:30", hint: "10-11 AM NY" },
  { label: "NY Lunch", time: "21:30", hint: "12-1 PM NY quiet zone" },
  { label: "NY PM", time: "22:30", hint: "2-3 PM NY reversal window" },
  { label: "NY Close", time: "00:30", hint: "US session close" },
];

type MSOSortKey =
  | "session"
  | "net_pnl_usd"
  | "expectancy_usd"
  | "win_rate_pct"
  | "profit_factor"
  | "avg_r"
  | "fill_rate_pct"
  | "max_drawdown_usd"
  | "triggered";

function MultiSessionComparePanel(props: {
  defaults: {
    symbol: string;
    days: number;
    slRiskUsd: number;
    rr: number;
    trailEnabled: boolean;
    trailActivateR: number;
    trailStepR: number;
    skipWeekdays: number[];
    entryMode: "fib" | "retest" | "market" | "adaptive";
    entryDepthPct: number;
    slDepthPct: number;
    retestSlR: number;
  };
  filters: NonNullable<FilterConfig>;
}) {
  const runCompare = useServerFn(backtestSessionsCompare);
  const [sessions, setSessions] = useState<string[]>(["13:30", "18:30", "19:30"]);
  const [customTime, setCustomTime] = useState("15:30");
  const [data, setData] = useState<MultiSessData | null>(null);

  // Independent overrides — start off (use main form values).
  const [overrideOn, setOverrideOn] = useState(false);
  const [ovDays, setOvDays] = useState<number>(props.defaults.days);
  const [ovRr, setOvRr] = useState<number>(props.defaults.rr);
  const [ovRisk, setOvRisk] = useState<number>(props.defaults.slRiskUsd);
  const [ovEntryMode, setOvEntryMode] = useState<FormState["entryMode"]>(props.defaults.entryMode);
  const [ovEntryDepth, setOvEntryDepth] = useState<number>(props.defaults.entryDepthPct);
  const [ovSlDepth, setOvSlDepth] = useState<number>(props.defaults.slDepthPct);
  const [ovRetestSlR, setOvRetestSlR] = useState<number>(props.defaults.retestSlR);
  const [ovTrail, setOvTrail] = useState<boolean>(props.defaults.trailEnabled);
  const [ovTrailAct, setOvTrailAct] = useState<number>(props.defaults.trailActivateR);
  const [ovTrailStep, setOvTrailStep] = useState<number>(props.defaults.trailStepR);
  const [ovSkipWeekends, setOvSkipWeekends] = useState<boolean>(
    props.defaults.skipWeekdays.includes(0) && props.defaults.skipWeekdays.includes(6),
  );
  const [feeRate, setFeeRate] = useState<number>(0.0004);
  const [feesOn, setFeesOn] = useState<boolean>(true);
  const [sortKey, setSortKey] = useState<MSOSortKey>("net_pnl_usd");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showEquity, setShowEquity] = useState(true);

  const eff = overrideOn
    ? {
        days: ovDays,
        rr: ovRr,
        risk: ovRisk,
        entryMode: ovEntryMode,
        entryDepth: ovEntryDepth,
        slDepth: ovSlDepth,
        retestSlR: ovRetestSlR,
        trail: ovTrail,
        trailAct: ovTrailAct,
        trailStep: ovTrailStep,
        skipWeekdays: ovSkipWeekends ? [0, 6] : [],
      }
    : {
        days: props.defaults.days,
        rr: props.defaults.rr,
        risk: props.defaults.slRiskUsd,
        entryMode: props.defaults.entryMode,
        entryDepth: props.defaults.entryDepthPct,
        slDepth: props.defaults.slDepthPct,
        retestSlR: props.defaults.retestSlR,
        trail: props.defaults.trailEnabled,
        trailAct: props.defaults.trailActivateR,
        trailStep: props.defaults.trailStepR,
        skipWeekdays: props.defaults.skipWeekdays,
      };

  const mut = useMutation({
    mutationFn: () =>
      runCompare({
        data: {
          sessions,
          days: eff.days,
          symbol: props.defaults.symbol,
          sl_risk_usd: eff.risk,
          rr: eff.rr,
          trail_enabled: eff.trail,
          trail_activate_r: eff.trailAct,
          trail_step_r: eff.trailStep,
          skip_weekdays: eff.skipWeekdays,
          filters: props.filters,
          entry: {
            mode: eff.entryMode,
            entry_depth_pct: eff.entryDepth,
            sl_depth_pct: eff.slDepth,
            retest_sl_r: eff.retestSlR,
          },
          fee_rate: feesOn ? feeRate : 0,
        },
      }),
    onSuccess: (r) => {
      setData(r);
      toast.success(`Compared ${r.sessions.length} sessions · ${r.days}d`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (t: string) =>
    setSessions((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t].sort()));
  const addCustom = () => {
    if (!/^\d{2}:\d{2}$/.test(customTime)) return toast.error("Time must be HH:MM (24h IST)");
    if (sessions.includes(customTime)) return;
    setSessions([...sessions, customTime].sort());
  };

  const sorted = useMemo(() => {
    if (!data) return [];
    const rows = [...data.sessions];
    rows.sort((a, b) => {
      const av = sortKey === "session" ? a.session : (a.summary as unknown as Record<string, number>)[sortKey] ?? 0;
      const bv = sortKey === "session" ? b.session : (b.summary as unknown as Record<string, number>)[sortKey] ?? 0;
      if (av === bv) return 0;
      const cmp = av > bv ? 1 : -1;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  const bestBy = (
    metric: (r: MultiSessRow) => number,
    dir: "max" | "min" = "max",
  ): string | null => {
    if (!data || !data.sessions.length) return null;
    return data.sessions.reduce((acc, r) => {
      if (!acc) return r.session;
      const a = metric(data.sessions.find((s) => s.session === acc)!);
      const b = metric(r);
      return dir === "max" ? (b > a ? r.session : acc) : (b < a ? r.session : acc);
    }, null as string | null);
  };
  const bestNet = data ? bestBy((r) => r.summary.net_pnl_usd) : null;
  const bestPF = data ? bestBy((r) => (Number.isFinite(r.summary.profit_factor) ? r.summary.profit_factor : -1)) : null;
  const bestWin = data ? bestBy((r) => r.summary.win_rate_pct) : null;

  const H = (key: MSOSortKey, label: string, align: "left" | "right" = "right") => (
    <th
      className={`py-1.5 px-2 text-${align} cursor-pointer select-none hover:text-foreground`}
      onClick={() => {
        if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
        else {
          setSortKey(key);
          setSortDir(align === "left" ? "asc" : "desc");
        }
      }}
    >
      {label}
      {sortKey === key && <span className="ml-1 text-[9px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono tracking-widest">
          MULTI-SESSION ORB COMPARISON
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Runs the same rules & filters against multiple session start times so
          you can see which sessions the ORB edge actually lives in. Toggle
          overrides to tune RR, entry, trail, days independently.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Session presets (IST)
          </Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {SESSION_PRESETS.map((p) => {
              const on = sessions.includes(p.time);
              return (
                <button
                  key={p.time}
                  type="button"
                  onClick={() => toggle(p.time)}
                  className={`px-2 py-1 rounded border text-[11px] font-mono transition ${
                    on
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input bg-background text-muted-foreground hover:text-foreground"
                  }`}
                  title={p.hint}
                >
                  {p.time} · {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-end gap-2 flex-wrap">
          <Field label="Custom session (IST)">
            <Input
              type="time"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              className="h-8 font-mono text-xs w-32"
            />
          </Field>
          <Button variant="outline" size="sm" onClick={addCustom} className="h-8">
            + Add
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setSessions(SESSION_PRESETS.map((p) => p.time))}
          >
            All presets
          </Button>
          <div className="flex-1" />
          <div className="text-[10px] text-muted-foreground font-mono">
            {sessions.length} session{sessions.length === 1 ? "" : "s"} · {eff.days}d ·
            {" "}RR 1:{eff.rr} · risk ${eff.risk}
          </div>
        </div>

        {sessions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {sessions.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-[11px] font-mono"
              >
                {s}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => toggle(s)}
                  aria-label={`Remove ${s}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="rounded border border-border p-3 space-y-3">
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={overrideOn} onCheckedChange={(v) => setOverrideOn(!!v)} />
            <span className="uppercase tracking-widest text-[10px] text-muted-foreground">
              Override main form (per-comparison)
            </span>
          </label>

          {overrideOn && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Days back">
                  <Input
                    type="number"
                    min={1}
                    max={730}
                    value={ovDays}
                    onChange={(e) => setOvDays(Math.min(365, Math.max(1, Number(e.target.value) || 1)))}
                    className="h-8 font-mono text-xs"
                  />
                </Field>
                <Field label="RR (1:R)">
                  <Input
                    type="number"
                    min={0.1}
                    step="0.1"
                    value={ovRr}
                    onChange={(e) => setOvRr(Math.max(0.1, Number(e.target.value) || 0.1))}
                    className="h-8 font-mono text-xs"
                  />
                </Field>
                <Field label="SL risk ($)">
                  <Input
                    type="number"
                    min={1}
                    step="1"
                    value={ovRisk}
                    onChange={(e) => setOvRisk(Math.max(1, Number(e.target.value) || 1))}
                    className="h-8 font-mono text-xs"
                  />
                </Field>
                <Field label="Entry mode">
                  <select
                    value={ovEntryMode}
                    onChange={(e) => setOvEntryMode(e.target.value as FormState["entryMode"])}
                    className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
                  >
                    <option value="fib">Fib zone</option>
                    <option value="retest">Retest</option>
                    <option value="market">Market</option>
                    <option value="adaptive">Adaptive</option>
                  </select>
                </Field>
                <Field label="Entry depth %">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="1"
                    value={Math.round(ovEntryDepth * 100)}
                    onChange={(e) => setOvEntryDepth(Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100)}
                    className="h-8 font-mono text-xs"
                  />
                </Field>
                <Field label="SL depth %">
                  <Input
                    type="number"
                    min={10}
                    max={100}
                    step="1"
                    value={Math.round(ovSlDepth * 100)}
                    onChange={(e) => setOvSlDepth(Math.max(0.1, Math.min(1, (Number(e.target.value) || 10) / 100)))}
                    className="h-8 font-mono text-xs"
                  />
                </Field>
                <Field label="Retest SL (R)">
                  <Input
                    type="number"
                    min={0.1}
                    step="0.1"
                    value={ovRetestSlR}
                    onChange={(e) => setOvRetestSlR(Math.max(0.1, Number(e.target.value) || 0.1))}
                    className="h-8 font-mono text-xs"
                  />
                </Field>
                <Field label="Trailing">
                  <label className="h-8 flex items-center gap-2 text-xs">
                    <Switch checked={ovTrail} onCheckedChange={(v) => setOvTrail(!!v)} />
                    <span className="text-muted-foreground">Enabled</span>
                  </label>
                </Field>
                {ovTrail && (
                  <>
                    <Field label="Trail activate (R)">
                      <Input
                        type="number"
                        min={0.1}
                        step="0.1"
                        value={ovTrailAct}
                        onChange={(e) => setOvTrailAct(Math.max(0.1, Number(e.target.value) || 0.1))}
                        className="h-8 font-mono text-xs"
                      />
                    </Field>
                    <Field label="Trail step (R)">
                      <Input
                        type="number"
                        min={0.1}
                        step="0.1"
                        value={ovTrailStep}
                        onChange={(e) => setOvTrailStep(Math.max(0.1, Number(e.target.value) || 0.1))}
                        className="h-8 font-mono text-xs"
                      />
                    </Field>
                  </>
                )}
                <Field label="Skip weekends">
                  <label className="h-8 flex items-center gap-2 text-xs">
                    <Switch checked={ovSkipWeekends} onCheckedChange={(v) => setOvSkipWeekends(!!v)} />
                    <span className="text-muted-foreground">Sat & Sun</span>
                  </label>
                </Field>
              </div>
            </>
          )}

          <div className="flex items-end gap-3 flex-wrap pt-2 border-t border-border">
            <Field label="Fees / side (bps)">
              <div className="flex items-center gap-2">
                <Switch checked={feesOn} onCheckedChange={(v) => setFeesOn(!!v)} />
                <Input
                  type="number"
                  min={0}
                  max={20}
                  step="0.1"
                  disabled={!feesOn}
                  value={Math.round(feeRate * 10000 * 10) / 10}
                  onChange={(e) => setFeeRate((Number(e.target.value) || 0) / 10000)}
                  className="h-8 font-mono text-xs w-24"
                />
              </div>
            </Field>
            <div className="flex-1" />
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={showEquity} onCheckedChange={(v) => setShowEquity(!!v)} />
              <span className="text-muted-foreground">Show per-session equity curves</span>
            </label>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || sessions.length === 0}
            size="sm"
          >
            {mut.isPending
              ? "Running…"
              : `Compare ${sessions.length} session${sessions.length === 1 ? "" : "s"}`}
          </Button>
          {sessions.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSessions([])}
              disabled={mut.isPending}
            >
              Clear
            </Button>
          )}
        </div>

        {data && (
          <>
            <div className="rounded border border-border overflow-x-auto">
              <table className="w-full text-[11px] font-mono">
                <thead className="bg-secondary/40 text-muted-foreground">
                  <tr>
                    {H("session", "Session", "left")}
                    <th className="text-right py-1.5 px-2">Days</th>
                    {H("triggered", "Fills")}
                    <th className="text-right py-1.5 px-2">W/L</th>
                    {H("win_rate_pct", "Win%")}
                    {H("fill_rate_pct", "Fill%")}
                    {H("profit_factor", "PF")}
                    {H("expectancy_usd", "Expect$")}
                    {H("avg_r", "AvgR")}
                    <th className="text-right py-1.5 px-2">AvgWin$</th>
                    <th className="text-right py-1.5 px-2">AvgLoss$</th>
                    <th className="text-right py-1.5 px-2">Best$</th>
                    <th className="text-right py-1.5 px-2">Worst$</th>
                    <th className="text-right py-1.5 px-2">Streak W/L</th>
                    <th className="text-right py-1.5 px-2">MAE p95 W/L</th>
                    <th className="text-right py-1.5 px-2">NearMiss</th>
                    {H("net_pnl_usd", "Net$")}
                    <th className="text-right py-1.5 px-2">Fees$</th>
                    {H("max_drawdown_usd", "MaxDD")}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((s) => {
                    const net = s.summary.net_pnl_usd;
                    const netCls =
                      net > 0 ? "text-emerald-400" : net < 0 ? "text-red-400" : "text-muted-foreground";
                    const isBestNet = s.session === bestNet;
                    const badges = [
                      isBestNet && "net",
                      s.session === bestPF && "pf",
                      s.session === bestWin && "wr",
                    ].filter(Boolean) as string[];
                    return (
                      <tr key={s.session} className={`border-t border-border ${isBestNet ? "bg-primary/5" : ""}`}>
                        <td className="py-1 px-2 text-left whitespace-nowrap">
                          {s.session}
                          {badges.length > 0 && (
                            <span className="ml-1 text-[9px] text-primary uppercase">★ {badges.join(" ")}</span>
                          )}
                        </td>
                        <td className="py-1 px-2 text-right">{s.summary.days_with_session}</td>
                        <td className="py-1 px-2 text-right">{s.summary.triggered}</td>
                        <td className="py-1 px-2 text-right whitespace-nowrap">
                          <span className="text-emerald-400">{s.summary.tp}</span>
                          {" / "}
                          <span className="text-red-400">{s.summary.sl}</span>
                        </td>
                        <td className="py-1 px-2 text-right">{s.summary.win_rate_pct.toFixed(0)}%</td>
                        <td className="py-1 px-2 text-right">{s.summary.fill_rate_pct.toFixed(0)}%</td>
                        <td className="py-1 px-2 text-right">
                          {Number.isFinite(s.summary.profit_factor) ? s.summary.profit_factor.toFixed(2) : "∞"}
                        </td>
                        <td className="py-1 px-2 text-right">
                          {s.summary.expectancy_usd >= 0 ? "+" : ""}
                          {s.summary.expectancy_usd.toFixed(2)}
                        </td>
                        <td className="py-1 px-2 text-right">
                          {s.summary.avg_r >= 0 ? "+" : ""}
                          {s.summary.avg_r.toFixed(2)}
                        </td>
                        <td className="py-1 px-2 text-right text-emerald-400">
                          {s.summary.avg_win_usd > 0 ? `+${s.summary.avg_win_usd.toFixed(0)}` : "—"}
                        </td>
                        <td className="py-1 px-2 text-right text-red-400">
                          {s.summary.avg_loss_usd < 0 ? s.summary.avg_loss_usd.toFixed(0) : "—"}
                        </td>
                        <td className="py-1 px-2 text-right text-emerald-400">
                          {s.summary.best_pnl_usd ? `+${s.summary.best_pnl_usd.toFixed(0)}` : "—"}
                        </td>
                        <td className="py-1 px-2 text-right text-red-400">
                          {s.summary.worst_pnl_usd ? s.summary.worst_pnl_usd.toFixed(0) : "—"}
                        </td>
                        <td className="py-1 px-2 text-right whitespace-nowrap">
                          <span className="text-emerald-400">{s.summary.max_consec_wins}</span>
                          {" / "}
                          <span className="text-red-400">{s.summary.max_consec_losses}</span>
                        </td>
                        <td className="py-1 px-2 text-right whitespace-nowrap">
                          <span className="text-emerald-400">
                            {s.summary.mae_wins_p95 !== null ? s.summary.mae_wins_p95.toFixed(2) : "—"}
                          </span>
                          {" / "}
                          <span className="text-red-400">
                            {s.summary.mae_losses_p95 !== null ? s.summary.mae_losses_p95.toFixed(2) : "—"}
                          </span>
                        </td>
                        <td className="py-1 px-2 text-right">
                          {s.summary.near_miss_count}
                          {s.summary.median_miss_r !== null && Number.isFinite(s.summary.median_miss_r) && (
                            <span className="text-muted-foreground">
                              {" "}({s.summary.median_miss_r.toFixed(1)}R)
                            </span>
                          )}
                        </td>
                        <td className={`py-1 px-2 text-right ${netCls}`}>
                          {net >= 0 ? "+" : ""}
                          {net.toFixed(0)}
                        </td>
                        <td className="py-1 px-2 text-right text-muted-foreground">
                          {s.summary.est_fees_usd.toFixed(1)}
                        </td>
                        <td className="py-1 px-2 text-right text-red-400">
                          -{s.summary.max_drawdown_usd.toFixed(0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-[10px] text-muted-foreground font-mono">
              ★ badges: <span className="text-primary">net</span> = best net P&L ·
              {" "}<span className="text-primary">pf</span> = best profit factor ·
              {" "}<span className="text-primary">wr</span> = best win rate. Click any column header to sort.
            </p>

            {showEquity && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {sorted.map((s) => (
                  <div key={s.session} className="rounded border border-border p-2">
                    <div className="text-[11px] font-mono mb-1 flex items-center justify-between">
                      <span>{s.session}</span>
                      <span
                        className={
                          s.summary.net_pnl_usd > 0
                            ? "text-emerald-400"
                            : s.summary.net_pnl_usd < 0
                              ? "text-red-400"
                              : "text-muted-foreground"
                        }
                      >
                        {s.summary.net_pnl_usd >= 0 ? "+" : ""}${s.summary.net_pnl_usd.toFixed(0)}
                      </span>
                    </div>
                    <div className="h-24">
                      <ResponsiveContainer>
                        <LineChart data={s.equity}>
                          <XAxis dataKey="ist_date" hide />
                          <YAxis hide domain={["auto", "auto"]} />
                          <ReferenceLine y={0} stroke="hsl(var(--border))" />
                          <Line
                            type="monotone"
                            dataKey="cum_pnl_usd"
                            stroke={
                              s.summary.net_pnl_usd >= 0
                                ? "hsl(var(--primary))"
                                : "hsl(0 84% 60%)"
                            }
                            dot={false}
                            strokeWidth={1.2}
                          />
                          <ReTooltip
                            contentStyle={{
                              background: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              fontSize: 10,
                            }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}


// ------------------------------------------------------------------
// Asian Liquidity Sweep — after the Asian window closes, catch bars that
// wick past Asian H/L and close back inside (stop-run reversals).
// ------------------------------------------------------------------

type LiquiditySweepData = Awaited<ReturnType<typeof backtestLiquiditySweep>>;

interface SweepFormState {
  asianStartIst: number;
  asianEndIst: number;
  entryEndIst: number;
  minRangeUsd: number;
  entryPullbackPct: number;
  slBufferPct: number;
  rr: number;
  tpMode: "rr" | "opposite" | "midrange";
  requireCloseInside: boolean;
}

const SWEEP_PRESETS: { label: string; hint: string; cfg: Partial<SweepFormState> }[] = [
  {
    label: "Classic (03→13 IST)",
    hint: "Tokyo/Sydney Asia, hunt during London+NY",
    cfg: { asianStartIst: 3, asianEndIst: 13, entryEndIst: 24 },
  },
  {
    label: "Tokyo tight (05→11)",
    hint: "Narrower Asia window, hunt through NY close",
    cfg: { asianStartIst: 5, asianEndIst: 11, entryEndIst: 24 },
  },
  {
    label: "London kill-zone only",
    hint: "Sweep must trigger before US session",
    cfg: { asianStartIst: 3, asianEndIst: 13, entryEndIst: 19 },
  },
  {
    label: "NY kill-zone only",
    hint: "Ignore London sweeps, hunt 18-24 IST",
    cfg: { asianStartIst: 3, asianEndIst: 18, entryEndIst: 24 },
  },
];

function LiquiditySweepPanel(props: {
  defaults: {
    symbol: string;
    days: number;
    slRiskUsd: number;
    rr: number;
    skipWeekdays: number[];
  };
}) {
  const runSweep = useServerFn(backtestLiquiditySweep);
  const [cfg, setCfg] = useState<SweepFormState>({
    asianStartIst: 3,
    asianEndIst: 13,
    entryEndIst: 24,
    minRangeUsd: 0,
    entryPullbackPct: 0,
    slBufferPct: 0.10,
    rr: props.defaults.rr,
    tpMode: "rr",
    requireCloseInside: true,
  });
  const [days, setDays] = useState<number>(props.defaults.days);
  const [skipSat, setSkipSat] = useState<boolean>(props.defaults.skipWeekdays.includes(6));
  const [skipSun, setSkipSun] = useState<boolean>(props.defaults.skipWeekdays.includes(0));

  const [data, setData] = useState<LiquiditySweepData | null>(null);

  const setK = <K extends keyof SweepFormState>(k: K, v: SweepFormState[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  const mut = useMutation({
    mutationFn: () =>
      runSweep({
        data: {
          symbol: props.defaults.symbol,
          days,

          sl_risk_usd: props.defaults.slRiskUsd,
          rr: cfg.rr,
          asian_start_ist: cfg.asianStartIst,
          asian_end_ist: cfg.asianEndIst,
          entry_end_ist: cfg.entryEndIst,
          min_range_usd: cfg.minRangeUsd,
          entry_pullback_pct: cfg.entryPullbackPct,
          sl_buffer_pct: cfg.slBufferPct,
          tp_mode: cfg.tpMode,
          require_close_inside: cfg.requireCloseInside,
          skip_weekdays: Array.from(new Set([
            ...props.defaults.skipWeekdays.filter((d) => d !== 0 && d !== 6),
            ...(skipSat ? [6] : []),
            ...(skipSun ? [0] : []),
          ])).sort(),
        },
      }),
    onSuccess: (r) => {
      setData(r);
      toast.success(
        `Sweep done — ${r.summary.tp}W / ${r.summary.sl}L · net $${r.summary.total_pnl_usd.toFixed(0)}`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyPreset = (p: Partial<SweepFormState>) => setCfg((c) => ({ ...c, ...p }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono tracking-widest">
          ASIAN LIQUIDITY SWEEP
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Counter-trend setup: price wicks past the Asian session H/L and closes
          back inside → enter opposite direction. SL past the sweep wick,
          TP by R multiple or opposite range level.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Presets
          </Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {SWEEP_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p.cfg)}
                title={p.hint}
                className="px-2 py-1 rounded border border-input bg-background hover:bg-secondary text-[11px] font-mono text-muted-foreground hover:text-foreground"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Asia start (IST hour)">
            <Input
              type="number"
              min={0}
              max={23}
              value={cfg.asianStartIst}
              onChange={(e) => setK("asianStartIst", Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label="Asia end (IST hour)">
            <Input
              type="number"
              min={1}
              max={24}
              value={cfg.asianEndIst}
              onChange={(e) => setK("asianEndIst", Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label="Entry cutoff (IST hour)">
            <Input
              type="number"
              min={1}
              max={24}
              value={cfg.entryEndIst}
              onChange={(e) => setK("entryEndIst", Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label="Min Asia range ($)">
            <Input
              type="number"
              min={0}
              step="1"
              value={cfg.minRangeUsd}
              onChange={(e) => setK("minRangeUsd", Math.max(0, Number(e.target.value) || 0))}
              className="h-8 font-mono text-xs"
            />
          </Field>

          <Field label="SL buffer (% of range)">
            <Input
              type="number"
              min={0}
              max={100}
              step="1"
              value={Math.round(cfg.slBufferPct * 100)}
              onChange={(e) => setK("slBufferPct", Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100)}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label="Pullback entry (% of range)">
            <Input
              type="number"
              min={0}
              max={100}
              step="1"
              value={Math.round(cfg.entryPullbackPct * 100)}
              onChange={(e) => setK("entryPullbackPct", Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100)}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label="RR (when TP=rr)">
            <Input
              type="number"
              min={0.1}
              step="0.1"
              value={cfg.rr}
              onChange={(e) => setK("rr", Math.max(0.1, Number(e.target.value) || 0.1))}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label="TP mode">
            <select
              value={cfg.tpMode}
              onChange={(e) => setK("tpMode", e.target.value as SweepFormState["tpMode"])}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
            >
              <option value="rr">RR multiple</option>
              <option value="opposite">Opposite Asia level</option>
              <option value="midrange">Asia midrange</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label={`Days — ${days}`}>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={7}
                max={730}
                step={1}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="flex-1"
              />
              <Input
                type="number"
                min={1}
                max={730}
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
                className="h-8 w-20 font-mono text-xs"
              />
            </div>
          </Field>
        </div>


        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={cfg.requireCloseInside}
              onCheckedChange={(v) => setK("requireCloseInside", !!v)}
            />
            <span>Require close back inside range</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={skipSat} onCheckedChange={(v) => setSkipSat(!!v)} />
            <span>Skip Sat</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={skipSun} onCheckedChange={(v) => setSkipSun(!!v)} />
            <span>Skip Sun</span>
          </label>
          <div className="flex-1" />
          <div className="text-[10px] text-muted-foreground font-mono">
            {days}d · {props.defaults.symbol} · risk ${props.defaults.slRiskUsd}

          </div>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending} size="sm">
            {mut.isPending ? "Running…" : "Run sweep backtest"}
          </Button>
        </div>

        {data && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px] font-mono">
              <Kv k="days w/ range" v={`${data.summary.days_with_range} / ${data.summary.total_days}`} />
              <Kv k="sweeps" v={String(data.summary.sweeps)} />
              <Kv k="fills" v={`${data.summary.triggered} (${data.summary.fill_rate_pct.toFixed(0)}%)`} />
              <Kv k="W / L / open" v={`${data.summary.tp} / ${data.summary.sl} / ${data.summary.open}`} />
              <Kv k="win rate" v={`${data.summary.win_rate_pct.toFixed(1)}%`} />
              <Kv k="profit factor" v={Number.isFinite(data.summary.profit_factor) ? data.summary.profit_factor.toFixed(2) : "∞"} />
              <Kv k="expectancy $" v={`${data.summary.expectancy_usd >= 0 ? "+" : ""}${data.summary.expectancy_usd.toFixed(2)}`} />
              <Kv k="avg R" v={`${data.summary.avg_r >= 0 ? "+" : ""}${data.summary.avg_r.toFixed(2)}`} />
              <Kv k="net P&L" v={`${data.summary.total_pnl_usd >= 0 ? "+" : ""}$${data.summary.total_pnl_usd.toFixed(0)}`} />
              <Kv k="max DD" v={`-$${data.summary.max_drawdown_usd.toFixed(0)}`} />
              <Kv k="consec W / L" v={`${data.summary.max_consec_wins} / ${data.summary.max_consec_losses}`} />
              <Kv k="bars scanned" v={String(data.bars_scanned)} />
            </div>

            {data.equity.length > 1 && (
              <div className="h-40 w-full">
                <ResponsiveContainer>
                  <LineChart data={data.equity}>
                    <XAxis dataKey="ist_date" tick={{ fontSize: 10 }} minTickGap={40} />
                    <YAxis tick={{ fontSize: 10 }} width={48} />
                    <ReTooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
                    />
                    <ReferenceLine y={0} stroke="hsl(var(--border))" />
                    <Line type="monotone" dataKey="cum_pnl_usd" stroke="hsl(var(--primary))" dot={false} strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {(data.summary.mae_wins || data.summary.mae_losses) && (
              <div className="rounded border border-border p-3 text-[11px] font-mono">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  MAE distribution (R units)
                </div>
                <table className="w-full">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="text-left py-1">Cohort</th>
                      <th className="text-right py-1">n</th>
                      <th className="text-right py-1">avg</th>
                      <th className="text-right py-1">p50</th>
                      <th className="text-right py-1">p75</th>
                      <th className="text-right py-1">p90</th>
                      <th className="text-right py-1">p95</th>
                      <th className="text-right py-1">max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.summary.mae_wins && (
                      <tr className="border-t border-border">
                        <td className="py-1 text-emerald-400">wins</td>
                        <td className="py-1 text-right">{data.summary.mae_wins.count}</td>
                        <td className="py-1 text-right">{data.summary.mae_wins.avg.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_wins.p50.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_wins.p75.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_wins.p90.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_wins.p95.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_wins.max.toFixed(2)}</td>
                      </tr>
                    )}
                    {data.summary.mae_losses && (
                      <tr className="border-t border-border">
                        <td className="py-1 text-red-400">losses</td>
                        <td className="py-1 text-right">{data.summary.mae_losses.count}</td>
                        <td className="py-1 text-right">{data.summary.mae_losses.avg.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_losses.p50.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_losses.p75.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_losses.p90.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_losses.p95.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_losses.max.toFixed(2)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <p className="text-[10px] text-muted-foreground mt-2">
                  Tip: if winner p95 MAE is well below 1.0R, your SL is wider than needed —
                  tighten SL buffer to boost R:R.
                </p>
              </div>
            )}

            <BacktestAnalytics days={data.days} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}



// ------------------------------------------------------------------
// ICT Silver Bullet — NY AM kill zone.
// Detects Market Structure Shift + Fair Value Gap retest inside a
// configurable IST window (default 19:00–21:00 IST, ~NY AM kill zone).
// ------------------------------------------------------------------

type SilverBulletData = Awaited<ReturnType<typeof backtestSilverBullet>>;

interface SbFormState {
  windowStartIst: string;
  windowEndIst: string;
  holdCutoffIst: string;
  swingLookback: number;
  fvgMinUsd: number;
  slBufferUsd: number;
  rr: number;
  maxTradesPerDay: number;
  executionTf: "3m" | "5m" | "15m";
}

const SB_PRESETS: { label: string; hint: string; cfg: Partial<SbFormState> }[] = [
  {
    label: "NY AM (19:00–21:00)",
    hint: "Classic ICT NY AM kill zone in IST",
    cfg: { windowStartIst: "19:00", windowEndIst: "21:00", holdCutoffIst: "23:00" },
  },
  {
    label: "NY AM tight (19:30–20:30)",
    hint: "Purist Silver Bullet 10:00–11:00 NY",
    cfg: { windowStartIst: "19:30", windowEndIst: "20:30", holdCutoffIst: "22:30" },
  },
  {
    label: "London AM (13:30–15:30)",
    hint: "London Silver Bullet 03:00–04:00 NY / 08:00–09:00 UK",
    cfg: { windowStartIst: "13:30", windowEndIst: "15:30", holdCutoffIst: "18:00" },
  },
  {
    label: "NY PM (00:30–02:30)",
    hint: "Silver Bullet PM 14:00–15:00 NY (next-day IST)",
    cfg: { windowStartIst: "00:30", windowEndIst: "02:30", holdCutoffIst: "05:00" },
  },
];

function SilverBulletPanel(props: {
  defaults: {
    symbol: string;
    days: number;
    slRiskUsd: number;
    rr: number;
    skipWeekdays: number[];
  };
}) {
  const runSb = useServerFn(backtestSilverBullet);
  const [cfg, setCfg] = useState<SbFormState>({
    windowStartIst: "19:00",
    windowEndIst: "21:00",
    holdCutoffIst: "23:00",
    swingLookback: 20,
    fvgMinUsd: 0.3,
    slBufferUsd: 0.2,
    rr: Math.max(props.defaults.rr, 2),
    maxTradesPerDay: 1,
    executionTf: "5m",
  });
  const [days, setDays] = useState<number>(props.defaults.days);
  const [skipSat, setSkipSat] = useState<boolean>(props.defaults.skipWeekdays.includes(6));
  const [skipSun, setSkipSun] = useState<boolean>(props.defaults.skipWeekdays.includes(0));

  const [data, setData] = useState<SilverBulletData | null>(null);
  const setK = <K extends keyof SbFormState>(k: K, v: SbFormState[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  const mut = useMutation({
    mutationFn: () =>
      runSb({
        data: {
          symbol: props.defaults.symbol,
          days,

          sl_risk_usd: props.defaults.slRiskUsd,
          rr: cfg.rr,
          window_start_ist: cfg.windowStartIst,
          window_end_ist: cfg.windowEndIst,
          hold_cutoff_ist: cfg.holdCutoffIst,
          swing_lookback: cfg.swingLookback,
          fvg_min_usd: cfg.fvgMinUsd,
          sl_buffer_usd: cfg.slBufferUsd,
          max_trades_per_day: cfg.maxTradesPerDay,
          execution_tf: cfg.executionTf,
          skip_weekdays: Array.from(new Set([
            ...props.defaults.skipWeekdays.filter((d) => d !== 0 && d !== 6),
            ...(skipSat ? [6] : []),
            ...(skipSun ? [0] : []),
          ])).sort(),
        },
      }),
    onSuccess: (r) => {
      setData(r);
      toast.success(
        `Silver Bullet — ${r.summary.tp}W / ${r.summary.sl}L · net $${r.summary.total_pnl_usd.toFixed(0)}`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyPreset = (p: Partial<SbFormState>) => setCfg((c) => ({ ...c, ...p }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono tracking-widest">
          ICT SILVER BULLET
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Inside the kill-zone window: detect a Market Structure Shift, find
          the 3-bar Fair Value Gap in the impulse, arm a limit entry at the
          FVG edge with SL beyond the swing extreme and TP at your R multiple.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Presets
          </Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {SB_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p.cfg)}
                title={p.hint}
                className="px-2 py-1 rounded border border-input bg-background hover:bg-secondary text-[11px] font-mono text-muted-foreground hover:text-foreground"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Window start (IST)">
            <Input
              value={cfg.windowStartIst}
              onChange={(e) => setK("windowStartIst", e.target.value)}
              className="h-8 font-mono text-xs"
              placeholder="19:00"
            />
          </Field>
          <Field label="Window end (IST)">
            <Input
              value={cfg.windowEndIst}
              onChange={(e) => setK("windowEndIst", e.target.value)}
              className="h-8 font-mono text-xs"
              placeholder="21:00"
            />
          </Field>
          <Field label="Hold cutoff (IST)">
            <Input
              value={cfg.holdCutoffIst}
              onChange={(e) => setK("holdCutoffIst", e.target.value)}
              className="h-8 font-mono text-xs"
              placeholder="23:00"
            />
          </Field>
          <Field label="Execution TF">
            <select
              value={cfg.executionTf}
              onChange={(e) => setK("executionTf", e.target.value as SbFormState["executionTf"])}
              className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
            >
              <option value="3m">3m</option>
              <option value="5m">5m</option>
              <option value="15m">15m</option>
            </select>
          </Field>

          <Field label="Swing lookback (bars)">
            <Input
              type="number"
              min={5}
              max={100}
              value={cfg.swingLookback}
              onChange={(e) => setK("swingLookback", Math.max(5, Math.min(100, Number(e.target.value) || 20)))}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label="Min FVG size ($)">
            <Input
              type="number"
              min={0}
              step="0.05"
              value={cfg.fvgMinUsd}
              onChange={(e) => setK("fvgMinUsd", Math.max(0, Number(e.target.value) || 0))}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label="SL buffer ($)">
            <Input
              type="number"
              min={0}
              step="0.05"
              value={cfg.slBufferUsd}
              onChange={(e) => setK("slBufferUsd", Math.max(0, Number(e.target.value) || 0))}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label="RR (1 : X)">
            <Input
              type="number"
              min={0.5}
              step="0.5"
              value={cfg.rr}
              onChange={(e) => setK("rr", Math.max(0.5, Number(e.target.value) || 0.5))}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label="Max trades / day">
            <Input
              type="number"
              min={1}
              max={5}
              value={cfg.maxTradesPerDay}
              onChange={(e) => setK("maxTradesPerDay", Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label={`Days — ${days}`}>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={7}
                max={730}
                step={1}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="flex-1"
              />
              <Input
                type="number"
                min={1}
                max={730}
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
                className="h-8 w-20 font-mono text-xs"
              />
            </div>
          </Field>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={skipSat} onCheckedChange={(v) => setSkipSat(!!v)} />
            <span>Skip Sat</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={skipSun} onCheckedChange={(v) => setSkipSun(!!v)} />
            <span>Skip Sun</span>
          </label>
          <div className="flex-1" />
          <div className="text-[10px] text-muted-foreground font-mono">
            {days}d · {props.defaults.symbol} · risk ${props.defaults.slRiskUsd} · {cfg.executionTf} bars

          </div>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending} size="sm">
            {mut.isPending ? "Running…" : "Run Silver Bullet backtest"}
          </Button>
        </div>

        {data && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px] font-mono">
              <Kv k="active days" v={`${data.summary.active_days} / ${data.summary.total_days}`} />
              <Kv k="setups" v={String(data.summary.trades)} />
              <Kv k="fills" v={`${data.summary.triggered} (${data.summary.fill_rate_pct.toFixed(0)}%)`} />
              <Kv k="W / L / open" v={`${data.summary.tp} / ${data.summary.sl} / ${data.summary.open}`} />
              <Kv k="win rate" v={`${data.summary.win_rate_pct.toFixed(1)}%`} />
              <Kv k="profit factor" v={Number.isFinite(data.summary.profit_factor) ? data.summary.profit_factor.toFixed(2) : "∞"} />
              <Kv k="expectancy $" v={`${data.summary.expectancy_usd >= 0 ? "+" : ""}${data.summary.expectancy_usd.toFixed(2)}`} />
              <Kv k="avg R" v={`${data.summary.avg_r >= 0 ? "+" : ""}${data.summary.avg_r.toFixed(2)}`} />
              <Kv k="net P&L" v={`${data.summary.total_pnl_usd >= 0 ? "+" : ""}$${data.summary.total_pnl_usd.toFixed(0)}`} />
              <Kv k="max DD" v={`-$${data.summary.max_drawdown_usd.toFixed(0)}`} />
              <Kv k="consec W / L" v={`${data.summary.max_consec_wins} / ${data.summary.max_consec_losses}`} />
              <Kv k="bars scanned" v={String(data.bars_scanned)} />
            </div>

            {data.equity.length > 1 && (
              <div className="h-40 w-full">
                <ResponsiveContainer>
                  <LineChart data={data.equity}>
                    <XAxis dataKey="ist_date" tick={{ fontSize: 10 }} minTickGap={40} />
                    <YAxis tick={{ fontSize: 10 }} width={48} />
                    <ReTooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
                    />
                    <ReferenceLine y={0} stroke="hsl(var(--border))" />
                    <Line type="monotone" dataKey="cum_pnl_usd" stroke="hsl(var(--primary))" dot={false} strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {(data.summary.mae_wins || data.summary.mae_losses) && (
              <div className="rounded border border-border p-3 text-[11px] font-mono">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                  MAE distribution (R units)
                </div>
                <table className="w-full">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="text-left py-1">Cohort</th>
                      <th className="text-right py-1">n</th>
                      <th className="text-right py-1">avg</th>
                      <th className="text-right py-1">p50</th>
                      <th className="text-right py-1">p75</th>
                      <th className="text-right py-1">p90</th>
                      <th className="text-right py-1">p95</th>
                      <th className="text-right py-1">max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.summary.mae_wins && (
                      <tr className="border-t border-border">
                        <td className="py-1 text-emerald-400">wins</td>
                        <td className="py-1 text-right">{data.summary.mae_wins.count}</td>
                        <td className="py-1 text-right">{data.summary.mae_wins.avg.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_wins.p50.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_wins.p75.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_wins.p90.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_wins.p95.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_wins.max.toFixed(2)}</td>
                      </tr>
                    )}
                    {data.summary.mae_losses && (
                      <tr className="border-t border-border">
                        <td className="py-1 text-red-400">losses</td>
                        <td className="py-1 text-right">{data.summary.mae_losses.count}</td>
                        <td className="py-1 text-right">{data.summary.mae_losses.avg.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_losses.p50.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_losses.p75.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_losses.p90.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_losses.p95.toFixed(2)}</td>
                        <td className="py-1 text-right">{data.summary.mae_losses.max.toFixed(2)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <BacktestAnalytics
              days={data.days.flatMap((d) =>
                d.trades.length > 0
                  ? d.trades.map((t) => ({ ist_date: d.ist_date, pnl_usd: t.pnl_usd, outcome: t.outcome }))
                  : [{ ist_date: d.ist_date, pnl_usd: 0 }],
              )}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
