// Filter definitions for the research panel. Each filter has:
//   - id             stable identifier
//   - phase          which rollout phase it belongs to
//   - label          human title
//   - kind           bucket dimension (used for label lookup)
//   - buckets        possible bucket keys in canonical display order
//   - tag(f)         maps a TradeFeatures row to its bucket key (or null)
//   - numericAccessor optional numeric value for histograms / min-max gate
//   - description    short tooltip text
//
// Each filter's runtime state is `FilterState`:
//   - enabled        master toggle
//   - mode           "bucket" (allow specific buckets) | "range" (min/max on numericAccessor)
//   - allowedBuckets set of bucket keys allowed when mode=bucket
//   - min/max        numeric range when mode=range
//
// Aggregators consume a `Set<filterId>` of enabled filters + the states and
// apply `gate(features, state)` to every trade for the post-hoc analytics view.

import type {
  QuintileBucket,
  QuartileBucket,
  TradeFeatures,
  TrendBucket,
  PrevDayBucket,
} from "./features";
import {
  QUINTILE_LABEL_MAP,
  QUARTILE_LABEL_MAP,
  TREND_LABEL_MAP,
  PREV_DAY_LABEL_MAP,
} from "./features";

export type FilterKind = "quintile" | "quartile" | "trend" | "prev_day" | "side" | "weekday" | "hour" | "month" | "boolean";
export type FilterId =
  | "or_size"
  | "break_strength"
  | "candle_body"
  | "atr_regime"
  | "trend"
  | "prev_day"
  | "side"
  | "weekday"
  | "hour"
  | "month"
  | "mae"
  | "mfe"
  | "duration"
  | "time_to_fill"
  | "retests"
  | "fvg"
  | "sweep";
export type FilterPhase = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface FilterDef {
  id: FilterId;
  phase: FilterPhase;
  label: string;
  short: string;
  description: string;
  kind: FilterKind;
  buckets: string[];
  bucketLabel: (key: string) => string;
  tag: (f: TradeFeatures) => string | null;
  /** For range-mode gate + histograms. */
  numericAccessor?: (f: TradeFeatures) => number | null;
  numericUnit?: string;
}

