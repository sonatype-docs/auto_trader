// Heatmap engine — bucket trades on two dimensions and compute any metric.
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { extractFeatures } from "./dimensions";
import { computeMetrics, type Metrics } from "./objectives";

export type HeatmapMetric = keyof Metrics;

export interface HeatmapCell {
  x: string; y: string; value: number; trades: number;
}
export interface HeatmapResult {
  xLabels: string[];
  yLabels: string[];
  cells: HeatmapCell[];
  min: number; max: number;
}

function bucketOf(value: string | number, kind: "num" | "cat", bins?: number[]): string {
  if (kind === "cat") return String(value);
  const n = Number(value);
  if (!bins || bins.length === 0) return String(n);
  for (let i = 0; i < bins.length - 1; i++) {
    if (n >= bins[i] && n < bins[i + 1]) return `${bins[i]}-${bins[i + 1]}`;
  }
  return `${bins[bins.length - 1]}+`;
}

export function buildHeatmap(
  rows: TradeRecord[],
  xDim: string,
  yDim: string,
  metric: HeatmapMetric = "net_profit",
  xBins?: number[],
  yBins?: number[],
): HeatmapResult {
  const fv = rows.map(extractFeatures);
  const grid = new Map<string, TradeRecord[]>();
  const xSet = new Set<string>(), ySet = new Set<string>();
  rows.forEach((r, i) => {
    const xv = fv[i].numeric[xDim] ?? fv[i].categorical[xDim];
    const yv = fv[i].numeric[yDim] ?? fv[i].categorical[yDim];
    if (xv === undefined || yv === undefined) return;
    const xKind: "num" | "cat" = fv[i].numeric[xDim] !== undefined ? "num" : "cat";
    const yKind: "num" | "cat" = fv[i].numeric[yDim] !== undefined ? "num" : "cat";
    const xKey = bucketOf(xv, xKind, xBins);
    const yKey = bucketOf(yv, yKind, yBins);
    xSet.add(xKey); ySet.add(yKey);
    const k = `${xKey}::${yKey}`;
    const arr = grid.get(k) ?? []; arr.push(r); grid.set(k, arr);
  });
  const cells: HeatmapCell[] = [];
  let min = Infinity, max = -Infinity;
  for (const [k, arr] of grid) {
    const [x, y] = k.split("::");
    const m = computeMetrics(arr);
    const v = Number(m[metric]);
    cells.push({ x, y, value: v, trades: arr.length });
    if (v < min) min = v; if (v > max) max = v;
  }
  return {
    xLabels: Array.from(xSet).sort(),
    yLabels: Array.from(ySet).sort(),
    cells, min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0,
  };
}
