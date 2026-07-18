/**
 * Data-source router for historical klines.
 *
 * "shark"  — SharkExchange (live perp, ~180d 1h max, requires API keys)
 * "yahoo"  — Yahoo Finance GC=F/BTC-USD (public, no key, ~730d 1h)
 *
 * Any strategy path that only needs OHLC history (backtests, optimizer)
 * should go through this instead of instantiating a client directly, so
 * the user can toggle the source per run.
 */

import type { Kline } from "@/lib/exchange/shark-client.server";

export type KlineSourceId = "shark" | "yahoo";

export interface KlineSource {
  id: KlineSourceId;
  label: string;
  getKlinesRange(
    symbol: string,
    interval: string,
    fromMs: number,
    toMs: number,
  ): Promise<Kline[]>;
  getKlines(
    symbol: string,
    interval?: string,
    limit?: number,
    opts?: { startTime?: number; endTime?: number },
  ): Promise<Kline[]>;
}

export async function getKlineSource(id: KlineSourceId = "shark"): Promise<KlineSource> {
  if (id === "yahoo") {
    const { createYahooClient } = await import("@/lib/exchange/yahoo-client.server");
    const c = createYahooClient();
    return {
      id: "yahoo",
      label: "Yahoo Finance (GC=F)",
      getKlinesRange: c.getKlinesRange.bind(c),
      getKlines: c.getKlines.bind(c),
    };
  }
  const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
  const c = createSharkClient();
  return {
    id: "shark",
    label: "SharkExchange (XAUUSDT)",
    getKlinesRange: c.getKlinesRange.bind(c),
    getKlines: (symbol, interval, limit, opts) =>
      c.getKlines(symbol, interval, limit, opts),
  };
}
