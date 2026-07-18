import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { getPnlCalendar } from "@/lib/analytics.functions";

type Mode = "all" | "paper" | "live";
type Cell = { date: string; realized: number; trades: number; wins: number; losses: number; bestTrade: number; worstTrade: number };

interface Props {
  defaultMode?: Mode;
  lockMode?: boolean;
  showStrategyFilter?: boolean;
  showKpis?: boolean;
  showToday?: boolean;
}

function monthKeyFromDate(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function currentIstMonth() {
  return monthKeyFromDate(new Date(Date.now() + (5 * 60 + 30) * 60_000));
}
function todayIstKey() {
  return new Date(Date.now() + (5 * 60 + 30) * 60_000).toISOString().slice(0, 10);
}
function fmtUsd(n: number) {
  const s = n > 0 ? "+" : "";
  return `${s}${n.toFixed(2)}`;
}
function fmtMonthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
function shiftMonth(m: string, delta: number) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return monthKeyFromDate(d);
}
function toneOf(n: number): "pos" | "neg" | "neutral" {
  if (n > 0) return "pos";
  if (n < 0) return "neg";
  return "neutral";
}
function winRate(w: number, l: number) {
  const t = w + l;
  if (!t) return "—";
  return `${((w / t) * 100).toFixed(1)}%`;
}
function pnlBg(pnl: number) {
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
function buildMonthGrid(month: string) {
  const [y, mo] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const monIdx = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells: Array<{ date: string; dayNum: number } | null> = [];
  for (let i = monIdx; i > 0; i--) {
    const d = new Date(Date.UTC(y, mo - 1, 1 - i));
    cells.push({ date: d.toISOString().slice(0, 10), dayNum: d.getUTCDate() });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    cells.push({ date: dt.toISOString().slice(0, 10), dayNum: d });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]!;
    const [ly, lm, ld] = last.date.split("-").map(Number);
    const dt = new Date(Date.UTC(ly, lm - 1, ld + 1));
    cells.push({ date: dt.toISOString().slice(0, 10), dayNum: dt.getUTCDate() });
  }
  return cells;
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

export function PnlCalendarCard({
  defaultMode = "all",
  lockMode = false,
  showStrategyFilter = true,
  showKpis = true,
  showToday = false,
}: Props) {
  const [month, setMonth] = useState<string>(currentIstMonth());
  const [symbol, setSymbol] = useState<string>("all");
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

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
  const activeDate = selectedDate ?? today;
  const isToday = activeDate === today;


  return (
    <div className="space-y-4">
      {(showStrategyFilter || !lockMode) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {showStrategyFilter && (
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Strategy" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All strategies</SelectItem>
                {(data?.symbols ?? []).map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!lockMode && (
            <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as Mode)} variant="outline" size="sm">
              <ToggleGroupItem value="all">All</ToggleGroupItem>
              <ToggleGroupItem value="live">Live</ToggleGroupItem>
              <ToggleGroupItem value="paper">Paper</ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
      )}

      {showKpis && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Kpi label="Realized (Month)" value={fmtUsd(data?.summary.monthTotal ?? 0)} tone={toneOf(data?.summary.monthTotal ?? 0)} icon={TrendingUp} />
          <Kpi label="Unrealized (Now)" value={fmtUsd(data?.unrealized ?? 0)} tone={toneOf(data?.unrealized ?? 0)} icon={Activity} sub={`${data?.openPositions.length ?? 0} open`} />
          <Kpi label="Trades" value={String(data?.summary.trades ?? 0)} tone="neutral" icon={TrendingUp} sub={`${data?.summary.wins ?? 0}W · ${data?.summary.losses ?? 0}L`} />
          <Kpi label="Win rate" value={winRate(data?.summary.wins ?? 0, data?.summary.losses ?? 0)} tone="neutral" icon={TrendingDown} />
        </div>
      )}

      {showToday && (() => {
        const t = byDate.get(activeDate);
        const realized = t?.realized ?? 0;
        const trades = t?.trades ?? 0;
        const wins = t?.wins ?? 0;
        const losses = t?.losses ?? 0;
        const best = t?.bestTrade ?? 0;
        const worst = t?.worstTrade ?? 0;
        const unreal = isToday ? (data?.unrealized ?? 0) : 0;
        return (
          <Card className="border-primary/40">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {isToday ? "Today" : "Selected"} · {activeDate}
                </div>
                <div className="flex items-center gap-2">
                  {!isToday && (
                    <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setSelectedDate(null)}>
                      Back to today
                    </Button>
                  )}
                  <div className="text-[10px] text-muted-foreground">IST</div>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <div className="text-[11px] text-muted-foreground">Realized P&L</div>
                  <div className={`font-mono text-xl font-bold ${realized > 0 ? "text-long" : realized < 0 ? "text-short" : ""}`}>{fmtUsd(realized)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Unrealized</div>
                  <div className={`font-mono text-xl font-bold ${unreal > 0 ? "text-long" : unreal < 0 ? "text-short" : ""}`}>{isToday ? fmtUsd(unreal) : "—"}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Month P&L</div>
                  <div className={`font-mono text-xl font-bold ${(data?.summary.monthTotal ?? 0) > 0 ? "text-long" : (data?.summary.monthTotal ?? 0) < 0 ? "text-short" : ""}`}>{fmtUsd(data?.summary.monthTotal ?? 0)}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{fmtMonthLabel(month)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Trades</div>
                  <div className="font-mono text-xl font-bold">{trades}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">W · L</div>
                  <div className="font-mono text-xl font-bold">
                    <span className="text-long">{wins}</span>
                    <span className="text-muted-foreground"> · </span>
                    <span className="text-short">{losses}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Best trade</div>
                  <div className="font-mono text-xl font-bold text-long">{trades > 0 ? fmtUsd(best) : "—"}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Worst trade</div>
                  <div className="font-mono text-xl font-bold text-short">{trades > 0 ? fmtUsd(worst) : "—"}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}


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
              <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                {weeks.map((day, i) => {
                  if (!day) return <div key={i} className="h-14 sm:h-20 rounded-md bg-muted/30" />;
                  const cell = byDate.get(day.date);
                  const pnl = cell?.realized ?? 0;
                  const bg = pnlBg(pnl);
                  const isToday = day.date === today;
                  const isSelected = day.date === selectedDate;
                  const isCurrentMonth = day.date.startsWith(month);
                  return (
                    <Tooltip key={day.date}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setSelectedDate(day.date === today ? null : day.date)}
                          className={[
                            "h-14 sm:h-20 w-full text-left rounded-md border p-1 sm:p-2 flex flex-col justify-between transition-all cursor-pointer overflow-hidden",
                            isCurrentMonth ? bg : "bg-muted/30 opacity-50",
                            isSelected ? "ring-2 ring-accent border-accent" : isToday ? "ring-2 ring-primary/60 border-primary/50" : "border-border/60",
                            isLoading ? "animate-pulse" : "hover:scale-[1.02] hover:shadow-sm",
                          ].join(" ")}
                        >

                          <div className="flex items-center justify-between gap-0.5 leading-none">
                            <span className="text-[10px] sm:text-[11px] font-semibold">{day.dayNum}</span>
                            {cell && cell.trades > 0 && (
                              <span className="text-[9px] sm:text-[10px] text-muted-foreground">{cell.trades}t</span>
                            )}
                          </div>
                          {cell && cell.trades > 0 ? (
                            <div className={`font-mono text-[10px] sm:text-sm font-semibold truncate ${pnl > 0 ? "text-long" : pnl < 0 ? "text-short" : ""}`}>
                              {fmtUsd(pnl)}
                            </div>
                          ) : (
                            <div className="text-[10px] text-muted-foreground">—</div>
                          )}
                        </button>

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
    </div>
  );
}
