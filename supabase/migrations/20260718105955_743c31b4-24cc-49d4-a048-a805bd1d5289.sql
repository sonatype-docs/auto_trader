CREATE INDEX IF NOT EXISTS tia_snapshot_entry_trade_cursor_idx
  ON public.trade_intelligence_archive (snapshot_name, entry_time ASC, trade_id ASC);

CREATE INDEX IF NOT EXISTS ti_entry_trade_cursor_idx
  ON public.trade_intelligence (entry_time ASC, trade_id ASC);

CREATE INDEX IF NOT EXISTS tia_snapshot_trade_id_idx
  ON public.trade_intelligence_archive (snapshot_name, trade_id ASC);