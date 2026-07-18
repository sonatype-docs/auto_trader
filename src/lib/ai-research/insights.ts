// Orchestrator: run every AI-research engine on a TradeRecord list and
// produce a consolidated report with top-ranked insights.

import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { deriveAll, type DerivedFeatures } from "./features-ext";
import { performanceInsights } from "./performance";
import { failureInsights } from "./failure";
import { edgeInsights, filterRecommendations } from "./edge-discovery";
import { featureImportanceInsights } from "./feature-importance";
import { regimeInsights } from "./regime";
import { clusterInsights } from "./clustering";
import { correlationInsights } from "./correlation";
import { patternInsights } from "./patterns";
import { walkForwardInsights } from "./walk-forward";
import { monteCarloInsights } from "./monte-carlo";
import { anomalyInsights } from "./anomaly";
import { comparisonInsights } from "./comparison";
import { sweetSpotInsights, sweetSpotAnalyses } from "./sweet-spot";
import { dayOfWeekInsights, dayOfWeekBreakdown, weekendComparison } from "./day-of-week";
import type { Insight, Recommendation } from "./types";
import type { ResearchReport } from "./report";

function sortChrono(trades: TradeRecord[]): TradeRecord[] {
  return [...trades].sort((a, b) => a.exitTime - b.exitTime);
}

function byStrategy(features: DerivedFeatures[]): Map<string, DerivedFeatures[]> {
  const m = new Map<string, DerivedFeatures[]>();
  for (const f of features) {
    const arr = m.get(f.strategyId) ?? [];
    arr.push(f);
    m.set(f.strategyId, arr);
  }
  return m;
}

export function generateResearch(trades: TradeRecord[]): ResearchReport {
  const chrono = sortChrono(trades);
  const features = deriveAll(chrono);
  const sections = {
    executive: [] as Insight[],
    performance: performanceInsights(features),
    failure: failureInsights(features),
    edges: edgeInsights(features),
    filters: filterRecommendations(features) as Recommendation[],
    features: featureImportanceInsights(features),
    regime: regimeInsights(features),
    clusters: clusterInsights(features),
    correlations: correlationInsights(features),
    patterns: patternInsights(features),
    walkForward: walkForwardInsights(features),
    monteCarlo: monteCarloInsights(features),
    anomalies: anomalyInsights(features, chrono),
    comparison: comparisonInsights(byStrategy(features)),
    sweetSpot: sweetSpotInsights(features),
    dayOfWeek: dayOfWeekInsights(features),
  };

  // Executive = top by severity + evidence.
  const rank: Record<string, number> = { critical: 4, warning: 3, positive: 2, info: 1 };
  const all: Insight[] = [
    ...sections.edges, ...sections.performance, ...sections.failure,
    ...sections.filters, ...sections.regime, ...sections.walkForward,
    ...sections.monteCarlo, ...sections.comparison,
    ...sections.sweetSpot, ...sections.dayOfWeek,
  ];
  sections.executive = all
    .sort((a, b) => (rank[b.severity] - rank[a.severity]) || ((b.evidence.confidence ?? 0) - (a.evidence.confidence ?? 0)))
    .slice(0, 6);

  return {
    generatedAt: new Date().toISOString(),
    sampleSize: trades.length,
    sections,
    analytics: {
      sweetSpot: sweetSpotAnalyses(features),
      dayOfWeek: dayOfWeekBreakdown(features),
      weekendCompare: weekendComparison(features),
    },
  };
}

