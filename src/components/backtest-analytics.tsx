import { useMemo } from "react";

// Any engine day-row that carries an IST date and a realized $ P&L.
export interface AnalyticsDay {
  ist_date: string; // YYYY-MM-DD in IST
  pnl_usd: number;
  outcome?: string; // "tp" | "sl" | "open" | ...
}

const WD_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function fmtUsd(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(0)}`;
}

function pnlClass(n: number): string {
  if (n > 0) return "text-emerald-400";
  if (n < 0) return "text-red-400";
  return "text-muted-foreground";
}

function istWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Universal monthly + weekday breakdown for any backtest result that exposes
 * `days: [{ ist_date, pnl_usd, outcome? }]`. Purely presentational —
 * aggregation happens client-side so every engine gets it for free.
 */
export function BacktestAnalytics({
  days,
  title = "Monthly + weekday breakdown",
}: {
  days: AnalyticsDay[];
  title?: string;
}) {
  const { monthly, weekday, bestMonth, worstMonth, bestWd, worstWd } = useMemo(() => {
    // Monthly aggregation.
    const monthMap = new Map<
      string,
      { key: string; year: number; month: number; pnl: number; trades: number; wins: number; losses: number }
    >();
    for (const d of days) {
      const [y, m] = d.ist_date.split("-").map((n) => parseInt(n, 10));
      const key = `${y}-${String(m).padStart(2, "0")}`;
      let bucket = monthMap.get(key);
      if (!bucket) {
        bucket = { key, year: y, month: m, pnl: 0, trades: 0, wins: 0, losses: 0 };
        monthMap.set(key, bucket);
      }
      const pnl = Number(d.pnl_usd ?? 0);
      bucket.pnl += pnl;
      const decided = d.outcome === "tp" || d.outcome === "sl" || (!d.outcome && pnl !== 0);
      if (decided) {
        bucket.trades++;
        if (pnl > 0) bucket.wins++;
        else if (pnl < 0) bucket.losses++;
      } else if (d.outcome && d.outcome !== "skipped" && d.outcome !== "no_sweep" && d.outcome !== "no_asia_range" && d.outcome !== "armed_no_trigger") {
        bucket.trades++;
      }
    }
    const monthly = [...monthMap.values()].sort((a, b) => (a.key < b.key ? 1 : -1));

    // Weekday aggregation.
    const wdArr = Array.from({ length: 7 }, (_, i) => ({
      wd: i,
      pnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
    }));
    for (const d of days) {
      const wd = istWeekday(d.ist_date);
      const b = wdArr[wd];
      const pnl = Number(d.pnl_usd ?? 0);
      b.pnl += pnl;
      const decided = d.outcome === "tp" || d.outcome === "sl" || (!d.outcome && pnl !== 0);
      if (decided) {
        b.trades++;
        if (pnl > 0) b.wins++;
        else if (pnl < 0) b.losses++;
      }
    }

    // Reorder to Mon..Sun for display (Sun=0 in JS).
    const displayOrder = [1, 2, 3, 4, 5, 6, 0];
    const weekday = displayOrder.map((wd) => wdArr[wd]);

    const active = weekday.filter((w) => w.trades > 0);
    const bestWd = active.reduce<(typeof active)[number] | null>((b, w) => (b == null || w.pnl > b.pnl ? w : b), null);
    const worstWd = active.reduce<(typeof active)[number] | null>((b, w) => (b == null || w.pnl < b.pnl ? w : b), null);

    const bestMonth = monthly.reduce<(typeof monthly)[number] | null>((b, m) => (b == null || m.pnl > b.pnl ? m : b), null);
    const worstMonth = monthly.reduce<(typeof monthly)[number] | null>((b, m) => (b == null || m.pnl < b.pnl ? m : b), null);

    return { monthly, weekday, bestMonth, worstMonth, bestWd, worstWd };
  }, [days]);

  if (days.length === 0) return null;

  return (
    <div className="rounded border border-border p-3 text-[11px] font-mono space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{title}</div>
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          {bestMonth && (
            <span>
              best month <span className="text-emerald-400">{MONTH_LABELS[bestMonth.month - 1]} {bestMonth.year} ({fmtUsd(bestMonth.pnl)})</span>
            </span>
          )}
          {bestWd && (
            <span>
              best day <span className="text-emerald-400">{WD_LABELS[bestWd.wd]} ({fmtUsd(bestWd.pnl)})</span>
            </span>
          )}
          {worstWd && (
            <span>
              worst day <span className="text-red-400">{WD_LABELS[worstWd.wd]} ({fmtUsd(worstWd.pnl)})</span>
            </span>
          )}
        </div>
      </div>

      {/* Weekday breakdown */}
      <div>
        <div className="text-[10px] text-muted-foreground mb-1">Weekday performance</div>
        <table className="w-full">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left py-1">Day</th>
              <th className="text-right py-1">Trades</th>
              <th className="text-right py-1">W</th>
              <th className="text-right py-1">L</th>
              <th className="text-right py-1">Win %</th>
              <th className="text-right py-1">Net P&amp;L</th>
              <th className="text-right py-1">Avg / trade</th>
            </tr>
          </thead>
          <tbody>
            {weekday.map((w) => {
              const decided = w.wins + w.losses;
              const winPct = decided > 0 ? (w.wins / decided) * 100 : 0;
              const avg = w.trades > 0 ? w.pnl / w.trades : 0;
              return (
                <tr key={w.wd} className="border-t border-border">
                  <td className="py-1">{WD_LABELS[w.wd]}</td>
                  <td className="py-1 text-right">{w.trades}</td>
                  <td className="py-1 text-right text-emerald-400">{w.wins}</td>
                  <td className="py-1 text-right text-red-400">{w.losses}</td>
                  <td className="py-1 text-right">{decided > 0 ? `${winPct.toFixed(0)}%` : "—"}</td>
                  <td className={`py-1 text-right ${pnlClass(w.pnl)}`}>{fmtUsd(w.pnl)}</td>
                  <td className={`py-1 text-right ${pnlClass(avg)}`}>{w.trades > 0 ? fmtUsd(avg) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Monthly breakdown */}
      {monthly.length > 0 && (
        <div>
          <div className="text-[10px] text-muted-foreground mb-1">Monthly performance</div>
          <table className="w-full">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left py-1">Month</th>
                <th className="text-right py-1">Trades</th>
                <th className="text-right py-1">W</th>
                <th className="text-right py-1">L</th>
                <th className="text-right py-1">Win %</th>
                <th className="text-right py-1">Net P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => {
                const decided = m.wins + m.losses;
                const winPct = decided > 0 ? (m.wins / decided) * 100 : 0;
                const highlight =
                  bestMonth && m.key === bestMonth.key
                    ? "bg-emerald-500/5"
                    : worstMonth && m.key === worstMonth.key
                      ? "bg-red-500/5"
                      : "";
                return (
                  <tr key={m.key} className={`border-t border-border ${highlight}`}>
                    <td className="py-1">{MONTH_LABELS[m.month - 1]} {m.year}</td>
                    <td className="py-1 text-right">{m.trades}</td>
                    <td className="py-1 text-right text-emerald-400">{m.wins}</td>
                    <td className="py-1 text-right text-red-400">{m.losses}</td>
                    <td className="py-1 text-right">{decided > 0 ? `${winPct.toFixed(0)}%` : "—"}</td>
                    <td className={`py-1 text-right ${pnlClass(m.pnl)}`}>{fmtUsd(m.pnl)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
