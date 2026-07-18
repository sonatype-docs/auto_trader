// K-means clustering on standardized numeric features → compare cluster P&L.

import type { DerivedFeatures } from "./features-ext";
import type { Insight } from "./types";
import { mean, std } from "./stats";

const DIMS: Array<keyof DerivedFeatures> = ["hourUtc", "atr", "volumeZ", "bodyPct", "mae", "mfe", "holdingMs"];

interface Cluster { id: number; count: number; net: number; win: number; expectancy: number; centroid: number[]; topDims: string[] }

function standardize(features: DerivedFeatures[]): { X: number[][]; means: number[]; stds: number[] } {
  const cols = DIMS.map((d) => features.map((r) => Number(r[d]) || 0));
  const means = cols.map(mean);
  const stds = cols.map(std).map((s) => s || 1);
  const X = features.map((_, i) => cols.map((col, c) => (col[i] - means[c]) / stds[c]));
  return { X, means, stds };
}

function kmeans(X: number[][], k: number, iters = 30): number[] {
  if (!X.length) return [];
  const n = X.length, d = X[0].length;
  const centroids: number[][] = Array.from({ length: k }, (_, i) => X[Math.floor((i * n) / k)].slice());
  const labels = new Array<number>(n).fill(0);
  for (let iter = 0; iter < iters; iter++) {
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        let s = 0;
        for (let j = 0; j < d; j++) { const dv = X[i][j] - centroids[c][j]; s += dv * dv; }
        if (s < bestD) { bestD = s; best = c; }
      }
      labels[i] = best;
    }
    const sums = Array.from({ length: k }, () => new Array<number>(d).fill(0));
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      counts[labels[i]]++;
      for (let j = 0; j < d; j++) sums[labels[i]][j] += X[i][j];
    }
    for (let c = 0; c < k; c++) if (counts[c]) for (let j = 0; j < d; j++) centroids[c][j] = sums[c][j] / counts[c];
  }
  return labels;
}

export function clusterTrades(features: DerivedFeatures[], k = 4): Cluster[] {
  if (features.length < k * 5) return [];
  const { X } = standardize(features);
  const labels = kmeans(X, k);
  const clusters: Cluster[] = [];
  for (let c = 0; c < k; c++) {
    const rows = features.filter((_, i) => labels[i] === c);
    if (!rows.length) continue;
    const centroid = DIMS.map((d) => mean(rows.map((r) => Number(r[d]) || 0)));
    const topDims = DIMS
      .map((d, i) => ({ d: String(d), v: Math.abs((centroid[i] - mean(features.map((f) => Number(f[d]) || 0))) / (std(features.map((f) => Number(f[d]) || 0)) || 1)) }))
      .sort((a, b) => b.v - a.v).slice(0, 3).map((x) => x.d);
    clusters.push({
      id: c, count: rows.length,
      net: rows.reduce((s, r) => s + r.netPnl, 0),
      win: rows.length ? rows.filter((r) => r.win).length / rows.length : 0,
      expectancy: mean(rows.map((r) => r.netPnl)),
      centroid, topDims,
    });
  }
  return clusters.sort((a, b) => b.expectancy - a.expectancy);
}

export function clusterInsights(features: DerivedFeatures[]): Insight[] {
  const clusters = clusterTrades(features, 4);
  if (clusters.length < 2) return [];
  return clusters.map((c, i) => ({
    id: `cluster-${c.id}`,
    kind: "cluster",
    severity: c.expectancy > 0 ? "positive" : "warning",
    title: `Cluster ${i + 1} (n=${c.count}) expectancy ${c.expectancy.toFixed(2)}`,
    summary: `Win ${(c.win * 100).toFixed(1)}%, net ${c.net.toFixed(2)}. Dominated by: ${c.topDims.join(", ")}.`,
    evidence: { sampleSize: c.count, metric: "expectancy", metricValue: c.expectancy },
    tags: ["cluster", ...c.topDims],
  }));
}
