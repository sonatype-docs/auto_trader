-- Snapshot the current trade_intelligence rows into an archive so the user can
-- toggle between "live" data (still being written by the running pipeline)
-- and the pre-pipeline snapshot.
CREATE TABLE public.trade_intelligence_archive (
  LIKE public.trade_intelligence INCLUDING DEFAULTS
);
ALTER TABLE public.trade_intelligence_archive
  ADD COLUMN snapshot_name TEXT NOT NULL DEFAULT 'pre-pipeline-2026-07-15';
ALTER TABLE public.trade_intelligence_archive
  ADD CONSTRAINT trade_intelligence_archive_pkey PRIMARY KEY (id);

-- Copy every current row, generating fresh ids so PK doesn't clash if the
-- snapshot is ever restored, and tagging with the snapshot label.
INSERT INTO public.trade_intelligence_archive
SELECT
  gen_random_uuid() AS id,
  trade_id, strategy_id, strategy_version, symbol, timeframe, direction,
  trade_type, entry_type, stop_type, target_type, status,
  signal_time, order_time, fill_time, entry_time, exit_time,
  weekday, week_number, month, quarter, year, session,
  entry_price, fill_price, exit_price, stop_price, target_price,
  position_size, risk_usd, risk_pct, actual_rr, gross_pnl, net_pnl,
  pnl_pct, pnl_r, mae, mfe, fees, commission, slippage, spread_cost,
  holding_bars, duration_ms, exit_reason,
  price, risk, performance, duration, volatility, trend, structure,
  liquidity, smart_money, volume_profile, breakout, entry_quality,
  stop, target, filters, news, regime, custom, tags, raw,
  created_at, updated_at,
  'pre-pipeline-2026-07-15' AS snapshot_name
FROM public.trade_intelligence;

CREATE INDEX tia_snapshot_idx    ON public.trade_intelligence_archive (snapshot_name);
CREATE INDEX tia_entry_time_idx  ON public.trade_intelligence_archive (entry_time DESC);
CREATE INDEX tia_strategy_idx    ON public.trade_intelligence_archive (strategy_id);
CREATE INDEX tia_net_pnl_idx     ON public.trade_intelligence_archive (net_pnl);
CREATE INDEX tia_direction_idx   ON public.trade_intelligence_archive (direction);
CREATE INDEX tia_session_idx     ON public.trade_intelligence_archive (session);
CREATE INDEX tia_custom_gin      ON public.trade_intelligence_archive USING gin (custom jsonb_path_ops);
CREATE INDEX tia_filters_gin     ON public.trade_intelligence_archive USING gin (filters jsonb_path_ops);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_intelligence_archive TO authenticated;
GRANT ALL ON public.trade_intelligence_archive TO service_role;

ALTER TABLE public.trade_intelligence_archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read archive"   ON public.trade_intelligence_archive FOR SELECT TO authenticated USING (public.is_owner());
CREATE POLICY "Owner can write archive"  ON public.trade_intelligence_archive FOR ALL    TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
