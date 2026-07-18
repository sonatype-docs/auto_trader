
CREATE TABLE public.trade_intelligence (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trade_id TEXT NOT NULL UNIQUE,
  strategy_id TEXT NOT NULL,
  strategy_version TEXT,
  symbol TEXT NOT NULL,
  timeframe TEXT,
  direction TEXT NOT NULL,
  trade_type TEXT,
  entry_type TEXT,
  stop_type TEXT,
  target_type TEXT,
  status TEXT NOT NULL DEFAULT 'closed',
  -- timestamps
  signal_time TIMESTAMPTZ,
  order_time TIMESTAMPTZ,
  fill_time TIMESTAMPTZ,
  entry_time TIMESTAMPTZ NOT NULL,
  exit_time TIMESTAMPTZ NOT NULL,
  weekday SMALLINT,
  week_number SMALLINT,
  month SMALLINT,
  quarter SMALLINT,
  year SMALLINT,
  session TEXT,
  -- price/perf headline columns for indexed filtering
  entry_price NUMERIC NOT NULL,
  fill_price NUMERIC,
  exit_price NUMERIC NOT NULL,
  stop_price NUMERIC,
  target_price NUMERIC,
  position_size NUMERIC,
  risk_usd NUMERIC,
  risk_pct NUMERIC,
  actual_rr NUMERIC,
  gross_pnl NUMERIC,
  net_pnl NUMERIC NOT NULL,
  pnl_pct NUMERIC,
  pnl_r NUMERIC,
  mae NUMERIC,
  mfe NUMERIC,
  fees NUMERIC,
  commission NUMERIC,
  slippage NUMERIC,
  spread_cost NUMERIC,
  holding_bars INTEGER,
  duration_ms BIGINT,
  exit_reason TEXT,
  -- rich feature buckets
  price JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk JSONB NOT NULL DEFAULT '{}'::jsonb,
  performance JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration JSONB NOT NULL DEFAULT '{}'::jsonb,
  volatility JSONB NOT NULL DEFAULT '{}'::jsonb,
  trend JSONB NOT NULL DEFAULT '{}'::jsonb,
  structure JSONB NOT NULL DEFAULT '{}'::jsonb,
  liquidity JSONB NOT NULL DEFAULT '{}'::jsonb,
  smart_money JSONB NOT NULL DEFAULT '{}'::jsonb,
  volume_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  breakout JSONB NOT NULL DEFAULT '{}'::jsonb,
  entry_quality JSONB NOT NULL DEFAULT '{}'::jsonb,
  stop JSONB NOT NULL DEFAULT '{}'::jsonb,
  target JSONB NOT NULL DEFAULT '{}'::jsonb,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  news JSONB NOT NULL DEFAULT '{}'::jsonb,
  regime JSONB NOT NULL DEFAULT '{}'::jsonb,
  custom JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_intelligence TO authenticated;
GRANT ALL ON public.trade_intelligence TO service_role;

ALTER TABLE public.trade_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads trade_intelligence"
  ON public.trade_intelligence FOR SELECT TO authenticated USING (public.is_owner());
CREATE POLICY "owner inserts trade_intelligence"
  ON public.trade_intelligence FOR INSERT TO authenticated WITH CHECK (public.is_owner());
CREATE POLICY "owner updates trade_intelligence"
  ON public.trade_intelligence FOR UPDATE TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE POLICY "owner deletes trade_intelligence"
  ON public.trade_intelligence FOR DELETE TO authenticated USING (public.is_owner());

CREATE INDEX ti_strategy_idx ON public.trade_intelligence (strategy_id);
CREATE INDEX ti_symbol_idx ON public.trade_intelligence (symbol);
CREATE INDEX ti_entry_time_idx ON public.trade_intelligence (entry_time DESC);
CREATE INDEX ti_exit_time_idx ON public.trade_intelligence (exit_time DESC);
CREATE INDEX ti_direction_idx ON public.trade_intelligence (direction);
CREATE INDEX ti_session_idx ON public.trade_intelligence (session);
CREATE INDEX ti_weekday_idx ON public.trade_intelligence (weekday);
CREATE INDEX ti_net_pnl_idx ON public.trade_intelligence (net_pnl);
CREATE INDEX ti_tags_gin ON public.trade_intelligence USING GIN (tags);
CREATE INDEX ti_custom_gin ON public.trade_intelligence USING GIN (custom jsonb_path_ops);
CREATE INDEX ti_filters_gin ON public.trade_intelligence USING GIN (filters jsonb_path_ops);

CREATE TRIGGER trade_intelligence_updated_at
  BEFORE UPDATE ON public.trade_intelligence
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
