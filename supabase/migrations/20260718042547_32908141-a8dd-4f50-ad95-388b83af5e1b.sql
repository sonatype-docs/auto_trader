
CREATE OR REPLACE FUNCTION public.list_trade_snapshots()
RETURNS TABLE(name text, count bigint, last_updated timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT snapshot_name AS name, COUNT(*)::bigint AS count, MAX(updated_at) AS last_updated
  FROM public.trade_intelligence_archive
  WHERE snapshot_name IS NOT NULL
  GROUP BY snapshot_name
  ORDER BY snapshot_name;
$$;

GRANT EXECUTE ON FUNCTION public.list_trade_snapshots() TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_trade_intel_archive_snapshot_name
  ON public.trade_intelligence_archive(snapshot_name);
