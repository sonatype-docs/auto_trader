
CREATE TABLE public.strategy_settings (
  id boolean PRIMARY KEY DEFAULT true,
  enabled boolean NOT NULL DEFAULT false,
  symbol text NOT NULL DEFAULT 'XAUUSDT',
  sl_risk_usd numeric NOT NULL DEFAULT 20,
  rr numeric NOT NULL DEFAULT 3,
  session_start_ist time NOT NULL DEFAULT '05:30',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_settings_singleton CHECK (id = true)
);
GRANT SELECT, INSERT, UPDATE ON public.strategy_settings TO authenticated;
GRANT ALL ON public.strategy_settings TO service_role;
ALTER TABLE public.strategy_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads strategy_settings" ON public.strategy_settings FOR SELECT TO authenticated USING (is_owner());
CREATE POLICY "owner inserts strategy_settings" ON public.strategy_settings FOR INSERT TO authenticated WITH CHECK (is_owner());
CREATE POLICY "owner writes strategy_settings" ON public.strategy_settings FOR UPDATE TO authenticated USING (is_owner()) WITH CHECK (is_owner());
INSERT INTO public.strategy_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE public.strategy_sessions (
  ist_date date PRIMARY KEY,
  symbol text NOT NULL,
  zone_high numeric NOT NULL,
  zone_low numeric NOT NULL,
  fib_25 numeric NOT NULL,
  fib_75 numeric NOT NULL,
  break_side text,
  break_detected_at timestamptz,
  break_close_price numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_sessions_break_side_check CHECK (break_side IS NULL OR break_side IN ('long','short'))
);
GRANT SELECT ON public.strategy_sessions TO authenticated;
GRANT ALL ON public.strategy_sessions TO service_role;
ALTER TABLE public.strategy_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads strategy_sessions" ON public.strategy_sessions FOR SELECT TO authenticated USING (is_owner());

CREATE TABLE public.strategy_setups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ist_date date NOT NULL,
  symbol text NOT NULL,
  side text NOT NULL CHECK (side IN ('long','short')),
  entry_price numeric NOT NULL,
  sl_price numeric NOT NULL,
  tp_price numeric NOT NULL,
  qty numeric NOT NULL,
  status text NOT NULL DEFAULT 'armed' CHECK (status IN ('armed','triggered','closed','expired','cancelled')),
  order_id uuid,
  close_order_id uuid,
  close_reason text CHECK (close_reason IS NULL OR close_reason IN ('tp','sl','session_end','manual')),
  pnl_usd numeric,
  filled_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX strategy_setups_active_idx ON public.strategy_setups (ist_date, status);
GRANT SELECT ON public.strategy_setups TO authenticated;
GRANT ALL ON public.strategy_setups TO service_role;
ALTER TABLE public.strategy_setups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads strategy_setups" ON public.strategy_setups FOR SELECT TO authenticated USING (is_owner());
