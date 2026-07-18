CREATE UNIQUE INDEX IF NOT EXISTS strategy_setups_one_active_per_side_idx
ON public.strategy_setups (ist_date, symbol, side)
WHERE status IN ('armed', 'triggered');