CREATE TABLE public.pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  matrix jsonb NOT NULL,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  log jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_runs TO authenticated;
GRANT ALL ON public.pipeline_runs TO service_role;

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can manage pipeline runs"
  ON public.pipeline_runs
  FOR ALL
  TO authenticated
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

CREATE TRIGGER trg_pipeline_runs_updated_at
  BEFORE UPDATE ON public.pipeline_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_pipeline_runs_started_at ON public.pipeline_runs (started_at DESC);