import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TradeDTO, PositionDTO } from "@/lib/paper-trading.functions";

interface Props {
  trades: TradeDTO[];
  positions: PositionDTO[];
  riskPerTradeUsd?: number;
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;
}

export function PaperStatsCard({ trades, positions, riskPerTradeUsd = 20 }: Props) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startTodayMs = start.getTime();
  const startMonth = new Date();
  startMonth.setDate(1);
  startMonth.setHours(0, 0, 0, 0);
  const startMonthMs = startMonth.getTime();

  const ts = (t: TradeDTO) => (t.exit_ts ? new Date(t.exit_ts).getTime() : 0);
  const today = trades.filter((t) => ts(t) >= startTodayMs);
  const month = trades.filter((t) => ts(t) >= startMonthMs);

  const sum = (rows: TradeDTO[]) => {
    let net = 0, gross = 0, fees = 0, wins = 0, losses = 0;
    for (const t of rows) {
      const n = Number(t.net_pnl ?? 0);
      net += n;
      gross += Number(t.gross_pnl ?? 0);
      fees += Math.abs(Number(t.fees ?? 0));
      if (n > 0) wins += 1;
      else if (n < 0) losses += 1;
    }
    return { net, gross, fees, wins, losses, count: rows.length };
  };

  const t = sum(today);
  const m = sum(month);
  const winRate = t.count ? (t.wins / t.count) * 100 : null;

  const rValues = today.map((x) => Number(x.net_pnl ?? 0) / riskPerTradeUsd);
  const rWins = rValues.filter((v) => v > 0);
  const rLosses = rValues.filter((v) => v < 0);
  const avgRWin = rWins.length ? rWins.reduce((s, v) => s + v, 0) / rWins.length : null;
  const avgRLoss = rLosses.length ? rLosses.reduce((s, v) => s + v, 0) / rLosses.length : null;

  const unreal = positions.reduce((s, p) => s + Number(p.unrealized_pnl ?? 0), 0);

  const tone = (v: number) => (v > 0 ? "text-emerald-500" : v < 0 ? "text-destructive" : "");

  const stats: Array<{ label: string; value: string; hint?: string; tone?: string }> = [
    { label: "Today · Trades", value: String(t.count), hint: `${t.wins}W · ${t.losses}L` },
    { label: "Today · Wins", value: String(t.wins), tone: t.wins > 0 ? "text-emerald-500" : undefined },
    { label: "Today · Losses", value: String(t.losses), tone: t.losses > 0 ? "text-destructive" : undefined },
    { label: "Today · Win rate", value: winRate == null ? "—" : `${winRate.toFixed(0)}%` },
    { label: "Today · Net P&L", value: t.count ? fmtMoney(t.net) : "—", hint: "after fees", tone: tone(t.net) },
    { label: "Today · Fees", value: t.count ? `$${t.fees.toFixed(2)}` : "—", hint: `gross ${fmtMoney(t.gross)}` },
    { label: "R:R · Wins", value: avgRWin == null ? "—" : `+${avgRWin.toFixed(2)}R`, hint: `${rWins.length} win${rWins.length === 1 ? "" : "s"}`, tone: avgRWin != null ? "text-emerald-500" : undefined },
    { label: "R:R · Losses", value: avgRLoss == null ? "—" : `${avgRLoss.toFixed(2)}R`, hint: `${rLosses.length} loss${rLosses.length === 1 ? "" : "es"}`, tone: avgRLoss != null ? "text-destructive" : undefined },
    { label: "Unrealized", value: fmtMoney(unreal), hint: `${positions.length} open`, tone: tone(unreal) },
    { label: "Month · Net P&L", value: m.count ? fmtMoney(m.net) : "—", hint: `${m.wins}W/${m.losses}L · after fees`, tone: tone(m.net) },
    { label: "Month · Fees", value: m.count ? `$${m.fees.toFixed(2)}` : "—", hint: `${m.count} trades` },
    { label: "Month · Gross", value: m.count ? fmtMoney(m.gross) : "—", tone: tone(m.gross) },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Paper trading · stats</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
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
      </CardContent>
    </Card>
  );
}
