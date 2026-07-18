// Server functions for the Market Data Engine.
// Thin wrappers around the loader + enricher — no strategy logic.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { enrichCandles } from "@/lib/market-data/enrich";
import type { QualityReport } from "@/lib/market-data/quality";
import { DEFAULT_CONFIG, TIMEFRAMES, TIMEZONES, type Timeframe, type Timezone, type EnrichedCandle } from "@/lib/market-data/types";

const InputSchema = z.object({
  source: z.enum(["shark", "yahoo"]).default("yahoo"),
  symbol: z.string().default("XAUUSDT"),
  timeframe: z.enum([...TIMEFRAMES] as [Timeframe, ...Timeframe[]]).default("5m"),
  displayTimezone: z.enum([...TIMEZONES] as [Timezone, ...Timezone[]]).default("IST"),
  strategyTimezone: z.enum([...TIMEZONES] as [Timezone, ...Timezone[]]).default("London"),
  fromMs: z.number(),
  toMs: z.number(),
  openingRangeMinutes: z.number().int().min(5).max(240).default(60),
  openingRangeStartHour: z.number().int().min(0).max(23).default(8),
  openingRangeStartMinute: z.number().int().min(0).max(59).default(0),
  atrLen: z.number().int().min(2).max(200).default(14),
  swingLookback: z.number().int().min(2).max(30).default(5),
  customSessions: z
    .array(
      z.object({
        name: z.string(),
        startHour: z.number().int().min(0).max(23),
        startMinute: z.number().int().min(0).max(59),
        endHour: z.number().int().min(0).max(23),
        endMinute: z.number().int().min(0).max(59),
      }),
    )
    .default([]),
  holidays: z.array(z.string()).default([]),
  maxRows: z.number().int().min(50).max(5000).default(1000),
});

export type LoadEnrichedInput = z.infer<typeof InputSchema>;

export interface LoadEnrichedResult {
  base: string;
  quality: QualityReport;
  count: number;
  candles: EnrichedCandle[];
  summary: {
    firstTs: number | null;
    lastTs: number | null;
    sessions: Record<string, number>;
    avgAtr: number | null;
    avgAdx: number | null;
    bosCount: number;
    chochCount: number;
    mssCount: number;
  };
}

export const loadEnrichedCandles = createServerFn({ method: "POST" })
  .inputValidator((raw) => InputSchema.parse(raw))
  .handler(async ({ data }): Promise<LoadEnrichedResult> => {
    const { loadRawCandles } = await import("@/lib/market-data/loader.server");
    const { candles, base, quality } = await loadRawCandles({
      source: data.source,
      symbol: data.symbol,
      timeframe: data.timeframe,
      fromMs: data.fromMs,
      toMs: data.toMs,
    });
    const cfg = {
      ...DEFAULT_CONFIG,
      symbol: data.symbol,
      timeframe: data.timeframe,
      displayTimezone: data.displayTimezone,
      strategyTimezone: data.strategyTimezone,
      atrLen: data.atrLen,
      swingLookback: data.swingLookback,
      openingRangeMinutes: data.openingRangeMinutes,
      openingRangeSessionStart: {
        hour: data.openingRangeStartHour,
        minute: data.openingRangeStartMinute,
      },
      customSessions: data.customSessions,
      holidays: data.holidays,
      newsTimestamps: [],
    };
    const enriched = enrichCandles(candles, cfg);
    // Summary
    const sessions: Record<string, number> = {};
    let atrSum = 0, atrN = 0, adxSum = 0, adxN = 0, bos = 0, choch = 0, mss = 0;
    for (const b of enriched) {
      sessions[b.session] = (sessions[b.session] ?? 0) + 1;
      if (b.atr !== null) { atrSum += b.atr; atrN++; }
      if (b.adx !== null) { adxSum += b.adx; adxN++; }
      if (b.bos) bos++;
      if (b.choch) choch++;
      if (b.mss) mss++;
    }
    // Trim payload — only send the last `maxRows` bars over the wire.
    const trimmed = enriched.slice(-data.maxRows);
    return {
      base,
      quality,
      count: enriched.length,
      candles: trimmed,
      summary: {
        firstTs: enriched[0]?.ts ?? null,
        lastTs: enriched[enriched.length - 1]?.ts ?? null,
        sessions,
        avgAtr: atrN ? atrSum / atrN : null,
        avgAdx: adxN ? adxSum / adxN : null,
        bosCount: bos, chochCount: choch, mssCount: mss,
      },
    };
  });
