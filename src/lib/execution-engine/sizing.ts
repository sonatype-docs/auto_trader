// Position sizing — pure. Decides units per signal.
import type { EnrichedCandle } from "@/lib/market-data/types";
import type { SizingModel } from "./types";

export function sizeUnits(
  model: SizingModel,
  entry: number,
  stop: number,
  equity: number,
  bar: EnrichedCandle,
): number {
  const risk = Math.abs(entry - stop);
  const safe = (u: number) => Math.max(0, isFinite(u) ? u : 0);
  switch (model.kind) {
    case "fixed_lot": return safe(model.units);
    case "risk_usd": return risk > 0 ? safe(model.riskUsd / risk) : 0;
    case "risk_pct": {
      const r = equity * (model.pctOfEquity / 100);
      return risk > 0 ? safe(r / risk) : 0;
    }
    case "fixed_frac": {
      const notional = equity * model.frac;
      return entry > 0 ? safe(notional / entry) : 0;
    }
    case "atr": {
      const atr = bar.atr ?? risk;
      return atr > 0 ? safe(model.usdPerAtr / atr) : 0;
    }
    case "kelly": {
      // Kelly f* = W - (1-W)/R  (capped)
      const f = Math.min(model.cap, Math.max(0, model.winRate - (1 - model.winRate) / Math.max(0.01, model.payoff)));
      const risked = equity * f;
      return risk > 0 ? safe(risked / risk) : 0;
    }
  }
}
