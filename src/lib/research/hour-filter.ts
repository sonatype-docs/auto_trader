// Client-side helper: recompute a RangeBacktestResult subset filtered by
// the IST hour of the breakout (DayResult.break_hour_ist). Used to power
// the shared hour toggle across RESULTS + Research + Advanced Research.

import type { backtestRange } from "@/lib/strategy.functions";

type RangeData = Awaited<ReturnType<typeof backtestRange>>;
type DayResult = RangeData["days"][number];

export function filterDaysByHour(days: DayResult[], hour: number | null): DayResult[] {
  if (hour == null) return days;
  return days.filter((d) => (d as unknown as { break_hour_ist: number | null }).break_hour_ist === hour);
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function statFor(rows: DayResult[], bucket: string, rr: number) {
  const wins = rows.filter((d) => d.pnl_usd > 0).length;
  const losses = rows.filter((d) => d.pnl_usd <= 0).length;
  const trades = rows.length;
  const total = rows.reduce((s, d) => s + (Number.isFinite(d.pnl_usd) ? d.pnl_usd : 0), 0);
  const rs = rows.map((d) => (d as unknown as { exit_r: number | null }).exit_r ?? (d.outcome === "tp" ? rr : -1));
  return {
    bucket,
    trades,
    wins,
    losses,
    win_rate_pct: trades > 0 ? (wins / trades) * 100 : 0,
    total_pnl_usd: total,
    avg_pnl_usd: trades > 0 ? total / trades : 0,
    avg_r: rs.length > 0 ? rs.reduce((a, b) => a + b, 0) / rs.length : 0,
  };
}

function maeStats(days: DayResult[], outcome: "tp" | "sl") {
  const vals = days
    .filter((d) => d.outcome === outcome && (d as unknown as { mae_r: number | null }).mae_r != null)
    .map((d) => (d as unknown as { mae_r: number }).mae_r)
    .sort((a, b) => a - b);
  if (vals.length === 0) return null;
  const pct = (p: number) => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];
  return {
    count: vals.length,
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    p50: pct(0.5),
    p75: pct(0.75),
    p90: pct(0.9),
    p95: pct(0.95),
    max: vals[vals.length - 1],
  };
}

