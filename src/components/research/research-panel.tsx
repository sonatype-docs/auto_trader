// Phase 1 Research Panel — post-hoc analytics + filter rack for the
// backtest. Consumes a RangeBacktestResult and re-aggregates client-side
// as the user toggles per-feature filters.

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { backtestRange } from "@/lib/strategy.functions";
import { extractFeatures, type TradeFeatures } from "@/lib/research/features";
import {
  FILTERS,
  type FilterDef,
  type FilterId,
  type FilterState,
  defaultFilterState,
  initialFilterStates,
  anyFilterEnabled,
} from "@/lib/research/filters";
import {
  applyFilters,
  computeBuckets,
  computeStats,
  drawdownCurve,
  equityCurve,
  histogram,
  type BucketRow,
  type StatsRow,
} from "@/lib/research/aggregate";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exportResearchCsv } from "@/lib/research/export";
import { AdvancedResearch } from "@/components/research/advanced-research";

type RangeData = Awaited<ReturnType<typeof backtestRange>>;

// ---------- small helpers ----------

function fmtUsd(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(digits)}`;
}
function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}
function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}
function pnlClass(n: number): string {
  if (n > 0) return "text-emerald-400";
  if (n < 0) return "text-red-400";
  return "text-muted-foreground";
}

// ---------- StatsGrid ----------

function StatsGrid({ label, stats }: { label: string; stats: StatsRow }) {
  const cells: Array<{ k: string; v: string; cls?: string }> = [
    { k: "Total days", v: String(stats.total) },
    { k: "Filled", v: String(stats.filled) },
    { k: "Missed", v: String(stats.missed) },
    { k: "Wins", v: String(stats.wins), cls: "text-emerald-400" },
    { k: "Losses", v: String(stats.losses), cls: "text-red-400" },
    { k: "Win rate", v: fmtPct(stats.win_rate_pct, 1) },
    { k: "Loss rate", v: fmtPct(stats.loss_rate_pct, 1) },
    { k: "Profit factor", v: stats.profit_factor >= 999 ? "∞" : fmtNum(stats.profit_factor, 2) },
    { k: "Expectancy", v: fmtUsd(stats.expectancy_usd, 2), cls: pnlClass(stats.expectancy_usd) },
    { k: "Net P&L", v: fmtUsd(stats.net_pnl_usd, 0), cls: pnlClass(stats.net_pnl_usd) },
    { k: "Avg R", v: fmtNum(stats.avg_r, 2), cls: pnlClass(stats.avg_r) },
    { k: "Max DD", v: fmtUsd(-stats.max_drawdown_usd, 0), cls: "text-red-400" },
    { k: "Max W streak", v: String(stats.max_consec_wins), cls: "text-emerald-400" },
    { k: "Max L streak", v: String(stats.max_consec_losses), cls: "text-red-400" },
  ];
  return (
    <div className="rounded border border-border">
      <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-px bg-border">
        {cells.map((c) => (
          <div key={c.k} className="bg-background p-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{c.k}</div>
            <div className={`font-mono text-sm ${c.cls ?? ""}`}>{c.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- BucketTable ----------

function BucketTable({
  rows,
  active,
  onToggleBucket,
  filterEnabled,
}: {
  rows: BucketRow[];
  active: Record<string, boolean>;
  onToggleBucket: (b: string) => void;
  filterEnabled: boolean;
}) {
  return (
    <div className="rounded border border-border overflow-x-auto">
      <table className="w-full text-[11px] font-mono">
        <thead className="text-muted-foreground bg-muted/40">
          <tr>
            <th className="text-left py-1.5 px-2">Bucket</th>
            <th className="text-right py-1.5 px-2">Trades</th>
            <th className="text-right py-1.5 px-2">W</th>
            <th className="text-right py-1.5 px-2">L</th>
            <th className="text-right py-1.5 px-2">Win %</th>
            <th className="text-right py-1.5 px-2">PF</th>
            <th className="text-right py-1.5 px-2">Expectancy</th>
            <th className="text-right py-1.5 px-2">Net P&amp;L</th>
            <th className="text-right py-1.5 px-2">Max DD</th>
            <th className="text-right py-1.5 px-2">W str</th>
            <th className="text-right py-1.5 px-2">L str</th>
            <th className="text-center py-1.5 px-2">Allow</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.bucket} className="border-t border-border">
              <td className="py-1.5 px-2">{r.label}</td>
              <td className="text-right py-1.5 px-2">{r.wins + r.losses}</td>
              <td className="text-right py-1.5 px-2 text-emerald-400">{r.wins}</td>
              <td className="text-right py-1.5 px-2 text-red-400">{r.losses}</td>
              <td className="text-right py-1.5 px-2">{fmtPct(r.win_rate_pct, 0)}</td>
              <td className="text-right py-1.5 px-2">
                {r.profit_factor >= 999 ? "∞" : fmtNum(r.profit_factor, 2)}
              </td>
              <td className={`text-right py-1.5 px-2 ${pnlClass(r.expectancy_usd)}`}>
                {fmtUsd(r.expectancy_usd, 2)}
              </td>
              <td className={`text-right py-1.5 px-2 ${pnlClass(r.net_pnl_usd)}`}>
                {fmtUsd(r.net_pnl_usd, 0)}
              </td>
              <td className="text-right py-1.5 px-2 text-red-400">{fmtUsd(-r.max_drawdown_usd, 0)}</td>
              <td className="text-right py-1.5 px-2 text-emerald-400">{r.max_consec_wins}</td>
              <td className="text-right py-1.5 px-2 text-red-400">{r.max_consec_losses}</td>
              <td className="text-center py-1.5 px-2">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  disabled={!filterEnabled}
                  checked={!!active[r.bucket]}
                  onChange={() => onToggleBucket(r.bucket)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- BucketBarChart ----------

function BucketBarChart({ rows, dataKey, label }: { rows: BucketRow[]; dataKey: keyof BucketRow; label: string }) {
  const data = rows.map((r) => ({ bucket: r.label, value: Number(r[dataKey]) || 0 }));
  return (
    <div className="rounded border border-border p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{label}</div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: -20 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                fontSize: 11,
              }}
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.value >= 0 ? "hsl(142 71% 45%)" : "hsl(0 72% 55%)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------- Histogram (distribution of a numeric feature) ----------

function FeatureHistogram({
  features,
  accessor,
  label,
  unit,
}: {
  features: TradeFeatures[];
  accessor: (f: TradeFeatures) => number | null;
  label: string;
  unit?: string;
}) {
  const bins = useMemo(() => histogram(features, accessor, 14), [features, accessor]);
  if (bins.length === 0) return null;
  const data = bins.map((b) => ({ bucket: b.bucket, count: b.count, net: b.net_pnl_usd }));
  return (
    <div className="rounded border border-border p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
        {label}{unit ? ` (${unit})` : ""} — distribution & net P&amp;L
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: -20 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" />
            <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={0} angle={-25} textAnchor="end" height={40} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
            <Bar yAxisId="left" dataKey="count" fill="hsl(var(--primary) / 0.5)" name="Count" />
            <Bar yAxisId="right" dataKey="net" name="Net P&L">
              {data.map((d, i) => (
                <Cell key={i} fill={d.net >= 0 ? "hsl(142 71% 45%)" : "hsl(0 72% 55%)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------- Equity + Drawdown overlay ----------

function EquityDrawdownChart({
  allFeatures,
  filteredFeatures,
  filterActive,
}: {
  allFeatures: TradeFeatures[];
  filteredFeatures: TradeFeatures[];
  filterActive: boolean;
}) {
  const data = useMemo(() => {
    const eqAll = equityCurve(allFeatures);
    const eqFilt = filterActive ? equityCurve(filteredFeatures) : [];
    const filtMap = new Map(eqFilt.map((p) => [p.ist_date, p.cum_pnl_usd]));
    return eqAll.map((p) => ({
      date: p.ist_date,
      all: p.cum_pnl_usd,
      filtered: filterActive ? (filtMap.get(p.ist_date) ?? null) : null,
    }));
  }, [allFeatures, filteredFeatures, filterActive]);
  const dd = useMemo(() => {
    const src = filterActive ? filteredFeatures : allFeatures;
    return drawdownCurve(src).map((p) => ({ date: p.ist_date, dd: p.cum_pnl_usd }));
  }, [allFeatures, filteredFeatures, filterActive]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="rounded border border-border p-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          Equity curve {filterActive ? "(all vs filtered)" : "(all trades)"}
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} minTickGap={30} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" />
              <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
              <Line type="monotone" dataKey="all" stroke="hsl(var(--muted-foreground))" dot={false} strokeWidth={1.5} name="All" />
              {filterActive && (
                <Line type="monotone" dataKey="filtered" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} name="Filtered" connectNulls />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded border border-border p-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          Drawdown {filterActive ? "(filtered)" : "(all)"}
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dd} margin={{ top: 4, right: 12, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} minTickGap={30} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
              <Line type="monotone" dataKey="dd" stroke="hsl(0 72% 55%)" dot={false} strokeWidth={1.5} name="Drawdown" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ---------- Per-filter tab ----------

function FilterTab({
  def,
  state,
  onState,
  allFeatures,
  filteredFeatures,
}: {
  def: FilterDef;
  state: FilterState;
  onState: (s: FilterState) => void;
  allFeatures: TradeFeatures[];
  filteredFeatures: TradeFeatures[];
}) {
  // Bucket rows computed over ALL features (so distributions don't shift
  // when the user narrows the filter — they see the underlying population).
  const rows = useMemo(() => computeBuckets(allFeatures, def), [allFeatures, def]);
  // Combined-filter subset stats: what happens when THIS filter's setting
  // is applied on top of every other enabled filter.
  const combinedStats = useMemo(() => computeStats(filteredFeatures), [filteredFeatures]);

  const toggleBucket = (b: string) => {
    onState({ ...state, allowedBuckets: { ...state.allowedBuckets, [b]: !state.allowedBuckets[b] } });
  };
  const toggleEnabled = (v: boolean) => onState({ ...state, enabled: v });
  const resetBuckets = () => {
    const all: Record<string, boolean> = {};
    for (const b of def.buckets) all[b] = true;
    onState({ ...state, allowedBuckets: all });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium">{def.label}</div>
          <div className="text-[11px] text-muted-foreground">{def.description}</div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Switch checked={state.enabled} onCheckedChange={toggleEnabled} />
            {state.enabled ? "Filter ON" : "Filter OFF"}
          </label>
          <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={resetBuckets} disabled={!state.enabled}>
            Allow all
          </Button>
        </div>
      </div>

      {def.numericAccessor && state.enabled && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-dashed border-border/60 p-2 text-[11px]">
          <div className="text-muted-foreground">Numeric range ({def.numericUnit ?? ""}) — optional:</div>
          <Input
            className="h-7 w-24 font-mono text-[11px]"
            type="number"
            placeholder="min"
            value={state.min ?? ""}
            onChange={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              onState({ ...state, min: Number.isFinite(v as number) ? (v as number) : null });
            }}
          />
          <span className="text-muted-foreground">–</span>
          <Input
            className="h-7 w-24 font-mono text-[11px]"
            type="number"
            placeholder="max"
            value={state.max ?? ""}
            onChange={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              onState({ ...state, max: Number.isFinite(v as number) ? (v as number) : null });
            }}
          />
          <span className="text-muted-foreground">
            When min/max are set, allowed-bucket checkboxes still apply.
          </span>
        </div>
      )}

      <StatsGrid
        label={
          state.enabled
            ? `Combined-filter subset — ${filteredFeatures.length} rows`
            : `Preview: enable filter to slice by ${def.short}`
        }
        stats={combinedStats}
      />

      <BucketTable
        rows={rows}
        active={state.allowedBuckets}
        onToggleBucket={toggleBucket}
        filterEnabled={state.enabled}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <BucketBarChart rows={rows} dataKey="net_pnl_usd" label={`Net P&L by ${def.short}`} />
        <BucketBarChart rows={rows} dataKey="win_rate_pct" label={`Win % by ${def.short}`} />
      </div>

      {def.numericAccessor && (
        <FeatureHistogram
          features={allFeatures}
          accessor={def.numericAccessor}
          label={def.label}
          unit={def.numericUnit}
        />
      )}
    </div>
  );
}

// ---------- Top-level panel ----------

export function ResearchPanel({ data }: { data: RangeData }) {
  const [filters, setFilters] = useState<Record<FilterId, FilterState>>(() => initialFilterStates());

  const features = useMemo(() => extractFeatures(data.days), [data.days]);
  const filtered = useMemo(() => applyFilters(features, filters), [features, filters]);
  const filterActive = anyFilterEnabled(filters);
  const allStats = useMemo(() => computeStats(features), [features]);
  const filteredStats = useMemo(() => computeStats(filtered), [filtered]);

  const setFilterState = (id: FilterId, s: FilterState) => setFilters({ ...filters, [id]: s });
  const resetAll = () => setFilters(initialFilterStates());
  const enabledCount = FILTERS.filter((f) => filters[f.id].enabled).length;

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="font-display text-base">Research — Phase 1: Market Conditions</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              Post-hoc filters over the same backtest. Toggle features to see how each condition affects performance;
              enabled filters stack (AND) into the combined subset.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-[10px] text-muted-foreground">
              {enabledCount} of {FILTERS.length} filters active
            </span>
            <Button variant="outline" size="sm" className="h-8 text-[11px]" onClick={resetAll}>
              Reset filters
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[11px]"
              onClick={() => exportResearchCsv(data, features, filtered, filters)}
            >
              Export research CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <StatsGrid label={`All trades — ${features.length} rows`} stats={allStats} />
          <StatsGrid
            label={
              filterActive
                ? `Filtered subset — ${filtered.length} rows`
                : "Enable a filter to see the filtered subset"
            }
            stats={filteredStats}
          />
        </div>

        <EquityDrawdownChart
          allFeatures={features}
          filteredFeatures={filtered}
          filterActive={filterActive}
        />

        <Tabs defaultValue={FILTERS[0].id} className="w-full">
          <div className="-mx-1 overflow-x-auto pb-1">
            <TabsList className="h-auto flex-wrap justify-start gap-1 bg-muted/60 p-1">
              {FILTERS.map((f) => {
                const on = filters[f.id].enabled;
                return (
                  <TabsTrigger key={f.id} value={f.id} className="text-xs">
                    <span className="mr-1">{f.short}</span>
                    {on && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary" />}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          {FILTERS.map((def) => (
            <TabsContent key={def.id} value={def.id} className="mt-4">
              <FilterTab
                def={def}
                state={filters[def.id]}
                onState={(s) => setFilterState(def.id, s)}
                allFeatures={features}
                filteredFeatures={filtered}
              />
            </TabsContent>
          ))}
        </Tabs>

        <AdvancedResearch features={features} slRiskUsd={Number((data as unknown as { sl_risk_usd?: number }).sl_risk_usd ?? 100)} symbol={(data as unknown as { symbol?: string }).symbol} />
      </CardContent>
    </Card>
  );
}
