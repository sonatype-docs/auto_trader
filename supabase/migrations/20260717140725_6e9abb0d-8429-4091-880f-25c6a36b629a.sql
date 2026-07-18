ALTER TABLE public.live_trades ADD COLUMN IF NOT EXISTS fill_ts timestamptz;
ALTER TABLE public.live_trades ADD COLUMN IF NOT EXISTS exit_client_order_id text;
-- Backfill fill_ts for currently open trades so the 14-min exit rule has a clock.
UPDATE public.live_trades SET fill_ts = COALESCE(fill_ts, entry_ts) WHERE status = 'open' AND fill_ts IS NULL;