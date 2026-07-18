import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";

type Row = {
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
import { getPendingSharkOrders } from "@/lib/strategy.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export const Route = createFileRoute("/pending-orders")({
  head: () => ({
    meta: [
      { title: "Pending Orders — Shark" },
      { name: "description", content: "Live pending LIMIT orders on SharkExchange with price, qty, TP and SL." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PendingOrdersPage,
});

function fmt(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(dp);
}

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }) + " IST";
}

function PendingOrdersPage() {
  const fetchOrders = useServerFn(getPendingSharkOrders);
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["shark", "open-orders"],
    queryFn: () => fetchOrders(),
    refetchInterval: 10_000,
  });

  return (
    <div className="min-h-screen bg-background p-3 md:p-8">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold">Pending Orders</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Live open orders on SharkExchange. Auto-refreshes every 10s.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/">
              <Button variant="ghost" size="sm">← Dashboard</Button>
            </Link>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>


        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span>Open Orders</span>
              <span className="text-xs font-normal text-muted-foreground">
                {data?.fetchedAt ? `Fetched: ${fmtTs(data.fetchedAt)}` : ""}
              </span>
            </CardTitle>

          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-muted-foreground py-8 text-center">Loading…</div>
            ) : error ? (
              <div className="text-sm text-destructive py-8 text-center">
                Client error: {error instanceof Error ? error.message : String(error)}
              </div>
            ) : data && !data.ok ? (
              <div className="text-sm text-destructive py-8 text-center break-all">
                Exchange error: {data.error}
              </div>
            ) : !data || data.rows.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No open orders on Shark right now.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-left">
                      <th className="py-2 pr-3">Order ID</th>
                      <th className="py-2 pr-3">Symbol</th>
                      <th className="py-2 pr-3">Side</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3 text-right">Price</th>
                      <th className="py-2 pr-3 text-right">Qty</th>
                      <th className="py-2 pr-3 text-right">Filled</th>
                      <th className="py-2 pr-3 text-right">SL</th>
                      <th className="py-2 pr-3 text-right">TP</th>
                      <th className="py-2 pr-3">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.rows as Row[]).map((r) => {
                      const sideUp = r.side.toUpperCase();
                      const sideTone =
                        sideUp === "BUY" ? "text-emerald-500" :
                        sideUp === "SELL" ? "text-red-500" : "text-foreground";
                      return (
                        <tr key={r.clientOrderId} className="border-b border-border/40 hover:bg-muted/30">
                          <td className="py-2 pr-3 max-w-[220px] truncate" title={r.clientOrderId}>
                            {r.clientOrderId}
                          </td>
                          <td className="py-2 pr-3">{r.symbol}</td>
                          <td className={`py-2 pr-3 font-semibold ${sideTone}`}>{sideUp}</td>
                          <td className="py-2 pr-3">{r.type.toUpperCase()}</td>
                          <td className="py-2 pr-3">
                            <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                          </td>
                          <td className="py-2 pr-3 text-right">{fmt(r.price, 2)}</td>
                          <td className="py-2 pr-3 text-right">{fmt(r.quantity, 4)}</td>
                          <td className="py-2 pr-3 text-right">{fmt(r.filledAmount, 4)}</td>
                          <td className="py-2 pr-3 text-right text-red-400">{fmt(r.stopLossPrice, 2)}</td>
                          <td className="py-2 pr-3 text-right text-emerald-400">{fmt(r.takeProfitPrice, 2)}</td>
                          <td className="py-2 pr-3 text-muted-foreground">{fmtTs(r.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
