import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getKlineSource, type KlineSourceId } from "@/lib/exchange/kline-source.server";
import type { Kline } from "@/lib/exchange/shark-client.server";
import { simulateFromKlines } from "@/lib/strategy/backtest-range.server";

const EntryModeEnum = z.enum(["fib", "retest", "market", "adaptive"]);

const GridSweepFastSchema = z.object({
  symbol: z.string().min(3).max(24),
  days: z.number().int().min(1).max(730),
  skip_weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  session_start_ist: z.array(z.string().regex(/^\\d{2}:\\d{2}(:\\d{2})?$/)).min(1).max(24),
  sl_risk_usd: z.array(z.number().positive()).min(1).max(10),
  rr: z.array(z.number().positive()).min(1).max(10),
  entry_mode: z.array(EntryModeEnum).min(1).max(4),
  entry_depth_pct: z.array(z.number().min(0).max(3)).min(1).max(10),
  sl_depth_pct: z.array(z.number().min(0.1).max(3)).min(1).max(10),
  retest_sl_r: z.array(z.number().positive().max(5)).min(1).max(10),
  trail_enabled: z.array(z.boolean()).min(1).max(2),
  trail_activate_r: z.array(z.number().positive()).min(1).max(10),
  trail_step_r: z.array(z.number().positive()).min(1).max(10),
  fee_usd_per_order: z.array(z.number().min(0).max(1000)).min(1).max(10),
  zone_source: z.array(z.enum(["range", "breakout"])).min(1).max(2),
  data_source: z.array(z.enum(["shark", "yahoo"])).min(1).max(2),
  max_combos: z.number().int().min(1).max(300).optional(),
});

type Combo = {
  session_start_ist: string;
  sl_risk_usd: number;
  rr: number;
  entry_mode: "fib" | "retest" | "market" | "adaptive";
  entry_depth_pct: number;
  sl_depth_pct: number;
  retest_sl_r: number;
  trail_enabled: boolean;
  trail_activate_r: number;
  trail_step_r: number;
  fee_usd_per_order: number;
  zone_source: "range" | "breakout";
  data_source: KlineSourceId;
};

type Row = Combo & {
  idx: number;
  trades: number;
  wins: number;
  losses: number;
  open: number;
  win_rate_pct: number;
  total_pnl_usd: number;
  net_pnl_usd: number;
  avg_r: number;
  profit_factor: number;
  expectancy_usd: number;
  max_drawdown_usd: number;
  max_consec_losses: number;
  fill_rate_pct: number;
  est_fees_usd: number;
  error?: string;
};

function product(values: number[]) {
  return values.reduce((a, b) => a * b, 1);
}

