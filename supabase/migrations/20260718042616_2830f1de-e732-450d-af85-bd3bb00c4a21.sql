
REVOKE EXECUTE ON FUNCTION public.list_trade_snapshots() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_trade_snapshots() TO service_role;
