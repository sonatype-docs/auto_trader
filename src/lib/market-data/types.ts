// Market Data Engine — public types.
// This module is strategy-agnostic. It defines the shape of raw and enriched
// candles, timeframes, timezones and session windows. Every future strategy
// consumes EnrichedCandle[] from the engine and never talks to a data source
// directly.

export const TIMEFRAMES = [
  "1m", "2m", "3m", "5m", "10m", "15m", "30m", "45m",
  "1h", "2h", "4h", "1d", "1w", "1M",
] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "2m": 2 * 60_000,
  "3m": 3 * 60_000,
  "5m": 5 * 60_000,
  "10m": 10 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "45m": 45 * 60_000,
  "1h": 60 * 60_000,
  "2h": 2 * 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
  "1M": 30 * 24 * 60 * 60_000, // nominal; monthly buckets aligned by calendar
};

export const TIMEZONES = ["UTC", "IST", "New_York", "London", "Tokyo", "Sydney"] as const;
export type Timezone = (typeof TIMEZONES)[number];

export const TZ_IANA: Record<Timezone, string> = {
  UTC: "UTC",
  IST: "Asia/Kolkata",
  New_York: "America/New_York",
  London: "Europe/London",
  Tokyo: "Asia/Tokyo",
  Sydney: "Australia/Sydney",
};

export type SessionName =
  | "sydney"
  | "asian"
  | "london"
  | "new_york"
  | "london_ny_overlap"
  | "off"
  | "custom";

export interface RawCandle {
  ts: number;     // ms UTC (open time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // total (or tick volume when real not available)
  tickVolume?: number;
  realVolume?: number;
  spread?: number;
}

export interface Swing {
  index: number;
  price: number;
  type: "high" | "low";
}

export interface EnrichedCandle extends RawCandle {
  // Time context
  timezone: Timezone;
  isoLocal: string;   // formatted for display TZ
  weekday: number;    // 0=Sun..6=Sat (display TZ)
  hour: number;       // 0..23 (display TZ)
  month: number;      // 1..12 (display TZ)
  quarter: 1 | 2 | 3 | 4;
  weekNumber: number;
  // Calendar flags
  isWeekend: boolean;
  isHoliday: boolean;
  isNews: boolean;
  isMonthEnd: boolean;
  isQuarterEnd: boolean;
  isYearEnd: boolean;
  isFirstTradingDay: boolean;
  isLastTradingDay: boolean;
  // Session
  session: SessionName;
  customSessions: string[]; // names of user-defined windows active on this bar
  // Volatility
  trueRange: number;
  atr: number | null;
  atrPercentile: number | null; // 0..100 rolling percentile
  dailyRange: number | null;
  weeklyRange: number | null;
  monthlyRange: number | null;
  openingRangeSize: number | null;      // size of first N minutes range (session-local)
  openingRangePercentile: number | null;
  breakDistance: number | null;         // |close - openingRangeMid|
  // Trend
  ema20: number | null;
  ema50: number | null;
  ema100: number | null;
  ema200: number | null;
  sma20: number | null;
  sma50: number | null;
  vwapSession: number | null;
  vwapDaily: number | null;
  vwapWeekly: number | null;
  vwapMonthly: number | null;
  adx: number | null;
  rsi: number | null;
  macd: { macd: number; signal: number; hist: number } | null;
  // Market structure
  swingHigh: number | null;
  swingLow: number | null;
  structure: "HH" | "HL" | "LH" | "LL" | null;
  bos: "bull" | "bear" | null;
  choch: "bull" | "bear" | null;
  mss: "bull" | "bear" | null;
  // Liquidity
  prevDayHigh: number | null;
  prevDayLow: number | null;
  prevWeekHigh: number | null;
  prevWeekLow: number | null;
  prevMonthHigh: number | null;
  prevMonthLow: number | null;
  equalHigh: boolean;
  equalLow: boolean;
}

export interface CustomSession {
  name: string;
  startHour: number;   // 0..23 in Strategy TZ
  startMinute: number; // 0..59
  endHour: number;
  endMinute: number;
}

export interface EngineConfig {
  symbol: string;
  timeframe: Timeframe;
  inputTimezone: Timezone;   // TZ that raw candles are stamped in (always UTC for our sources)
  displayTimezone: Timezone; // used for weekday/hour/isoLocal
  strategyTimezone: Timezone; // used to bucket sessions / calendar rollovers
  atrLen: number;
  atrPercentileWindow: number;
  openingRangeMinutes: number; // e.g. 60 for London ORB
  openingRangeSessionStart: { hour: number; minute: number }; // in strategy TZ
  swingLookback: number;
  customSessions: CustomSession[];
  holidays: string[]; // yyyy-mm-dd in strategy TZ
  newsTimestamps: number[]; // ms UTC — bars containing news
}

export const DEFAULT_CONFIG: EngineConfig = {
  symbol: "XAUUSDT",
  timeframe: "5m",
  inputTimezone: "UTC",
  displayTimezone: "IST",
  strategyTimezone: "London",
  atrLen: 14,
  atrPercentileWindow: 200,
  openingRangeMinutes: 60,
  openingRangeSessionStart: { hour: 8, minute: 0 },
  swingLookback: 5,
  customSessions: [],
  holidays: [],
  newsTimestamps: [],
};
