
CREATE TABLE public.research_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  goals TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  priority TEXT NOT NULL DEFAULT 'medium',
  version TEXT NOT NULL DEFAULT '1.0',
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_projects TO authenticated;
GRANT ALL ON public.research_projects TO service_role;
ALTER TABLE public.research_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages research_projects" ON public.research_projects FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER trg_research_projects_updated BEFORE UPDATE ON public.research_projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.research_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.research_projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  strategy_id TEXT,
  strategy_version TEXT,
  symbol TEXT,
  timeframe TEXT,
  date_from TIMESTAMPTZ,
  date_to TIMESTAMPTZ,
  dataset_version TEXT,
  data_source TEXT,
  timezone TEXT,
  kind TEXT NOT NULL DEFAULT 'backtest',
  decision TEXT NOT NULL DEFAULT 'pending',
  decision_reason TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  strategy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  optimizer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  backtest_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_research_experiments_project ON public.research_experiments(project_id);
CREATE INDEX ix_research_experiments_created ON public.research_experiments(created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_experiments TO authenticated;
GRANT ALL ON public.research_experiments TO service_role;
ALTER TABLE public.research_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages research_experiments" ON public.research_experiments FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER trg_research_experiments_updated BEFORE UPDATE ON public.research_experiments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.research_hypotheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.research_projects(id) ON DELETE SET NULL,
  statement TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  confidence NUMERIC,
  evidence TEXT,
  conclusion TEXT,
  supporting_experiment_ids UUID[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_hypotheses TO authenticated;
GRANT ALL ON public.research_hypotheses TO service_role;
ALTER TABLE public.research_hypotheses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages research_hypotheses" ON public.research_hypotheses FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER trg_research_hypotheses_updated BEFORE UPDATE ON public.research_hypotheses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.research_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.research_projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  deadline TIMESTAMPTZ,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_tasks TO authenticated;
GRANT ALL ON public.research_tasks TO service_role;
ALTER TABLE public.research_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages research_tasks" ON public.research_tasks FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER trg_research_tasks_updated BEFORE UPDATE ON public.research_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.research_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.research_projects(id) ON DELETE SET NULL,
  experiment_id UUID REFERENCES public.research_experiments(id) ON DELETE SET NULL,
  title TEXT,
  body_md TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_notes TO authenticated;
GRANT ALL ON public.research_notes TO service_role;
ALTER TABLE public.research_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages research_notes" ON public.research_notes FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE TRIGGER trg_research_notes_updated BEFORE UPDATE ON public.research_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.research_bookmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  label TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_bookmarks TO authenticated;
GRANT ALL ON public.research_bookmarks TO service_role;
ALTER TABLE public.research_bookmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages research_bookmarks" ON public.research_bookmarks FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE TABLE public.research_changelog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.research_projects(id) ON DELETE SET NULL,
  experiment_id UUID REFERENCES public.research_experiments(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_research_changelog_created ON public.research_changelog(created_at DESC);
GRANT SELECT, INSERT ON public.research_changelog TO authenticated;
GRANT ALL ON public.research_changelog TO service_role;
ALTER TABLE public.research_changelog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads changelog" ON public.research_changelog FOR SELECT USING (public.is_owner());
CREATE POLICY "owner appends changelog" ON public.research_changelog FOR INSERT WITH CHECK (public.is_owner());
