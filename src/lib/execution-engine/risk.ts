// Risk engine — enforces caps between orders/trades.
import type { ExecutionConfig, Trade } from "./types";

export interface RiskState {
  equity: number;
  peakEquity: number;
  dailyPnL: Map<string, number>;   // yyyy-mm-dd → pnl
  weeklyPnL: Map<string, number>;  // yyyy-Www → pnl
  dailyTrades: Map<string, number>;
  consecutiveLosses: number;
  openPositions: number;
  blockedReasons: Record<string, number>;
}

export function initRiskState(cfg: ExecutionConfig): RiskState {
  return {
    equity: cfg.startingCapital,
    peakEquity: cfg.startingCapital,
    dailyPnL: new Map(), weeklyPnL: new Map(),
    dailyTrades: new Map(),
    consecutiveLosses: 0,
    openPositions: 0,
    blockedReasons: {},
  };
}

export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
export function weekKey(ts: number): string {
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  const jan = Date.UTC(year, 0, 1);
  const days = Math.floor((d.getTime() - jan) / 86400000);
  const week = Math.ceil((days + new Date(jan).getUTCDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Returns reason if blocked, otherwise null. */
export function canOpen(state: RiskState, cfg: ExecutionConfig, ts: number): string | null {
  if (state.openPositions >= cfg.maxOpenPositions) return "max_open_positions";
  if ((state.dailyTrades.get(dayKey(ts)) ?? 0) >= cfg.maxDailyTrades) return "max_daily_trades";
  if (cfg.maxDailyLossUsd != null) {
    const dp = state.dailyPnL.get(dayKey(ts)) ?? 0;
    if (dp <= -Math.abs(cfg.maxDailyLossUsd)) return "max_daily_loss";
  }
  if (cfg.maxWeeklyLossUsd != null) {
    const wp = state.weeklyPnL.get(weekKey(ts)) ?? 0;
    if (wp <= -Math.abs(cfg.maxWeeklyLossUsd)) return "max_weekly_loss";
  }
  if (cfg.maxConsecutiveLosses != null && state.consecutiveLosses >= cfg.maxConsecutiveLosses) {
    return "max_consecutive_losses";
  }
  if (cfg.maxDrawdownPct != null && state.peakEquity > 0) {
    const dd = (state.peakEquity - state.equity) / state.peakEquity * 100;
    if (dd >= cfg.maxDrawdownPct) return "max_drawdown";
  }
  return null;
}

export function recordClose(state: RiskState, trade: Trade): void {
  state.equity += trade.netPnL;
  if (state.equity > state.peakEquity) state.peakEquity = state.equity;
  const dk = dayKey(trade.exitTime);
  const wk = weekKey(trade.exitTime);
  state.dailyPnL.set(dk, (state.dailyPnL.get(dk) ?? 0) + trade.netPnL);
  state.weeklyPnL.set(wk, (state.weeklyPnL.get(wk) ?? 0) + trade.netPnL);
  state.dailyTrades.set(dk, (state.dailyTrades.get(dk) ?? 0) + 1);
  state.consecutiveLosses = trade.netPnL < 0 ? state.consecutiveLosses + 1 : 0;
  state.openPositions = Math.max(0, state.openPositions - 1);
}

export function noteBlock(state: RiskState, reason: string): void {
  state.blockedReasons[reason] = (state.blockedReasons[reason] ?? 0) + 1;
}
