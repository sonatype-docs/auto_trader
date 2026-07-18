
-- Paper trading runners: one row per (symbol, timeframe, strategy) combo.
CREATE TABLE public.paper_runners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'shark',
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  strategy_preset TEXT NOT NULL,
  exec_preset TEXT NOT NULL DEFAULT 'conservative_default',
  risk_usd NUMERIC NOT NULL DEFAULT 20,
  lookback_days INTEGER NOT NULL DEFAULT 5,
  running BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ,
  last_tick_at TIMESTAMPTZ,
  last_tick_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, timeframe, strategy_preset)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_runners TO authenticated;
GRANT ALL ON public.paper_runners TO service_role;
ALTER TABLE public.paper_runners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads runners"  ON public.paper_runners FOR SELECT TO authenticated USING (is_owner());
CREATE POLICY "owner writes runners" ON public.paper_runners FOR ALL    TO authenticated USING (is_owner()) WITH CHECK (is_owner());

CREATE TRIGGER paper_runners_updated_at BEFORE UPDATE ON public.paper_runners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Closed paper trades — one row per completed simulated trade.
CREATE TABLE public.paper_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runner_id UUID NOT NULL REFERENCES public.paper_runners(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  strategy_preset TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry_ts TIMESTAMPTZ NOT NULL,
  entry_price NUMERIC NOT NULL,
  fill_price NUMERIC NOT NULL,
  stop_price NUMERIC NOT NULL,
  target_price NUMERIC NOT NULL,
  exit_ts TIMESTAMPTZ NOT NULL,
  exit_price NUMERIC NOT NULL,
  exit_reason TEXT NOT NULL,
  rr NUMERIC NOT NULL DEFAULT 0,
  gross_pnl NUMERIC NOT NULL DEFAULT 0,
  net_pnl NUMERIC NOT NULL DEFAULT 0,
  fees NUMERIC NOT NULL DEFAULT 0,
  units NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (runner_id, dedup_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_trades TO authenticated;
GRANT ALL ON public.paper_trades TO service_role;
ALTER TABLE public.paper_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads paper trades"  ON public.paper_trades FOR SELECT TO authenticated USING (is_owner());
CREATE POLICY "owner writes paper trades" ON public.paper_trades FOR ALL    TO authenticated USING (is_owner()) WITH CHECK (is_owner());
CREATE INDEX paper_trades_runner_entry_idx ON public.paper_trades (runner_id, entry_ts DESC);

-- Current live/open position per runner (0 or 1 row per runner).
CREATE TABLE public.paper_positions (
  runner_id UUID PRIMARY KEY REFERENCES public.paper_runners(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  strategy_preset TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry_ts TIMESTAMPTZ NOT NULL,
  entry_price NUMERIC NOT NULL,
  stop_price NUMERIC NOT NULL,
  target_price NUMERIC NOT NULL,
  units NUMERIC NOT NULL,
  last_price NUMERIC NOT NULL,
  unrealized_pnl NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_positions TO authenticated;
GRANT ALL ON public.paper_positions TO service_role;
ALTER TABLE public.paper_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads paper positions"  ON public.paper_positions FOR SELECT TO authenticated USING (is_owner());
CREATE POLICY "owner writes paper positions" ON public.paper_positions FOR ALL    TO authenticated USING (is_owner()) WITH CHECK (is_owner());

-- Seed the 3 combos the user requested.
INSERT INTO public.paper_runners (label, source, symbol, timeframe, strategy_preset, exec_preset)
VALUES
  ('BTC 5m VWAP',        'shark', 'BTCUSDT', '5m',  'vwap_mean_revert', 'conservative_default'),
  ('BTC 15m VWAP',       'shark', 'BTCUSDT', '15m', 'vwap_mean_revert', 'conservative_default'),
  ('BTC 1h London ORB',  'shark', 'BTCUSDT', '1h',  'london_orb',       'conservative_default')
ON CONFLICT (symbol, timeframe, strategy_preset) DO NOTHING;