export const backtestGridSweepFast = createServerFn({ method: "POST" })
  .validator((input: unknown) => GridSweepFastSchema.parse(input))
  .handler(async ({ data }) => {
    const cap = data.max_combos ?? 150;
    const startedAt = Date.now();

    const theoreticalCount = product([
      data.session_start_ist.length,
      data.sl_risk_usd.length,
      data.rr.length,
      data.entry_mode.length,
      data.entry_depth_pct.length,
      data.sl_depth_pct.length,
      data.retest_sl_r.length,
      data.trail_enabled.length,
      data.trail_activate_r.length,
      data.trail_step_r.length,
      data.fee_usd_per_order.length,
      data.zone_source.length,
      data.data_source.length,
    ]);

    const combos: Combo[] = [];
    outer:
    for (const session_start_ist of data.session_start_ist)
    for (const sl_risk_usd of data.sl_risk_usd)
    for (const rr of data.rr)
    for (const entry_mode of data.entry_mode)
    for (const entry_depth_pct of data.entry_depth_pct)
    for (const sl_depth_pct of data.sl_depth_pct)
    for (const retest_sl_r of data.retest_sl_r)
    for (const trail_enabled of data.trail_enabled)
    for (const trail_activate_r of data.trail_activate_r)
    for (const trail_step_r of data.trail_step_r)
    for (const fee_usd_per_order of data.fee_usd_per_order)
    for (const zone_source of data.zone_source)
    for (const data_source of data.data_source) {
      combos.push({
        session_start_ist,
        sl_risk_usd,
        rr,
        entry_mode,
        entry_depth_pct,
        sl_depth_pct,
        retest_sl_r,
        trail_enabled,
        trail_activate_r,
        trail_step_r,
        fee_usd_per_order,
        zone_source,
        data_source,
      });
      if (combos.length >= cap) break outer;
    }

    const skipWeekdays = data.skip_weekdays as (0 | 1 | 2 | 3 | 4 | 5 | 6)[];
    const nowMs = Date.now();
    const fromMs = nowMs - data.days * 86_400_000;

    // Critical fix: fetch the historical dataset ONCE per source, then run every
    // parameter combination against the same in-memory candles. The old path
    // re-fetched 1h + daily data for every combination, which made the UI look
    // stuck and could exhaust upstream/API timeouts.
    const uniqueSources = [...new Set(combos.map((c) => c.data_source))] as KlineSourceId[];
    const datasets = new Map<KlineSourceId, Kline[]>();

    await Promise.all(uniqueSources.map(async (sourceId) => {
      const source = await getKlineSource(sourceId);
      const klines = await source.getKlinesRange(data.symbol, "1h", fromMs, nowMs);
      datasets.set(sourceId, klines);
    }));

    const batchSize = 16;
    const rows: Row[] = [];

    for (let i = 0; i < combos.length; i += batchSize) {
      const batch = combos.slice(i, i + batchSize);
      const settled = await Promise.all(batch.map(async (c, k): Promise<Row> => {
        try {
          const klines = datasets.get(c.data_source);
          if (!klines) throw new Error(`Dataset not loaded for ${c.data_source}`);

          const r = simulateFromKlines(klines, {
            symbol: data.symbol,
            sessionStartIst: c.session_start_ist.slice(0, 5),
            slRiskUsd: c.sl_risk_usd,
            rr: c.rr,
            days: data.days,
            fromMs,
            nowMs,
            trailEnabled: c.trail_enabled,
            trailActivateR: c.trail_activate_r,
            trailStepR: c.trail_step_r,
            skipWeekdays,
            entry: {
              mode: c.entry_mode,
              entryDepthPct: c.entry_depth_pct,
              slDepthPct: c.sl_depth_pct,
              adaptiveStrongBreakPct: 30,
              adaptiveShallowDepth: 0.10,
              adaptiveDeepDepth: 0.35,
              retestSlR: c.retest_sl_r,
            },
            feeUsdPerOrder: c.fee_usd_per_order,
            zoneSource: c.zone_source,
          });

          const s = r.summary;
          return {
            ...c,
            idx: i + k,
            trades: s.tp + s.sl,
            wins: s.tp,
            losses: s.sl,
            open: s.open,
            win_rate_pct: s.win_rate_pct,
            total_pnl_usd: s.total_pnl_usd,
            net_pnl_usd: s.net_pnl_usd,
            avg_r: s.avg_r,
            profit_factor: s.profit_factor === Infinity ? 999 : s.profit_factor,
            expectancy_usd: s.expectancy_usd,
            max_drawdown_usd: s.max_drawdown_usd,
            max_consec_losses: s.max_consec_losses,
            fill_rate_pct: s.fill_rate_pct,
            est_fees_usd: s.est_fees_usd,
          };
        } catch (e) {
          return {
            ...c,
            idx: i + k,
            trades: 0,
            wins: 0,
            losses: 0,
            open: 0,
            win_rate_pct: 0,
            total_pnl_usd: 0,
            net_pnl_usd: 0,
            avg_r: 0,
            profit_factor: 0,
            expectancy_usd: 0,
            max_drawdown_usd: 0,
            max_consec_losses: 0,
            fill_rate_pct: 0,
            est_fees_usd: 0,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }));
      rows.push(...settled);
    }

    return {
      symbol: data.symbol,
      days: data.days,
      skip_weekdays: data.skip_weekdays,
      total_combos: combos.length,
      theoretical_combos: theoreticalCount,
      capped: theoreticalCount > combos.length,
      elapsed_ms: Date.now() - startedAt,
      rows,
    };
  });
