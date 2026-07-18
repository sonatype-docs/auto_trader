import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { getPnlCalendar } from "@/lib/analytics.functions";
import { StrategyPerformanceCard } from "@/components/strategy-performance-card";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — Shark" },
      { name: "description", content: "Daily realized & unrealized PnL calendar with strategy filters." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AnalyticsPage,
});

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function currentIstMonth(): string {
  const d = new Date(Date.now() + (5 * 60 + 30) * 60_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function todayIstKey(): string {
  const d = new Date(Date.now() + (5 * 60 + 30) * 60_000);
  return d.toISOString().slice(0, 10);
}
function fmtUsd(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}
function fmtMonthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Cell = { date: string; realized: number; trades: number; wins: number; losses: number };

function AnalyticsPage() {
  const [month, setMonth] = useState<string>(currentIstMonth());
  const [symbol, setSymbol] = useState<string>("all");
  const [mode, setMode] = useState<"all" | "paper" | "live">("all");

  const fetchCal = useServerFn(getPnlCalendar);
  const { data, isLoading, error } = useQuery({
    queryKey: ["pnl-calendar", month, symbol, mode],
    queryFn: () => fetchCal({ data: { month, symbol: symbol === "all" ? undefined : symbol, mode } }),
    refetchInterval: 30_000,
  });

  const byDate = useMemo(() => {
    const m = new Map<string, Cell>();
    (data?.days ?? []).forEach((d) => m.set(d.date, d));
    return m;
  }, [data]);

  const weeks = useMemo(() => buildMonthGrid(month), [month]);
  const today = todayIstKey();

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">Daily realized PnL with strategy & mode filters.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={symbol} onValueChange={setSymbol}>
            <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Strategy" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All strategies</SelectItem>
              {(data?.symbols ?? []).map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as typeof mode)} variant="outline" size="sm">
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="live">Live</ToggleGroupItem>
            <ToggleGroupItem value="paper">Paper</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Kpi label="Realized (Month)" value={fmtUsd(data?.summary.monthTotal ?? 0)} tone={toneOf(data?.summary.monthTotal ?? 0)} icon={TrendingUp} />
        <Kpi label="Unrealized (Now)" value={fmtUsd(data?.unrealized ?? 0)} tone={toneOf(data?.unrealized ?? 0)} icon={Activity} sub={`${data?.openPositions.length ?? 0} open`} />
        <Kpi label="Trades" value={String(data?.summary.trades ?? 0)} tone="neutral" icon={TrendingUp} sub={`${data?.summary.wins ?? 0}W · ${data?.summary.losses ?? 0}L`} />
        <Kpi label="Win rate" value={winRate(data?.summary.wins ?? 0, data?.summary.losses ?? 0)} tone="neutral" icon={TrendingDown} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="font-semibold">{fmtMonthLabel(month)}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="ml-1 h-7 text-xs" onClick={() => setMonth(currentIstMonth())}>Today</Button>
            </div>
            <span className="text-xs font-normal text-muted-foreground">IST · dates shown in Asia/Kolkata</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="grid h-40 place-items-center text-sm text-destructive">
              {error instanceof Error ? error.message : "Failed to load"}
            </div>
          ) : (
            <TooltipProvider delayDuration={100}>
              <div className="grid grid-cols-7 gap-1.5 text-[11px] font-medium text-muted-foreground mb-1.5">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className="px-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {weeks.map((day) => {
                  if (!day) return <div key={Math.random()} className="h-20 rounded-md bg-muted/30" />;
                  const cell = byDate.get(day.date);
                  const pnl = cell?.realized ?? 0;
                  const bg = pnlBg(pnl);
                  const isToday = day.date === today;
                  const isCurrentMonth = day.date.startsWith(month);
                  return (
                    <Tooltip key={day.date}>
                      <TooltipTrigger asChild>
                        <div
                          className={[
                            "h-20 rounded-md border p-2 flex flex-col justify-between transition-all cursor-default",
                            isCurrentMonth ? bg : "bg-muted/30 opacity-50",
                            isToday ? "ring-2 ring-primary/60 border-primary/50" : "border-border/60",
                            isLoading ? "animate-pulse" : "hover:scale-[1.02] hover:shadow-sm",
                          ].join(" ")}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold">{day.dayNum}</span>
                            {cell && cell.trades > 0 && (
                              <span className="text-[10px] text-muted-foreground">{cell.trades}t</span>
                            )}
                          </div>
                          {cell && cell.trades > 0 ? (
                            <div className={`font-mono text-sm font-semibold ${pnl > 0 ? "text-long" : pnl < 0 ? "text-short" : ""}`}>
                              {fmtUsd(pnl)}
                            </div>
                          ) : (
                            <div className="text-[10px] text-muted-foreground">—</div>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        <div className="font-semibold">{day.date}</div>
                        {cell && cell.trades > 0 ? (
                          <>
                            <div>Realized: <span className="font-mono">{fmtUsd(pnl)}</span></div>
                            <div>Trades: {cell.trades} ({cell.wins}W · {cell.losses}L)</div>
                          </>
                        ) : (
                          <div className="text-muted-foreground">No trades</div>
                        )}
                        {isToday && (data?.openPositions.length ?? 0) > 0 && (
                          <div className="mt-1 border-t border-border pt-1">
                            Unrealized: <span className="font-mono">{fmtUsd(data?.unrealized ?? 0)}</span>
                          </div>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
              <Legend />
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      <StrategyPerformanceCard />
    </div>
  );
}


function Kpi({ label, value, tone, icon: Icon, sub }: {
  label: string; value: string; tone: "pos" | "neg" | "neutral";
  icon: React.ComponentType<{ className?: string }>; sub?: string;
}) {
  const color = tone === "pos" ? "text-long" : tone === "neg" ? "text-short" : "text-foreground";
  return (
    <Card className="card-hover">
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className={`mt-1 font-mono text-2xl font-bold ${color}`}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Legend() {
  return (
    <div className="mt-4 flex items-center gap-3 text-[11px] text-muted-foreground">
      <span>Less</span>
      <div className="flex gap-1">
        {["bg-short/60", "bg-short/30", "bg-muted/40", "bg-long/30", "bg-long/60"].map((c) => (
          <div key={c} className={`h-3 w-6 rounded-sm ${c}`} />
        ))}
      </div>
      <span>More</span>
      <span className="ml-auto">Today ringed in violet</span>
    </div>
  );
}

function toneOf(n: number): "pos" | "neg" | "neutral" {
  if (n > 0) return "pos";
  if (n < 0) return "neg";
  return "neutral";
}
function winRate(w: number, l: number): string {
  const t = w + l;
  if (!t) return "—";
  return `${((w / t) * 100).toFixed(1)}%`;
}
function pnlBg(pnl: number): string {
  if (pnl === 0) return "bg-card";
  const abs = Math.abs(pnl);
  if (pnl > 0) {
    if (abs > 50) return "bg-long/25";
    if (abs > 10) return "bg-long/15";
    return "bg-long/8";
  }
  if (abs > 50) return "bg-short/25";
  if (abs > 10) return "bg-short/15";
  return "bg-short/8";
}

/** Build a Mon–Sun grid covering the given month, padded with adjacent-month days. */
function buildMonthGrid(month: string): Array<{ date: string; dayNum: number } | null> {
  const [y, mo] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const jsDow = first.getUTCDay(); // 0=Sun..6=Sat
  const monIdx = (jsDow + 6) % 7;  // 0=Mon..6=Sun — cells before the 1st
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells: Array<{ date: string; dayNum: number } | null> = [];

  // Leading days from previous month
  for (let i = monIdx; i > 0; i--) {
    const d = new Date(Date.UTC(y, mo - 1, 1 - i));
    cells.push({ date: d.toISOString().slice(0, 10), dayNum: d.getUTCDate() });
  }
  // This month
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    cells.push({ date: dt.toISOString().slice(0, 10), dayNum: d });
  }
  // Trailing to complete final week
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]!;
    const [ly, lm, ld] = last.date.split("-").map(Number);
    const dt = new Date(Date.UTC(ly, lm - 1, ld + 1));
    cells.push({ date: dt.toISOString().slice(0, 10), dayNum: dt.getUTCDate() });
  }
  return cells;
}
