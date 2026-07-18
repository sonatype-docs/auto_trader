CREATE TABLE public.strategy_setup_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  setup_id UUID NOT NULL REFERENCES public.strategy_setups(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  exchange_order_id TEXT,
  leverage NUMERIC,
  qty NUMERIC,
  price NUMERIC,
  reason TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_strategy_setup_events_setup_id_created_at
  ON public.strategy_setup_events (setup_id, created_at DESC);

GRANT SELECT, INSERT ON public.strategy_setup_events TO authenticated;
GRANT ALL ON public.strategy_setup_events TO service_role;

ALTER TABLE public.strategy_setup_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read setup events"
  ON public.strategy_setup_events FOR SELECT
  TO authenticated
  USING (public.is_owner());

CREATE POLICY "Owner can insert setup events"
  ON public.strategy_setup_events FOR INSERT
  TO authenticated
  WITH CHECK (public.is_owner());