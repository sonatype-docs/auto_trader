import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const CalendarInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/), // "YYYY-MM" (IST)
  symbol: z.string().min(1).max(24).optional(),
  mode: z.enum(["all", "paper", "live"]).default("all"),
});

function istRangeForMonth(month: string): { startUtc: string; endUtc: string } {
  // IST is UTC+5:30, no DST. Convert month boundaries in IST to UTC for filtering.
  const [y, m] = month.split("-").map((n) => Number(n));
  // First day 00:00 IST == previous day 18:30 UTC
  const startUtcMs = Date.UTC(y, m - 1, 1, 0, 0, 0) - (5 * 60 + 30) * 60_000;
  const endUtcMs = Date.UTC(y, m, 1, 0, 0, 0) - (5 * 60 + 30) * 60_000;
  return { startUtc: new Date(startUtcMs).toISOString(), endUtc: new Date(endUtcMs).toISOString() };
}

function istDateKey(iso: string): string {
  const d = new Date(new Date(iso).getTime() + (5 * 60 + 30) * 60_000);
  return d.toISOString().slice(0, 10);
}

type DayCell = {
  date: string;      // YYYY-MM-DD in IST
  realized: number;  // USD
  trades: number;
  wins: number;
  losses: number;
  bestTrade: number;  // max single-trade net_pnl on that day
  worstTrade: number; // min single-trade net_pnl on that day
};

export const getPnlCalendar = createServerFn({ method: "GET" })
  .validator((raw: unknown) => CalendarInput.parse(raw))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { startUtc, endUtc } = istRangeForMonth(data.month);

    // Realized: pull from paper_trades / live_trades so the calendar matches
    // the Strategy Performance table (which reads the same tables).
    type ClosedRow = { symbol: string; net_pnl: number | null; exit_ts: string | null; source: "paper" | "live" };
    const closed: ClosedRow[] = [];

    if (data.mode !== "live") {
      let q = supabase
        .from("paper_trades")
        .select("symbol, net_pnl, exit_ts")
        .not("exit_ts", "is", null)
        .not("net_pnl", "is", null)
        .gte("exit_ts", startUtc)
        .lt("exit_ts", endUtc);
      if (data.symbol) q = q.eq("symbol", data.symbol);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) {
        closed.push({
          symbol: r.symbol as string,
          net_pnl: r.net_pnl as number | null,
          exit_ts: r.exit_ts as string | null,
          source: "paper",
        });
      }
    }

    if (data.mode !== "paper") {
      let q = supabase
        .from("live_trades")
        .select("symbol, net_pnl, exit_ts")
        .not("exit_ts", "is", null)
        .not("net_pnl", "is", null)
        .gte("exit_ts", startUtc)
        .lt("exit_ts", endUtc);
      if (data.symbol) q = q.eq("symbol", data.symbol);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) {
        closed.push({
          symbol: r.symbol as string,
          net_pnl: r.net_pnl as number | null,
          exit_ts: r.exit_ts as string | null,
          source: "live",
        });
      }
    }

    const byDay = new Map<string, DayCell>();
    for (const t of closed) {
      if (!t.exit_ts) continue;
      const key = istDateKey(t.exit_ts);
      const pnl = Number(t.net_pnl ?? 0);
      const cell = byDay.get(key) ?? { date: key, realized: 0, trades: 0, wins: 0, losses: 0, bestTrade: -Infinity, worstTrade: Infinity };
      cell.realized += pnl;
      cell.trades += 1;
      if (pnl > 0) cell.wins += 1;
      else if (pnl < 0) cell.losses += 1;
      if (pnl > cell.bestTrade) cell.bestTrade = pnl;
      if (pnl < cell.worstTrade) cell.worstTrade = pnl;
      byDay.set(key, cell);
    }

    for (const c of byDay.values()) {
      if (!Number.isFinite(c.bestTrade)) c.bestTrade = 0;
      if (!Number.isFinite(c.worstTrade)) c.worstTrade = 0;
    }

    // Symbol filter list: distinct symbols across the relevant table(s).
    const symbolSet = new Set<string>();
    if (data.mode !== "live") {
      const { data: s } = await supabase.from("paper_trades").select("symbol");
      (s ?? []).forEach((r) => r.symbol && symbolSet.add(r.symbol as string));
    }
    if (data.mode !== "paper") {
      const { data: s } = await supabase.from("live_trades").select("symbol");
      (s ?? []).forEach((r) => r.symbol && symbolSet.add(r.symbol as string));
    }
    const symbols = Array.from(symbolSet).sort();

    // Unrealized (today, IST): mark-to-market open positions.
    let posQ = supabase.from("positions").select("symbol, qty, avg_entry_price, paper");
    if (data.symbol) posQ = posQ.eq("symbol", data.symbol);
    if (data.mode === "paper") posQ = posQ.eq("paper", true);
    if (data.mode === "live") posQ = posQ.eq("paper", false);
    const { data: positions } = await posQ;

    let unrealized = 0;
    const openPositions: Array<{ symbol: string; qty: number; entry: number; last: number; upnl: number }> = [];
    if (positions && positions.length > 0) {
      const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
      const client = createSharkClient();
      const uniqueSymbols = Array.from(new Set(positions.map((p) => p.symbol as string)));
      const prices = new Map<string, number>();
      await Promise.all(
        uniqueSymbols.map(async (sym) => {
          try {
            prices.set(sym, await client.getLastPrice(sym));
          } catch {
            // skip on failure — mark as 0 upnl for that symbol
          }
        }),
      );
      for (const p of positions) {
        const qty = Number(p.qty ?? 0);
        const entry = Number(p.avg_entry_price ?? 0);
        const last = prices.get(p.symbol as string);
        if (!last || !Number.isFinite(qty) || !Number.isFinite(entry) || qty === 0) continue;
        const upnl = (last - entry) * qty;
        unrealized += upnl;
        openPositions.push({ symbol: p.symbol as string, qty, entry, last, upnl });
      }
    }

    const days = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
    const monthTotal = days.reduce((s, d) => s + d.realized, 0);
    const totalTrades = days.reduce((s, d) => s + d.trades, 0);
    const wins = days.reduce((s, d) => s + d.wins, 0);
    const losses = days.reduce((s, d) => s + d.losses, 0);

    return {
      month: data.month,
      days,
      symbols,
      unrealized,
      openPositions,
      summary: { monthTotal, trades: totalTrades, wins, losses },
    };
  });


