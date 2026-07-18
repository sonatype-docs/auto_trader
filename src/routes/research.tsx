import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDatasetsProgress, clearDatasetsCache } from "@/hooks/use-datasets-progress";
import { Progress } from "@/components/ui/progress";
import { useEffect, useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Line, LineChart, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip as RTooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Trash2, Download, Filter as FilterIcon, PlusCircle, LayoutDashboard, TrendingUp, ListOrdered, ShieldAlert, Globe, Clock, Compass, Grid3x3, BarChart3, Network, GitCompare, SlidersHorizontal, FileText, PanelLeftClose, PanelLeftOpen, Gauge, Pencil, Loader2, RefreshCw, Layers, FileDown } from "lucide-react";
import { listSnapshots, renameSnapshot, deleteSnapshot } from "@/lib/trade-intelligence.functions";
import { supabase } from "@/integrations/supabase/client";
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { useDataset } from "@/hooks/use-dataset";
import {
  computeKpis, equityCurve, rolledPnl, groupBy, num, sortByExit,
  type EquityBucket,
} from "@/lib/research/metrics";
import { histogram } from "@/lib/research/distributions";
import { correlationMatrix } from "@/lib/research/correlation";
// Local filter/export helpers (kept in-route to avoid colliding with the
// existing research/filters + research/export modules used by grading/AI).
type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";
interface Rule { field: string; op: Op; value: string }
function readPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
}
function coerce(v: unknown): number | string | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== "" ? n : String(v);
}
function applyRules(rows: TradeRecord[], rules: Rule[]): TradeRecord[] {
  if (!rules.length) return rows;
  return rows.filter((row) => rules.every((r) => {
    const raw = coerce(readPath(row, r.field));
    const rhs = coerce(r.value);
    if (raw == null) return false;
    switch (r.op) {
      case "eq": return String(raw) === String(rhs);
      case "neq": return String(raw) !== String(rhs);
      case "gt": return typeof raw === "number" && typeof rhs === "number" && raw > rhs;
      case "gte": return typeof raw === "number" && typeof rhs === "number" && raw >= rhs;
      case "lt": return typeof raw === "number" && typeof rhs === "number" && raw < rhs;
      case "lte": return typeof raw === "number" && typeof rhs === "number" && raw <= rhs;
      case "contains": return String(raw).toLowerCase().includes(String(rhs).toLowerCase());
      case "in": return String(r.value).split(",").map((s) => s.trim()).includes(String(raw));
    }
  }));
}

// Extract the strategy timezone recorded on a trade. Pipeline runs tag each
// trade with `tz:<Zone>`; older rows may carry it under custom/raw instead.
function tradeTz(t: TradeRecord): string | null {
  const tag = (t.tags ?? []).find((x) => typeof x === "string" && x.startsWith("tz:"));
  if (tag) return tag.slice(3);
  const custom = (t.custom ?? {}) as Record<string, unknown>;
  const c = custom.strategyTimezone ?? custom.strategy_timezone ?? custom.tz;
  if (typeof c === "string" && c.length) return c;
  const raw = (t.raw ?? {}) as Record<string, unknown>;
  const r = raw.strategyTimezone ?? raw.strategy_timezone;
  if (typeof r === "string" && r.length) return r;
  return null;
}
function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "";
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}
function toMarkdownReport(title: string, sections: Array<{ heading: string; body: string }>) {
  return [`# ${title}`, "", ...sections.flatMap((s) => [`## ${s.heading}`, "", s.body, ""])].join("\n");
}

