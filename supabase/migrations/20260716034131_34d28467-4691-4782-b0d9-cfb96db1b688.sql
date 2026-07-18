UPDATE public.live_runners SET leverage = 70 WHERE running = false;
ALTER TABLE public.live_runners ALTER COLUMN leverage SET DEFAULT 70;