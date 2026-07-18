// Universal Strategy Engine — types.
// Strategy-agnostic: everything is driven by a StrategyConfig object.
import type { EnrichedCandle, SessionName } from "@/lib/market-data/types";

export type SignalDirection = "long" | "short";
export type SignalType =
  | "BUY" | "SELL"
  | "BUY_LIMIT" | "SELL_LIMIT"
  | "BUY_STOP" | "SELL_STOP"
  | "CLOSE_POSITION" | "MOVE_SL" | "MOVE_TP"
  | "BREAK_EVEN" | "PARTIAL_CLOSE"
  | "NO_ACTION";

export type RunMode = "historical" | "live" | "replay" | "paper";

// ---------- Filter configs ----------
export interface SessionFilter {
  allowedSessions?: SessionName[];
  allowedWeekdays?: number[]; // 0..6
  blockWeekend?: boolean;
  blockHoliday?: boolean;
  blockMonthEnd?: boolean;
  blockQuarterEnd?: boolean;
  blockFirstTradingDay?: boolean;
  blockLastTradingDay?: boolean;
  customSessions?: string[]; // names that must be active
  hoursOfDay?: number[]; // in display TZ
}

export interface TrendFilter {
  emaAlignment?: { above?: number[]; below?: number[] }; // e.g. above:[20,50], close must be above ema20 & ema50
  emaCrossover?: { fast: 20|50|100|200; slow: 20|50|100|200; direction: "bull"|"bear" };
  vwapSide?: "above" | "below" | null;
  adxMin?: number;
  adxMax?: number;
  requireStructure?: Array<"HH"|"HL"|"LH"|"LL">;
  higherTimeframeBias?: "bull" | "bear" | null; // consumer supplies context
  trendSlopeLen?: number;
  trendSlopeMin?: number; // (ema[i] - ema[i-len]) / len threshold
}

export interface VolatilityFilter {
  atrMin?: number;
  atrMax?: number;
  atrPercentileMin?: number;   // 0..100
  atrPercentileMax?: number;
  openingRangeMin?: number;
  openingRangeMax?: number;
  dailyRangeMin?: number;
  weeklyRangeMin?: number;
  requireExpansion?: boolean;  // atr > atr[-1]
  requireCompression?: boolean; // atr < atr[-1]
}

// ---------- Setup detectors ----------
export type SetupKind =
  | "opening_range_break" | "liquidity_sweep" | "breakout" | "retest"
  | "bos" | "choch" | "mss"
  | "prev_day_high_sweep" | "prev_day_low_sweep"
  | "equal_high_sweep" | "equal_low_sweep"
  | "vwap_cross" | "poc_rejection" | "vah_break" | "val_break"
  | "pdh_pdl_sweep";

export interface SetupConfig {
  kind: SetupKind;
  // Optional per-setup tuning.
  breakBufferPct?: number;      // extra % beyond level to count as break
  retestTolerancePct?: number;  // for retest-of-level setups
  poc?: number; vah?: number; val?: number; // static levels for volume-profile setups
}

// ---------- Confirmation ----------
export interface ConfirmationConfig {
  requireClose?: boolean;         // close beyond the trigger level
  minBodyPct?: number;            // body / range >= x %
  minBreakDistancePct?: number;   // (close - level) / level >= x %
  minVolumeMult?: number;         // volume >= mult * SMA(volume,20)
  minAtrMultiple?: number;        // break distance >= x * atr
  confirmationBars?: number;      // require N bars closing on the correct side
  structureAlignment?: "with" | "against" | null;
}

// ---------- Entry ----------
export type EntryModel =
  | { kind: "market" }
  | { kind: "limit"; pullbackPct: number }               // enter on retrace to level +/- pct
  | { kind: "stop"; breakoutBufferPct: number }          // buy stop above trigger
  | { kind: "fib"; ratio: number }                       // enter at fib ratio of trigger range
  | { kind: "order_block"; lookback: number }
  | { kind: "fvg"; lookback: number }
  | { kind: "vwap" }
  | { kind: "poc"; poc: number };

export interface EntryConfig {
  model: EntryModel;
  delayBars?: number;   // wait N bars after setup
  expiryBars?: number;  // pending order expires after N bars if not filled
}

