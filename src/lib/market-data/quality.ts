// Data quality checks — run before enrichment.
import { TIMEFRAME_MS, type RawCandle, type Timeframe } from "./types";

export interface QualityIssue {
  index: number;
  ts: number;
  kind:
    | "missing_gap"
    | "duplicate"
    | "bad_ohlc"
    | "negative_price"
    | "corrupted"
    | "weekend_gap"
    | "missing_volume";
  detail?: string;
}

export interface QualityReport {
  total: number;
  issues: QualityIssue[];
  countsByKind: Record<QualityIssue["kind"], number>;
  gapCandles: number; // implied missing bars
}

export function runQualityChecks(candles: RawCandle[], tf: Timeframe): QualityReport {
  const issues: QualityIssue[] = [];
  const step = TIMEFRAME_MS[tf];
  let gapCandles = 0;
  const seen = new Set<number>();
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (seen.has(c.ts)) issues.push({ index: i, ts: c.ts, kind: "duplicate" });
    else seen.add(c.ts);
    if (c.open <= 0 || c.close <= 0 || c.high <= 0 || c.low <= 0) {
      issues.push({ index: i, ts: c.ts, kind: "negative_price" });
    }
    const badOhlc =
      c.high < Math.max(c.open, c.close) - 1e-9 ||
      c.low > Math.min(c.open, c.close) + 1e-9 ||
      c.high < c.low;
    if (badOhlc) issues.push({ index: i, ts: c.ts, kind: "bad_ohlc" });
    if (!Number.isFinite(c.open + c.high + c.low + c.close)) {
      issues.push({ index: i, ts: c.ts, kind: "corrupted" });
    }
    if (c.volume === 0) issues.push({ index: i, ts: c.ts, kind: "missing_volume" });
    if (i > 0) {
      const gap = c.ts - candles[i - 1].ts;
      if (gap > step * 1.5) {
        const missed = Math.floor(gap / step) - 1;
        gapCandles += missed;
        const d = new Date(candles[i - 1].ts).getUTCDay();
        const kind: QualityIssue["kind"] = d === 5 || d === 6 ? "weekend_gap" : "missing_gap";
        issues.push({ index: i, ts: c.ts, kind, detail: `${missed} bars missing` });
      }
    }
  }
  const counts: Record<QualityIssue["kind"], number> = {
    missing_gap: 0, duplicate: 0, bad_ohlc: 0, negative_price: 0,
    corrupted: 0, weekend_gap: 0, missing_volume: 0,
  };
  for (const i of issues) counts[i.kind]++;
  return { total: candles.length, issues, countsByKind: counts, gapCandles };
}
