// Fill Engine — decides whether a bar hits an order's trigger / stop / target.
// Never repaints, never peeks at future bars. Intrabar ambiguity is resolved
// by the configured IntrabarMode.
import type { EnrichedCandle } from "@/lib/market-data/types";
import type { IntrabarMode, Order } from "./types";

/** Returns the raw touched trigger price if the bar hits it, else null. */
export function triggerHit(o: Order, bar: EnrichedCandle): number | null {
  if (o.kind === "market") return bar.open;
  if (o.kind === "limit") {
    if (o.side === "buy" && bar.low <= o.triggerPrice) return Math.min(o.triggerPrice, bar.open);
    if (o.side === "sell" && bar.high >= o.triggerPrice) return Math.max(o.triggerPrice, bar.open);
    return null;
  }
  // stop
  if (o.side === "buy" && bar.high >= o.triggerPrice) return Math.max(o.triggerPrice, bar.open);
  if (o.side === "sell" && bar.low <= o.triggerPrice) return Math.min(o.triggerPrice, bar.open);
  return null;
}

export interface BarOutcome {
  stopHit: boolean;
  targetHit: boolean;
  tpLegs: boolean[];      // per-leg touched
  order: "stop_first" | "target_first" | "none";
}

/** Evaluate an open long/short position against this bar. */
export function evaluateBar(
  side: "long" | "short",
  stop: number,
  legs: Array<{ price: number; filled: boolean }>,
  bar: EnrichedCandle,
  mode: IntrabarMode,
): BarOutcome {
  const stopHit = side === "long" ? bar.low <= stop : bar.high >= stop;
  const tpLegs = legs.map((l) => {
    if (l.filled) return false;
    return side === "long" ? bar.high >= l.price : bar.low <= l.price;
  });
  const targetHit = tpLegs.some(Boolean);
  let order: BarOutcome["order"] = "none";
  if (stopHit && targetHit) order = mode === "conservative" ? "stop_first" : "target_first";
  else if (stopHit) order = "stop_first";
  else if (targetHit) order = "target_first";
  return { stopHit, targetHit, tpLegs, order };
}

/** Detect gap-through on the open. */
export function gapDirection(
  side: "long" | "short",
  stop: number,
  target: number,
  prevClose: number,
  open: number,
): "gap_through_stop" | "gap_through_target" | null {
  if (side === "long") {
    if (open <= stop && prevClose > stop) return "gap_through_stop";
    if (open >= target && prevClose < target) return "gap_through_target";
  } else {
    if (open >= stop && prevClose < stop) return "gap_through_stop";
    if (open <= target && prevClose > target) return "gap_through_target";
  }
  return null;
}
