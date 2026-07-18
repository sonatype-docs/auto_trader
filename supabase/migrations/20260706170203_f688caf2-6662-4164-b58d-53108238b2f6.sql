
ALTER TABLE public.strategy_settings
  ADD COLUMN IF NOT EXISTS trail_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trail_activate_r numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS trail_step_r numeric NOT NULL DEFAULT 1;

ALTER TABLE public.strategy_setups
  ADD COLUMN IF NOT EXISTS peak_r numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS initial_sl_price numeric;
