// Performance analysis: best/worst period, session, direction, regime.
// Every insight is derived from a real slice with sample size + delta.

import type { DerivedFeatures } from "./features-ext";
import type { Insight } from "./types";
import { mean, sum } from "./stats";

interface Slice { key: string; rows: DerivedFeatures[]; net: number; win: number; count: number }

function groupBy(rows: DerivedFeatures[], keyFn: (r: DerivedFeatures) => string): Slice[] {
  const map = new Map<string, DerivedFeatures[]>();
  for (const r of rows) {
    const k = keyFn(r);
    const arr = map.get(k) ?? [];
    arr.push(r);
    map.set(k, arr);
  }
  return Array.from(map.entries()).map(([key, rs]) => ({
    key, rows: rs, count: rs.length,
    net: sum(rs.map((r) => r.netPnl)),
    win: rs.length ? rs.filter((r) => r.win).length / rs.length : 0,
  }));
}

function rank(slices: Slice[], minN = 5): { best: Slice | null; worst: Slice | null } {
  const eligible = slices.filter((s) => s.count >= minN);
  if (!eligible.length) return { best: null, worst: null };
  const sorted = [...eligible].sort((a, b) => b.net - a.net);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WEEKDAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export function performanceInsights(features: DerivedFeatures[]): Insight[] {
  if (features.length < 10) return [];
  const out: Insight[] = [];
  const baselineNet = sum(features.map((r) => r.netPnl));
  const baselineWin = mean(features.map((r) => r.win));

  const emit = (
    kind: "month" | "weekday" | "hour" | "session" | "regime" | "direction",
    label: string,
    slice: Slice,
    positive: boolean,
  ) => {
    const share = baselineNet !== 0 ? (slice.net / baselineNet) * 100 : 0;
    out.push({
      id: `perf-${kind}-${slice.key}-${positive ? "best" : "worst"}`,
      kind: "performance",
      severity: positive ? "positive" : "warning",
      title: `${positive ? "Best" : "Worst"} ${label}: ${slice.key}`,
      summary: `${slice.count} trades, net ${slice.net.toFixed(2)} (${share.toFixed(0)}% of total), win rate ${(slice.win * 100).toFixed(1)}%.`,
      evidence: {
        sampleSize: slice.count,
        metric: "net_pnl",
        metricValue: slice.net,
        baselineValue: baselineNet / Math.max(1, features.length) * slice.count,
        delta: slice.win - baselineWin,
      },
      tags: [kind, slice.key],
    });
  };

  const m = rank(groupBy(features, (r) => MONTH_NAMES[r.month - 1] ?? String(r.month)));
  if (m.best) emit("month", "month", m.best, true);
  if (m.worst && m.worst.net < 0) emit("month", "month", m.worst, false);

  const w = rank(groupBy(features, (r) => WEEKDAY_NAMES[r.weekday] ?? String(r.weekday)));
  if (w.best) emit("weekday", "weekday", w.best, true);
  if (w.worst && w.worst.net < 0) emit("weekday", "weekday", w.worst, false);

  const h = rank(groupBy(features, (r) => `${String(r.hourUtc).padStart(2, "0")}:00 UTC`), 8);
  if (h.best) emit("hour", "hour", h.best, true);
  if (h.worst && h.worst.net < 0) emit("hour", "hour", h.worst, false);

  const s = rank(groupBy(features, (r) => r.session));
  if (s.best) emit("session", "session", s.best, true);
  if (s.worst && s.worst.net < 0) emit("session", "session", s.worst, false);

  const r = rank(groupBy(features, (r) => r.regime));
  if (r.best) emit("regime", "regime", r.best, true);
  if (r.worst && r.worst.net < 0) emit("regime", "regime", r.worst, false);

  const dir = rank(groupBy(features, (r) => r.direction));
  if (dir.best) emit("direction", "direction", dir.best, true);
  if (dir.worst && dir.worst.net < dir.best!.net && dir.worst.count >= 5)
    emit("direction", "direction", dir.worst, false);

  return out;
}
