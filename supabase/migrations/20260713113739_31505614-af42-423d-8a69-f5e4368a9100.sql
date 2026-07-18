ALTER TABLE public.strategy_setups
  ADD COLUMN IF NOT EXISTS ai_grade text,
  ADD COLUMN IF NOT EXISTS ai_score numeric,
  ADD COLUMN IF NOT EXISTS ai_risk_mult numeric;