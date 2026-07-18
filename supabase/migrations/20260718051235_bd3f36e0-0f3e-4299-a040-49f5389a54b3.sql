CREATE INDEX IF NOT EXISTS tia_snapshot_entry_time_idx
  ON public.trade_intelligence_archive (snapshot_name, entry_time);

CREATE INDEX IF NOT EXISTS tia_snapshot_exit_time_idx
  ON public.trade_intelligence_archive (snapshot_name, exit_time);

CREATE INDEX IF NOT EXISTS ti_entry_time_idx
  ON public.trade_intelligence (entry_time);

CREATE INDEX IF NOT EXISTS ti_exit_time_idx
  ON public.trade_intelligence (exit_time);