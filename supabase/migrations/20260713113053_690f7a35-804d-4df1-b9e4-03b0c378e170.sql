ALTER TABLE public.strategy_settings
  ADD COLUMN IF NOT EXISTS ai_auto_retrain boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_retrain_days integer NOT NULL DEFAULT 365,
  ADD COLUMN IF NOT EXISTS ai_last_retrain_at timestamptz;