export function recomputeRangeDataForHour(orig: RangeData, hour: number | null): RangeData {
  if (hour == null) return orig;
  const days = filterDaysByHour(orig.days, hour);
  const rr = orig.rr;

  const daysWithSession = days.filter((d) => d.zone_high !== null).length;
  const breaks = days.filter((d) => d.break_side !== null).length;
  const triggered = days.filter((d) => d.trigger_at !== null).length;
  const tp = days.filter((d) => d.outcome === "tp").length;
  const sl = days.filter((d) => d.outcome === "sl").length;
  const openCount = days.filter((d) => d.outcome === "open").length;
  const armedNoTrigger = days.filter((d) => d.outcome === "armed_no_trigger").length;
  const decided = tp + sl;
  const winCount = days.filter((d) => (d.outcome === "tp" || d.outcome === "sl") && d.pnl_usd > 0).length;
  const winRate = decided > 0 ? (winCount / decided) * 100 : 0;
  const finitePnl = (d: DayResult) => (Number.isFinite(d.pnl_usd) ? d.pnl_usd : 0);
  const totalPnl = days.reduce((s, d) => s + finitePnl(d), 0);
  const rMultiples = days
    .filter((d) => d.outcome === "tp" || d.outcome === "sl")
    .map((d) => (d as unknown as { exit_r: number | null }).exit_r ?? (d.outcome === "tp" ? rr : -1))
    .filter((r) => Number.isFinite(r));
  const avgR = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0;
  const bestPnl = days.reduce((m, d) => Math.max(m, finitePnl(d)), 0);
  const worstPnl = days.reduce((m, d) => Math.min(m, finitePnl(d)), 0);
  const skippedDays = days.filter((d) => (d as unknown as { skipped: boolean }).skipped).length;
  const filteredCount = days.filter((d) => d.outcome === "filtered").length;

  const weekdays = ([0, 1, 2, 3, 4, 5, 6] as const).map((wd) => {
    const rows = days.filter((d) => (d as unknown as { weekday: number }).weekday === wd && (d.outcome === "tp" || d.outcome === "sl"));
    const wins = rows.filter((d) => d.pnl_usd > 0).length;
    const losses = rows.filter((d) => d.pnl_usd <= 0).length;
    const total = rows.reduce((s, d) => s + finitePnl(d), 0);
    const trades = rows.length;
    return {
      weekday: wd,
      label: WEEKDAY_LABELS[wd],
      trades,
      wins,
      losses,
      win_rate_pct: trades > 0 ? (wins / trades) * 100 : 0,
      total_pnl_usd: total,
      avg_pnl_usd: trades > 0 ? total / trades : 0,
    };
  });
  const withTrades = weekdays.filter((w) => w.trades > 0);
  const bestWd = withTrades.length ? withTrades.reduce((a, b) => (b.total_pnl_usd > a.total_pnl_usd ? b : a)) : null;
  const worstWd = withTrades.length ? withTrades.reduce((a, b) => (b.total_pnl_usd < a.total_pnl_usd ? b : a)) : null;

  const decidedRows = days.filter((d) => d.outcome === "tp" || d.outcome === "sl");
  const grossWin = decidedRows.filter((d) => d.pnl_usd > 0).reduce((s, d) => s + d.pnl_usd, 0);
  const grossLoss = Math.abs(decidedRows.filter((d) => d.pnl_usd < 0).reduce((s, d) => s + d.pnl_usd, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;
  const expectancy = decidedRows.length > 0 ? (grossWin - grossLoss) / decidedRows.length : 0;
  const winRows = decidedRows.filter((d) => d.pnl_usd > 0);
  const lossRows = decidedRows.filter((d) => d.pnl_usd < 0);
  const avgWin = winRows.length ? grossWin / winRows.length : 0;
  const avgLoss = lossRows.length ? grossLoss / lossRows.length : 0;

  const potentialFills = triggered + armedNoTrigger;
  const fillRatePct = potentialFills > 0 ? (triggered / potentialFills) * 100 : 0;
  const missRs = days
    .filter((d) => d.outcome === "armed_no_trigger" && (d as unknown as { closest_approach_r: number | null }).closest_approach_r != null)
    .map((d) => (d as unknown as { closest_approach_r: number }).closest_approach_r)
    .sort((a, b) => a - b);
  const medianMissR = missRs.length ? missRs[Math.floor(missRs.length / 2)] : 0;
  const nearMissCount = missRs.filter((r) => r <= 0.1).length;

  let curWin = 0, curLoss = 0, maxWin = 0, maxLoss = 0;
  let cum = 0, peak = 0, maxDd = 0;
  const equity: { ist_date: string; cum_pnl_usd: number }[] = [];
  for (const d of days) {
    if (d.outcome === "tp" || d.outcome === "sl") {
      if (d.pnl_usd > 0) { curWin += 1; curLoss = 0; if (curWin > maxWin) maxWin = curWin; }
      else { curLoss += 1; curWin = 0; if (curLoss > maxLoss) maxLoss = curLoss; }
    }
    cum += finitePnl(d);
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) maxDd = dd;
    equity.push({ ist_date: d.ist_date, cum_pnl_usd: cum });
  }

  // Cohorts — recompute using the ORIGINAL bucket labels stored on each day.
  const decidedAll = decidedRows;
  const dimFor = <T extends string>(labels: readonly T[], key: (d: DayResult) => T | null | undefined, edges: [number, number] | null) => ({
    buckets: labels.map((l) => statFor(decidedAll.filter((d) => key(d) === l), l, rr)),
    edges,
  });
  const oc = orig.summary.cohorts;
  const cohorts = {
    body: dimFor(["low", "mid", "high"] as const, (d) => (d as unknown as { body_bucket: "low" | "mid" | "high" | null }).body_bucket, oc.body.edges),
    or_size: dimFor(["small", "medium", "large"] as const, (d) => (d as unknown as { or_bucket: "small" | "medium" | "large" | null }).or_bucket, oc.or_size.edges),
    break_distance: dimFor(["near", "mid", "far"] as const, (d) => (d as unknown as { break_distance_bucket: "near" | "mid" | "far" | null }).break_distance_bucket, oc.break_distance.edges),
    weekday: {
      buckets: ([1, 2, 3, 4, 5, 6, 0] as const).map((wd) =>
        statFor(decidedAll.filter((d) => (d as unknown as { weekday: number }).weekday === wd), WEEKDAY_LABELS[wd], rr),
      ),
      edges: null,
    },
    tp_target: dimFor(["swing", "opposite", "both", "neither"] as const, (d) => (d as unknown as { tp_target: "swing" | "opposite" | "both" | "neither" | null }).tp_target, null),
  };

  // Est fees — scale by triggered ratio.
  const origTriggered = orig.summary.triggered;
  const estFees = origTriggered > 0 ? orig.summary.est_fees_usd * (triggered / origTriggered) : 0;

  return {
    ...orig,
    days,
    weekdays,
    equity,
    summary: {
      total_days: days.length,
      days_with_session: daysWithSession,
      skipped_days: skippedDays,
      filtered_days: filteredCount,
      breaks,
      triggered,
      tp,
      sl,
      open: openCount,
      armed_no_trigger: armedNoTrigger,
      win_rate_pct: winRate,
      total_pnl_usd: totalPnl,
      avg_r: avgR,
      best_pnl_usd: bestPnl,
      worst_pnl_usd: worstPnl,
      best_weekday: bestWd ? { label: bestWd.label, total_pnl_usd: bestWd.total_pnl_usd } : null,
      worst_weekday: worstWd ? { label: worstWd.label, total_pnl_usd: worstWd.total_pnl_usd } : null,
      profit_factor: profitFactor,
      expectancy_usd: expectancy,
      avg_win_usd: avgWin,
      avg_loss_usd: avgLoss,
      max_drawdown_usd: maxDd,
      max_consec_wins: maxWin,
      max_consec_losses: maxLoss,
      fill_rate_pct: fillRatePct,
      median_miss_r: medianMissR,
      near_miss_count: nearMissCount,
      est_fees_usd: estFees,
      net_pnl_usd: totalPnl,
      cohorts,
      mae_wins: maeStats(days, "tp"),
      mae_losses: maeStats(days, "sl"),
    },
  };
}

/** Break-hour distribution for the selector (counts trades per hour). */
export function hourDistribution(days: DayResult[]): Array<{ hour: number; count: number; pnl: number }> {
  const map = new Map<number, { count: number; pnl: number }>();
  for (let h = 0; h < 24; h++) map.set(h, { count: 0, pnl: 0 });
  for (const d of days) {
    const h = (d as unknown as { break_hour_ist: number | null }).break_hour_ist;
    if (h == null) continue;
    if (d.outcome !== "tp" && d.outcome !== "sl") continue;
    const e = map.get(h)!;
    e.count += 1;
    e.pnl += Number.isFinite(d.pnl_usd) ? d.pnl_usd : 0;
  }
  return Array.from(map.entries()).map(([hour, v]) => ({ hour, ...v }));
}
