// Client-side research CSV export. Uses the existing downloadFile helper.

import type { backtestRange } from "@/lib/strategy.functions";
import { downloadFile } from "@/lib/backtest-export";
import type { TradeFeatures } from "@/lib/research/features";
import { FILTERS, type FilterId, type FilterState } from "@/lib/research/filters";
import { computeBuckets, computeStats } from "@/lib/research/aggregate";

type RangeData = Awaited<ReturnType<typeof backtestRange>>;

function esc(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (...cells: unknown[]) => cells.map(esc).join(",");
const section = (t: string) => ["", `# ${t}`];

function statsRow(prefix: string, s: ReturnType<typeof computeStats>) {
  return row(
    prefix,
    s.total,
    s.filled,
    s.missed,
    s.wins,
    s.losses,
    s.win_rate_pct.toFixed(2),
    s.loss_rate_pct.toFixed(2),
    Number.isFinite(s.profit_factor) ? s.profit_factor.toFixed(3) : "inf",
    s.expectancy_usd.toFixed(2),
    s.net_pnl_usd.toFixed(2),
    s.avg_r.toFixed(3),
    s.max_drawdown_usd.toFixed(2),
    s.max_consec_wins,
    s.max_consec_losses,
  );
}
const STATS_HEADER = row(
  "label",
  "total",
  "filled",
  "missed",
  "wins",
  "losses",
  "win_rate_pct",
  "loss_rate_pct",
  "profit_factor",
  "expectancy_usd",
  "net_pnl_usd",
  "avg_r",
  "max_drawdown_usd",
  "max_consec_wins",
  "max_consec_losses",
);

export function exportResearchCsv(
  data: RangeData,
  allFeatures: TradeFeatures[],
  filteredFeatures: TradeFeatures[],
  filters: Record<FilterId, FilterState>,
): void {
  const lines: string[] = [];
  lines.push("# Backtest Research Export — Phase 1");
  lines.push(row("generated_at", new Date().toISOString()));
  lines.push(row("symbol", data.symbol));
  lines.push(row("session_start_ist", data.session_start_ist));
  lines.push(row("days_requested", data.days_requested));
  lines.push(row("rows_all", allFeatures.length));
  lines.push(row("rows_filtered", filteredFeatures.length));

  // Filter states
  lines.push(...section("Filter states"));
  lines.push(row("filter_id", "enabled", "mode", "allowed_buckets", "min", "max"));
  for (const def of FILTERS) {
    const s = filters[def.id];
    const allowed = Object.entries(s.allowedBuckets)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join("|");
    lines.push(row(def.id, s.enabled, s.mode, allowed, s.min ?? "", s.max ?? ""));
  }

  // Combined stats
  lines.push(...section("Combined stats"));
  lines.push(STATS_HEADER);
  lines.push(statsRow("all", computeStats(allFeatures)));
  lines.push(statsRow("filtered", computeStats(filteredFeatures)));

  // Per-filter bucket breakdown
  for (const def of FILTERS) {
    lines.push(...section(`Buckets — ${def.label}`));
    lines.push(STATS_HEADER);
    for (const r of computeBuckets(allFeatures, def)) {
      lines.push(statsRow(`${def.id}:${r.bucket}`, r));
    }
  }

  // Per-trade features
  lines.push(...section("Per-trade features"));
  lines.push(
    row(
      "ist_date",
      "side",
      "outcome",
      "pnl_usd",
      "or_size_usd",
      "or_size_pct_atr",
      "or_size_percentile",
      "break_distance_usd",
      "break_distance_pct_or",
      "break_distance_pct_atr",
      "body_pct",
      "upper_wick_pct",
      "lower_wick_pct",
      "close_position_pct",
      "candle_range_usd",
      "daily_atr",
      "atr_percentile",
      "ema20",
      "ema50",
      "ema100",
      "ema200",
      "adx14",
      "prev_open",
      "prev_close",
      "prev_high",
      "prev_low",
      "prev_range",
      "or_bucket5",
      "break_strength_bucket5",
      "body_bucket5",
      "atr_bucket4",
      "trend_bucket",
      "prev_day_bucket",
    ),
  );
  for (const f of allFeatures) {
    lines.push(
      row(
        f.ist_date,
        f.side ?? "",
        f.outcome,
        f.pnl_usd,
        f.or_size_usd ?? "",
        f.or_size_pct_atr ?? "",
        f.or_size_percentile ?? "",
        f.break_distance_usd ?? "",
        f.break_distance_pct_or ?? "",
        f.break_distance_pct_atr ?? "",
        f.body_pct ?? "",
        f.upper_wick_pct ?? "",
        f.lower_wick_pct ?? "",
        f.close_position_pct ?? "",
        f.candle_range_usd ?? "",
        f.daily_atr ?? "",
        f.atr_percentile ?? "",
        f.ema20 ?? "",
        f.ema50 ?? "",
        f.ema100 ?? "",
        f.ema200 ?? "",
        f.adx14 ?? "",
        f.prev_open ?? "",
        f.prev_close ?? "",
        f.prev_high ?? "",
        f.prev_low ?? "",
        f.prev_range ?? "",
        f.or_bucket5 ?? "",
        f.break_strength_bucket5 ?? "",
        f.body_bucket5 ?? "",
        f.atr_bucket4 ?? "",
        f.trend_bucket ?? "",
        f.prev_day_bucket ?? "",
      ),
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = `research_${data.symbol}_${data.session_start_ist.replace(":", "")}_${data.days_requested}d_${stamp}`;
  downloadFile(`${base}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
}
