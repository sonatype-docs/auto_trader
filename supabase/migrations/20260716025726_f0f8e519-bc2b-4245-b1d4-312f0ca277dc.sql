ALTER TABLE public.live_runners ALTER COLUMN leverage SET DEFAULT 75;
UPDATE public.live_runners SET leverage = 75 WHERE running = false;