export const FILTERS: FilterDef[] = [
  {
    id: "or_size",
    phase: 1,
    label: "Opening Range Size",
    short: "OR size",
    description:
      "Size of the session opening-range candle. Small ranges often trap breakouts; large ranges leave less room to run.",
    kind: "quintile",
    buckets: ["very_small", "small", "medium", "large", "very_large"],
    bucketLabel: (k) => QUINTILE_LABEL_MAP[k as QuintileBucket] ?? k,
    tag: (f) => f.or_bucket5,
    numericAccessor: (f) => f.or_size_usd,
    numericUnit: "$",
  },
  {
    id: "break_strength",
    phase: 1,
    label: "Breakout Strength",
    short: "Break dist",
    description:
      "How far the breakout candle closed beyond the range, as % of the opening range. Weak breaks fail more often.",
    kind: "quintile",
    buckets: ["very_small", "small", "medium", "large", "very_large"],
    bucketLabel: (k) => QUINTILE_LABEL_MAP[k as QuintileBucket] ?? k,
    tag: (f) => f.break_strength_bucket5,
    numericAccessor: (f) => f.break_distance_pct_or,
    numericUnit: "% OR",
  },
  {
    id: "candle_body",
    phase: 1,
    label: "Breakout Candle Quality",
    short: "Body %",
    description:
      "Body-to-range ratio of the breakout candle. Full-bodied candles show conviction; wicky candles show rejection.",
    kind: "quintile",
    buckets: ["very_small", "small", "medium", "large", "very_large"],
    bucketLabel: (k) => QUINTILE_LABEL_MAP[k as QuintileBucket] ?? k,
    tag: (f) => f.body_bucket5,
    numericAccessor: (f) => f.body_pct,
    numericUnit: "%",
  },
  {
    id: "atr_regime",
    phase: 1,
    label: "ATR Volatility Regime",
    short: "ATR",
    description:
      "Daily ATR(14) at the time of the session. Split into Low / Medium / High / Extreme quartiles.",
    kind: "quartile",
    buckets: ["low", "medium", "high", "extreme"],
    bucketLabel: (k) => QUARTILE_LABEL_MAP[k as QuartileBucket] ?? k,
    tag: (f) => f.atr_bucket4,
    numericAccessor: (f) => f.daily_atr,
    numericUnit: "$",
  },
  {
    id: "trend",
    phase: 1,
    label: "Market Trend",
    short: "Trend",
    description:
      "Regime from EMA20/50/200 stack + ADX(14). Strong / Weak Up/Downtrend, or Range.",
    kind: "trend",
    buckets: ["strong_up", "weak_up", "range", "weak_down", "strong_down"],
    bucketLabel: (k) => TREND_LABEL_MAP[k as TrendBucket] ?? k,
    tag: (f) => f.trend_bucket,
  },
  {
    id: "prev_day",
    phase: 1,
    label: "Previous Day Bias",
    short: "Prev day",
    description:
      "Prior IST daily-candle character: bullish, bearish, inside, outside, or doji.",
    kind: "prev_day",
    buckets: ["bullish", "bearish", "inside", "outside", "doji"],
    bucketLabel: (k) => PREV_DAY_LABEL_MAP[k as PrevDayBucket] ?? k,
    tag: (f) => f.prev_day_bucket,
  },
  // ---- Phase 3: Timing / Side splits ----
  {
    id: "side",
    phase: 3,
    label: "Trade Side",
    short: "Side",
    description: "Long vs short breakouts.",
    kind: "side",
    buckets: ["long", "short"],
    bucketLabel: (k) => (k === "long" ? "Long" : "Short"),
    tag: (f) => f.side,
  },
  {
    id: "weekday",
    phase: 3,
    label: "Weekday",
    short: "Day",
    description: "Which weekday the break occurred (0=Sun … 6=Sat).",
    kind: "weekday",
    buckets: ["0", "1", "2", "3", "4", "5", "6"],
    bucketLabel: (k) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][parseInt(k, 10)] ?? k,
    tag: (f) => (f.weekday !== null ? String(f.weekday) : null),
  },
  {
    id: "hour",
    phase: 3,
    label: "Break Hour (IST)",
    short: "Hour",
    description: "Hour of the day (IST) the breakout candle opened.",
    kind: "hour",
    buckets: Array.from({ length: 24 }, (_, i) => String(i)),
    bucketLabel: (k) => `${k.padStart(2, "0")}:00`,
    tag: (f) => (f.break_hour_ist !== null ? String(f.break_hour_ist) : null),
    numericAccessor: (f) => f.break_hour_ist,
    numericUnit: "h",
  },
  {
    id: "month",
    phase: 3,
    label: "Month",
    short: "Month",
    description: "Calendar month of the trade.",
    kind: "month",
    buckets: Array.from({ length: 12 }, (_, i) => String(i + 1)),
    bucketLabel: (k) => ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(k, 10) - 1] ?? k,
    tag: (f) => (f.month !== null ? String(f.month) : null),
  },
  // ---- Phase 2: Trade Quality ----
  {
    id: "mae",
    phase: 2,
    label: "Max Adverse Excursion (R)",
    short: "MAE",
    description: "How deep price ran against a triggered trade, in R.",
    kind: "quintile",
    buckets: ["very_small", "small", "medium", "large", "very_large"],
    bucketLabel: (k) => QUINTILE_LABEL_MAP[k as QuintileBucket] ?? k,
    tag: (f) => f.mae_bucket5,
    numericAccessor: (f) => f.mae_r,
    numericUnit: "R",
  },
  {
    id: "mfe",
    phase: 2,
    label: "Max Favourable Excursion (R)",
    short: "MFE",
    description: "Peak favourable move in R units after trigger.",
    kind: "quintile",
    buckets: ["very_small", "small", "medium", "large", "very_large"],
    bucketLabel: (k) => QUINTILE_LABEL_MAP[k as QuintileBucket] ?? k,
    tag: (f) => f.mfe_bucket5,
    numericAccessor: (f) => f.mfe_r,
    numericUnit: "R",
  },
  {
    id: "duration",
    phase: 2,
    label: "Trade Duration (bars)",
    short: "Duration",
    description: "How many bars a decided trade lasted.",
    kind: "quintile",
    buckets: ["very_small", "small", "medium", "large", "very_large"],
    bucketLabel: (k) => QUINTILE_LABEL_MAP[k as QuintileBucket] ?? k,
    tag: (f) => f.duration_bucket5,
    numericAccessor: (f) => f.duration_bars,
    numericUnit: "bars",
  },
  {
    id: "time_to_fill",
    phase: 2,
    label: "Time to Fill (bars)",
    short: "TTF",
    description: "Bars from break close until entry was hit.",
    kind: "quintile",
    buckets: ["very_small", "small", "medium", "large", "very_large"],
    bucketLabel: (k) => QUINTILE_LABEL_MAP[k as QuintileBucket] ?? k,
    tag: (f) => f.ttl_bucket5,
    numericAccessor: (f) => f.time_to_fill_bars,
    numericUnit: "bars",
  },
  {
    id: "retests",
    phase: 4,
    label: "Retest Count",
    short: "Retests",
    description: "How many times price flipped through entry after fill.",
    kind: "quintile",
    buckets: ["0", "1", "2", "3+"],
    bucketLabel: (k) => k,
    tag: (f) => {
      if (f.retest_count === null) return null;
      const n = f.retest_count;
      if (n >= 3) return "3+";
      return String(n);
    },
    numericAccessor: (f) => f.retest_count,
  },
  // ---- Phase 5: Smart-money structure flags ----
  {
    id: "fvg",
    phase: 5,
    label: "Fair Value Gap on Break",
    short: "FVG",
    description: "3-candle FVG present on the breakout in the trade direction.",
    kind: "boolean",
    buckets: ["yes", "no"],
    bucketLabel: (k) => (k === "yes" ? "FVG present" : "No FVG"),
    tag: (f) => (f.fvg_present === null ? null : f.fvg_present ? "yes" : "no"),
  },
  {
    id: "sweep",
    phase: 5,
    label: "Liquidity Sweep on Break",
    short: "Sweep",
    description: "Break candle swept a prior swing then closed back through it.",
    kind: "boolean",
    buckets: ["yes", "no"],
    bucketLabel: (k) => (k === "yes" ? "Sweep present" : "No sweep"),
    tag: (f) => (f.sweep_present === null ? null : f.sweep_present ? "yes" : "no"),
  },
];

