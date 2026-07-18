// Universal Research Optimizer — public types.
// Strategy-agnostic. Operates over TradeRecord[] from the Trade Intelligence DB.
import type { TradeRecord } from "@/lib/trade-intelligence/types";

export type ObjectiveKey =
  | "net_profit"
  | "profit_factor"
  | "expectancy"
  | "sharpe"
  | "sortino"
  | "calmar"
  | "recovery_factor"
  | "max_drawdown_neg"
  | "win_rate"
  | "avg_rr"
  | "risk_adjusted_return"
  | "ulcer_index_neg"
  | "custom";

export interface ObjectiveSpec {
  key: ObjectiveKey;
  // custom formula referencing objective results: `${key}` variables
  // e.g. "net_profit / (max_drawdown + 1)"
  formula?: string;
  minTrades?: number; // gate — reject candidates with fewer trades
}

export type SearchMethod =
  | "grid"
  | "random"
  | "genetic"
  | "bayesian"
  | "pso"
  | "annealing";

export interface NumericDim {
  kind: "numeric";
  id: string;
  label: string;
  min: number;
  max: number;
  step?: number;
}
export interface CategoricalDim {
  kind: "categorical";
  id: string;
  label: string;
  values: (string | number | boolean)[];
}
export type ParamDim = NumericDim | CategoricalDim;

// A candidate = concrete assignment of every dimension.
export type Candidate = Record<string, number | string | boolean>;

// A filter predicate: given a TradeRecord, does it pass?
export type Predicate = (t: TradeRecord) => boolean;

export interface EvaluatedCandidate {
  id: string;
  candidate: Candidate;
  trades: number;
  score: number;               // objective score
  metrics: Record<string, number>;
}

export interface OptimizationResult {
  method: SearchMethod;
  objective: ObjectiveSpec;
  evaluated: number;
  best: EvaluatedCandidate | null;
  top: EvaluatedCandidate[];  // sorted desc
  elapsedMs: number;
}
