
DROP POLICY IF EXISTS "anyone can read owner" ON public.owner;

GRANT SELECT ON public.owner TO authenticated;
GRANT ALL ON public.owner TO service_role;

CREATE POLICY "owner can read own row"
  ON public.owner
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.owner WHERE user_id = auth.uid())
$function$;
