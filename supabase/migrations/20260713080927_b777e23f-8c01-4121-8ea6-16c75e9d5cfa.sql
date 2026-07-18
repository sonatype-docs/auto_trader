ALTER TABLE public.strategy_settings ADD COLUMN IF NOT EXISTS fee_usd_per_order numeric NOT NULL DEFAULT 0;
ALTER TABLE public.strategy_settings ADD COLUMN IF NOT EXISTS zone_source text NOT NULL DEFAULT 'range';
ALTER TABLE public.strategy_settings DROP CONSTRAINT IF EXISTS strategy_settings_zone_source_check;
ALTER TABLE public.strategy_settings ADD CONSTRAINT strategy_settings_zone_source_check CHECK (zone_source IN ('range','breakout'));
ALTER TABLE public.strategy_settings ADD COLUMN IF NOT EXISTS data_source text NOT NULL DEFAULT 'shark';
ALTER TABLE public.strategy_settings DROP CONSTRAINT IF EXISTS strategy_settings_data_source_check;
ALTER TABLE public.strategy_settings ADD CONSTRAINT strategy_settings_data_source_check CHECK (data_source IN ('shark','yahoo'));
ALTER TABLE public.strategy_settings ADD COLUMN IF NOT EXISTS skip_weekdays smallint[] NOT NULL DEFAULT ARRAY[6]::smallint[];