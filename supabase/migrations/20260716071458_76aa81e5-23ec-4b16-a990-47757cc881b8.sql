CREATE UNIQUE INDEX IF NOT EXISTS tia_snapshot_trade_uk
  ON public.trade_intelligence_archive (snapshot_name, trade_id);