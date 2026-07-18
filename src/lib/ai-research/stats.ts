// Basic statistical primitives used across the AI research modules.
// All pure, no dependencies.

export function mean(xs: number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}
export function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (xs.length - 1);
}
export function std(xs: number[]): number { return Math.sqrt(variance(xs)); }
export function sum(xs: number[]): number { let s = 0; for (const x of xs) s += x; return s; }

/** Welch two-sample t-test → approximate two-tailed p-value using normal CDF. */
export function welchT(a: number[], b: number[]): { t: number; p: number } {
  if (a.length < 2 || b.length < 2) return { t: 0, p: 1 };
  const ma = mean(a), mb = mean(b);
  const va = variance(a), vb = variance(b);
  const se = Math.sqrt(va / a.length + vb / b.length);
  if (se <= 0) return { t: 0, p: 1 };
  const t = (ma - mb) / se;
  // Two-tailed normal approx (good enough for n>=20).
  const z = Math.abs(t);
  const p = 2 * (1 - normCdf(z));
  return { t, p: Math.max(0, Math.min(1, p)) };
}

/** Two-proportion z-test on win rates. */
export function propZ(w1: number, n1: number, w2: number, n2: number): { z: number; p: number } {
  if (n1 < 5 || n2 < 5) return { z: 0, p: 1 };
  const p1 = w1 / n1, p2 = w2 / n2;
  const p = (w1 + w2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se <= 0) return { z: 0, p: 1 };
  const z = (p1 - p2) / se;
  const pval = 2 * (1 - normCdf(Math.abs(z)));
  return { z, p: Math.max(0, Math.min(1, pval)) };
}

export function normCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26 approximation.
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx <= 0 || dy <= 0) return 0;
  return num / Math.sqrt(dx * dy);
}

export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))));
  return s[i];
}

export function zScore(x: number, xs: number[]): number {
  const m = mean(xs), s = std(xs);
  return s > 0 ? (x - m) / s : 0;
}
