import { createSharkClient, type Kline } from "@/lib/exchange/shark-client.server";
import {
  computeEntry,
  DEFAULT_ENTRY_CONFIG,
  type EntryConfig,
} from "@/lib/strategy/entry-modes.server";


const IST_OFFSET_MIN = 330;

function istDate(msUtc: number): string {
  return new Date(msUtc + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
function sessionOpenUtcMs(istDateStr: string, sessionStartIst: string): number {
  const [hh, mm] = sessionStartIst.split(":").map((n) => parseInt(n, 10));
  const totalMin = hh * 60 + (mm || 0) - IST_OFFSET_MIN;
  const [y, m, d] = istDateStr.split("-").map((n) => parseInt(n, 10));
  const openMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + totalMin * 60_000;
  return Math.floor(openMs / 3_600_000) * 3_600_000;
}

export interface BacktestResult {
  symbol: string;
  ist_date: string;
  session_start_ist: string;
  session_candle: { openTime: number; high: number; low: number; close: number } | null;
  zone: { high: number; low: number; fib_25: number; fib_75: number } | null;
  break: {
    side: "long" | "short";
    close: number;
    at: number;
  } | null;
  setup: {
    side: "long" | "short";
    entry: number;
    sl: number;
    tp: number;
    qty: number;
    risk_usd: number;
  } | null;
  trigger: {
    hit_at: number;
    bar_low: number;
    bar_high: number;
  } | null;
  outcome:
    | { status: "no_session_candle"; note: string }
    | { status: "no_break"; note: string }
    | { status: "armed_no_trigger"; note: string }
    | { status: "tp"; hit_at: number; pnl_usd: number }
    | { status: "sl"; hit_at: number; pnl_usd: number }
    | { status: "open"; note: string };
  bars_scanned: number;
}

export async function runBacktestToday(opts: {
  symbol: string;
  sessionStartIst: string;
  slRiskUsd: number;
  rr: number;
  entry?: EntryConfig;
}): Promise<BacktestResult> {
  const entryCfg = opts.entry ?? DEFAULT_ENTRY_CONFIG;

  const client = createSharkClient();
  const klines: Kline[] = await client.getKlines(opts.symbol, "1h", 48);
  const now = Date.now();
  const todayIst = istDate(now);
  const sessionOpen = sessionOpenUtcMs(todayIst, opts.sessionStartIst);
  const sessionCandle = klines.find((k) => k.openTime === sessionOpen) ?? null;

  const base: BacktestResult = {
    symbol: opts.symbol,
    ist_date: todayIst,
    session_start_ist: opts.sessionStartIst,
    session_candle: sessionCandle
      ? { openTime: sessionCandle.openTime, high: sessionCandle.high, low: sessionCandle.low, close: sessionCandle.close }
      : null,
    zone: null,
    break: null,
    setup: null,
    trigger: null,
    outcome: { status: "no_session_candle", note: "Session candle not in the last 48 bars yet." },
    bars_scanned: klines.length,
  };

  if (!sessionCandle || sessionCandle.closeTime > now) return base;

  const zone_high = sessionCandle.high;
  const zone_low = sessionCandle.low;
  const range = zone_high - zone_low;
  const fib_25 = zone_high - range * 0.25;
  const fib_75 = zone_high - range * 0.75;
  base.zone = { high: zone_high, low: zone_low, fib_25, fib_75 };

  const later = klines.filter((k) => k.openTime > sessionCandle.openTime && k.closeTime <= now);

  // First break wins
  let breakBar: Kline | null = null;
  let breakSide: "long" | "short" | null = null;
  for (const k of later) {
    if (k.close > zone_high) { breakBar = k; breakSide = "long"; break; }
    if (k.close < zone_low)  { breakBar = k; breakSide = "short"; break; }
  }
  if (!breakBar || !breakSide) {
    base.outcome = { status: "no_break", note: "No 1H close outside the zone in today's session so far." };
    return base;
  }
  base.break = { side: breakSide, close: breakBar.close, at: breakBar.closeTime };

  const { entry, sl, market } = computeEntry(breakSide, zone_high, zone_low, breakBar.close, entryCfg);
  const risk  = Math.abs(entry - sl);
  const tp    = breakSide === "long" ? entry + risk * opts.rr : entry - risk * opts.rr;
  const qty   = risk > 0 ? opts.slRiskUsd / risk : 0;
  base.setup = { side: breakSide, entry, sl, tp, qty, risk_usd: opts.slRiskUsd };

  // Market entries are considered filled on the break candle's close bar itself.
  const post = later.filter((k) => k.openTime > breakBar.openTime);
  let triggered = market;
  if (market) {
    base.trigger = { hit_at: breakBar.closeTime, bar_low: breakBar.low, bar_high: breakBar.high };
  }
  for (const k of post) {
    if (!triggered) {
      const hit = breakSide === "long" ? k.low <= entry : k.high >= entry;
      if (hit) {
        triggered = true;

        base.trigger = { hit_at: k.openTime, bar_low: k.low, bar_high: k.high };
      } else {
        continue;
      }
    }
    // After trigger — check TP/SL within this or later bars
    const hitTp = breakSide === "long" ? k.high >= tp : k.low <= tp;
    const hitSl = breakSide === "long" ? k.low <= sl : k.high >= sl;
    if (hitTp && hitSl) {
      // Ambiguous same-bar; assume SL first (conservative)
      base.outcome = { status: "sl", hit_at: k.closeTime, pnl_usd: -opts.slRiskUsd };
      return base;
    }
    if (hitTp) {
      base.outcome = { status: "tp", hit_at: k.closeTime, pnl_usd: opts.slRiskUsd * opts.rr };
      return base;
    }
    if (hitSl) {
      base.outcome = { status: "sl", hit_at: k.closeTime, pnl_usd: -opts.slRiskUsd };
      return base;
    }
  }

  if (!triggered) {
    base.outcome = { status: "armed_no_trigger", note: "Break occurred but price never revisited the entry level." };
  } else {
    base.outcome = { status: "open", note: "Entry triggered; neither TP nor SL hit yet." };
  }
  return base;
}
