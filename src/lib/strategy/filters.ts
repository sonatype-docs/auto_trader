// Client-safe filter config + Zod schema. Imported by both the UI and server code.
import { z } from "zod";

export const FiltersZod = z
  .object({
    enabled: z.boolean().optional(),
    htf: z
      .object({
        daily_ema_enabled: z.boolean().optional(),
        daily_ema_len: z.number().int().min(2).max(400).optional(),
        prev_day_close_enabled: z.boolean().optional(),
        weekly_open_enabled: z.boolean().optional(),
        // D1 EMA regime gate — the highest-EV filter from the research.
        // gate_by_slow: only trade in the direction of price vs EMA(slow).
        // gate_by_cross: only trade in the direction of EMA(fast) vs EMA(slow).
        ema_bias_enabled: z.boolean().optional(),
        ema_bias_fast: z.number().int().min(2).max(400).optional(),
        ema_bias_slow: z.number().int().min(2).max(400).optional(),
        ema_bias_mode: z.enum(["gate_by_slow", "gate_by_cross"]).optional(),
      })
      .optional(),
    quality: z
      .object({
        zone_size_enabled: z.boolean().optional(),
        zone_size_min: z.number().nonnegative().optional(),
        zone_size_max: z.number().nonnegative().optional(),
        zone_size_unit: z.enum(["usd", "pct"]).optional(),
        atr_enabled: z.boolean().optional(),
        atr_len: z.number().int().min(2).max(200).optional(),
        atr_min: z.number().nonnegative().optional(),
        atr_max: z.number().nonnegative().optional(),
        // ATR squeeze pre-session filter — only take setups when today's ATR
        // is compressed relative to the lookback average of ATR.
        // Trigger when atr / SMA(atr, lookback) <= ratio.
        atr_squeeze_enabled: z.boolean().optional(),
        atr_squeeze_lookback: z.number().int().min(3).max(200).optional(),
        atr_squeeze_ratio: z.number().min(0.1).max(2).optional(),
        break_strength_enabled: z.boolean().optional(),
        break_strength_pct: z.number().nonnegative().max(500).optional(),
        break_body_enabled: z.boolean().optional(),
        break_body_pct: z.number().nonnegative().max(100).optional(),
        break_timing_enabled: z.boolean().optional(),
        break_timing_hours: z.number().nonnegative().max(24).optional(),
      })
      .optional(),
  })
  .optional();

export type FilterConfig = z.infer<typeof FiltersZod>;

export const DEFAULT_FILTERS: NonNullable<FilterConfig> = {
  enabled: false,
  htf: {
    daily_ema_enabled: false,
    daily_ema_len: 20,
    prev_day_close_enabled: false,
    weekly_open_enabled: false,
    ema_bias_enabled: false,
    ema_bias_fast: 21,
    ema_bias_slow: 50,
    ema_bias_mode: "gate_by_slow",
  },
  quality: {
    zone_size_enabled: false,
    zone_size_min: 0,
    zone_size_max: 0,
    zone_size_unit: "usd",
    atr_enabled: false,
    atr_len: 14,
    atr_min: 0,
    atr_max: 0,
    atr_squeeze_enabled: false,
    atr_squeeze_lookback: 20,
    atr_squeeze_ratio: 0.7,
    break_strength_enabled: false,
    break_strength_pct: 25,
    break_body_enabled: false,
    break_body_pct: 50,
    break_timing_enabled: false,
    break_timing_hours: 6,
  },
};

/** True when any actual filter is turned on (master gate + at least one child). */
export function filtersActive(cfg: FilterConfig | undefined): boolean {
  if (!cfg?.enabled) return false;
  const h = cfg.htf ?? {};
  const q = cfg.quality ?? {};
  return Boolean(
    h.daily_ema_enabled ||
      h.prev_day_close_enabled ||
      h.weekly_open_enabled ||
      h.ema_bias_enabled ||
      q.zone_size_enabled ||
      q.atr_enabled ||
      q.atr_squeeze_enabled ||
      q.break_strength_enabled ||
      q.break_body_enabled ||
      q.break_timing_enabled,
  );
}

/** True if any filter that needs daily klines is turned on. */
export function needsDailyBias(cfg: FilterConfig | undefined): boolean {
  if (!cfg?.enabled) return false;
  const h = cfg.htf ?? {};
  const q = cfg.quality ?? {};
  return Boolean(
    h.daily_ema_enabled ||
      h.prev_day_close_enabled ||
      h.weekly_open_enabled ||
      h.ema_bias_enabled ||
      q.atr_enabled ||
      q.atr_squeeze_enabled,
  );
}
