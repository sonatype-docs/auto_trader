// Execution Engine — public types.
// Strategy-agnostic. Consumes signals + enriched bars, simulates fills, returns trades.
import type { EnrichedCandle } from "@/lib/market-data/types";
import type { StrategySignal } from "@/lib/strategy-engine/types";

export type OrderSide = "buy" | "sell";
export type OrderKind = "market" | "limit" | "stop";
export type OrderStatus =
  | "pending" | "triggered" | "partial" | "filled"
  | "cancelled" | "expired" | "rejected" | "closed";

export type TimeInForce = "GTC" | "IOC" | "FOK" | "DAY" | "GTT";
export type IntrabarMode = "conservative" | "optimistic";

export type SlippageModel =
  | { kind: "none" }
  | { kind: "fixed"; points: number }
  | { kind: "atr"; multiple: number }
  | { kind: "pct"; pct: number }
  | { kind: "random"; maxPoints: number }
  | { kind: "session"; map: Partial<Record<string, number>> };

export type SpreadModel =
  | { kind: "none" }
  | { kind: "fixed"; points: number }
  | { kind: "pct"; pct: number }
  | { kind: "session"; map: Partial<Record<string, number>> };

export interface CommissionModel {
  perTradeUsd?: number;
  perUnit?: number;
  pctOfNotional?: number; // e.g. 0.0002 = 2bps
}

export type SizingModel =
  | { kind: "fixed_lot"; units: number }
  | { kind: "risk_usd"; riskUsd: number }
  | { kind: "risk_pct"; pctOfEquity: number }
  | { kind: "fixed_frac"; frac: number }
  | { kind: "atr"; usdPerAtr: number }
  | { kind: "kelly"; winRate: number; payoff: number; cap: number };

export interface ExecutionConfig {
  intrabar: IntrabarMode;
  slippage: SlippageModel;
  spread: SpreadModel;
  commission: CommissionModel;
  sizing: SizingModel;
  tif: TimeInForce;
  goodTillTs?: number | null;
  maxOpenPositions: number;
  maxDailyTrades: number;
  maxDailyLossUsd: number | null;
  maxWeeklyLossUsd: number | null;
  maxConsecutiveLosses: number | null;
  maxDrawdownPct: number | null;
  allowPyramiding: boolean;
  allowHedging: boolean;
  breakEvenAtR: number | null;
  trailAfterR: number | null;
  trailStepR: number | null;
  timeStopBars: number | null;
  maxHoldingBars: number | null;
  startingCapital: number;
  contractMultiplier: number;
  cancelOnSessionEnd: boolean;
  cancelOnNextDay: boolean;
  respectGaps: boolean;
}

export interface Order {
  orderId: string;
  signalId: string;
  strategyId: string;
  symbol: string;
  side: OrderSide;
  kind: OrderKind;
  triggerPrice: number;   // for limit/stop
  stopPrice: number;
  targetPrice: number;    // primary tp
  targetLegs: Array<{ price: number; sizePct: number; filled: boolean }>;
  units: number;
  remainingUnits: number;
  createdTs: number;
  expiryTs: number | null;
  expiryBars: number | null;
  status: OrderStatus;
  fillPrice: number | null;
  filledTs: number | null;
  fillDelayBars: number | null;
  metadata: Record<string, string | number | boolean | null>;
}

export interface PartialExit {
  ts: number;
  price: number;
  units: number;
  pnl: number;
  reason: string;
}

export interface Trade {
  tradeId: string;
  signalId: string;
  strategyId: string;
  symbol: string;
  direction: "long" | "short";
  entryType: string;
  entryTime: number;
  entryPrice: number;      // signal-planned entry
  fillPrice: number;       // actual fill after slip+spread
  stopPrice: number;
  targetPrice: number;
  exitPrice: number;
  exitTime: number;
  exitReason: string;
  risk: number;
  reward: number;
  rr: number;
  grossPnL: number;
  netPnL: number;
  fees: number;
  commission: number;
  slippage: number;
  spreadCost: number;
  mae: number;
  mfe: number;
  duration: number;        // ms
  fillDelay: number;       // bars from signal → fill
  holdingTime: number;     // bars from fill → exit
  partialExits: PartialExit[];
  runnerProfit: number;
  status: OrderStatus;
  metadata: Record<string, string | number | boolean | null>;
}

export type ExecEventName =
  | "OnOrderCreated" | "OnOrderFilled" | "OnOrderCancelled" | "OnOrderExpired"
  | "OnPartialFill" | "OnBreakEven" | "OnTrailingStop" | "OnPartialTP"
  | "OnTradeClosed" | "OnRiskBlock";

export interface ExecEvent {
  name: ExecEventName;
  ts: number;
  data: Record<string, string | number | boolean | null>;
}

export interface EquityPoint {
  ts: number;
  equity: number;
  drawdownPct: number;
}

export interface ExecRunResult {
  trades: Trade[];
  openOrders: Order[];
  cancelledOrders: Order[];
  events: ExecEvent[];
  equityCurve: EquityPoint[];
  stats: {
    signalsIn: number;
    ordersCreated: number;
    ordersFilled: number;
    ordersCancelled: number;
    ordersExpired: number;
    tradesClosed: number;
    winners: number;
    losers: number;
    grossPnL: number;
    netPnL: number;
    totalFees: number;
    maxDrawdownPct: number;
    finalEquity: number;
    riskBlocks: Record<string, number>;
  };
}

export interface ExecRunOptions {
  symbol: string;
  onEvent?: (e: ExecEvent) => void;
}

export type { EnrichedCandle, StrategySignal };
