// Research — pure analytics on TradeRecord[]. No side effects. No trading.
import type { TradeRecord } from "@/lib/trade-intelligence/types";

export interface Kpis {
  total: number;
  winners: number;
  losers: number;
  breakEven: number;
  winRate: number;
  lossRate: number;
  netProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  expectancy: number;
  averageWin: number;
  averageLoss: number;
  averageRr: number;
  maxWinStreak: number;
  maxLossStreak: number;
  averageHoldingMs: number;
  averageFillDelayMs: number;
  maxDrawdown: number;
  recoveryFactor: number;
}

export function num(x: unknown, d = 0): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : d;
}

export function sortByExit(rows: TradeRecord[]): TradeRecord[] {
  return [...rows].sort((a, b) => a.exitTime - b.exitTime);
}

export function computeKpis(rows: TradeRecord[]): Kpis {
  const trades = sortByExit(rows);
  const winners = trades.filter((t) => t.netPnl > 0);
  const losers = trades.filter((t) => t.netPnl < 0);
  const breakEven = trades.length - winners.length - losers.length;
  const gross = winners.reduce((s, t) => s + t.netPnl, 0);
  const loss = Math.abs(losers.reduce((s, t) => s + t.netPnl, 0));
  const net = trades.reduce((s, t) => s + t.netPnl, 0);
  const avgWin = winners.length ? gross / winners.length : 0;
  const avgLoss = losers.length ? loss / losers.length : 0;
  const winRate = trades.length ? winners.length / trades.length : 0;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

  let winStreak = 0, lossStreak = 0, maxW = 0, maxL = 0;
  for (const t of trades) {
    if (t.netPnl > 0) { winStreak++; lossStreak = 0; }
    else if (t.netPnl < 0) { lossStreak++; winStreak = 0; }
    maxW = Math.max(maxW, winStreak); maxL = Math.max(maxL, lossStreak);
  }

  // Equity + drawdown
  let equity = 0, peak = 0, maxDd = 0;
  for (const t of trades) {
    equity += t.netPnl;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  const avgHold = trades.length
    ? trades.reduce((s, t) => s + num(t.durationMs), 0) / trades.length : 0;
  const fillDelays = trades
    .map((t) => (t.fillTime && t.orderTime ? t.fillTime - t.orderTime : null))
    .filter((n): n is number => n !== null);
  const avgFill = fillDelays.length ? fillDelays.reduce((s, n) => s + n, 0) / fillDelays.length : 0;

  const rrs = trades.map((t) => num(t.actualRr)).filter((n) => n !== 0);
  const avgRr = rrs.length ? rrs.reduce((s, n) => s + n, 0) / rrs.length : 0;

  return {
    total: trades.length,
    winners: winners.length,
    losers: losers.length,
    breakEven,
    winRate,
    lossRate: trades.length ? losers.length / trades.length : 0,
    netProfit: net,
    grossProfit: gross,
    grossLoss: loss,
    profitFactor: loss > 0 ? gross / loss : gross > 0 ? Infinity : 0,
    expectancy,
    averageWin: avgWin,
    averageLoss: avgLoss,
    averageRr: avgRr,
    maxWinStreak: maxW,
    maxLossStreak: maxL,
    averageHoldingMs: avgHold,
    averageFillDelayMs: avgFill,
    maxDrawdown: maxDd,
    recoveryFactor: maxDd > 0 ? net / maxDd : 0,
  };
}

export interface EquityPoint {
  index: number;
  exitTime: number;
  equity: number;
  peak: number;
  drawdown: number;
  ddPct: number;
}

export function equityCurve(rows: TradeRecord[]): EquityPoint[] {
  const trades = sortByExit(rows);
  const out: EquityPoint[] = [];
  let equity = 0, peak = 0;
  trades.forEach((t, i) => {
    equity += t.netPnl;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    out.push({
      index: i + 1,
      exitTime: t.exitTime,
      equity,
      peak,
      drawdown: -dd,
      ddPct: peak > 0 ? -(dd / peak) : 0,
    });
  });
  return out;
}

export type EquityBucket = "D" | "W" | "M" | "Q" | "Y";

export function bucketKey(ms: number, bucket: EquityBucket): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  switch (bucket) {
    case "D": return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    case "W": {
      const t = new Date(Date.UTC(y, m, day));
      const dayNum = (t.getUTCDay() + 6) % 7;
      t.setUTCDate(t.getUTCDate() - dayNum);
      return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
    }
    case "M": return `${y}-${String(m + 1).padStart(2, "0")}`;
    case "Q": return `${y}-Q${Math.floor(m / 3) + 1}`;
    case "Y": return String(y);
  }
}

export function rolledPnl(rows: TradeRecord[], bucket: EquityBucket) {
  const map = new Map<string, { key: string; pnl: number; trades: number; wins: number }>();
  for (const t of sortByExit(rows)) {
    const k = bucketKey(t.exitTime, bucket);
    const e = map.get(k) ?? { key: k, pnl: 0, trades: 0, wins: 0 };
    e.pnl += t.netPnl; e.trades += 1; if (t.netPnl > 0) e.wins += 1;
    map.set(k, e);
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export function groupBy<K extends string>(
  rows: TradeRecord[],
  keyFn: (t: TradeRecord) => K | null | undefined,
): Array<{ key: K; kpis: Kpis; rows: TradeRecord[] }> {
  const map = new Map<K, TradeRecord[]>();
  for (const t of rows) {
    const k = keyFn(t); if (k == null) continue;
    const arr = map.get(k) ?? []; arr.push(t); map.set(k, arr);
  }
  return Array.from(map.entries())
    .map(([key, r]) => ({ key, rows: r, kpis: computeKpis(r) }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
}
