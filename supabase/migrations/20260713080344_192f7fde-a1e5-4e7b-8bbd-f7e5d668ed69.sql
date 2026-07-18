
ALTER TABLE public.strategy_settings
  ADD COLUMN IF NOT EXISTS ai_grading_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_grading_model jsonb,
  ADD COLUMN IF NOT EXISTS ai_risk_multipliers jsonb NOT NULL DEFAULT '{"A+++":2.0,"A++":1.5,"A+":1.25,"A":1.0,"B":0.5,"C":0.0}'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_min_grade text NOT NULL DEFAULT 'B';
