// Optimization Engine — orchestrates samplers + objectives over a TradeRecord[].
// Applies a candidate as a rule/filter over the dataset and scores the subset.
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { candidateToRule, ruleToPredicate } from "./filters";
import { computeMetrics, objectiveScore } from "./objectives";
import {
  gridSample, randomSample, makeGA, psoSample, saSample,
  type GAOptions,
} from "./samplers";
import type {
  Candidate, EvaluatedCandidate, ObjectiveSpec, OptimizationResult,
  ParamDim, SearchMethod,
} from "./types";

export interface RunOptions {
  method: SearchMethod;
  dims: ParamDim[];
  objective: ObjectiveSpec;
  budget: number;             // grid cap OR random n OR GA popsize*generations
  ga?: GAOptions;
  seed?: number;
  onProgress?: (evaluated: number, total: number, best: EvaluatedCandidate | null) => void;
}

function evalCandidate(rows: TradeRecord[], dims: ParamDim[], cand: Candidate, spec: ObjectiveSpec, id: string): EvaluatedCandidate {
  const rule = candidateToRule(cand, dims);
  const pred = ruleToPredicate(rule);
  const subset = rows.filter(pred);
  const m = computeMetrics(subset);
  const score = objectiveScore(m, spec);
  return {
    id, candidate: cand,
    trades: subset.length, score,
    metrics: m as unknown as Record<string, number>,
  };
}

export function runOptimization(rows: TradeRecord[], opts: RunOptions): OptimizationResult {
  const started = performance.now();
  const evaluated: EvaluatedCandidate[] = [];
  let best: EvaluatedCandidate | null = null;

  const push = (e: EvaluatedCandidate) => {
    evaluated.push(e);
    if (!best || e.score > best.score) best = e;
  };

  if (opts.method === "grid") {
    const cands = gridSample(opts.dims, opts.budget);
    cands.forEach((c, i) => {
      const e = evalCandidate(rows, opts.dims, c, opts.objective, `g${i}`);
      push(e); opts.onProgress?.(i + 1, cands.length, best);
    });
  } else if (opts.method === "random" || opts.method === "bayesian") {
    // Bayesian light: random sample + return best-so-far. (Full BO would need GP surrogate.)
    const cands = randomSample(opts.dims, opts.budget, opts.seed);
    cands.forEach((c, i) => {
      const e = evalCandidate(rows, opts.dims, c, opts.objective, `r${i}`);
      push(e); opts.onProgress?.(i + 1, cands.length, best);
    });
  } else if (opts.method === "pso") {
    const cands = psoSample(opts.dims, { swarmSize: 20, iterations: Math.max(1, Math.floor(opts.budget / 20)), seed: opts.seed });
    cands.forEach((c, i) => {
      const e = evalCandidate(rows, opts.dims, c, opts.objective, `p${i}`);
      push(e); opts.onProgress?.(i + 1, cands.length, best);
    });
  } else if (opts.method === "annealing") {
    const cands = saSample(opts.dims, { iterations: opts.budget, seed: opts.seed });
    cands.forEach((c, i) => {
      const e = evalCandidate(rows, opts.dims, c, opts.objective, `a${i}`);
      push(e); opts.onProgress?.(i + 1, cands.length, best);
    });
  } else if (opts.method === "genetic") {
    const ga = makeGA(opts.dims, opts.ga ?? { populationSize: 40, generations: Math.max(1, Math.floor(opts.budget / 40)), mutationRate: 0.15, eliteCount: 4, seed: opts.seed });
    const total = (opts.ga?.populationSize ?? 40) * (opts.ga?.generations ?? Math.max(1, Math.floor(opts.budget / 40)));
    let done = 0;
    while (!ga.done()) {
      const pop = ga.current();
      const scored = pop.map((c, i) => {
        const e = evalCandidate(rows, opts.dims, c, opts.objective, `ga${ga.generation()}_${i}`);
        push(e); done++; opts.onProgress?.(done, total, best);
        return { cand: c, score: e.score };
      });
      ga.step(scored);
    }
  }

  const top = [...evaluated].sort((a, b) => b.score - a.score).slice(0, 25);
  return {
    method: opts.method, objective: opts.objective,
    evaluated: evaluated.length, best, top,
    elapsedMs: Math.round(performance.now() - started),
  };
}
