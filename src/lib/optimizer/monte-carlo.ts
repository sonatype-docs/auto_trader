// Monte Carlo — bootstrap trade sequence to estimate DD / CAGR / ruin.
import type { TradeRecord } from "@/lib/trade-intelligence/types";

export interface MonteCarloOptions {
  runs: number;                // 100, 500, 1000, 5000, 10000
  initialEquity?: number;
  ruinFractionOfInitial?: number; // 0.5 = 50% DD triggers "ruin"
  seed?: number;
}

export interface MonteCarloResult {
  runs: number;
  expectedNet: number;
  worstNet: number;
  bestNet: number;
  expectedMaxDd: number;
  worstMaxDd: number;
  probRuin: number;
  expectedWinStreak: number;
  expectedLossStreak: number;
  ci05: number;
  ci50: number;
  ci95: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

export function monteCarlo(rows: TradeRecord[], opts: MonteCarloOptions): MonteCarloResult {
  const pnls = rows.map((t) => t.netPnl);
  if (pnls.length === 0) {
    return { runs: 0, expectedNet: 0, worstNet: 0, bestNet: 0, expectedMaxDd: 0, worstMaxDd: 0, probRuin: 0, expectedWinStreak: 0, expectedLossStreak: 0, ci05: 0, ci50: 0, ci95: 0 };
  }
  const rand = mulberry32(opts.seed ?? 42);
  const nets: number[] = []; const dds: number[] = [];
  const wStreaks: number[] = []; const lStreaks: number[] = [];
  const ruinThreshold = (opts.initialEquity ?? 10000) * (opts.ruinFractionOfInitial ?? 0.5);
  let ruined = 0;
  for (let r = 0; r < opts.runs; r++) {
    let equity = 0, peak = 0, maxDd = 0, ws = 0, ls = 0, mws = 0, mls = 0;
    let hitRuin = false;
    for (let i = 0; i < pnls.length; i++) {
      const p = pnls[Math.floor(rand() * pnls.length)];
      equity += p;
      peak = Math.max(peak, equity);
      const dd = peak - equity;
      if (dd > maxDd) maxDd = dd;
      if (dd >= ruinThreshold) hitRuin = true;
      if (p > 0) { ws++; ls = 0; } else if (p < 0) { ls++; ws = 0; }
      mws = Math.max(mws, ws); mls = Math.max(mls, ls);
    }
    nets.push(equity); dds.push(maxDd);
    wStreaks.push(mws); lStreaks.push(mls);
    if (hitRuin) ruined++;
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  return {
    runs: opts.runs,
    expectedNet: mean(nets),
    worstNet: Math.min(...nets),
    bestNet: Math.max(...nets),
    expectedMaxDd: mean(dds),
    worstMaxDd: Math.max(...dds),
    probRuin: ruined / opts.runs,
    expectedWinStreak: mean(wStreaks),
    expectedLossStreak: mean(lStreaks),
    ci05: quantile(nets, 0.05),
    ci50: quantile(nets, 0.5),
    ci95: quantile(nets, 0.95),
  };
}
