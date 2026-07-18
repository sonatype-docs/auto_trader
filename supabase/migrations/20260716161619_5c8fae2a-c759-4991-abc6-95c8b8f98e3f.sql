
-- Add score column for research-based ranking
ALTER TABLE public.paper_runners ADD COLUMN IF NOT EXISTS score numeric;

-- Seed top-10 runners from historical trade_intelligence performance
-- (ranked by sharpe-like: mean(net_pnl)/stddev * sqrt(n), min 30 trades).
INSERT INTO public.paper_runners (label, source, symbol, timeframe, strategy_preset, exec_preset, risk_usd, lookback_days, score) VALUES
  ('BTC 1h London ORB',      'shark', 'BTCUSDT', '1h',  'london_orb',           'conservative_default', 20, 5, 100.0),
  ('BTC 5m VWAP',            'shark', 'BTCUSDT', '5m',  'vwap_mean_revert',     'conservative_default', 20, 5,  99.5),
  ('BTC 15m VWAP',           'shark', 'BTCUSDT', '15m', 'vwap_mean_revert',     'conservative_default', 20, 5,  94.6),
  ('BTC 45m London ORB',     'shark', 'BTCUSDT', '45m', 'london_orb',           'conservative_default', 20, 5,  87.1),
  ('BTC 15m London ORB',     'shark', 'BTCUSDT', '15m', 'london_orb',           'conservative_default', 20, 5,  81.4),
  ('BTC 30m London ORB',     'shark', 'BTCUSDT', '30m', 'london_orb',           'conservative_default', 20, 5,  79.5),
  ('BTC 10m VWAP',           'shark', 'BTCUSDT', '10m', 'vwap_mean_revert',     'conservative_default', 20, 5,  77.0),
  ('BTC 30m VWAP',           'shark', 'BTCUSDT', '30m', 'vwap_mean_revert',     'conservative_default', 20, 5,  76.1),
  ('BTC 3m Liquidity Sweep', 'shark', 'BTCUSDT', '3m',  'liquidity_sweep_long', 'conservative_default', 20, 5,  66.6),
  ('BTC 1h VWAP',            'shark', 'BTCUSDT', '1h',  'vwap_mean_revert',     'conservative_default', 20, 5,  64.1)
ON CONFLICT (symbol, timeframe, strategy_preset) DO UPDATE
  SET score = EXCLUDED.score,
      label = EXCLUDED.label;