// ---------- Strategy performance breakdown ----------

const PerfInput = z.object({
  period: z.enum(["ytd", "month", "week", "all"]).default("ytd"),
  // Anchor date (IST, YYYY-MM-DD) for 'month' and 'week'. Default = today IST.
  anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  mode: z.enum(["all", "paper", "live"]).default("all"),
});

function istNowDateKey(): string {
  const d = new Date(Date.now() + (5 * 60 + 30) * 60_000);
  return d.toISOString().slice(0, 10);
}

function periodRangeUtc(period: "ytd" | "month" | "week" | "all", anchor: string): { startUtc: string | null; endUtc: string | null } {
  if (period === "all") return { startUtc: null, endUtc: null };
  const [ay, am, ad] = anchor.split("-").map(Number);
  const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
  const toUtc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - IST_OFFSET_MS).toISOString();
  if (period === "ytd") {
    return { startUtc: toUtc(ay, 1, 1), endUtc: toUtc(ay + 1, 1, 1) };
  }
  if (period === "month") {
    const nextMonth = am === 12 ? { y: ay + 1, m: 1 } : { y: ay, m: am + 1 };
    return { startUtc: toUtc(ay, am, 1), endUtc: toUtc(nextMonth.y, nextMonth.m, 1) };
  }
  // week: Mon..Sun containing anchor (IST)
  const anchorIstMs = Date.UTC(ay, am - 1, ad);
  const dow = new Date(anchorIstMs).getUTCDay(); // 0=Sun..6=Sat
  const monOffset = (dow + 6) % 7;
  const monMs = anchorIstMs - monOffset * 86_400_000;
  const startMs = monMs - IST_OFFSET_MS;
  const endMs = startMs + 7 * 86_400_000;
  return { startUtc: new Date(startMs).toISOString(), endUtc: new Date(endMs).toISOString() };
}

export interface StrategyPerfRow {
  key: string;
  source: "paper" | "live";
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  totalTrades: number;
  longTrades: number;
  shortTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;    // 0..1
  grossPnl: number;
  fees: number;
  netPnl: number;
  avgPnl: number;
  bestPnl: number;
  worstPnl: number;
  lastTradeAt: string | null;
}

