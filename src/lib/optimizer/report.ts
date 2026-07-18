// Report engine — serializes optimizer output into JSON / CSV / Markdown.
import type { EvaluatedCandidate, OptimizationResult } from "./types";

export function toJson(result: OptimizationResult): string {
  return JSON.stringify(result, null, 2);
}

export function topToCsv(rows: EvaluatedCandidate[]): string {
  if (!rows.length) return "";
  const keys = ["id", "score", "trades", ...Object.keys(rows[0].candidate), ...Object.keys(rows[0].metrics)];
  const lines = [keys.join(",")];
  for (const r of rows) {
    const line: (string | number)[] = [r.id, r.score, r.trades];
    for (const k of Object.keys(rows[0].candidate)) line.push(String(r.candidate[k] ?? ""));
    for (const k of Object.keys(rows[0].metrics)) line.push(r.metrics[k] ?? "");
    lines.push(line.map((v) => (typeof v === "string" && v.includes(",") ? `"${v}"` : v)).join(","));
  }
  return lines.join("\n");
}

export function toMarkdown(result: OptimizationResult): string {
  const lines: string[] = [];
  lines.push(`# Optimizer Report`);
  lines.push(`- Method: **${result.method}**`);
  lines.push(`- Objective: **${result.objective.key}${result.objective.formula ? " (custom)" : ""}**`);
  lines.push(`- Evaluated: ${result.evaluated}`);
  lines.push(`- Elapsed: ${result.elapsedMs} ms`);
  if (result.best) {
    lines.push(`\n## Best`);
    lines.push(`Score: **${result.best.score.toFixed(4)}** · Trades: ${result.best.trades}`);
    lines.push("```json"); lines.push(JSON.stringify(result.best.candidate, null, 2)); lines.push("```");
  }
  lines.push(`\n## Top ${Math.min(10, result.top.length)}`);
  lines.push("| # | Score | Trades | Candidate |");
  lines.push("|---|-------|--------|-----------|");
  result.top.slice(0, 10).forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.score.toFixed(4)} | ${r.trades} | ${JSON.stringify(r.candidate)} |`);
  });
  return lines.join("\n");
}
