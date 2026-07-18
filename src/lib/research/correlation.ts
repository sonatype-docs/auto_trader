// Correlation matrix (Pearson).
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

export interface CorrMatrix { keys: string[]; matrix: number[][] }

export function correlationMatrix(cols: Record<string, number[]>): CorrMatrix {
  const keys = Object.keys(cols);
  const matrix = keys.map((a) => keys.map((b) => pearson(cols[a], cols[b])));
  return { keys, matrix };
}
