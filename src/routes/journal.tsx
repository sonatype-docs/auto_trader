import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getExchangeAccount } from "@/lib/trading.functions";
import { getPendingSharkOrders } from "@/lib/strategy.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCw, Download, ArrowLeft, BookOpen } from "lucide-react";

export const Route = createFileRoute("/journal")({
  head: () => ({
    meta: [
      { title: "Trading Journal — Shark Auto-Trader" },
      { name: "description", content: "All historical fills, open positions, and upcoming pending orders on SharkExchange." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: JournalPage,
});

const MANUAL_DEPOSITS_INR = [51770, 25000, 25000] as const;
const MANUAL_NET_DEPOSITS_INR = MANUAL_DEPOSITS_INR.reduce((sum, amount) => sum + amount, 0);
const FEE_TYPES = new Set([
  "COMMISSION",
  "GST_ON_COMMISSION",
  "FUNDING_FEE",
  "GST_ON_FUNDING_FEE",
  "FUNDING",
  "INSURANCE_CLEAR",
  "LIQUIDATION",
  "LIQUIDATION_FEE",
]);

type Snap = {
  futuresWallet?: unknown;
  openPositions?: unknown;
  tradeHistory?: unknown;
  transactionHistory?: unknown;
};

function asArray(v: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  if (v && typeof v === "object") {
    const d = (v as { data?: unknown }).data;
    if (Array.isArray(d)) return d as Array<Record<string, unknown>>;
  }
  return [];
}
function asObject(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object") return null;
  const d = (v as { data?: unknown }).data;
  if (d && typeof d === "object" && !Array.isArray(d)) return d as Record<string, unknown>;
  return v as Record<string, unknown>;
}
function parseTime(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  const s = String(v);
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n > 1e12 ? n : n * 1000;
  }
  const d = new Date(s).getTime();
  return Number.isFinite(d) ? d : 0;
}
const fmtINR = (n: number, digits = 2) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const fmtUSD = (n: number, digits = 2) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const fmtNum = (n: number | null | undefined, dp = 2) =>
  n == null || !Number.isFinite(n) ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: dp });

function finiteNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function marginRate(row: Record<string, unknown>): number {
  return finiteNumber(row.marginSettlementRate ?? row.marginConversionRate, 1);
}

function tradeFeeInr(row: Record<string, unknown>): number {
  const direct = finiteNumber(row.feeInMarginAsset, NaN);
  if (Number.isFinite(direct)) return Math.abs(direct);
  return Math.abs(finiteNumber(row.fee) * marginRate(row));
}

function tradePnlInr(row: Record<string, unknown>): number {
  const direct = finiteNumber(row.realizedProfitInMarginAsset, NaN);
  if (Number.isFinite(direct)) return direct;
  return finiteNumber(row.realizedProfit) * marginRate(row);
}

type PendingRow = {
  clientOrderId: string;
  symbol: string;
  side: string;
  type: string;
  status: string;
  price: number | null;
  quantity: number | null;
  filledAmount: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  createdAt: string | null;
};

function JournalPage() {
  const getAcct = useServerFn(getExchangeAccount);
  const getPending = useServerFn(getPendingSharkOrders);

  const acctQ = useQuery({
    queryKey: ["exchange-account"],
    queryFn: () => getAcct(),
    refetchInterval: 15_000,
  });
  const pendingQ = useQuery({
    queryKey: ["shark", "open-orders"],
    queryFn: () => getPending(),
    refetchInterval: 10_000,
  });

  const [symbolFilter, setSymbolFilter] = useState<string>("ALL");
  const [sideFilter, setSideFilter] = useState<"ALL" | "BUY" | "SELL">("ALL");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [closingOnly, setClosingOnly] = useState(false);
  const [chartRange, setChartRange] = useState<"7D" | "30D" | "90D" | "ALL">("30D");
  const [chartAxis, setChartAxis] = useState<"time" | "trade">("time");


  const snap = (acctQ.data?.snapshot ?? null) as Snap | null;

  const {
    journal, allJournal, symbols, equity, walletAsset,
    grossPnl, feesTotal, realizedPnl, netDeposits,
    wins, losses, winRate, todaysPnl, equityCurve, openPositions,
  } = useMemo(() => {
    const fw = asObject(snap?.futuresWallet);
    const exTrades = asArray(snap?.tradeHistory);
    const exTxns = asArray(snap?.transactionHistory);
    const positions = asArray(snap?.openPositions);

    const walletLocked = Number(fw?.lockedBalance ?? 0);
    const walletFree = Number(fw?.withdrawableBalance ?? fw?.availableBalance ?? fw?.balance ?? 0);
    const walletTotal = walletLocked + walletFree;
    const hasWallet = Boolean(fw);
    const walletAsset = String(fw?.asset ?? fw?.marginAsset ?? "INR");

    const tradeFills = exTrades
      .map((t) => ({
        id: String(t.id ?? t.tradeId ?? ""),
        time: parseTime(t.time ?? t.createdAt ?? t.updatedAt),
        symbol: String(t.symbol ?? "—"),
        side: String(t.side ?? "").toUpperCase(),
        qty: Number(t.quantity ?? t.qty ?? 0),
        price: Number(t.price ?? 0),
        fee: tradeFeeInr(t),
        pnl: tradePnlInr(t),
      }))
      .filter((t) => t.time > 0)
      .sort((a, b) => a.time - b.time);

    const pnlTrades = tradeFills
      .filter((t) => Number.isFinite(t.pnl))
      .map((t) => ({ ...t, net: t.pnl - t.fee }));

    const tradeFeesSum = exTrades.reduce((s, t) => s + tradeFeeInr(t), 0);
    const commissionTxSum = exTxns
      .filter((x) => FEE_TYPES.has(String(x.type ?? "").toUpperCase()))
      .reduce((s, x) => s + Math.abs(Number(x.amount ?? 0)), 0);
    const feesTotal = Math.max(tradeFeesSum, commissionTxSum);

    // Deposits & realized P&L from transactionHistory. See index.tsx for rationale.
    const DEPOSIT_TYPES = new Set(["DEPOSIT", "TRANSFER_IN", "FUND_TRANSFER_IN", "INTERNAL_TRANSFER_IN", "CREDIT", "WALLET_DEPOSIT", "USER_DEPOSIT"]);
    const WITHDRAW_TYPES = new Set(["WITHDRAWAL", "WITHDRAW", "TRANSFER_OUT", "FUND_TRANSFER_OUT", "INTERNAL_TRANSFER_OUT", "DEBIT", "WALLET_WITHDRAWAL", "USER_WITHDRAWAL"]);
    const REALIZED_TYPES = new Set(["REALIZED_PNL", "REALIZED_PROFIT", "PNL", "PROFIT_AND_LOSS", "TRADE"]);
    let dIn = 0, dOut = 0, realizedGross = 0, feeChargesSigned = 0;
    for (const x of exTxns) {
      const type = String(x.type ?? "").toUpperCase();
      const amt = Number(x.amount ?? 0);
      if (!Number.isFinite(amt)) continue;
      if (DEPOSIT_TYPES.has(type)) dIn += Math.abs(amt);
      else if (WITHDRAW_TYPES.has(type)) dOut += Math.abs(amt);
      else if (REALIZED_TYPES.has(type)) realizedGross += amt;
      else if (FEE_TYPES.has(type)) feeChargesSigned += amt < 0 ? amt : -amt;
    }
    const explicitNetDeposits = dIn - dOut;
    const tradeHistoryRealized = pnlTrades.reduce((s, t) => s + t.net, 0);
    const realizedFromTx = realizedGross + feeChargesSigned;
    const realizedAllTime = Math.abs(realizedFromTx) > Math.abs(tradeHistoryRealized)
      ? realizedFromTx
      : tradeHistoryRealized;
    const netDeposits = explicitNetDeposits > 0
      ? explicitNetDeposits
      : MANUAL_NET_DEPOSITS_INR;
    const realizedPnl = hasWallet ? walletTotal - netDeposits : realizedAllTime;
    const equity = hasWallet ? walletTotal : netDeposits + realizedPnl;

    const grossPnl = pnlTrades.reduce((s, t) => s + t.pnl, 0);
    const closingFills = pnlTrades.filter((t) => t.pnl !== 0);
    const wins = closingFills.filter((t) => t.net > 0).length;
    const losses = closingFills.filter((t) => t.net < 0).length;
    const decided = wins + losses;
    const winRate = decided ? (wins / decided) * 100 : 0;

    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const todaysPnl = pnlTrades.filter((t) => t.time >= dayStart.getTime()).reduce((s, t) => s + t.net, 0);

    let eqRun = netDeposits;
    const curve: Array<{ t: number; eq: number; i: number }> = [];
    const all: Array<{
      time: number; symbol: string; side: string; qty: number;
      price: number; fee: number; pnl: number; net: number; equity: number; id: string;
    }> = [];
    if (pnlTrades.length > 0) curve.push({ t: pnlTrades[0].time - 60_000, eq: netDeposits, i: 0 });
    else {
      curve.push({ t: Date.now() - 86_400_000, eq: netDeposits, i: 0 });
      curve.push({ t: Date.now(), eq: equity, i: 1 });
    }
    let idx = 1;
    for (const t of pnlTrades) {
      eqRun += t.net;
      curve.push({ t: t.time, eq: eqRun, i: idx });
      all.push({ ...t, equity: eqRun });
      idx += 1;
    }
    if (hasWallet && pnlTrades.length > 0 && Math.abs(equity - eqRun) > 0.01) {
      curve.push({ t: Date.now(), eq: equity, i: idx });
    }


    const symbolSet = new Set<string>(all.map((a) => a.symbol));

    // apply filters
    const fromTs = fromDate ? new Date(fromDate + "T00:00:00").getTime() : 0;
    const toTs = toDate ? new Date(toDate + "T23:59:59").getTime() : Infinity;
    const journal = all.filter((j) => {
      if (symbolFilter !== "ALL" && j.symbol !== symbolFilter) return false;
      if (sideFilter !== "ALL" && j.side !== sideFilter) return false;
      if (j.time < fromTs || j.time > toTs) return false;
      if (closingOnly && j.pnl === 0) return false;
      return true;
    });

    const openPositions = positions.map((p) => ({
      symbol: String(p.symbol ?? "—"),
      side: String(p.side ?? p.positionSide ?? "").toUpperCase(),
      qty: Number(p.quantity ?? p.positionAmt ?? p.qty ?? 0),
      entry: Number(p.entryPrice ?? p.avgPrice ?? 0),
      mark: Number(p.markPrice ?? p.lastPrice ?? 0),
      unrealized: Number(p.unrealizedProfit ?? p.unRealizedProfit ?? p.pnl ?? 0),
      leverage: Number(p.leverage ?? 0),
      margin: Number(p.isolatedMargin ?? p.margin ?? 0),
    }));

    return {
      journal, allJournal: all, symbols: Array.from(symbolSet).sort(),
      equity, walletAsset, grossPnl, feesTotal, realizedPnl, netDeposits,
      wins, losses, winRate, todaysPnl, equityCurve: curve, openPositions,
    };
  }, [snap, symbolFilter, sideFilter, fromDate, toDate, closingOnly]);

  function exportCsv() {
    const rows = [
      ["Time (IST)", "Symbol", "Side", "Qty", "Price", "Fee (USD)", "P&L (USD)", "Net (USD)", "Equity (INR)", "Trade ID"],
      ...journal.map((j) => [
        new Date(j.time).toLocaleString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }),
        j.symbol, j.side, String(j.qty), String(j.price),
        j.fee.toFixed(4), j.pnl.toFixed(2), j.net.toFixed(2), j.equity.toFixed(2), j.id,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trading-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const pending = (pendingQ.data?.rows ?? []) as PendingRow[];

  return (
    <div className="min-h-screen">
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-7xl mx-auto px-3 md:px-6 flex flex-col gap-2 py-2 md:h-14 md:flex-row md:items-center md:justify-between md:py-0">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="w-5 h-5 text-primary shrink-0" />
            <span className="font-mono text-xs sm:text-sm tracking-widest truncate">TRADING JOURNAL</span>
          </div>
          <div className="-mx-3 md:mx-0 overflow-x-auto">
            <div className="flex items-center gap-2 px-3 md:px-0">
              <Link to="/"><Button variant="ghost" size="sm" className="shrink-0"><ArrowLeft className="w-4 h-4 md:mr-2" /><span className="hidden md:inline">Dashboard</span></Button></Link>
              <Link to="/pending-orders"><Button variant="ghost" size="sm" className="shrink-0">Pending</Button></Link>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => { acctQ.refetch(); pendingQ.refetch(); }} disabled={acctQ.isFetching}>
                <RefreshCw className={`w-4 h-4 md:mr-1 ${acctQ.isFetching ? "animate-spin" : ""}`} /><span className="hidden md:inline">Refresh</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-3 md:p-6 space-y-4">

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          <SummaryCell label="EQUITY" value={fmtINR(equity)} />
          <SummaryCell label="NET P&L" value={`${realizedPnl >= 0 ? "+" : ""}${fmtINR(realizedPnl)}`} tone={realizedPnl >= 0 ? "pos" : "neg"} />
          <SummaryCell label="TODAY" value={`${todaysPnl >= 0 ? "+" : ""}${fmtUSD(todaysPnl)}`} tone={todaysPnl >= 0 ? "pos" : "neg"} />
          <SummaryCell label="GROSS P&L" value={`${grossPnl >= 0 ? "+" : ""}${fmtUSD(grossPnl)}`} tone={grossPnl >= 0 ? "pos" : "neg"} />
          <SummaryCell label="FEES" value={fmtUSD(feesTotal, 4)} tone="neg" />
          <SummaryCell label="WIN RATE" value={`${winRate.toFixed(1)}%`} sub={`${wins}W / ${losses}L`} />
          <SummaryCell label="FILLS" value={String(allJournal.length)} sub={`${journal.length} shown`} />
          <SummaryCell label="DEPOSITS" value={fmtINR(netDeposits)} sub={walletAsset} />
        </div>

        {/* Equity curve */}
        <Card>
          <CardHeader className="pb-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 gap-2 flex-wrap">
            <CardTitle className="text-sm font-mono tracking-wide">EQUITY CURVE</CardTitle>
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                {(["7D", "30D", "90D", "ALL"] as const).map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant={chartRange === r ? "default" : "ghost"}
                    className="h-6 px-2 text-[10px] font-mono"
                    onClick={() => setChartRange(r)}
                  >
                    {r}
                  </Button>
                ))}
              </div>
              <div className="flex gap-1 border-l border-border pl-3">
                {(["time", "trade"] as const).map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant={chartAxis === m ? "default" : "ghost"}
                    className="h-6 px-2 text-[10px] font-mono"
                    onClick={() => setChartAxis(m)}
                  >
                    {m === "time" ? "TIME" : "TRADE #"}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="h-56">
            {(() => {
              const now = Date.now();
              const rangeMs =
                chartRange === "7D" ? 7 * 86_400_000 :
                chartRange === "30D" ? 30 * 86_400_000 :
                chartRange === "90D" ? 90 * 86_400_000 : Infinity;
              const cutoff = chartRange === "ALL" ? -Infinity : now - rangeMs;
              const filtered = equityCurve.filter((p) => p.t >= cutoff);
              const data = filtered.length > 1 ? filtered : equityCurve;
              const useTradeAxis = chartAxis === "trade";
              return (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data}>
                    <XAxis
                      dataKey={useTradeAxis ? "i" : "t"}
                      type="number"
                      scale={useTradeAxis ? "linear" : "time"}
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(v) =>
                        useTradeAxis
                          ? `#${v}`
                          : new Date(Number(v)).toLocaleDateString("en-IN")
                      }
                      minTickGap={40}
                      fontSize={10}
                    />
                    <YAxis fontSize={10} domain={["auto", "auto"]} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                    <ReTooltip
                      labelFormatter={(v) =>
                        useTradeAxis
                          ? `Trade #${v}`
                          : new Date(Number(v)).toLocaleString("en-IN", { hour12: false })
                      }
                      formatter={(v: number) => [fmtINR(v), "Equity"]}
                    />
                    <Line type="monotone" dataKey="eq" stroke="oklch(78% 0.16 75)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              );
            })()}
          </CardContent>

        </Card>

        {/* Upcoming pending orders */}
        <Card>
          <CardHeader className="pb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-sm font-mono tracking-wide">UPCOMING · PENDING ORDERS ({pending.length})</CardTitle>
            <span className="text-xs text-muted-foreground">Auto-refresh 10s</span>
          </CardHeader>
          <CardContent>
            {pendingQ.isLoading ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
            ) : pendingQ.data && !pendingQ.data.ok ? (
              <p className="text-xs text-destructive py-4 text-center break-all">Exchange error: {pendingQ.data.error}</p>
            ) : pending.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No pending orders.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border text-left">
                      <th className="py-1.5 pr-3">Order ID</th>
                      <th className="py-1.5 pr-3">Symbol</th>
                      <th className="py-1.5 pr-3">Side</th>
                      <th className="py-1.5 pr-3">Type</th>
                      <th className="py-1.5 pr-3">Status</th>
                      <th className="py-1.5 pr-3 text-right">Price</th>
                      <th className="py-1.5 pr-3 text-right">Qty</th>
                      <th className="py-1.5 pr-3 text-right">Filled</th>
                      <th className="py-1.5 pr-3 text-right">SL</th>
                      <th className="py-1.5 pr-3 text-right">TP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((r) => {
                      const s = r.side.toUpperCase();
                      const tone = s === "BUY" ? "text-emerald-500" : s === "SELL" ? "text-red-500" : "";
                      return (
                        <tr key={r.clientOrderId} className="border-b border-border/40">
                          <td className="py-1.5 pr-3 max-w-[220px] truncate" title={r.clientOrderId}>{r.clientOrderId}</td>
                          <td className="py-1.5 pr-3">{r.symbol}</td>
                          <td className={`py-1.5 pr-3 font-semibold ${tone}`}>{s}</td>
                          <td className="py-1.5 pr-3">{r.type.toUpperCase()}</td>
                          <td className="py-1.5 pr-3"><Badge variant="outline" className="text-[10px]">{r.status}</Badge></td>
                          <td className="py-1.5 pr-3 text-right">{fmtNum(r.price, 2)}</td>
                          <td className="py-1.5 pr-3 text-right">{fmtNum(r.quantity, 4)}</td>
                          <td className="py-1.5 pr-3 text-right">{fmtNum(r.filledAmount, 4)}</td>
                          <td className="py-1.5 pr-3 text-right text-red-400">{fmtNum(r.stopLossPrice, 2)}</td>
                          <td className="py-1.5 pr-3 text-right text-emerald-400">{fmtNum(r.takeProfitPrice, 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Open positions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono tracking-wide">OPEN POSITIONS ({openPositions.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {openPositions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No open positions.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border text-left">
                      <th className="py-1.5 pr-3">Symbol</th>
                      <th className="py-1.5 pr-3">Side</th>
                      <th className="py-1.5 pr-3 text-right">Qty</th>
                      <th className="py-1.5 pr-3 text-right">Entry</th>
                      <th className="py-1.5 pr-3 text-right">Mark</th>
                      <th className="py-1.5 pr-3 text-right">Leverage</th>
                      <th className="py-1.5 pr-3 text-right">Margin</th>
                      <th className="py-1.5 pr-3 text-right">Unrealized P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openPositions.map((p, i) => {
                      const tone = p.unrealized > 0 ? "text-emerald-500" : p.unrealized < 0 ? "text-red-500" : "";
                      return (
                        <tr key={`${p.symbol}-${i}`} className="border-b border-border/40">
                          <td className="py-1.5 pr-3">{p.symbol}</td>
                          <td className={`py-1.5 pr-3 font-semibold ${p.side === "BUY" || p.side === "LONG" ? "text-emerald-500" : "text-red-500"}`}>{p.side || "—"}</td>
                          <td className="py-1.5 pr-3 text-right">{fmtNum(p.qty, 4)}</td>
                          <td className="py-1.5 pr-3 text-right">{fmtNum(p.entry, 2)}</td>
                          <td className="py-1.5 pr-3 text-right">{fmtNum(p.mark, 2)}</td>
                          <td className="py-1.5 pr-3 text-right">{p.leverage ? `${p.leverage}x` : "—"}</td>
                          <td className="py-1.5 pr-3 text-right">{p.margin ? fmtINR(p.margin) : "—"}</td>
                          <td className={`py-1.5 pr-3 text-right ${tone}`}>{`${p.unrealized >= 0 ? "+" : ""}${fmtINR(p.unrealized)}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Historical fills */}
        <Card>
          <CardHeader className="pb-2 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-sm font-mono tracking-wide">
                HISTORICAL FILLS ({journal.length} / {allJournal.length})
              </CardTitle>
              <Button size="sm" variant="outline" onClick={exportCsv} disabled={journal.length === 0}>
                <Download className="w-4 h-4 mr-1" /> Export CSV
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
              <div>
                <Label className="text-[10px] text-muted-foreground">Symbol</Label>
                <select
                  className="w-full h-8 rounded border border-border bg-background px-2 text-xs font-mono"
                  value={symbolFilter}
                  onChange={(e) => setSymbolFilter(e.target.value)}
                >
                  <option value="ALL">All</option>
                  {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Side</Label>
                <select
                  className="w-full h-8 rounded border border-border bg-background px-2 text-xs font-mono"
                  value={sideFilter}
                  onChange={(e) => setSideFilter(e.target.value as "ALL" | "BUY" | "SELL")}
                >
                  <option value="ALL">All</option>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">From</Label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">To</Label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 text-xs" />
              </div>
              <label className="flex items-center gap-2 text-xs h-8">
                <input type="checkbox" checked={closingOnly} onChange={(e) => setClosingOnly(e.target.checked)} />
                Closing fills only
              </label>
            </div>
          </CardHeader>
          <CardContent>
            {!acctQ.data ? (
              <p className="text-xs text-muted-foreground py-6 text-center">Loading trade history…</p>
            ) : acctQ.data && !acctQ.data.ok ? (
              <p className="text-xs text-destructive py-6 text-center">{acctQ.data.message}</p>
            ) : journal.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">
                No trades match the filters.
              </p>
            ) : (
              <div className="max-h-[600px] overflow-y-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="text-muted-foreground sticky top-0 bg-background">
                    <tr>
                      <th className="text-left py-1.5">Time (IST)</th>
                      <th className="text-left py-1.5">Symbol</th>
                      <th className="text-left py-1.5">Side</th>
                      <th className="text-right py-1.5">Qty</th>
                      <th className="text-right py-1.5">Price</th>
                      <th className="text-right py-1.5">Fee</th>
                      <th className="text-right py-1.5">P&amp;L</th>
                      <th className="text-right py-1.5">Net</th>
                      <th className="text-right py-1.5">Equity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...journal].reverse().map((j, i) => (
                      <tr key={j.id || `${j.time}-${i}`} className="border-t border-border">
                        <td className="py-1.5 text-muted-foreground whitespace-nowrap pr-3">
                          {new Date(j.time).toLocaleString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" })}
                        </td>
                        <td className="pr-3">{j.symbol}</td>
                        <td className={`pr-3 font-semibold ${j.side === "BUY" ? "text-emerald-500" : "text-red-500"}`}>{j.side || "—"}</td>
                        <td className="text-right pr-3">{fmtNum(j.qty, 6)}</td>
                        <td className="text-right pr-3">{fmtNum(j.price, 4)}</td>
                        <td className="text-right pr-3 text-red-400">{fmtUSD(j.fee, 4)}</td>
                        <td className={`text-right pr-3 ${j.pnl > 0 ? "text-emerald-500" : j.pnl < 0 ? "text-red-500" : ""}`}>
                          {j.pnl === 0 ? "—" : `${j.pnl > 0 ? "+" : ""}${fmtUSD(j.pnl)}`}
                        </td>
                        <td className={`text-right pr-3 ${j.net > 0 ? "text-emerald-500" : j.net < 0 ? "text-red-500" : ""}`}>
                          {`${j.net >= 0 ? "+" : ""}${fmtUSD(j.net)}`}
                        </td>
                        <td className="text-right">{fmtINR(j.equity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function SummaryCell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  const toneCls = tone === "pos" ? "text-emerald-500" : tone === "neg" ? "text-red-500" : "";
  return (
    <div className="rounded border border-border p-2">
      <div className="text-[10px] text-muted-foreground font-mono tracking-widest">{label}</div>
      <div className={`text-sm font-mono font-semibold ${toneCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground font-mono">{sub}</div>}
    </div>
  );
}
