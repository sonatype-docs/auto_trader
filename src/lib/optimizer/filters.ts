// Filter predicate builder — turns a Candidate (dim assignment) into a
// TradeRecord predicate. Also exposes helpers used by discovery/clustering.
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { extractFeatures } from "./dimensions";
import type { Candidate, ParamDim, Predicate } from "./types";

export interface RuleLeaf {
  dim: string;
  op: "in" | "gte" | "lte" | "between";
  value: number | string | boolean | [number, number] | Array<string | number | boolean>;
}
export interface Rule { leaves: RuleLeaf[] }

export function ruleToPredicate(rule: Rule): Predicate {
  return (t: TradeRecord) => {
    const fv = extractFeatures(t);
    for (const leaf of rule.leaves) {
      const num = fv.numeric[leaf.dim];
      const cat = fv.categorical[leaf.dim];
      switch (leaf.op) {
        case "gte": if (!(num >= (leaf.value as number))) return false; break;
        case "lte": if (!(num <= (leaf.value as number))) return false; break;
        case "between": {
          const [lo, hi] = leaf.value as [number, number];
          if (!(num >= lo && num <= hi)) return false; break;
        }
        case "in": {
          const arr = Array.isArray(leaf.value) ? leaf.value : [leaf.value];
          const key = cat !== undefined ? cat : num;
          if (!arr.map(String).includes(String(key))) return false; break;
        }
      }
    }
    return true;
  };
}

export function candidateToRule(cand: Candidate, dims: ParamDim[]): Rule {
  const leaves: RuleLeaf[] = [];
  for (const d of dims) {
    const v = cand[d.id];
    if (v === undefined || v === "*") continue;
    if (d.kind === "numeric") {
      // encode numeric candidate as gte threshold. Callers wanting a range
      // can pair two numeric dims (min_x, max_x) and post-process.
      leaves.push({ dim: d.id, op: "gte", value: Number(v) });
    } else {
      leaves.push({ dim: d.id, op: "in", value: v });
    }
  }
  return { leaves };
}
