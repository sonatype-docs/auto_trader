// Preset execution configs — pure data.
// NOTE: All presets ship with `sizing: { kind: "risk_usd", riskUsd: 20 }` so
// every backtest risks a fixed $20 per trade regardless of SL distance. The
// Execution Engine UI and the automation pipeline expose an override so the
// user can dial this up or down without editing presets.
import type { ExecutionConfig } from "./types";

const DEFAULT_RISK_USD = 20;

export const EXEC_PRESETS: Record<string, ExecutionConfig> = {
  conservative_default: {
    intrabar: "conservative",
    slippage: { kind: "atr", multiple: 0.05 },
    spread: { kind: "fixed", points: 0.3 },
    commission: { pctOfNotional: 0.00002 },
    sizing: { kind: "risk_usd", riskUsd: DEFAULT_RISK_USD },
    tif: "GTC",
    maxOpenPositions: 1,
    maxDailyTrades: 5,
    maxDailyLossUsd: 300,
    maxWeeklyLossUsd: 800,
    maxConsecutiveLosses: 4,
    maxDrawdownPct: 25,
    allowPyramiding: false,
    allowHedging: false,
    breakEvenAtR: 1,
    trailAfterR: 1.5,
    trailStepR: 0.5,
    timeStopBars: 60,
    maxHoldingBars: 240,
    startingCapital: 10_000,
    contractMultiplier: 1,
    cancelOnSessionEnd: true,
    cancelOnNextDay: true,
    respectGaps: true,
  },
  optimistic_scalper: {
    intrabar: "optimistic",
    slippage: { kind: "fixed", points: 0.1 },
    spread: { kind: "fixed", points: 0.2 },
    commission: { perTradeUsd: 0.5 },
    sizing: { kind: "risk_usd", riskUsd: DEFAULT_RISK_USD },
    tif: "DAY",
    maxOpenPositions: 2,
    maxDailyTrades: 10,
    maxDailyLossUsd: 500,
    maxWeeklyLossUsd: null,
    maxConsecutiveLosses: null,
    maxDrawdownPct: null,
    allowPyramiding: true,
    allowHedging: false,
    breakEvenAtR: 0.75,
    trailAfterR: 1,
    trailStepR: 0.35,
    timeStopBars: 30,
    maxHoldingBars: 120,
    startingCapital: 10_000,
    contractMultiplier: 1,
    cancelOnSessionEnd: true,
    cancelOnNextDay: true,
    respectGaps: true,
  },
  no_management: {
    intrabar: "conservative",
    slippage: { kind: "none" },
    spread: { kind: "none" },
    commission: {},
    sizing: { kind: "risk_usd", riskUsd: DEFAULT_RISK_USD },
    tif: "GTC",
    maxOpenPositions: 1,
    maxDailyTrades: 100,
    maxDailyLossUsd: null,
    maxWeeklyLossUsd: null,
    maxConsecutiveLosses: null,
    maxDrawdownPct: null,
    allowPyramiding: false,
    allowHedging: false,
    breakEvenAtR: null,
    trailAfterR: null,
    trailStepR: null,
    timeStopBars: null,
    maxHoldingBars: null,
    startingCapital: 10_000,
    contractMultiplier: 1,
    cancelOnSessionEnd: false,
    cancelOnNextDay: false,
    respectGaps: true,
  },
};

/** Clone a preset with a custom fixed $-per-trade risk. */
export function withRiskUsd(cfg: ExecutionConfig, riskUsd: number): ExecutionConfig {
  const r = Number.isFinite(riskUsd) && riskUsd > 0 ? riskUsd : DEFAULT_RISK_USD;
  return { ...cfg, sizing: { kind: "risk_usd", riskUsd: r } };
}

export const DEFAULT_RISK_USD_PER_TRADE = DEFAULT_RISK_USD;
