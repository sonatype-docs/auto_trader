// The Complete XAU/USD Quantitative Research Handbook — strategy registry.
// Every volume + strategy lives here. Strategies with `status: "full"` render
// their dedicated content component; others render the standard section
// template stub via /handbook/$volume/$strategy.

export type StrategyStatus = "full" | "stub" | "planned";

export interface StrategyEntry {
  slug: string;
  title: string;
  subtitle: string;
  status: StrategyStatus;
}

export interface VolumeEntry {
  slug: string;
  number: number;
  title: string;
  intro: string;
  strategies: StrategyEntry[];
}

export const HANDBOOK: VolumeEntry[] = [
  {
    slug: "v1",
    number: 1,
    title: "Opening Range Strategies",
    intro:
      "Time-based liquidity: the first hour after a major session open sets the intraday directional bias. Statistically testable and easiest to automate.",
    strategies: [
      { slug: "london-orb", title: "London Opening Range Breakout", subtitle: "08:00 UTC · gold's deepest OTC liquidity event", status: "full" },
      { slug: "ny-orb", title: "New York Opening Range Breakout", subtitle: "13:30 UTC · US session ignition", status: "stub" },
      { slug: "asian-range", title: "Asian Range Breakout", subtitle: "00:00–07:00 UTC · overnight consolidation", status: "stub" },
      { slug: "initial-balance", title: "Initial Balance Strategy", subtitle: "First 60 min of RTH · pit-session heritage", status: "stub" },
      { slug: "daily-opening-range", title: "Daily Opening Range", subtitle: "First N minutes of the trading day", status: "stub" },
      { slug: "fib-530", title: "5:30 IST 1H Fibonacci OR", subtitle: "Our house strategy · 1H opening candle + 25/75 fib entry", status: "stub" },
      { slug: "frvp", title: "Fixed Range Volume Profile Breakout", subtitle: "POC / VAH / VAL breakouts", status: "stub" },
    ],
  },
  {
    slug: "v2",
    number: 2,
    title: "Smart Money Concepts",
    intro:
      "Order-flow narratives translated into rules: liquidity, structure shifts, and institutional footprints.",
    strategies: [
      { slug: "liquidity-sweep", title: "Liquidity Sweep", subtitle: "Stop-run then reverse", status: "stub" },
      { slug: "bos", title: "Break of Structure (BOS)", subtitle: "Trend continuation confirmation", status: "stub" },
      { slug: "mss", title: "Market Structure Shift (MSS)", subtitle: "Trend reversal signal", status: "stub" },
      { slug: "choch", title: "Change of Character (CHOCH)", subtitle: "Early reversal confirmation", status: "stub" },
      { slug: "order-blocks", title: "Order Blocks", subtitle: "Last opposing candle before impulse", status: "stub" },
      { slug: "fair-value-gap", title: "Fair Value Gap (FVG)", subtitle: "3-candle imbalance retest", status: "stub" },
      { slug: "ifvg", title: "Inverse FVG (IFVG)", subtitle: "Invalidated FVG flip", status: "stub" },
      { slug: "breaker-blocks", title: "Breaker Blocks", subtitle: "Failed OB flip", status: "stub" },
      { slug: "mitigation-blocks", title: "Mitigation Blocks", subtitle: "Loss-covering entries", status: "stub" },
      { slug: "turtle-soup", title: "Turtle Soup", subtitle: "Failed breakout reversal", status: "stub" },
      { slug: "judas-swing", title: "Judas Swing", subtitle: "False open-direction move", status: "stub" },
    ],
  },
  {
    slug: "v3",
    number: 3,
    title: "Trend Following",
    intro: "Ride sustained directional flows with disciplined pullback or breakout entries.",
    strategies: [
      { slug: "ema-pullback", title: "EMA Pullback", subtitle: "Trend continuation on 20/50 EMA", status: "stub" },
      { slug: "vwap-trend", title: "VWAP Trend", subtitle: "VWAP-anchored intraday follow", status: "stub" },
      { slug: "donchian-breakout", title: "Donchian Breakout", subtitle: "N-day high/low breakouts", status: "stub" },
      { slug: "turtle-trend", title: "Turtle Trend", subtitle: "20/55 channel · classic Dennis rules", status: "stub" },
      { slug: "atr-expansion", title: "ATR Expansion", subtitle: "Volatility ignition entries", status: "stub" },
      { slug: "supertrend", title: "Supertrend", subtitle: "ATR-based trailing regime filter", status: "stub" },
      { slug: "opening-drive", title: "Opening Drive", subtitle: "Uninterrupted move from the open", status: "stub" },
    ],
  },
  {
    slug: "v4",
    number: 4,
    title: "Mean Reversion",
    intro: "Fade extended moves back to value in balanced markets.",
    strategies: [
      { slug: "vwap-mean-reversion", title: "VWAP Mean Reversion", subtitle: "Fade N-sigma bands", status: "stub" },
      { slug: "volume-profile-rotation", title: "Volume Profile Rotation", subtitle: "VAH ↔ VAL round trips", status: "stub" },
      { slug: "poc-reversion", title: "POC Reversion", subtitle: "Return to Point of Control", status: "stub" },
      { slug: "bollinger-mean-reversion", title: "Bollinger Mean Reversion", subtitle: "20-SMA · 2σ fades", status: "stub" },
      { slug: "keltner-reversion", title: "Keltner Reversion", subtitle: "EMA + ATR bands", status: "stub" },
    ],
  },
  {
    slug: "v5",
    number: 5,
    title: "Institutional Filters",
    intro: "The bias overlays banks and CTAs stack on top of every intraday entry.",
    strategies: [
      { slug: "daily-bias", title: "Daily Bias", subtitle: "D1 trend as gatekeeper", status: "stub" },
      { slug: "weekly-bias", title: "Weekly Bias", subtitle: "W1 alignment for intraday", status: "stub" },
      { slug: "monthly-bias", title: "Monthly Bias", subtitle: "MN1 macro bias", status: "stub" },
      { slug: "prev-day-hl", title: "Previous Day High / Low", subtitle: "PDH / PDL magnets", status: "stub" },
      { slug: "prev-week-hl", title: "Previous Week High / Low", subtitle: "PWH / PWL sweeps", status: "stub" },
      { slug: "quarterly-open", title: "Quarterly Open", subtitle: "3-month reference price", status: "stub" },
      { slug: "monthly-open", title: "Monthly Open", subtitle: "MTD directional anchor", status: "stub" },
      { slug: "volume-clusters", title: "Volume Clusters", subtitle: "HVN / LVN interaction", status: "stub" },
    ],
  },
  {
    slug: "v6",
    number: 6,
    title: "Quantitative Research",
    intro: "The lab bench: validate every strategy above with real statistics before risking capital.",
    strategies: [
      { slug: "walk-forward", title: "Walk Forward Analysis", subtitle: "Rolling IS/OOS validation", status: "stub" },
      { slug: "monte-carlo", title: "Monte Carlo Simulation", subtitle: "Trade-order randomisation", status: "stub" },
      { slug: "heatmaps", title: "Parameter Heatmaps", subtitle: "2-D robustness surfaces", status: "stub" },
      { slug: "robustness", title: "Robustness Scoring", subtitle: "Composite fitness with penalties", status: "stub" },
      { slug: "ai-optimization", title: "AI Optimization", subtitle: "Genetic + surrogate search", status: "stub" },
      { slug: "feature-importance", title: "Feature Importance", subtitle: "Which variables actually matter", status: "stub" },
    ],
  },
];

export function findVolume(volumeSlug: string): VolumeEntry | null {
  return HANDBOOK.find((v) => v.slug === volumeSlug) ?? null;
}

export function findStrategy(
  volumeSlug: string,
  strategySlug: string,
): { volume: VolumeEntry; strategy: StrategyEntry } | null {
  const volume = findVolume(volumeSlug);
  if (!volume) return null;
  const strategy = volume.strategies.find((s) => s.slug === strategySlug);
  if (!strategy) return null;
  return { volume, strategy };
}
