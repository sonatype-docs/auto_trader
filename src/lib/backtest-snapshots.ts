// Shared cross-strategy snapshot store for the /backtest/* pages.
// Each strategy page saves its latest run here so /backtest/compare can
// show a side-by-side comparison without re-running everything.

export type StrategyId =
  | "fib_zone"
  | "silver_bullet"
  | "asian_sweep"
  | "orb_sessions";

export interface StrategyMetrics {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netPnl: number;
  profitFactor: number;
  avgR: number;
  maxDd: number;
}

export interface StrategySnapshot {
  strategy: StrategyId;
  label: string;
  ranAt: number;
  params: Record<string, unknown>;
  metrics: StrategyMetrics;
  note?: string;
}

const KEY = "shark:auto-trader:strategy-snapshots:v1";

export function readSnapshots(): Partial<Record<StrategyId, StrategySnapshot>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<Record<StrategyId, StrategySnapshot>>;
  } catch {
    return {};
  }
}

export function saveSnapshot(snap: StrategySnapshot) {
  if (typeof window === "undefined") return;
  try {
    const all = readSnapshots();
    all[snap.strategy] = snap;
    window.sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore quota errors */
  }
}

export function clearSnapshots() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Normalize a silver-bullet / asian-sweep style summary into metrics. */
export function metricsFromSummary(s: {
  tp?: number;
  sl?: number;
  win_rate_pct?: number;
  total_pnl_usd?: number;
  net_pnl_usd?: number;
  profit_factor?: number;
  avg_r?: number;
  max_drawdown_usd?: number;
  triggered?: number;
  trades?: number;
}): StrategyMetrics {
  const wins = s.tp ?? 0;
  const losses = s.sl ?? 0;
  const trades = s.trades ?? s.triggered ?? wins + losses;
  return {
    trades,
    wins,
    losses,
    winRatePct: s.win_rate_pct ?? 0,
    netPnl: s.net_pnl_usd ?? s.total_pnl_usd ?? 0,
    profitFactor: isFinite(s.profit_factor ?? 0) ? s.profit_factor ?? 0 : 0,
    avgR: s.avg_r ?? 0,
    maxDd: s.max_drawdown_usd ?? 0,
  };
}
