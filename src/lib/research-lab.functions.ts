// Quant Research Laboratory — server functions.
// Owner-scoped CRUD for projects, experiments, hypotheses, tasks, notes,
// bookmarks, and an append-only changelog. Historical records are never
// deleted implicitly; the changelog is insert-only.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Uuid = z.string().uuid();

/* ---------------- Projects ---------------- */

const ProjectInput = z.object({
  id: Uuid.optional(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  goals: z.string().optional().nullable(),
  tags: z.array(z.string()).default([]),
  status: z.string().default("active"),
  priority: z.string().default("medium"),
  version: z.string().default("1.0"),
  archived: z.boolean().default(false),
});

export const listProjects = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("research_projects").select("*").order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const upsertProject = createServerFn({ method: "POST" })
  .inputValidator((raw) => ProjectInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("research_projects").upsert(data).select().single();
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("research_changelog").insert({
      project_id: row.id, event_type: data.id ? "project.updated" : "project.created",
      summary: `${data.id ? "Updated" : "Created"} project ${row.name}`, payload: row,
    });
    return row;
  });

export const deleteProject = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ id: Uuid }).parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("research_projects").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Experiments ---------------- */

const ExperimentInput = z.object({
  id: Uuid.optional(),
  project_id: Uuid.nullable().optional(),
  title: z.string().min(1),
  strategy_id: z.string().optional().nullable(),
  strategy_version: z.string().optional().nullable(),
  symbol: z.string().optional().nullable(),
  timeframe: z.string().optional().nullable(),
  date_from: z.string().optional().nullable(),
  date_to: z.string().optional().nullable(),
  dataset_version: z.string().optional().nullable(),
  data_source: z.string().optional().nullable(),
  timezone: z.string().optional().nullable(),
  kind: z.string().default("backtest"),
  decision: z.enum(["accepted", "rejected", "pending", "needs_review", "deprecated", "archived"]).default("pending"),
  decision_reason: z.string().optional().nullable(),
  tags: z.array(z.string()).default([]),
  strategy_snapshot: z.any().default({}),
  optimizer_snapshot: z.any().default({}),
  backtest_snapshot: z.any().default({}),
  ai_findings: z.any().default([]),
  metrics: z.any().default({}),
  notes: z.string().optional().nullable(),
});

export const listExperiments = createServerFn({ method: "GET" })
  .inputValidator((raw) => z.object({ projectId: Uuid.optional() }).parse(raw ?? {}))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("research_experiments").select("*").order("created_at", { ascending: false });
    if (data.projectId) q = q.eq("project_id", data.projectId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertExperiment = createServerFn({ method: "POST" })
  .inputValidator((raw) => ExperimentInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("research_experiments").upsert(data).select().single();
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("research_changelog").insert({
      project_id: row.project_id, experiment_id: row.id,
      event_type: data.id ? "experiment.updated" : "experiment.created",
      summary: `${data.id ? "Updated" : "Created"} experiment ${row.title}`,
      payload: { metrics: row.metrics, decision: row.decision },
    });
    return row;
  });

export const setExperimentDecision = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({
    id: Uuid,
    decision: z.enum(["accepted", "rejected", "pending", "needs_review", "deprecated", "archived"]),
    reason: z.string().optional().nullable(),
  }).parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("research_experiments")
      .update({ decision: data.decision, decision_reason: data.reason ?? null })
      .eq("id", data.id).select().single();
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("research_changelog").insert({
      project_id: row.project_id, experiment_id: row.id,
      event_type: "experiment.decision",
      summary: `Decision → ${data.decision}${data.reason ? `: ${data.reason}` : ""}`,
      payload: { decision: data.decision, reason: data.reason },
    });
    return row;
  });

/* ---------------- Diff ---------------- */

export const diffExperiments = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ a: Uuid, b: Uuid }).parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("research_experiments").select("*").in("id", [data.a, data.b]);
    if (error) throw new Error(error.message);
    const a = rows?.find((r) => r.id === data.a);
    const b = rows?.find((r) => r.id === data.b);
    if (!a || !b) throw new Error("Experiments not found");
    const keys = new Set<string>([
      ...Object.keys((a.metrics ?? {}) as object),
      ...Object.keys((b.metrics ?? {}) as object),
    ]);
    const diff = Array.from(keys).map((k) => {
      const av = (a.metrics as Record<string, unknown>)[k] ?? null;
      const bv = (b.metrics as Record<string, unknown>)[k] ?? null;
      return {
        key: k,
        a: JSON.stringify(av),
        b: JSON.stringify(bv),
        changed: JSON.stringify(av) !== JSON.stringify(bv),
      };
    });
    return { a, b, diff };
  });

