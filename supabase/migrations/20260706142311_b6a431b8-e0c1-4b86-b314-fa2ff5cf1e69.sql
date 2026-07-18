
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.owner WHERE user_id = auth.uid())
$$;
