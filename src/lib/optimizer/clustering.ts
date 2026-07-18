// K-means clustering on standardized numeric feature vectors.
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { extractFeatures, allNumericKeys } from "./dimensions";
import { computeMetrics, type Metrics } from "./objectives";

export interface Cluster {
  index: number;
  size: number;
  centroid: Record<string, number>;
  metrics: Metrics;
  members: number[]; // trade indices
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function kmeans(rows: TradeRecord[], k = 4, iters = 30, seed = 5): Cluster[] {
  if (rows.length < k) return [];
  const fv = rows.map(extractFeatures);
  const keys = allNumericKeys(fv);
  // build & standardize matrix
  const raw = fv.map((f) => keys.map((k) => Number.isFinite(f.numeric[k]) ? f.numeric[k] : 0));
  const means = keys.map((_, j) => raw.reduce((s, r) => s + r[j], 0) / raw.length);
  const stds = keys.map((_, j) => {
    const v = raw.reduce((s, r) => s + (r[j] - means[j]) ** 2, 0) / raw.length;
    return Math.sqrt(v) || 1;
  });
  const X = raw.map((r) => r.map((v, j) => (v - means[j]) / stds[j]));

  const rand = mulberry32(seed);
  const centers: number[][] = Array.from({ length: k }, () => X[Math.floor(rand() * X.length)].slice());
  const labels = new Array(X.length).fill(0);
  const dist = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);

  for (let it = 0; it < iters; it++) {
    // assign
    for (let i = 0; i < X.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = dist(X[i], centers[c]); if (d < bd) { bd = d; best = c; } }
      labels[i] = best;
    }
    // update
    const sums = Array.from({ length: k }, () => new Array(keys.length).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      counts[labels[i]]++;
      for (let j = 0; j < keys.length; j++) sums[labels[i]][j] += X[i][j];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      centers[c] = sums[c].map((s) => s / counts[c]);
    }
  }
  const groups: number[][] = Array.from({ length: k }, () => []);
  labels.forEach((c, i) => groups[c].push(i));

  return groups.map((members, i) => {
    const centroid: Record<string, number> = {};
    keys.forEach((k, j) => (centroid[k] = centers[i][j] * stds[j] + means[j]));
    return {
      index: i,
      size: members.length,
      centroid,
      metrics: computeMetrics(members.map((idx) => rows[idx])),
      members,
    };
  });
}
