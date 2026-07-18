// Commission engine — pure.
import type { CommissionModel } from "./types";

export function commissionFor(
  model: CommissionModel, price: number, units: number,
): number {
  const perTrade = model.perTradeUsd ?? 0;
  const perUnit = (model.perUnit ?? 0) * units;
  const pct = (model.pctOfNotional ?? 0) * price * units;
  return perTrade + perUnit + pct;
}
