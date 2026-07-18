// Server-only data loader — pulls raw klines via the existing kline source
// router, resamples if the requested timeframe is not native, and returns
// clean RawCandle[]. Never bundled into the client.
import { getKlineSource, type KlineSourceId } from "@/lib/exchange/kline-source.server";
import { resample } from "./resample";
import { runQualityChecks, type QualityReport } from "./quality";
import { TIMEFRAME_MS, type RawCandle, type Timeframe } from "./types";

const NATIVE_SHARK = new Set<Timeframe>(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);

function pickBase(target: Timeframe): Timeframe {
  if (NATIVE_SHARK.has(target)) return target;
  // For odd intraday TFs, fetch the largest native TF that divides into target.
  const targetMs = TIMEFRAME_MS[target];
  const candidates: Timeframe[] = ["1h", "30m", "15m", "5m", "1m"];
  for (const c of candidates) {
    if (targetMs % TIMEFRAME_MS[c] === 0) return c;
  }
  return "1m";
}

export async function loadRawCandles(opts: {
  source: KlineSourceId;
  symbol: string;
  timeframe: Timeframe;
  fromMs: number;
  toMs: number;
}): Promise<{ candles: RawCandle[]; base: Timeframe; quality: QualityReport }> {
  const base = pickBase(opts.timeframe);
  const src = await getKlineSource(opts.source);
  const raw = await src.getKlinesRange(opts.symbol, base, opts.fromMs, opts.toMs);
  const baseCandles: RawCandle[] = raw.map((k) => ({
    ts: k.openTime,
    open: k.open, high: k.high, low: k.low, close: k.close,
    volume: k.volume,
  }));
  const candles = base === opts.timeframe ? baseCandles : resample(baseCandles, opts.timeframe);
  const quality = runQualityChecks(candles, opts.timeframe);
  return { candles, base, quality };
}