export interface FilterState {
  enabled: boolean;
  mode: "bucket" | "range";
  allowedBuckets: Record<string, boolean>;
  min: number | null;
  max: number | null;
}

export function defaultFilterState(def: FilterDef): FilterState {
  const allowed: Record<string, boolean> = {};
  for (const b of def.buckets) allowed[b] = true;
  return {
    enabled: false,
    mode: def.numericAccessor ? "bucket" : "bucket",
    allowedBuckets: allowed,
    min: null,
    max: null,
  };
}

export function gate(def: FilterDef, state: FilterState, f: TradeFeatures): boolean {
  if (!state.enabled) return true;
  if (state.mode === "bucket") {
    const b = def.tag(f);
    if (b === null) return false;
    return !!state.allowedBuckets[b];
  }
  // range
  const acc = def.numericAccessor;
  if (!acc) return true;
  const v = acc(f);
  if (v === null || !Number.isFinite(v)) return false;
  if (state.min !== null && v < state.min) return false;
  if (state.max !== null && v > state.max) return false;
  return true;
}

export function passesAllFilters(
  filters: Record<FilterId, FilterState>,
  f: TradeFeatures,
): boolean {
  for (const def of FILTERS) {
    if (!gate(def, filters[def.id], f)) return false;
  }
  return true;
}

export function initialFilterStates(): Record<FilterId, FilterState> {
  const out = {} as Record<FilterId, FilterState>;
  for (const def of FILTERS) out[def.id] = defaultFilterState(def);
  return out;
}

export function anyFilterEnabled(filters: Record<FilterId, FilterState>): boolean {
  for (const def of FILTERS) if (filters[def.id].enabled) return true;
  return false;
}
