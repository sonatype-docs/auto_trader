CREATE TABLE IF NOT EXISTS public.trade_snapshot_stats (
  name text PRIMARY KEY,
  trade_count bigint NOT NULL DEFAULT 0,
  last_updated timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_snapshot_stats TO authenticated;
GRANT ALL ON public.trade_snapshot_stats TO service_role;

ALTER TABLE public.trade_snapshot_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can read snapshot stats" ON public.trade_snapshot_stats;
CREATE POLICY "Owner can read snapshot stats"
ON public.trade_snapshot_stats
FOR SELECT
TO authenticated
USING (public.is_owner());

DROP POLICY IF EXISTS "Owner can manage snapshot stats" ON public.trade_snapshot_stats;
CREATE POLICY "Owner can manage snapshot stats"
ON public.trade_snapshot_stats
FOR ALL
TO authenticated
USING (public.is_owner())
WITH CHECK (public.is_owner());

INSERT INTO public.trade_snapshot_stats (name, trade_count, last_updated)
SELECT
  snapshot_name AS name,
  COUNT(*)::bigint AS trade_count,
  COALESCE(MAX(COALESCE(updated_at, created_at, exit_time, entry_time)), now()) AS last_updated
FROM public.trade_intelligence_archive
WHERE snapshot_name IS NOT NULL
GROUP BY snapshot_name
ON CONFLICT (name) DO UPDATE SET
  trade_count = EXCLUDED.trade_count,
  last_updated = EXCLUDED.last_updated;

CREATE OR REPLACE FUNCTION public.refresh_trade_snapshot_stat(_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _name IS NULL OR length(_name) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.trade_snapshot_stats (name, trade_count, last_updated)
  SELECT
    _name,
    COUNT(*)::bigint,
    COALESCE(MAX(COALESCE(updated_at, created_at, exit_time, entry_time)), now())
  FROM public.trade_intelligence_archive
  WHERE snapshot_name = _name
  ON CONFLICT (name) DO UPDATE SET
    trade_count = EXCLUDED.trade_count,
    last_updated = EXCLUDED.last_updated;

  DELETE FROM public.trade_snapshot_stats
  WHERE name = _name AND trade_count <= 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_trade_snapshot_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.snapshot_name IS NOT NULL THEN
      INSERT INTO public.trade_snapshot_stats (name, trade_count, last_updated)
      VALUES (NEW.snapshot_name, 1, COALESCE(NEW.updated_at, NEW.created_at, NEW.exit_time, NEW.entry_time, now()))
      ON CONFLICT (name) DO UPDATE SET
        trade_count = public.trade_snapshot_stats.trade_count + 1,
        last_updated = GREATEST(
          public.trade_snapshot_stats.last_updated,
          COALESCE(NEW.updated_at, NEW.created_at, NEW.exit_time, NEW.entry_time, now())
        );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_trade_snapshot_stat(OLD.snapshot_name);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.snapshot_name IS DISTINCT FROM NEW.snapshot_name THEN
      PERFORM public.refresh_trade_snapshot_stat(OLD.snapshot_name);
      PERFORM public.refresh_trade_snapshot_stat(NEW.snapshot_name);
    ELSIF NEW.snapshot_name IS NOT NULL THEN
      INSERT INTO public.trade_snapshot_stats (name, trade_count, last_updated)
      VALUES (NEW.snapshot_name, 1, COALESCE(NEW.updated_at, NEW.created_at, NEW.exit_time, NEW.entry_time, now()))
      ON CONFLICT (name) DO UPDATE SET
        last_updated = GREATEST(
          public.trade_snapshot_stats.last_updated,
          COALESCE(NEW.updated_at, NEW.created_at, NEW.exit_time, NEW.entry_time, now())
        );
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_trade_snapshot_stats_trigger ON public.trade_intelligence_archive;
CREATE TRIGGER sync_trade_snapshot_stats_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.trade_intelligence_archive
FOR EACH ROW EXECUTE FUNCTION public.sync_trade_snapshot_stats();

CREATE OR REPLACE FUNCTION public.list_trade_snapshots()
RETURNS TABLE(name text, count bigint, last_updated timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.name, s.trade_count AS count, s.last_updated
  FROM public.trade_snapshot_stats s
  WHERE s.trade_count > 0
  ORDER BY s.name;
$$;