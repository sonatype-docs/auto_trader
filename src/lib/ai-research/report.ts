// Report generator: assemble insights into an executive markdown/JSON report.

import type { Insight, Recommendation } from "./types";
import type { SweetSpotAnalysis } from "./sweet-spot";
import type { DayRow, WeekendComparison } from "./day-of-week";

export interface ResearchReport {
  generatedAt: string;
  sampleSize: number;
  sections: {
    executive: Insight[];
    performance: Insight[];
    failure: Insight[];
    edges: Insight[];
    filters: Recommendation[];
    features: Insight[];
    regime: Insight[];
    clusters: Insight[];
    correlations: Insight[];
    patterns: Insight[];
    walkForward: Insight[];
    monteCarlo: Insight[];
    anomalies: Insight[];
    comparison: Insight[];
    sweetSpot: Insight[];
    dayOfWeek: Insight[];
  };
  analytics: {
    sweetSpot: SweetSpotAnalysis[];
    dayOfWeek: DayRow[];
    weekendCompare: WeekendComparison;
  };
}

export function toMarkdown(rep: ResearchReport): string {
  const line = (i: Insight) => `- **${i.title}** — ${i.summary}${i.evidence.pValue !== undefined && i.evidence.pValue !== null ? ` _(p=${i.evidence.pValue.toFixed(3)}, n=${i.evidence.sampleSize})_` : ` _(n=${i.evidence.sampleSize})_`}`;
  const section = (h: string, items: Insight[]) => items.length ? `## ${h}\n\n${items.map(line).join("\n")}\n` : "";
  return [
    `# Quantitative Research Report`,
    `_Generated ${rep.generatedAt} · Sample size: ${rep.sampleSize} trades_`,
    "",
    section("Executive Summary", rep.sections.executive),
    section("Performance", rep.sections.performance),
    section("Sweet-Spot Buckets", rep.sections.sweetSpot),
    section("Day of Week", rep.sections.dayOfWeek),
    section("Failure Analysis", rep.sections.failure),
    section("Statistical Edges", rep.sections.edges),
    section("Filter Recommendations", rep.sections.filters),
    section("Feature Importance", rep.sections.features),
    section("Market Regime", rep.sections.regime),
    section("Trade Clusters", rep.sections.clusters),
    section("Correlations", rep.sections.correlations),
    section("Patterns", rep.sections.patterns),
    section("Walk-Forward", rep.sections.walkForward),
    section("Monte Carlo", rep.sections.monteCarlo),
    section("Anomalies", rep.sections.anomalies),
    section("Strategy Comparison", rep.sections.comparison),
  ].join("\n");
}

