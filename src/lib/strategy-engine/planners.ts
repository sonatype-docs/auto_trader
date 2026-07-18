// Entry, stop, target planners — all pure.
import type { EnrichedCandle } from "@/lib/market-data/types";
import type { EntryConfig, EntryModel, SignalDirection, StopModel, TargetConfig, TargetKind } from "./types";

export interface PendingEntry {
  price: number;
  type: "market" | "limit" | "stop";
  expiryBarIndex: number | null;
  delayBars: number;
}

export function planEntry(
  bar: EnrichedCandle,
  direction: SignalDirection,
  level: number,
  cfg: EntryConfig,
  currentIndex: number,
): PendingEntry {
  const side = direction === "long" ? 1 : -1;
  const m: EntryModel = cfg.model;
  let price = bar.close;
  let type: PendingEntry["type"] = "market";

  switch (m.kind) {
    case "market": price = bar.close; type = "market"; break;
    case "limit": price = level * (1 - side * (m.pullbackPct / 100)); type = "limit"; break;
    case "stop":  price = level * (1 + side * (m.breakoutBufferPct / 100)); type = "stop"; break;
    case "fib": {
      const range = bar.swingHigh !== null && bar.swingLow !== null ? bar.swingHigh - bar.swingLow : 0;
      price = direction === "long" ? level - range * m.ratio : level + range * m.ratio;
      type = "limit"; break;
    }
    case "vwap": price = bar.vwapDaily ?? bar.close; type = "limit"; break;
    case "poc":  price = m.poc; type = "limit"; break;
    case "order_block":
    case "fvg":  price = level; type = "limit"; break;
  }
  return {
    price,
    type,
    expiryBarIndex: cfg.expiryBars ? currentIndex + cfg.expiryBars : null,
    delayBars: cfg.delayBars ?? 0,
  };
}

export interface PlanExtras {
  /** Sweep bar extreme (swept low for long, swept high for short). */
  sweepExtreme?: number;
}

export function planStop(
  bar: EnrichedCandle,
  direction: SignalDirection,
  entryPrice: number,
  cfg: StopModel,
  extras: PlanExtras = {},
): number {
  const side = direction === "long" ? 1 : -1;
  switch (cfg.kind) {
    case "fixed_pts": return entryPrice - side * cfg.points;
    case "atr": {
      const atr = bar.atr ?? 0;
      return entryPrice - side * atr * cfg.multiple;
    }
    case "swing": {
      if (direction === "long" && bar.swingLow !== null) return bar.swingLow;
      if (direction === "short" && bar.swingHigh !== null) return bar.swingHigh;
      return entryPrice - side * (bar.atr ?? entryPrice * 0.005);
    }
    case "previous_candle": {
      return direction === "long" ? bar.low : bar.high;
    }
    case "opposite_range": {
      const half = bar.openingRangeSize ? bar.openingRangeSize / 2 : 0;
      const mid = bar.close - (bar.breakDistance ?? 0) * side;
      return direction === "long" ? mid - half : mid + half;
    }
    case "percentage": return entryPrice * (1 - side * cfg.pct / 100);
    case "fib": {
      const range = bar.swingHigh !== null && bar.swingLow !== null ? bar.swingHigh - bar.swingLow : bar.atr ?? 0;
      return direction === "long" ? entryPrice - range * cfg.ratio : entryPrice + range * cfg.ratio;
    }
    case "sweep_extreme": {
      const buf = (cfg.bufferPct ?? 0) / 100;
      const ext = extras.sweepExtreme;
      if (ext == null || !Number.isFinite(ext)) {
        return entryPrice - side * (bar.atr ?? entryPrice * 0.005);
      }
      return direction === "long" ? ext * (1 - buf) : ext * (1 + buf);
    }
  }
}

export function planTargets(
  bar: EnrichedCandle,
  direction: SignalDirection,
  entryPrice: number,
  stopLoss: number,
  cfg: TargetConfig,
): Array<{ kind: TargetKind; price: number; sizePct: number }> {
  const side = direction === "long" ? 1 : -1;
  const rDist = Math.abs(entryPrice - stopLoss);
  return cfg.legs.map((leg) => {
    let price = entryPrice;
    switch (leg.kind) {
      case "rr": price = entryPrice + side * rDist * (leg.value ?? 1); break;
      case "atr_multiple": price = entryPrice + side * (bar.atr ?? rDist) * (leg.value ?? 1); break;
      case "swing":
        price = direction === "long"
          ? bar.swingHigh ?? entryPrice + side * rDist * 2
          : bar.swingLow ?? entryPrice + side * rDist * 2;
        break;
      case "liquidity":
        price = direction === "long"
          ? bar.prevDayHigh ?? bar.swingHigh ?? entryPrice + side * rDist * 2
          : bar.prevDayLow ?? bar.swingLow ?? entryPrice + side * rDist * 2;
        break;
      case "opposite_pdx":
        price = direction === "long"
          ? bar.prevDayHigh ?? entryPrice + side * rDist * 5
          : bar.prevDayLow ?? entryPrice + side * rDist * 5;
        break;
      case "opposite_range": {
        const half = bar.openingRangeSize ? bar.openingRangeSize / 2 : rDist;
        const mid = bar.close - (bar.breakDistance ?? 0) * side;
        price = direction === "long" ? mid + half : mid - half;
        break;
      }
      case "vwap": price = bar.vwapDaily ?? entryPrice + side * rDist * 2; break;
      case "poc":  price = (leg.value as number) ?? entryPrice + side * rDist * 2; break;
      case "vah":  price = (leg.value as number) ?? entryPrice + side * rDist * 2; break;
      case "val":  price = (leg.value as number) ?? entryPrice + side * rDist * 2; break;
    }
    return { kind: leg.kind, price, sizePct: leg.sizePct };
  });
}
