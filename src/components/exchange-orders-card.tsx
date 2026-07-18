import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import {
  listLiveExchangeOrders,
  cancelExchangeOrder,
  listLiveTrades,
  type ExchangePendingOrder,
  type ExchangeClosedTrade,
  type LiveTradeDTO,
} from "@/lib/live-trading.functions";

function fmtNum(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number(n).toFixed(d);
}
function fmtMoney(n: number | null | undefined, suffix = "USDT"): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(2)} ${suffix}`;
}
function fmtInr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : "-"}₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function sideBadge(side: string) {
  const s = side.toUpperCase();
  const tone =
    s === "BUY" || s === "LONG"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
      : s === "SELL" || s === "SHORT"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-muted-foreground/30 bg-muted/40 text-muted-foreground";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tone} font-medium`}>{s}</span>;
}
function labelForPending(o: ExchangePendingOrder): string {
  if (o.subType === "STOP_LOSS") return "Stop-loss";
  if (o.subType === "TAKE_PROFIT") return "Take-profit";
  if (o.reduceOnly) return "Reduce-only";
  return o.type || "Order";
}
function hasRealizedPnl(t: LiveTradeDTO): boolean {
  return t.net_pnl != null && Number.isFinite(Number(t.net_pnl));
}
function noFillReason(reason: string | null | undefined): boolean {
  return reason === "expired" || reason === "cancelled" || reason === "cancelled_replaced" || reason === "expired_queue";
}
function outcomeForTrade(t: LiveTradeDTO): string {
  if (t.status === "error") return "Failed";
  if (hasRealizedPnl(t)) return "Filled";
  if (noFillReason(t.exit_reason)) return "No fill";
  return t.status;
}
function pnlText(t: LiveTradeDTO): string {
  if (hasRealizedPnl(t)) return fmtNum(Number(t.net_pnl));
  if (t.status === "error") return "Failed";
  if (noFillReason(t.exit_reason)) return "No fill";
  return "—";
}
function isRealizedExchangeClose(t: ExchangeClosedTrade): boolean {
  return t.realizedPnl != null && Number.isFinite(Number(t.realizedPnl)) && Math.abs(Number(t.realizedPnl)) > 0;
}
function sumExchange(rows: ExchangeClosedTrade[]) {
  let gross = 0;
  let fees = 0;
  let grossInr = 0;
  let feesInr = 0;
  let hasInr = false;
  for (const r of rows) {
    gross += Number(r.realizedPnl ?? 0);
    fees += Math.abs(Number(r.fee ?? 0));
    if (r.realizedPnlInMarginAsset != null || r.feeInMarginAsset != null) {
      hasInr = true;
      grossInr += Number(r.realizedPnlInMarginAsset ?? 0);
      feesInr += Math.abs(Number(r.feeInMarginAsset ?? 0));
    }
  }
  return { gross, fees, net: gross - fees, grossInr, feesInr, netInr: grossInr - feesInr, hasInr };
}

