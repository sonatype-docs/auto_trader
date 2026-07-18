// Trade Intelligence — public types.
// The permanent trade research object. Strategy-agnostic. Contains ALL raw
// context available at entry & exit; downstream analytics/AI decide importance.

export type TradeDirection = "long" | "short";

export interface TradeRecordCore {
  tradeId: string;
  strategyId: string;
  strategyVersion?: string | null;
  symbol: string;
  timeframe?: string | null;
  direction: TradeDirection;
  tradeType?: string | null;      // e.g. "breakout", "reversal", "continuation"
  entryType?: string | null;      // "market" | "limit" | "stop"
  stopType?: string | null;       // "atr" | "swing" | "fixed"
  targetType?: string | null;     // "rr" | "swing" | "level"
  status: "closed" | "open" | "cancelled";
  session?: string | null;

  signalTime?: number | null;
  orderTime?: number | null;
  fillTime?: number | null;
  entryTime: number;
  exitTime: number;
  weekday?: number | null;
  weekNumber?: number | null;
  month?: number | null;
  quarter?: number | null;
  year?: number | null;

  entryPrice: number;
  fillPrice?: number | null;
  exitPrice: number;
  stopPrice?: number | null;
  targetPrice?: number | null;
  positionSize?: number | null;
  riskUsd?: number | null;
  riskPct?: number | null;
  actualRr?: number | null;
  grossPnl?: number | null;
  netPnl: number;
  pnlPct?: number | null;
  pnlR?: number | null;
  mae?: number | null;
  mfe?: number | null;
  fees?: number | null;
  commission?: number | null;
  slippage?: number | null;
  spreadCost?: number | null;
  holdingBars?: number | null;
  durationMs?: number | null;
  exitReason?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonMap = Record<string, any>;


export interface TradeRecord extends TradeRecordCore {
  price: JsonMap;
  risk: JsonMap;
  performance: JsonMap;
  duration: JsonMap;
  volatility: JsonMap;
  trend: JsonMap;
  structure: JsonMap;
  liquidity: JsonMap;
  smartMoney: JsonMap;
  volumeProfile: JsonMap;
  breakout: JsonMap;
  entryQuality: JsonMap;
  stop: JsonMap;
  target: JsonMap;
  filters: JsonMap;
  news: JsonMap;
  regime: JsonMap;
  custom: JsonMap;
  tags: string[];
  raw: JsonMap;
}

export interface TradeQuerySpec {
  strategyId?: string;
  symbol?: string;
  timeframe?: string;
  direction?: TradeDirection;
  session?: string;
  weekday?: number;
  fromMs?: number;
  toMs?: number;
  minNetPnl?: number;
  maxNetPnl?: number;
  winnersOnly?: boolean;
  losersOnly?: boolean;
  tags?: string[];        // must contain all
  customContains?: JsonMap; // filters -> custom @> value
  filtersContains?: JsonMap;
  orderBy?: "entry_time" | "exit_time" | "net_pnl" | "actual_rr";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
  cursorEntryTimeMs?: number;
  cursorTradeId?: string;
  projection?: "full" | "research";
}

export interface TradeQueryResult {
  rows: TradeRecord[];
  total: number;
}
