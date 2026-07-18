
-- Owner singleton (first signup becomes owner)
CREATE TABLE public.owner (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.owner TO authenticated, anon;
GRANT ALL ON public.owner TO service_role;
ALTER TABLE public.owner ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can read owner" ON public.owner FOR SELECT USING (true);

-- Helper: is current user the owner?
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.owner WHERE user_id = auth.uid())
$$;

-- Settings singleton
CREATE TABLE public.settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  kill_switch BOOLEAN NOT NULL DEFAULT true,
  paper_mode BOOLEAN NOT NULL DEFAULT true,
  max_position_usd NUMERIC NOT NULL DEFAULT 100,
  max_open_positions INT NOT NULL DEFAULT 3,
  max_daily_loss_usd NUMERIC NOT NULL DEFAULT 50,
  allowed_symbols TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  paper_starting_equity NUMERIC NOT NULL DEFAULT 10000,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads settings" ON public.settings FOR SELECT TO authenticated USING (public.is_owner());
CREATE POLICY "owner writes settings" ON public.settings FOR UPDATE TO authenticated USING (public.is_owner()) WITH CHECK (public.is_owner());
CREATE POLICY "owner inserts settings" ON public.settings FOR INSERT TO authenticated WITH CHECK (public.is_owner());
INSERT INTO public.settings (id) VALUES (true);

-- Webhook events
CREATE TABLE public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id TEXT UNIQUE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  reason TEXT
);
GRANT SELECT ON public.webhook_events TO authenticated;
GRANT ALL ON public.webhook_events TO service_role;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads webhook_events" ON public.webhook_events FOR SELECT TO authenticated USING (public.is_owner());
CREATE INDEX ON public.webhook_events (received_at DESC);

-- Orders
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_event_id UUID REFERENCES public.webhook_events(id) ON DELETE SET NULL,
  exchange_order_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  order_type TEXT NOT NULL DEFAULT 'market',
  qty NUMERIC NOT NULL,
  price NUMERIC,
  filled_price NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending',
  paper BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  filled_at TIMESTAMPTZ
);
GRANT SELECT ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads orders" ON public.orders FOR SELECT TO authenticated USING (public.is_owner());
CREATE INDEX ON public.orders (created_at DESC);

-- Trades (closed round trips)
CREATE TABLE public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  entry_price NUMERIC NOT NULL,
  exit_price NUMERIC NOT NULL,
  pnl_usd NUMERIC NOT NULL,
  paper BOOLEAN NOT NULL DEFAULT true,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.trades TO authenticated;
GRANT ALL ON public.trades TO service_role;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads trades" ON public.trades FOR SELECT TO authenticated USING (public.is_owner());
CREATE INDEX ON public.trades (closed_at DESC);

-- Positions
CREATE TABLE public.positions (
  symbol TEXT PRIMARY KEY,
  qty NUMERIC NOT NULL DEFAULT 0,
  avg_entry_price NUMERIC NOT NULL DEFAULT 0,
  paper BOOLEAN NOT NULL DEFAULT true,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.positions TO authenticated;
GRANT ALL ON public.positions TO service_role;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads positions" ON public.positions FOR SELECT TO authenticated USING (public.is_owner());

-- Activity log
CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warn','error')),
  message TEXT NOT NULL,
  context JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads activity_log" ON public.activity_log FOR SELECT TO authenticated USING (public.is_owner());
CREATE INDEX ON public.activity_log (created_at DESC);

-- Claim ownership function (first signup wins; subsequent calls no-op)
CREATE OR REPLACE FUNCTION public.claim_ownership()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  claimed BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RETURN FALSE; END IF;
  INSERT INTO public.owner (id, user_id) VALUES (true, auth.uid())
    ON CONFLICT (id) DO NOTHING;
  SELECT (user_id = auth.uid()) INTO claimed FROM public.owner WHERE id = true;
  RETURN COALESCE(claimed, FALSE);
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_ownership() TO authenticated;
