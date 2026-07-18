// AI Research — server functions.
// - runResearch: query the trade DB and generate the full research report.
// - askResearch: natural-language question grounded in the computed report.
//   The model is forbidden from inventing statistics; every answer must cite
//   the numbers already contained in the report context.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { TradeRecord } from "@/lib/trade-intelligence/types";
import { generateResearch } from "./ai-research/insights";
import { toMarkdown } from "./ai-research/report";
import { reviewTrade } from "./ai-research/trade-review";
import { deriveAll } from "./ai-research/features-ext";

const RunInput = z.object({
  strategyId: z.string().optional(),
  symbol: z.string().optional(),
  fromMs: z.number().optional(),
  toMs: z.number().optional(),
  limit: z.number().int().positive().max(20000).default(5000),
});

async function fetchTrades(spec: z.infer<typeof RunInput>): Promise<TradeRecord[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { applyQuery } = await import("./trade-intelligence/query");
  const { rowToRecord } = await import("@/lib/trade-intelligence/mapper");
  const q = applyQuery(supabaseAdmin, "trade_intelligence", {
    strategyId: spec.strategyId,
    symbol: spec.symbol,
    fromMs: spec.fromMs,
    toMs: spec.toMs,
    orderBy: "exit_time",
    order: "asc",
    limit: spec.limit,
  });
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => rowToRecord(r as unknown as Record<string, unknown>));
}

export const runResearch = createServerFn({ method: "POST" })
  .inputValidator((raw) => RunInput.parse(raw))
  .handler(async ({ data }) => {
    const trades = await fetchTrades(data);
    if (!trades.length) {
      return { report: null, markdown: "", tradeCount: 0 };
    }
    const report = generateResearch(trades);
    return { report, markdown: toMarkdown(report), tradeCount: trades.length };
  });

export const reviewOneTrade = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ tradeId: z.string() }).parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { rowToRecord } = await import("@/lib/trade-intelligence/mapper");
    const { data: rows, error } = await supabaseAdmin
      .from("trade_intelligence").select("*").eq("trade_id", data.tradeId).limit(1);
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("Trade not found");
    const target = rowToRecord(rows[0] as Record<string, unknown>);
    // Peer set = all trades for same strategy.
    const { data: peerRows } = await supabaseAdmin
      .from("trade_intelligence").select("*").eq("strategy_id", target.strategyId).limit(5000);
    const peers = deriveAll((peerRows ?? []).map((r) => rowToRecord(r as Record<string, unknown>)));
    return reviewTrade(target, peers);
  });

const AskInput = z.object({
  question: z.string().min(2),
  strategyId: z.string().optional(),
  symbol: z.string().optional(),
});

export const askResearch = createServerFn({ method: "POST" })
  .inputValidator((raw) => AskInput.parse(raw))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");
    const trades = await fetchTrades({ strategyId: data.strategyId, symbol: data.symbol, limit: 5000 });
    if (!trades.length) return { answer: "No trades in the intelligence database yet. Record some trades first.", citations: [] };
    const report = generateResearch(trades);

    // Compact grounding context (executive + top of each section).
    const context = {
      sampleSize: report.sampleSize,
      executive: report.sections.executive.map(shortInsight),
      edges: report.sections.edges.slice(0, 6).map(shortInsight),
      failures: report.sections.failure.map(shortInsight),
      filters: report.sections.filters.slice(0, 6).map(shortInsight),
      regime: report.sections.regime.map(shortInsight),
      walkForward: report.sections.walkForward.map(shortInsight),
      monteCarlo: report.sections.monteCarlo.map(shortInsight),
      comparison: report.sections.comparison.map(shortInsight),
    };

    const messages = [
      {
        role: "system",
        content: [
          "You are a quantitative research assistant analysing algorithmic trading results.",
          "You MUST ground every claim in the provided JSON context (which contains real statistics computed from the trade database).",
          "If the context does not contain data to support a claim, say so explicitly. NEVER invent numbers.",
          "Cite sample sizes, p-values or confidence in parentheses when relevant.",
          "Answer concisely in markdown. Prefer bullet lists.",
        ].join(" "),
      },
      {
        role: "user",
        content: `Question: ${data.question}\n\nComputed research context (do not fabricate outside these numbers):\n${JSON.stringify(context, null, 2)}`,
      },
    ];

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      if (resp.status === 402) throw new Error("AI credits exhausted. Add credits to continue.");
      if (resp.status === 429) throw new Error("AI rate limit exceeded. Try again shortly.");
      throw new Error(`Gateway ${resp.status}: ${body.slice(0, 200)}`);
    }
    const json = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const answer = json.choices?.[0]?.message?.content ?? "(no response)";
    return { answer, citations: context.executive };
  });

function shortInsight(i: { title: string; summary: string; evidence: { sampleSize: number; pValue?: number | null; confidence?: number } }) {
  return {
    title: i.title,
    summary: i.summary,
    n: i.evidence.sampleSize,
    p: i.evidence.pValue ?? null,
    confidence: i.evidence.confidence ?? null,
  };
}
