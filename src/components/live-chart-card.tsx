// Live candlestick chart for the Live Trading page.
// - Candles pulled every 30s (last N bars).
// - Tick price polled every 2s and updates the last candle in place.
// - Entry / SL / TP drawn as horizontal price lines when a trade is open.
// - Setup / signal markers overlaid on the chart.
// - Right panel shows live P&L, R multiple, direction, qty, elapsed.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createChart, CandlestickSeries, HistogramSeries, LineSeries,
  CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type IPriceLine, type UTCTimestamp,
  type SeriesMarker,
  createSeriesMarkers,
} from "lightweight-charts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { RefreshCw, Activity, TrendingUp, TrendingDown, CheckCircle2, XCircle, Clock, Zap, AlertTriangle, Pause, Radar, Bitcoin, Coins, Circle, Target, Shield } from "lucide-react";
import {
  getLiveChartData, getLastPrice, listLiveRunners, listLiveTrades,
  getRunnersStatusSummary,
  type LiveChartDataDTO, type LiveTradeDTO, type LiveRunnerDTO, type RunnerStatusDTO,
} from "@/lib/live-trading.functions";
import { queryTrades } from "@/lib/trade-intelligence.functions";


function useElapsed(sinceIso: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!sinceIso) return "—";
  const ms = now - new Date(sinceIso).getTime();
  if (ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

const DISPLAY_TFS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
type DisplayTf = typeof DISPLAY_TFS[number];

export interface OverlayFlags {
  vwap: boolean;
  ema20: boolean;
  ema50: boolean;
  ema200: boolean;
  adx: boolean;
  atr: boolean;
}

export function LiveChartCard() {
  const runnersFn = useServerFn(listLiveRunners);
  const runners = useQuery({
    queryKey: ["live-runners"], queryFn: () => runnersFn(),
    refetchInterval: 15_000, staleTime: 10_000, placeholderData: keepPreviousData,
  });
  const [runnerId, setRunnerId] = useState<string | null>(null);
  const [tf, setTf] = useState<DisplayTf | null>(null);
  const [overlays, setOverlays] = useState<OverlayFlags>({
    vwap: true, ema20: false, ema50: true, ema200: true, adx: true, atr: false,
  });

  // Default to first running runner, else first runner.
  useEffect(() => {
    if (!runners.data?.length) return;
    const stillExists = runnerId && runners.data.some((r) => r.id === runnerId);
    if (stillExists) return;
    const running = runners.data.find((r) => r.running);
    setRunnerId((running ?? runners.data[0])?.id ?? null);
  }, [runners.data, runnerId]);

  const dataFn = useServerFn(getLiveChartData);
  const chartQ = useQuery({
    queryKey: ["live-chart", runnerId, tf],
    queryFn: () => dataFn({ data: {
      runner_id: runnerId!, bars: 200,
      ...(tf ? { timeframe: tf } : {}),
    } }),
    enabled: !!runnerId,
    refetchInterval: 30_000,
    staleTime: 20_000,
    placeholderData: keepPreviousData,
  });

  const priceFn = useServerFn(getLastPrice);
  const priceQ = useQuery({
    queryKey: ["live-price", chartQ.data?.symbol],
    queryFn: () => priceFn({ data: { symbol: chartQ.data!.symbol } }),
    enabled: !!chartQ.data?.symbol,
    refetchInterval: 3_000,
    placeholderData: keepPreviousData,
  });

  const tradesFn = useServerFn(listLiveTrades);
  const tradesQ = useQuery({
    queryKey: ["live-trades-recent"],
    queryFn: () => tradesFn({ data: { limit: 50 } }),
    refetchInterval: 15_000, staleTime: 10_000, placeholderData: keepPreviousData,
  });
  const statusFn = useServerFn(getRunnersStatusSummary);
  const statusQ = useQuery({
    queryKey: ["live-runners-status"],
    queryFn: () => statusFn(),
    refetchInterval: 60_000, staleTime: 45_000, placeholderData: keepPreviousData,
  });
  const liveRecent = useMemo(() => {
    const rows = (tradesQ.data ?? []).filter((t) => !!t.exit_ts);
    if (!runnerId) return rows.slice(0, 10);
    return rows.filter((t) => t.runner_id === runnerId).slice(0, 10);
  }, [tradesQ.data, runnerId]);

  // Fallback: no live trades yet — show last 10 backtest trades for this symbol+timeframe.
  const symbol = chartQ.data?.symbol;
  const btTf = chartQ.data?.runnerTimeframe ?? undefined;
  const btFn = useServerFn(queryTrades);
  const btQ = useQuery({
    queryKey: ["bt-trades-recent", symbol, btTf],
    queryFn: () => btFn({ data: { symbol, timeframe: btTf, limit: 10, orderBy: "exit_time", order: "desc" } }),
    enabled: !!symbol && liveRecent.length === 0 && !tradesQ.isPending,
    refetchInterval: 60_000,
  });
  const recentTrades: RecentTradeItem[] = useMemo(() => {
    if (liveRecent.length > 0) return liveRecent.map(liveToItem);
    return (btQ.data?.rows ?? []).map(recordToItem);
  }, [liveRecent, btQ.data]);
  const usingBacktest = liveRecent.length === 0 && (btQ.data?.rows.length ?? 0) > 0;
  const tradesLoading = tradesQ.isPending || (liveRecent.length === 0 && btQ.isPending);

  const livePrice = priceQ.data?.price ?? chartQ.data?.lastPrice ?? null;
  const runnerTf = chartQ.data?.runnerTimeframe;
  const activeTf = (tf ?? runnerTf ?? null) as DisplayTf | null;

  const overlayToggle = (key: keyof OverlayFlags, label: string) => (
    <Toggle
      key={key}
      size="sm"
      pressed={overlays[key]}
      onPressedChange={(v) => setOverlays((o) => ({ ...o, [key]: v }))}
      className="h-7 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
    >
      {label}
    </Toggle>
  );

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 shrink-0" />
            Live chart
          </CardTitle>
          <p className="hidden sm:block text-xs text-muted-foreground mt-1">
            Candlestick view with setup markings, live price ticks, and open-trade levels overlaid.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Select value={runnerId ?? undefined} onValueChange={setRunnerId}>
            <SelectTrigger className="h-8 flex-1 sm:w-[260px] sm:flex-none min-w-0"><SelectValue placeholder="Pick a runner" /></SelectTrigger>
            <SelectContent>
              {(runners.data ?? []).map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label} · {r.symbol} · {r.timeframe} {r.running ? "· LIVE" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="icon" variant="outline" className="h-8 w-8 shrink-0 sm:hidden" onClick={() => chartQ.refetch()} disabled={chartQ.isFetching} aria-label="Refresh">
            <RefreshCw className={`h-4 w-4 ${chartQ.isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => chartQ.refetch()} disabled={chartQ.isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${chartQ.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

      </CardHeader>
      <CardContent>
        {!runnerId && <p className="text-sm text-muted-foreground">Choose a runner to load its chart.</p>}
        {runnerId && chartQ.isPending && <p className="text-sm text-muted-foreground">Loading chart…</p>}
        {runnerId && chartQ.error && (
          <p className="text-sm text-destructive">
            {chartQ.error instanceof Error ? chartQ.error.message : String(chartQ.error)}
          </p>
        )}
        {chartQ.data && (
          <div className="space-y-4">
            {/* Toolbar: TF toggle + overlay toggles */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-md border bg-muted/20 px-2 py-2">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[11px] text-muted-foreground mr-1">TF</span>
                {DISPLAY_TFS.map((t) => (
                  <Button
                    key={t} size="sm"
                    variant={activeTf === t ? "default" : "outline"}
                    className="h-7 px-2 text-xs"
                    onClick={() => setTf(t)}
                  >
                    {t}{runnerTf === t ? "*" : ""}
                  </Button>
                ))}
                {tf && tf !== runnerTf && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                    onClick={() => setTf(null)}>reset</Button>
                )}
                {runnerTf && (
                  <span className="text-[10px] text-muted-foreground ml-1 whitespace-nowrap">
                    on <b>{runnerTf}</b>
                  </span>
                )}
              </div>
              <div className="hidden sm:block h-5 w-px bg-border" />
              <div className="h-px w-full bg-border sm:hidden" />
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[11px] text-muted-foreground mr-1">Overlays</span>
                {overlayToggle("vwap", "VWAP")}
                {overlayToggle("ema20", "EMA20")}
                {overlayToggle("ema50", "EMA50")}
                {overlayToggle("ema200", "EMA200")}
                {overlayToggle("adx", "ADX")}
                {overlayToggle("atr", "ATR")}
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
              <ChartCanvas data={chartQ.data} livePrice={livePrice} overlays={overlays} />
              <TradeSidePanel data={chartQ.data} livePrice={livePrice} />
            </div>
            <RecentTradesStrip trades={recentTrades} loading={tradesLoading} source={usingBacktest ? "backtest" : "live"} />

          </div>
        )}
      </CardContent>
    </Card>
  );
}



const OVERLAY_META: Record<keyof OverlayFlags, { color: string; pane: 0 | 1 | 2; title: string }> = {
  vwap:   { color: "#f59e0b", pane: 0, title: "VWAP" },
  ema20:  { color: "#38bdf8", pane: 0, title: "EMA20" },
  ema50:  { color: "#a78bfa", pane: 0, title: "EMA50" },
  ema200: { color: "#f472b6", pane: 0, title: "EMA200" },
  adx:    { color: "#22d3ee", pane: 1, title: "ADX" },
  atr:    { color: "#fbbf24", pane: 2, title: "ATR" },
};

function ChartCanvas({ data, livePrice, overlays }: {
  data: LiveChartDataDTO; livePrice: number | null; overlays: OverlayFlags;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlaySeriesRef = useRef<Partial<Record<keyof OverlayFlags, ISeriesApi<"Line">>>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const lastCandleRef = useRef<{ time: UTCTimestamp; open: number; high: number; low: number; close: number } | null>(null);

  // Build chart once.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "rgba(0,0,0,0)" },
        textColor: "#94a3b8",
        panes: { separatorColor: "rgba(120,120,120,0.2)", separatorHoverColor: "rgba(120,120,120,0.35)" },
      },
      grid: {
        vertLines: { color: "rgba(120,120,120,0.1)" },
        horzLines: { color: "rgba(120,120,120,0.1)" },
      },
      rightPriceScale: { borderColor: "rgba(120,120,120,0.2)" },
      timeScale: { borderColor: "rgba(120,120,120,0.2)", timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981", downColor: "#ef4444",
      borderUpColor: "#10b981", borderDownColor: "#ef4444",
      wickUpColor: "#10b981", wickDownColor: "#ef4444",
    });
    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "rgba(120,120,120,0.4)",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    chartRef.current = chart;
    candleSeriesRef.current = candles;
    volSeriesRef.current = vol;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      overlaySeriesRef.current = {};
      markersRef.current = null;
      linesRef.current = [];
    };
  }, []);

  // Manage overlay line series based on flags.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const current = overlaySeriesRef.current;
    (Object.keys(OVERLAY_META) as (keyof OverlayFlags)[]).forEach((k) => {
      const want = overlays[k];
      const has = !!current[k];
      if (want && !has) {
        const meta = OVERLAY_META[k];
        const s = chart.addSeries(LineSeries, {
          color: meta.color, lineWidth: 2, priceLineVisible: false,
          lastValueVisible: true, title: meta.title,
        }, meta.pane);
        current[k] = s;
      } else if (!want && has) {
        try { chart.removeSeries(current[k]!); } catch { /* noop */ }
        delete current[k];
      }
    });
  }, [overlays]);



  // Push candles + markers + price lines whenever data changes.
  useEffect(() => {
    const candles = candleSeriesRef.current;
    const vol = volSeriesRef.current;
    if (!candles || !vol) return;

    const cData = data.candles.map((c) => ({
      time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c,
    }));
    const vData = data.candles.map((c) => ({
      time: c.t as UTCTimestamp, value: c.v,
      color: c.c >= c.o ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.35)",
    }));
    candles.setData(cData);
    vol.setData(vData);
    const last = cData[cData.length - 1];
    if (last) lastCandleRef.current = { ...last };

    // Overlay series data — filter out nulls (line series doesn't accept them).
    const overlayData = {
      vwap: data.series.vwap, ema20: data.series.ema20, ema50: data.series.ema50,
      ema200: data.series.ema200, adx: data.series.adx, atr: data.series.atr,
    } as const;
    (Object.keys(overlayData) as (keyof OverlayFlags)[]).forEach((k) => {
      const s = overlaySeriesRef.current[k];
      if (!s) return;
      const pts = overlayData[k]
        .filter((p) => p.v != null && Number.isFinite(p.v))
        .map((p) => ({ time: p.t as UTCTimestamp, value: p.v as number }));
      s.setData(pts);
    });


    // Markers.
    const seriesMarkers: SeriesMarker<UTCTimestamp>[] = data.markers.map((m) => {
      if (m.kind === "signal_long") return {
        time: m.time as UTCTimestamp, position: "belowBar", color: "#10b981", shape: "arrowUp", text: m.label,
      };
      if (m.kind === "signal_short") return {
        time: m.time as UTCTimestamp, position: "aboveBar", color: "#ef4444", shape: "arrowDown", text: m.label,
      };
      if (m.kind === "invalidated") return {
        time: m.time as UTCTimestamp, position: "aboveBar", color: "#f59e0b", shape: "circle", text: "×",
      };
      return {
        time: m.time as UTCTimestamp, position: "belowBar", color: "#60a5fa", shape: "circle", text: m.label,
      };
    });
    if (markersRef.current) {
      markersRef.current.setMarkers(seriesMarkers);
    } else {
      markersRef.current = createSeriesMarkers(candles, seriesMarkers);
    }

    // Clear existing price lines.
    for (const pl of linesRef.current) candles.removePriceLine(pl);
    linesRef.current = [];

    const draw = (price: number, color: string, title: string, style = LineStyle.Solid) => {
      const pl = candles.createPriceLine({
        price, color, lineWidth: 2, lineStyle: style, axisLabelVisible: true, title,
      });
      linesRef.current.push(pl);
    };

    if (data.activeTrade) {
      const t = data.activeTrade;
      draw(Number(t.fill_price ?? t.entry_price), "#60a5fa", `Entry ${t.direction.toUpperCase()}`);
      draw(Number(t.stop_price), "#ef4444", "SL");
      draw(Number(t.target_price), "#10b981", "TP");
    } else if (data.pendingSignal) {
      const p = data.pendingSignal;
      draw(p.entryPrice, "#60a5fa", `Pending ${p.direction.toUpperCase()}`, LineStyle.Dashed);
      draw(p.stop, "#ef4444", "SL", LineStyle.Dashed);
      draw(p.target, "#10b981", "TP", LineStyle.Dashed);
    }

    chartRef.current?.timeScale().fitContent();
  }, [data, overlays]);

  // Tick — update the last candle with the polled price.
  useEffect(() => {
    if (livePrice == null) return;
    const candles = candleSeriesRef.current;
    const last = lastCandleRef.current;
    if (!candles || !last) return;
    const updated = {
      time: last.time, open: last.open,
      high: Math.max(last.high, livePrice),
      low: Math.min(last.low, livePrice),
      close: livePrice,
    };
    lastCandleRef.current = updated;
    candles.update(updated);
  }, [livePrice]);

  return <div ref={containerRef} className="h-[380px] sm:h-[560px] w-full rounded-md border" />;
}

function TradeSidePanel({ data, livePrice }: { data: LiveChartDataDTO; livePrice: number | null }) {
  const t = data.activeTrade;
  const elapsed = useElapsed(t?.entry_ts ?? null);

  const stats = useMemo(() => {
    if (!t || livePrice == null) return null;
    const entry = Number(t.fill_price ?? t.entry_price);
    const qty = Number(t.qty);
    const sl = Number(t.stop_price);
    const tp = Number(t.target_price);
    const long = t.direction === "long";
    const pnl = long ? (livePrice - entry) * qty : (entry - livePrice) * qty;
    const risk = Math.abs(entry - sl);
    const rNow = risk > 0 ? (long ? (livePrice - entry) / risk : (entry - livePrice) / risk) : 0;
    const distToSlPct = entry > 0 ? Math.abs(livePrice - sl) / entry * 100 : 0;
    const distToTpPct = entry > 0 ? Math.abs(tp - livePrice) / entry * 100 : 0;
    const rrPlanned = risk > 0 ? Math.abs(tp - entry) / risk : 0;
    return { entry, qty, sl, tp, long, pnl, rNow, distToSlPct, distToTpPct, rrPlanned };
  }, [t, livePrice]);

  return (
    <div className="space-y-2 text-xs">
      <div className="rounded-md border p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Last price</span>
          <span className="font-mono text-sm font-semibold">{livePrice != null ? livePrice.toFixed(2) : "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Symbol · TF</span>
          <span className="font-mono">{data.symbol} · {data.timeframe}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Strategy</span>
          <span className="font-mono truncate max-w-[140px]" title={data.strategy_preset}>{data.strategy_preset}</span>
        </div>
      </div>

      {t ? (
        <div className="rounded-md border p-3 space-y-1.5">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium">Open trade</span>
            <Badge variant={t.direction === "long" ? "default" : "destructive"} className="gap-1">
              {t.direction === "long" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {t.direction.toUpperCase()}
            </Badge>
          </div>
          <Row k="Status" v={t.status} />
          <Row k="Qty" v={Number(t.qty).toFixed(4)} />
          <Row k="Entry" v={Number(t.fill_price ?? t.entry_price).toFixed(2)} />
          <Row k="Stop" v={Number(t.stop_price).toFixed(2)} tone="loss" />
          <Row k="Target" v={Number(t.target_price).toFixed(2)} tone="gain" />
          <Row k="Elapsed" v={elapsed} />
          {stats && (
            <>
              <div className="border-t my-1" />
              <Row k="Unrealised P&L"
                v={`${stats.pnl >= 0 ? "+" : ""}$${stats.pnl.toFixed(2)}`}
                tone={stats.pnl >= 0 ? "gain" : "loss"} bold />
              <Row k="R now" v={`${stats.rNow >= 0 ? "+" : ""}${stats.rNow.toFixed(2)}R`}
                tone={stats.rNow >= 0 ? "gain" : "loss"} />
              <Row k="Planned RR" v={`${stats.rrPlanned.toFixed(2)}R`} />
              <Row k="Dist to SL" v={`${stats.distToSlPct.toFixed(2)}%`} tone="loss" />
              <Row k="Dist to TP" v={`${stats.distToTpPct.toFixed(2)}%`} tone="gain" />
            </>
          )}
        </div>
      ) : data.pendingSignal ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-1.5">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium">Pending signal (waiting to fill)</span>
            <Badge variant="outline">{data.pendingSignal.direction.toUpperCase()}</Badge>
          </div>
          <Row k="Entry" v={data.pendingSignal.entryPrice.toFixed(2)} />
          <Row k="Stop" v={data.pendingSignal.stop.toFixed(2)} tone="loss" />
          <Row k="Target" v={data.pendingSignal.target.toFixed(2)} tone="gain" />
        </div>
      ) : (
        <div className="rounded-md border p-3 text-muted-foreground">
          No open trade. Chart shows recent setup markings for context.
        </div>
      )}
    </div>
  );
}

function Row({ k, v, tone, bold }: {
  k: string; v: string; tone?: "gain" | "loss"; bold?: boolean;
}) {
  const cls = tone === "gain" ? "text-emerald-500" : tone === "loss" ? "text-destructive" : "";
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className={`font-mono ${cls} ${bold ? "font-semibold" : ""}`}>{v}</span>
    </div>
  );
}

export function AllRunnersStatusCard() {
  const runnersFn = useServerFn(listLiveRunners);
  const tradesFn = useServerFn(listLiveTrades);
  const statusFn = useServerFn(getRunnersStatusSummary);
  const runnersQ = useQuery({
    queryKey: ["live-runners"], queryFn: () => runnersFn(),
    refetchInterval: 15_000, staleTime: 10_000, placeholderData: keepPreviousData,
  });
  const tradesQ = useQuery({
    queryKey: ["live-trades"], queryFn: () => tradesFn({ data: { limit: 500 } }),
    refetchInterval: 10_000, staleTime: 8_000, placeholderData: keepPreviousData,
  });
  const statusQ = useQuery({
    queryKey: ["live-runners-status"], queryFn: () => statusFn(),
    refetchInterval: 60_000, staleTime: 45_000, placeholderData: keepPreviousData,
  });
  const isFetching = runnersQ.isFetching || tradesQ.isFetching || statusQ.isFetching;
  const onRefresh = () => {
    runnersQ.refetch();
    tradesQ.refetch();
    statusQ.refetch();
  };
  return (
    <AllRunnersStatusPanel
      runners={runnersQ.data ?? []}
      trades={tradesQ.data ?? []}
      statuses={statusQ.data ?? []}
      onRefresh={onRefresh}
      isFetching={isFetching}
    />
  );
}

function AllRunnersStatusPanel({
  runners, trades, statuses, onRefresh, isFetching,
}: { runners: LiveRunnerDTO[]; trades: LiveTradeDTO[]; statuses: RunnerStatusDTO[]; onRefresh?: () => void; isFetching?: boolean }) {
  if (!runners.length) {
    return (
      <div className="rounded-md border p-3 text-sm text-muted-foreground">
        No runners configured yet.
      </div>
    );
  }

  const openByRunner = new Map<string, LiveTradeDTO>();
  for (const t of trades) {
    if ((t.status === "open" || t.status === "pending") && !openByRunner.has(t.runner_id)) {
      openByRunner.set(t.runner_id, t);
    }
  }
  const statusByRunner = new Map<string, RunnerStatusDTO>();
  for (const st of statuses) statusByRunner.set(st.runner_id, st);

  const [showAll, setShowAll] = useState(false);

  const runningCount = runners.filter((r) => r.running).length;
  const openCount = openByRunner.size;
  const errorCount = runners.filter((r) => !!r.last_tick_error).length
    + statuses.filter((s) => s.state === "error" && !runners.find((r) => r.id === s.runner_id)?.last_tick_error).length;
  const readyCount = statuses.filter((s) => s.state === "setup_ready").length;
  const stoppedCount = runners.length - runningCount;
  const closedCount = statuses.filter((s) => s.state === "session_closed").length;


  return (
    <div className="rounded-lg border border-gradient-sunset bg-gradient-sunset-soft p-3 sm:p-4 space-y-3 shadow-lg">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-sunset-vivid shadow-md glow-sunset">
            <Radar className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">All runners · live status</div>
            <div className="text-[10px] text-muted-foreground font-mono uppercase">Realtime · auto-refresh 60s</div>
          </div>
          {onRefresh && (
            <Button variant="ghost" size="icon" className="h-7 w-7 ml-1" onClick={onRefresh} disabled={isFetching} title="Refresh now">
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin text-primary" : ""}`} />
            </Button>
          )}
          {closedCount > 0 && (
            <Button
              variant={showAll ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-[10px] font-semibold uppercase tracking-wider ml-1"
              onClick={() => setShowAll((v) => !v)}
              title={showAll ? "Hide session-closed runners" : "Show session-closed runners"}
            >
              All {showAll ? `(${runners.length})` : `(+${closedCount})`}
            </Button>
          )}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-[10px]">
          <StatPill icon={<Circle className="h-3 w-3" />} label="Total" value={runners.length} tone="neutral" />

          <StatPill icon={<Zap className="h-3 w-3" />} label="Running" value={runningCount} tone="success" />
          <StatPill icon={<Pause className="h-3 w-3" />} label="Stopped" value={stoppedCount} tone="muted" />
          <StatPill icon={<Target className="h-3 w-3" />} label="Ready" value={readyCount} tone={readyCount ? "success" : "muted"} />
          <StatPill icon={<Activity className="h-3 w-3" />} label="Open" value={openCount} tone={openCount ? "primary" : "muted"} />
          <StatPill icon={<AlertTriangle className="h-3 w-3" />} label="Errors" value={errorCount} tone={errorCount ? "destructive" : "muted"} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {runners
          .map((r) => {
            const open = openByRunner.get(r.id);
            const st = statusByRunner.get(r.id);

            let statusText: string;
            let tone: "success" | "warning" | "destructive" | "muted" | "primary" | "dim";
            let StatusIcon = Activity;
            let subDetail: string | null = null;
            let sortKey = 99;

            if (r.last_tick_error) {
              statusText = "Error"; tone = "destructive"; StatusIcon = AlertTriangle; sortKey = 4;
            } else if (open) {
              statusText = `Trade ${open.status} · ${open.direction.toUpperCase()}`;
              tone = "primary";
              StatusIcon = open.direction === "long" ? TrendingUp : TrendingDown;
              sortKey = 0;
            } else if (!r.running) {
              statusText = "Stopped"; tone = "muted"; StatusIcon = Pause; sortKey = 5;
            } else if (st?.state === "setup_ready") {
              statusText = `Ready · ${(st.direction ?? "").toUpperCase()}`; tone = "success"; StatusIcon = Target;
              subDetail = st.detail; sortKey = 1;
            } else if (st?.state === "blocked") {
              const labels = (st.detail ?? "").split(" · ").map((s) => s.split(" (")[0]).filter(Boolean);
              statusText = labels.length ? `Blocked: ${labels.join(", ")}` : "Filters blocking";
              tone = "warning"; StatusIcon = Shield;
              subDetail = st.detail; sortKey = 2;
            } else if (st?.state === "session_closed") {
              statusText = "Session closed"; tone = "dim"; StatusIcon = Clock; sortKey = 6;
            } else if (st?.state === "error") {
              statusText = "Error"; tone = "destructive"; StatusIcon = AlertTriangle;
              subDetail = st.detail; sortKey = 4;
            } else if (!st) {
              statusText = "Loading…"; tone = "muted"; StatusIcon = Circle; sortKey = 7;
            } else {
              statusText = "Scanning"; tone = "warning"; StatusIcon = Radar; sortKey = 3;
            }

            return { r, open, statusText, tone, StatusIcon, subDetail, sortKey };
          })
          .filter(({ tone }) => showAll || tone !== "dim")
          .sort((a, b) => a.sortKey - b.sortKey || a.r.label.localeCompare(b.r.label))
          .map(({ r, open, statusText, tone, StatusIcon, subDetail }) => {
          const isDim = tone === "dim";
          const toneWrap =
            tone === "success" ? "border-l-[3px] border-l-success bg-success/10 ring-1 ring-success/20"
            : tone === "primary" ? "border-l-[3px] border-l-primary bg-primary/5 ring-1 ring-primary/20"
            : tone === "warning" ? "border-l-[3px] border-l-warning bg-warning/10 ring-1 ring-warning/20"
            : tone === "destructive" ? "border-l-[3px] border-l-destructive bg-destructive/10"
            : isDim ? "border-l-[3px] border-l-muted-foreground/20 bg-muted/40 opacity-55 grayscale"
            : "border-l-[3px] border-l-muted-foreground/30 bg-muted/20";

          const toneBadge =
            tone === "success" ? "bg-success/20 text-success border-success/40"
            : tone === "primary" ? "bg-primary/15 text-primary border-primary/30"
            : tone === "warning" ? "bg-warning/20 text-warning border-warning/40"
            : tone === "destructive" ? "bg-destructive/15 text-destructive border-destructive/30"
            : isDim ? "bg-muted/60 text-muted-foreground/70 border-border/50"
            : "bg-muted text-muted-foreground border-border";

          const isBtc = r.symbol.toUpperCase().startsWith("BTC");
          const SymbolIcon = isBtc ? Bitcoin : Coins;
          const symbolColor = isDim ? "text-muted-foreground/60" : isBtc ? "text-brand-ember" : "text-brand-copper";

          return (
            <div key={r.id} className={`rounded-md border p-2.5 flex flex-col gap-1.5 text-xs card-hover ${toneWrap} ${isDim ? "text-muted-foreground" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <SymbolIcon className={`h-4 w-4 shrink-0 ${symbolColor}`} />
                  <span className={`font-semibold truncate ${isDim ? "text-muted-foreground" : ""}`}>{r.label}</span>
                </div>
                <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded-full border font-mono font-bold tracking-wider ${
                  isDim ? "bg-muted/60 text-muted-foreground/70 border-border/50"
                  : r.leverage >= 100 ? "bg-gradient-sunset-vivid text-white border-transparent shadow"
                  : "bg-accent/40 text-accent-foreground border-accent"
                }`}>
                  {r.leverage}×
                </span>
              </div>

              <div className={`inline-flex items-center gap-1 self-start text-[10px] px-1.5 py-0.5 rounded-md border font-medium ${toneBadge}`}>
                <StatusIcon className="h-3 w-3" />
                <span>{statusText}</span>
              </div>

              <div className={`flex items-center justify-between gap-2 font-mono text-[10.5px] ${isDim ? "text-muted-foreground/70" : "text-muted-foreground"}`}>
                <span className="truncate">{r.symbol} · {r.timeframe} · {r.strategy_preset}</span>
                <span className="shrink-0 flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {r.last_tick_at ? new Date(r.last_tick_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                </span>
              </div>

              {open && (
                <div className="mt-0.5 grid grid-cols-3 gap-1 rounded-sm bg-background/50 p-1.5 font-mono text-[10px]">
                  <div><div className="text-muted-foreground">Entry</div><div className="font-semibold">{Number(open.entry_price).toFixed(2)}</div></div>
                  {open.stop_price != null && <div><div className="text-muted-foreground">SL</div><div className="text-destructive font-semibold">{Number(open.stop_price).toFixed(2)}</div></div>}
                  {open.target_price != null && <div><div className="text-muted-foreground">TP</div><div className="text-success font-semibold">{Number(open.target_price).toFixed(2)}</div></div>}
                </div>
              )}
              {!open && subDetail && (
                <div className="text-muted-foreground truncate text-[10.5px]" title={subDetail}>· {subDetail}</div>
              )}
              {r.last_tick_error && (
                <div className="text-destructive truncate text-[10.5px]" title={r.last_tick_error}>
                  ⚠ {r.last_tick_error}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


function StatPill({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: number;
  tone: "success" | "destructive" | "primary" | "warning" | "muted" | "neutral";
}) {
  const cls =
    tone === "success" ? "bg-success/15 text-success border-success/30"
    : tone === "destructive" ? "bg-destructive/15 text-destructive border-destructive/30"
    : tone === "primary" ? "bg-primary/15 text-primary border-primary/30"
    : tone === "warning" ? "bg-warning/15 text-warning border-warning/30"
    : tone === "neutral" ? "bg-gradient-sunset-vivid text-white border-transparent"
    : "bg-muted/50 text-muted-foreground border-border";
  return (
    <div className={`flex items-center justify-between gap-1 rounded-md border px-1.5 py-1 ${cls}`}>
      <div className="flex items-center gap-1 min-w-0">
        {icon}
        <span className="uppercase font-mono tracking-wider truncate">{label}</span>
      </div>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );
}



interface RecentTradeItem {
  id: string;
  direction: "long" | "short";
  entryTs: string;
  exitTs: string | null;
  netPnl: number;
  rr: number | null;
  exitReason: string | null;
  status: string;
}

function liveToItem(t: LiveTradeDTO): RecentTradeItem {
  return {
    id: t.id,
    direction: t.direction as "long" | "short",
    entryTs: t.entry_ts,
    exitTs: t.exit_ts ?? null,
    netPnl: Number(t.net_pnl) || 0,
    rr: t.rr != null ? Number(t.rr) : null,
    exitReason: t.exit_reason ?? null,
    status: t.status,
  };
}

function recordToItem(r: import("@/lib/trade-intelligence/types").TradeRecord): RecentTradeItem {
  return {
    id: r.tradeId,
    direction: r.direction,
    entryTs: new Date(r.entryTime).toISOString(),
    exitTs: r.exitTime ? new Date(r.exitTime).toISOString() : null,
    netPnl: Number(r.netPnl) || 0,
    rr: r.actualRr != null ? Number(r.actualRr) : null,
    exitReason: r.exitReason ?? null,
    status: r.status,
  };
}

function RecentTradesStrip({ trades, loading, source }: { trades: RecentTradeItem[]; loading: boolean; source: "live" | "backtest" }) {
  const totalPnl = trades.reduce((a, t) => a + t.netPnl, 0);
  const wins = trades.filter((t) => t.netPnl > 0).length;
  const winRate = trades.length ? (wins / trades.length) * 100 : 0;

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs font-medium flex items-center gap-2">
          Last {trades.length || 10} closed trades
          {source === "backtest" && trades.length > 0 && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">from backtest</Badge>
          )}
        </div>
        {trades.length > 0 && (
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>Win rate: <b className="text-foreground">{winRate.toFixed(0)}%</b> ({wins}/{trades.length})</span>
            <span>
              Net P&amp;L:{" "}
              <b className={totalPnl >= 0 ? "text-emerald-500" : "text-destructive"}>
                {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
              </b>
            </span>
          </div>
        )}
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading trades…</p>
      ) : trades.length === 0 ? (
        <p className="text-xs text-muted-foreground">No closed trades yet.</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {trades.map((t) => {
            const pnl = t.netPnl;
            const win = pnl > 0;
            const long = t.direction === "long";
            const entry = new Date(t.entryTs);
            const exit = t.exitTs ? new Date(t.exitTs) : null;
            const sameDay = exit && entry.toDateString() === exit.toDateString();
            const dateStr = entry.toLocaleDateString([], { month: "short", day: "2-digit" });
            const entryTime = entry.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
            const exitTime = exit ? exit.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : null;
            const exitDate = exit && !sameDay ? exit.toLocaleDateString([], { month: "short", day: "2-digit" }) : null;
            return (
              <div
                key={t.id}
                title={`Entry: ${entry.toLocaleString()}${exit ? `\nExit:  ${exit.toLocaleString()}` : ""}`}
                className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs flex items-center gap-2
                  ${win ? "border-emerald-500/40 bg-emerald-500/10" : "border-destructive/40 bg-destructive/10"}`}
              >
                <span className={`font-mono text-[10px] px-1 py-0.5 rounded inline-flex items-center ${long ? "bg-emerald-500/20 text-emerald-500" : "bg-destructive/20 text-destructive"}`}>
                  {long ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
                  {long ? "LONG" : "SHORT"}
                </span>
                <span className={`font-mono font-semibold ${win ? "text-emerald-500" : "text-destructive"}`}>
                  {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                </span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap font-mono">
                  {dateStr} {entryTime}
                  {exitTime ? <span className="opacity-70"> → {exitDate ? `${exitDate} ` : ""}{exitTime}</span> : null}
                </span>
              </div>
            );
          })}

        </div>
      )}
    </div>
  );
}


