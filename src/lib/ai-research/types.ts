// AI Research — shared types.
// Every insight/recommendation MUST carry evidence: sample size, statistic,
// and (where applicable) a p-value or confidence estimate. The UI refuses to
// display insights without evidence.

export type InsightKind =
  | "performance"
  | "failure"
  | "edge"
  | "filter"
  | "feature"
  | "regime"
  | "cluster"
  | "anomaly"
  | "pattern"
  | "correlation"
  | "walk_forward"
  | "monte_carlo"
  | "comparison"
  | "trade_review";

export type Severity = "info" | "positive" | "warning" | "critical";

export interface Evidence {
  sampleSize: number;
  metric?: string;
  metricValue?: number;
  baselineValue?: number;
  delta?: number;
  pValue?: number | null;
  confidence?: number; // 0..1
  supportingTradeIds?: string[];
}

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: Severity;
  title: string;
  summary: string;
  evidence: Evidence;
  tags?: string[];
}

export interface Recommendation extends Insight {
  action: string;         // e.g. "Exclude Friday trades", "Reduce SL to 1.2 ATR"
  expectedImpact?: string;
}
