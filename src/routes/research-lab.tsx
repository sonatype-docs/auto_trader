// Quant Research Laboratory — UI.
// Modular tabs: Projects, Experiments, Hypotheses, Tasks, Notes, Timeline,
// Diff, Search, Metrics. Everything is owner-scoped and immutable-friendly.

import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FlaskConical, Plus, Search as SearchIcon, GitCompare, Loader2 } from "lucide-react";
import {
  listProjects, upsertProject,
  listExperiments, upsertExperiment, setExperimentDecision, diffExperiments,
  listHypotheses, upsertHypothesis,
  listTasks, upsertTask,
  listNotes, upsertNote,
  listChangelog, searchLab, labMetrics,
} from "@/lib/research-lab.functions";

export const Route = createFileRoute("/research-lab")({
  head: () => ({
    meta: [
      { title: "Quant Research Laboratory" },
      { name: "description", content: "Institutional-grade research notebook: projects, experiments, hypotheses, tasks, and timeline." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LabPage,
});

function LabPage() {
  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/40 text-primary-foreground">
          <FlaskConical className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Quant Research Laboratory</h1>
          <p className="text-sm text-muted-foreground">Permanent record of every experiment, hypothesis, and decision.</p>
        </div>
      </header>

      <Tabs defaultValue="projects">
        <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full justify-start">
            <TabsTrigger value="projects">Projects</TabsTrigger>
            <TabsTrigger value="experiments">Experiments</TabsTrigger>
            <TabsTrigger value="hypotheses">Hypotheses</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="diff">Diff</TabsTrigger>
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="projects"><ProjectsTab /></TabsContent>
        <TabsContent value="experiments"><ExperimentsTab /></TabsContent>
        <TabsContent value="hypotheses"><HypothesesTab /></TabsContent>
        <TabsContent value="tasks"><TasksTab /></TabsContent>
        <TabsContent value="notes"><NotesTab /></TabsContent>
        <TabsContent value="timeline"><TimelineTab /></TabsContent>
        <TabsContent value="diff"><DiffTab /></TabsContent>
        <TabsContent value="search"><SearchTab /></TabsContent>
        <TabsContent value="metrics"><MetricsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* --------------- Projects --------------- */

function ProjectsTab() {
  const list = useServerFn(listProjects);
  const save = useServerFn(upsertProject);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["lab", "projects"], queryFn: () => list() });
  const [name, setName] = useState(""); const [desc, setDesc] = useState("");
  const m = useMutation({
    mutationFn: () => save({ data: { name, description: desc, tags: [], status: "active", priority: "medium", version: "1.0", archived: false } }),
    onSuccess: () => { setName(""); setDesc(""); qc.invalidateQueries({ queryKey: ["lab", "projects"] }); qc.invalidateQueries({ queryKey: ["lab", "timeline"] }); },
  });
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_2fr] mt-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">New project</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input placeholder="Name (e.g. Gold ORB Research)" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea placeholder="Description / goals" value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} />
          <Button size="sm" onClick={() => m.mutate()} disabled={!name || m.isPending}>
            {m.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Create
          </Button>
        </CardContent>
      </Card>
      <div className="space-y-2">
        {(q.data ?? []).map((p) => (
          <Card key={p.id}>
            <CardContent className="p-3 flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">{p.name} <span className="text-xs text-muted-foreground">v{p.version}</span></div>
                {p.description && <div className="text-xs text-muted-foreground">{p.description}</div>}
                <div className="flex gap-1 mt-1">
                  <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
                  <Badge variant="outline" className="text-[10px]">{p.priority}</Badge>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">{new Date(p.updated_at).toLocaleDateString()}</div>
            </CardContent>
          </Card>
        ))}
        {!q.data?.length && <p className="text-sm text-muted-foreground">No projects yet.</p>}
      </div>
    </div>
  );
}

/* --------------- Experiments --------------- */

function ExperimentsTab() {
  const list = useServerFn(listExperiments);
  const save = useServerFn(upsertExperiment);
  const decide = useServerFn(setExperimentDecision);
  const projects = useServerFn(listProjects);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["lab", "experiments"], queryFn: () => list({ data: {} }) });
  const pj = useQuery({ queryKey: ["lab", "projects"], queryFn: () => projects() });
  const [title, setTitle] = useState(""); const [projectId, setProjectId] = useState<string>("");
  const [strategyId, setStrategyId] = useState(""); const [symbol, setSymbol] = useState("");
  const m = useMutation({
    mutationFn: () => save({ data: {
      title, project_id: projectId || null, strategy_id: strategyId || null, symbol: symbol || null,
      kind: "backtest", decision: "pending", tags: [], strategy_snapshot: {}, optimizer_snapshot: {},
      backtest_snapshot: {}, ai_findings: [], metrics: {},
    } }),
    onSuccess: () => { setTitle(""); qc.invalidateQueries({ queryKey: ["lab"] }); },
  });
  const decideM = useMutation({
    mutationFn: (v: { id: string; decision: "accepted" | "rejected" | "pending" | "needs_review" | "deprecated" | "archived"; reason?: string }) =>
      decide({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lab"] }),
  });
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_2fr] mt-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">New experiment</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger><SelectValue placeholder="Project (optional)" /></SelectTrigger>
            <SelectContent>
              {(pj.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Strategy ID" value={strategyId} onChange={(e) => setStrategyId(e.target.value)} />
          <Input placeholder="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
          <Button size="sm" onClick={() => m.mutate()} disabled={!title || m.isPending}>Create</Button>
        </CardContent>
      </Card>
      <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
        {(q.data ?? []).map((e) => (
          <Card key={e.id}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.strategy_id ?? "—"} · {e.symbol ?? "—"} · {new Date(e.created_at).toLocaleString()}
                  </div>
                </div>
                <Badge variant="outline">{e.decision}</Badge>
              </div>
              <div className="flex gap-1 flex-wrap">
                {(["accepted", "rejected", "needs_review", "archived", "deprecated"] as const).map((d) => (
                  <Button key={d} size="sm" variant="ghost" className="h-6 text-[11px]"
                    onClick={() => decideM.mutate({ id: e.id, decision: d })}>{d}</Button>
                ))}
              </div>
              <div className="font-mono text-[11px] text-muted-foreground truncate">
                metrics: {JSON.stringify(e.metrics).slice(0, 120)}
              </div>
            </CardContent>
          </Card>
        ))}
        {!q.data?.length && <p className="text-sm text-muted-foreground">No experiments yet.</p>}
      </div>
    </div>
  );
}

/* --------------- Hypotheses --------------- */

function HypothesesTab() {
  const list = useServerFn(listHypotheses);
  const save = useServerFn(upsertHypothesis);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["lab", "hyp"], queryFn: () => list() });
  const [stmt, setStmt] = useState(""); const [ev, setEv] = useState("");
  const m = useMutation({
    mutationFn: () => save({ data: { statement: stmt, evidence: ev, status: "open", supporting_experiment_ids: [], tags: [] } }),
    onSuccess: () => { setStmt(""); setEv(""); qc.invalidateQueries({ queryKey: ["lab", "hyp"] }); },
  });
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_2fr] mt-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">New hypothesis</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Textarea placeholder="Statement (e.g. Large OR reduces profitability)" value={stmt} onChange={(e) => setStmt(e.target.value)} />
          <Textarea placeholder="Evidence" value={ev} onChange={(e) => setEv(e.target.value)} />
          <Button size="sm" onClick={() => m.mutate()} disabled={!stmt || m.isPending}>Create</Button>
        </CardContent>
      </Card>
      <div className="space-y-2">
        {(q.data ?? []).map((h) => (
          <Card key={h.id}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{h.statement}</div>
                <Badge variant="outline">{h.status}</Badge>
              </div>
              {h.evidence && <div className="text-xs text-muted-foreground mt-1">{h.evidence}</div>}
            </CardContent>
          </Card>
        ))}
        {!q.data?.length && <p className="text-sm text-muted-foreground">No hypotheses yet.</p>}
      </div>
    </div>
  );
}

