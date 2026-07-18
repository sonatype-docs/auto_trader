// Filter/rule discovery — greedy beam search for feature slices that
// improve the objective. Returns human-readable rule chains.
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { extractFeatures, allNumericKeys, allCategoricalKeys, percentile } from "./dimensions";
import { computeMetrics, objectiveScore } from "./objectives";
import type { ObjectiveSpec } from "./types";

export interface DiscoveredRule {
  description: string;
  predicate: (t: TradeRecord) => boolean;
  score: number;
  trades: number;
  liftPct: number;    // vs baseline
}

interface Leaf {
  desc: string;
  test: (fv: ReturnType<typeof extractFeatures>) => boolean;
}

export function discoverRules(
  rows: TradeRecord[],
  objective: ObjectiveSpec,
  opts: { maxDepth?: number; beamWidth?: number; minTrades?: number } = {},
): DiscoveredRule[] {
  const maxDepth = opts.maxDepth ?? 3;
  const beam = opts.beamWidth ?? 6;
  const minTrades = opts.minTrades ?? Math.max(10, Math.floor(rows.length * 0.05));
  const fvs = rows.map(extractFeatures);

  const baseScore = objectiveScore(computeMetrics(rows), objective);

  // Build candidate leaves
  const leaves: Leaf[] = [];
  for (const key of allNumericKeys(fvs)) {
    const values = fvs.map((f) => f.numeric[key] ?? NaN);
    const p33 = percentile(values, 0.33);
    const p66 = percentile(values, 0.66);
    if (Number.isFinite(p33) && Number.isFinite(p66)) {
      leaves.push({ desc: `${key} <= ${p33.toFixed(2)}`, test: (f) => (f.numeric[key] ?? 0) <= p33 });
      leaves.push({ desc: `${key} >= ${p66.toFixed(2)}`, test: (f) => (f.numeric[key] ?? 0) >= p66 });
    }
  }
  for (const key of allCategoricalKeys(fvs)) {
    const uniq = new Set<string>();
    fvs.forEach((f) => uniq.add(f.categorical[key] ?? "unknown"));
    for (const v of uniq) {
      if (v === "unknown") continue;
      leaves.push({ desc: `${key} = ${v}`, test: (f) => (f.categorical[key] ?? "unknown") === v });
    }
  }

  interface Node {
    leaves: Leaf[];
    indices: number[];
    score: number;
  }
  let frontier: Node[] = [{ leaves: [], indices: rows.map((_, i) => i), score: baseScore }];
  const visited = new Set<string>();
  const best: Node[] = [];

  for (let depth = 0; depth < maxDepth; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      for (const leaf of leaves) {
        const key = [...node.leaves.map((l) => l.desc), leaf.desc].sort().join("|");
        if (visited.has(key)) continue; visited.add(key);
        const idx = node.indices.filter((i) => leaf.test(fvs[i]));
        if (idx.length < minTrades) continue;
        const score = objectiveScore(computeMetrics(idx.map((i) => rows[i])), objective);
        if (!Number.isFinite(score) || score <= node.score) continue;
        const n: Node = { leaves: [...node.leaves, leaf], indices: idx, score };
        next.push(n); best.push(n);
      }
    }
    if (next.length === 0) break;
    next.sort((a, b) => b.score - a.score);
    frontier = next.slice(0, beam);
  }

  return best
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((n) => ({
      description: n.leaves.map((l) => l.desc).join(" AND "),
      predicate: (t: TradeRecord) => {
        const f = extractFeatures(t);
        return n.leaves.every((l) => l.test(f));
      },
      score: n.score,
      trades: n.indices.length,
      liftPct: baseScore !== 0 ? ((n.score - baseScore) / Math.abs(baseScore)) * 100 : 0,
    }));
}
