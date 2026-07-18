import type { StrategySection } from "@/components/handbook/strategy-page";

const H3 = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mt-4 mb-2">{children}</h3>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm leading-relaxed">{children}</p>
);
const UL = ({ children }: { children: React.ReactNode }) => (
  <ul className="my-2 list-disc pl-5 text-sm space-y-1">{children}</ul>
);
const Ratings = ({ stars }: { stars: number }) => (
  <span className="text-primary tracking-widest">
    {"★".repeat(stars)}
    <span className="text-muted-foreground/40">{"★".repeat(5 - stars)}</span>
  </span>
);
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-baseline gap-3 py-1 border-b border-dashed border-border/40 text-sm">
    <span className="font-mono w-40 shrink-0 text-muted-foreground">{k}</span>
    <span>{v}</span>
  </div>
);

export const LONDON_ORB_SECTIONS: StrategySection[] = [
  {
    id: "s1-theory",
    title: "Theory",
    body: (
      <>
        <P>
          The London Opening Range Breakout is one of the oldest institutional intraday
          strategies. Variations have been used by banks, prop firms and CTAs for decades
          precisely because London opens with the largest single increase in liquidity
          across the European day.
        </P>
        <P>
          When London opens, banks, hedge funds, commercial hedgers and gold refiners begin
          executing size. This produces <strong>direction, volume and volatility</strong>—not
          random noise. Gold reacts particularly well because London is the world's deepest
          OTC gold trading hub and physical fixings have historically centered there.
        </P>
        <P>
          The core assumption is deceptively simple: the first hour after the London open
          often establishes the intraday directional bias.
        </P>
        <H3>Timeframes</H3>
        <div className="not-prose grid gap-1 max-w-md">
          <Row k="5-minute" v={<Ratings stars={5} />} />
          <Row k="15-minute" v={<Ratings stars={5} />} />
          <Row k="1-hour" v={<Ratings stars={5} />} />
          <Row k="1-minute" v={<span className="text-red-500">Avoid — too much noise</span>} />
        </div>
        <H3>Instruments</H3>
        <div className="not-prose grid gap-1 max-w-md">
          <Row k="XAU/USD (Gold)" v={<Ratings stars={5} />} />
          <Row k="GBP/USD" v={<Ratings stars={5} />} />
          <Row k="EUR/USD" v={<Ratings stars={5} />} />
          <Row k="DAX" v={<Ratings stars={4} />} />
          <Row k="NASDAQ" v={<Ratings stars={4} />} />
          <Row k="BTC" v={<Ratings stars={2} />} />
        </div>
      </>
    ),
  },
  {
    id: "s2-market-logic",
    title: "Market Logic",
    body: (
      <>
        <H3>Psychology</H3>
        <P>Retail traders chase the breakout immediately. Professionals wait for confirmation or a pullback into value.</P>
        <H3>Flow</H3>
        <pre className="not-prose rounded bg-muted/40 border border-border/40 p-3 text-xs font-mono leading-relaxed overflow-x-auto">{`London Opens
    ↓
Opening Range Forms
    ↓
Liquidity Builds
    ↓
Breakout Occurs
    ↓
Pullback
    ↓
Trend Continues`}</pre>
        <H3>Best conditions</H3>
        <UL>
          <li>Trending regime (aligned EMAs on daily)</li>
          <li>Normal ATR — not compressed, not exploding</li>
          <li>Medium opening-range size (avoid the smallest and largest deciles)</li>
        </UL>
        <H3>Worst conditions</H3>
        <UL>
          <li>Huge opening range (already exhausted the day's move)</li>
          <li>Ultra-low ATR / holiday sessions</li>
          <li>Inside days vs previous session</li>
        </UL>
      </>
    ),
  },
  {
    id: "s3-professional-rules",
    title: "Professional Rules",
    body: (
      <>
        <H3>Step 1 — Define opening range</H3>
        <UL>
          <li>Range start & range end are configurable (UTC minutes-of-day)</li>
          <li>Standard: 08:00–09:00 UTC (first hour of London)</li>
          <li>Alternative: 08:00–08:30 (first 30 min) or 08:00–10:00 (extended)</li>
        </UL>
        <H3>Step 2 — Record</H3>
        <UL>
          <li>Opening high, opening low, opening mid</li>
          <li>OR size in points and % of prior daily ATR</li>
          <li>OR size vs 20-day OR average (relative)</li>
        </UL>
        <H3>Step 3 — Wait</H3>
        <P>No trades during range formation. Only after the range closes.</P>
        <H3>Entry variants</H3>
        <UL>
          <li><strong>A</strong> · Immediate wick break — first candle whose high/low pierces the range</li>
          <li><strong>B</strong> · Breakout-candle close outside the range (default; higher quality)</li>
          <li><strong>C</strong> · Retest of the range edge after the initial break</li>
          <li><strong>D</strong> · Liquidity sweep + reversal (SMC variant — planned)</li>
          <li><strong>E</strong> · MSS (Market Structure Shift) confirmation — planned</li>
          <li><strong>F</strong> · Order Block retest — planned</li>
          <li><strong>G</strong> · Fair Value Gap fill — planned</li>
        </UL>
        <p className="text-[11px] text-muted-foreground italic">
          Variants A/B/C are implemented in the live engine below. D–G land in phase 2.
        </p>
        <H3>Stop models</H3>
        <UL>
          <li>Opposite range edge (default, symmetric)</li>
          <li>% of OR height</li>
          <li>ATR multiple</li>
          <li>Fixed R (½ OR fallback)</li>
        </UL>
        <H3>Target models</H3>
        <UL>
          <li>Fixed RR (1.5 – 3.0 typical)</li>
          <li>Opposite range edge (measured move)</li>
          <li>ATR multiple</li>
        </UL>
      </>
    ),
  },
  {
    id: "s4-ai-prompt",
    title: "AI Implementation Prompt",
    body: (
      <>
        <P>
          Use the following prompt when asking an assistant to implement or extend this
          strategy in code:
        </P>
        <pre className="not-prose rounded bg-muted/40 border border-border/40 p-3 text-[11px] font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">{`Implement the London Opening Range Breakout on XAU/USD.

Data: 1H OHLC bars (yahoo GC=F or perp XAUUSDT).

Range: bars whose UTC open-minute is in [rangeStartUtc, rangeEndUtc).
Record high, low, mid, size (points), size % of daily ATR(14).

For each session day (skip configurable weekdays):
  1. Compute the range.
  2. Scan post-range bars up to entryCutoffUtc.
  3. Detect first break by entryVariant (immediate | break_close | retest).
  4. Reject via filters: trend (EMA20/50/200 vs prior close),
     ATR band, min break body %, min/max break distance % of OR.
  5. Compute SL by stopModel and TP by targetModel.
  6. Size qty = slRiskUsd / abs(entry - sl).
  7. Simulate hit-first TP/SL up to maxHoldHours or session end.
  8. Record MFE/MAE in R, PnL, hold time, time to fill.

Return per-trade log + summary + per-bucket analytics (OR size,
break distance, weekday, month, ATR band, break body %, entry hour).

Optimizer: grid over entryVariant × stopModel × targetModel/RR ×
trend × break-body filter. Score by net P&L with a 30% chronological
OOS split; penalise combos that break OOS.`}</pre>
      </>
    ),
  },
  {
    id: "s5-backtester-requirements",
    title: "Backtester Requirements",
    body: (
      <>
        <UL>
          <li>Configurable range start & end (UTC minutes)</li>
          <li>Weekday skip list, holiday calendar (planned)</li>
          <li>Independent entry / stop / target model selectors</li>
          <li>Hit-first TP/SL simulation (SL wins ties, conservative)</li>
          <li>MFE / MAE recording in R multiples per trade</li>
          <li>Per-day analytics: OR size, break distance, ATR, weekday, month, trend regime</li>
          <li>Equity curve + max drawdown from chronological trade order</li>
          <li>Snapshot save so the Compare hub can rank London ORB vs other engines</li>
        </UL>
        <P>
          The live backtester at the top of this page implements the above against the
          Yahoo Finance GC=F feed (~730 days of 1H bars). Toggle to Shark for the perp
          (~180 days).
        </P>
      </>
    ),
  },
  {
    id: "s6-optimizer",
    title: "Optimizer Variables",
    body: (
      <>
        <P>Every variable below is exposed on the backtester above:</P>
        <UL>
          <li>Range start / end / entry cutoff (UTC)</li>
          <li>Entry variant (A / B / C)</li>
          <li>Retest buffer (% of OR)</li>
          <li>Stop model (+ ATR mult, range %)</li>
          <li>Target model (+ RR, ATR mult)</li>
          <li>Trend filter (off / EMA20 / EMA50 / EMA200 / aligned)</li>
          <li>ATR band (min / max)</li>
          <li>Min break body % · Min/Max break distance % of OR</li>
          <li>SL risk $, max trades/day, max hold hours</li>
          <li>Weekday skip list, time-to-fill cutoff</li>
        </UL>
        <P>
          The <strong>Optimize</strong> button runs a grid sweep over the highest-impact
          axes (variant × stop × target × trend × body filter) and ranks presets by net
          P&L with a 30% out-of-sample split penalty.
        </P>
      </>
    ),
  },
  {
    id: "s7-analytics",
    title: "Analytics",
    body: (
      <>
        <P>The results panel breaks every run down by:</P>
        <UL>
          <li>Opening range size (small / medium / large terciles) → win rate, PF, avg R</li>
          <li>Break distance % of OR (near / mid / far)</li>
          <li>Weekday performance</li>
          <li>Month-of-year seasonality</li>
          <li>ATR band (low / mid / high)</li>
          <li>Break candle body strength (weak / mid / strong)</li>
          <li>Entry hour (UTC)</li>
          <li>Long vs short side edge</li>
        </UL>
        <H3>Advanced stats reported</H3>
        <UL>
          <li>MAE / MFE in R (per trade + averaged)</li>
          <li>Average and median hold time</li>
          <li>Average time-to-fill (relevant for retest variant)</li>
          <li>Max consecutive wins / losses</li>
          <li>Expectancy per trade</li>
          <li>Composite edge score (0-100)</li>
        </UL>
      </>
    ),
  },
  {
    id: "s8-statistical-filters",
    title: "Statistical Filters",
    body: (
      <>
        <P>
          Filters cut the sample only when they preserve edge on the out-of-sample slice.
          Never stack filters that individually shrink the trade count below ~50.
        </P>
        <UL>
          <li>EMA20 / EMA50 / EMA200 trend alignment</li>
          <li>Daily ATR(14) band — low band often trends better, high band often reverts</li>
          <li>Break candle body % ≥ threshold (rejects hollow wick breaks)</li>
          <li>Min break distance % of OR (require conviction beyond the edge)</li>
          <li>Max break distance % of OR (avoid chasing exhausted moves)</li>
          <li>Weekday skip (Sun/Sat by default for gold perp)</li>
          <li>Time-to-fill cutoff for the retest variant</li>
        </UL>
      </>
    ),
  },
  {
    id: "s9-enhancements",
    title: "Professional Enhancements",
    body: (
      <>
        <UL>
          <li>Move stop to break-even at +1R</li>
          <li>Scale out 50% at +1R, run the runner to opposite range or 2R</li>
          <li>Volatility-scaled position sizing (constant $ risk per trade at all ATRs)</li>
          <li>Session-of-week grid — some weekdays dominate net P&L on gold</li>
          <li>Daily bias filter using the prior day's H4 close</li>
          <li>Skip days with a scheduled US CPI / NFP / FOMC release inside the trade window</li>
          <li>Correlated confirmation from DXY / US10Y direction</li>
        </UL>
      </>
    ),
  },
  {
    id: "s10-common-mistakes",
    title: "Common Mistakes",
    body: (
      <>
        <UL>
          <li>Trading the immediate wick break in low-ATR sessions — mean-reverts most of the time</li>
          <li>Using an ATR-multiple stop with the range-edge target — mismatched R geometry</li>
          <li>Optimising win rate instead of expectancy — 70% win rates with 0.4R produce nothing</li>
          <li>Not skipping high-impact news windows inside the trade cutoff</li>
          <li>Backtesting on the perp only (180d) and calling it validated — always cross-check the 730d Yahoo feed</li>
          <li>Stacking too many filters until the sample size drops below statistical significance</li>
          <li>Ignoring hold-time distribution — a strategy that averages 10h isn't intraday</li>
        </UL>
      </>
    ),
  },
  {
    id: "s11-future-research",
    title: "Future Research",
    body: (
      <>
        <UL>
          <li>Feature importance across every variable via permutation importance</li>
          <li>Auto-detection of range-formation regime shifts (Bayesian change-points)</li>
          <li>Volume-profile POC as a secondary entry filter</li>
          <li>NY-open confluence — long London breaks only when NY confirms same-side</li>
          <li>Higher-timeframe FVG magnet as target instead of fixed RR</li>
          <li>Reinforcement-learning agent trained on the per-bucket analytics as state</li>
          <li>Walk-forward re-optimisation on a rolling 90-day window</li>
        </UL>
      </>
    ),
  },
];
