// Dedicated backtest + analysis page for the PDH/PDL Sweep → 1m Trigger strategy.
// One-page runner: controls, KPIs, equity curve, per-trade log, cancelled orders,
// events, risk blocks, and direction/attempt breakdowns.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Activity, Target, Loader2 } from "lucide-react";
import { runExecutionEngine, type RunExecutionResult } from "@/lib/execution-engine.functions";
import { EXEC_PRESETS, DEFAULT_RISK_USD_PER_TRADE } from "@/lib/execution-engine/presets";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";
import type { Timeframe, Timezone } from "@/lib/market-data/types";

const PRESET_ID = "pdh_pdl_sweep_1m";

export const Route = createFileRoute("/backtest/pdh-pdl-sweep")({
  head: () => ({
    meta: [
      { title: "PDH/PDL Sweep — Runner & Backtest Analysis" },
      { name: "description", content: "Prev-day high/low liquidity sweep with 1m green/red confirmation candle triggers. Runner, backtest, and analytics on one page." },
      { property: "og:title", content: "PDH/PDL Sweep — Runner & Backtest Analysis" },
      { property: "og:description", content: "PDH/PDL sweep with 1m trigger candle: 5R + runner to opposite liquidity. 3 attempts per sweep." },
    ],
  }),
  component: PdhPdlSweepPage,
});

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
}
function fmtMoney(n: number) { return `${n < 0 ? "-" : ""}$${fmt(Math.abs(n))}`; }
function toIso(ts: number) { return new Date(ts).toISOString().slice(0, 16).replace("T", " "); }

