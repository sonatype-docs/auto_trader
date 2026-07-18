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
import { Database, Activity, Loader2, Layers } from "lucide-react";
import { loadEnrichedCandles, type LoadEnrichedResult } from "@/lib/market-data.functions";
import { TIMEFRAMES, TIMEZONES, type Timeframe, type Timezone } from "@/lib/market-data/types";
import { MatrixGroup } from "@/components/matrix-picker";

export const Route = createFileRoute("/market-data")({
  head: () => ({
    meta: [
      { title: "Market Data Engine — Historical OHLC, Sessions, Structure, Liquidity" },
      {
        name: "description",
        content:
          "Reusable market data engine: multi-timeframe OHLC, timezone normalization, session classification, indicators, market structure and liquidity — the foundation for every strategy in the platform.",
      },
      { property: "og:title", content: "Market Data Engine" },
      {
        property: "og:description",
        content:
          "Load, validate and enrich historical candles with sessions, indicators, structure and liquidity for any strategy.",
      },
    ],
  }),
  component: MarketDataPage,
});

const SOURCES = [
  { id: "yahoo" as const, label: "Yahoo Finance (GC=F)" },
  { id: "shark" as const, label: "SharkExchange (XAUUSDT)" },
];

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function MarketDataPage() {
  const now = Date.now();
  const [source, setSource] = useState<"yahoo" | "shark">("yahoo");
  const [symbol, setSymbol] = useState("XAUUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [displayTz, setDisplayTz] = useState<Timezone>("IST");
  const [strategyTz, setStrategyTz] = useState<Timezone>("London");
  const [days, setDays] = useState(30);
  const [orMinutes, setOrMinutes] = useState(60);
  const [orStartHour, setOrStartHour] = useState(8);
  const [orStartMinute, setOrStartMinute] = useState(0);
  const [atrLen, setAtrLen] = useState(14);
  const [swingLookback, setSwingLookback] = useState(5);

  const fetcher = useServerFn(loadEnrichedCandles);
  const mut = useMutation<LoadEnrichedResult>({
    mutationFn: async () => {
      const toMs = now;
      const fromMs = toMs - days * 86_400_000;
      return await fetcher({
        data: {
          source, symbol, timeframe,
          displayTimezone: displayTz,
          strategyTimezone: strategyTz,
          fromMs, toMs,
          openingRangeMinutes: orMinutes,
          openingRangeStartHour: orStartHour,
          openingRangeStartMinute: orStartMinute,
          atrLen,
          swingLookback,
          customSessions: [],
          holidays: [],
          maxRows: 500,
        },
      });
    },
  });

  // Matrix: sources × symbols × timeframes × strategy TZs
  const [mxSources, setMxSources] = useState<string[]>(["shark"]);
  const [mxSymbols, setMxSymbols] = useState<string[]>(["XAUUSDT", "BTCUSDT"]);
  const [mxTfs, setMxTfs] = useState<string[]>(["1m", "5m", "15m", "1h"]);
  const [mxStratTzs, setMxStratTzs] = useState<string[]>([strategyTz]);
  const [mxDisplayTzs, setMxDisplayTzs] = useState<string[]>([displayTz]);
  type MxRow = {
    source: string; symbol: string; tf: string; stratTz: string; displayTz: string;
    bars?: number; avgAtr?: number | null; bos?: number; choch?: number; error?: string;
  };
  const [mxRows, setMxRows] = useState<MxRow[]>([]);
  const [mxProgress, setMxProgress] = useState({ done: 0, total: 0 });
  const matrix = useMutation({
    mutationFn: async () => {
      const toMs = Date.now();
      const fromMs = toMs - days * 86_400_000;
      const combos: { source: string; symbol: string; tf: string; stratTz: string; displayTz: string }[] = [];
      for (const src of mxSources) for (const s of mxSymbols) for (const t of mxTfs) for (const tz of mxStratTzs) for (const dtz of mxDisplayTzs)
        combos.push({ source: src, symbol: s, tf: t, stratTz: tz, displayTz: dtz });
      setMxRows([]);
      setMxProgress({ done: 0, total: combos.length });
      const rows: MxRow[] = [];
      for (const c of combos) {
        try {
          const res = await fetcher({
            data: {
              source: c.source as "yahoo" | "shark", symbol: c.symbol, timeframe: c.tf as Timeframe,
              displayTimezone: c.displayTz as Timezone, strategyTimezone: c.stratTz as Timezone,
              fromMs, toMs,
              openingRangeMinutes: orMinutes,
              openingRangeStartHour: orStartHour,
              openingRangeStartMinute: orStartMinute,
              atrLen, swingLookback,
              customSessions: [], holidays: [], maxRows: 500,
            },
          });
          rows.push({
            source: c.source, symbol: c.symbol, tf: c.tf, stratTz: c.stratTz, displayTz: c.displayTz,
            bars: res.count, avgAtr: res.summary.avgAtr,
            bos: res.summary.bosCount, choch: res.summary.chochCount,
          });
        } catch (e) {
          rows.push({ source: c.source, symbol: c.symbol, tf: c.tf, stratTz: c.stratTz, displayTz: c.displayTz, error: (e as Error).message });
        }
        setMxRows([...rows]);
        setMxProgress((p) => ({ ...p, done: p.done + 1 }));
        await new Promise((r) => setTimeout(r, 100));
      }
      return rows;
    },
  });

  const result = mut.data;

  const sessionRows = useMemo(() => {
    if (!result) return [];
    return Object.entries(result.summary.sessions).sort((a, b) => b[1] - a[1]);
  }, [result]);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-16 z-20 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
              <Database className="w-4 h-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Platform</div>
              <h1 className="font-display text-sm font-semibold tracking-tight truncate">Market Data Engine</h1>
            </div>
          </div>
          <Badge variant="outline" className="uppercase text-[9px] tracking-widest">Foundation</Badge>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono tracking-widest">Data Request</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Field label="Source">
              <Select value={source} onValueChange={(v) => setSource(v as "yahoo" | "shark")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
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
              <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value) || 1)} />
            </Field>

            <Field label="Display TZ">
              <Select value={displayTz} onValueChange={(v) => setDisplayTz(v as Timezone)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Strategy TZ">
              <Select value={strategyTz} onValueChange={(v) => setStrategyTz(v as Timezone)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="ATR length">
              <Input type="number" min={2} max={200} value={atrLen} onChange={(e) => setAtrLen(Number(e.target.value) || 14)} />
            </Field>
            <Field label="Swing lookback">
              <Input type="number" min={2} max={30} value={swingLookback} onChange={(e) => setSwingLookback(Number(e.target.value) || 5)} />
            </Field>

            <Field label="OR minutes">
              <Input type="number" min={5} max={240} value={orMinutes} onChange={(e) => setOrMinutes(Number(e.target.value) || 60)} />
            </Field>
            <Field label="OR start hour (Strategy TZ)">
              <Input type="number" min={0} max={23} value={orStartHour} onChange={(e) => setOrStartHour(Number(e.target.value) || 0)} />
            </Field>
            <Field label="OR start minute">
              <Input type="number" min={0} max={59} value={orStartMinute} onChange={(e) => setOrStartMinute(Number(e.target.value) || 0)} />
            </Field>
            <div className="flex items-end">
              <Button className="w-full" onClick={() => mut.mutate()} disabled={mut.isPending}>
                {mut.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading</> : <><Activity className="w-4 h-4 mr-2" />Load & enrich</>}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono tracking-widest">
              Matrix Loader — sources × symbols × timeframes × strategy TZs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MatrixGroup title="Sources"
                options={SOURCES.map((s) => ({ value: s.id, label: s.label }))}
                selected={mxSources} onChange={setMxSources} />
              <MatrixGroup title="Symbols"
                options={[{ value: "XAUUSDT" }, { value: "BTCUSDT" }]}
                selected={mxSymbols} onChange={setMxSymbols} />
              <MatrixGroup title="Timeframes"
                options={TIMEFRAMES.map((t) => ({ value: t }))}
                selected={mxTfs} onChange={setMxTfs} />
              <MatrixGroup title="Strategy TZ"
                options={TIMEZONES.map((t) => ({ value: t }))}
                selected={mxStratTzs} onChange={setMxStratTzs} />
              <MatrixGroup title="Display TZ"
                options={TIMEZONES.map((t) => ({ value: t }))}
                selected={mxDisplayTzs} onChange={setMxDisplayTzs} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary"
                onClick={() => matrix.mutate()}
                disabled={matrix.isPending || mxSources.length === 0 || mxSymbols.length === 0 || mxTfs.length === 0 || mxStratTzs.length === 0 || mxDisplayTzs.length === 0}>
                <Layers className="w-4 h-4 mr-2" />
                {matrix.isPending
                  ? `Loading matrix ${mxProgress.done}/${mxProgress.total}…`
                  : `Run Matrix (${mxSources.length}×${mxSymbols.length}×${mxTfs.length}×${mxStratTzs.length}×${mxDisplayTzs.length} = ${mxSources.length * mxSymbols.length * mxTfs.length * mxStratTzs.length * mxDisplayTzs.length})`}
              </Button>
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Lookback: {days}d
              </span>
            </div>
            {mxRows.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-border/60">
                <table className="w-full text-xs font-mono">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1 px-3">Source</th>
                      <th className="py-1 px-3">Symbol</th>
                      <th className="py-1 px-3">TF</th>
                      <th className="py-1 px-3">Strat TZ</th>
                      <th className="py-1 px-3">Disp TZ</th>
                      <th className="py-1 px-3 text-right">Bars</th>
                      <th className="py-1 px-3 text-right">Avg ATR</th>
                      <th className="py-1 px-3 text-right">BOS</th>
                      <th className="py-1 px-3 text-right">CHOCH</th>
                      <th className="py-1 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mxRows.map((r, i) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="py-1 px-3">{r.source}</td>
                        <td className="py-1 px-3">{r.symbol}</td>
                        <td className="py-1 px-3">{r.tf}</td>
                        <td className="py-1 px-3">{r.stratTz}</td>
                        <td className="py-1 px-3">{r.displayTz}</td>
                        <td className="py-1 px-3 text-right">{r.bars?.toLocaleString() ?? "—"}</td>
                        <td className="py-1 px-3 text-right">{fmtNum(r.avgAtr ?? null)}</td>
                        <td className="py-1 px-3 text-right">{r.bos ?? "—"}</td>
                        <td className="py-1 px-3 text-right">{r.choch ?? "—"}</td>
                        <td className="py-1 px-3">
                          {r.error
                            ? <span className="text-destructive">{r.error.slice(0, 40)}</span>
                            : <span className="text-emerald-500">ok</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>


        {mut.isError && (
          <Card className="border-destructive/60">
            <CardContent className="py-4 text-sm text-destructive">
              {(mut.error as Error).message}
            </CardContent>
          </Card>
        )}

        {result && (
          <>
            <div className="grid gap-3 md:grid-cols-6">
              <Stat label="Base TF" value={result.base} />
              <Stat label="Bars" value={result.count.toLocaleString()} />
              <Stat label="Avg ATR" value={fmtNum(result.summary.avgAtr)} />
              <Stat label="Avg ADX" value={fmtNum(result.summary.avgAdx)} />
              <Stat label="BOS / CHOCH" value={`${result.summary.bosCount} / ${result.summary.chochCount}`} />
              <Stat label="MSS events" value={String(result.summary.mssCount)} />
            </div>

            <Tabs defaultValue="candles">
              <TabsList>
                <TabsTrigger value="candles">Enriched Candles</TabsTrigger>
                <TabsTrigger value="sessions">Sessions</TabsTrigger>
                <TabsTrigger value="quality">Quality Report</TabsTrigger>
                <TabsTrigger value="api">API Surface</TabsTrigger>
              </TabsList>

              <TabsContent value="candles" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-mono tracking-widest">
                      Last {result.candles.length} bars (Display TZ: {displayTz})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-xs font-mono">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-1 pr-3">Time</th>
                          <th className="py-1 pr-3">O</th>
                          <th className="py-1 pr-3">H</th>
                          <th className="py-1 pr-3">L</th>
                          <th className="py-1 pr-3">C</th>
                          <th className="py-1 pr-3">Vol</th>
                          <th className="py-1 pr-3">Session</th>
                          <th className="py-1 pr-3">ATR</th>
                          <th className="py-1 pr-3">EMA50</th>
                          <th className="py-1 pr-3">EMA200</th>
                          <th className="py-1 pr-3">RSI</th>
                          <th className="py-1 pr-3">ADX</th>
                          <th className="py-1 pr-3">VWAPd</th>
                          <th className="py-1 pr-3">Struct</th>
                          <th className="py-1 pr-3">PDH</th>
                          <th className="py-1 pr-3">PDL</th>
                          <th className="py-1 pr-3">OR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.candles.slice(-200).reverse().map((b) => (
                          <tr key={b.ts} className="border-t border-border/40">
                            <td className="py-1 pr-3">{b.isoLocal.replace("T", " ")}</td>
                            <td className="py-1 pr-3">{fmtNum(b.open)}</td>
                            <td className="py-1 pr-3">{fmtNum(b.high)}</td>
                            <td className="py-1 pr-3">{fmtNum(b.low)}</td>
                            <td className="py-1 pr-3">{fmtNum(b.close)}</td>
                            <td className="py-1 pr-3">{fmtNum(b.volume, 0)}</td>
                            <td className="py-1 pr-3">
                              <Badge variant="outline" className="text-[9px] uppercase">{b.session}</Badge>
                            </td>
                            <td className="py-1 pr-3">{fmtNum(b.atr)}</td>
                            <td className="py-1 pr-3">{fmtNum(b.ema50)}</td>
                            <td className="py-1 pr-3">{fmtNum(b.ema200)}</td>
                            <td className="py-1 pr-3">{fmtNum(b.rsi, 1)}</td>
                            <td className="py-1 pr-3">{fmtNum(b.adx, 1)}</td>
                            <td className="py-1 pr-3">{fmtNum(b.vwapDaily)}</td>
                            <td className="py-1 pr-3">
                              {b.mss ? <span className="text-primary">MSS·{b.mss}</span>
                                : b.choch ? <span className="text-yellow-500">CHOCH·{b.choch}</span>
                                : b.bos ? <span className="text-blue-500">BOS·{b.bos}</span>
                                : b.structure ?? "—"}
                            </td>
                            <td className="py-1 pr-3">{fmtNum(b.prevDayHigh)}</td>
                            <td className="py-1 pr-3">{fmtNum(b.prevDayLow)}</td>
                            <td className="py-1 pr-3">{fmtNum(b.openingRangeSize)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="sessions" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-mono tracking-widest">Session distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground text-xs">
                        <tr className="text-left">
                          <th className="py-1">Session</th>
                          <th className="py-1">Bars</th>
                          <th className="py-1">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sessionRows.map(([name, count]) => (
                          <tr key={name} className="border-t border-border/40">
                            <td className="py-1"><Badge variant="outline" className="uppercase text-[10px]">{name}</Badge></td>
                            <td className="py-1 font-mono">{count.toLocaleString()}</td>
                            <td className="py-1 font-mono">{((count / result.count) * 100).toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="quality" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-mono tracking-widest">Data quality</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-2 md:grid-cols-4 text-sm">
                      <Stat label="Total bars" value={result.quality.total.toLocaleString()} />
                      <Stat label="Issues" value={result.quality.issues.length.toLocaleString()} />
                      <Stat label="Implied gap bars" value={result.quality.gapCandles.toLocaleString()} />
                      <Stat label="Duplicates" value={String(result.quality.countsByKind.duplicate)} />
                    </div>
                    <table className="w-full text-xs font-mono">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="py-1">Kind</th>
                          <th className="py-1">Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(result.quality.countsByKind).map(([k, v]) => (
                          <tr key={k} className="border-t border-border/40">
                            <td className="py-1">{k}</td>
                            <td className="py-1">{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {result.quality.issues.length > 0 && (
                      <div className="max-h-64 overflow-y-auto border border-border/40 rounded-md">
                        <table className="w-full text-xs font-mono">
                          <thead className="text-muted-foreground sticky top-0 bg-background">
                            <tr className="text-left">
                              <th className="py-1 px-2">TS</th>
                              <th className="py-1 px-2">Kind</th>
                              <th className="py-1 px-2">Detail</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.quality.issues.slice(0, 200).map((i, k) => (
                              <tr key={k} className="border-t border-border/40">
                                <td className="py-1 px-2">{new Date(i.ts).toISOString().replace("T", " ").slice(0, 19)}</td>
                                <td className="py-1 px-2">{i.kind}</td>
                                <td className="py-1 px-2">{i.detail ?? ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="api" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-mono tracking-widest">Data API surface</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-2">
                    <p className="text-muted-foreground">
                      Every strategy consumes the engine through a stable, read-only API. It never talks to
                      an exchange or historical CSV directly.
                    </p>
                    <pre className="text-xs font-mono bg-muted/40 rounded-md p-3 overflow-x-auto">{`import { MarketDataApi } from "@/lib/market-data/api";
import { enrichCandles } from "@/lib/market-data/enrich";

const bars = enrichCandles(raw, config);
const api = new MarketDataApi(bars);

api.current(i);          // full enriched candle
api.previous(i);         // prior bar
api.currentAtr(i);       // volatility
api.currentSession(i);   // asian | london | new_york | overlap | ...
api.currentTrend(i);     // up | down | flat (EMA50 vs EMA200)
api.currentVwap(i);      // anchored session VWAP
api.currentSwing(i);     // { high, low }
api.currentStructure(i); // { label, bos, choch, mss }
api.currentLiquidity(i); // prev day/week/month H/L + equal-highs/lows`}</pre>
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
