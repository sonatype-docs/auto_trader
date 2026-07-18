import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { backtestGridSweep } from "@/lib/strategy.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowUpDown, Download } from "lucide-react";

type SortKey =
  | "idx" | "net_pnl_usd" | "win_rate_pct" | "trades" | "avg_r"
  | "profit_factor" | "max_drawdown_usd" | "expectancy_usd" | "fill_rate_pct";

type Row = Awaited<ReturnType<typeof backtestGridSweep>>["rows"][number];

interface Defaults {
  symbol: string;
  days: number;
  slRiskUsd: number;
  rr: number;
  sessionStartIst: string;
  entryMode: "fib" | "retest" | "market" | "adaptive";
  entryDepthPct: number;
  slDepthPct: number;
  retestSlR: number;
  trailEnabled: boolean;
  trailActivateR: number;
  trailStepR: number;
  feeUsdPerOrder: number;
  zoneSource: "range" | "breakout";
  dataSource: "shark" | "yahoo";
  skipWeekdays: number[];
}

// Parse a comma-separated list into unique values.
const parseNums = (s: string): number[] => {
  const out = new Set<number>();
  for (const p of s.split(",").map((x) => x.trim()).filter(Boolean)) {
    const n = Number(p);
    if (Number.isFinite(n)) out.add(n);
  }
  return [...out];
};
const parseStrs = (s: string): string[] => {
  const out = new Set<string>();
  for (const p of s.split(",").map((x) => x.trim()).filter(Boolean)) out.add(p);
  return [...out];
};

