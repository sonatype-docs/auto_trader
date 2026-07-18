// Slippage engine — pure. Returns points to WORSEN a fill price by.
import type { EnrichedCandle } from "@/lib/market-data/types";
import type { OrderSide, SlippageModel } from "./types";

export function slippagePoints(
  model: SlippageModel,
  bar: EnrichedCandle,
  _side: OrderSide,
): number {
  switch (model.kind) {
    case "none": return 0;
    case "fixed": return model.points;
    case "atr": return (bar.atr ?? 0) * model.multiple;
    case "pct": return bar.close * (model.pct / 100);
    case "random": return Math.random() * model.maxPoints;
    case "session": return model.map[bar.session] ?? 0;
  }
}

/** Apply slippage against the trader (buys pay more, sells receive less). */
export function applySlippage(
  price: number, side: OrderSide, points: number,
): number {
  return side === "buy" ? price + points : price - points;
}
