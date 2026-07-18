CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.strategy_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT,
  sl_risk_usd NUMERIC NOT NULL,
  rr NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_presets TO authenticated;
GRANT ALL ON public.strategy_presets TO service_role;

ALTER TABLE public.strategy_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can manage strategy presets"
  ON public.strategy_presets
  FOR ALL
  TO authenticated
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

CREATE TRIGGER update_strategy_presets_updated_at
  BEFORE UPDATE ON public.strategy_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();