// ---------- Stops ----------
export type StopModel =
  | { kind: "fixed_pts"; points: number }
  | { kind: "atr"; multiple: number }
  | { kind: "swing" }
  | { kind: "previous_candle" }
  | { kind: "opposite_range" }
  | { kind: "percentage"; pct: number }
  | { kind: "fib"; ratio: number }
  | { kind: "sweep_extreme"; bufferPct?: number };

// ---------- Targets ----------
export type TargetKind =
  | "rr" | "swing" | "liquidity" | "opposite_range"
  | "vwap" | "poc" | "vah" | "val" | "atr_multiple"
  | "opposite_pdx";

export interface TargetLeg {
  kind: TargetKind;
  value?: number;      // rr or atr multiple
  sizePct: number;     // portion of the position (0..100)
}

export interface TargetConfig {
  legs: TargetLeg[];             // supports partial TPs
  trailAfterR?: number | null;   // start trailing runner after peak R
  trailStepR?: number;
  moveToBreakEvenAtR?: number | null;
}

// ---------- Trade management ----------
export interface ManagementConfig {
  timeStopBars?: number | null;
  maxHoldingMinutes?: number | null;
  maxOpenPositions?: number;
  maxDailyTrades?: number;
  maxWeeklyTrades?: number;
  /** For sweep-family setups: max # of fills per single armed sweep event. */
  maxAttemptsPerSweep?: number;
}

// ---------- Invalidation ----------
export interface InvalidationConfig {
  maxDelayBars?: number;         // scrap setup if not entered within N bars
  invalidateOnTrendChange?: boolean;
  invalidateOnSessionEnd?: boolean;
  invalidateOnStructureFlip?: boolean;
  invalidateOnNews?: boolean;
}

// ---------- Risk & sizing (signal-side only) ----------
export interface RiskConfig {
  riskPerTradeUsd: number;
  contractMultiplier?: number; // for sizing metadata only
}

// ---------- Strategy configuration (top-level) ----------
export interface StrategyConfig {
  strategyId: string;
  strategyName: string;
  direction?: "long" | "short" | "both";
  session?: SessionFilter;
  trend?: TrendFilter;
  volatility?: VolatilityFilter;
  setup: SetupConfig;
  confirmation?: ConfirmationConfig;
  entry: EntryConfig;
  stop: StopModel;
  targets: TargetConfig;
  management?: ManagementConfig;
  invalidation?: InvalidationConfig;
  risk: RiskConfig;
  strengthWeights?: Partial<Record<
    "trend" | "volume" | "volatility" | "breakout" | "structure" | "liquidity" | "session" | "htf",
    number
  >>;
  optimizerVariables?: Record<string, unknown>;
}

// ---------- Signal object ----------
export interface StrategySignal {
  signalId: string;
  strategyId: string;
  strategyName: string;
  timestamp: number;      // bar timestamp that produced the signal
  symbol: string;
  direction: SignalDirection;
  type: SignalType;
  entryType: EntryModel["kind"];
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;     // primary TP
  targetLegs: Array<{ kind: TargetKind; price: number; sizePct: number }>;
  risk: number;           // $ risk at fill (entry to SL * unit)
  reward: number;         // $ reward at primary TP
  rr: number;
  units: number;          // sizing metadata only
  signalStrength: number; // 0..100
  strengthComponents: Record<string, number>;
  setupType: SetupKind;
  confirmationType: string[];
  filtersPassed: string[];
  filtersFailed: string[];
  expiryTs: number | null;
  invalidationReason?: string;
  metadata: Record<string, string | number | boolean | null>;
}

// ---------- Events ----------
export type EngineEventName =
  | "OnNewCandle" | "OnSetupDetected" | "OnSignalCreated"
  | "OnSignalInvalidated" | "OnTradeFilled" | "OnTradeClosed";

export interface EngineEvent {
  name: EngineEventName;
  ts: number;
  data: Record<string, string | number | boolean | null>;
}

export type EventListener = (e: EngineEvent) => void;

export interface EngineRunOptions {
  mode: RunMode;
  symbol: string;
  onEvent?: EventListener;
}

export interface EngineRunResult {
  signals: StrategySignal[];
  invalidated: StrategySignal[];
  events: EngineEvent[];
  stats: {
    barsProcessed: number;
    setupsDetected: number;
    signalsCreated: number;
    signalsInvalidated: number;
    filterRejects: Record<string, number>;
  };
}

// Re-export for consumers.
export type { EnrichedCandle };