export function ExchangeOrdersCard() {
  const fn = useServerFn(listLiveExchangeOrders);
  const cancelFn = useServerFn(cancelExchangeOrder);
  const tradesFn = useServerFn(listLiveTrades);
  const qc = useQueryClient();
  const [tab, setTab] = useState<"server" | "pending" | "closed" | "live">("server");

  const q = useQuery({
    queryKey: ["exchange-orders"],
    queryFn: () => fn(),
    refetchInterval: 15_000,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });

  const tradesQ = useQuery({
    queryKey: ["live-trades-card"],
    queryFn: () => tradesFn({ data: { limit: 2000 } }),
    refetchInterval: 10_000,
    staleTime: 8_000,
    placeholderData: keepPreviousData,
  });

  const cancelMut = useMutation({
    mutationFn: (clientOrderId: string) => cancelFn({ data: { clientOrderId } }),
    onSuccess: (res) => {
      if (res.ok) toast.success("Order cancelled on exchange");
      else toast.error(`Cancel failed [${res.status}]: ${res.body.slice(0, 120)}`);
      qc.invalidateQueries({ queryKey: ["exchange-orders"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  // Hard cutoff: ignore trades/fills before the switch to the current runner
  // set. Losses from decommissioned runners were polluting today's stats.
  // 17 Jul 2026 17:40 IST == 12:10 UTC.
  const TRADE_CUTOFF_MS = Date.UTC(2026, 6, 17, 12, 10, 0);
  const afterCutoffTs = (iso: string | null | undefined) =>
    !!iso && new Date(iso).getTime() >= TRADE_CUTOFF_MS;

  const data = q.data;
  const pending = data?.pending ?? [];
  const executed = data?.executed ?? [];
  const exchangeFills = (data?.closed ?? []).filter((t) => afterCutoffTs(t.time));
  const allTrades = (tradesQ.data ?? []).filter((t) => afterCutoffTs(t.entry_ts));
  const serverQueued = allTrades.filter((t) => t.status === "queued");
  const liveRunning = allTrades.filter((t) => t.status === "open");
  // Our own runner attempts that have finished. Rows with net_pnl=null are
  // no-fill attempts (expired/cancelled/failed before execution), not P&L trades.
  const finishedTrades = allTrades
    .filter((t) => t.status === "closed" || t.status === "error")
    .sort((a, b) => (b.exit_ts ?? b.entry_ts).localeCompare(a.exit_ts ?? a.entry_ts));
  const realizedTrades = finishedTrades.filter(hasRealizedPnl);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();
  const isTodayAttempt = (t: LiveTradeDTO) => {
    const tsSrc = t.exit_ts ?? t.entry_ts;
    const ts = tsSrc ? new Date(tsSrc).getTime() : 0;
    return ts >= startOfTodayMs;
  };
  const finishedToday = finishedTrades.filter(isTodayAttempt);
  const exchangeFillsToday = exchangeFills.filter((t) => {
    const ts = t.time ? new Date(t.time).getTime() : 0;
    return ts >= startOfTodayMs;
  });
  const exchangeClosesToday = exchangeFillsToday.filter(isRealizedExchangeClose);
  const exchangeSummary = sumExchange(exchangeFills);
  const todayExchangeSummary = sumExchange(exchangeFillsToday);
  const riskPerTradeUsd = 20;
  const closeNetValues = exchangeClosesToday.map((r) => Number(r.realizedPnl ?? 0) - Math.abs(Number(r.fee ?? 0)));
  const todayWins = closeNetValues.filter((v) => v > 0).length;
  const todayLosses = closeNetValues.filter((v) => v < 0).length;
  const todayWinRate = closeNetValues.length > 0 ? (todayWins / closeNetValues.length) * 100 : null;
  const avgR = closeNetValues.length > 0
    ? closeNetValues.reduce((s, v) => s + v / riskPerTradeUsd, 0) / closeNetValues.length
    : null;
  const winNetValues = closeNetValues.filter((v) => v > 0);
  const lossNetValues = closeNetValues.filter((v) => v < 0);
  const avgRWin = winNetValues.length > 0
    ? winNetValues.reduce((s, v) => s + v / riskPerTradeUsd, 0) / winNetValues.length
    : null;
  const avgRLoss = lossNetValues.length > 0
    ? lossNetValues.reduce((s, v) => s + v / riskPerTradeUsd, 0) / lossNetValues.length
    : null;
  let todayRealizedCount = 0;
  let todayAttempts = 0;
  let todayNoFill = 0;
  let todayErrors = 0;
  for (const t of finishedTrades) {
    const tsSrc = t.exit_ts ?? t.entry_ts;
    const ts = tsSrc ? new Date(tsSrc).getTime() : 0;
    if (ts >= startOfTodayMs) {
      todayAttempts += 1;
      if (t.status === "error") todayErrors += 1;
      else if (!hasRealizedPnl(t)) todayNoFill += 1;
      else {
        todayRealizedCount += 1;
      }
    }
  }
  // Month-to-date (local time), from exchange fills
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const startOfMonthMs = startOfMonth.getTime();
  const exchangeFillsMonth = exchangeFills.filter((t) => {
    const ts = t.time ? new Date(t.time).getTime() : 0;
    return ts >= startOfMonthMs;
  });
  const monthSummary = sumExchange(exchangeFillsMonth);
  const monthCloses = exchangeFillsMonth.filter(isRealizedExchangeClose);
  const monthCloseNet = monthCloses.map((r) => Number(r.realizedPnl ?? 0) - Math.abs(Number(r.fee ?? 0)));
  const monthWins = monthCloseNet.filter((v) => v > 0).length;
  const monthLosses = monthCloseNet.filter((v) => v < 0).length;

  const pnlTone = (v: number) =>
    v > 0 ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
      : v < 0 ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-muted-foreground/30 bg-muted/40 text-muted-foreground";
  const refreshSection = () => {
    q.refetch();
    tradesQ.refetch();
  };

  const stats: Array<{ label: string; value: string; hint?: string; tone?: string }> = [
    {
      label: "Today · Trades",
      value: String(closeNetValues.length),
      hint: `${todayAttempts} attempts · ${todayNoFill} no-fill${todayErrors ? ` · ${todayErrors} error` : ""}`,
    },
    { label: "Today · Wins", value: String(todayWins), tone: todayWins > 0 ? "text-emerald-500" : undefined },
    { label: "Today · Losses", value: String(todayLosses), tone: todayLosses > 0 ? "text-destructive" : undefined },
    {
      label: "Today · Win rate",
      value: todayWinRate == null ? "—" : `${todayWinRate.toFixed(0)}%`,
    },
    {
      label: "Today · Net P&L",
      value: closeNetValues.length ? fmtMoney(todayExchangeSummary.net) : "—",
      hint: todayExchangeSummary.hasInr ? fmtInr(todayExchangeSummary.netInr) : "after fees",
      tone: todayExchangeSummary.net > 0 ? "text-emerald-500" : todayExchangeSummary.net < 0 ? "text-destructive" : undefined,
    },
    {
      label: "Today · Fees",
      value: closeNetValues.length ? `${todayExchangeSummary.fees.toFixed(2)} USDT` : "—",
      hint: todayExchangeSummary.hasInr ? `₹${todayExchangeSummary.feesInr.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : undefined,
    },
    {
      label: "R:R · Wins",
      value: avgRWin == null ? "—" : `+${avgRWin.toFixed(2)}R`,
      hint: `${todayWins} win${todayWins === 1 ? "" : "s"}`,
      tone: avgRWin != null ? "text-emerald-500" : undefined,
    },
    {
      label: "R:R · Losses",
      value: avgRLoss == null ? "—" : `${avgRLoss.toFixed(2)}R`,
      hint: `${todayLosses} loss${todayLosses === 1 ? "" : "es"}`,
      tone: avgRLoss != null ? "text-destructive" : undefined,
    },
    {
      label: "Month · Net P&L",
      value: monthCloseNet.length ? fmtMoney(monthSummary.net) : "—",
      hint: `${monthWins}W/${monthLosses}L · after fees`,
      tone: monthSummary.net > 0 ? "text-emerald-500" : monthSummary.net < 0 ? "text-destructive" : undefined,
    },
    {
      label: "Month · Fees",
      value: monthCloseNet.length ? `${monthSummary.fees.toFixed(2)} USDT` : "—",
      hint: monthSummary.hasInr ? `₹${monthSummary.feesInr.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : undefined,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-base">Exchange orders · live</CardTitle>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {data?.fetchedAt && <span>updated {fmtTime(data.fetchedAt)}</span>}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={refreshSection}
              disabled={q.isFetching || tradesQ.isFetching}
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching || tradesQ.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-md border bg-muted/20 px-2.5 py-2 flex flex-col gap-0.5"
              title={s.hint}
            >
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{s.label}</div>
              <div className={`text-sm font-mono font-semibold leading-tight ${s.tone ?? ""}`}>{s.value}</div>
              {s.hint && <div className="text-[10px] text-muted-foreground truncate">{s.hint}</div>}
            </div>
          ))}
        </div>
        {data?.error && (
          <div className="mt-2 text-xs text-destructive">{data.error}</div>
        )}
        {tradesQ.error && (
          <div className="mt-2 text-xs text-destructive">
            {tradesQ.error instanceof Error ? tradesQ.error.message : "Failed to load runner trades"}
          </div>
        )}
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <div className="-mx-2 px-2 overflow-x-auto scrollbar-none">
            <TabsList className="w-max min-w-full flex-nowrap justify-start">
              <TabsTrigger value="server" className="whitespace-nowrap">
                <span className="sm:hidden">Server</span>
                <span className="hidden sm:inline">Pending in server</span>
                <Badge variant="outline" className="ml-2">{serverQueued.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="pending" className="whitespace-nowrap">
                <span className="sm:hidden">Exchange</span>
                <span className="hidden sm:inline">Pending in exchange</span>
                <Badge variant="outline" className="ml-2">{pending.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="live" className="whitespace-nowrap">
                <span className="sm:hidden">Live</span>
                <span className="hidden sm:inline">Live running</span>
                <Badge variant="outline" className="ml-2">{liveRunning.length || executed.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="closed" className="whitespace-nowrap">
                <span className="sm:hidden">Closed</span>
                <span className="hidden sm:inline">Executed &amp; Closed</span>
                <Badge variant="outline" className="ml-2">{exchangeFillsToday.length || finishedToday.length}</Badge>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Pending in server: signals queued locally, not yet sent to exchange */}
          <TabsContent value="server" className="mt-3">
            {serverQueued.length === 0 ? (
              <EmptyRow text="No signals queued on the server." />
            ) : (
              <div className="rounded border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>TF</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Entry</TableHead>
                      <TableHead className="text-right">Stop</TableHead>
                      <TableHead className="text-right">Target</TableHead>
                      <TableHead>Queued</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {serverQueued.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.symbol}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t.timeframe}</TableCell>
                        <TableCell>{sideBadge(t.direction)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtNum(t.qty, 3)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtNum(t.entry_price)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtNum(t.stop_price)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtNum(t.target_price)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtTime(t.entry_ts)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Pending in exchange: open orders on the book (limit, SL, TP) */}
          <TabsContent value="pending" className="mt-3">
            {pending.length === 0 ? (
              <EmptyRow text="No pending orders on the exchange." />
            ) : (
              <div className="rounded border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Trigger</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((o) => {
                      const trigger =
                        o.stopPrice ?? o.stopLossPrice ?? o.takeProfitPrice ?? null;
                      return (
                        <TableRow key={o.clientOrderId}>
                          <TableCell className="font-medium">{o.symbol}</TableCell>
                          <TableCell>{sideBadge(o.side)}</TableCell>
                          <TableCell className="text-xs">{labelForPending(o)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(o.quantity, 3)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(o.price)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(trigger)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{fmtTime(o.createdAt)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              disabled={cancelMut.isPending}
                              onClick={() => cancelMut.mutate(o.clientOrderId)}
                              title="Cancel order"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Executed: currently open positions on the exchange */}
          <TabsContent value="live" className="mt-3">
            {liveRunning.length === 0 && executed.length === 0 ? (
              <EmptyRow text="No live runner trades or open exchange positions." />
            ) : liveRunning.length > 0 ? (
              <div className="rounded border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>TF</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Entry</TableHead>
                      <TableHead className="text-right">Stop</TableHead>
                      <TableHead className="text-right">Target</TableHead>
                      <TableHead>Exchange position</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {liveRunning.map((t) => {
                      const pos = executed.find((p) =>
                        p.symbol.toUpperCase() === t.symbol.toUpperCase() &&
                        ((t.direction === "long" && ["LONG", "BUY"].includes(p.side.toUpperCase())) ||
                          (t.direction === "short" && ["SHORT", "SELL"].includes(p.side.toUpperCase())))
                      );
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="font-medium">{t.symbol}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{t.timeframe}</TableCell>
                          <TableCell>{sideBadge(t.direction)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(t.qty, 3)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(t.fill_price ?? t.entry_price)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(t.stop_price)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(t.target_price)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {pos ? `${fmtNum(pos.qty, 3)} @ ${fmtNum(pos.entryPrice)}` : "not seen"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Entry price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {executed.map((p, i) => (
                        <TableRow key={`${p.symbol}-${p.side}-${i}`}>
                          <TableCell className="font-medium">{p.symbol}</TableCell>
                          <TableCell>{sideBadge(p.side)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(p.qty, 3)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtNum(p.entryPrice)}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Closed: exchange fills first, then no-fill runner attempts */}
          <TabsContent value="closed" className="mt-3">
            {exchangeFillsToday.length === 0 && finishedToday.length === 0 ? (
              <EmptyRow text="No exchange fills or finished runner attempts today." />
            ) : (
              <div className="space-y-3">
                {exchangeFillsToday.length > 0 && (
                  <div className="rounded border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>Symbol</TableHead>
                          <TableHead>Side</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right">Realized</TableHead>
                          <TableHead className="text-right">Fee</TableHead>
                          <TableHead className="text-right">Net</TableHead>
                          <TableHead className="text-right">R:R</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {exchangeFillsToday.map((f) => {
                          const realized = Number(f.realizedPnl ?? 0);
                          const fee = Math.abs(Number(f.fee ?? 0));
                          const net = realized - fee;
                          const isClose = isRealizedExchangeClose(f);
                          const pnlCls = !isClose
                            ? "text-muted-foreground"
                            : net > 0
                              ? "text-emerald-500"
                              : net < 0
                                ? "text-destructive"
                                : "text-muted-foreground";
                          return (
                            <TableRow key={f.id}>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtTime(f.time)}</TableCell>
                              <TableCell className="font-medium">{f.symbol}</TableCell>
                              <TableCell>{sideBadge(f.side)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{f.type || "—"}</TableCell>
                              <TableCell className="text-right font-mono">{fmtNum(f.quantity, 3)}</TableCell>
                              <TableCell className="text-right font-mono">{fmtNum(f.price)}</TableCell>
                              <TableCell className={`text-right font-mono ${pnlCls}`}>{isClose ? fmtMoney(realized, "") : "—"}</TableCell>
                              <TableCell className="text-right font-mono text-muted-foreground">{fee ? fmtNum(fee) : "—"}</TableCell>
                              <TableCell className={`text-right font-mono ${pnlCls}`}>{isClose || fee ? fmtMoney(net, "") : "—"}</TableCell>
                              <TableCell className={`text-right font-mono ${pnlCls}`}>{isClose ? `${(net / riskPerTradeUsd).toFixed(2)}R` : "—"}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {finishedToday.length > 0 && (
                  <div className="rounded border overflow-x-auto">
                    <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b">
                      Runner attempts without exchange P&amp;L
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Exit time</TableHead>
                          <TableHead>Symbol</TableHead>
                          <TableHead>TF</TableHead>
                          <TableHead>Side</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Entry</TableHead>
                          <TableHead className="text-right">Exit</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>Outcome</TableHead>
                          <TableHead className="text-right">Net PnL</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {finishedToday.map((t) => {
                      const pnl = Number(t.net_pnl ?? 0);
                      const realized = hasRealizedPnl(t);
                      const pnlCls =
                        !realized
                          ? "text-muted-foreground"
                          : pnl > 0
                          ? "text-emerald-500"
                          : pnl < 0
                            ? "text-destructive"
                            : "text-muted-foreground";
                      const reason = t.status === "error"
                        ? (t.error ? `error: ${t.error.slice(0, 40)}` : "error")
                        : (t.exit_reason || "—");
                          return (
                            <TableRow key={t.id}>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {fmtTime(t.exit_ts ?? t.entry_ts)}
                              </TableCell>
                              <TableCell className="font-medium">{t.symbol}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{t.timeframe}</TableCell>
                              <TableCell>{sideBadge(t.direction)}</TableCell>
                              <TableCell className="text-right font-mono">{fmtNum(t.qty, 3)}</TableCell>
                              <TableCell className="text-right font-mono">
                                {fmtNum(t.fill_price ?? t.entry_price)}
                              </TableCell>
                              <TableCell className="text-right font-mono">{fmtNum(t.exit_price)}</TableCell>
                              <TableCell className="text-xs">{reason}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{outcomeForTrade(t)}</TableCell>
                              <TableCell className={`text-right font-mono ${pnlCls}`}>
                                {pnlText(t)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-md border p-4 text-sm text-muted-foreground text-center">
      {text}
    </div>
  );
}
