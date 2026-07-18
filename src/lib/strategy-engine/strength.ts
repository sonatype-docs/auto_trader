// Signal-strength scorer — combines weighted components into 0..100.
import type { EnrichedCandle } from "@/lib/market-data/types";
import type { SignalDirection, StrategyConfig } from "./types";

const DEFAULT_WEIGHTS = {
  trend: 1, volume: 1, volatility: 1, breakout: 1,
  structure: 1, liquidity: 1, session: 0.5, htf: 0.5,
};

export function scoreStrength(
  bars: EnrichedCandle[],
  i: number,
  direction: SignalDirection,
  cfg: StrategyConfig,
): { score: number; components: Record<string, number> } {
  const bar = bars[i];
  const weights = { ...DEFAULT_WEIGHTS, ...(cfg.strengthWeights ?? {}) };
  const c: Record<string, number> = {};

  const side = direction === "long" ? 1 : -1;
  const ema50 = bar.ema50, ema200 = bar.ema200;
  c.trend = ema50 !== null && ema200 !== null
    ? clamp01(side * (ema50 - ema200) / Math.abs(ema200) * 100)
    : 0.5;

  // Volume vs 20-bar SMA
  const from = Math.max(0, i - 20);
  const avgVol = bars.slice(from, i).reduce((a, b) => a + b.volume, 0) / Math.max(1, i - from);
  c.volume = avgVol > 0 ? clamp01((bar.volume / avgVol - 0.5) / 2) : 0.5;

  c.volatility = bar.atrPercentile !== null ? bar.atrPercentile / 100 : 0.5;
  c.breakout = bar.atr && bar.breakDistance !== null
    ? clamp01(bar.breakDistance / bar.atr / 3)
    : 0.5;

  const bullStruct = bar.structure === "HH" || bar.structure === "HL";
  c.structure = (direction === "long" ? bullStruct : !bullStruct) ? 1 : 0.3;

  c.liquidity = bar.equalHigh || bar.equalLow ? 0.8 : 0.5;
  c.session = bar.session === "london" || bar.session === "london_ny_overlap" || bar.session === "new_york" ? 1 : 0.4;
  c.htf = bar.vwapDaily !== null
    ? ((direction === "long" && bar.close > bar.vwapDaily) || (direction === "short" && bar.close < bar.vwapDaily) ? 1 : 0.3)
    : 0.5;

  let num = 0, den = 0;
  for (const k of Object.keys(c) as Array<keyof typeof weights>) {
    const w = weights[k] ?? 0;
    num += c[k] * w; den += w;
  }
  return { score: Math.round((den ? num / den : 0) * 100), components: c };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
