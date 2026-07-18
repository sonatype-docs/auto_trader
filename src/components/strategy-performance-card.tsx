import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStrategyPerformance } from "@/lib/analytics.functions";

type Period = "ytd" | "month" | "week" | "all";
type Mode = "all" | "paper" | "live";

function todayIstKey(): string {
  const d = new Date(Date.now() + (5 * 60 + 30) * 60_000);
  return d.toISOString().slice(0, 10);
}
function fmtUsd(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

export interface StrategyPerformanceCardProps {
  title?: string;
  defaultMode?: Mode;
  lockMode?: boolean;
  showStrategyFilter?: boolean;
}

export function StrategyPerformanceCard({
  title = "Strategy performance",
  defaultMode = "all",
  lockMode = false,
  showStrategyFilter = false,
}: StrategyPerformanceCardProps) {
  const [period, setPeriod] = useState<Period>("ytd");
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [strategy, setStrategy] = useState<string>("all");
  const anchor = todayIstKey();
  const effectiveMode = lockMode ? defaultMode : mode;

  const fetchPerf = useServerFn(getStrategyPerformance);
  const { data, isLoading, error } = useQuery({
    queryKey: ["strategy-perf", period, effectiveMode, anchor],
    queryFn: () => fetchPerf({ data: { period, mode: effectiveMode, anchor } }),
    refetchInterval: 60_000,
  });

  const allRows = data?.rows ?? [];
  const strategyOptions = useMemo(() => {
    const set = new Set<string>();
    allRows.forEach((r) => set.add(r.strategy_preset));
    return Array.from(set).sort();
  }, [allRows]);

  const rows = useMemo(() => {
    if (!showStrategyFilter || strategy === "all") return allRows;
    return allRows.filter((r) => r.strategy_preset === strategy);
  }, [allRows, strategy, showStrategyFilter]);

  const totals = useMemo(() => {
    if (!rows.length) return null;
    return rows.reduce(
      (acc, r) => ({
        totalTrades: acc.totalTrades + r.totalTrades,
        longTrades: acc.longTrades + r.longTrades,
        shortTrades: acc.shortTrades + r.shortTrades,
        wins: acc.wins + r.wins,
        losses: acc.losses + r.losses,
        fees: acc.fees + r.fees,
        netPnl: acc.netPnl + r.netPnl,
      }),
      { totalTrades: 0, longTrades: 0, shortTrades: 0, wins: 0, losses: 0, fees: 0, netPnl: 0 },
    );
  }, [rows]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="font-semibold">{title}</span>
          <div className="flex flex-wrap items-center gap-2">
            {showStrategyFilter && (
              <Select value={strategy} onValueChange={setStrategy}>
                <SelectTrigger className="h-8 w-[180px]"><SelectValue placeholder="Strategy" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All strategies</SelectItem>
                  {strategyOptions.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <ToggleGroup type="single" value={period} onValueChange={(v) => v && setPeriod(v as Period)} variant="outline" size="sm">
              <ToggleGroupItem value="week">Week</ToggleGroupItem>
              <ToggleGroupItem value="month">Month</ToggleGroupItem>
              <ToggleGroupItem value="ytd">YTD</ToggleGroupItem>
              <ToggleGroupItem value="all">All</ToggleGroupItem>
            </ToggleGroup>
            {!lockMode && (
              <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as Mode)} variant="outline" size="sm">
                <ToggleGroupItem value="all">All</ToggleGroupItem>
                <ToggleGroupItem value="live">Live</ToggleGroupItem>
                <ToggleGroupItem value="paper">Paper</ToggleGroupItem>
              </ToggleGroup>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="grid h-40 place-items-center text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Symbol · TF</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">L / S</TableHead>
                  <TableHead className="text-right">W / L</TableHead>
                  <TableHead className="text-right">Win %</TableHead>
                  <TableHead className="text-right">Avg PnL</TableHead>
                  <TableHead className="text-right">Best</TableHead>
                  <TableHead className="text-right">Worst</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Net PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-6">No trades in this period</TableCell></TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="font-medium">{r.strategy_preset}</TableCell>
                      <TableCell className="text-muted-foreground">{r.symbol} · {r.timeframe}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${r.source === "live" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                          {r.source}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">{r.totalTrades}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        <span className="text-long">{r.longTrades}</span> / <span className="text-short">{r.shortTrades}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        <span className="text-long">{r.wins}</span> / <span className="text-short">{r.losses}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono">{(r.winRate * 100).toFixed(1)}%</TableCell>
                      <TableCell className={`text-right font-mono ${r.avgPnl > 0 ? "text-long" : r.avgPnl < 0 ? "text-short" : ""}`}>{fmtUsd(r.avgPnl)}</TableCell>
                      <TableCell className="text-right font-mono text-long">{fmtUsd(r.bestPnl)}</TableCell>
                      <TableCell className="text-right font-mono text-short">{fmtUsd(r.worstPnl)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{r.fees.toFixed(2)}</TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${r.netPnl > 0 ? "text-long" : r.netPnl < 0 ? "text-short" : ""}`}>{fmtUsd(r.netPnl)}</TableCell>
                    </TableRow>
                  ))
                )}
                {totals && rows.length > 0 && (
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell colSpan={3}>Totals</TableCell>
                    <TableCell className="text-right font-mono">{totals.totalTrades}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      <span className="text-long">{totals.longTrades}</span> / <span className="text-short">{totals.shortTrades}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      <span className="text-long">{totals.wins}</span> / <span className="text-short">{totals.losses}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {totals.totalTrades ? ((totals.wins / totals.totalTrades) * 100).toFixed(1) + "%" : "—"}
                    </TableCell>
                    <TableCell colSpan={3} />
                    <TableCell className="text-right font-mono text-muted-foreground">{totals.fees.toFixed(2)}</TableCell>
                    <TableCell className={`text-right font-mono ${totals.netPnl > 0 ? "text-long" : totals.netPnl < 0 ? "text-short" : ""}`}>{fmtUsd(totals.netPnl)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