export const Route = createFileRoute("/research")({
  head: () => ({
    meta: [
      { title: "Research — Quantitative Analytics" },
      { name: "description", content: "Interactive analytics on every recorded trade." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResearchPage,
});

const SECTIONS = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Performance", icon: TrendingUp },
  { name: "Trades", icon: ListOrdered },
  { name: "Risk", icon: ShieldAlert },
  { name: "Market", icon: Globe },
  { name: "Session", icon: Clock },
  { name: "Explorer", icon: Compass },
  { name: "Heatmaps", icon: Grid3x3 },
  { name: "Distributions", icon: BarChart3 },
  { name: "Correlation", icon: Network },
  { name: "Compare", icon: GitCompare },
  { name: "TF Optimizer", icon: Gauge },
  { name: "Filters", icon: SlidersHorizontal },
  { name: "Report", icon: FileText },
] as const;
type Section = (typeof SECTIONS)[number]["name"];

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "∞";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function pct(n: number): string { return `${(n * 100).toFixed(1)}%`; }
function fmtMs(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); const mm = m % 60;
  if (h < 24) return `${h}h ${mm}m`;
  const d = Math.floor(h / 24); const hh = h % 24;
  return `${d}d ${hh}h`;
}
function fmtDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}
function pnlColor(n: number): string {
  return n > 0 ? "text-emerald-500" : n < 0 ? "text-rose-500" : "text-muted-foreground";
}

function MultiSelectFilter({
  label, allLabel, options, selected, onChange, width,
}: {
  label: string; allLabel: string; options: string[]; selected: string[];
  onChange: (v: string[]) => void; width: string;
}) {
  const summary = selected.length === 0
    ? allLabel
    : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={`h-8 ${width} justify-between text-xs font-normal`}>
          <span className="truncate">{summary}</span>
          <FilterIcon className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="text-xs font-semibold pb-1 px-1">{label}</div>
        <div className="flex items-center justify-between gap-1 pb-2 px-1">
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onChange(options.slice())}>All</Button>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onChange([])}>Clear</Button>
        </div>
        <div className="max-h-64 overflow-auto space-y-1">
          {options.map((opt) => {
            const checked = selected.includes(opt);
            return (
              <label key={opt} className="flex items-center gap-2 text-xs px-1 py-1 rounded hover:bg-muted cursor-pointer">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => {
                    if (v) onChange(Array.from(new Set([...selected, opt])));
                    else onChange(selected.filter((s) => s !== opt));
                  }}
                />
                <span className="truncate">{opt}</span>
              </label>
            );
          })}
          {options.length === 0 && <div className="text-xs text-muted-foreground px-1 py-2">No options</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ResearchPage() {
  const [section, setSection] = useState<Section>("Overview");
  // Read from localStorage in an effect so SSR and first client render match.
  const [navCollapsed, setNavCollapsed] = useState<boolean>(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("research-nav-collapsed") === "1") setNavCollapsed(true);
    } catch { /* storage unavailable */ }
  }, []);
  const toggleNav = () => setNavCollapsed((c) => {
    const next = !c;
    try { window.localStorage.setItem("research-nav-collapsed", next ? "1" : "0"); } catch { /* noop */ }
    return next;
  });
  // queryTrades is called via useDatasetsProgress hook.
  const snapshotsFn = useServerFn(listSnapshots);
  const renameFn = useServerFn(renameSnapshot);
  const deleteFn = useServerFn(deleteSnapshot);
  const [dataset, setDataset] = useDataset();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();
  const [resyncing, setResyncing] = useState(false);
  const [extraDatasets, setExtraDatasets] = useState<string[]>([]);
  const [dedupe, setDedupe] = useState(true);

  // Reset extras when primary dataset changes so we don't double-count it.
  useEffect(() => {
    setExtraDatasets((prev) => prev.filter((d) => d !== dataset));
  }, [dataset]);

  const activeDatasets = useMemo(
    () => Array.from(new Set([dataset, ...extraDatasets])),
    [dataset, extraDatasets],
  );

  const [resyncKey, setResyncKey] = useState(0);
  const { data: datasetData, progress: datasetProgress, isLoading, totalLoaded, error } =
    useDatasetsProgress(activeDatasets, resyncKey);
  const snapshotList = useQuery({
    queryKey: ["trade-intel", "snapshots"],
    queryFn: () => snapshotsFn(),
    staleTime: 60_000,
  });
  const datasetCounts = useMemo(() => {
    const entries = (snapshotList.data?.snapshots ?? []).map((s) => [s.name, s.count] as const);
    return new Map<string, number>(entries);
  }, [snapshotList.data?.snapshots]);
  const latestProgressUpdate = useMemo(() => {
    const updates = activeDatasets.map((ds) => datasetProgress[ds]?.updatedAt ?? 0);
    return Math.max(0, ...updates);
  }, [activeDatasets, datasetProgress]);
  const rawCombined: TradeRecord[] = useMemo(
    () => activeDatasets.flatMap((ds) => datasetData[ds] ?? []),
    [datasetData, activeDatasets],
  );
  const duplicateCount = useMemo(() => {
    if (activeDatasets.length < 2) return 0;
    const seen = new Set<string>();
    let dups = 0;
    for (const r of rawCombined) {
      const key = r.tradeId ?? `${r.strategyId}|${r.symbol}|${r.timeframe ?? ""}|${r.entryTime ?? ""}|${r.exitTime ?? ""}`;
      if (seen.has(key)) dups++;
      else seen.add(key);
    }
    return dups;
  }, [rawCombined, activeDatasets.length]);
  const allTrades: TradeRecord[] = useMemo(() => {
    if (!dedupe || activeDatasets.length < 2) return rawCombined;
    const seen = new Set<string>();
    const out: TradeRecord[] = [];
    for (const r of rawCombined) {
      const key = r.tradeId ?? `${r.strategyId}|${r.symbol}|${r.timeframe ?? ""}|${r.entryTime ?? ""}|${r.exitTime ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }, [rawCombined, dedupe, activeDatasets.length]);

  const [strategyFilter, setStrategyFilter] = useState<string[]>([]);
  const [symbolFilter, setSymbolFilter] = useState<string[]>([]);
  const [timeframeFilter, setTimeframeFilter] = useState<string[]>([]);
  const [timezoneFilter, setTimezoneFilter] = useState<string[]>([]);
  const [directionFilter, setDirectionFilter] = useState<string[]>([]);
  const [customRules, setCustomRules] = useState<Rule[]>([]);

  const trades = useMemo(() => {
    let t = allTrades;
    if (strategyFilter.length) t = t.filter((r) => strategyFilter.includes(r.strategyId));
    if (symbolFilter.length) t = t.filter((r) => symbolFilter.includes(r.symbol));
    if (timeframeFilter.length) t = t.filter((r) => timeframeFilter.includes(r.timeframe ?? "—"));
    if (timezoneFilter.length) t = t.filter((r) => timezoneFilter.includes(tradeTz(r) ?? "—"));
    if (directionFilter.length) t = t.filter((r) => directionFilter.includes(r.direction));
    if (customRules.length) t = applyRules(t, customRules);
    return t;
  }, [allTrades, strategyFilter, symbolFilter, timeframeFilter, timezoneFilter, directionFilter, customRules]);

  const strategies = Array.from(new Set(allTrades.map((r) => r.strategyId)));
  const symbols = Array.from(new Set(allTrades.map((r) => r.symbol)));
  const timeframes = Array.from(new Set(allTrades.map((r) => r.timeframe ?? "—"))).sort();
  const timezones = Array.from(new Set(allTrades.map((r) => tradeTz(r) ?? "—"))).sort();

  return (
    <div className="flex h-full min-h-[calc(100vh-3.5rem)]">
      {/* Left research navigation */}
      <aside
        className={`${navCollapsed ? "w-14" : "w-14 md:w-56"} shrink-0 border-r border-border/60 bg-muted/20 py-4 px-2 flex flex-col transition-[width] duration-200 sticky top-0 self-start h-[calc(100vh-3.5rem)]`}
      >

        {!navCollapsed && (
          <div className="hidden md:block px-3 pb-3">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Research
            </span>
          </div>
        )}
        <nav className="space-y-1 flex-1 overflow-y-auto">
          {SECTIONS.map(({ name, icon: Icon }) => {
            const active = section === name;
            const showLabel = !navCollapsed;
            return (
              <button
                key={name}
                onClick={() => setSection(name)}
                title={name}
                className={`w-full flex items-center gap-3 ${navCollapsed ? "justify-center px-0" : "justify-center md:justify-start px-0 md:px-3"} py-2.5 rounded-md text-sm transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {showLabel && <span className="truncate hidden md:inline">{name}</span>}
              </button>
            );
          })}
        </nav>

        <div className="pt-2 mt-2 border-t border-border/60 flex">
          <button
            onClick={toggleNav}
            className={`${navCollapsed ? "mx-auto" : "ml-auto"} p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors`}
            aria-label={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={navCollapsed ? "Expand" : "Collapse"}
          >
            {navCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-4 space-y-4">
        <Card className={`sticky top-0 z-30 backdrop-blur shadow-sm ${isLoading || resyncing ? "border-primary/50 bg-primary/10" : "border-border/70 bg-card/95"}`}>
          <CardContent className="p-3 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
              {isLoading || resyncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : (
                <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span>
                {resyncing ? "Resyncing" : isLoading ? "Fetching trades" : "Research data ready"}
                {" · "}{activeDatasets.length} dataset{activeDatasets.length > 1 ? "s" : ""}
              </span>
              <span className="ml-auto tabular-nums text-muted-foreground">
                {totalLoaded.toLocaleString()} rows loaded
              </span>
            </div>
            <div className="rounded-md border border-border/60 bg-background/50 px-2 py-1 text-[10px] text-muted-foreground font-mono">
              useDatasetsProgress.isLoading={String(isLoading)} · resyncing={String(resyncing)} · resyncKey={resyncKey} · active={activeDatasets.join(", ") || "none"} · lastUpdate={latestProgressUpdate ? new Date(latestProgressUpdate).toLocaleTimeString() : "—"}
            </div>
            <div className="space-y-2">
              {activeDatasets.map((ds) => {
                const p = datasetProgress[ds];
                const expected = datasetCounts.get(ds);
                const loaded = p?.loaded ?? 0;
                const pct = p?.done
                  ? 100
                  : expected
                    ? Math.min(99, (loaded / Math.max(expected, 1)) * 100)
                    : Math.min(95, (loaded / Math.max(loaded + 8000, 1)) * 100);
                const status = p?.status ?? "queued";
                const statusLabel = status === "cached" ? "cached" : status === "done" ? "complete" : status;
                const wavesText = `${p?.wavesFetched ?? 0}${p?.currentWave && !p.done ? `/${p.currentWave}` : ""}`;
                return (
                  <div key={ds} className="text-[11px] space-y-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="truncate min-w-0 flex-1 font-medium">{ds}</span>
                      <span className="tabular-nums text-muted-foreground">
                        rows {loaded.toLocaleString()}{expected ? ` / ${expected.toLocaleString()}` : ""}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        waves {wavesText} · chunks {(p?.chunksFetched ?? 0).toLocaleString()} · last {(p?.lastBatchRows ?? 0).toLocaleString()}
                      </span>
                      <Badge variant={status === "error" ? "destructive" : status === "fetching" ? "default" : "secondary"} className="h-5 px-1.5 text-[10px]">
                        {statusLabel}
                      </Badge>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                    {p?.error && <div className="text-[10px] text-destructive">{p.error}</div>}
                  </div>
                );
              })}
              {activeDatasets.length === 0 && (
                <div className="text-[11px] text-muted-foreground">No dataset selected.</div>
              )}
              </div>
          </CardContent>
        </Card>
        <header className="flex flex-wrap items-center gap-2 justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Quantitative Research</h1>
            <p className="text-xs text-muted-foreground">
              {isLoading
                ? `Loading… ${totalLoaded.toLocaleString()} rows fetched`
                : `${trades.length.toLocaleString()} of ${allTrades.length.toLocaleString()} trades`}
              {activeDatasets.length > 1 ? ` · ${activeDatasets.length} datasets${dedupe ? ` (deduped, ${duplicateCount.toLocaleString()} removed)` : ""}` : ""}
              {error ? ` — ${error.message}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex items-center gap-1">
              <Select value={dataset} onValueChange={setDataset}>
                <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Dataset" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="live">Live (current)</SelectItem>
                  {(snapshotList.data?.snapshots ?? []).map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      Snapshot · {s.name} ({s.count.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                disabled={dataset === "live" || renaming}
                title={dataset === "live" ? "Only saved snapshots can be renamed" : "Rename this dataset"}
                onClick={async () => {
                  const current = dataset;
                  const next = window.prompt("Rename dataset", current)?.trim();
                  if (!next || next === current) return;
                  setRenaming(true);
                  try {
                    await renameFn({ data: { from: current, to: next } });
                    setDataset(next);
                    await snapshotList.refetch();
                  } catch (e) {
                    window.alert((e as Error).message || "Rename failed");
                  } finally {
                    setRenaming(false);
                  }
                }}
              >
                {renaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                disabled={dataset === "live" || deleting}
                title={dataset === "live" ? "The live dataset cannot be deleted" : "Delete this dataset"}
                onClick={async () => {
                  const current = dataset;
                  if (!window.confirm(`Delete dataset "${current}"? This permanently removes all its archived trades.`)) return;
                  setDeleting(true);
                  try {
                    const res = await deleteFn({ data: { name: current } });
                    setDataset("live");
                    await snapshotList.refetch();
                    window.alert(`Deleted ${res.deleted.toLocaleString()} rows from "${current}".`);
                  } catch (e) {
                    window.alert((e as Error).message || "Delete failed");
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1"
                disabled={resyncing || isLoading}
                title="Refetch trades and snapshot list from the server"
                onClick={async () => {
                  setResyncing(true);
                  try {
                    clearDatasetsCache(activeDatasets, { keepPartial: true });
                    await qc.invalidateQueries({ queryKey: ["trade-intel", "snapshots"] });
                    await snapshotList.refetch();
                    setResyncKey((k) => k + 1);
                  } finally {
                    setResyncing(false);
                  }
                }}
              >
                {resyncing
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <RefreshCw className="h-3.5 w-3.5" />}
                Resync
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1"
                disabled={dataset === "live"}
                title={dataset === "live" ? "Pick a saved snapshot to export" : "Download full CSV (all 68 columns incl. JSONB)"}
                onClick={async () => {
                  try {
                    const { data: sess } = await supabase.auth.getSession();
                    const token = sess.session?.access_token;
                    if (!token) { window.alert("Sign in required"); return; }
                    const url = `/api/export-snapshot?snapshot=${encodeURIComponent(dataset)}`;
                    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                    if (!res.ok) {
                      window.alert(`Export failed: ${res.status} ${await res.text()}`);
                      return;
                    }
                    const blob = await res.blob();
                    const a = document.createElement("a");
                    const href = URL.createObjectURL(blob);
                    a.href = href;
                    a.download = `snapshot-${dataset}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(href);
                  } catch (e) {
                    window.alert((e as Error).message || "Export failed");
                  }
                }}
              >
                <FileDown className="h-3.5 w-3.5" />
                Full CSV
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1"
                    title="Combine multiple datasets"
                  >
                    <Layers className="h-3.5 w-3.5" />
                    {extraDatasets.length > 0 ? `+${extraDatasets.length} more` : "Combine"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3" align="end">
                  <div className="text-xs font-semibold mb-2">Add datasets to combine</div>
                  <div className="max-h-64 overflow-y-auto space-y-1.5">
                    {[
                      { name: "live", count: null as number | null, label: "Live (current)" },
                      ...(snapshotList.data?.snapshots ?? []).map((s) => ({
                        name: s.name, count: s.count, label: s.name,
                      })),
                    ]
                      .filter((opt) => opt.name !== dataset)
                      .map((opt) => {
                        const checked = extraDatasets.includes(opt.name);
                        return (
                          <label
                            key={opt.name}
                            className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 rounded px-1.5 py-1"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => {
                                setExtraDatasets((prev) =>
                                  v ? [...prev, opt.name] : prev.filter((d) => d !== opt.name),
                                );
                              }}
                            />
                            <span className="flex-1 truncate">{opt.label}</span>
                            {opt.count != null && (
                              <span className="text-muted-foreground tabular-nums">
                                {opt.count.toLocaleString()}
                              </span>
                            )}
                          </label>
                        );
                      })}
                  </div>
                  <div className="mt-3 pt-2 border-t border-border/60 space-y-2">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <Checkbox
                        checked={dedupe}
                        onCheckedChange={(v) => setDedupe(!!v)}
                      />
                      <span className="flex-1">Remove duplicates</span>
                      {activeDatasets.length > 1 && (
                        <span className="text-muted-foreground tabular-nums">
                          {duplicateCount.toLocaleString()} dup
                        </span>
                      )}
                    </label>
                    {extraDatasets.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs w-full"
                        onClick={() => setExtraDatasets([])}
                      >
                        Clear extras
                      </Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>


            <MultiSelectFilter label="Strategy" allLabel="All strategies" options={strategies} selected={strategyFilter} onChange={setStrategyFilter} width="w-40" />
            <MultiSelectFilter label="Symbol" allLabel="All symbols" options={symbols} selected={symbolFilter} onChange={setSymbolFilter} width="w-32" />
            <MultiSelectFilter label="Timeframe" allLabel="All timeframes" options={timeframes} selected={timeframeFilter} onChange={setTimeframeFilter} width="w-28" />
            <MultiSelectFilter label="Timezone" allLabel="All timezones" options={timezones} selected={timezoneFilter} onChange={setTimezoneFilter} width="w-32" />
            <MultiSelectFilter label="Direction" allLabel="Both" options={["long","short"]} selected={directionFilter} onChange={setDirectionFilter} width="w-28" />

          </div>
        </header>





        {section === "Overview" && <OverviewSection trades={trades} />}
        {section === "Performance" && <PerformanceSection trades={trades} />}
        {section === "Trades" && <TradeAnalyticsSection trades={trades} />}
        {section === "Risk" && <RiskSection trades={trades} />}
        {section === "Market" && <MarketSection trades={trades} />}
        {section === "Session" && <SessionSection trades={trades} />}
        {section === "Explorer" && <ExplorerSection trades={trades} />}
        {section === "Heatmaps" && <HeatmapSection trades={trades} />}
        {section === "Distributions" && <DistributionSection trades={trades} />}
        {section === "Correlation" && <CorrelationSection trades={trades} />}
        {section === "Compare" && <CompareSection trades={allTrades} />}
        {section === "TF Optimizer" && <TimeframeOptimizerSection trades={trades} />}
        {section === "Filters" && (
          <FiltersSection rules={customRules} onChange={setCustomRules} count={trades.length} />
        )}
        {section === "Report" && <ReportSection trades={trades} />}
      </main>
    </div>
  );
}