export const getStrategyPerformance = createServerFn({ method: "GET" })
  .validator((raw: unknown) => PerfInput.parse(raw))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const anchor = data.anchor ?? istNowDateKey();
    const { startUtc, endUtc } = periodRangeUtc(data.period, anchor);

    const rowsByKey = new Map<string, StrategyPerfRow>();
    const bumpRow = (r: {
      source: "paper" | "live";
      symbol: string;
      timeframe: string;
      strategy_preset: string;
      direction: string;
      net_pnl: number;
      gross_pnl: number;
      fees: number;
      exit_ts: string | null;
    }) => {
      const key = `${r.source}|${r.symbol}|${r.timeframe}|${r.strategy_preset}`;
      let row = rowsByKey.get(key);
      if (!row) {
        row = {
          key, source: r.source, symbol: r.symbol, timeframe: r.timeframe, strategy_preset: r.strategy_preset,
          totalTrades: 0, longTrades: 0, shortTrades: 0, wins: 0, losses: 0, breakeven: 0, winRate: 0,
          grossPnl: 0, fees: 0, netPnl: 0, avgPnl: 0, bestPnl: -Infinity, worstPnl: Infinity, lastTradeAt: null,
        };
        rowsByKey.set(key, row);
      }
      row.totalTrades += 1;
      const dir = (r.direction || "").toLowerCase();
      if (dir === "long" || dir === "buy") row.longTrades += 1;
      else if (dir === "short" || dir === "sell") row.shortTrades += 1;
      if (r.net_pnl > 0) row.wins += 1;
      else if (r.net_pnl < 0) row.losses += 1;
      else row.breakeven += 1;
      row.grossPnl += r.gross_pnl;
      row.fees += r.fees;
      row.netPnl += r.net_pnl;
      if (r.net_pnl > row.bestPnl) row.bestPnl = r.net_pnl;
      if (r.net_pnl < row.worstPnl) row.worstPnl = r.net_pnl;
      if (r.exit_ts && (!row.lastTradeAt || r.exit_ts > row.lastTradeAt)) row.lastTradeAt = r.exit_ts;
    };

    if (data.mode !== "live") {
      let q = supabase.from("paper_trades").select("symbol, timeframe, strategy_preset, direction, net_pnl, gross_pnl, fees, exit_ts");
      q = q.not("net_pnl", "is", null);
      if (startUtc) q = q.gte("exit_ts", startUtc);
      if (endUtc) q = q.lt("exit_ts", endUtc);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const t of rows ?? []) {
        bumpRow({
          source: "paper",
          symbol: t.symbol as string,
          timeframe: t.timeframe as string,
          strategy_preset: t.strategy_preset as string,
          direction: (t.direction as string) ?? "",
          net_pnl: Number(t.net_pnl ?? 0),
          gross_pnl: Number(t.gross_pnl ?? 0),
          fees: Number(t.fees ?? 0),
          exit_ts: (t.exit_ts as string) ?? null,
        });
      }
    }

    if (data.mode !== "paper") {
      let q = supabase.from("live_trades")
        .select("symbol, timeframe, strategy_preset, direction, net_pnl, gross_pnl, fees, exit_ts")
        .not("exit_ts", "is", null)
        .not("net_pnl", "is", null);
      if (startUtc) q = q.gte("exit_ts", startUtc);
      if (endUtc) q = q.lt("exit_ts", endUtc);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const t of rows ?? []) {
        bumpRow({
          source: "live",
          symbol: t.symbol as string,
          timeframe: t.timeframe as string,
          strategy_preset: t.strategy_preset as string,
          direction: (t.direction as string) ?? "",
          net_pnl: Number(t.net_pnl ?? 0),
          gross_pnl: Number(t.gross_pnl ?? 0),
          fees: Number(t.fees ?? 0),
          exit_ts: (t.exit_ts as string) ?? null,
        });
      }
    }

    const rows = Array.from(rowsByKey.values()).map((r) => {
      if (!Number.isFinite(r.bestPnl)) r.bestPnl = 0;
      if (!Number.isFinite(r.worstPnl)) r.worstPnl = 0;
      r.winRate = r.totalTrades ? r.wins / r.totalTrades : 0;
      r.avgPnl = r.totalTrades ? r.netPnl / r.totalTrades : 0;
      return r;
    }).sort((a, b) => b.netPnl - a.netPnl);

    const totals = rows.reduce((acc, r) => {
      acc.totalTrades += r.totalTrades;
      acc.wins += r.wins;
      acc.losses += r.losses;
      acc.netPnl += r.netPnl;
      acc.grossPnl += r.grossPnl;
      acc.fees += r.fees;
      acc.longTrades += r.longTrades;
      acc.shortTrades += r.shortTrades;
      return acc;
    }, { totalTrades: 0, wins: 0, losses: 0, netPnl: 0, grossPnl: 0, fees: 0, longTrades: 0, shortTrades: 0 });

    return {
      period: data.period,
      anchor,
      range: { startUtc, endUtc },
      rows,
      totals,
    };
  });

