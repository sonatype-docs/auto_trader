
ALTER TABLE public.strategy_setups
  ADD COLUMN IF NOT EXISTS placement_status text,
  ADD COLUMN IF NOT EXISTS placement_leverage integer,
  ADD COLUMN IF NOT EXISTS placement_error text,
  ADD COLUMN IF NOT EXISTS placement_capped boolean,
  ADD COLUMN IF NOT EXISTS requested_qty numeric,
  ADD COLUMN IF NOT EXISTS placement_attempts integer,
  ADD COLUMN IF NOT EXISTS placement_at timestamptz;
