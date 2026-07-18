// Preset strategy configs — these are DATA, not engine code. Every field is
// consumed by the universal engine; no strategy is hardcoded.
import type { StrategyConfig } from "./types";

export const STRATEGY_PRESETS: Record<string, StrategyConfig> = {
  london_orb: {
    strategyId: "london-orb",
    strategyName: "London Opening Range Breakout",
    direction: "both",
    session: { allowedSessions: ["london", "london_ny_overlap"], blockWeekend: true, blockHoliday: true },
    trend: { emaAlignment: {}, adxMin: 15 },
    volatility: { atrPercentileMin: 20 },
    setup: { kind: "opening_range_break", breakBufferPct: 0.03 },
    confirmation: { requireClose: true, minBodyPct: 40, minAtrMultiple: 0.2 },
    entry: { model: { kind: "market" }, expiryBars: 6 },
    stop: { kind: "opposite_range" },
    targets: {
      legs: [
        { kind: "rr", value: 1, sizePct: 50 },
        { kind: "rr", value: 2.5, sizePct: 50 },
      ],
      moveToBreakEvenAtR: 1,
      trailAfterR: 1.5,
      trailStepR: 0.5,
    },
    management: { maxDailyTrades: 2, timeStopBars: 40 },
    invalidation: { maxDelayBars: 6, invalidateOnSessionEnd: true },
    risk: { riskPerTradeUsd: 100 },
  },
  liquidity_sweep_long: {
    strategyId: "liq-sweep-long",
    strategyName: "Liquidity Sweep (Long)",
    direction: "long",
    session: { allowedSessions: ["london", "london_ny_overlap", "new_york"] },
    trend: { vwapSide: "above", adxMin: 12 },
    volatility: { atrPercentileMin: 25 },
    setup: { kind: "liquidity_sweep" },
    confirmation: { requireClose: true, minBodyPct: 35 },
    entry: { model: { kind: "limit", pullbackPct: 0.1 }, expiryBars: 8 },
    stop: { kind: "swing" },
    targets: {
      legs: [
        { kind: "rr", value: 1.5, sizePct: 60 },
        { kind: "liquidity", sizePct: 40 },
      ],
      moveToBreakEvenAtR: 1,
    },
    management: { maxDailyTrades: 3 },
    invalidation: { maxDelayBars: 8, invalidateOnStructureFlip: true },
    risk: { riskPerTradeUsd: 100 },
  },
  vwap_mean_revert: {
    strategyId: "vwap-mr",
    strategyName: "VWAP Mean Reversion",
    direction: "both",
    session: { allowedSessions: ["london", "new_york", "london_ny_overlap"] },
    trend: { adxMax: 22 },
    volatility: { atrPercentileMin: 10, atrPercentileMax: 70 },
    setup: { kind: "vwap_cross" },
    confirmation: { requireClose: true, minBodyPct: 30 },
    entry: { model: { kind: "market" } },
    stop: { kind: "atr", multiple: 1.5 },
    targets: { legs: [{ kind: "rr", value: 1, sizePct: 100 }] },
    management: { maxDailyTrades: 4 },
    invalidation: { maxDelayBars: 4 },
    risk: { riskPerTradeUsd: 100 },
  },
  pdh_pdl_sweep_1m: {
    strategyId: "pdh-pdl-sweep-1m",
    strategyName: "PDH/PDL Sweep → 1m Trigger",
    direction: "both",
    session: { blockWeekend: true },
    trend: {},
    volatility: {},
    setup: { kind: "pdh_pdl_sweep" },
    confirmation: {},
    entry: { model: { kind: "stop", breakoutBufferPct: 0.01 }, expiryBars: 30 },
    stop: { kind: "sweep_extreme", bufferPct: 0.02 },
    targets: {
      legs: [
        { kind: "rr", value: 5, sizePct: 50 },
        { kind: "rr", value: 1000, sizePct: 50 },
      ],
      moveToBreakEvenAtR: 5,
    },
    management: { maxAttemptsPerSweep: 3 },
    invalidation: { invalidateOnStructureFlip: false },
    risk: { riskPerTradeUsd: 100 },
  },
};

export type StrategyPresetId = keyof typeof STRATEGY_PRESETS;
