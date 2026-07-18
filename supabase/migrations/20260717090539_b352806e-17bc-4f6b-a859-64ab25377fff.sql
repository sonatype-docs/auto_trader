
DELETE FROM public.live_trades;
DELETE FROM public.live_runners;

INSERT INTO public.live_runners (label, source, symbol, timeframe, strategy_preset, exec_preset, risk_usd, lookback_days, running) VALUES
  ('XAU 30m London ORB (live)',        'shark', 'XAUUSDT', '30m', 'london_orb',           'conservative_default', 20, 10, false),
  ('XAU 10m VWAP (live)',              'shark', 'XAUUSDT', '10m', 'vwap_mean_revert',     'conservative_default', 20,  5, false),
  ('XAU 15m Liquidity Sweep (live)',   'shark', 'XAUUSDT', '15m', 'liquidity_sweep_long', 'conservative_default', 20,  5, false),
  ('BTC 1h London ORB (live)',         'shark', 'BTCUSDT', '1h',  'london_orb',           'conservative_default', 20, 10, false),
  ('BTC 45m London ORB (live)',        'shark', 'BTCUSDT', '45m', 'london_orb',           'conservative_default', 20, 10, false),
  ('BTC 5m VWAP (live)',               'shark', 'BTCUSDT', '5m',  'vwap_mean_revert',     'conservative_default', 20,  5, false);