/* --------------- Tasks --------------- */

function TasksTab() {
  const list = useServerFn(listTasks); const save = useServerFn(upsertTask);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["lab", "tasks"], queryFn: () => list() });
  const [title, setTitle] = useState(""); const [prio, setPrio] = useState<"low"|"medium"|"high"|"critical">("medium");
  const m = useMutation({
    mutationFn: () => save({ data: { title, priority: prio, status: "todo", tags: [] } }),
    onSuccess: () => { setTitle(""); qc.invalidateQueries({ queryKey: ["lab", "tasks"] }); },
  });
  const toggle = useMutation({
    mutationFn: (t: { id: string; status: "todo"|"in_progress"|"done"|"blocked" }) => save({ data: { id: t.id, title: "-", status: t.status } as never }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lab", "tasks"] }),
  });
  return (
    <div className="mt-4 space-y-3">
      <Card>
        <CardContent className="p-3 flex gap-2 items-center">
          <Input placeholder="New task" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Select value={prio} onValueChange={(v) => setPrio(v as typeof prio)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["low","medium","high","critical"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => m.mutate()} disabled={!title || m.isPending}>Add</Button>
        </CardContent>
      </Card>
      <div className="space-y-1.5">
        {(q.data ?? []).map((t) => (
          <Card key={t.id}><CardContent className="p-2.5 flex items-center justify-between">
            <div>
              <div className="text-sm">{t.title}</div>
              <div className="text-[11px] text-muted-foreground">{t.priority} · {t.status}</div>
            </div>
            <div className="flex gap-1">
              {(["todo","in_progress","done","blocked"] as const).map((s) => (
                <Button key={s} size="sm" variant={t.status === s ? "default" : "ghost"} className="h-6 text-[10px]"
                  onClick={() => toggle.mutate({ id: t.id, status: s })}>{s}</Button>
              ))}
            </div>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}

/* --------------- Notes --------------- */

function NotesTab() {
  const list = useServerFn(listNotes); const save = useServerFn(upsertNote);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["lab", "notes"], queryFn: () => list() });
  const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const m = useMutation({
    mutationFn: () => save({ data: { title, body_md: body, tags: [], attachments: [] } }),
    onSuccess: () => { setTitle(""); setBody(""); qc.invalidateQueries({ queryKey: ["lab", "notes"] }); },
  });
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_2fr] mt-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">New note</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea placeholder="Markdown body" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          <Button size="sm" onClick={() => m.mutate()} disabled={!body || m.isPending}>Save</Button>
        </CardContent>
      </Card>
      <div className="space-y-2 max-h-[70vh] overflow-y-auto">
        {(q.data ?? []).map((n) => (
          <Card key={n.id}><CardContent className="p-3">
            {n.title && <div className="font-medium">{n.title}</div>}
            <div className="text-xs text-muted-foreground whitespace-pre-wrap">{n.body_md}</div>
            <div className="text-[10px] text-muted-foreground mt-1">{new Date(n.updated_at).toLocaleString()}</div>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}

/* --------------- Timeline --------------- */

function TimelineTab() {
  const list = useServerFn(listChangelog);
  const q = useQuery({ queryKey: ["lab", "timeline"], queryFn: () => list({ data: { limit: 200 } }) });
  return (
    <div className="mt-4 space-y-1.5">
      {(q.data ?? []).map((c) => (
        <Card key={c.id}><CardContent className="p-2.5 flex items-center justify-between">
          <div>
            <div className="text-sm">{c.summary}</div>
            <div className="text-[11px] text-muted-foreground">{c.event_type}</div>
          </div>
          <div className="text-[11px] text-muted-foreground">{new Date(c.created_at).toLocaleString()}</div>
        </CardContent></Card>
      ))}
      {!q.data?.length && <p className="text-sm text-muted-foreground">Timeline is empty. Create a project or experiment to populate it.</p>}
    </div>
  );
}

/* --------------- Diff --------------- */

function DiffTab() {
  const list = useServerFn(listExperiments);
  const diff = useServerFn(diffExperiments);
  const q = useQuery({ queryKey: ["lab", "experiments"], queryFn: () => list({ data: {} }) });
  const [a, setA] = useState<string>(""); const [b, setB] = useState<string>("");
  const m = useMutation({ mutationFn: () => diff({ data: { a, b } }) });
  const opts = useMemo(() => q.data ?? [], [q.data]);
  return (
    <div className="mt-4 space-y-3">
      <Card><CardContent className="p-3 flex gap-2 items-center flex-wrap">
        <Select value={a} onValueChange={setA}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Experiment A" /></SelectTrigger>
          <SelectContent>{opts.map((e) => <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={b} onValueChange={setB}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Experiment B" /></SelectTrigger>
          <SelectContent>{opts.map((e) => <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" onClick={() => m.mutate()} disabled={!a || !b || a === b || m.isPending}>
          <GitCompare className="h-3 w-3 mr-1" /> Compare
        </Button>
      </CardContent></Card>
      {m.data && (() => {
        const d = m.data as { a: { title: string }; b: { title: string }; diff: Array<{ key: string; a: string; b: string; changed: boolean }> };
        return (
        <Card><CardContent className="p-3">
          <div className="grid grid-cols-4 gap-2 text-xs font-mono">
            <div className="font-semibold">Metric</div>
            <div className="font-semibold">{d.a.title}</div>
            <div className="font-semibold">{d.b.title}</div>
            <div className="font-semibold">Δ</div>
            {d.diff.map((row) => (
              <div key={row.key} className="contents">
                <div>{row.key}</div>
                <div className={row.changed ? "text-amber-400" : ""}>{row.a}</div>
                <div className={row.changed ? "text-amber-400" : ""}>{row.b}</div>
                <div>{row.changed ? "changed" : "="}</div>
              </div>
            ))}
          </div>
        </CardContent></Card>
        );
      })()}
    </div>
  );
}

/* --------------- Search --------------- */

function SearchTab() {
  const search = useServerFn(searchLab);
  const [q, setQ] = useState("");
  const m = useMutation({ mutationFn: () => search({ data: { q } }) });
  return (
    <div className="mt-4 space-y-3">
      <Card><CardContent className="p-3 flex gap-2">
        <Input placeholder="Search projects, experiments, hypotheses, tasks, notes…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && q && m.mutate()} />
        <Button size="sm" onClick={() => m.mutate()} disabled={!q || m.isPending}>
          <SearchIcon className="h-3 w-3 mr-1" /> Search
        </Button>
      </CardContent></Card>
      {m.data && (
        <div className="grid gap-3 md:grid-cols-2">
          {(["projects","experiments","hypotheses","tasks","notes"] as const).map((k) => (
            <Card key={k}>
              <CardHeader className="pb-2"><CardTitle className="text-sm capitalize">{k}</CardTitle></CardHeader>
              <CardContent className="text-xs space-y-1">
                {((m.data as Record<string, Array<Record<string, unknown>>>)[k]).map((r) => (
                  <div key={String(r.id)} className="truncate">{String(r.name ?? r.title ?? r.statement ?? r.body_md ?? "")}</div>
                ))}
                {!(m.data as Record<string, unknown[]>)[k].length && <div className="text-muted-foreground">No matches.</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------- Metrics --------------- */

function MetricsTab() {
  const metrics = useServerFn(labMetrics);
  const q = useQuery({ queryKey: ["lab", "metrics"], queryFn: () => metrics() });
  const m = q.data;
  if (!m) return <p className="text-sm text-muted-foreground mt-4">Loading…</p>;
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-4">
      <Stat label="Experiments" value={m.total} />
      <Stat label="Accepted" value={m.accepted} />
      <Stat label="Rejected" value={m.rejected} />
      <Stat label="Acceptance rate" value={`${(m.acceptanceRate * 100).toFixed(1)}%`} />
      <Stat label="Most tested" value={m.mostTested ?? "—"} />
      <Stat label="Avg PF delta" value={m.avgImprovement.toFixed(3)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </CardContent></Card>
  );
}
