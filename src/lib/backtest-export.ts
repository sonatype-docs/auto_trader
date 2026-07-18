// Client-side export helpers — builds multi-section CSV / JSON from a backtest result.

import type { backtestRange } from "@/lib/strategy.functions";

type RangeData = Awaited<ReturnType<typeof backtestRange>>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function esc(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function row(...cells: unknown[]): string {
  return cells.map(esc).join(",");
}
function section(title: string): string[] {
  return ["", `# ${title}`];
}

function istWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

interface MonthAgg {
  key: string;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
}

function aggregateMonthly(days: RangeData["days"]): MonthAgg[] {
  const map = new Map<string, MonthAgg>();
  for (const d of days) {
    const [y, m] = d.ist_date.split("-").map((n) => parseInt(n, 10));
    const key = `${y}-${String(m).padStart(2, "0")}`;
    let b = map.get(key);
    if (!b) {
      b = { key, label: `${MONTHS[m - 1]} ${y}`, trades: 0, wins: 0, losses: 0, pnl: 0 };
      map.set(key, b);
    }
    const pnl = Number(d.pnl_usd ?? 0);
    b.pnl += Number.isFinite(pnl) ? pnl : 0;
    if (d.outcome === "tp") { b.trades++; b.wins++; }
    else if (d.outcome === "sl") { b.trades++; b.losses++; }
    else if (d.outcome === "open") b.trades++;
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

export function buildAllCsv(data: RangeData): string {
  const lines: string[] = [];
  const s = data.summary;

  // Header metadata
  lines.push("# Backtest Export");
  lines.push(row("generated_at", new Date().toISOString()));
  lines.push(row("symbol", data.symbol));
  lines.push(row("session_start_ist", data.session_start_ist));
  lines.push(row("days_requested", data.days_requested));
  lines.push(row("from", new Date(data.from_ms).toISOString()));
  lines.push(row("to", new Date(data.to_ms).toISOString()));
  lines.push(row("sl_risk_usd", data.sl_risk_usd));
  lines.push(row("rr", data.rr));
  lines.push(row("bars_scanned", data.bars_scanned));
  lines.push(row("trail_enabled", data.trail.enabled));
  lines.push(row("trail_activate_r", data.trail.activate_r));
  lines.push(row("trail_step_r", data.trail.step_r));
  lines.push(row("skip_weekdays", data.skip_weekdays.join("|")));
  if (data.entry) {
    lines.push(row("entry_mode", data.entry.mode));
    lines.push(row("entry_depth_pct", (data.entry as { entry_depth_pct?: number }).entry_depth_pct ?? ""));
    lines.push(row("sl_depth_pct", (data.entry as { sl_depth_pct?: number }).sl_depth_pct ?? ""));
  }

  // Summary
  lines.push(...section("Summary"));
  lines.push(row("metric", "value"));
  const summaryPairs: [string, unknown][] = [
    ["total_days", s.total_days],
    ["days_with_session", s.days_with_session],
    ["skipped_days", s.skipped_days],
    ["filtered_days", s.filtered_days],
    ["breaks", s.breaks],
    ["triggered", s.triggered],
    ["tp", s.tp],
    ["sl", s.sl],
    ["open", s.open],
    ["armed_no_trigger", s.armed_no_trigger],
    ["near_miss_count", s.near_miss_count],
    ["median_miss_r", s.median_miss_r],
    ["fill_rate_pct", s.fill_rate_pct],
    ["win_rate_pct", s.win_rate_pct],
    ["profit_factor", Number.isFinite(s.profit_factor) ? s.profit_factor : "inf"],
    ["expectancy_usd", s.expectancy_usd],
    ["avg_r", s.avg_r],
    ["avg_win_usd", s.avg_win_usd],
    ["avg_loss_usd", s.avg_loss_usd],
    ["total_pnl_usd_gross", s.total_pnl_usd],
    ["est_fees_usd", s.est_fees_usd],
    ["net_pnl_usd", s.net_pnl_usd],
    ["best_pnl_usd", s.best_pnl_usd],
    ["worst_pnl_usd", s.worst_pnl_usd],
    ["max_drawdown_usd", s.max_drawdown_usd],
    ["max_consec_wins", s.max_consec_wins],
    ["max_consec_losses", s.max_consec_losses],
    ["best_weekday", s.best_weekday ? `${s.best_weekday.label} ${s.best_weekday.total_pnl_usd.toFixed(2)}` : ""],
    ["worst_weekday", s.worst_weekday ? `${s.worst_weekday.label} ${s.worst_weekday.total_pnl_usd.toFixed(2)}` : ""],
  ];
  for (const [k, v] of summaryPairs) lines.push(row(k, v));

  // Weekday performance
  lines.push(...section("Weekday performance"));
  lines.push(row("weekday", "label", "trades", "wins", "losses", "win_rate_pct", "total_pnl_usd", "avg_pnl_usd"));
  for (const w of data.weekdays) {
    lines.push(row(w.weekday, w.label, w.trades, w.wins, w.losses, w.win_rate_pct, w.total_pnl_usd, w.avg_pnl_usd));
  }

  // Monthly performance
  lines.push(...section("Monthly performance"));
  lines.push(row("month", "trades", "wins", "losses", "win_rate_pct", "net_pnl_usd"));
  for (const m of aggregateMonthly(data.days)) {
    const decided = m.wins + m.losses;
    const winPct = decided > 0 ? (m.wins / decided) * 100 : 0;
    lines.push(row(m.label, m.trades, m.wins, m.losses, winPct.toFixed(2), m.pnl.toFixed(2)));
  }

  // Cohorts
  const cohorts = s.cohorts;
  const cohortDims: Array<[string, typeof cohorts.body]> = [
    ["body", cohorts.body],
    ["or_size", cohorts.or_size],
    ["break_distance", cohorts.break_distance],
    ["weekday", cohorts.weekday],
    ["tp_target", cohorts.tp_target],
  ];
  for (const [name, dim] of cohortDims) {
    lines.push(...section(`Cohort: ${name}`));
    if (dim.edges) lines.push(row("edges", dim.edges.join("|")));
    lines.push(row("bucket", "trades", "wins", "losses", "win_rate_pct", "total_pnl_usd", "avg_pnl_usd", "avg_r"));
    for (const b of dim.buckets) {
      lines.push(row(b.bucket, b.trades, b.wins, b.losses, b.win_rate_pct, b.total_pnl_usd, b.avg_pnl_usd, b.avg_r));
    }
  }

  // MAE distributions
  if (s.mae_wins) {
    lines.push(...section("MAE distribution — winning trades (R)"));
    lines.push(row("count", "avg", "p50", "p75", "p90", "p95", "max"));
    const m = s.mae_wins;
    lines.push(row(m.count, m.avg, m.p50, m.p75, m.p90, m.p95, m.max));
  }
  if (s.mae_losses) {
    lines.push(...section("MAE distribution — losing trades (R)"));
    lines.push(row("count", "avg", "p50", "p75", "p90", "p95", "max"));
    const m = s.mae_losses;
    lines.push(row(m.count, m.avg, m.p50, m.p75, m.p90, m.p95, m.max));
  }

  // Equity curve
  lines.push(...section("Equity curve"));
  lines.push(row("ist_date", "cum_pnl_usd"));
  for (const e of data.equity) lines.push(row(e.ist_date, e.cum_pnl_usd));

  // Full trade log (day-by-day)
  lines.push(...section("Trades (per day)"));
  lines.push(
    row(
      "ist_date", "weekday", "outcome", "filter_reason", "break_side", "break_at_iso", "break_close",
      "session_open", "zone_high", "zone_low", "fib_25", "fib_75",
      "entry", "sl", "tp", "qty", "trigger_at_iso", "final_sl",
      "peak_r", "exit_r", "mae_r", "closest_approach_r", "pnl_usd",
      "body_pct", "or_size_usd", "break_distance_usd", "swing_ref", "opposite_ref",
      "tp_target", "body_bucket", "or_bucket", "break_distance_bucket", "entry_mode",
    ),
  );
  for (const d of data.days) {
    lines.push(
      row(
        d.ist_date,
        d.weekday_label,
        d.outcome,
        d.filter_reason ?? "",
        d.break_side ?? "",
        d.break_at ? new Date(d.break_at).toISOString() : "",
        d.break_close ?? "",
        d.session_open ?? "",
        d.zone_high ?? "",
        d.zone_low ?? "",
        d.fib_25 ?? "",
        d.fib_75 ?? "",
        d.entry ?? "",
        d.sl ?? "",
        d.tp ?? "",
        d.qty ?? "",
        d.trigger_at ? new Date(d.trigger_at).toISOString() : "",
        d.final_sl ?? "",
        d.peak_r,
        d.exit_r ?? "",
        d.mae_r ?? "",
        d.closest_approach_r ?? "",
        d.pnl_usd,
        d.body_pct ?? "",
        d.or_size_usd ?? "",
        d.break_distance_usd ?? "",
        d.swing_ref ?? "",
        d.opposite_ref ?? "",
        d.tp_target ?? "",
        d.body_bucket ?? "",
        d.or_bucket ?? "",
        d.break_distance_bucket ?? "",
        d.entry_mode ?? "",
      ),
    );
  }

  return lines.join("\n");
}

export function downloadFile(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportBacktest(data: RangeData, kind: "csv" | "json"): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = `backtest_${data.symbol}_${data.session_start_ist.replace(":", "")}_${data.days_requested}d_${stamp}`;
  if (kind === "json") {
    downloadFile(`${base}.json`, JSON.stringify(data, null, 2), "application/json");
  } else {
    downloadFile(`${base}.csv`, buildAllCsv(data), "text/csv;charset=utf-8");
  }
}
