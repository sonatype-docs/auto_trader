ALTER TABLE public.strategy_setups
  DROP CONSTRAINT IF EXISTS strategy_setups_close_reason_check;

ALTER TABLE public.strategy_setups
  ADD CONSTRAINT strategy_setups_close_reason_check
  CHECK (
    close_reason IS NULL
    OR close_reason IN ('tp', 'sl', 'session_end', 'manual', 'manual_cancel', 'manual_close', 'rearm_with_ai')
  );