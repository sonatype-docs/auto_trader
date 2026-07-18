// Histograms & bucketing helpers.
export interface HistBin { x0: number; x1: number; label: string; count: number }

export function histogram(values: number[], bins = 20): HistBin[] {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return [];
  const min = Math.min(...clean), max = Math.max(...clean);
  if (min === max) return [{ x0: min, x1: max, label: min.toFixed(2), count: clean.length }];
  const step = (max - min) / bins;
  const out: HistBin[] = Array.from({ length: bins }, (_, i) => {
    const x0 = min + i * step; const x1 = x0 + step;
    return { x0, x1, label: `${x0.toFixed(1)}–${x1.toFixed(1)}`, count: 0 };
  });
  for (const v of clean) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / step)));
    out[idx].count++;
  }
  return out;
}

export function quantile(values: number[], q: number): number {
  const s = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return 0;
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}
