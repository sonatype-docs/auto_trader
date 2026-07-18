
ALTER TABLE public.strategy_settings
  ADD COLUMN IF NOT EXISTS entry_mode text NOT NULL DEFAULT 'fib',
  ADD COLUMN IF NOT EXISTS entry_depth_pct numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS sl_depth_pct numeric NOT NULL DEFAULT 0.75,
  ADD COLUMN IF NOT EXISTS adaptive_strong_break_pct numeric NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS adaptive_shallow_depth numeric NOT NULL DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS adaptive_deep_depth numeric NOT NULL DEFAULT 0.35,
  ADD COLUMN IF NOT EXISTS retest_sl_r numeric NOT NULL DEFAULT 0.5;

ALTER TABLE public.strategy_settings
  DROP CONSTRAINT IF EXISTS strategy_settings_entry_mode_check;
ALTER TABLE public.strategy_settings
  ADD CONSTRAINT strategy_settings_entry_mode_check
  CHECK (entry_mode IN ('fib','retest','market','adaptive'));

ALTER TABLE public.strategy_settings
  DROP CONSTRAINT IF EXISTS strategy_settings_depths_check;
ALTER TABLE public.strategy_settings
  ADD CONSTRAINT strategy_settings_depths_check
  CHECK (
    entry_depth_pct >= 0 AND entry_depth_pct <= 0.5
    AND sl_depth_pct > entry_depth_pct AND sl_depth_pct <= 1.0
    AND adaptive_shallow_depth >= 0 AND adaptive_shallow_depth <= 0.5
    AND adaptive_deep_depth > adaptive_shallow_depth AND adaptive_deep_depth <= 0.5
    AND retest_sl_r > 0 AND retest_sl_r <= 5
  );
