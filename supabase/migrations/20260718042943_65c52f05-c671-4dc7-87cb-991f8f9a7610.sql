CREATE OR REPLACE FUNCTION public.list_trade_snapshots()
RETURNS TABLE(name text, count bigint, last_updated timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT snapshot_name AS name, COUNT(*)::bigint AS count, NULL::timestamptz AS last_updated
  FROM public.trade_intelligence_archive
  WHERE snapshot_name IS NOT NULL
  GROUP BY snapshot_name
  ORDER BY snapshot_name;
$function$;