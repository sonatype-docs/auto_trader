// Walk-forward engine — split trades chronologically, optimize on train,
// score on test. Reports segment-by-segment results.
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { computeMetrics, objectiveScore } from "./objectives";
import type { ObjectiveSpec, Predicate } from "./types";

export interface WalkForwardSegment {
  index: number;
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  trainScore: number;
  testScore: number;
  trainTrades: number;
  testTrades: number;
}

export function walkForward(
  rows: TradeRecord[],
  optimize: (train: TradeRecord[]) => Predicate,
  objective: ObjectiveSpec,
  folds = 4,
): WalkForwardSegment[] {
  const sorted = [...rows].sort((a, b) => a.exitTime - b.exitTime);
  if (sorted.length < folds * 4) return [];
  const size = Math.floor(sorted.length / (folds + 1));
  const out: WalkForwardSegment[] = [];
  for (let i = 0; i < folds; i++) {
    const trainEnd = (i + 1) * size;
    const testEnd = Math.min(sorted.length, trainEnd + size);
    const train = sorted.slice(0, trainEnd);
    const test = sorted.slice(trainEnd, testEnd);
    if (test.length === 0) break;
    const pred = optimize(train);
    const trainFilt = train.filter(pred);
    const testFilt = test.filter(pred);
    out.push({
      index: i + 1,
      trainStart: train[0].exitTime,
      trainEnd: train[train.length - 1].exitTime,
      testStart: test[0].exitTime,
      testEnd: test[test.length - 1].exitTime,
      trainScore: objectiveScore(computeMetrics(trainFilt), objective),
      testScore: objectiveScore(computeMetrics(testFilt), objective),
      trainTrades: trainFilt.length,
      testTrades: testFilt.length,
    });
  }
  return out;
}
