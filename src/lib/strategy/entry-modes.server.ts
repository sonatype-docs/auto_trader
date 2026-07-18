// Shared entry/SL computation used by live engine, single-day backtest,
// range backtest, and sweep. Centralizing here keeps all modes in one place.

export type EntryMode = "fib" | "retest" | "market" | "adaptive";

export interface EntryConfig {
  mode: EntryMode;
  entryDepthPct: number;      // 0..0.5 — depth into zone from broken edge
  slDepthPct: number;         // > entryDepthPct, <= 1
  adaptiveStrongBreakPct: number; // %, e.g. 30
  adaptiveShallowDepth: number;   // depth used when break is "strong"
  adaptiveDeepDepth: number;      // depth used when break is weak
  retestSlR: number;              // SL distance in R for retest mode
}

export const DEFAULT_ENTRY_CONFIG: EntryConfig = {
  mode: "fib",
  entryDepthPct: 0.15,
  slDepthPct: 0.60,
  adaptiveStrongBreakPct: 30,
  adaptiveShallowDepth: 0.10,
  adaptiveDeepDepth: 0.35,
  retestSlR: 0.5,
};

export interface ComputedEntry {
  entry: number;
  sl: number;
  /** Whether this setup should be executed at market on the break candle (no limit). */
  market: boolean;
  /** Human label of the effective mode after adaptive resolution. */
  effectiveMode: EntryMode;
  /** Depth actually used (for logging / analytics). */
  effectiveDepth: number;
}

/**
 * Compute entry + stop-loss prices for a directional setup.
 *
 * Long: entry sits below zone_high (pullback into zone), sl sits deeper.
 * Short: mirrored, above zone_low.
 */
export function computeEntry(
  side: "long" | "short",
  zoneHigh: number,
  zoneLow: number,
  breakClose: number,
  cfg: EntryConfig,
): ComputedEntry {
  const range = zoneHigh - zoneLow;
  const longSign = side === "long" ? 1 : -1;

  // Retest — entry at broken edge, SL a fixed R below.
  if (cfg.mode === "retest") {
    const entry = side === "long" ? zoneHigh : zoneLow;
    const risk = range * cfg.retestSlR;
    const sl = entry - risk * longSign;
    return { entry, sl, market: false, effectiveMode: "retest", effectiveDepth: 0 };
  }

  // Market — enter at the break candle close; SL still derived from sl_depth_pct.
  if (cfg.mode === "market") {
    const entry = breakClose;
    const sl =
      side === "long" ? zoneHigh - range * cfg.slDepthPct : zoneLow + range * cfg.slDepthPct;
    return { entry, sl, market: true, effectiveMode: "market", effectiveDepth: 0 };
  }

  // Adaptive — pick shallow vs deep based on how far the break closed beyond the zone.
  let depth = cfg.entryDepthPct;
  let effective: EntryMode = "fib";
  if (cfg.mode === "adaptive") {
    const beyond = side === "long" ? breakClose - zoneHigh : zoneLow - breakClose;
    const beyondPct = range > 0 ? (beyond / range) * 100 : 0;
    depth = beyondPct >= cfg.adaptiveStrongBreakPct ? cfg.adaptiveShallowDepth : cfg.adaptiveDeepDepth;
    effective = "adaptive";
  }

  const entry = side === "long" ? zoneHigh - range * depth : zoneLow + range * depth;
  const sl =
    side === "long" ? zoneHigh - range * cfg.slDepthPct : zoneLow + range * cfg.slDepthPct;
  return { entry, sl, market: false, effectiveMode: effective, effectiveDepth: depth };
}

/** Pull an EntryConfig out of a strategy_settings row, tolerant of missing cols. */
export function entryConfigFromSettings(row: Record<string, unknown>): EntryConfig {
  const num = (k: string, d: number) => {
    const v = row[k];
    return typeof v === "number" && Number.isFinite(v) ? v : d;
  };
  const mode = ((row.entry_mode as string) ?? "fib") as EntryMode;
  return {
    mode: ["fib", "retest", "market", "adaptive"].includes(mode) ? mode : "fib",
    entryDepthPct: num("entry_depth_pct", DEFAULT_ENTRY_CONFIG.entryDepthPct),
    slDepthPct: num("sl_depth_pct", DEFAULT_ENTRY_CONFIG.slDepthPct),
    adaptiveStrongBreakPct: num("adaptive_strong_break_pct", DEFAULT_ENTRY_CONFIG.adaptiveStrongBreakPct),
    adaptiveShallowDepth: num("adaptive_shallow_depth", DEFAULT_ENTRY_CONFIG.adaptiveShallowDepth),
    adaptiveDeepDepth: num("adaptive_deep_depth", DEFAULT_ENTRY_CONFIG.adaptiveDeepDepth),
    retestSlR: num("retest_sl_r", DEFAULT_ENTRY_CONFIG.retestSlR),
  };
}