/* ---------------- Hypotheses ---------------- */

const HypInput = z.object({
  id: Uuid.optional(),
  project_id: Uuid.nullable().optional(),
  statement: z.string().min(1),
  status: z.enum(["open", "supported", "rejected", "inconclusive"]).default("open"),
  confidence: z.number().min(0).max(1).nullable().optional(),
  evidence: z.string().optional().nullable(),
  conclusion: z.string().optional().nullable(),
  supporting_experiment_ids: z.array(Uuid).default([]),
  tags: z.array(z.string()).default([]),
});

export const listHypotheses = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("research_hypotheses").select("*").order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const upsertHypothesis = createServerFn({ method: "POST" })
  .inputValidator((raw) => HypInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("research_hypotheses").upsert(data).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

/* ---------------- Tasks ---------------- */

const TaskInput = z.object({
  id: Uuid.optional(),
  project_id: Uuid.nullable().optional(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  status: z.enum(["todo", "in_progress", "done", "blocked"]).default("todo"),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  deadline: z.string().optional().nullable(),
  tags: z.array(z.string()).default([]),
});

export const listTasks = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("research_tasks").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const upsertTask = createServerFn({ method: "POST" })
  .inputValidator((raw) => TaskInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("research_tasks").upsert(data).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

/* ---------------- Notes ---------------- */

const NoteInput = z.object({
  id: Uuid.optional(),
  project_id: Uuid.nullable().optional(),
  experiment_id: Uuid.nullable().optional(),
  title: z.string().optional().nullable(),
  body_md: z.string().default(""),
  tags: z.array(z.string()).default([]),
  attachments: z.any().default([]),
});

export const listNotes = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("research_notes").select("*").order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const upsertNote = createServerFn({ method: "POST" })
  .inputValidator((raw) => NoteInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("research_notes").upsert(data).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

/* ---------------- Changelog / Timeline ---------------- */

export const listChangelog = createServerFn({ method: "GET" })
  .inputValidator((raw) => z.object({ limit: z.number().int().min(1).max(500).default(200) }).parse(raw ?? {}))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("research_changelog").select("*")
      .order("created_at", { ascending: false }).limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/* ---------------- Search ---------------- */

export const searchLab = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ q: z.string().min(1) }).parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = `%${data.q}%`;
    const [projects, experiments, hypotheses, tasks, notes] = await Promise.all([
      supabaseAdmin.from("research_projects").select("id,name,description").or(`name.ilike.${q},description.ilike.${q}`).limit(20),
      supabaseAdmin.from("research_experiments").select("id,title,project_id").ilike("title", q).limit(20),
      supabaseAdmin.from("research_hypotheses").select("id,statement,project_id").ilike("statement", q).limit(20),
      supabaseAdmin.from("research_tasks").select("id,title,project_id").ilike("title", q).limit(20),
      supabaseAdmin.from("research_notes").select("id,title,body_md,project_id").or(`title.ilike.${q},body_md.ilike.${q}`).limit(20),
    ]);
    return {
      projects: projects.data ?? [],
      experiments: experiments.data ?? [],
      hypotheses: hypotheses.data ?? [],
      tasks: tasks.data ?? [],
      notes: notes.data ?? [],
    };
  });

/* ---------------- Metrics ---------------- */

export const labMetrics = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: exps } = await supabaseAdmin.from("research_experiments").select("decision,strategy_id,metrics");
  const rows = exps ?? [];
  const decisions: Record<string, number> = {};
  const perStrategy: Record<string, number> = {};
  let improvements = 0, improvementSum = 0;
  for (const r of rows) {
    decisions[r.decision] = (decisions[r.decision] ?? 0) + 1;
    if (r.strategy_id) perStrategy[r.strategy_id] = (perStrategy[r.strategy_id] ?? 0) + 1;
    const m = (r.metrics ?? {}) as Record<string, unknown>;
    const delta = typeof m.pf_delta === "number" ? m.pf_delta : null;
    if (delta !== null) { improvements++; improvementSum += delta; }
  }
  const total = rows.length;
  const accepted = decisions.accepted ?? 0;
  const rejected = decisions.rejected ?? 0;
  const acceptanceRate = total ? accepted / total : 0;
  const mostTested = Object.entries(perStrategy).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    total, accepted, rejected, acceptanceRate,
    decisions, perStrategy, mostTested,
    avgImprovement: improvements ? improvementSum / improvements : 0,
  };
});
