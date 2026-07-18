// Serializer / Exporter — turn TradeRecord[] into JSON / CSV strings.
// Parquet & SQLite are pluggable: format registry pattern below.
import type { TradeRecord } from "./types";

export type ExportFormat = "json" | "csv";

function flattenValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v).replace(/"/g, '""');
  const s = String(v);
  return s.replace(/"/g, '""');
}

const CORE_COLUMNS: (keyof TradeRecord)[] = [
  "tradeId", "strategyId", "strategyVersion", "symbol", "timeframe",
  "direction", "tradeType", "entryType", "stopType", "targetType", "status",
  "session", "signalTime", "orderTime", "fillTime", "entryTime", "exitTime",
  "weekday", "weekNumber", "month", "quarter", "year",
  "entryPrice", "fillPrice", "exitPrice", "stopPrice", "targetPrice",
  "positionSize", "riskUsd", "riskPct", "actualRr",
  "grossPnl", "netPnl", "pnlPct", "pnlR",
  "mae", "mfe", "fees", "commission", "slippage", "spreadCost",
  "holdingBars", "durationMs", "exitReason",
];

const JSON_COLUMNS: (keyof TradeRecord)[] = [
  "price", "risk", "performance", "duration", "volatility", "trend",
  "structure", "liquidity", "smartMoney", "volumeProfile", "breakout",
  "entryQuality", "stop", "target", "filters", "news", "regime", "custom",
  "tags", "raw",
];

export function toCSV(rows: TradeRecord[]): string {
  const columns = [...CORE_COLUMNS, ...JSON_COLUMNS];
  const header = columns.join(",");
  const lines = rows.map((r) =>
    columns.map((c) => `"${flattenValue(r[c] as unknown)}"`).join(","),
  );
  return [header, ...lines].join("\n");
}

export function toJSON(rows: TradeRecord[]): string {
  return JSON.stringify(rows, null, 2);
}

export function exportRecords(rows: TradeRecord[], format: ExportFormat): {
  filename: string; mime: string; body: string;
} {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (format === "csv") {
    return { filename: `trades-${stamp}.csv`, mime: "text/csv", body: toCSV(rows) };
  }
  return { filename: `trades-${stamp}.json`, mime: "application/json", body: toJSON(rows) };
}
