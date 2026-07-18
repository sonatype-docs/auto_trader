// Day-of-Week analytics + weekend-skip comparison.

import type { DerivedFeatures } from "./features-ext";
import type { Insight } from "./types";
import { mean } from "./stats";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface DayRow {
  weekday: number;
  name: string;
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  expectancy: number;
  avgR: number;
  maxDrawdown: number;
  profitFactor: number;
}

export interface StatBlock {
  label: string;
  count: number;
  wins: number;
  winRate: number;
  netPnl: number;
  expectancy: number;
  avgR: number;
  profitFactor: number;
  maxDrawdown: number;
}

export interface WeekendComparison {
  all: StatBlock;
  weekdaysOnly: StatBlock;
  weekendOnly: StatBlock;
  deltaNet: number;
  deltaWinRate: number;
  deltaExpectancy: number;
  verdict: "skip_weekends" | "keep_weekends" | "neutral";
  reason: string;
}

function maxDD(rows: DerivedFeatures[]): number {
  const sorted = [...rows].sort((a, b) => a.tradeId.localeCompare(b.tradeId)); // stable-ish
  let cum = 0, peak = 0, dd = 0;
  for (const r of sorted) {
    cum += r.netPnl;
    if (cum > peak) peak = cum;
    const d = peak - cum;
    if (d > dd) dd = d;
  }
  return dd;
}

function statsOf(rows: DerivedFeatures[], label: string): StatBlock {
  const wins = rows.filter((r) => r.win).length;
  const net = rows.reduce((s, r) => s + r.netPnl, 0);
  const winsSum = rows.filter((r) => r.win).reduce((s, r) => s + r.netPnl, 0);
  const lossSum = Math.abs(rows.filter((r) => !r.win).reduce((s, r) => s + r.netPnl, 0));
  return {
    label,
    count: rows.length,
    wins,
    winRate: rows.length ? wins / rows.length : 0,
    netPnl: net,
    expectancy: rows.length ? net / rows.length : 0,
    avgR: mean(rows.map((r) => r.rr)),
    profitFactor: lossSum > 0 ? winsSum / lossSum : winsSum > 0 ? 999 : 0,
    maxDrawdown: maxDD(rows),
  };
}

export function dayOfWeekBreakdown(features: DerivedFeatures[]): DayRow[] {
  const out: DayRow[] = [];
  for (let d = 0; d < 7; d++) {
    const rows = features.filter((r) => r.weekday === d);
    const wins = rows.filter((r) => r.win).length;
    const net = rows.reduce((s, r) => s + r.netPnl, 0);
    const winsSum = rows.filter((r) => r.win).reduce((s, r) => s + r.netPnl, 0);
    const lossSum = Math.abs(rows.filter((r) => !r.win).reduce((s, r) => s + r.netPnl, 0));
    out.push({
      weekday: d,
      name: WEEKDAY_NAMES[d],
      count: rows.length,
      wins,
      losses: rows.length - wins,
      winRate: rows.length ? wins / rows.length : 0,
      netPnl: net,
      expectancy: rows.length ? net / rows.length : 0,
      avgR: mean(rows.map((r) => r.rr)),
      maxDrawdown: maxDD(rows),
      profitFactor: lossSum > 0 ? winsSum / lossSum : winsSum > 0 ? 999 : 0,
    });
  }
  // Reorder Mon-first
  return [out[1], out[2], out[3], out[4], out[5], out[6], out[0]];
}