function PdhPdlSweepPage() {
  const cfg = STRATEGY_PRESETS[PRESET_ID];
  const [source, setSource] = useState<"yahoo" | "shark">("shark");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [days, setDays] = useState(14);
  const [execPresetId, setExecPresetId] = useState<string>("no_management");
  const [riskUsd, setRiskUsd] = useState<number>(DEFAULT_RISK_USD_PER_TRADE);
  const [displayTz] = useState<Timezone>("IST");
  const [strategyTz, setStrategyTz] = useState<Timezone>("UTC");

  const runner = useServerFn(runExecutionEngine);
  const mut = useMutation<RunExecutionResult>({
    mutationFn: async () => {
      const toMs = Date.now();
      const fromMs = toMs - days * 86_400_000;
      return await runner({
        data: {
          source, symbol, timeframe,
          displayTimezone: displayTz, strategyTimezone: strategyTz,
          fromMs, toMs,
          strategyPresetId: PRESET_ID,
          execPresetId,
          mode: "historical",
          riskUsdOverride: riskUsd,
        },
      });
    },
  });

  const r = mut.data?.result;
  const winRate = useMemo(() => {
    if (!r || r.stats.tradesClosed === 0) return 0;
    return (r.stats.winners / r.stats.tradesClosed) * 100;
  }, [r]);

  const dirBreakdown = useMemo(() => {
    if (!r) return { long: { count: 0, net: 0, wins: 0 }, short: { count: 0, net: 0, wins: 0 } };
    const out = { long: { count: 0, net: 0, wins: 0 }, short: { count: 0, net: 0, wins: 0 } };
    for (const t of r.trades) {
      const b = out[t.direction];
      b.count++; b.net += t.netPnL; if (t.netPnL > 0) b.wins++;
    }
    return out;
  }, [r]);

  const attemptBreakdown = useMemo(() => {
    if (!r) return [] as Array<{ attempt: number; count: number; net: number; wr: number }>;
    const map = new Map<number, { count: number; net: number; wins: number }>();
    for (const t of r.trades) {
      const a = Number(t.metadata?.attempt ?? 0) || 0;
      const cur = map.get(a) ?? { count: 0, net: 0, wins: 0 };
      cur.count++; cur.net += t.netPnL; if (t.netPnL > 0) cur.wins++;
      map.set(a, cur);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([attempt, v]) => ({
      attempt, count: v.count, net: v.net, wr: v.count ? (v.wins / v.count) * 100 : 0,
    }));
  }, [r]);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-14 z-20 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
              <Target className="w-4 h-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Backtest · Analysis</div>
              <h1 className="font-display text-sm font-semibold tracking-tight truncate">
                {cfg?.strategyName ?? "PDH/PDL Sweep"}
              </h1>
            </div>
          </div>
          <Link to="/">
            <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 md:mr-2" /> <span className="hidden sm:inline">Dashboard</span></Button>
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono tracking-widest">Strategy Rules</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground grid gap-2 md:grid-cols-2">
            <ul className="space-y-1 list-disc pl-4">
              <li>Mark previous daily candle High (PDH) and Low (PDL) in the strategy timezone.</li>
              <li>Long: 1m bar wicks below PDL, next 1m closes green → buy-stop above that green bar's high.</li>
              <li>Short: 1m bar wicks above PDH, next 1m closes red → sell-stop below that red bar's low.</li>
            </ul>
            <ul className="space-y-1 list-disc pl-4">
              <li>Stop-loss: swept extreme + 0.02% buffer.</li>
              <li>Targets: 50% off at 5R, remaining 50% stop moves to break-even and rides.</li>
              <li>Up to 3 attempts per armed sweep; then wait for a fresh sweep.</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Run Configuration</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Field label="Source">
              <Select value={source} onValueChange={(v) => setSource(v as "yahoo" | "shark")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="shark">SharkExchange</SelectItem>
                  <SelectItem value="yahoo">Yahoo Finance (GC=F)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Symbol">
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BTCUSDT">BTCUSDT</SelectItem>
                  <SelectItem value="XAUUSDT">XAUUSDT</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Timeframe">
              <Select value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["1m", "3m", "5m", "15m"] as Timeframe[]).map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Lookback (days)">
              <Input type="number" min={1} value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field label="Execution preset">
              <Select value={execPresetId} onValueChange={setExecPresetId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(EXEC_PRESETS).map((id) => (
                    <SelectItem key={id} value={id}>{id.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Risk per trade (USD)">
              <Input type="number" min={1} step={1} value={riskUsd} onChange={(e) => setRiskUsd(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field label="Strategy TZ (PDH/PDL boundary)">
              <Select value={strategyTz} onValueChange={(v) => setStrategyTz(v as Timezone)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UTC">UTC</SelectItem>
                  <SelectItem value="London">London</SelectItem>
                  <SelectItem value="New_York">New York</SelectItem>
                  <SelectItem value="IST">IST</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="md:col-span-4">
              <Button onClick={() => mut.mutate()} disabled={mut.isPending} className="w-full md:w-auto">
                {mut.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Running backtest…</>
                  : <><Activity className="w-4 h-4 mr-2" /> Run backtest</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        {mut.isError && (
          <Card className="border-destructive/60">
            <CardContent className="py-4 text-sm text-destructive">{(mut.error as Error).message}</CardContent>
          </Card>
        )}

        {r && (
          <>
            <div className="grid gap-3 md:grid-cols-6">
              <Stat label="Signals" value={r.stats.signalsIn.toString()} />
              <Stat label="Orders filled" value={r.stats.ordersFilled.toString()} />
              <Stat label="Trades" value={r.stats.tradesClosed.toString()} />
              <Stat label="Win rate" value={`${fmt(winRate, 1)}%`} />
              <Stat label="Net PnL" value={fmtMoney(r.stats.netPnL)} tone={r.stats.netPnL >= 0 ? "pos" : "neg"} />
              <Stat label="Max DD" value={`${fmt(r.stats.maxDrawdownPct, 2)}%`} tone="neg" />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Direction breakdown</CardTitle></CardHeader>
                <CardContent>
                  <table className="w-full text-xs font-mono">
                    <thead className="text-muted-foreground">
                      <tr className="text-left">
                        <th className="py-1 pr-3">Side</th><th className="py-1 pr-3">Trades</th>
                        <th className="py-1 pr-3">Win%</th><th className="py-1 pr-3">Net PnL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(["long", "short"] as const).map((d) => {
                        const b = dirBreakdown[d];
                        const wr = b.count ? (b.wins / b.count) * 100 : 0;
                        return (
                          <tr key={d} className="border-t border-border/40">
                            <td className="py-1 pr-3"><Badge variant="outline" className="text-[9px]">{d}</Badge></td>
                            <td className="py-1 pr-3">{b.count}</td>
                            <td className="py-1 pr-3">{fmt(wr, 1)}%</td>
                            <td className={`py-1 pr-3 ${b.net >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmtMoney(b.net)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Per-attempt breakdown</CardTitle></CardHeader>
                <CardContent>
                  {attemptBreakdown.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No trades yet.</div>
                  ) : (
                    <table className="w-full text-xs font-mono">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-1 pr-3">Attempt</th><th className="py-1 pr-3">Trades</th>
                          <th className="py-1 pr-3">Win%</th><th className="py-1 pr-3">Net PnL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attemptBreakdown.map((row) => (
                          <tr key={row.attempt} className="border-t border-border/40">
                            <td className="py-1 pr-3">#{row.attempt}</td>
                            <td className="py-1 pr-3">{row.count}</td>
                            <td className="py-1 pr-3">{fmt(row.wr, 1)}%</td>
                            <td className={`py-1 pr-3 ${row.net >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmtMoney(row.net)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </div>

            <Tabs defaultValue="trades">
              <TabsList>
                <TabsTrigger value="trades">Trades ({r.trades.length})</TabsTrigger>
                <TabsTrigger value="equity">Equity curve</TabsTrigger>
                <TabsTrigger value="orders">Cancelled ({r.cancelledOrders.length})</TabsTrigger>
                <TabsTrigger value="events">Events</TabsTrigger>
                <TabsTrigger value="risk">Risk blocks</TabsTrigger>
              </TabsList>

              <TabsContent value="trades" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Trade log</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto max-h-[600px]">
                    <table className="w-full text-xs font-mono">
                      <thead className="text-muted-foreground sticky top-0 bg-background">
                        <tr className="text-left">
                          <th className="py-1 pr-3">Entry</th>
                          <th className="py-1 pr-3">Dir</th>
                          <th className="py-1 pr-3">Att</th>
                          <th className="py-1 pr-3">Fill</th>
                          <th className="py-1 pr-3">SL</th>
                          <th className="py-1 pr-3">TP</th>
                          <th className="py-1 pr-3">Exit</th>
                          <th className="py-1 pr-3">Reason</th>
                          <th className="py-1 pr-3">RR</th>
                          <th className="py-1 pr-3">Net</th>
                          <th className="py-1 pr-3">Hold</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.trades.map((t) => (
                          <tr key={t.tradeId} className="border-t border-border/40">
                            <td className="py-1 pr-3">{toIso(t.entryTime)}</td>
                            <td className="py-1 pr-3"><Badge variant="outline" className="text-[9px]">{t.direction}</Badge></td>
                            <td className="py-1 pr-3">{String(t.metadata?.attempt ?? "—")}</td>
                            <td className="py-1 pr-3">{fmt(t.fillPrice)}</td>
                            <td className="py-1 pr-3">{fmt(t.stopPrice)}</td>
                            <td className="py-1 pr-3">{fmt(t.targetPrice)}</td>
                            <td className="py-1 pr-3">{fmt(t.exitPrice)}</td>
                            <td className="py-1 pr-3 text-muted-foreground">{t.exitReason}</td>
                            <td className="py-1 pr-3">{fmt(t.rr, 2)}</td>
                            <td className={`py-1 pr-3 ${t.netPnL >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmtMoney(t.netPnL)}</td>
                            <td className="py-1 pr-3">{t.holdingTime}b</td>
                          </tr>
                        ))}
                        {r.trades.length === 0 && (
                          <tr><td colSpan={11} className="py-4 text-center text-muted-foreground">No trades in this range.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="equity" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Equity curve</CardTitle></CardHeader>
                  <CardContent>
                    <EquitySparkline points={r.equityCurve} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="orders" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Cancelled / Expired orders</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto max-h-[500px]">
                    <table className="w-full text-xs font-mono">
                      <thead className="text-muted-foreground sticky top-0 bg-background">
                        <tr className="text-left">
                          <th className="py-1 pr-3">Created</th><th className="py-1 pr-3">Side</th>
                          <th className="py-1 pr-3">Kind</th><th className="py-1 pr-3">Trigger</th>
                          <th className="py-1 pr-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.cancelledOrders.map((o) => (
                          <tr key={o.orderId} className="border-t border-border/40">
                            <td className="py-1 pr-3">{toIso(o.createdTs)}</td>
                            <td className="py-1 pr-3">{o.side}</td>
                            <td className="py-1 pr-3">{o.kind}</td>
                            <td className="py-1 pr-3">{fmt(o.triggerPrice)}</td>
                            <td className="py-1 pr-3"><Badge variant="outline" className="text-[9px]">{o.status}</Badge></td>
                          </tr>
                        ))}
                        {r.cancelledOrders.length === 0 && (
                          <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">No cancelled/expired orders.</td></tr>
                        )}
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

              <TabsContent value="risk" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm font-mono tracking-widest">Risk blocks</CardTitle></CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground text-xs">
                        <tr className="text-left"><th className="py-1">Reason</th><th className="py-1">Count</th></tr>
                      </thead>
                      <tbody>
                        {Object.entries(r.stats.riskBlocks).map(([k, v]) => (
                          <tr key={k} className="border-t border-border/40">
                            <td className="py-1 font-mono">{k}</td>
                            <td className="py-1 font-mono">{v}</td>
                          </tr>
                        ))}
                        {Object.keys(r.stats.riskBlocks).length === 0 && (
                          <tr><td className="py-2 text-muted-foreground text-xs" colSpan={2}>No risk blocks fired.</td></tr>
                        )}
                      </tbody>
                    </table>
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  const cls = tone === "pos" ? "text-emerald-500" : tone === "neg" ? "text-destructive" : "";
  return (
    <Card>
      <CardContent className="py-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
        <div className={`font-display text-lg font-semibold ${cls}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function EquitySparkline({ points }: { points: Array<{ ts: number; equity: number; drawdownPct: number }> }) {
  if (!points.length) return <div className="text-xs text-muted-foreground">No equity data.</div>;
  const w = 900, h = 200, pad = 8;
  const min = Math.min(...points.map((p) => p.equity));
  const max = Math.max(...points.map((p) => p.equity));
  const range = max - min || 1;
  const step = (w - pad * 2) / Math.max(1, points.length - 1);
  const path = points.map((p, i) => {
    const x = pad + i * step;
    const y = h - pad - ((p.equity - min) / range) * (h - pad * 2);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-48">
        <path d={path} stroke="currentColor" className="text-primary" strokeWidth={1.5} fill="none" />
      </svg>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-1">
        <span>{toIso(points[0].ts)} · {fmtMoney(points[0].equity)}</span>
        <span>{toIso(points[points.length - 1].ts)} · {fmtMoney(points[points.length - 1].equity)}</span>
      </div>
    </div>
  );
}
