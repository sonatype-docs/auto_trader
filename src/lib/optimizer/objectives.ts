// Objective / metric engine — computes every objective from a TradeRecord[].
// Pure. No trading. No side effects.
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import type { ObjectiveKey, ObjectiveSpec } from "./types";

export interface Metrics {
  trades: number;
  wins: number;
  losses: number;
  net_profit: number;
  gross_profit: number;
  gross_loss: number;
  profit_factor: number;
  expectancy: number;
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  avg_rr: number;
  max_drawdown: number;
  recovery_factor: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  ulcer_index: number;
  risk_adjusted_return: number;
  max_win_streak: number;
  max_loss_streak: number;
}

const EMPTY: Metrics = {
  trades: 0, wins: 0, losses: 0,
  net_profit: 0, gross_profit: 0, gross_loss: 0,
  profit_factor: 0, expectancy: 0, win_rate: 0,
  avg_win: 0, avg_loss: 0, avg_rr: 0,
  max_drawdown: 0, recovery_factor: 0,
  sharpe: 0, sortino: 0, calmar: 0, ulcer_index: 0,
  risk_adjusted_return: 0,
  max_win_streak: 0, max_loss_streak: 0,
};

export function computeMetrics(rows: TradeRecord[]): Metrics {
  if (rows.length === 0) return { ...EMPTY };
  const trades = [...rows].sort((a, b) => a.exitTime - b.exitTime);
  const pnls = trades.map((t) => t.netPnl);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const gross_profit = wins.reduce((s, v) => s + v, 0);
  const gross_loss = Math.abs(losses.reduce((s, v) => s + v, 0));
  const net_profit = pnls.reduce((s, v) => s + v, 0);
  const avg_win = wins.length ? gross_profit / wins.length : 0;
  const avg_loss = losses.length ? gross_loss / losses.length : 0;
  const win_rate = trades.length ? wins.length / trades.length : 0;
  const expectancy = win_rate * avg_win - (1 - win_rate) * avg_loss;
  const profit_factor = gross_loss > 0 ? gross_profit / gross_loss : gross_profit > 0 ? 999 : 0;

  // Equity + drawdown
  let equity = 0, peak = 0, maxDd = 0;
  const ddSeries: number[] = [];
  for (const p of pnls) {
    equity += p;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
    ddSeries.push(dd);
  }
  const ulcer = Math.sqrt(ddSeries.reduce((s, d) => s + d * d, 0) / ddSeries.length);

  // Sharpe / Sortino on per-trade returns.
  const mean = net_profit / trades.length;
  const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / trades.length;
  const std = Math.sqrt(variance);
  const downside = Math.sqrt(pnls.filter((p) => p < 0).reduce((s, p) => s + p * p, 0) / trades.length);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(trades.length) : 0;
  const sortino = downside > 0 ? (mean / downside) * Math.sqrt(trades.length) : 0;
  const calmar = maxDd > 0 ? net_profit / maxDd : 0;

  const rrs = trades.map((t) => t.actualRr ?? 0).filter((v) => v !== 0);
  const avg_rr = rrs.length ? rrs.reduce((s, v) => s + v, 0) / rrs.length : 0;

  let winStreak = 0, lossStreak = 0, mws = 0, mls = 0;
  for (const p of pnls) {
    if (p > 0) { winStreak++; lossStreak = 0; }
    else if (p < 0) { lossStreak++; winStreak = 0; }
    mws = Math.max(mws, winStreak); mls = Math.max(mls, lossStreak);
  }

  return {
    trades: trades.length, wins: wins.length, losses: losses.length,
    net_profit, gross_profit, gross_loss,
    profit_factor, expectancy, win_rate,
    avg_win, avg_loss, avg_rr,
    max_drawdown: maxDd,
    recovery_factor: maxDd > 0 ? net_profit / maxDd : 0,
    sharpe, sortino, calmar,
    ulcer_index: ulcer,
    risk_adjusted_return: maxDd > 0 ? net_profit / maxDd : net_profit,
    max_win_streak: mws, max_loss_streak: mls,
  };
}

export function objectiveScore(m: Metrics, spec: ObjectiveSpec): number {
  if (spec.minTrades && m.trades < spec.minTrades) return -Infinity;
  const raw = pickObjective(m, spec.key, spec.formula);
  return Number.isFinite(raw) ? raw : -Infinity;
}

function pickObjective(m: Metrics, key: ObjectiveKey, formula?: string): number {
  switch (key) {
    case "net_profit": return m.net_profit;
    case "profit_factor": return m.profit_factor;
    case "expectancy": return m.expectancy;
    case "sharpe": return m.sharpe;
    case "sortino": return m.sortino;
    case "calmar": return m.calmar;
    case "recovery_factor": return m.recovery_factor;
    case "max_drawdown_neg": return -m.max_drawdown;
    case "win_rate": return m.win_rate;
    case "avg_rr": return m.avg_rr;
    case "risk_adjusted_return": return m.risk_adjusted_return;
    case "ulcer_index_neg": return -m.ulcer_index;
    case "custom": return evalFormula(formula ?? "net_profit", m);
  }
}

// Very small, safe formula evaluator: metric identifiers + numbers + + - * / ( )
export function evalFormula(expr: string, m: Metrics): number {
  const cleaned = expr.replace(/\s+/g, "");
  if (!/^[a-z_0-9+\-*/().]+$/i.test(cleaned)) return NaN;
  const substituted = cleaned.replace(/[a-z_][a-z_0-9]*/gi, (name) => {
    const v = (m as unknown as Record<string, number>)[name];
    return typeof v === "number" ? `(${v})` : "0";
  });
  try {
    // Constrained: only digits, ops, parens after substitution.
    if (!/^[-+*/().0-9e]+$/i.test(substituted)) return NaN;
    // eslint-disable-next-line no-new-func
    const val = Function(`"use strict";return (${substituted});`)();
    return typeof val === "number" ? val : NaN;
  } catch {
    return NaN;
  }
}
