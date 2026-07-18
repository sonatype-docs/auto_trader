// Spread engine — pure. Returns half-spread in points to apply.
import type { EnrichedCandle } from "@/lib/market-data/types";
import type { SpreadModel } from "./types";

export function spreadPoints(model: SpreadModel, bar: EnrichedCandle): number {
  switch (model.kind) {
    case "none": return 0;
    case "fixed": return model.points;
    case "pct": return bar.close * (model.pct / 100);
    case "session": return model.map[bar.session] ?? 0;
  }
}