// ============================================================
// OVERVIEW
// ============================================================
function OverviewSection({ trades }: { trades: TradeRecord[] }) {
  const k = useMemo(() => computeKpis(trades), [trades]);
  const stats: Array<[string, string, string?]> = [
    ["Total Trades", fmt(k.total, 0)],
    ["Winning", fmt(k.winners, 0), "text-emerald-500"],
    ["Losing", fmt(k.losers, 0), "text-rose-500"],
    ["Break-even", fmt(k.breakEven, 0)],
    ["Win Rate", pct(k.winRate)],
    ["Loss Rate", pct(k.lossRate)],
    ["Profit Factor", fmt(k.profitFactor)],
    ["Expectancy", fmt(k.expectancy)],
    ["Net Profit", fmt(k.netProfit), pnlColor(k.netProfit)],
    ["Gross Profit", fmt(k.grossProfit), "text-emerald-500"],
    ["Gross Loss", fmt(-k.grossLoss), "text-rose-500"],
    ["Average RR", fmt(k.averageRr)],
    ["Average Win", fmt(k.averageWin), "text-emerald-500"],
    ["Average Loss", fmt(-k.averageLoss), "text-rose-500"],
    ["Recovery Factor", fmt(k.recoveryFactor)],
    ["Max Drawdown", fmt(-k.maxDrawdown), "text-rose-500"],
    ["Max Win Streak", fmt(k.maxWinStreak, 0), "text-emerald-500"],
    ["Max Loss Streak", fmt(k.maxLossStreak, 0), "text-rose-500"],
    ["Avg Holding", fmtMs(k.averageHoldingMs)],
    ["Avg Fill Delay", fmtMs(k.averageFillDelayMs)],
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
      {stats.map(([label, val, color]) => (
        <Card key={label}>
          <CardHeader className="pb-1"><CardTitle className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</CardTitle></CardHeader>
          <CardContent className={`text-xl font-semibold font-mono ${color ?? ""}`}>{val}</CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================================
// PERFORMANCE / EQUITY
// ============================================================
function PerformanceSection({ trades }: { trades: TradeRecord[] }) {
  const [bucket, setBucket] = useState<EquityBucket>("D");
  const curve = useMemo(() => equityCurve(trades), [trades]);
  const rolled = useMemo(() => rolledPnl(trades, bucket), [trades, bucket]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="text-sm">Equity Curve</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={curve}>
              <defs>
                <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="index" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <RTooltip />
              <Area type="monotone" dataKey="equity" stroke="hsl(var(--primary))" fill="url(#eq)" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Drawdown</CardTitle></CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={curve}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="index" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <RTooltip />
              <Area type="monotone" dataKey="drawdown" stroke="#ef4444" fill="#ef4444" fillOpacity={0.25} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="text-sm">Rolling PnL</CardTitle>
          <Select value={bucket} onValueChange={(v) => setBucket(v as EquityBucket)}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="D">Daily</SelectItem>
              <SelectItem value="W">Weekly</SelectItem>
              <SelectItem value="M">Monthly</SelectItem>
              <SelectItem value="Q">Quarterly</SelectItem>
              <SelectItem value="Y">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rolled}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="key" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <RTooltip />
              <Bar dataKey="pnl">
                {rolled.map((r, i) => (
                  <Cell key={i} fill={r.pnl >= 0 ? "#10b981" : "#ef4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// TRADE ANALYTICS
// ============================================================
function TradeAnalyticsSection({ trades }: { trades: TradeRecord[] }) {
  const byDirection = groupBy(trades, (t) => t.direction);
  const byEntry = groupBy(trades, (t) => t.entryType ?? "unknown");
  const byExit = groupBy(trades, (t) => t.exitReason ?? "unknown");
  const byStop = groupBy(trades, (t) => t.stopType ?? "unknown");
  const byTarget = groupBy(trades, (t) => t.targetType ?? "unknown");
  const sorted = sortByExit(trades);
  const best = [...sorted].sort((a, b) => b.netPnl - a.netPnl).slice(0, 10);
  const worst = [...sorted].sort((a, b) => a.netPnl - b.netPnl).slice(0, 10);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <BreakdownCard title="Long vs Short" data={byDirection} />
      <BreakdownCard title="Entry Models" data={byEntry} />
      <BreakdownCard title="Stop Models" data={byStop} />
      <BreakdownCard title="Target Models" data={byTarget} />
      <BreakdownCard title="Exit Reasons" data={byExit} />
      <Card>
        <CardHeader><CardTitle className="text-sm">Best 10 Trades</CardTitle></CardHeader>
        <CardContent className="p-0">
          <TradeMiniTable rows={best} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Worst 10 Trades</CardTitle></CardHeader>
        <CardContent className="p-0">
          <TradeMiniTable rows={worst} />
        </CardContent>
      </Card>
    </div>
  );
}

function BreakdownCard({ title, data }: {
  title: string;
  data: ReturnType<typeof groupBy>;
}) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bucket</TableHead>
              <TableHead className="text-right">Trades</TableHead>
              <TableHead className="text-right">Win %</TableHead>
              <TableHead className="text-right">PF</TableHead>
              <TableHead className="text-right">Expectancy</TableHead>
              <TableHead className="text-right">Net PnL</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={String(row.key)}>
                <TableCell className="font-mono text-xs">{String(row.key)}</TableCell>
                <TableCell className="text-right">{row.kpis.total}</TableCell>
                <TableCell className="text-right">{pct(row.kpis.winRate)}</TableCell>
                <TableCell className="text-right">{fmt(row.kpis.profitFactor)}</TableCell>
                <TableCell className="text-right">{fmt(row.kpis.expectancy)}</TableCell>
                <TableCell className={`text-right ${pnlColor(row.kpis.netProfit)}`}>{fmt(row.kpis.netProfit)}</TableCell>
              </TableRow>
            ))}
            {data.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">No data</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TradeMiniTable({ rows }: { rows: TradeRecord[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Exit</TableHead>
          <TableHead>Sym</TableHead>
          <TableHead>Dir</TableHead>
          <TableHead className="text-right">RR</TableHead>
          <TableHead className="text-right">Net</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.tradeId}>
            <TableCell className="font-mono text-xs">{fmtDate(r.exitTime)}</TableCell>
            <TableCell className="text-xs">{r.symbol}</TableCell>
            <TableCell><Badge variant="outline" className="text-[10px]">{r.direction}</Badge></TableCell>
            <TableCell className="text-right text-xs">{fmt(num(r.actualRr))}</TableCell>
            <TableCell className={`text-right font-mono text-xs ${pnlColor(r.netPnl)}`}>{fmt(r.netPnl)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ============================================================
// RISK
// ============================================================
function RiskSection({ trades }: { trades: TradeRecord[] }) {
  const maes = trades.map((t) => num(t.mae));
  const mfes = trades.map((t) => num(t.mfe));
  const risks = trades.map((t) => num(t.riskUsd));
  const sizes = trades.map((t) => num(t.positionSize));
  const scatter = trades.map((t) => ({ mae: num(t.mae), mfe: num(t.mfe), pnl: t.netPnl }));

  const k = computeKpis(trades);
  const kelly = k.averageWin && k.averageLoss
    ? Math.max(0, k.winRate - (1 - k.winRate) * (k.averageLoss / k.averageWin))
    : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Kelly %" value={pct(kelly)} />
        <MiniStat label="Max Drawdown" value={fmt(-k.maxDrawdown)} tone="loss" />
        <MiniStat label="Recovery Factor" value={fmt(k.recoveryFactor)} />
        <MiniStat label="Avg Risk $" value={fmt(risks.filter(Number.isFinite).reduce((a, b) => a + b, 0) / (risks.length || 1))} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <HistCard title="MAE Distribution" values={maes} color="#ef4444" />
        <HistCard title="MFE Distribution" values={mfes} color="#10b981" />
        <HistCard title="Risk $ Distribution" values={risks.filter((v) => v > 0)} color="#f59e0b" />
        <HistCard title="Position Size Distribution" values={sizes.filter((v) => v > 0)} color="#6366f1" />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">MAE vs MFE (colored by PnL)</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis type="number" dataKey="mae" name="MAE" tick={{ fontSize: 10 }} />
              <YAxis type="number" dataKey="mfe" name="MFE" tick={{ fontSize: 10 }} />
              <RTooltip cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={scatter}>
                {scatter.map((p, i) => (
                  <Cell key={i} fill={p.pnl >= 0 ? "#10b981" : "#ef4444"} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "win" | "loss" }) {
  const color = tone === "win" ? "text-emerald-500" : tone === "loss" ? "text-rose-500" : "";
  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent className={`text-lg font-mono font-semibold ${color}`}>{value}</CardContent>
    </Card>
  );
}

function HistCard({ title, values, color }: { title: string; values: number[]; color: string }) {
  const bins = histogram(values, 20);
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bins}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <RTooltip />
            <Bar dataKey="count" fill={color} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ============================================================
// MARKET
// ============================================================
function MarketSection({ trades }: { trades: TradeRecord[] }) {
  const pickers: Array<{ label: string; key: (t: TradeRecord) => number | null }> = [
    { label: "ATR", key: (t) => num(t.volatility?.atr) || null },
    { label: "Daily Range", key: (t) => num(t.volatility?.dailyRange) || null },
    { label: "Volume", key: (t) => num(t.volumeProfile?.volume) || null },
    { label: "Break Distance", key: (t) => num(t.breakout?.breakDistance) || null },
    { label: "Body %", key: (t) => num(t.breakout?.bodyPct) || null },
    { label: "OR Size", key: (t) => num(t.breakout?.orSize) || null },
  ];
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {pickers.map((p) => {
        const buckets = bucketize(trades, p.key, 5);
        return (
          <Card key={p.label}>
            <CardHeader><CardTitle className="text-sm">{p.label} vs Performance</CardTitle></CardHeader>
            <CardContent className="p-0">
              <BucketTable buckets={buckets} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function bucketize(
  trades: TradeRecord[],
  getter: (t: TradeRecord) => number | null,
  n = 5,
) {
  const withVal = trades.map((t) => ({ t, v: getter(t) })).filter((x): x is { t: TradeRecord; v: number } => x.v != null && Number.isFinite(x.v));
  if (!withVal.length) return [];
  const sorted = [...withVal].sort((a, b) => a.v - b.v);
  const size = Math.ceil(sorted.length / n);
  const chunks: Array<{ label: string; rows: TradeRecord[] }> = [];
  for (let i = 0; i < n; i++) {
    const slice = sorted.slice(i * size, (i + 1) * size);
    if (!slice.length) continue;
    const lo = slice[0].v; const hi = slice[slice.length - 1].v;
    chunks.push({ label: `${lo.toFixed(2)}–${hi.toFixed(2)}`, rows: slice.map((s) => s.t) });
  }
  return chunks.map((c) => ({ key: c.label, rows: c.rows, kpis: computeKpis(c.rows) }));
}

function BucketTable({ buckets }: { buckets: ReturnType<typeof bucketize> }) {
  if (!buckets.length) return <div className="p-4 text-xs text-muted-foreground">No data</div>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Bucket</TableHead>
          <TableHead className="text-right">Trades</TableHead>
          <TableHead className="text-right">Win %</TableHead>
          <TableHead className="text-right">PF</TableHead>
          <TableHead className="text-right">Expectancy</TableHead>
          <TableHead className="text-right">Net</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {buckets.map((b) => (
          <TableRow key={b.key}>
            <TableCell className="font-mono text-xs">{b.key}</TableCell>
            <TableCell className="text-right">{b.kpis.total}</TableCell>
            <TableCell className="text-right">{pct(b.kpis.winRate)}</TableCell>
            <TableCell className="text-right">{fmt(b.kpis.profitFactor)}</TableCell>
            <TableCell className="text-right">{fmt(b.kpis.expectancy)}</TableCell>
            <TableCell className={`text-right ${pnlColor(b.kpis.netProfit)}`}>{fmt(b.kpis.netProfit)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ============================================================
// SESSION
// ============================================================
function SessionSection({ trades }: { trades: TradeRecord[] }) {
  const bySession = groupBy(trades, (t) => t.session ?? "unknown");
  const byWeekday = groupBy(trades, (t) => {
    if (t.weekday == null) return null;
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][t.weekday];
  });
  const byMonth = groupBy(trades, (t) => t.month != null ? String(t.month).padStart(2, "0") : null);
  const byQuarter = groupBy(trades, (t) => t.quarter != null ? `Q${t.quarter}` : null);
  const byYear = groupBy(trades, (t) => t.year != null ? String(t.year) : null);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <BreakdownCard title="By Session" data={bySession} />
      <BreakdownCard title="By Weekday" data={byWeekday} />
      <BreakdownCard title="By Month" data={byMonth} />
      <BreakdownCard title="By Quarter" data={byQuarter} />
      <BreakdownCard title="By Year" data={byYear} />
    </div>
  );
}

// ============================================================
// EXPLORER
// ============================================================
function ExplorerSection({ trades }: { trades: TradeRecord[] }) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<keyof TradeRecord>("exitTime");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const PAGE = 50;

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return trades.filter((t) =>
      !needle
      || t.tradeId.toLowerCase().includes(needle)
      || t.strategyId.toLowerCase().includes(needle)
      || t.symbol.toLowerCase().includes(needle)
      || (t.session ?? "").toLowerCase().includes(needle)
    );
  }, [trades, q]);
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] as unknown as number | string;
      const bv = b[sortKey] as unknown as number | string;
      const cmp = av === bv ? 0 : (av < bv ? -1 : 1);
      return dir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, dir]);
  const pageRows = sorted.slice(page * PAGE, (page + 1) * PAGE);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 justify-between">
        <CardTitle className="text-sm">Trade Explorer</CardTitle>
        <div className="flex items-center gap-2">
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search…" className="h-8 w-56" />
          <Button size="sm" variant="outline" onClick={() => download("trades.csv", toCsv(sorted as unknown as Array<Record<string, unknown>>), "text/csv")}>
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => download("trades.json", JSON.stringify(sorted, null, 2), "application/json")}>
            <Download className="h-3.5 w-3.5 mr-1" /> JSON
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              {[
                ["exitTime", "Exit"],
                ["strategyId", "Strategy"],
                ["symbol", "Symbol"],
                ["direction", "Dir"],
                ["session", "Session"],
                ["actualRr", "RR"],
                ["netPnl", "Net PnL"],
                ["durationMs", "Duration"],
              ].map(([k, label]) => (
                <TableHead
                  key={k}
                  className="cursor-pointer select-none"
                  onClick={() => {
                    if (sortKey === k) setDir(dir === "asc" ? "desc" : "asc");
                    else { setSortKey(k as keyof TradeRecord); setDir("desc"); }
                  }}
                >
                  {label}{sortKey === k ? (dir === "asc" ? " ↑" : " ↓") : ""}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((t) => (
              <TableRow key={t.tradeId}>
                <TableCell className="font-mono text-xs">{fmtDate(t.exitTime)}</TableCell>
                <TableCell className="text-xs">{t.strategyId}</TableCell>
                <TableCell className="text-xs">{t.symbol}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{t.direction}</Badge></TableCell>
                <TableCell className="text-xs">{t.session ?? "—"}</TableCell>
                <TableCell className="text-right text-xs">{fmt(num(t.actualRr))}</TableCell>
                <TableCell className={`text-right font-mono text-xs ${pnlColor(t.netPnl)}`}>{fmt(t.netPnl)}</TableCell>
                <TableCell className="text-xs">{fmtMs(num(t.durationMs))}</TableCell>
              </TableRow>
            ))}
            {pageRows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No trades</TableCell></TableRow>}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between p-3 border-t border-border/60 text-xs text-muted-foreground">
          <div>{sorted.length.toLocaleString()} trades • page {page + 1}/{totalPages}</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>Prev</Button>
            <Button size="sm" variant="outline" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>Next</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// HEATMAPS  (Weekday × Hour by Net PnL)
// ============================================================
function HeatmapSection({ trades }: { trades: TradeRecord[] }) {
  const cells = useMemo(() => {
    const grid: Record<string, { pnl: number; trades: number; wins: number }> = {};
    for (const t of trades) {
      if (t.weekday == null) continue;
      const hour = new Date(t.entryTime).getUTCHours();
      const key = `${t.weekday}:${hour}`;
      const e = grid[key] ?? { pnl: 0, trades: 0, wins: 0 };
      e.pnl += t.netPnl; e.trades += 1; if (t.netPnl > 0) e.wins += 1;
      grid[key] = e;
    }
    return grid;
  }, [trades]);
  const maxAbs = Math.max(1, ...Object.values(cells).map((v) => Math.abs(v.pnl)));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Weekday × Hour (UTC) — Net PnL</CardTitle></CardHeader>
      <CardContent className="overflow-auto">
        <div className="inline-grid" style={{ gridTemplateColumns: `60px repeat(24, minmax(28px, 1fr))` }}>
          <div />
          {hours.map((h) => <div key={h} className="text-[10px] text-center text-muted-foreground py-1">{h}</div>)}
          {days.map((d, di) => (
            <>
              <div key={`lbl-${d}`} className="text-[11px] flex items-center pr-2 font-medium">{d}</div>
              {hours.map((h) => {
                const c = cells[`${di}:${h}`];
                const pnl = c?.pnl ?? 0;
                const intensity = c ? Math.min(1, Math.abs(pnl) / maxAbs) : 0;
                const bg = !c ? "transparent"
                  : pnl >= 0 ? `rgba(16, 185, 129, ${0.15 + intensity * 0.7})`
                    : `rgba(239, 68, 68, ${0.15 + intensity * 0.7})`;
                return (
                  <div
                    key={`${d}-${h}`}
                    title={c ? `${d} ${h}h: ${c.trades} trades, ${fmt(pnl)}` : "no data"}
                    className="h-8 border border-border/40 flex items-center justify-center text-[9px] font-mono"
                    style={{ backgroundColor: bg }}
                  >
                    {c?.trades ? c.trades : ""}
                  </div>
                );
              })}
            </>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// DISTRIBUTIONS
// ============================================================
function DistributionSection({ trades }: { trades: TradeRecord[] }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <HistCard title="Net PnL" values={trades.map((t) => t.netPnl)} color="#6366f1" />
      <HistCard title="Actual RR" values={trades.map((t) => num(t.actualRr))} color="#10b981" />
      <HistCard title="Trade Duration (min)" values={trades.map((t) => num(t.durationMs) / 60000)} color="#f59e0b" />
      <HistCard title="MAE" values={trades.map((t) => num(t.mae))} color="#ef4444" />
      <HistCard title="MFE" values={trades.map((t) => num(t.mfe))} color="#10b981" />
      <HistCard title="Fill Delay (s)" values={
        trades.map((t) => (t.fillTime && t.orderTime ? (t.fillTime - t.orderTime) / 1000 : NaN))
      } color="#3b82f6" />
    </div>
  );
}

// ============================================================
// CORRELATION
// ============================================================
function CorrelationSection({ trades }: { trades: TradeRecord[] }) {
  const cols: Record<string, number[]> = {
    "PnL": [], "RR": [], "Duration": [], "MAE": [], "MFE": [], "Risk": [], "Weekday": [], "Hour": [],
  };
  for (const t of trades) {
    cols.PnL.push(t.netPnl);
    cols.RR.push(num(t.actualRr));
    cols.Duration.push(num(t.durationMs) / 60000);
    cols.MAE.push(num(t.mae));
    cols.MFE.push(num(t.mfe));
    cols.Risk.push(num(t.riskUsd));
    cols.Weekday.push(num(t.weekday));
    cols.Hour.push(new Date(t.entryTime).getUTCHours());
  }
  const { keys, matrix } = correlationMatrix(cols);

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Correlation Matrix (Pearson)</CardTitle></CardHeader>
      <CardContent className="overflow-auto">
        <table className="text-xs font-mono">
          <thead>
            <tr>
              <th></th>
              {keys.map((k) => <th key={k} className="px-2 py-1 text-muted-foreground">{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {keys.map((rk, ri) => (
              <tr key={rk}>
                <td className="pr-2 text-muted-foreground text-right">{rk}</td>
                {matrix[ri].map((v, ci) => {
                  const intensity = Math.min(1, Math.abs(v));
                  const bg = v >= 0 ? `rgba(16,185,129,${intensity * 0.65})` : `rgba(239,68,68,${intensity * 0.65})`;
                  return (
                    <td key={ci} className="w-14 h-8 text-center border border-border/40" style={{ backgroundColor: bg }}>
                      {v.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ============================================================
// COMPARE
// ============================================================
function CompareSection({ trades }: { trades: TradeRecord[] }) {
  const byStrategy = groupBy(trades, (t) => t.strategyId);
  const chartData = byStrategy.map((g) => ({
    name: g.key, net: g.kpis.netProfit, pf: g.kpis.profitFactor, wr: g.kpis.winRate * 100,
  }));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Strategy Comparison</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Strategy</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">Win %</TableHead>
                <TableHead className="text-right">PF</TableHead>
                <TableHead className="text-right">Expectancy</TableHead>
                <TableHead className="text-right">Avg RR</TableHead>
                <TableHead className="text-right">Max DD</TableHead>
                <TableHead className="text-right">Recovery</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byStrategy.map((g) => (
                <TableRow key={g.key}>
                  <TableCell className="font-mono text-xs">{g.key}</TableCell>
                  <TableCell className="text-right">{g.kpis.total}</TableCell>
                  <TableCell className="text-right">{pct(g.kpis.winRate)}</TableCell>
                  <TableCell className="text-right">{fmt(g.kpis.profitFactor)}</TableCell>
                  <TableCell className="text-right">{fmt(g.kpis.expectancy)}</TableCell>
                  <TableCell className="text-right">{fmt(g.kpis.averageRr)}</TableCell>
                  <TableCell className="text-right text-rose-500">{fmt(-g.kpis.maxDrawdown)}</TableCell>
                  <TableCell className="text-right">{fmt(g.kpis.recoveryFactor)}</TableCell>
                  <TableCell className={`text-right ${pnlColor(g.kpis.netProfit)}`}>{fmt(g.kpis.netProfit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Net Profit by Strategy</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <RTooltip />
              <Bar dataKey="net">
                {chartData.map((r, i) => <Cell key={i} fill={r.net >= 0 ? "#10b981" : "#ef4444"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// FILTER BUILDER
// ============================================================
const FIELD_OPTIONS = [
  "netPnl", "actualRr", "durationMs", "mae", "mfe", "riskUsd", "positionSize",
  "direction", "session", "strategyId", "symbol", "exitReason", "weekday", "month", "quarter", "year",
  "volatility.atr", "breakout.orSize", "breakout.breakDistance", "trend.emaAlignment",
];

function FiltersSection({ rules, onChange, count }: {
  rules: Rule[];
  onChange: (rs: Rule[]) => void;
  count: number;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FilterIcon className="h-4 w-4" /> Custom Filter Builder
        </CardTitle>
        <div className="text-xs text-muted-foreground">Live: {count.toLocaleString()} trades match</div>
      </CardHeader>
      <CardContent className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select value={r.field} onValueChange={(v) => onChange(rules.map((x, j) => j === i ? { ...x, field: v } : x))}>
              <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FIELD_OPTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={r.op} onValueChange={(v) => onChange(rules.map((x, j) => j === i ? { ...x, op: v as Op } : x))}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"] as Op[]).map((o) =>
                  <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              value={r.value}
              onChange={(e) => onChange(rules.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
              className="h-8 w-56 text-xs"
              placeholder="value"
            />
            <Button size="sm" variant="ghost" onClick={() => onChange(rules.filter((_, j) => j !== i))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => onChange([...rules, { field: "netPnl", op: "gt", value: "0" }])}>
          <PlusCircle className="h-3.5 w-3.5 mr-1" /> Add rule
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================================
// REPORT
// ============================================================
function ReportSection({ trades }: { trades: TradeRecord[] }) {
  const k = computeKpis(trades);
  const md = () => toMarkdownReport("Quantitative Research Report", [
    { heading: "Summary", body:
      `- Total Trades: ${k.total}\n- Win Rate: ${pct(k.winRate)}\n- Profit Factor: ${fmt(k.profitFactor)}\n`
      + `- Expectancy: ${fmt(k.expectancy)}\n- Net Profit: ${fmt(k.netProfit)}\n- Max Drawdown: ${fmt(-k.maxDrawdown)}`,
    },
    { heading: "Streaks", body: `- Max Win Streak: ${k.maxWinStreak}\n- Max Loss Streak: ${k.maxLossStreak}` },
  ]);
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Export Report</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() =>
          download("report.json", JSON.stringify({ kpis: k, trades }, null, 2), "application/json")}>
          <Download className="h-3.5 w-3.5 mr-1" /> JSON
        </Button>
        <Button variant="outline" size="sm" onClick={() =>
          download("trades.csv", toCsv(trades as unknown as Array<Record<string, unknown>>), "text/csv")}>
          <Download className="h-3.5 w-3.5 mr-1" /> CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() =>
          download("report.md", md(), "text/markdown")}>
          <Download className="h-3.5 w-3.5 mr-1" /> Markdown
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Download className="h-3.5 w-3.5 mr-1" /> PDF (Print)
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================================
// TIMEFRAME OPTIMIZER
// ============================================================
interface TfRow {
  strategyId: string;
  symbol: string;
  timeframe: string;
  timezone: string;
  trades: number;
  netProfit: number;
  profitFactor: number;
  winRate: number;
  expectancy: number;
  maxDrawdown: number;
  stability: number;   // 0..1 — fraction of positive monthly buckets
  rank: {
    profitFactor: number;
    netProfit: number;
    winRate: number;
    expectancy: number;
    trades: number;
    stability: number;
  };
  robustness: number;  // 0..100
}

function computeStability(rows: TradeRecord[]): number {
  const monthly = rolledPnl(rows, "M");
  if (monthly.length === 0) return 0;
  const pos = monthly.filter((m) => m.pnl > 0).length;
  return pos / monthly.length;
}

function rankAsc(values: number[]): number[] {
  // higher value → rank 1 (best)
  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const ranks = new Array(values.length).fill(0);
  idx.forEach((e, r) => { ranks[e.i] = r + 1; });
  return ranks;
}

function TimeframeOptimizerSection({ trades }: { trades: TradeRecord[] }) {
  const [strategyFocus, setStrategyFocus] = useState<string>("all");
  // Snapshot the input trades — only recomputed when the user clicks "Run".
  const [snapshot, setSnapshot] = useState<TradeRecord[]>(() => trades);
  const [ranAt, setRanAt] = useState<number>(() => Date.now());
  const stale = snapshot !== trades;

  const strategies = useMemo(
    () => Array.from(new Set(snapshot.map((t) => t.strategyId))).sort(),
    [snapshot],
  );

  const rows: TfRow[] = useMemo(() => {
    // Group by strategy + symbol + timeframe + timezone (so multi-tz runs compete)
    const map = new Map<string, TradeRecord[]>();
    for (const t of snapshot) {
      const key = `${t.strategyId}||${t.symbol ?? "—"}||${t.timeframe ?? "—"}||${tradeTz(t) ?? "—"}`;
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    const raw = Array.from(map.entries()).map(([key, rs]) => {
      const [strategyId, symbol, timeframe, timezone] = key.split("||");
      const k = computeKpis(rs);
      return {
        strategyId,
        symbol,
        timeframe,
        timezone,
        trades: k.total,
        netProfit: k.netProfit,
        profitFactor: Number.isFinite(k.profitFactor) ? k.profitFactor : 999,
        winRate: k.winRate,
        expectancy: k.expectancy,
        maxDrawdown: k.maxDrawdown,
        stability: computeStability(rs),
      };
    });

    // Ranking is done per-strategy so timeframes compete within their strategy.
    const byStrategy = new Map<string, typeof raw>();
    for (const r of raw) {
      const arr = byStrategy.get(r.strategyId) ?? [];
      arr.push(r); byStrategy.set(r.strategyId, arr);
    }

    const out: TfRow[] = [];
    for (const [, group] of byStrategy) {
      const pfR = rankAsc(group.map((g) => g.profitFactor));
      const npR = rankAsc(group.map((g) => g.netProfit));
      const wrR = rankAsc(group.map((g) => g.winRate));
      const exR = rankAsc(group.map((g) => g.expectancy));
      const trR = rankAsc(group.map((g) => g.trades));
      const stR = rankAsc(group.map((g) => g.stability));

      // Normalized 0..1 components for the robustness score
      // (higher is better; drawdown is inverted)
      const maxPf = Math.max(...group.map((g) => g.profitFactor), 0.0001);
      const maxNp = Math.max(...group.map((g) => g.netProfit), 0.0001);
      const maxTr = Math.max(...group.map((g) => g.trades), 1);
      const maxDd = Math.max(...group.map((g) => g.maxDrawdown), 0.0001);

      group.forEach((g, i) => {
        const pfN = Math.min(1, Math.max(0, g.profitFactor / Math.max(2, maxPf)));
        const npN = Math.min(1, Math.max(0, g.netProfit / maxNp));
        const trN = Math.min(1, g.trades / Math.max(100, maxTr));
        const wrN = Math.min(1, Math.max(0, g.winRate));
        const ddN = 1 - Math.min(1, g.maxDrawdown / maxDd); // less DD → higher
        const robust =
          0.35 * pfN +
          0.25 * trN +
          0.20 * npN +
          0.10 * wrN +
          0.10 * ddN;
        out.push({
          ...g,
          rank: {
            profitFactor: pfR[i],
            netProfit: npR[i],
            winRate: wrR[i],
            expectancy: exR[i],
            trades: trR[i],
            stability: stR[i],
          },
          robustness: Math.round(robust * 100),
        });
      });
    }
    return out.sort((a, b) =>
      a.strategyId === b.strategyId
        ? b.robustness - a.robustness
        : a.strategyId.localeCompare(b.strategyId),
    );
  }, [snapshot]);

  const filtered = strategyFocus === "all" ? rows : rows.filter((r) => r.strategyId === strategyFocus);

  const bestPerStrategy = useMemo(() => {
    const map = new Map<string, TfRow>();
    for (const r of rows) {
      const cur = map.get(r.strategyId);
      if (!cur || r.robustness > cur.robustness) map.set(r.strategyId, r);
    }
    return Array.from(map.values()).sort((a, b) => b.robustness - a.robustness);
  }, [rows]);

  const robustColor = (score: number) =>
    score >= 70 ? "text-emerald-500" : score >= 50 ? "text-amber-500" : "text-rose-500";

  const runOptimization = () => {
    setSnapshot(trades);
    setRanAt(Date.now());
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-sm">Timeframe Optimizer</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Ranks every timeframe within each strategy. Robustness = 35% PF · 25% Sample · 20% Net Profit · 10% Win Rate · 10% Drawdown.
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {stale ? (
                <span className="text-amber-500">Filters changed — click Run to refresh.</span>
              ) : (
                <>Last run: {new Date(ranAt).toLocaleTimeString()} · {snapshot.length.toLocaleString()} trades</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={strategyFocus} onValueChange={setStrategyFocus}>
              <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All strategies</SelectItem>
                {strategies.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant={stale ? "default" : "outline"}
              onClick={runOptimization}
              className="h-8"
            >
              <Gauge className="h-3.5 w-3.5 mr-1.5" />
              Run optimization
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Best Timeframe per Strategy</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Strategy</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Best TF</TableHead>
                <TableHead>TZ</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">PF</TableHead>
                <TableHead className="text-right">Win %</TableHead>
                <TableHead className="text-right">Stability</TableHead>
                <TableHead className="text-right">Robustness</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bestPerStrategy.map((r) => (
                <TableRow key={r.strategyId}>
                  <TableCell className="font-medium">{r.strategyId}</TableCell>
                  <TableCell className="text-xs">{r.symbol}</TableCell>
                  <TableCell><Badge variant="secondary">{r.timeframe}</Badge></TableCell>
                  <TableCell className="text-xs font-mono">{r.timezone}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.trades, 0)}</TableCell>
                  <TableCell className={`text-right font-mono ${pnlColor(r.netProfit)}`}>{fmt(r.netProfit)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.profitFactor)}</TableCell>
                  <TableCell className="text-right font-mono">{pct(r.winRate)}</TableCell>
                  <TableCell className="text-right font-mono">{pct(r.stability)}</TableCell>
                  <TableCell className={`text-right font-mono font-semibold ${robustColor(r.robustness)}`}>{r.robustness}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">All Strategy × Symbol × Timeframe × Timezone Combinations</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Strategy</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>TF</TableHead>
                <TableHead>TZ</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">Net Profit</TableHead>
                <TableHead className="text-right">PF</TableHead>
                <TableHead className="text-right">Win %</TableHead>
                <TableHead className="text-right">Expectancy</TableHead>
                <TableHead className="text-right">Max DD</TableHead>
                <TableHead className="text-right">Stability</TableHead>
                <TableHead className="text-right">Rank (PF/N/W/E/T/S)</TableHead>
                <TableHead className="text-right">Robustness</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={`${r.strategyId}-${r.symbol}-${r.timeframe}-${r.timezone}`}>
                  <TableCell className="text-xs">{r.strategyId}</TableCell>
                  <TableCell className="text-xs">{r.symbol}</TableCell>
                  <TableCell><Badge variant="outline">{r.timeframe}</Badge></TableCell>
                  <TableCell className="text-xs font-mono">{r.timezone}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.trades, 0)}</TableCell>
                  <TableCell className={`text-right font-mono ${pnlColor(r.netProfit)}`}>{fmt(r.netProfit)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.profitFactor)}</TableCell>
                  <TableCell className="text-right font-mono">{pct(r.winRate)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.expectancy)}</TableCell>
                  <TableCell className="text-right font-mono text-rose-500">{fmt(-r.maxDrawdown)}</TableCell>
                  <TableCell className="text-right font-mono">{pct(r.stability)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {r.rank.profitFactor}/{r.rank.netProfit}/{r.rank.winRate}/{r.rank.expectancy}/{r.rank.trades}/{r.rank.stability}
                  </TableCell>
                  <TableCell className={`text-right font-mono font-semibold ${robustColor(r.robustness)}`}>{r.robustness}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
