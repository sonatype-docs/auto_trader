
-- Live trading tables (mirror of paper_ tables but tracking real exchange orders).

CREATE TABLE public.live_runners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  source text NOT NULL DEFAULT 'shark',
  symbol text NOT NULL,
  timeframe text NOT NULL,
  strategy_preset text NOT NULL,
  exec_preset text NOT NULL,
  risk_usd numeric NOT NULL DEFAULT 20,
  lookback_days integer NOT NULL DEFAULT 5,
  leverage integer NOT NULL DEFAULT 10,
  running boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  last_tick_at timestamptz,
  last_tick_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_runners TO authenticated;
GRANT ALL ON public.live_runners TO service_role;
ALTER TABLE public.live_runners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "live_runners owner" ON public.live_runners FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE TABLE public.live_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runner_id uuid NOT NULL REFERENCES public.live_runners(id) ON DELETE CASCADE,
  dedup_key text NOT NULL,
  client_order_id text,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  strategy_preset text NOT NULL,
  direction text NOT NULL,
  qty numeric NOT NULL,
  entry_ts timestamptz NOT NULL,
  entry_price numeric NOT NULL,
  fill_price numeric,
  stop_price numeric NOT NULL,
  target_price numeric NOT NULL,
  exit_ts timestamptz,
  exit_price numeric,
  exit_reason text,
  rr numeric,
  net_pnl numeric,
  gross_pnl numeric,
  fees numeric,
  status text NOT NULL DEFAULT 'open',
  error text,
  raw_place jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (runner_id, dedup_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_trades TO authenticated;
GRANT ALL ON public.live_trades TO service_role;
ALTER TABLE public.live_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "live_trades owner" ON public.live_trades FOR ALL USING (public.is_owner()) WITH CHECK (public.is_owner());

CREATE TRIGGER trg_live_runners_updated BEFORE UPDATE ON public.live_runners
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_live_trades_updated BEFORE UPDATE ON public.live_trades
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed the requested runner: BTCUSDT 5m VWAP with $20 risk per trade.
INSERT INTO public.live_runners (label, source, symbol, timeframe, strategy_preset, exec_preset, risk_usd, lookback_days, leverage, running)
VALUES ('BTC 5m VWAP (LIVE)', 'shark', 'BTCUSDT', '5m', 'vwap_mean_revert', 'crypto_perp_default', 20, 3, 10, false);
