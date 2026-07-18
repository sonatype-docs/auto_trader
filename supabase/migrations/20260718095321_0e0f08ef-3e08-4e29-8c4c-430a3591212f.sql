REVOKE ALL ON FUNCTION public.refresh_trade_snapshot_stat(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_trade_snapshot_stats() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_trade_snapshots() TO service_role;
REVOKE ALL ON FUNCTION public.list_trade_snapshots() FROM PUBLIC, anon, authenticated;