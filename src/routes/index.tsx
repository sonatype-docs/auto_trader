import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getDashboard,
  updateSettings,
  getMarketTicker,
  getExchangeAccount,
} from "@/lib/trading.functions";
import {
  getStrategyState,
  getStrategyTimeline,
  getSetupTimeline,
  runStrategyTickNow,
  repriceArmedNow,
  updateStrategySettings,
  listStrategyPresets,
  createStrategyPreset,
  deleteStrategyPreset,
  applyStrategyPreset,
  editLiveTradeLevels,
  closeLiveTradeNow,
  cancelAndReArmWithAi,
  runOrderWatchdog,
} from "@/lib/strategy.functions";



import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Settings as SettingsIcon,
  Zap,
  Shield,
  BookOpen,
  Beaker,
  ChevronDown,
  ListOrdered,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Dashboard — Shark Auto-Trader" },
      { name: "description", content: "Live trading control panel." },
    ],
  }),
});

function StatusBar({
  paperMode,
  killSwitch,
}: {
  paperMode: boolean;
  killSwitch: boolean;
}) {
  const state = killSwitch ? "KILLED" : paperMode ? "PAPER" : "LIVE";
  const cls =
    state === "KILLED"
      ? "bg-destructive-soft"
      : state === "PAPER"
        ? "bg-warning-soft"
        : "bg-success-soft";
  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1 rounded font-mono text-xs tracking-widest ${cls}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {state}
    </div>
  );
}

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

