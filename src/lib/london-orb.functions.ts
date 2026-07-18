import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { LondonOrbOpts } from "@/lib/strategy/london-orb.server";

const OrbSchema = z.object({
  symbol: z.string().min(3).max(24),
  days: z.number().int().min(14).max(720),
  dataSource: z.enum(["shark", "yahoo"]).optional(),
  rangeStartUtc: z.string().regex(/^\d{2}:\d{2}$/),
  rangeEndUtc: z.string().regex(/^\d{2}:\d{2}$/),
  entryVariant: z.enum(["immediate", "break_close", "retest"]),
  retestBufferPct: z.number().min(0).max(100),
  stopModel: z.enum(["opposite_range", "range_pct", "atr_mult", "fixed_r"]),
  stopAtrMult: z.number().positive().max(10),
  stopRangePct: z.number().positive().max(5),
  targetModel: z.enum(["fixed_rr", "opposite_range", "atr_mult"]),
  rr: z.number().positive().max(20),
  targetAtrMult: z.number().positive().max(20),
  slRiskUsd: z.number().positive().max(10000),
  maxTradesPerDay: z.number().int().min(1).max(10),
  trend: z.enum(["off", "ema20", "ema50", "ema200", "align_20_50_200"]),
  atrMin: z.number().nullable(),
  atrMax: z.number().nullable(),
  minBreakBodyPct: z.number().min(0).max(100),
  minBreakDistancePct: z.number().min(0).max(500),
  maxBreakDistancePct: z.number().nullable(),
  skipWeekdays: z.array(z.number().int().min(0).max(6)),
  timeToFillMaxHours: z.number().positive().max(24),
  entryCutoffUtc: z.string().regex(/^\d{2}:\d{2}$/),
  maxHoldHours: z.number().min(0).max(48),
});


export const runLondonOrb = createServerFn({ method: "POST" })
  .validator((input: unknown) => OrbSchema.parse(input))
  .handler(async ({ data }) => {
    const { runLondonOrbBacktest } = await import("@/lib/strategy/london-orb.server");
    return runLondonOrbBacktest(data as LondonOrbOpts);
  });

export const optimizeLondonOrbFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    OrbSchema.extend({ topN: z.number().int().min(3).max(30).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { optimizeLondonOrb } = await import("@/lib/strategy/london-orb.server");
    const { topN, ...opts } = data;
    return optimizeLondonOrb(opts as LondonOrbOpts, topN ?? 12);
  });