export function weekendComparison(features: DerivedFeatures[]): WeekendComparison {
  const weekend = features.filter((r) => r.isWeekend);
  const weekdays = features.filter((r) => !r.isWeekend);
  const all = statsOf(features, "All days");
  const weekdaysOnly = statsOf(weekdays, "Weekdays only (Mon–Fri)");
  const weekendOnly = statsOf(weekend, "Weekends only (Sat–Sun)");

  const deltaNet = weekdaysOnly.netPnl - all.netPnl;
  const deltaWinRate = weekdaysOnly.winRate - all.winRate;
  const deltaExpectancy = weekdaysOnly.expectancy - all.expectancy;

  let verdict: WeekendComparison["verdict"] = "neutral";
  let reason = "Not enough weekend samples to draw a conclusion.";
  if (weekend.length >= 5) {
    if (weekendOnly.expectancy < 0 && weekdaysOnly.expectancy > weekendOnly.expectancy) {
      verdict = "skip_weekends";
      reason = `Weekend expectancy ${weekendOnly.expectancy.toFixed(2)} is negative; skipping lifts overall expectancy by ${deltaExpectancy.toFixed(2)}.`;
    } else if (weekendOnly.expectancy > all.expectancy) {
      verdict = "keep_weekends";
      reason = `Weekend trades outperform baseline (${weekendOnly.expectancy.toFixed(2)} vs ${all.expectancy.toFixed(2)}); keep them.`;
    } else {
      verdict = "neutral";
      reason = "Weekend performance is close to overall; effect is negligible.";
    }
  }
  return { all, weekdaysOnly, weekendOnly, deltaNet, deltaWinRate, deltaExpectancy, verdict, reason };
}

export function dayOfWeekInsights(features: DerivedFeatures[]): Insight[] {
  if (features.length < 15) return [];
  const out: Insight[] = [];
  const rows = dayOfWeekBreakdown(features).filter((r) => r.count >= 3);
  if (rows.length >= 2) {
    const best = [...rows].sort((a, b) => b.expectancy - a.expectancy)[0];
    const worst = [...rows].sort((a, b) => a.expectancy - b.expectancy)[0];
    out.push({
      id: `dow-best-${best.name}`,
      kind: "performance",
      severity: "positive",
      title: `Best weekday: ${best.name}`,
      summary: `${best.count} trades, ${(best.winRate * 100).toFixed(1)}% win, expectancy ${best.expectancy.toFixed(2)}, net ${best.netPnl.toFixed(2)}.`,
      evidence: { sampleSize: best.count, metric: "expectancy", metricValue: best.expectancy },
      tags: ["day_of_week", best.name],
    });
    if (worst.expectancy < 0 && worst.name !== best.name) {
      out.push({
        id: `dow-worst-${worst.name}`,
        kind: "failure",
        severity: "warning",
        title: `Worst weekday: ${worst.name}`,
        summary: `${worst.count} trades, ${(worst.winRate * 100).toFixed(1)}% win, expectancy ${worst.expectancy.toFixed(2)}, net ${worst.netPnl.toFixed(2)}.`,
        evidence: { sampleSize: worst.count, metric: "expectancy", metricValue: worst.expectancy },
        tags: ["day_of_week", worst.name],
      });
    }
  }
  const cmp = weekendComparison(features);
  if (cmp.verdict === "skip_weekends") {
    out.push({
      id: "weekend-skip",
      kind: "filter",
      severity: "warning",
      title: "Consider skipping weekend trades",
      summary: cmp.reason,
      evidence: {
        sampleSize: cmp.weekendOnly.count,
        metric: "expectancy_delta",
        metricValue: cmp.deltaExpectancy,
        baselineValue: cmp.all.expectancy,
        delta: cmp.deltaExpectancy,
      },
      tags: ["weekend", "filter"],
    });
  } else if (cmp.verdict === "keep_weekends") {
    out.push({
      id: "weekend-keep",
      kind: "edge",
      severity: "positive",
      title: "Weekend trades outperform",
      summary: cmp.reason,
      evidence: {
        sampleSize: cmp.weekendOnly.count,
        metric: "expectancy",
        metricValue: cmp.weekendOnly.expectancy,
        baselineValue: cmp.all.expectancy,
      },
      tags: ["weekend"],
    });
  }
  return out;
}