function Dashboard() {
  const qc = useQueryClient();
  const getDash = useServerFn(getDashboard);
  const updateSettingsFn = useServerFn(updateSettings);
  
  const getAcct = useServerFn(getExchangeAccount);

  const dashQ = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDash(),
    refetchInterval: 5000,
  });
  const acctQ = useQuery({
    queryKey: ["exchange-account"],
    queryFn: () => getAcct(),
    refetchInterval: 15000,
  });

  const settingsMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      updateSettingsFn({ data: patch as never }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Settings updated");
    },
    onError: (e) => toast.error(e.message),
  });


  if (!dashQ.data) {
    return <div className="p-8 text-muted-foreground">Loading dashboard…</div>;
  }

  const { settings, orders, positions, logs } = dashQ.data;

  // Live metrics from SharkExchange account snapshot
  const snap = (acctQ.data?.snapshot ?? null) as Snap | null;
  const fw = asObject(snap?.futuresWallet);
  const exTrades = asArray(snap?.tradeHistory);
  const exTxns = asArray(snap?.transactionHistory);
  const exPositions = asArray(snap?.openPositions);

  const walletLocked = Number(fw?.lockedBalance ?? 0);
  const walletFree = Number(
    fw?.withdrawableBalance ?? fw?.availableBalance ?? fw?.balance ?? 0,
  );
  const walletTotal = walletLocked + walletFree;
  const walletAsset = String(fw?.asset ?? fw?.marginAsset ?? "INR");

  const tradeFeesSum = exTrades.reduce((s, t) => s + tradeFeeInr(t), 0);
  const commissionTxSum = exTxns
    .filter((x) => FEE_TYPES.has(String(x.type ?? "").toUpperCase()))
    .reduce((s, x) => s + Math.abs(Number(x.amount ?? 0)), 0);
  // Commissions in transactionHistory and fees on trades represent the same charges —
  // pick the higher of the two to avoid double counting while still catching any fills
  // that fell outside the trade-history page.
  const feesTotal = Math.max(tradeFeesSum, commissionTxSum);

  const parseTime = (v: unknown): number => {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return v > 1e12 ? v : v * 1000;
    const s = String(v);
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      return n > 1e12 ? n : n * 1000;
    }
    const d = new Date(s).getTime();
    return Number.isFinite(d) ? d : 0;
  };

  // Journal-ready trade fills sorted chronologically (oldest → newest).
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
      raw: t,
    }))
    .filter((t) => t.time > 0)
    .sort((a, b) => a.time - b.time);

  // Per-fill net used for win/loss stats and today's P&L.
  const pnlTrades = tradeFills
    .filter((t) => Number.isFinite(t.pnl))
    .map((t) => ({ ...t, net: t.pnl - t.fee }));

  const grossPnl = pnlTrades.reduce((s, t) => s + t.pnl, 0);

  // A fill is only counted as a win/loss if it actually closed something (has non-zero P&L).
  const closingFills = pnlTrades.filter((t) => t.pnl !== 0);
  const wins = closingFills.filter((t) => t.net > 0).length;
  const losses = closingFills.filter((t) => t.net < 0).length;
  const decided = wins + losses;
  const winRate = decided ? (wins / decided) * 100 : 0;
  const lossRate = decided ? (losses / decided) * 100 : 0;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const todaysPnl = pnlTrades
    .filter((t) => t.time >= dayStart.getTime())
    .reduce((s, t) => s + t.net, 0);

  const hasWallet = Boolean(fw);

  // Deposits & realized P&L from transactionHistory.
  // SharkExchange doesn't currently expose a dedicated deposit-history endpoint,
  // but every wallet movement (deposits, withdrawals, realized P&L, commissions,
  // funding fees, liquidations) surfaces in /v1/user-data/transaction-history.
  // Strategy: capture any explicit deposit/withdrawal entries AND derive net
  // deposits from wallet - realized_from_tx, so the equity math still works even
  // when the exchange doesn't tag entries as DEPOSIT.
  const DEPOSIT_TYPES = new Set(["DEPOSIT", "TRANSFER_IN", "FUND_TRANSFER_IN", "INTERNAL_TRANSFER_IN", "CREDIT", "WALLET_DEPOSIT", "USER_DEPOSIT"]);
  const WITHDRAW_TYPES = new Set(["WITHDRAWAL", "WITHDRAW", "TRANSFER_OUT", "FUND_TRANSFER_OUT", "INTERNAL_TRANSFER_OUT", "DEBIT", "WALLET_WITHDRAWAL", "USER_WITHDRAWAL"]);
  const REALIZED_TYPES = new Set(["REALIZED_PNL", "REALIZED_PROFIT", "PNL", "PROFIT_AND_LOSS", "TRADE"]);
  let depositsIn = 0;
  let depositsOut = 0;
  let realizedGross = 0;
  let feeChargesSigned = 0; // typically negative
  for (const x of exTxns) {
    const type = String(x.type ?? "").toUpperCase();
    const amt = Number(x.amount ?? 0);
    if (!Number.isFinite(amt)) continue;
    if (DEPOSIT_TYPES.has(type)) depositsIn += Math.abs(amt);
    else if (WITHDRAW_TYPES.has(type)) depositsOut += Math.abs(amt);
    else if (REALIZED_TYPES.has(type)) realizedGross += amt;
    else if (FEE_TYPES.has(type)) feeChargesSigned += amt < 0 ? amt : -amt;
  }
  const explicitNetDeposits = depositsIn - depositsOut;
  const realizedFromTx = realizedGross + feeChargesSigned;
  const tradeHistoryRealized = pnlTrades.reduce((s, t) => s + t.net, 0);
  // Prefer the richer of the two realized signals (txn-history usually complete,
  // trade-history can be a truncated page).
  const realizedAllTime = Math.abs(realizedFromTx) > Math.abs(tradeHistoryRealized)
    ? realizedFromTx
    : tradeHistoryRealized;

  // netDeposits = the actual capital placed on the exchange.
  // Shark currently omits deposit rows from transactionHistory, so keep the
  // user's known cash deposits as the authoritative fallback: 51,770 + 25,000 + 25,000.
  const netDeposits = explicitNetDeposits > 0
    ? explicitNetDeposits
    : MANUAL_NET_DEPOSITS_INR;
  const netDepositsSource = explicitNetDeposits > 0 ? "from exchange txns" : "manual deposits";

  // Definitive realized P&L when there are no open positions:
  //   wallet_now - net_deposits.  Falls back to trade-history sum only when wallet is unknown.
  const realizedPnl = hasWallet ? walletTotal - netDeposits : realizedAllTime;

  const equity = hasWallet ? walletTotal : netDeposits + realizedPnl;
  const equityChange = equity - netDeposits;
  const equityChangePct = netDeposits > 0 ? (equityChange / netDeposits) * 100 : 0;



  // Equity curve in INR: start at net deposits, cumulate trade-history net per fill,
  // then anchor the final point to the true current wallet so the chart reconciles
  // with the top-level EQUITY / REALIZED P&L metrics.
  let eqRun = netDeposits;
  const equityCurve: Array<{ t: number; eq: number }> = [];
  if (pnlTrades.length > 0) {
    equityCurve.push({ t: pnlTrades[0].time - 60_000, eq: netDeposits });
  } else {
    equityCurve.push({ t: Date.now() - 86_400_000, eq: netDeposits });
    equityCurve.push({ t: Date.now(), eq: equity });
  }
  for (const t of pnlTrades) {
    eqRun += t.pnl - t.fee;
    equityCurve.push({ t: t.time, eq: eqRun });
  }
  // Reconcile last point with real wallet if there's drift (trade history may be paged).
  if (hasWallet && pnlTrades.length > 0 && Math.abs(equity - eqRun) > 0.01) {
    equityCurve.push({ t: Date.now(), eq: equity });
  }


  const fmtINR = (n: number, digits = 2) =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;



  return (
    <div className="min-h-screen">
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-7xl mx-auto px-3 md:px-6 min-h-14 flex flex-col gap-2 py-2 md:flex-row md:items-center md:justify-between md:py-0">
          <div className="flex items-center gap-2 min-w-0">
            <Activity className="w-5 h-5 text-primary shrink-0" />
            <span className="font-mono text-xs sm:text-sm tracking-widest truncate">SHARK.AUTO</span>
            <StatusBar
              paperMode={!!settings?.paper_mode}
              killSwitch={!!settings?.kill_switch}
            />
          </div>
          <div className="-mx-3 md:mx-0 overflow-x-auto">
            <div className="flex items-center gap-1 px-3 md:px-0 md:flex-wrap">
              <Link to="/backtest">
                <Button variant="ghost" size="sm" className="shrink-0">
                  <Beaker className="w-4 h-4 md:mr-2" /> <span className="hidden md:inline">Backtest</span>
                </Button>
              </Link>
              <Link to="/pending-orders">
                <Button variant="ghost" size="sm" className="shrink-0">
                  <ListOrdered className="w-4 h-4 md:mr-2" /> <span className="hidden md:inline">Pending Orders</span>
                </Button>
              </Link>
              <Link to="/journal">
                <Button variant="ghost" size="sm" className="shrink-0">
                  <BookOpen className="w-4 h-4 md:mr-2" /> <span className="hidden md:inline">Journal</span>
                </Button>
              </Link>
              <Link to="/docs">
                <Button variant="ghost" size="sm" className="shrink-0">
                  <BookOpen className="w-4 h-4 md:mr-2" /> <span className="hidden md:inline">Webhook setup</span>
                </Button>
              </Link>
              <Link to="/settings">
                <Button variant="ghost" size="sm" className="shrink-0">
                  <SettingsIcon className="w-4 h-4 md:mr-2" /> <span className="hidden md:inline">Settings</span>
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-4 md:space-y-6">

        <LiveTicker defaultSymbol="XAUUSDT" />


        <StrategyCard />




        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Metric
            label={`EQUITY (${walletAsset})`}
            value={fmtINR(equity)}
            sub={`${equityChange >= 0 ? "+" : ""}${fmtINR(equityChange)} (${equityChangePct >= 0 ? "+" : ""}${equityChangePct.toFixed(2)}%)`}
            tone={equityChange >= 0 ? "long" : "short"}
          />
          <Metric
            label="REALIZED P&L (NET)"
            value={`${realizedPnl >= 0 ? "+" : ""}${fmtINR(realizedPnl)}`}
            sub={`Today ${todaysPnl >= 0 ? "+" : ""}${fmtINR(todaysPnl)}`}
            tone={realizedPnl >= 0 ? "long" : "short"}
          />
          <Metric
            label="OPEN POS"
            value={String(exPositions.length || positions.length)}
            sub={`Free ${fmtINR(walletFree)}`}
          />
          <Metric
            label="TOTAL FEES"
            value={fmtINR(feesTotal, 4)}
            sub={`${exTrades.length} trades`}
            tone="short"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Metric label="WIN RATE" value={`${winRate.toFixed(1)}%`} sub={`${wins}/${decided} closes`} tone="long" />
          <Metric label="LOSS RATE" value={`${lossRate.toFixed(1)}%`} sub={`${losses}/${decided} closes`} tone="short" />
          <Metric
            label="DEPOSITS"
            value={fmtINR(netDeposits)}
            sub={
              netDepositsSource
            }
          />
          <Metric label="LOCKED MARGIN" value={fmtINR(walletLocked)} />
        </div>

        <ExchangeAccount />






        <Card>
          <CardHeader className="pb-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-sm font-mono tracking-wide">
              EQUITY CURVE
            </CardTitle>
            <span className="text-xs font-mono text-muted-foreground">
              {fmtINR(equity)} · {pnlTrades.length} fills
            </span>
          </CardHeader>
          <CardContent className="h-56">
            {equityCurve.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                No realized P&amp;L yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityCurve}>
                  <XAxis
                    dataKey="t"
                    tickFormatter={(v) => new Date(v).toLocaleDateString()}
                    stroke="var(--muted-foreground)"
                    fontSize={10}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={10}
                    domain={["auto", "auto"]}
                    tickFormatter={(v) => fmtINR(Number(v), 0)}
                  />
                  <ReTooltip
                    contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)" }}
                    labelFormatter={(v) => new Date(v).toLocaleString()}
                    formatter={(v: number) => [fmtINR(v), "P&L"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="eq"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>



        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono tracking-wide">POSITIONS</CardTitle>
          </CardHeader>
          <CardContent>
            {positions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No open positions.</p>
            ) : (
              <table className="w-full text-sm font-mono">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left py-1">Symbol</th>
                    <th className="text-right py-1">Qty</th>
                    <th className="text-right py-1">Avg Entry</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.symbol} className="border-t border-border">
                      <td className="py-2">{p.symbol}</td>
                      <td className={`text-right ${Number(p.qty) > 0 ? "text-long" : "text-short"}`}>
                        {Number(p.qty).toFixed(6)}
                      </td>
                      <td className="text-right">${Number(p.avg_entry_price).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>


        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono tracking-wide">RECENT ORDERS</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {orders.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">No orders yet.</p>
            ) : (
              <table className="w-full text-sm font-mono">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left py-1">Time</th>
                    <th className="text-left py-1">Symbol</th>
                    <th className="text-left py-1">Side</th>
                    <th className="text-right py-1">Qty</th>
                    <th className="text-right py-1">Price</th>
                    <th className="text-left py-1 pl-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-t border-border">
                      <td className="py-2 text-xs text-muted-foreground">
                        {new Date(o.created_at).toLocaleTimeString()}
                      </td>
                      <td>{o.symbol}</td>
                      <td>
                        <span className={o.side === "buy" ? "text-long" : "text-short"}>
                          {o.side === "buy" ? <ArrowUpRight className="inline w-3 h-3" /> : <ArrowDownRight className="inline w-3 h-3" />}{" "}
                          {o.side}
                        </span>
                      </td>
                      <td className="text-right">{Number(o.qty).toFixed(6)}</td>
                      <td className="text-right">${Number(o.filled_price ?? o.price ?? 0).toFixed(2)}</td>
                      <td className="pl-3">
                        <Badge variant={o.status === "filled" ? "default" : o.status === "rejected" ? "destructive" : "secondary"}>
                          {o.status}
                        </Badge>
                        {o.paper && <span className="ml-2 text-xs text-warning">paper</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono tracking-wide">ACTIVITY LOG</CardTitle>
          </CardHeader>
          <CardContent className="max-h-80 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">Quiet.</p>
            ) : (
              <ul className="space-y-2 text-xs font-mono">
                {logs.map((l) => (
                  <li key={l.id} className="flex gap-2">
                    <span className="text-muted-foreground shrink-0">
                      {new Date(l.created_at).toLocaleTimeString()}
                    </span>
                    <span
                      className={
                        l.severity === "error"
                          ? "text-destructive"
                          : l.severity === "warn"
                            ? "text-warning"
                            : ""
                      }
                    >
                      [{l.severity}]
                    </span>
                    <span>{l.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "long" | "short";
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs font-mono text-muted-foreground tracking-widest">{label}</div>
        <div
          className={`text-2xl font-mono mt-1 ${
            tone === "long" ? "text-long" : tone === "short" ? "text-short" : ""
          }`}
        >
          {value}
        </div>
        {sub && (
          <div className="text-[10px] font-mono text-muted-foreground mt-1">{sub}</div>
        )}
      </CardContent>
    </Card>
  );
}

function PositionPnLCell({
  symbol,
  side,
  qty,
  entry,
  nativePnl,
}: {
  symbol: string;
  side: string;
  qty: number;
  entry: number;
  nativePnl: number;
}) {
  const getTicker = useServerFn(getMarketTicker);
  const q = useQuery({
    queryKey: ["pos-ticker", symbol],
    queryFn: () => getTicker({ data: { symbol } }),
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    enabled: !!symbol,
  });
  const last = Number(q.data?.lastPrice ?? NaN);
  let pnl = Number.isFinite(nativePnl) ? nativePnl : NaN;
  if (!Number.isFinite(pnl) && Number.isFinite(last) && Number.isFinite(entry) && Number.isFinite(qty)) {
    const dir = side === "LONG" ? 1 : side === "SHORT" ? -1 : 0;
    pnl = dir * (last - entry) * qty;
  }
  const good = Number.isFinite(pnl) && pnl >= 0;
  return (
    <td className={`text-right ${good ? "text-long" : "text-short"}`}>
      {Number.isFinite(pnl)
        ? `${pnl >= 0 ? "+" : ""}${pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "—"}
      {q.isFetching && <span className="ml-1 text-[9px] text-muted-foreground">•</span>}
    </td>
  );
}

function LiveTicker({ defaultSymbol }: { defaultSymbol: string }) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [input, setInput] = useState(defaultSymbol);
  const getTicker = useServerFn(getMarketTicker);
  const q = useQuery({
    queryKey: ["ticker", symbol],
    queryFn: () => getTicker({ data: { symbol } }),
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
  });

  const fmt = (v: number | null | undefined, digits = 2) =>
    v === null || v === undefined || Number.isNaN(v)
      ? "—"
      : v.toLocaleString(undefined, {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });

  const t = q.data;
  const pct = t?.priceChangePct ?? 0;
  const up = pct >= 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm font-mono tracking-wide flex items-center gap-2">
            LIVE TICKER · {symbol}
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-[10px] text-muted-foreground">
              {q.isFetching ? "updating…" : "live"}
            </span>
          </CardTitle>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const s = input.trim().toUpperCase();
              if (/^[A-Z0-9]{3,24}$/.test(s)) setSymbol(s);
              else toast.error("Symbol must be uppercase alphanumeric (e.g. XAUUSDT)");
            }}
            className="flex items-center gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              className="h-8 w-32 font-mono text-xs"
              placeholder="XAUUSDT"
            />
            <Button type="submit" size="sm" variant="secondary" className="h-8">
              Load
            </Button>
          </form>
        </div>
      </CardHeader>
      <CardContent>
        {q.isError ? (
          <div className="text-xs text-destructive font-mono py-4">
            {q.error instanceof Error ? q.error.message : "Failed to load ticker."}
          </div>
        ) : !t ? (
          <div className="text-xs text-muted-foreground py-4">Loading ticker…</div>
        ) : (
          <>
            <div className="flex items-baseline gap-4 flex-wrap">
              <div className={`text-4xl font-mono ${up ? "text-long" : "text-short"}`}>
                {fmt(t.lastPrice, 2)}
              </div>
              <div
                className={`text-sm font-mono ${up ? "text-long" : "text-short"} flex items-center gap-1`}
              >
                {up ? (
                  <ArrowUpRight className="w-4 h-4" />
                ) : (
                  <ArrowDownRight className="w-4 h-4" />
                )}
                {up ? "+" : ""}
                {fmt(t.priceChange, 2)} ({up ? "+" : ""}
                {fmt(t.priceChangePct, 2)}%)
              </div>
              <div className="text-[10px] text-muted-foreground font-mono ml-auto">
                {t.eventTime ? new Date(t.eventTime).toLocaleTimeString() : ""}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-2 mt-4 text-xs font-mono">
              <TickerStat label="24H OPEN" value={fmt(t.open, 2)} />
              <TickerStat label="24H HIGH" value={fmt(t.high, 2)} tone="long" />
              <TickerStat label="24H LOW" value={fmt(t.low, 2)} tone="short" />
              <TickerStat label="24H VOL" value={fmt(t.volume, 3)} />
              <TickerStat label="TRADES" value={fmt(t.trades, 0)} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TickerStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "long" | "short";
}) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground tracking-widest">{label}</div>
      <div
        className={`mt-0.5 ${tone === "long" ? "text-long" : tone === "short" ? "text-short" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

type Snap = {
  futuresWallet?: unknown;
  fundingWallet?: unknown;
  openPositions?: unknown;
  openOrders?: unknown;
  tradeHistory?: unknown;
  transactionHistory?: unknown;
  errors?: Record<string, string>;
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

function num(v: unknown, digits = 2): string {
  const n = typeof v === "number" ? v : v == null ? NaN : Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function ExchangeAccount() {
  const getAcct = useServerFn(getExchangeAccount);
  const q = useQuery({
    queryKey: ["exchange-account"],
    queryFn: () => getAcct(),
    refetchInterval: 15000,
  });

  const snap = (q.data?.snapshot ?? null) as Snap | null;
  const fw = asObject(snap?.futuresWallet);
  const fund = asObject(snap?.fundingWallet);
  const positions = asArray(snap?.openPositions);
  const openOrders = asArray(snap?.openOrders);
  const trades = asArray(snap?.tradeHistory);
  const txns = asArray(snap?.transactionHistory);
  const errors = snap?.errors ?? {};

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono tracking-wide flex items-center gap-2">
            SHARKEXCHANGE ACCOUNT
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-[10px] text-muted-foreground">
              {q.isFetching ? "syncing…" : "live"}
            </span>
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            className="h-7 text-xs"
          >
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {q.data && !q.data.ok && (
          <div className="text-xs font-mono text-destructive">{q.data.message}</div>
        )}
        {!q.data && <div className="text-xs text-muted-foreground">Loading account…</div>}

        {/* Wallets */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <WalletCard title="FUTURES WALLET" data={fw} error={errors.futuresWallet} />
          <WalletCard title="FUNDING WALLET" data={fund} error={errors.fundingWallet} />
        </div>

        {/* Open positions */}
        <div>
          <div className="text-xs font-mono text-muted-foreground tracking-widest mb-2">
            OPEN POSITIONS ({positions.length})
            {errors.openPositions && (
              <span className="text-destructive ml-2">· {errors.openPositions}</span>
            )}
          </div>
          {positions.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3">No open positions on the exchange.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left py-1">Symbol</th>
                    <th className="text-left py-1">Side</th>
                    <th className="text-right py-1">Qty</th>
                    <th className="text-right py-1">Entry</th>
                    <th className="text-right py-1">Liq</th>
                    <th className="text-right py-1">Lev</th>
                    <th className="text-right py-1">Margin</th>
                    <th className="text-right py-1">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p, i) => {
                    const side = String(p.positionType ?? "");
                    const long = side === "LONG";
                    return (
                      <tr key={String(p.positionId ?? i)} className="border-t border-border">
                        <td className="py-1">{String(p.contractPair ?? p.symbol ?? "—")}</td>
                        <td className={long ? "text-long" : "text-short"}>{side}</td>
                        <td className="text-right">{num(p.quantity, 6)}</td>
                        <td className="text-right">{num(p.entryPrice)}</td>
                        <td className="text-right">{num(p.liquidationPrice)}</td>
                        <td className="text-right">{num(p.leverage, 0)}x</td>
                        <td className="text-right">{num(p.margin)} {String(p.marginAsset ?? "")}</td>
                        <PositionPnLCell
                          symbol={String(p.contractPair ?? p.symbol ?? "")}
                          side={side}
                          qty={Number(p.quantity ?? 0)}
                          entry={Number(p.entryPrice ?? 0)}
                          nativePnl={
                            Number(
                              (p as Record<string, unknown>).unrealizedProfit ??
                                (p as Record<string, unknown>).unRealizedProfit ??
                                (p as Record<string, unknown>).unrealisedPnl ??
                                (p as Record<string, unknown>).unrealizedPnl ??
                                (p as Record<string, unknown>).pnl ??
                                NaN,
                            )
                          }
                        />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Open orders */}
        <div>
          <div className="text-xs font-mono text-muted-foreground tracking-widest mb-2">
            OPEN ORDERS ({openOrders.length})
            {errors.openOrders && (
              <span className="text-destructive ml-2">· {errors.openOrders}</span>
            )}
          </div>
          {openOrders.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3">No resting orders.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left py-1">Time</th>
                    <th className="text-left py-1">Symbol</th>
                    <th className="text-left py-1">Side</th>
                    <th className="text-left py-1">Type</th>
                    <th className="text-right py-1">Qty</th>
                    <th className="text-right py-1">Price</th>
                    <th className="text-right py-1">Filled</th>
                  </tr>
                </thead>
                <tbody>
                  {openOrders.map((o, i) => (
                    <tr key={String(o.clientOrderId ?? i)} className="border-t border-border">
                      <td className="py-1 text-muted-foreground">
                        {o.time ? new Date(String(o.time)).toLocaleTimeString() : "—"}
                      </td>
                      <td>{String(o.symbol ?? "—")}</td>
                      <td className={String(o.side) === "BUY" ? "text-long" : "text-short"}>
                        {String(o.side ?? "—")}
                      </td>
                      <td>{String(o.type ?? "—")}</td>
                      <td className="text-right">{num(o.orderAmount, 6)}</td>
                      <td className="text-right">{num(o.price)}</td>
                      <td className="text-right">{num(o.filledAmount, 6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Trade history */}
          <div>
            <div className="text-xs font-mono text-muted-foreground tracking-widest mb-2">
              RECENT TRADES ({trades.length})
              {errors.tradeHistory && (
                <span className="text-destructive ml-2">· {errors.tradeHistory}</span>
              )}
            </div>
            {trades.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">No trades yet.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="text-muted-foreground sticky top-0 bg-background">
                    <tr>
                      <th className="text-left py-1">Time</th>
                      <th className="text-left py-1">Symbol</th>
                      <th className="text-left py-1">Side</th>
                      <th className="text-right py-1">Qty</th>
                      <th className="text-right py-1">Price</th>
                      <th className="text-right py-1">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => (
                      <tr key={String(t.id ?? i)} className="border-t border-border">
                        <td className="py-1 text-muted-foreground">
                          {t.time ? new Date(String(t.time)).toLocaleTimeString() : "—"}
                        </td>
                        <td>{String(t.symbol ?? "—")}</td>
                        <td className={String(t.side) === "BUY" ? "text-long" : "text-short"}>
                          {String(t.side ?? "—")}
                        </td>
                        <td className="text-right">{num(t.quantity, 6)}</td>
                        <td className="text-right">{num(t.price)}</td>
                        <td className="text-right">{num(t.fee, 4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Transaction history */}
          <div>
            <div className="text-xs font-mono text-muted-foreground tracking-widest mb-2">
              TRANSACTIONS ({txns.length})
              {errors.transactionHistory && (
                <span className="text-destructive ml-2">· {errors.transactionHistory}</span>
              )}
            </div>
            {txns.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">No transactions.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="text-muted-foreground sticky top-0 bg-background">
                    <tr>
                      <th className="text-left py-1">Time</th>
                      <th className="text-left py-1">Type</th>
                      <th className="text-left py-1">Symbol</th>
                      <th className="text-right py-1">Amount</th>
                      <th className="text-left py-1 pl-2">Asset</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txns.map((x, i) => {
                      const amt = Number(x.amount ?? 0);
                      return (
                        <tr key={String(x.id ?? i)} className="border-t border-border">
                          <td className="py-1 text-muted-foreground">
                            {x.time ? new Date(String(x.time)).toLocaleTimeString() : "—"}
                          </td>
                          <td>{String(x.type ?? "—")}</td>
                          <td>{String(x.symbol ?? "—")}</td>
                          <td className={`text-right ${amt >= 0 ? "text-long" : "text-short"}`}>
                            {amt >= 0 ? "+" : ""}{num(amt, 4)}
                          </td>
                          <td className="pl-2">{String(x.asset ?? "—")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WalletCard({
  title,
  data,
  error,
}: {
  title: string;
  data: Record<string, unknown> | null;
  error?: string;
}) {
  const entries = data
    ? Object.entries(data).filter(([, v]) => v !== null && typeof v !== "object")
    : [];
  return (
    <div className="border border-border rounded-md p-3">
      <div className="text-xs font-mono text-muted-foreground tracking-widest mb-2">{title}</div>
      {error ? (
        <div className="text-xs text-destructive font-mono">{error}</div>
      ) : entries.length === 0 ? (
        <div className="text-xs text-muted-foreground">No data.</div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
          {entries.map(([k, v]) => (
            <div key={k} className="flex justify-between col-span-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{typeof v === "number" ? num(v, 4) : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}


type PlacementSetup = {
  status: string;
  qty: number;
  exchange_order_id?: string | null;
  placement_status?: string | null;
  placement_leverage?: number | null;
  placement_error?: string | null;
  placement_capped?: boolean | null;
  requested_qty?: number | null;
  placement_attempts?: number | null;
  placement_at?: string | null;
};

function PlacementStatusRow({ setup }: { setup: PlacementSetup }) {
  const ps = setup.placement_status;
  if (!ps) {
    // No placement metadata yet (e.g., paper mode, or armed before this feature shipped)
    return null;
  }
  const ok = ps === "placed" || ps === "placed_capped";
  const capped = !!setup.placement_capped;
  const lev = setup.placement_leverage;
  const req = setup.requested_qty;
  const eff = setup.qty;
  const attempts = setup.placement_attempts ?? undefined;
  const at = setup.placement_at ? new Date(setup.placement_at) : null;

  const tone = ok
    ? capped
      ? "text-warning border-warning/50 bg-warning-soft/40"
      : "text-long border-long/50 bg-long/10"
    : "text-short border-short/50 bg-short/10";
  const label = ok
    ? capped
      ? "PLACED (CAPPED)"
      : "PLACED"
    : "PLACE FAILED";

  return (
    <div className={`mt-1 rounded border px-2 py-1 text-[11px] ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold tracking-wide">{label}</span>
        {ok && setup.exchange_order_id && (
          <span className="text-muted-foreground">
            order <span className="text-foreground">{setup.exchange_order_id}</span>
          </span>
        )}
        <span className="text-muted-foreground">
          leverage <span className="text-foreground">{lev ? `${lev}x` : "exchange default"}</span>
        </span>
        <span className="text-muted-foreground">
          effective qty <span className="text-foreground">{eff.toFixed(4)}</span>
          {req && Math.abs(req - eff) / Math.max(req, 1e-9) > 0.001 && (
            <> / requested <span className="text-foreground">{req.toFixed(4)}</span></>
          )}
        </span>
        {attempts !== undefined && (
          <span className="text-muted-foreground">
            attempts <span className="text-foreground">{attempts}</span>
          </span>
        )}
        {at && (
          <span className="text-muted-foreground">
            at <span className="text-foreground">{at.toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" })} IST</span>
          </span>
        )}
      </div>
      {!ok && setup.placement_error && (
        <div className="mt-0.5 break-all text-short/90">
          reason: {setup.placement_error}
        </div>
      )}
      {ok && capped && req && (
        <div className="mt-0.5 text-warning/90">
          exchange couldn't fit the full AI-sized qty — placed a reduced qty so an order is live. Planned risk differs from configured.
        </div>
      )}
    </div>
  );
}


/**
 * Fill-risk meter — estimates whether a pending LIMIT order will actually fill
 * based on current free margin headroom vs. required margin, and the price
 * distance from mark to entry. Purely client-side; uses the same
 * getExchangeAccount / getMarketTicker queries already used elsewhere on the
 * dashboard so the cache is shared.
 */
type FillRiskSetup = {
  side: "long" | "short";
  entry_price: number;
  qty: number;
  exchange_order_id?: string | null;
  placement_leverage?: number | null;
};

function FillRiskMeter({ setup, symbol }: { setup: FillRiskSetup; symbol: string }) {
  const getAcct = useServerFn(getExchangeAccount);
  const getTicker = useServerFn(getMarketTicker);
  const acctQ = useQuery({
    queryKey: ["exchange-account"],
    queryFn: () => getAcct(),
    refetchInterval: 15_000,
  });
  const tickerQ = useQuery({
    queryKey: ["market-ticker", symbol],
    queryFn: () => getTicker({ data: { symbol } }),
    refetchInterval: 5_000,
  });

  if (!setup.exchange_order_id) return null;

  const fw = (acctQ.data?.snapshot as { futuresWallet?: Record<string, unknown> } | null | undefined)?.futuresWallet ?? null;
  const freeMargin = fw
    ? Number(
        (fw.withdrawableBalance ?? fw.availableBalance ?? fw.balance ?? 0) as number,
      )
    : null;
  const mark = (tickerQ.data as { lastPrice?: number | null } | null | undefined)?.lastPrice ?? null;
  const lev = setup.placement_leverage && setup.placement_leverage > 0 ? setup.placement_leverage : 75;
  const notional = setup.entry_price * setup.qty;
  const marginRequired = notional / lev;

  // Margin headroom score (0–50)
  let marginPts = 0;
  let marginReason = "";
  if (freeMargin == null) {
    marginPts = 25;
    marginReason = "free margin unknown";
  } else if (marginRequired <= 0) {
    marginPts = 50;
  } else {
    const ratio = freeMargin / marginRequired;
    marginPts = Math.max(0, Math.min(50, Math.round((ratio - 1) * 50 + 25)));
    if (ratio < 1) marginReason = "low free margin";
  }

  // Price proximity score (0–50)
  let priceReason = "";
  let pricePts = 0;
  let distanceBps: number | null = null;
  let crossed = false;
  if (mark != null && setup.entry_price > 0) {
    distanceBps = (Math.abs(mark - setup.entry_price) / setup.entry_price) * 10_000;
    // For a LIMIT: LONG fills when mark drops to entry; SHORT fills when mark rises to entry.
    // "Crossed" = adverse gap past entry on the fill side (should have filled already).
    crossed =
      setup.side === "long" ? mark < setup.entry_price - 0.01 : mark > setup.entry_price + 0.01;
    if (crossed) {
      pricePts = 10;
      priceReason = "entry crossed — order should have filled, verify on exchange";
    } else if (distanceBps < 5) pricePts = 50;
    else if (distanceBps < 15) pricePts = 42;
    else if (distanceBps < 30) pricePts = 32;
    else if (distanceBps < 60) pricePts = 22;
    else if (distanceBps < 120) pricePts = 12;
    else {
      pricePts = 4;
      priceReason = "price far from entry";
    }
  } else {
    pricePts = 25;
  }

  const score = Math.max(0, Math.min(100, marginPts + pricePts));
  const bucket =
    score >= 75 ? "likely" : score >= 40 ? "possible" : "risk";
  const tone =
    bucket === "likely"
      ? { text: "text-long", bar: "bg-long", ring: "border-long/40 bg-long/5", label: "Likely to fill" }
      : bucket === "possible"
        ? { text: "text-warning", bar: "bg-warning", ring: "border-warning/40 bg-warning-soft/40", label: "Possible fill" }
        : { text: "text-short", bar: "bg-short", ring: "border-short/40 bg-short/5", label: "At risk" };

  const dominant = crossed
    ? priceReason
    : marginPts < pricePts
      ? marginReason || "low free margin"
      : priceReason || (bucket === "likely" ? "conditions good" : "price gap");

  return (
    <div className={`mt-2 rounded border ${tone.ring} px-2 py-1.5 text-[11px]`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`font-semibold tracking-wide ${tone.text}`}>FILL RISK · {tone.label}</span>
          <span className="text-muted-foreground">
            score <span className="text-foreground">{score}/100</span>
          </span>
        </div>
        <div className="text-muted-foreground">{dominant}</div>
      </div>
      <div
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Fill likelihood ${score} of 100 — ${tone.label}. ${dominant}`}
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className={`h-full ${tone.bar}`} style={{ width: `${score}%` }} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
        <span>
          free <span className="text-foreground">${freeMargin != null ? freeMargin.toFixed(2) : "—"}</span>
        </span>
        <span>
          need <span className="text-foreground">${marginRequired.toFixed(2)}</span>
          <span className="ml-1 text-[10px]">@{lev}x</span>
        </span>
        <span>
          mark <span className="text-foreground">{mark != null ? mark.toFixed(2) : "—"}</span>
        </span>
        <span>
          entry <span className="text-foreground">{setup.entry_price.toFixed(2)}</span>
        </span>
        <span>
          Δ <span className="text-foreground">{distanceBps != null ? `${distanceBps.toFixed(1)} bps` : "—"}</span>
        </span>
      </div>
    </div>
  );
}

const TIMELINE_EVENT_META: Record<string, { label: string; tone: string }> = {
  placement_attempt: { label: "Attempt", tone: "text-muted-foreground" },
  placement_success: { label: "Placed", tone: "text-long" },
  placement_capped: { label: "Placed (capped)", tone: "text-warning" },
  placement_failed: { label: "Place failed", tone: "text-short" },
  reprice_cancel: { label: "Reprice cancel", tone: "text-warning" },
  manual_cancel: { label: "Manual cancel", tone: "text-warning" },
  watchdog_rearm: { label: "Watchdog re-arm", tone: "text-warning" },
  filled: { label: "Filled", tone: "text-long" },
  tp_hit: { label: "TP hit", tone: "text-long" },
  sl_hit: { label: "SL hit", tone: "text-short" },
  closed: { label: "Closed", tone: "text-muted-foreground" },
};

type SetupTimelineEvent = {
  id: string;
  event_type: string;
  exchange_order_id: string | null;
  leverage: number | null;
  qty: number | null;
  price: number | null;
  reason: string | null;
  payload: unknown;
  created_at: string;
};

function SetupTimeline({ setupId }: { setupId: string }) {
  const [open, setOpen] = useState(false);
  const getTimeline = useServerFn(getSetupTimeline);
  const q = useQuery({
    queryKey: ["setup-timeline", setupId],
    queryFn: () => getTimeline({ data: { setupId } }),
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  });
  const events = (q.data?.events ?? []) as SetupTimelineEvent[];
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
          aria-label={open ? "Hide setup timeline" : "Show setup timeline"}
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
          <span>TIMELINE</span>
          {q.data && <span>· {events.length}</span>}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {q.isLoading ? (
          <div className="mt-1 text-[11px] text-muted-foreground">Loading…</div>
        ) : events.length === 0 ? (
          <div className="mt-1 text-[11px] text-muted-foreground">No events recorded yet.</div>
        ) : (
          <ol className="mt-1 space-y-1 border-l border-border pl-3 text-[11px] font-mono">
            <li className="sr-only">Setup lifecycle timeline, newest first.</li>
            {events.map((ev) => {
              const meta = TIMELINE_EVENT_META[ev.event_type] ?? {
                label: ev.event_type,
                tone: "text-muted-foreground",
              };
              const t = new Date(ev.created_at);
              return (
                <li key={ev.id} className="relative">
                  <span className="absolute -left-[15px] top-1.5 h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className={`font-semibold ${meta.tone}`}>{meta.label}</span>
                    <span className="text-muted-foreground">
                      {t.toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" })} IST
                    </span>
                    {ev.leverage != null && (
                      <span className="text-muted-foreground">
                        lev <span className="text-foreground">{ev.leverage}x</span>
                      </span>
                    )}
                    {ev.qty != null && (
                      <span className="text-muted-foreground">
                        qty <span className="text-foreground">{Number(ev.qty).toFixed(4)}</span>
                      </span>
                    )}
                    {ev.price != null && (
                      <span className="text-muted-foreground">
                        @ <span className="text-foreground">{Number(ev.price).toFixed(2)}</span>
                      </span>
                    )}
                    {ev.exchange_order_id && (
                      <span className="text-muted-foreground truncate max-w-[220px]">
                        oid <span className="text-foreground">{ev.exchange_order_id}</span>
                      </span>
                    )}
                  </div>
                  {ev.reason && (
                    <div className="text-muted-foreground/90 break-all">{ev.reason}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}





function StrategyCard() {
  const qc = useQueryClient();
  const getState = useServerFn(getStrategyState);
  const runNow = useServerFn(runStrategyTickNow);
  const repriceNow = useServerFn(repriceArmedNow);
  const rearmAi = useServerFn(cancelAndReArmWithAi);
  const runWatchdog = useServerFn(runOrderWatchdog);
  const updateStrat = useServerFn(updateStrategySettings);
  const watchdogMut = useMutation({
    mutationFn: () => runWatchdog(),
    onSuccess: (r: { ok: boolean; tick: { actions?: string[] } }) => {
      const actions = r.tick?.actions ?? [];
      const replaced = actions.filter((a) => a.startsWith("watchdog_replaced") || a.startsWith("re-armed") || a.startsWith("armed")).length;
      const failed = actions.filter((a) => a.startsWith("watchdog_replace_failed") || a.startsWith("arm_blocked")).length;
      if (replaced > 0) toast.success(`Watchdog placed/verified ${replaced} order(s)`);
      else if (failed > 0) toast.error(`Watchdog: ${failed} placement(s) failed — see activity log`);
      else toast.info(`Watchdog: nothing to fix (${actions.length} action(s))`);
      qc.invalidateQueries({ queryKey: ["strategy-state"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rearmMut = useMutation({
    mutationFn: () => rearmAi(),
    onSuccess: (r) => {
      const skipped = (r.skipped ?? []).length;
      if (r.cancelled > 0) {
        toast.success(`Cancelled ${r.cancelled}, AI re-armed — ${(r.tick.actions ?? []).length} action(s)`);
      } else {
        toast.error(skipped ? `Re-arm blocked: ${r.skipped[0]}` : "No armed order was cancelled");
      }
      qc.invalidateQueries({ queryKey: ["strategy-state"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const q = useQuery({
    queryKey: ["strategy-state"],
    queryFn: () => getState(),
    refetchInterval: 30_000,
  });
  const mut = useMutation({
    mutationFn: () => runNow(),
    onSuccess: (r) => {
      toast.success(`Tick ok — ${(r.actions ?? []).length} action(s)`);
      qc.invalidateQueries({ queryKey: ["strategy-state"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const repriceMut = useMutation({
    mutationFn: () => repriceNow(),
    onSuccess: (r) => {
      const acts = r.actions ?? [];
      if (acts.length === 0) {
        toast.message(r.reason ? `Nothing to reprice (${r.reason})` : "Nothing to reprice");
      } else {
        const ok = acts.filter((a) => a.startsWith("reprice_now ")).length;
        const skip = acts.length - ok;
        toast.success(`Reprice: ${ok} replaced, ${skip} skipped`);
      }
      qc.invalidateQueries({ queryKey: ["strategy-state"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const trailSaveMut = useMutation({
    mutationFn: async (patch: {
      enabled?: boolean;
      symbol?: string;
      trail_enabled?: boolean;
      trail_activate_r?: number;
      trail_step_r?: number;
      skip_weekends?: boolean;
      session_start_ist?: string;
      sl_risk_usd?: number;
      rr?: number;
      entry_mode?: "fib" | "retest" | "market" | "adaptive";
      entry_depth_pct?: number;
      sl_depth_pct?: number;
      adaptive_strong_break_pct?: number;
      adaptive_shallow_depth?: number;
      adaptive_deep_depth?: number;
      retest_sl_r?: number;
    }) => {
      const saved = await updateStrat({ data: patch });
      // Any change re-prices today's still-armed exchange order so live orders
      // reflect the new entry / SL / TP / risk immediately.
      const reprice = await repriceNow().catch((e: Error) => ({
        actions: [] as string[],
        reason: e.message,
      }));
      return { saved, reprice };
    },
    onSuccess: (r) => {
      const acts = r.reprice?.actions ?? [];
      const replaced = acts.filter((a) => a.startsWith("reprice_now ")).length;
      toast.success(
        replaced > 0
          ? `Saved · re-priced ${replaced} armed order${replaced === 1 ? "" : "s"}`
          : "Saved · no armed orders to re-price"
      );
      qc.invalidateQueries({ queryKey: ["strategy-state"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Trailing SL uses saved values for live; no per-run override on the dashboard.
  const [trailOverride, setTrailOverride] = useState<TrailOverride>(null);

  const s = q.data?.settings as
    | {
        enabled: boolean;
        symbol: string;
        sl_risk_usd: number;
        rr: number;
        session_start_ist: string;
        trail_enabled?: boolean;
        trail_activate_r?: number;
        trail_step_r?: number;
        skip_weekends?: boolean;
        entry_mode?: "fib" | "retest" | "market" | "adaptive";
        entry_depth_pct?: number;
        sl_depth_pct?: number;
        adaptive_strong_break_pct?: number;
        adaptive_shallow_depth?: number;
        adaptive_deep_depth?: number;
        retest_sl_r?: number;
        ai_grading_enabled?: boolean;
        ai_min_grade?: string | null;
        ai_grading_model?: unknown;
        ai_risk_multipliers?: Record<string, number> | null;
      }
    | null
    | undefined;
  const session = q.data?.session as
    | {
        ist_date: string;
        zone_high: number;
        zone_low: number;
        fib_25: number;
        fib_75: number;
        break_side: "long" | "short" | null;
      }
    | null
    | undefined;
  const setups = (q.data?.setups ?? []) as Array<{
    id: string;
    ist_date: string;
    side: "long" | "short";
    entry_price: number;
    sl_price: number;
    tp_price: number;
    qty: number;
    status: string;
    pnl_usd: number | null;
    close_reason: string | null;
    ai_grade?: string | null;
    ai_score?: number | null;
    ai_risk_mult?: number | null;
    placement_status?: string | null;
    placement_leverage?: number | null;
    placement_error?: string | null;
    placement_capped?: boolean | null;
    requested_qty?: number | null;
    placement_attempts?: number | null;
    placement_at?: string | null;
    exchange_order_id?: string | null;
  }>;


  const active = setups.filter((x) => x.status === "armed" || x.status === "triggered");
  // Setups pending re-arm — cancelled but flagged for the watchdog/tick to retry.
  const pendingRearm = setups.filter((x) => x.status === "cancelled" && x.close_reason === "rearm_with_ai");
  const closed = setups.filter((x) => x.status === "closed" || x.status === "expired");
  const aiEnabled = !!s?.ai_grading_enabled;
  const hasAiModel = !!s?.ai_grading_model;
  const currentSetup = active[0] ?? setups[0] ?? null;
  const currentNeedsAiRearm = aiEnabled && hasAiModel && active.some((a) => a.status === "armed" && !a.ai_grade);

  const status = !s?.enabled
    ? { label: "DISABLED", cls: "bg-muted" }
    : !session
      ? { label: "WAITING FOR ZONE", cls: "bg-warning-soft" }
      : !session.break_side
        ? { label: "ZONE SET · NO BREAK", cls: "bg-warning-soft" }
        : active.some((a) => a.status === "triggered")
          ? { label: "IN TRADE", cls: "bg-success-soft" }
          : { label: `BROKEN ${session.break_side.toUpperCase()}`, cls: "bg-success-soft" };

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 space-y-0 pb-3">
        <div>
          <CardTitle className="text-sm font-mono tracking-widest">
            STRATEGY — {s?.symbol ?? "XAUUSDT"} · 1H
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            IST {s?.session_start_ist?.slice(0, 5) ?? "05:30"} session · SL ${s?.sl_risk_usd ?? 25} · RR 1:{s?.rr ?? 2}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-2 px-3 py-1 rounded font-mono text-xs tracking-widest ${status.cls}`}
            role="status"
            aria-live="polite"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" aria-hidden />
            {status.label}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={mut.isPending}
            onClick={() => mut.mutate()}
            aria-label="Run a strategy tick now"
          >
            {mut.isPending ? "Running…" : "Run tick"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={repriceMut.isPending}
            onClick={() => repriceMut.mutate()}
            aria-label="Reprice pending order with current settings"
            title="Cancel any still-pending exchange order for today's armed setup and re-place it with current entry/SL/TP depths."
          >
            {repriceMut.isPending ? "Repricing…" : "Reprice now"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <CollapsibleSection title="Full Strategy Configuration" defaultOpen>
          <FullStrategyEditor
            settings={{
              enabled: !!s?.enabled,
              symbol: s?.symbol ?? "XAUUSDT",
              session_start_ist: s?.session_start_ist?.slice(0, 5) ?? "05:30",
              entry_mode: (s?.entry_mode as "fib" | "retest" | "market" | "adaptive") ?? "adaptive",
              entry_depth_pct: Number(s?.entry_depth_pct ?? 0.15),
              sl_depth_pct: Number(s?.sl_depth_pct ?? 0.6),
              adaptive_strong_break_pct: Number(s?.adaptive_strong_break_pct ?? 30),
              adaptive_shallow_depth: Number(s?.adaptive_shallow_depth ?? 0.1),
              adaptive_deep_depth: Number(s?.adaptive_deep_depth ?? 0.35),
              retest_sl_r: Number(s?.retest_sl_r ?? 0.5),
              rr: Number(s?.rr ?? 2),
              sl_risk_usd: Number(s?.sl_risk_usd ?? 25),
              trail_enabled: !!s?.trail_enabled,
              trail_activate_r: Number(s?.trail_activate_r ?? 2),
              trail_step_r: Number(s?.trail_step_r ?? 1),
              skip_weekends: !!s?.skip_weekends,
            }}
            onSave={(patch) => trailSaveMut.mutate(patch)}
            saving={trailSaveMut.isPending}
          />
        </CollapsibleSection>
        <CollapsibleSection title="Trailing SL" defaultOpen={false}>
          <TrailingSlControls
            saved={{
              enabled: !!s?.trail_enabled,
              activateR: Number(s?.trail_activate_r ?? 2),
              stepR: Number(s?.trail_step_r ?? 1),
            }}
            override={trailOverride}
            onOverrideChange={setTrailOverride}
            onSave={(patch) => trailSaveMut.mutate(patch)}
            saving={trailSaveMut.isPending}
          />
        </CollapsibleSection>
        <CollapsibleSection title="Live Session Rules" defaultOpen={false}>
          <LiveSessionRulesEditor
            settings={{
              session_start_ist: s?.session_start_ist?.slice(0, 5) ?? "05:30",
              sl_risk_usd: Number(s?.sl_risk_usd ?? 25),
              rr: Number(s?.rr ?? 2),
              skip_weekends: !!s?.skip_weekends,
            }}
            onSave={(patch) => trailSaveMut.mutate(patch)}
            saving={trailSaveMut.isPending}
          />
        </CollapsibleSection>
        <CollapsibleSection title="Strategy Presets" defaultOpen={false}>
          <StrategyPresetsCard
            currentSymbol={s?.symbol ?? "XAUUSDT"}
            currentSl={Number(s?.sl_risk_usd ?? 25)}
            currentRr={Number(s?.rr ?? 2)}
          />
        </CollapsibleSection>
        <CollapsibleSection title="Session Timeline" defaultOpen>
          <SessionTimeline />
        </CollapsibleSection>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <AiDecisionTile
            label="AI TRADE GRADE"
            grade={currentSetup?.ai_grade}
            score={currentSetup?.ai_score}
            mult={currentSetup?.ai_risk_mult}
            value={currentNeedsAiRearm ? "RE-ARM" : undefined}
            sub={currentNeedsAiRearm ? "Current armed order was placed before AI grading" : undefined}
            enabled={aiEnabled}
            hasModel={hasAiModel}
          />
          <AiDecisionTile
            label="AI ORDER QTY"
            value={currentSetup ? currentSetup.qty.toFixed(4) : "—"}
            sub={currentSetup ? `${currentSetup.status.toUpperCase()} · ${currentSetup.side.toUpperCase()}` : "Waiting for setup"}
            enabled={aiEnabled}
            hasModel={hasAiModel}
          />
          <AiDecisionTile
            label="MIN GRADE"
            value={String(s?.ai_min_grade ?? "B")}
            sub={hasAiModel ? "AI model ready" : "Train model first"}
            enabled={aiEnabled}
            hasModel={hasAiModel}
          />
        </div>

        {session ? (() => {
          const eDepth = s?.entry_depth_pct ?? 0.15;
          const slDepth = s?.sl_depth_pct ?? 0.60;
          const range = session.zone_high - session.zone_low;
          const longEntry = session.zone_high - range * eDepth;   // fib (1 - eDepth)
          const longSl    = session.zone_high - range * slDepth;  // fib (1 - slDepth)
          const shortEntry = session.zone_low + range * eDepth;   // fib eDepth
          const shortSl    = session.zone_low + range * slDepth;  // fib slDepth
          const longFib  = (1 - eDepth).toFixed(2);
          const shortFib = eDepth.toFixed(2);
          const longSlFib  = (1 - slDepth).toFixed(2);
          const shortSlFib = slDepth.toFixed(2);
          return (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 font-mono text-xs">
              <ZoneCell label="HIGH · fib 1" value={session.zone_high} />
              <ZoneCell label={`fib ${longFib} · LONG entry`}  value={longEntry}  highlight={session.break_side === "long"} />
              <ZoneCell label={`fib ${longSlFib} · LONG sl`}   value={longSl} />
              <ZoneCell label={`fib ${shortFib} · SHORT entry`} value={shortEntry} highlight={session.break_side === "short"} />
              <ZoneCell label={`fib ${shortSlFib} · SHORT sl`}  value={shortSl} />
              <ZoneCell label="LOW · fib 0" value={session.zone_low} />
            </div>
          );
        })() : (
          <p className="text-xs text-muted-foreground font-mono">
            Zone is always the {s?.session_start_ist?.slice(0, 5) ?? "05:30"}–06:30 IST 1H candle — no other candle is used. Waiting for that candle to close, or hit “Run tick” to sync.
          </p>
        )}

        {(active.length > 0 || pendingRearm.length > 0) && (
          <div>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="text-xs font-mono text-muted-foreground">
                ACTIVE SETUPS
                {pendingRearm.length > 0 && (
                  <span className="ml-2 text-warning">· {pendingRearm.length} pending re-arm</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={watchdogMut.isPending}
                  onClick={() => watchdogMut.mutate()}
                  aria-label="Run order watchdog and re-arm missing orders"
                  title="Verify every active setup has a live pending order on the exchange and place one if missing (leverage escalation + capped fallback)."
                >
                  {watchdogMut.isPending ? "Checking…" : "Verify & re-arm"}
                </Button>
                <Button
                  size="sm"
                  variant={active.some((a) => a.status === "armed" && !a.ai_grade) ? "outline" : "ghost"}
                  disabled={
                    rearmMut.isPending ||
                    (!active.some((a) => a.status === "armed") && pendingRearm.length === 0)
                  }
                  onClick={() => {
                    if (confirm("Cancel current armed order (if any) and re-arm with the latest AI grading + risk settings?")) {
                      rearmMut.mutate();
                    }
                  }}
                  aria-label="Cancel and re-arm the current setup with latest AI grading"
                  title="Cancels the currently pending exchange order and immediately re-arms so the AI grading model + risk multiplier are applied."
                >
                  {rearmMut.isPending ? "Re-arming…" : "Re-arm with AI"}
                </Button>
              </div>
            </div>

            <div className="border border-border rounded divide-y divide-border">
              {active.map((a) => {
                const notional = a.entry_price * a.qty;
                const marginAt50x = notional / 50;
                const marginAt25x = notional / 25;
                const marginAt10x = notional / 10;
                return (
                  <div key={a.id} className="px-3 py-2 text-xs font-mono">
                    <div className="grid grid-cols-2 md:grid-cols-7 gap-2 items-center">
                      <span className={a.side === "long" ? "text-long" : "text-short"}>
                        {a.side.toUpperCase()}
                      </span>
                      <span>entry {a.entry_price.toFixed(2)}</span>
                      <span>sl {a.sl_price.toFixed(2)}</span>
                      <span>tp {a.tp_price.toFixed(2)}</span>
                      <span className="font-semibold">qty {a.qty.toFixed(4)}</span>
                      <span className="uppercase text-muted-foreground">{a.status}</span>
                      <GradeBadge grade={a.ai_grade} score={a.ai_score} mult={a.ai_risk_mult} enabled={aiEnabled} />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>notional <span className="text-foreground">${notional.toFixed(2)}</span></span>
                      <span>margin@50x <span className="text-foreground">${marginAt50x.toFixed(2)}</span></span>
                      <span>margin@25x <span className="text-foreground">${marginAt25x.toFixed(2)}</span></span>
                      <span>margin@10x <span className="text-foreground">${marginAt10x.toFixed(2)}</span></span>
                      <span>planned risk <span className="text-foreground">${(Math.abs(a.entry_price - a.sl_price) * a.qty).toFixed(2)}</span></span>
                    </div>
                    <PlacementStatusRow setup={a} />
                    <FillRiskMeter setup={a} symbol={s?.symbol ?? "XAUUSDT"} />
                    <SetupTimeline setupId={a.id} />
                  </div>
                );
              })}
              {pendingRearm.map((a) => {
                const notional = a.entry_price * a.qty;
                return (
                  <div key={a.id} className="px-3 py-2 text-xs font-mono bg-warning-soft/30">
                    <div className="grid grid-cols-2 md:grid-cols-7 gap-2 items-center">
                      <span className={a.side === "long" ? "text-long" : "text-short"}>
                        {a.side.toUpperCase()}
                      </span>
                      <span>entry {a.entry_price.toFixed(2)}</span>
                      <span>sl {a.sl_price.toFixed(2)}</span>
                      <span>tp {a.tp_price.toFixed(2)}</span>
                      <span className="font-semibold">qty {a.qty.toFixed(4)}</span>
                      <span className="uppercase text-warning">pending re-arm</span>
                      <GradeBadge grade={a.ai_grade} score={a.ai_score} mult={a.ai_risk_mult} enabled={aiEnabled} />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>notional <span className="text-foreground">${notional.toFixed(2)}</span></span>
                      <span>watchdog will retry on next tick — click <span className="text-foreground">Verify &amp; re-arm</span> to run now.</span>
                    </div>
                    <PlacementStatusRow setup={a} />
                    <SetupTimeline setupId={a.id} />
                  </div>
                );
              })}
            </div>

            <RejectionReasonBanner setupIds={active.map((a) => a.id)} logs={(q.data?.logs ?? []) as LogRow[]} />
            <GradeRiskTable
              currentEntry={active[0]?.entry_price ?? null}
              currentSl={active[0]?.sl_price ?? null}
              currentSide={active[0]?.side ?? null}
              overrides={(s?.ai_risk_multipliers as Record<string, number> | undefined) ?? undefined}
            />
          </div>
        )}

        {(() => {
          const live = active.find((a) => a.status === "triggered");
          return live ? (
            <LiveTradePanel
              setup={live}
              onChanged={() => {
                qc.invalidateQueries({ queryKey: ["strategy-state"] });
                qc.invalidateQueries({ queryKey: ["dashboard"] });
              }}
            />
          ) : null;
        })()}


        {closed.length > 0 && (
          <div>
            <div className="text-xs font-mono text-muted-foreground mb-2">RECENT SETUPS</div>
            <div className="border border-border rounded divide-y divide-border">
              {closed.slice(0, 8).map((c) => (
                <div key={c.id} className="grid grid-cols-7 gap-2 px-3 py-2 text-xs font-mono items-center">
                  <span>{c.ist_date}</span>
                  <span className={c.side === "long" ? "text-long" : "text-short"}>
                    {c.side.toUpperCase()}
                  </span>
                  <span>entry {c.entry_price.toFixed(2)}</span>
                  <span className="uppercase text-muted-foreground">{c.status}</span>
                  <span className="uppercase text-muted-foreground">{c.close_reason ?? "—"}</span>
                  <span className={((c.pnl_usd ?? 0) >= 0) ? "text-long" : "text-short"}>
                    {c.pnl_usd == null ? "—" : `${c.pnl_usd >= 0 ? "+" : ""}${c.pnl_usd.toFixed(2)}`}
                  </span>
                  <GradeBadge grade={c.ai_grade} score={c.ai_score} mult={c.ai_risk_mult} qty={c.qty} enabled={aiEnabled} />
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const GRADE_RISK_USD_UI: Record<string, number> = {
  "A+++": 40,
  "A++": 35,
  "A+": 30,
  A: 28,
  B: 25,
  C: 0,
};

type LogRow = {
  severity: string;
  message: string;
  context: unknown;
  created_at: string;
};

function RejectionReasonBanner({ setupIds, logs }: { setupIds: string[]; logs: LogRow[] }) {
  if (!logs || logs.length === 0 || setupIds.length === 0) return null;
  const idSet = new Set(setupIds);
  // Look for arm_blocked / place: rejected / place-margin / cancel entries in the last 30 logs
  // that reference one of the current active setup IDs.
  const relevant = logs.find((l) => {
    const ctx = (l.context ?? {}) as Record<string, unknown>;
    const setupId = String(ctx.setup_id ?? ctx.setupId ?? "");
    const msg = l.message.toLowerCase();
    const isRelevant =
      msg.includes("arm_blocked") ||
      msg.includes("rejected") ||
      msg.includes("margin") ||
      msg.includes("insufficient") ||
      msg.includes("max position") ||
      msg.includes("maximum position");
    return isRelevant && (setupId ? idSet.has(setupId) : true);
  });
  if (!relevant) return null;
  const ctx = (relevant.context ?? {}) as Record<string, unknown>;
  const err = String(ctx.error ?? ctx.reason ?? "");
  return (
    <div className={`mt-2 rounded border px-3 py-2 text-xs font-mono ${relevant.severity === "error" ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-warning/50 bg-warning-soft"}`}>
      <div className="font-semibold uppercase tracking-widest text-[10px] mb-1">
        LAST EXCHANGE / ARM ISSUE
      </div>
      <div className="whitespace-pre-wrap break-words">
        {relevant.message}
        {err ? <div className="opacity-80 mt-1">reason: {err}</div> : null}
      </div>
      <div className="mt-1 opacity-60">{new Date(relevant.created_at).toLocaleString()}</div>
    </div>
  );
}

function GradeRiskTable({
  currentEntry,
  currentSl,
  currentSide,
  overrides,
}: {
  currentEntry: number | null;
  currentSl: number | null;
  currentSide: "long" | "short" | null;
  overrides?: Record<string, number>;
}) {
  const hasLive = currentEntry != null && currentSl != null && Math.abs(currentEntry - currentSl) > 0;
  const risk = hasLive ? Math.abs(currentEntry - currentSl) : null;
  const rows = ["A+++", "A++", "A+", "A", "B"].map((g) => {
    const overrideRaw = overrides ? Number(overrides[g]) : NaN;
    const slUsd = Number.isFinite(overrideRaw) && overrideRaw > 5 ? overrideRaw : GRADE_RISK_USD_UI[g];
    const qty = hasLive && risk ? slUsd / risk : null;
    const notional = qty != null && currentEntry != null ? qty * currentEntry : null;
    return {
      grade: g,
      slUsd,
      qty,
      notional,
      m50: notional != null ? notional / 50 : null,
      m25: notional != null ? notional / 25 : null,
      m10: notional != null ? notional / 10 : null,
    };
  });
  return (
    <div className="mt-3">
      <div className="text-xs font-mono text-muted-foreground mb-1">
        PER-GRADE RISK &amp; REQUIRED MARGIN{" "}
        {hasLive ? (
          <span className="opacity-70">
            · using {currentSide?.toUpperCase()} entry {currentEntry!.toFixed(2)} / sl {currentSl!.toFixed(2)} · risk {risk!.toFixed(2)} pts
          </span>
        ) : (
          <span className="opacity-70">· no live setup — SL$ shown only</span>
        )}
      </div>
      <div className="overflow-x-auto border border-border rounded">
        <table className="w-full text-xs font-mono">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="text-left px-2 py-1">GRADE</th>
              <th className="text-right px-2 py-1">SL $</th>
              <th className="text-right px-2 py-1">QTY</th>
              <th className="text-right px-2 py-1">NOTIONAL</th>
              <th className="text-right px-2 py-1">MARGIN @50x</th>
              <th className="text-right px-2 py-1">MARGIN @25x</th>
              <th className="text-right px-2 py-1">MARGIN @10x</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.grade} className="border-t border-border">
                <td className="px-2 py-1">
                  <span className={`px-1.5 py-0.5 rounded border ${GRADE_BADGE_STYLES[r.grade] ?? ""}`}>{r.grade}</span>
                </td>
                <td className="text-right px-2 py-1">${r.slUsd.toFixed(0)}</td>
                <td className="text-right px-2 py-1">{r.qty != null ? r.qty.toFixed(4) : "—"}</td>
                <td className="text-right px-2 py-1">{r.notional != null ? `$${r.notional.toFixed(2)}` : "—"}</td>
                <td className="text-right px-2 py-1">{r.m50 != null ? `$${r.m50.toFixed(2)}` : "—"}</td>
                <td className="text-right px-2 py-1">{r.m25 != null ? `$${r.m25.toFixed(2)}` : "—"}</td>
                <td className="text-right px-2 py-1">{r.m10 != null ? `$${r.m10.toFixed(2)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const GRADE_BADGE_STYLES: Record<string, string> = {
  "A+++": "bg-emerald-500 text-white border-emerald-600 dark:bg-emerald-500/25 dark:text-emerald-100 dark:border-emerald-400/50",
  "A++": "bg-green-500 text-white border-green-600 dark:bg-green-500/25 dark:text-green-100 dark:border-green-400/50",
  "A+": "bg-lime-500 text-neutral-900 border-lime-600 dark:bg-lime-500/25 dark:text-lime-100 dark:border-lime-400/50",
  A: "bg-yellow-400 text-neutral-900 border-yellow-500 dark:bg-yellow-500/25 dark:text-yellow-100 dark:border-yellow-400/50",
  B: "bg-orange-500 text-white border-orange-600 dark:bg-orange-500/25 dark:text-orange-100 dark:border-orange-400/50",
  C: "bg-red-500 text-white border-red-600 dark:bg-red-500/25 dark:text-red-100 dark:border-red-400/50",
};

function AiDecisionTile({
  label,
  grade,
  score,
  mult,
  value,
  sub,
  enabled,
  hasModel,
}: {
  label: string;
  grade?: string | null;
  score?: number | null;
  mult?: number | null;
  value?: string;
  sub?: string;
  enabled: boolean;
  hasModel: boolean;
}) {
  const cls = grade ? GRADE_BADGE_STYLES[grade] ?? "bg-muted text-foreground border-border" : "bg-muted/30 text-muted-foreground border-border";
  const display = grade ?? value ?? (enabled ? (hasModel ? "WAITING" : "NO MODEL") : "AI OFF");
  const detail = grade
    ? `score ${score == null ? "—" : Math.round(score)} · risk ${mult == null ? "—" : `${mult}x`}`
    : sub ?? (enabled ? "No AI-graded setup yet" : "Enable AI grading in settings");
  return (
    <div className={`rounded border px-3 py-3 font-mono ${cls}`}>
      <div className="text-[10px] tracking-widest opacity-75">{label}</div>
      <div className="mt-1 text-2xl font-bold leading-none">{display}</div>
      <div className="mt-1 text-[10px] opacity-80">{detail}</div>
    </div>
  );
}

function GradeBadge({
  grade,
  score,
  mult,
  qty,
  enabled,
}: {
  grade?: string | null;
  score?: number | null;
  mult?: number | null;
  qty?: number | null;
  enabled?: boolean;
}) {
  if (!grade) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-mono uppercase text-muted-foreground">
        {enabled ? "AI: re-arm" : "AI: off"}
        {qty != null ? <span className="text-foreground">· qty {qty.toFixed(4)}</span> : null}
      </span>
    );
  }
  const cls = GRADE_BADGE_STYLES[grade] ?? "bg-muted text-foreground border-border";
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono ${cls}`}>
      <span className="font-bold">{grade}</span>
      {score != null ? <span className="opacity-80">· {Math.round(score)}</span> : null}
      {mult != null ? <span className="opacity-80">· {mult}x</span> : null}
      {qty != null ? <span className="opacity-80">· qty {qty.toFixed(4)}</span> : null}
    </span>
  );
}

function LiveTradePanel({
  setup,
  onChanged,
}: {
  setup: {
    id: string;
    side: "long" | "short";
    entry_price: number;
    sl_price: number;
    tp_price: number;
    qty: number;
    ai_grade?: string | null;
    ai_score?: number | null;
    ai_risk_mult?: number | null;
  };
  onChanged: () => void;
}) {
  const editFn = useServerFn(editLiveTradeLevels);
  const closeFn = useServerFn(closeLiveTradeNow);
  const [sl, setSl] = useState(setup.sl_price.toFixed(2));
  const [tp, setTp] = useState(setup.tp_price.toFixed(2));

  // Keep local inputs synced when the trailing engine advances SL.
  useEffect(() => {
    setSl(setup.sl_price.toFixed(2));
  }, [setup.sl_price]);
  useEffect(() => {
    setTp(setup.tp_price.toFixed(2));
  }, [setup.tp_price]);

  const risk = Math.abs(setup.entry_price - setup.sl_price);
  const reward = Math.abs(setup.tp_price - setup.entry_price);
  const rr = risk > 0 ? reward / risk : 0;

  const saveSl = useMutation({
    mutationFn: async () => {
      const n = Number(sl);
      if (!Number.isFinite(n) || n <= 0) throw new Error("Invalid SL price");
      return editFn({ data: { setup_id: setup.id, sl_price: n } });
    },
    onSuccess: (r) => {
      r.results.forEach((x) => (x.ok ? toast.success(x.message) : toast.error(x.message)));
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const saveTp = useMutation({
    mutationFn: async () => {
      const n = Number(tp);
      if (!Number.isFinite(n) || n <= 0) throw new Error("Invalid TP price");
      return editFn({ data: { setup_id: setup.id, tp_price: n } });
    },
    onSuccess: (r) => {
      r.results.forEach((x) => (x.ok ? toast.success(x.message) : toast.error(x.message)));
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const closeMut = useMutation({
    mutationFn: () => closeFn({ data: { setup_id: setup.id } }),
    onSuccess: (r) => {
      toast.success(r.message);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="border border-border rounded p-3 space-y-3 bg-muted/20">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs font-mono text-muted-foreground tracking-widest flex items-center gap-2 flex-wrap">
          <span>LIVE TRADE ·</span>
          <span className={setup.side === "long" ? "text-long" : "text-short"}>{setup.side.toUpperCase()}</span>
          <span>· entry {setup.entry_price.toFixed(2)} · qty {setup.qty.toFixed(4)}</span>
          <GradeBadge grade={setup.ai_grade} score={setup.ai_score} mult={setup.ai_risk_mult} enabled />
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          risk {risk.toFixed(2)} · reward {reward.toFixed(2)} · RR 1:{rr.toFixed(2)}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs font-mono">Stop Loss</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              step="0.01"
              value={sl}
              onChange={(e) => setSl(e.target.value)}
              className="font-mono"
            />
            <Button size="sm" disabled={saveSl.isPending} onClick={() => saveSl.mutate()}>
              {saveSl.isPending ? "…" : "Save SL"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono">
            Manual SL edits reset the trail baseline. Trailing keeps running from the new SL.
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-mono">Take Profit</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              step="0.01"
              value={tp}
              onChange={(e) => setTp(e.target.value)}
              className="font-mono"
            />
            <Button size="sm" disabled={saveTp.isPending} onClick={() => saveTp.mutate()}>
              {saveTp.isPending ? "…" : "Save TP"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono">
            Pushes new TP price to the bracket child on the exchange.
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-mono">Close Position</Label>
          <Button
            size="sm"
            variant="destructive"
            className="w-full"
            disabled={closeMut.isPending}
            onClick={() => {
              if (confirm(`Close ${setup.side} ${setup.qty.toFixed(4)} at market?`)) closeMut.mutate();
            }}
          >
            {closeMut.isPending ? "Closing…" : "Market Close"}
          </Button>
          <p className="text-[10px] text-muted-foreground font-mono">
            Reduce-only market order for full qty.
          </p>
        </div>
      </div>
    </div>
  );
}

function ZoneCell({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`border rounded px-2 py-1.5 ${highlight ? "border-primary bg-primary/5" : "border-border"}`}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-sm">{value.toFixed(2)}</div>
    </div>
  );
}

type TimelineEvent = {
  at: string; // ISO
  kind: "session" | "break" | "armed" | "pending" | "triggered" | "closed" | "expired" | "cancelled";
  title: string;
  detail?: string;
  tone: "muted" | "info" | "warn" | "long" | "short" | "success" | "error";
};

function fmtIst(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
}

function SessionTimeline() {
  const getTimeline = useServerFn(getStrategyTimeline);
  const q = useQuery({
    queryKey: ["strategy-timeline"],
    queryFn: () => getTimeline(),
    refetchInterval: 30_000,
  });

  if (q.isLoading) {
    return <div className="text-xs text-muted-foreground font-mono">Loading…</div>;
  }
  if (!q.data?.session) {
    return (
      <div className="text-xs text-muted-foreground font-mono">
        No session yet. Timeline will populate once today's zone candle closes.
      </div>
    );
  }

  const { session, setups, orders } = q.data;
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const events: TimelineEvent[] = [];

  events.push({
    at: (session as { created_at: string }).created_at,
    kind: "session",
    title: `Zone set · ${session.zone_low.toFixed(2)} – ${session.zone_high.toFixed(2)}`,
    detail: `range ${(session.zone_high - session.zone_low).toFixed(2)} · high ${session.zone_high.toFixed(2)} · low ${session.zone_low.toFixed(2)}`,
    tone: "info",
  });

  if (session.break_side && session.break_detected_at) {
    events.push({
      at: session.break_detected_at,
      kind: "break",
      title: `Break ${session.break_side.toUpperCase()} @ ${Number(session.break_close_price ?? 0).toFixed(2)}`,
      detail: `1H candle close · ${fmtIst(session.break_detected_at)} IST`,
      tone: session.break_side === "long" ? "long" : "short",
    });
  }

  for (const st of setups) {
    events.push({
      at: st.created_at,
      kind: "armed",
      title: `Armed ${st.side.toUpperCase()}`,
      detail: `entry ${st.entry_price.toFixed(2)} · sl ${st.sl_price.toFixed(2)} · tp ${st.tp_price.toFixed(2)} · qty ${st.qty.toFixed(4)}`,
      tone: "warn",
    });
    if (st.exchange_order_id) {
      events.push({
        at: st.created_at,
        kind: "pending",
        title: `LIMIT sent to exchange`,
        detail: `order_id ${st.exchange_order_id}`,
        tone: "info",
      });
    }
    if (st.filled_at && (st.status === "triggered" || st.status === "closed")) {
      const ord = st.order_id ? orderById.get(st.order_id) : null;
      const fp = ord?.filled_price != null ? Number(ord.filled_price).toFixed(2) : st.entry_price.toFixed(2);
      events.push({
        at: st.filled_at,
        kind: "triggered",
        title: `Filled ${st.side.toUpperCase()} @ ${fp}`,
        detail: ord?.exchange_order_id
          ? `order_id ${ord.exchange_order_id} · ${ord.order_type ?? "limit"}`
          : st.exchange_order_id
            ? `order_id ${st.exchange_order_id}`
            : "paper fill",
        tone: "success",
      });
    }
    if (st.closed_at && st.status === "closed") {
      const pnl = st.pnl_usd == null ? "—" : `${Number(st.pnl_usd) >= 0 ? "+" : ""}${Number(st.pnl_usd).toFixed(2)}`;
      events.push({
        at: st.closed_at,
        kind: "closed",
        title: `Closed · ${(st.close_reason ?? "").toUpperCase() || "—"}`,
        detail: `pnl ${pnl}`,
        tone: Number(st.pnl_usd ?? 0) >= 0 ? "success" : "error",
      });
    }
    if (st.status === "expired") {
      events.push({
        at: st.updated_at,
        kind: "expired",
        title: `Expired ${st.side.toUpperCase()}`,
        detail: st.exchange_order_id ? `cancelled on exchange · ${st.exchange_order_id}` : undefined,
        tone: "muted",
      });
    }
    if (st.status === "cancelled") {
      events.push({
        at: st.updated_at,
        kind: "cancelled",
        title: `Cancelled ${st.side.toUpperCase()}`,
        tone: "error",
      });
    }
  }

  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const toneCls: Record<TimelineEvent["tone"], string> = {
    muted: "bg-muted-foreground",
    info: "bg-primary",
    warn: "bg-warning",
    long: "bg-long",
    short: "bg-short",
    success: "bg-long",
    error: "bg-destructive",
  };

  return (
    <div className="font-mono text-xs">
      <div className="flex items-center justify-between mb-2 text-[10px] tracking-widest text-muted-foreground">
        <span>SESSION {session.ist_date}</span>
        <button
          className="hover:text-foreground"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
        >
          {q.isFetching ? "refreshing…" : "refresh"}
        </button>
      </div>
      {events.length === 0 ? (
        <div className="text-muted-foreground">No events yet.</div>
      ) : (
        <ol className="relative border-l border-border ml-2 space-y-3">
          {events.map((e, i) => (
            <li key={i} className="pl-4 relative">
              <span
                className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-background ${toneCls[e.tone]}`}
              />
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-foreground">{e.title}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {fmtIst(e.at)}
                </span>
              </div>
              {e.detail && (
                <div className="text-[10px] text-muted-foreground break-all">{e.detail}</div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border border-border rounded">
      <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 font-mono text-[11px] tracking-widest text-muted-foreground hover:text-foreground transition-colors">
        <span>{title.toUpperCase()}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 pt-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}




type TrailOverride = { enabled: boolean; activateR: number; stepR: number } | null;

function TrailingSlControls({
  saved,
  override,
  onOverrideChange,
  onSave,
  saving,
}: {
  saved: { enabled: boolean; activateR: number; stepR: number };
  override: TrailOverride;
  onOverrideChange: (v: TrailOverride) => void;
  onSave: (patch: { trail_enabled: boolean; trail_activate_r: number; trail_step_r: number }) => void;
  saving: boolean;
}) {
  const active = override ?? saved;
  const dirty =
    override != null &&
    (override.enabled !== saved.enabled ||
      override.activateR !== saved.activateR ||
      override.stepR !== saved.stepR);
  const set = (patch: Partial<{ enabled: boolean; activateR: number; stepR: number }>) =>
    onOverrideChange({ ...active, ...patch });
  return (
    <div className="font-mono text-xs space-y-2">
      <div className="flex items-center justify-end">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Enable</span>
          <Switch checked={active.enabled} onCheckedChange={(v) => set({ enabled: v })} />
        </label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
        <div>
          <Label className="text-[10px] text-muted-foreground">Activate at (R)</Label>
          <Input
            type="number"
            step="0.1"
            min="0.1"
            value={active.activateR}
            onChange={(e) => set({ activateR: Number(e.target.value) || 0.1 })}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Step (R)</Label>
          <Input
            type="number"
            step="0.1"
            min="0.1"
            value={active.stepR}
            onChange={(e) => set({ stepR: Number(e.target.value) || 0.1 })}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="md:col-span-2 flex gap-2 justify-end">
          {dirty && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onOverrideChange(null)}
              disabled={saving}
            >
              Reset
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={saving || !override}
            onClick={() =>
              onSave({
                trail_enabled: active.enabled,
                trail_activate_r: active.activateR,
                trail_step_r: active.stepR,
              })
            }
          >
            {saving ? "Saving…" : "Save (live)"}
          </Button>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Once price reaches {active.activateR}R, SL moves to breakeven. Each additional {active.stepR}R gain moves SL up
        by {active.stepR}R (e.g. 1:{active.activateR}→BE, 1:{active.activateR + active.stepR}→{active.stepR}R,
        1:{active.activateR + 2 * active.stepR}→{2 * active.stepR}R, …). Applies to live triggers and backtests.
        {override ? " · Backtest is using the values above." : " · Backtest uses saved values."}
      </p>
    </div>
  );
}

function LiveSessionRulesEditor({
  settings,
  onSave,
  saving,
}: {
  settings: {
    session_start_ist: string;
    sl_risk_usd: number;
    rr: number;
    skip_weekends: boolean;
  };
  onSave: (patch: {
    session_start_ist?: string;
    sl_risk_usd?: number;
    rr?: number;
    skip_weekends?: boolean;
  }) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(settings);
  useEffect(() => {
    setForm(settings);
  }, [settings.session_start_ist, settings.sl_risk_usd, settings.rr, settings.skip_weekends]);
  const dirty =
    form.session_start_ist !== settings.session_start_ist ||
    form.sl_risk_usd !== settings.sl_risk_usd ||
    form.rr !== settings.rr ||
    form.skip_weekends !== settings.skip_weekends;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant="secondary"
          disabled={saving || !dirty}
          onClick={() => onSave(form)}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-mono tracking-widest text-muted-foreground">SESSION START IST</label>
          <Input
            value={form.session_start_ist}
            onChange={(e) => setForm({ ...form, session_start_ist: e.target.value })}
            placeholder="05:30"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-mono tracking-widest text-muted-foreground">SL RISK ($)</label>
          <Input
            type="number"
            value={form.sl_risk_usd}
            onChange={(e) => setForm({ ...form, sl_risk_usd: Number(e.target.value) })}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-mono tracking-widest text-muted-foreground">R:R (TP)</label>
          <Input
            type="number"
            step="0.1"
            value={form.rr}
            onChange={(e) => setForm({ ...form, rr: Number(e.target.value) })}
            className="h-8 font-mono text-xs"
          />
        </div>
        <label className="flex items-end justify-between gap-2 pb-1">
          <span className="text-[10px] font-mono tracking-widest text-muted-foreground">SKIP SUNDAY</span>
          <Switch
            checked={form.skip_weekends}
            onCheckedChange={(v) => setForm({ ...form, skip_weekends: v })}
          />
        </label>
      </div>
      <p className="text-[10px] text-muted-foreground font-mono">
        Prior-day pending (armed) orders auto-cancel at {settings.session_start_ist} IST when the new session opens.
      </p>
    </div>
  );
}



function StrategyPresetsCard({
  currentSymbol,
  currentSl,
  currentRr,
}: {
  currentSymbol: string;
  currentSl: number;
  currentRr: number;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listStrategyPresets);
  const createFn = useServerFn(createStrategyPreset);
  const deleteFn = useServerFn(deleteStrategyPreset);
  const applyFn = useServerFn(applyStrategyPreset);
  const q = useQuery({ queryKey: ["strategy-presets"], queryFn: () => listFn() });
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState<string>(currentSymbol);
  const [sl, setSl] = useState<number>(currentSl);
  const [rr, setRr] = useState<number>(currentRr);
  const [scope, setScope] = useState<string>("current");
  const SUPPORTED_SYMBOLS = ["XAUUSDT", "BTCUSDT"];
  const extraSymbols = SUPPORTED_SYMBOLS.filter((s) => s !== currentSymbol.toUpperCase());


  useEffect(() => {
    setSymbol(currentSymbol);
    setSl(currentSl);
    setRr(currentRr);
  }, [currentSymbol, currentSl, currentRr]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["strategy-presets"] });
    qc.invalidateQueries({ queryKey: ["strategy-state"] });
  };

  const createMut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          name: name.trim(),
          symbol: scope === "any" ? null : (scope === "current" ? symbol.trim().toUpperCase() : scope),
          sl_risk_usd: sl,
          rr,
        },
      }),
    onSuccess: () => {
      toast.success("Preset saved");
      setName("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyMut = useMutation({
    mutationFn: (id: string) => applyFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Preset applied to live strategy");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Preset deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const presets = (q.data ?? []) as Array<{
    id: string;
    name: string;
    symbol: string | null;
    sl_risk_usd: number;
    rr: number;
  }>;

  return (
    <div className="border border-border rounded p-3 bg-muted/30 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-xs tracking-widest text-muted-foreground">
          STRATEGY PRESETS (SL / R:R)
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          Reuse across symbols
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
        <div className="space-y-1 md:col-span-2">
          <label className="text-[10px] font-mono tracking-widest text-muted-foreground">PRESET NAME</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Conservative"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-mono tracking-widest text-muted-foreground">SL ($)</label>
          <Input
            type="number"
            value={sl}
            onChange={(e) => setSl(Number(e.target.value))}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-mono tracking-widest text-muted-foreground">R:R</label>
          <Input
            type="number"
            step="0.1"
            value={rr}
            onChange={(e) => setRr(Number(e.target.value))}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-mono tracking-widest text-muted-foreground">SCOPE</label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="h-8 w-full rounded border border-input bg-background px-2 font-mono text-xs"
          >
            <option value="current">Current symbol ({currentSymbol})</option>
            <option value="any">Any symbol</option>
            {extraSymbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>
      </div>


      <div className="flex justify-end">
        <Button
          size="sm"
          variant="secondary"
          disabled={createMut.isPending || !name.trim() || sl <= 0 || rr <= 0}
          onClick={() => createMut.mutate()}
        >
          {createMut.isPending ? "Saving…" : "Save preset"}
        </Button>
      </div>

      {presets.length === 0 ? (
        <p className="text-[10px] text-muted-foreground font-mono">
          No presets yet. Save one above to reuse SL and R:R quickly.
        </p>
      ) : (
        <div className="space-y-1">
          {presets.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between border border-border rounded px-2 py-1.5 font-mono text-xs bg-background/50"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{p.name}</span>
                <span className="text-muted-foreground">
                  {p.symbol ? p.symbol : "any symbol"}
                </span>
                <span>SL ${Number(p.sl_risk_usd)}</span>
                <span>RR 1:{Number(p.rr)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  disabled={applyMut.isPending}
                  onClick={() => applyMut.mutate(p.id)}
                >
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] text-short"
                  disabled={deleteMut.isPending}
                  onClick={() => deleteMut.mutate(p.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Full strategy configuration editor — mirrors backtest parameters
// and, on save, re-prices today's armed exchange orders so live &
// non-triggered limit orders reflect the new rules immediately.
// ---------------------------------------------------------------

type FullStrategySettings = {
  enabled: boolean;
  symbol: string;
  session_start_ist: string;
  entry_mode: "fib" | "retest" | "market" | "adaptive";
  entry_depth_pct: number;
  sl_depth_pct: number;
  adaptive_strong_break_pct: number;
  adaptive_shallow_depth: number;
  adaptive_deep_depth: number;
  retest_sl_r: number;
  rr: number;
  sl_risk_usd: number;
  trail_enabled: boolean;
  trail_activate_r: number;
  trail_step_r: number;
  skip_weekends: boolean;
};

function FullStrategyEditor({
  settings,
  onSave,
  saving,
}: {
  settings: FullStrategySettings;
  onSave: (patch: Partial<FullStrategySettings>) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<FullStrategySettings>(settings);
  const [baseline, setBaseline] = useState<FullStrategySettings>(settings);

  // Refresh form when server sends new values (e.g. after a save or preset apply)
  useEffect(() => {
    setForm(settings);
    setBaseline(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.enabled,
    settings.symbol,
    settings.session_start_ist,
    settings.entry_mode,
    settings.entry_depth_pct,
    settings.sl_depth_pct,
    settings.adaptive_strong_break_pct,
    settings.adaptive_shallow_depth,
    settings.adaptive_deep_depth,
    settings.retest_sl_r,
    settings.rr,
    settings.sl_risk_usd,
    settings.trail_enabled,
    settings.trail_activate_r,
    settings.trail_step_r,
    settings.skip_weekends,
  ]);

  const dirty = (Object.keys(form) as Array<keyof FullStrategySettings>).some(
    (k) => form[k] !== baseline[k],
  );

  const set = <K extends keyof FullStrategySettings>(k: K, v: FullStrategySettings[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground font-mono">
        Changes take effect on the next tick. Any still-armed exchange order for today is
        cancelled and re-placed with the new entry / SL / TP immediately after save.
      </p>

      <div className="grid gap-3 md:grid-cols-4">
        <MiniField label="Enabled">
          <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
        </MiniField>
        <MiniField label="Symbol">
          <Input
            value={form.symbol}
            onChange={(e) => set("symbol", e.target.value.toUpperCase())}
          />
        </MiniField>
        <MiniField label="Session start (IST)">
          <Input
            type="time"
            value={form.session_start_ist}
            onChange={(e) => set("session_start_ist", e.target.value)}
          />
        </MiniField>
        <MiniField label="Entry mode">
          <Select
            value={form.entry_mode}
            onValueChange={(v) => set("entry_mode", v as FullStrategySettings["entry_mode"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="adaptive">Adaptive</SelectItem>
              <SelectItem value="fib">Fib</SelectItem>
              <SelectItem value="retest">Retest</SelectItem>
              <SelectItem value="market">Market</SelectItem>
            </SelectContent>
          </Select>
        </MiniField>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MiniNum label="Entry depth (0–0.5)" value={form.entry_depth_pct} step={0.01}
          onChange={(v) => set("entry_depth_pct", v)} />
        <MiniNum label="SL depth (0.1–1)" value={form.sl_depth_pct} step={0.05}
          onChange={(v) => set("sl_depth_pct", v)} />
        <MiniNum label="RR (1:R)" value={form.rr} step={0.1}
          onChange={(v) => set("rr", v)} />
        <MiniNum label="SL risk ($)" value={form.sl_risk_usd} step={1}
          onChange={(v) => set("sl_risk_usd", v)} />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MiniNum label="Adaptive strong break %" value={form.adaptive_strong_break_pct} step={1}
          onChange={(v) => set("adaptive_strong_break_pct", v)} />
        <MiniNum label="Adaptive shallow depth" value={form.adaptive_shallow_depth} step={0.01}
          onChange={(v) => set("adaptive_shallow_depth", v)} />
        <MiniNum label="Adaptive deep depth" value={form.adaptive_deep_depth} step={0.01}
          onChange={(v) => set("adaptive_deep_depth", v)} />
        <MiniNum label="Retest SL (R)" value={form.retest_sl_r} step={0.1}
          onChange={(v) => set("retest_sl_r", v)} />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MiniField label="Trailing SL">
          <Switch checked={form.trail_enabled} onCheckedChange={(v) => set("trail_enabled", v)} />
        </MiniField>
        <MiniNum label="Trail activate (R)" value={form.trail_activate_r} step={0.1}
          onChange={(v) => set("trail_activate_r", v)} />
        <MiniNum label="Trail step (R)" value={form.trail_step_r} step={0.1}
          onChange={(v) => set("trail_step_r", v)} />
        <MiniField label="Skip weekends">
          <Switch checked={form.skip_weekends} onCheckedChange={(v) => set("skip_weekends", v)} />
        </MiniField>
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          disabled={saving || !dirty}
          onClick={() => onSave(form)}
        >
          {saving ? "Saving & repricing…" : dirty ? "Save & apply to live" : "No changes"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={saving || !dirty}
          onClick={() => setForm(baseline)}
        >
          Discard
        </Button>
      </div>
    </div>
  );
}

function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </Label>
      <div>{children}</div>
    </div>
  );
}

function MiniNum({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <MiniField label={label}>
      <Input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </MiniField>
  );
}