function Chips<T extends string | number | boolean>({
  values, selected, onToggle, format,
}: {
  values: readonly T[];
  selected: T[];
  onToggle: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => {
        const on = selected.some((s) => String(s) === String(v));
        return (
          <button
            key={String(v)}
            type="button"
            onClick={() => onToggle(v)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-mono border transition-colors ${
              on
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
            }`}
          >
            {format ? format(v) : String(v)}
          </button>
        );
      })}
    </div>
  );
}

export function GridSweepPanel({ defaults }: { defaults: Defaults }) {
  const run = useServerFn(backtestGridSweep);

  // Each axis: default to a single-item set = current form value, so the user
  // opts in to sweeping by adding more values.
  const [sessionCsv, setSessionCsv] = useState<string>(defaults.sessionStartIst);
  const [slCsv, setSlCsv] = useState<string>(String(defaults.slRiskUsd));
  const [rrCsv, setRrCsv] = useState<string>(String(defaults.rr));
  const [entryModes, setEntryModes] = useState<Array<"fib" | "retest" | "market" | "adaptive">>([defaults.entryMode]);
  const [entryDepthCsv, setEntryDepthCsv] = useState<string>(String(defaults.entryDepthPct));
  const [slDepthCsv, setSlDepthCsv] = useState<string>(String(defaults.slDepthPct));
  const [retestSlCsv, setRetestSlCsv] = useState<string>(String(defaults.retestSlR));
  const [trailEnabled, setTrailEnabled] = useState<boolean[]>([defaults.trailEnabled]);
  const [trailActCsv, setTrailActCsv] = useState<string>(String(defaults.trailActivateR));
  const [trailStepCsv, setTrailStepCsv] = useState<string>(String(defaults.trailStepR));
  const [feeCsv, setFeeCsv] = useState<string>(String(defaults.feeUsdPerOrder));
  const [zoneSources, setZoneSources] = useState<Array<"range" | "breakout">>([defaults.zoneSource]);
  const [dataSources, setDataSources] = useState<Array<"shark" | "yahoo">>([defaults.dataSource]);
  const [maxCombos, setMaxCombos] = useState<number>(100);

  const toggle = <T extends string | number | boolean>(list: T[], v: T, setter: (n: T[]) => void) => {
    const has = list.some((x) => String(x) === String(v));
    setter(has ? list.filter((x) => String(x) !== String(v)) : [...list, v]);
  };

  const axes = useMemo(() => ({
    session: parseStrs(sessionCsv),
    sl: parseNums(slCsv),
    rr: parseNums(rrCsv),
    entryModes,
    entryDepth: parseNums(entryDepthCsv),
    slDepth: parseNums(slDepthCsv),
    retestSl: parseNums(retestSlCsv),
    trailEnabled,
    trailAct: parseNums(trailActCsv),
    trailStep: parseNums(trailStepCsv),
    fee: parseNums(feeCsv),
    zoneSources,
    dataSources,
  }), [sessionCsv, slCsv, rrCsv, entryModes, entryDepthCsv, slDepthCsv,
       retestSlCsv, trailEnabled, trailActCsv, trailStepCsv, feeCsv,
       zoneSources, dataSources]);

  const comboCount = useMemo(() => {
    const dims = [
      axes.session.length, axes.sl.length, axes.rr.length,
      axes.entryModes.length, axes.entryDepth.length, axes.slDepth.length,
      axes.retestSl.length, axes.trailEnabled.length, axes.trailAct.length,
      axes.trailStep.length, axes.fee.length, axes.zoneSources.length,
      axes.dataSources.length,
    ];
    if (dims.some((d) => d === 0)) return 0;
    return dims.reduce((a, b) => a * b, 1);
  }, [axes]);

  const mut = useMutation({
    mutationFn: async () => {
      return run({
        data: {
          symbol: defaults.symbol,
          days: defaults.days,
          skip_weekdays: defaults.skipWeekdays,
          session_start_ist: axes.session,
          sl_risk_usd: axes.sl,
          rr: axes.rr,
          entry_mode: axes.entryModes,
          entry_depth_pct: axes.entryDepth,
          sl_depth_pct: axes.slDepth,
          retest_sl_r: axes.retestSl,
          trail_enabled: axes.trailEnabled,
          trail_activate_r: axes.trailAct,
          trail_step_r: axes.trailStep,
          fee_usd_per_order: axes.fee,
          zone_source: axes.zoneSources,
          data_source: axes.dataSources,
          max_combos: maxCombos,
        },
      });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Grid sweep failed"),
  });

  const [sortKey, setSortKey] = useState<SortKey>("net_pnl_usd");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const sorted = useMemo(() => {
    const rows = mut.data?.rows ?? [];
    return [...rows].sort((a, b) => {
      const av = (a[sortKey] as number) ?? 0;
      const bv = (b[sortKey] as number) ?? 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [mut.data, sortKey, sortDir]);

  const setSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  const exportCsv = () => {
    if (!mut.data) return;
    const cols: (keyof Row)[] = [
      "idx", "session_start_ist", "sl_risk_usd", "rr", "entry_mode",
      "entry_depth_pct", "sl_depth_pct", "retest_sl_r", "trail_enabled",
      "trail_activate_r", "trail_step_r", "fee_usd_per_order",
      "zone_source", "data_source", "trades", "wins", "losses", "open",
      "win_rate_pct", "total_pnl_usd", "net_pnl_usd", "avg_r",
      "profit_factor", "expectancy_usd", "max_drawdown_usd",
      "max_consec_losses", "fill_rate_pct", "est_fees_usd", "error",
    ];
    const header = cols.join(",");
    const lines = sorted.map((r) =>
      cols.map((c) => {
        const v = r[c as keyof Row];
        if (v === undefined || v === null) return "";
        const s = String(v);
        return s.includes(",") ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","),
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grid-sweep-${defaults.symbol}-${defaults.days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sessionOptions = [
    "00:30","02:30","05:30","06:30","12:30","13:30","14:30",
    "15:30","17:30","18:30","19:30","20:30","21:30","22:30",
  ];
  const rrOptions = [1, 1.5, 2, 2.5, 3, 3.5, 4];
  const slOptions = [10, 20, 30, 50, 75, 100];
  const entryModeOptions: Array<"fib" | "retest" | "market" | "adaptive"> = ["fib", "retest", "market", "adaptive"];
  const zoneOptions: Array<"range" | "breakout"> = ["range", "breakout"];
  const dataOptions: Array<"shark" | "yahoo"> = ["shark", "yahoo"];

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-sm font-semibold">Parameter grid sweep</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Pick one or more values per axis; the engine runs every combination and returns
          P&amp;L / win-rate / R / PF for each. Uses fixed <b>symbol</b>, <b>days</b>,
          and <b>skip-weekdays</b> from the Parameters panel above.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Session start (IST)</Label>
            <Chips values={sessionOptions} selected={parseStrs(sessionCsv)}
              onToggle={(v) => setSessionCsv(parseStrs(sessionCsv).some((x) => x === v)
                ? parseStrs(sessionCsv).filter((x) => x !== v).join(",")
                : [...parseStrs(sessionCsv), v].join(","))} />
            <Input value={sessionCsv} onChange={(e) => setSessionCsv(e.target.value)} className="h-8 font-mono text-xs" placeholder="02:30,13:30" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">SL risk ($/trade)</Label>
            <Chips values={slOptions} selected={parseNums(slCsv)}
              onToggle={(v) => toggle(parseNums(slCsv), v, (n) => setSlCsv(n.join(",")))} />
            <Input value={slCsv} onChange={(e) => setSlCsv(e.target.value)} className="h-8 font-mono text-xs" placeholder="20,30,50" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">RR (1:X)</Label>
            <Chips values={rrOptions} selected={parseNums(rrCsv)}
              onToggle={(v) => toggle(parseNums(rrCsv), v, (n) => setRrCsv(n.join(",")))} />
            <Input value={rrCsv} onChange={(e) => setRrCsv(e.target.value)} className="h-8 font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Entry mode</Label>
            <Chips values={entryModeOptions} selected={entryModes}
              onToggle={(v) => toggle(entryModes, v, setEntryModes)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Entry depth %</Label>
            <Chips values={[0.1, 0.15, 0.2, 0.3, 0.4]} selected={parseNums(entryDepthCsv)}
              onToggle={(v) => toggle(parseNums(entryDepthCsv), v, (n) => setEntryDepthCsv(n.join(",")))} />
            <Input value={entryDepthCsv} onChange={(e) => setEntryDepthCsv(e.target.value)} className="h-8 font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">SL depth %</Label>
            <Chips values={[0.3, 0.5, 0.6, 0.8, 1]} selected={parseNums(slDepthCsv)}
              onToggle={(v) => toggle(parseNums(slDepthCsv), v, (n) => setSlDepthCsv(n.join(",")))} />
            <Input value={slDepthCsv} onChange={(e) => setSlDepthCsv(e.target.value)} className="h-8 font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Retest SL (R)</Label>
            <Chips values={[0.3, 0.5, 0.7, 1]} selected={parseNums(retestSlCsv)}
              onToggle={(v) => toggle(parseNums(retestSlCsv), v, (n) => setRetestSlCsv(n.join(",")))} />
            <Input value={retestSlCsv} onChange={(e) => setRetestSlCsv(e.target.value)} className="h-8 font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Trailing SL</Label>
            <Chips values={[true, false]} selected={trailEnabled}
              onToggle={(v) => toggle(trailEnabled, v, setTrailEnabled)}
              format={(v) => (v ? "on" : "off")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Trail activate (R)</Label>
            <Chips values={[1, 1.5, 2, 2.5, 3]} selected={parseNums(trailActCsv)}
              onToggle={(v) => toggle(parseNums(trailActCsv), v, (n) => setTrailActCsv(n.join(",")))} />
            <Input value={trailActCsv} onChange={(e) => setTrailActCsv(e.target.value)} className="h-8 font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Trail step (R)</Label>
            <Chips values={[0.25, 0.5, 0.75, 1]} selected={parseNums(trailStepCsv)}
              onToggle={(v) => toggle(parseNums(trailStepCsv), v, (n) => setTrailStepCsv(n.join(",")))} />
            <Input value={trailStepCsv} onChange={(e) => setTrailStepCsv(e.target.value)} className="h-8 font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Fee ($/order)</Label>
            <Chips values={[0, 2, 4, 8]} selected={parseNums(feeCsv)}
              onToggle={(v) => toggle(parseNums(feeCsv), v, (n) => setFeeCsv(n.join(",")))} />
            <Input value={feeCsv} onChange={(e) => setFeeCsv(e.target.value)} className="h-8 font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Fib zone source</Label>
            <Chips values={zoneOptions} selected={zoneSources}
              onToggle={(v) => toggle(zoneSources, v, setZoneSources)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Data source</Label>
            <Chips values={dataOptions} selected={dataSources}
              onToggle={(v) => toggle(dataSources, v, setDataSources)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Max combos (cap)</Label>
            <Input type="number" min={1} max={300} value={maxCombos}
              onChange={(e) => setMaxCombos(Math.max(1, Math.min(300, Number(e.target.value) || 1)))}
              className="h-8 font-mono text-xs" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="text-[11px] text-muted-foreground">
            <span className="font-mono text-foreground">{comboCount.toLocaleString()}</span> combinations
            {comboCount > maxCombos && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                (capped at {maxCombos})
              </span>
            )}
            {mut.data && (
              <span className="ml-3">
                · ran <span className="font-mono text-foreground">{mut.data.total_combos}</span> in{" "}
                <span className="font-mono text-foreground">{(mut.data.elapsed_ms / 1000).toFixed(1)}s</span>
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {mut.data && (
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => mut.mutate()}
              disabled={mut.isPending || comboCount === 0}
            >
              {mut.isPending ? "Running…" : `Run grid — ${Math.min(comboCount, maxCombos)} combos`}
            </Button>
          </div>
        </div>

        {mut.data && sorted.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-[11px] font-mono">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr className="text-left">
                  <Th onClick={() => setSort("idx")} active={sortKey === "idx"} dir={sortDir}>#</Th>
                  <th className="px-2 py-1.5">Session</th>
                  <th className="px-2 py-1.5">SL$</th>
                  <th className="px-2 py-1.5">RR</th>
                  <th className="px-2 py-1.5">Entry</th>
                  <th className="px-2 py-1.5">E-depth</th>
                  <th className="px-2 py-1.5">SL-depth</th>
                  <th className="px-2 py-1.5">Trail</th>
                  <th className="px-2 py-1.5">Fee</th>
                  <th className="px-2 py-1.5">Zone</th>
                  <th className="px-2 py-1.5">Data</th>
                  <Th onClick={() => setSort("trades")} active={sortKey === "trades"} dir={sortDir}>Trades</Th>
                  <Th onClick={() => setSort("win_rate_pct")} active={sortKey === "win_rate_pct"} dir={sortDir}>Win%</Th>
                  <Th onClick={() => setSort("avg_r")} active={sortKey === "avg_r"} dir={sortDir}>Avg R</Th>
                  <Th onClick={() => setSort("profit_factor")} active={sortKey === "profit_factor"} dir={sortDir}>PF</Th>
                  <Th onClick={() => setSort("expectancy_usd")} active={sortKey === "expectancy_usd"} dir={sortDir}>Exp$</Th>
                  <Th onClick={() => setSort("max_drawdown_usd")} active={sortKey === "max_drawdown_usd"} dir={sortDir}>MaxDD</Th>
                  <Th onClick={() => setSort("fill_rate_pct")} active={sortKey === "fill_rate_pct"} dir={sortDir}>Fill%</Th>
                  <Th onClick={() => setSort("net_pnl_usd")} active={sortKey === "net_pnl_usd"} dir={sortDir}>Net P&amp;L</Th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.idx} className="border-t hover:bg-muted/30">
                    <td className="px-2 py-1.5 text-muted-foreground">{r.idx + 1}</td>
                    <td className="px-2 py-1.5">{r.session_start_ist.slice(0, 5)}</td>
                    <td className="px-2 py-1.5">{r.sl_risk_usd}</td>
                    <td className="px-2 py-1.5">1:{r.rr}</td>
                    <td className="px-2 py-1.5">{r.entry_mode}</td>
                    <td className="px-2 py-1.5">{r.entry_depth_pct}</td>
                    <td className="px-2 py-1.5">{r.sl_depth_pct}</td>
                    <td className="px-2 py-1.5">
                      {r.trail_enabled ? `${r.trail_activate_r}/${r.trail_step_r}` : "—"}
                    </td>
                    <td className="px-2 py-1.5">{r.fee_usd_per_order}</td>
                    <td className="px-2 py-1.5">{r.zone_source}</td>
                    <td className="px-2 py-1.5">{r.data_source}</td>
                    <td className="px-2 py-1.5">{r.trades}</td>
                    <td className="px-2 py-1.5">{r.win_rate_pct.toFixed(1)}</td>
                    <td className="px-2 py-1.5">{r.avg_r.toFixed(2)}</td>
                    <td className="px-2 py-1.5">
                      {r.profit_factor >= 999 ? "∞" : r.profit_factor.toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5">{r.expectancy_usd.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-red-600 dark:text-red-400">
                      {r.max_drawdown_usd.toFixed(0)}
                    </td>
                    <td className="px-2 py-1.5">{r.fill_rate_pct.toFixed(0)}</td>
                    <td className={`px-2 py-1.5 font-semibold ${
                      r.net_pnl_usd > 0 ? "text-emerald-600 dark:text-emerald-400"
                        : r.net_pnl_usd < 0 ? "text-red-600 dark:text-red-400"
                        : ""
                    }`}>
                      {r.net_pnl_usd >= 0 ? "+" : ""}{r.net_pnl_usd.toFixed(2)}
                      {r.error && <span title={r.error} className="ml-1 text-amber-500">⚠</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Th({ children, onClick, active, dir }: {
  children: React.ReactNode; onClick: () => void; active: boolean; dir: "asc" | "desc";
}) {
  return (
    <th className="px-2 py-1.5">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase tracking-wider text-[10px] ${
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {children}
        <ArrowUpDown className="h-3 w-3" />
        {active && <span className="text-[9px]">{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
