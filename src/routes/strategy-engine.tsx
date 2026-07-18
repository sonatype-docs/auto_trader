import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, Cpu, Loader2 } from "lucide-react";
import { runUniversalStrategy, type RunStrategyResult } from "@/lib/strategy-engine.functions";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";
import { TIMEFRAMES, TIMEZONES, type Timeframe, type Timezone } from "@/lib/market-data/types";
import { MatrixGroup } from "@/components/matrix-picker";

export const Route = createFileRoute("/strategy-engine")({
  head: () => ({
    meta: [
      { title: "Universal Strategy Engine — Modular Signal Generator" },
      {
        name: "description",
        content:
          "Strategy-agnostic engine: session/trend/volatility filters, setup detection, confirmation, entry/stop/target planners, invalidation and event stream — no execution, only signals.",
      },
      { property: "og:title", content: "Universal Strategy Engine" },
      { property: "og:description", content: "Modular building blocks that run any trading strategy from a config object." },
    ],
  }),
  component: StrategyEnginePage,
});

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
}

function StrategyEnginePage() {
  const now = Date.now();
  const [preset, setPreset] = useState<string>("london_orb");
  const [source, setSource] = useState<"yahoo" | "shark">("yahoo");
  const [symbol, setSymbol] = useState("XAUUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [displayTz, setDisplayTz] = useState<Timezone>("IST");
  const [strategyTz, setStrategyTz] = useState<Timezone>("London");
  const [days, setDays] = useState(30);
  const [mode, setMode] = useState<"historical" | "live" | "replay" | "paper">("historical");

  const runner = useServerFn(runUniversalStrategy);
  const mut = useMutation<RunStrategyResult>({
    mutationFn: async () => {
      const toMs = now;
      const fromMs = toMs - days * 86_400_000;
      return await runner({
        data: {
          source, symbol, timeframe,
          displayTimezone: displayTz, strategyTimezone: strategyTz,
          fromMs, toMs, presetId: preset, mode,
        },
      });
    },
  });

  const ALL_TFS: Timeframe[] = ["1m", "3m", "5m", "15m", "30m", "1h"];
  const ALL_PRESETS = Object.keys(STRATEGY_PRESETS);
  const ALL_SYMBOLS = ["XAUUSDT", "BTCUSDT"];
  const ALL_SOURCES: Array<"yahoo" | "shark"> = ["yahoo", "shark"];
  const ALL_MODES = ["historical", "live", "replay", "paper"] as const;
  const [mxSources, setMxSources] = useState<string[]>([source]);
  const [mxSymbols, setMxSymbols] = useState<string[]>(ALL_SYMBOLS);
  const [mxTfs, setMxTfs] = useState<string[]>(ALL_TFS);
  const [mxPresets, setMxPresets] = useState<string[]>(ALL_PRESETS);
  const [mxStratTzs, setMxStratTzs] = useState<string[]>([strategyTz]);
  const [mxDisplayTzs, setMxDisplayTzs] = useState<string[]>([displayTz]);
  const [mxModes, setMxModes] = useState<string[]>([mode]);
  type BatchRow = { source: string; symbol: string; presetId: string; tf: Timeframe; stratTz: string; displayTz: string; mode: string; result?: RunStrategyResult["result"]; error?: string };
  const [batchResults, setBatchResults] = useState<BatchRow[]>([]);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const batch = useMutation({
    mutationFn: async () => {
      const combos: { source: string; symbol: string; presetId: string; tf: Timeframe; stratTz: string; displayTz: string; mode: string }[] = [];
      for (const src of mxSources) for (const s of mxSymbols) for (const p of mxPresets) for (const tf of mxTfs) for (const tz of mxStratTzs) for (const dtz of mxDisplayTzs) for (const md of mxModes)
        combos.push({ source: src, symbol: s, presetId: p, tf: tf as Timeframe, stratTz: tz, displayTz: dtz, mode: md });
      setBatchResults([]);
      setBatchProgress({ done: 0, total: combos.length });
      const toMs = now;
      const fromMs = toMs - days * 86_400_000;
      const rows: BatchRow[] = [];
      for (const c of combos) {
        try {
          const res = await runner({
            data: {
              source: c.source as "yahoo" | "shark", symbol: c.symbol, timeframe: c.tf,
              displayTimezone: c.displayTz as Timezone, strategyTimezone: c.stratTz as Timezone,
              fromMs, toMs, presetId: c.presetId, mode: c.mode as typeof mode,
            },
          });
          rows.push({ source: c.source, symbol: c.symbol, presetId: c.presetId, tf: c.tf, stratTz: c.stratTz, displayTz: c.displayTz, mode: c.mode, result: res.result });
        } catch (e) {
          rows.push({ source: c.source, symbol: c.symbol, presetId: c.presetId, tf: c.tf, stratTz: c.stratTz, displayTz: c.displayTz, mode: c.mode, error: (e as Error).message });
        }
        setBatchResults([...rows]);
        setBatchProgress((p) => ({ ...p, done: p.done + 1 }));
      }
      return rows;
    },
  });

  const r = mut.data?.result;
  const rejects = useMemo(
    () => r ? Object.entries(r.stats.filterRejects).sort((a, b) => b[1] - a[1]) : [],
    [r],
  );

  const presetCfg = STRATEGY_PRESETS[preset];

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-16 z-20 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
              <Cpu className="w-4 h-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Platform</div>
              <h1 className="font-display text-sm font-semibold tracking-tight truncate">Universal Strategy Engine</h1>
            </div>
          </div>
          <Badge variant="outline" className="uppercase text-[9px] tracking-widest">Signal-only</Badge>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Run Configuration</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Field label="Strategy preset">
              <Select value={preset} onValueChange={setPreset}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STRATEGY_PRESETS).map(([id, c]) => (
                    <SelectItem key={id} value={id}>{c.strategyName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Source">
              <Select value={source} onValueChange={(v) => setSource(v as "yahoo" | "shark")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yahoo">Yahoo Finance (GC=F)</SelectItem>
                  <SelectItem value="shark">SharkExchange (XAUUSDT)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Symbol">
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="XAUUSDT">XAUUSDT</SelectItem>
                  <SelectItem value="BTCUSDT">BTCUSDT</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Timeframe">
              <Select value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEFRAMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Lookback (days)">
              <Input type="number" min={1} max={1000} value={days} onChange={(e) => setDays(Number(e.target.value) || 1)} />
            </Field>
            <Field label="Display TZ">
              <Select value={displayTz} onValueChange={(v) => setDisplayTz(v as Timezone)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Strategy TZ">
              <Select value={strategyTz} onValueChange={(v) => setStrategyTz(v as Timezone)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Mode">
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="historical">Historical</SelectItem>
                  <SelectItem value="live">Live</SelectItem>
                  <SelectItem value="replay">Replay</SelectItem>
                  <SelectItem value="paper">Paper</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="md:col-span-4 flex flex-wrap items-end gap-2">
              <Button onClick={() => mut.mutate()} disabled={mut.isPending || batch.isPending}>
                {mut.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running</> : <><Activity className="w-4 h-4 mr-2" />Run engine</>}
              </Button>
              <div className="w-full grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <MatrixGroup title="Sources"
                  options={ALL_SOURCES.map((v) => ({ value: v }))}
                  selected={mxSources} onChange={setMxSources} />
                <MatrixGroup title="Symbols"
                  options={ALL_SYMBOLS.map((v) => ({ value: v }))}
                  selected={mxSymbols} onChange={setMxSymbols} />
                <MatrixGroup title="Timeframes"
                  options={ALL_TFS.map((v) => ({ value: v }))}
                  selected={mxTfs} onChange={setMxTfs} />
                <MatrixGroup title="Strategy presets"
                  options={ALL_PRESETS.map((v) => ({ value: v, label: STRATEGY_PRESETS[v]?.strategyName ?? v }))}
                  selected={mxPresets} onChange={setMxPresets} />
                <MatrixGroup title="Strategy TZ"
                  options={TIMEZONES.map((v) => ({ value: v }))}
                  selected={mxStratTzs} onChange={setMxStratTzs} />
                <MatrixGroup title="Display TZ"
                  options={TIMEZONES.map((v) => ({ value: v }))}
                  selected={mxDisplayTzs} onChange={setMxDisplayTzs} />
                <MatrixGroup title="Modes"
                  options={ALL_MODES.map((v) => ({ value: v }))}
                  selected={mxModes} onChange={setMxModes} />
              </div>
              <Button
                variant="secondary"
                onClick={() => batch.mutate()}
                disabled={mut.isPending || batch.isPending || mxSources.length === 0 || mxSymbols.length === 0 || mxTfs.length === 0 || mxPresets.length === 0 || mxStratTzs.length === 0 || mxDisplayTzs.length === 0 || mxModes.length === 0}
              >
                {batch.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running matrix {batchProgress.done}/{batchProgress.total}</>
                  : <><Activity className="w-4 h-4 mr-2" />Run Matrix ({mxSources.length}×{mxSymbols.length}×{mxPresets.length}×{mxTfs.length}×{mxStratTzs.length}×{mxDisplayTzs.length}×{mxModes.length} = {mxSources.length * mxSymbols.length * mxPresets.length * mxTfs.length * mxStratTzs.length * mxDisplayTzs.length * mxModes.length})</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        {batchResults.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Batch Matrix Results</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1 pr-3">Source</th>
                    <th className="py-1 pr-3">Symbol</th>
                    <th className="py-1 pr-3">Preset</th>
                    <th className="py-1 pr-3">TF</th>
                    <th className="py-1 pr-3">Strat TZ</th>
                    <th className="py-1 pr-3">Disp TZ</th>
                    <th className="py-1 pr-3">Mode</th>
                    <th className="py-1 pr-3">Bars</th>
                    <th className="py-1 pr-3">Setups</th>
                    <th className="py-1 pr-3">Signals</th>
                    <th className="py-1 pr-3">Invalidated</th>
                    <th className="py-1 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {batchResults.map((b, i) => (
                    <tr key={i} className="border-t border-border/40">
                      <td className="py-1 pr-3">{b.source}</td>
                      <td className="py-1 pr-3">{b.symbol}</td>
                      <td className="py-1 pr-3">{STRATEGY_PRESETS[b.presetId]?.strategyName ?? b.presetId}</td>
                      <td className="py-1 pr-3">{b.tf}</td>
                      <td className="py-1 pr-3">{b.stratTz}</td>
                      <td className="py-1 pr-3">{b.displayTz}</td>
                      <td className="py-1 pr-3">{b.mode}</td>
                      <td className="py-1 pr-3">{b.result?.stats.barsProcessed.toLocaleString() ?? "—"}</td>
                      <td className="py-1 pr-3">{b.result?.stats.setupsDetected.toLocaleString() ?? "—"}</td>
                      <td className="py-1 pr-3">{b.result?.stats.signalsCreated.toLocaleString() ?? "—"}</td>
                      <td className="py-1 pr-3">{b.result?.stats.signalsInvalidated.toLocaleString() ?? "—"}</td>
                      <td className="py-1 pr-3">
                        {b.error
                          ? <span className="text-destructive">{b.error}</span>
                          : <span className="text-emerald-500">ok</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {presetCfg && (
          <Card>
            <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Loaded Configuration</CardTitle></CardHeader>
            <CardContent>
              <pre className="text-xs font-mono bg-muted/40 rounded-md p-3 overflow-x-auto">{JSON.stringify(presetCfg, null, 2)}</pre>
            </CardContent>
          </Card>
        )}

        {mut.isError && (
          <Card className="border-destructive/60">
            <CardContent className="py-4 text-sm text-destructive">{(mut.error as Error).message}</CardContent>
          </Card>
        )}

        {r && (
          <>
            <div className="grid gap-3 md:grid-cols-5">
              <Stat label="Bars processed" value={r.stats.barsProcessed.toLocaleString()} />
              <Stat label="Setups detected" value={r.stats.setupsDetected.toLocaleString()} />
              <Stat label="Signals created" value={r.stats.signalsCreated.toLocaleString()} />
              <Stat label="Signals invalidated" value={r.stats.signalsInvalidated.toLocaleString()} />
              <Stat label="Events" value={r.events.length.toLocaleString()} />
            </div>

            <Tabs defaultValue="signals">
              <TabsList>
                <TabsTrigger value="signals">Signals</TabsTrigger>
                <TabsTrigger value="rejects">Filter Rejects</TabsTrigger>
                <TabsTrigger value="events">Event Stream</TabsTrigger>
                <TabsTrigger value="invalidated">Invalidated</TabsTrigger>
                <TabsTrigger value="raw">Raw JSON</TabsTrigger>
              </TabsList>

              <TabsContent value="signals" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Signals ({r.signals.length})</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-1 pr-3">Time</th>
                          <th className="py-1 pr-3">Type</th>
                          <th className="py-1 pr-3">Dir</th>
                          <th className="py-1 pr-3">Entry</th>
                          <th className="py-1 pr-3">SL</th>
                          <th className="py-1 pr-3">TP</th>
                          <th className="py-1 pr-3">RR</th>
                          <th className="py-1 pr-3">Strength</th>
                          <th className="py-1 pr-3">Setup</th>
                          <th className="py-1 pr-3">Passed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.signals.map((s) => (
                          <tr key={s.signalId} className="border-t border-border/40">
                            <td className="py-1 pr-3">{new Date(s.timestamp).toISOString().slice(0, 16).replace("T", " ")}</td>
                            <td className="py-1 pr-3"><Badge variant="outline" className="text-[9px]">{s.type}</Badge></td>
                            <td className="py-1 pr-3">{s.direction}</td>
                            <td className="py-1 pr-3">{fmt(s.entryPrice)}</td>
                            <td className="py-1 pr-3">{fmt(s.stopLoss)}</td>
                            <td className="py-1 pr-3">{fmt(s.takeProfit)}</td>
                            <td className="py-1 pr-3">{fmt(s.rr, 2)}</td>
                            <td className="py-1 pr-3">
                              <div className="flex items-center gap-1.5">
                                <div className="w-16 h-1 bg-muted rounded overflow-hidden">
                                  <div className="h-full bg-primary" style={{ width: `${s.signalStrength}%` }} />
                                </div>
                                <span>{s.signalStrength}</span>
                              </div>
                            </td>
                            <td className="py-1 pr-3 text-muted-foreground">{s.setupType}</td>
                            <td className="py-1 pr-3 text-muted-foreground">{s.confirmationType.join(",")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="rejects" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Filter rejections</CardTitle></CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground text-xs">
                        <tr className="text-left"><th className="py-1">Filter</th><th className="py-1">Count</th></tr>
                      </thead>
                      <tbody>
                        {rejects.map(([k, v]) => (
                          <tr key={k} className="border-t border-border/40">
                            <td className="py-1 font-mono">{k}</td>
                            <td className="py-1 font-mono">{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="events" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Last {r.events.length} events</CardTitle></CardHeader>
                  <CardContent className="max-h-[500px] overflow-y-auto">
                    <table className="w-full text-xs font-mono">
                      <thead className="text-muted-foreground sticky top-0 bg-background">
                        <tr className="text-left"><th className="py-1 pr-3">TS</th><th className="py-1 pr-3">Name</th><th className="py-1 pr-3">Data</th></tr>
                      </thead>
                      <tbody>
                        {r.events.slice(-200).reverse().map((e, k) => (
                          <tr key={k} className="border-t border-border/40">
                            <td className="py-1 pr-3">{new Date(e.ts).toISOString().slice(11, 19)}</td>
                            <td className="py-1 pr-3">{e.name}</td>
                            <td className="py-1 pr-3 text-muted-foreground truncate max-w-md">{JSON.stringify(e.data)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="invalidated" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Invalidated pending signals</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-1 pr-3">Time</th><th className="py-1 pr-3">Dir</th>
                          <th className="py-1 pr-3">Entry</th><th className="py-1 pr-3">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.invalidated.map((s) => (
                          <tr key={s.signalId} className="border-t border-border/40">
                            <td className="py-1 pr-3">{new Date(s.timestamp).toISOString().slice(0, 16).replace("T", " ")}</td>
                            <td className="py-1 pr-3">{s.direction}</td>
                            <td className="py-1 pr-3">{fmt(s.entryPrice)}</td>
                            <td className="py-1 pr-3 text-destructive">{s.invalidationReason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="raw" className="mt-4">
                <Card>
                  <CardContent className="py-3">
                    <pre className="text-xs font-mono bg-muted/40 rounded-md p-3 overflow-x-auto max-h-[500px]">
                      {JSON.stringify(r.signals.slice(0, 5), null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
        <div className="font-display text-lg font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
