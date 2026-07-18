// Client-callable server functions for the LIVE trading dashboard.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export interface LiveRunnerDTO {
  id: string;
  label: string;
  source: string;
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  exec_preset: string;
  risk_usd: number;
  leverage: number;
  lookback_days: number;
  running: boolean;
  started_at: string | null;
  last_tick_at: string | null;
  last_tick_error: string | null;
}

export interface LiveTradeDTO {
  id: string;
  runner_id: string;
  client_order_id: string | null;
  symbol: string;
  timeframe: string;
  direction: string;
  qty: number;
  entry_ts: string;
  entry_price: number;
  fill_price: number | null;
  stop_price: number;
  target_price: number;
  exit_ts: string | null;
  exit_price: number | null;
  exit_reason: string | null;
  rr: number | null;
  net_pnl: number | null;
  status: string;
  error: string | null;
}

export const listLiveRunners = createServerFn({ method: "GET" }).handler(async (): Promise<LiveRunnerDTO[]> => {
  const s = await admin();
  const { data, error } = await s.from("live_runners").select("*").order("label");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LiveRunnerDTO[];
});

export const listLiveTrades = createServerFn({ method: "GET" })
  .inputValidator((raw) => z.object({ limit: z.number().int().min(1).max(2000).default(500) }).parse(raw))
  .handler(async ({ data }): Promise<LiveTradeDTO[]> => {
    const s = await admin();
    const { data: rows, error } = await s
      .from("live_trades").select("*")
      .order("entry_ts", { ascending: false }).limit(data.limit);
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as LiveTradeDTO[];
  });

export const setLiveRunnerRunning = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ id: z.string().uuid(), running: z.boolean() }).parse(raw))
  .handler(async ({ data }) => {
    const s = await admin();
    const patch = data.running
      ? { running: true, started_at: new Date().toISOString(), last_tick_error: null }
      : { running: false };
    const { error } = await s.from("live_runners").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateLiveRunner = createServerFn({ method: "POST" })
  .inputValidator((raw) =>
    z.object({
      id: z.string().uuid(),
      risk_usd: z.number().positive().max(10_000).optional(),
      leverage: z.number().int().min(1).max(200).optional(),
    }).parse(raw),
  )
  .handler(async ({ data }) => {
    const s = await admin();
    const patch: { risk_usd?: number; leverage?: number } = {};
    if (data.risk_usd != null) patch.risk_usd = data.risk_usd;
    if (data.leverage != null) patch.leverage = data.leverage;
    const { error } = await s.from("live_runners").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testLiveConnection = createServerFn({ method: "POST" }).handler(async () => {
  const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
  const client = createSharkClient();
  try {
    const r = await client.testConnection();
    return { ok: r.ok, status: r.status, message: r.message };
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : String(e) };
  }
});

export const runLiveTickNow = createServerFn({ method: "POST" }).handler(async () => {
  const { runLiveTradingTick } = await import("@/lib/live-trading/tick.server");
  return await runLiveTradingTick();
});

/**
 * Import the top-N paper runners (ranked by score) into live_runners.
 * - Idempotent: matches an existing live runner by
 *   (strategy_preset + symbol + timeframe + exec_preset). If found, updates
 *   risk/lookback/source in place. Otherwise inserts a new row with
 *   running=false and a sensible default leverage (5x).
 * - Never flips `running` on for you — safety.
 * - Also propagates the paper runner label with a "(live)" suffix on create.
 */
export const importTopPaperRunnersToLive = createServerFn({ method: "POST" })
  .inputValidator((raw) =>
    z.object({
      topN: z.number().int().min(1).max(50).default(10),
      leverage: z.number().int().min(1).max(200).default(5),
    }).parse(raw),
  )
  .handler(async ({ data }): Promise<{
    imported: number;
    updated: number;
    inserted: number;
    runners: Array<{ label: string; symbol: string; strategy_preset: string; action: "inserted" | "updated" }>;
  }> => {
    const s = await admin();
    const { data: top, error } = await s
      .from("paper_runners")
      .select("label, source, symbol, timeframe, strategy_preset, exec_preset, risk_usd, lookback_days, score")
      .order("score", { ascending: false, nullsFirst: false })
      .order("running", { ascending: false })
      .limit(data.topN);
    if (error) throw new Error(error.message);

    const { data: existingLive } = await s
      .from("live_runners")
      .select("id, symbol, timeframe, strategy_preset, exec_preset");

    const results: Array<{ label: string; symbol: string; strategy_preset: string; action: "inserted" | "updated" }> = [];
    let inserted = 0;
    let updated = 0;

    for (const p of top ?? []) {
      const match = (existingLive ?? []).find(
        (l) =>
          l.symbol === p.symbol &&
          l.timeframe === p.timeframe &&
          l.strategy_preset === p.strategy_preset &&
          l.exec_preset === p.exec_preset,
      );
      if (match) {
        const { error: uerr } = await s
          .from("live_runners")
          .update({
            source: p.source,
            risk_usd: p.risk_usd,
            lookback_days: p.lookback_days,
          })
          .eq("id", match.id);
        if (uerr) throw new Error(uerr.message);
        updated += 1;
        results.push({ label: p.label, symbol: p.symbol, strategy_preset: p.strategy_preset, action: "updated" });
      } else {
        const { error: ierr } = await s.from("live_runners").insert({
          label: `${p.label} (live)`,
          source: p.source,
          symbol: p.symbol,
          timeframe: p.timeframe,
          strategy_preset: p.strategy_preset,
          exec_preset: p.exec_preset,
          risk_usd: p.risk_usd,
          lookback_days: p.lookback_days,
          leverage: data.leverage,
          running: false,
        });
        if (ierr) throw new Error(ierr.message);
        inserted += 1;
        results.push({ label: p.label, symbol: p.symbol, strategy_preset: p.strategy_preset, action: "inserted" });
      }
    }

    return { imported: results.length, inserted, updated, runners: results };
  });

export interface RuleCheckDTO {
  group: "session" | "trend" | "volatility" | "setup" | "entry" | "risk";
  label: string;
  requirement: string;
  actual: string;
  pass: boolean;
}

export interface RunnerDiagnosticsDTO {
  runner_id: string;
  label: string;
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  running: boolean;
  windowActive: boolean;
  nextOpenMinutes: number | null;
  barsProcessed: number;
  setupsDetected: number;
  signalsCreated: number;
  signalsInvalidated: number;
  filterRejects: Array<{ label: string; count: number }>;
  rules: RuleCheckDTO[];
  lastBar: {
    ts: number;
    close: number;
    session: string;
    checks: Array<{ label: string; pass: boolean; reason?: string }>;
  } | null;
  pending: {
    direction: string;
    entryPrice: number;
    stop: number;
    target: number;
    ageBars: number;
  } | null;
  lastSignal: {
    ts: number;
    direction: string;
    type: string;
    entryPrice: number;
    stop: number;
    target: number;
    strength: number;
  } | null;
  error: string | null;
}

export const diagnoseLiveRunners = createServerFn({ method: "POST" }).handler(
  async (): Promise<RunnerDiagnosticsDTO[]> => {
    const s = await admin();
    const { data: runners, error } = await s
      .from("live_runners")
      .select("id, label, source, symbol, timeframe, strategy_preset, exec_preset, risk_usd, lookback_days, running")
      .order("label");
    if (error) throw new Error(error.message);

    const [
      { loadRawCandles },
      { enrichCandles },
      { DEFAULT_CONFIG },
      { runStrategy },
      { STRATEGY_PRESETS },
      { evalSessionFilter, evalTrendFilter, evalVolatilityFilter },
      { windowsForPreset, isWindowActive, minutesUntilOpen },
    ] = await Promise.all([
      import("@/lib/market-data/loader.server"),
      import("@/lib/market-data/enrich"),
      import("@/lib/market-data/types"),
      import("@/lib/strategy-engine/engine"),
      import("@/lib/strategy-engine/presets"),
      import("@/lib/strategy-engine/filters"),
      import("@/lib/session-windows"),
    ]);

    const out: RunnerDiagnosticsDTO[] = [];
    for (const r of runners ?? []) {
      const base: RunnerDiagnosticsDTO = {
        runner_id: r.id, label: r.label, symbol: r.symbol, timeframe: r.timeframe,
        strategy_preset: r.strategy_preset, running: r.running,
        windowActive: false, nextOpenMinutes: null,
        barsProcessed: 0, setupsDetected: 0, signalsCreated: 0, signalsInvalidated: 0,
        filterRejects: [], rules: [], lastBar: null, pending: null, lastSignal: null, error: null,
      };
      try {
        const windows = windowsForPreset(r.strategy_preset);
        base.windowActive = windows.length === 0 || windows.some(isWindowActive);
        if (!base.windowActive && windows.length > 0) {
          const m = windows.reduce<number>(
            (acc, w) => Math.min(acc, minutesUntilOpen(w)),
            Number.POSITIVE_INFINITY,
          );
          base.nextOpenMinutes = Number.isFinite(m) ? m : null;
        }

        const scfg = STRATEGY_PRESETS[r.strategy_preset as keyof typeof STRATEGY_PRESETS];
        if (!scfg) throw new Error(`Unknown strategy preset ${r.strategy_preset}`);

        const toMs = Date.now();
        const fromMs = toMs - Number(r.lookback_days) * 24 * 60 * 60 * 1000;
        const { candles } = await loadRawCandles({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          source: r.source as any,
          symbol: r.symbol,
          timeframe: r.timeframe as never,
          fromMs, toMs,
        });
        if (candles.length) {
          const enriched = enrichCandles(candles, {
            ...DEFAULT_CONFIG, symbol: r.symbol, timeframe: r.timeframe as never,
          });
          const sres = runStrategy(enriched, scfg, { mode: "live", symbol: r.symbol });
          base.barsProcessed = sres.stats.barsProcessed;
          base.setupsDetected = sres.stats.setupsDetected;
          base.signalsCreated = sres.stats.signalsCreated;
          base.signalsInvalidated = sres.stats.signalsInvalidated;
          base.filterRejects = Object.entries(sres.stats.filterRejects)
            .map(([label, count]) => ({ label, count: count as number }))
            .sort((a, b) => b.count - a.count).slice(0, 10);

          const last = enriched[enriched.length - 1];
          const prev = enriched[enriched.length - 2] ?? null;
          const idx = enriched.length - 1;
          const checks = [
            evalSessionFilter(last, scfg.session),
            evalTrendFilter(last, enriched, idx, scfg.trend),
            evalVolatilityFilter(last, prev, scfg.volatility),
          ].map((c) => ({ label: c.label, pass: c.pass, reason: c.reason }));
          base.lastBar = { ts: last.ts, close: last.close, session: last.session, checks };
          base.rules = buildRuleChecks(scfg, last, prev);

          const ls = sres.signals[sres.signals.length - 1];
          if (ls) {
            base.lastSignal = {
              ts: ls.timestamp, direction: ls.direction, type: ls.type,
              entryPrice: ls.entryPrice, stop: ls.stopLoss, target: ls.takeProfit,
              strength: ls.signalStrength,
            };
          }
          const invIds = new Set(sres.invalidated.map((x) => x.signalId));
          const filledIds = new Set(
            sres.events.filter((e) => e.name === "OnTradeFilled").map((e) => e.data.signalId as string),
          );
          const pendingSig = [...sres.signals].reverse().find(
            (sig) => sig.type !== "BUY" && sig.type !== "SELL"
              && !invIds.has(sig.signalId) && !filledIds.has(sig.signalId),
          );
          if (pendingSig) {
            const detectedIdx = enriched.findIndex((b) => b.ts === pendingSig.timestamp);
            base.pending = {
              direction: pendingSig.direction, entryPrice: pendingSig.entryPrice,
              stop: pendingSig.stopLoss, target: pendingSig.takeProfit,
              ageBars: detectedIdx >= 0 ? enriched.length - 1 - detectedIdx : 0,
            };
          }
        }
      } catch (e) {
        base.error = e instanceof Error ? e.message : String(e);
      }
      out.push(base);
    }
    return out;
  },
);

export const cancelLiveOrder = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ trade_id: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    const s = await admin();
    const { data: row, error } = await s.from("live_trades")
      .select("client_order_id").eq("id", data.trade_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.client_order_id) throw new Error("No exchange order id on this trade");
    const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
    const client = createSharkClient();
    const res = await client.cancelOrder(row.client_order_id);
    await s.from("live_trades").update({
      status: "cancelled",
      exit_ts: new Date().toISOString(),
      exit_reason: "manual_cancel",
    }).eq("id", data.trade_id);
    return { ok: res.ok, status: res.status };
  });

// ---------- Rule builder ----------
// Turns the preset config into a human-readable requirement/actual/pass table
// evaluated against the latest enriched bar. Kept as a plain function so it
// stays SSR-serializable and easy to extend.
type AnyBar = {
  close: number; session: string; hour: number; weekday: number;
  isWeekend: boolean; isHoliday: boolean;
  ema20: number | null; ema50: number | null; ema100: number | null; ema200: number | null;
  vwapDaily: number | null; adx: number | null;
  atr: number | null; atrPercentile: number | null;
};
function fmt(n: number | null | undefined, d = 2) {
  return n == null || !Number.isFinite(n) ? "—" : Number(n).toFixed(d);
}
function buildRuleChecks(
  scfg: import("@/lib/strategy-engine/types").StrategyConfig,
  last: AnyBar,
  prev: AnyBar | null,
): RuleCheckDTO[] {
  const rules: RuleCheckDTO[] = [];
  const sess = scfg.session;
  if (sess?.allowedSessions?.length) {
    const pass = sess.allowedSessions.includes(last.session as never);
    rules.push({
      group: "session", label: "Allowed session",
      requirement: sess.allowedSessions.join(" / "),
      actual: last.session, pass,
    });
  }
  if (sess?.allowedWeekdays?.length) {
    const pass = sess.allowedWeekdays.includes(last.weekday);
    rules.push({
      group: "session", label: "Allowed weekday",
      requirement: sess.allowedWeekdays.join(","),
      actual: String(last.weekday), pass,
    });
  }
  if (sess?.hoursOfDay?.length) {
    const pass = sess.hoursOfDay.includes(last.hour);
    rules.push({
      group: "session", label: "Hour of day",
      requirement: sess.hoursOfDay.join(","),
      actual: String(last.hour), pass,
    });
  }
  if (sess?.blockWeekend) {
    rules.push({
      group: "session", label: "Block weekend",
      requirement: "not weekend", actual: last.isWeekend ? "weekend" : "weekday",
      pass: !last.isWeekend,
    });
  }
  if (sess?.blockHoliday) {
    rules.push({
      group: "session", label: "Block holiday",
      requirement: "not holiday", actual: last.isHoliday ? "holiday" : "trading day",
      pass: !last.isHoliday,
    });
  }

  const tr = scfg.trend;
  const emaKey = (n: number): keyof AnyBar | null =>
    n === 20 ? "ema20" : n === 50 ? "ema50" : n === 100 ? "ema100" : n === 200 ? "ema200" : null;
  if (tr?.emaAlignment?.above?.length) {
    for (const len of tr.emaAlignment.above) {
      const k = emaKey(len); if (!k) continue;
      const v = last[k] as number | null;
      const pass = v !== null && last.close > v;
      rules.push({
        group: "trend", label: `Close > EMA${len}`,
        requirement: `close > EMA${len}`,
        actual: `close ${fmt(last.close)} vs EMA${len} ${fmt(v)}`,
        pass,
      });
    }
  }
  if (tr?.emaAlignment?.below?.length) {
    for (const len of tr.emaAlignment.below) {
      const k = emaKey(len); if (!k) continue;
      const v = last[k] as number | null;
      const pass = v !== null && last.close < v;
      rules.push({
        group: "trend", label: `Close < EMA${len}`,
        requirement: `close < EMA${len}`,
        actual: `close ${fmt(last.close)} vs EMA${len} ${fmt(v)}`,
        pass,
      });
    }
  }
  if (tr?.vwapSide && last.vwapDaily !== null) {
    const pass = tr.vwapSide === "above" ? last.close > last.vwapDaily : last.close < last.vwapDaily;
    rules.push({
      group: "trend", label: `Price ${tr.vwapSide} VWAP`,
      requirement: `close ${tr.vwapSide === "above" ? ">" : "<"} VWAP`,
      actual: `close ${fmt(last.close)} vs VWAP ${fmt(last.vwapDaily)}`,
      pass,
    });
  }
  if (tr?.adxMin !== undefined) {
    const pass = last.adx !== null && last.adx >= tr.adxMin;
    rules.push({
      group: "trend", label: "ADX minimum",
      requirement: `ADX ≥ ${tr.adxMin}`,
      actual: `ADX ${fmt(last.adx, 1)}`, pass,
    });
  }
  if (tr?.adxMax !== undefined) {
    const pass = last.adx !== null && last.adx <= tr.adxMax;
    rules.push({
      group: "trend", label: "ADX maximum (chop)",
      requirement: `ADX ≤ ${tr.adxMax}`,
      actual: `ADX ${fmt(last.adx, 1)}`, pass,
    });
  }

  const v = scfg.volatility;
  if (v?.atrMin !== undefined) {
    const pass = last.atr !== null && last.atr >= v.atrMin;
    rules.push({
      group: "volatility", label: "ATR minimum",
      requirement: `ATR ≥ ${v.atrMin}`, actual: `ATR ${fmt(last.atr)}`, pass,
    });
  }
  if (v?.atrMax !== undefined) {
    const pass = last.atr !== null && last.atr <= v.atrMax;
    rules.push({
      group: "volatility", label: "ATR maximum",
      requirement: `ATR ≤ ${v.atrMax}`, actual: `ATR ${fmt(last.atr)}`, pass,
    });
  }
  if (v?.atrPercentileMin !== undefined) {
    const pass = last.atrPercentile !== null && last.atrPercentile >= v.atrPercentileMin;
    rules.push({
      group: "volatility", label: "ATR percentile min",
      requirement: `ATR pct ≥ ${v.atrPercentileMin}`,
      actual: `ATR pct ${fmt(last.atrPercentile, 0)}`, pass,
    });
  }
  if (v?.atrPercentileMax !== undefined) {
    const pass = last.atrPercentile !== null && last.atrPercentile <= v.atrPercentileMax;
    rules.push({
      group: "volatility", label: "ATR percentile max",
      requirement: `ATR pct ≤ ${v.atrPercentileMax}`,
      actual: `ATR pct ${fmt(last.atrPercentile, 0)}`, pass,
    });
  }
  if (v?.requireExpansion) {
    const pass = prev?.atr != null && last.atr != null && last.atr > prev.atr;
    rules.push({
      group: "volatility", label: "ATR expanding",
      requirement: "ATR > prev ATR",
      actual: `${fmt(last.atr)} vs ${fmt(prev?.atr ?? null)}`, pass,
    });
  }
  if (v?.requireCompression) {
    const pass = prev?.atr != null && last.atr != null && last.atr < prev.atr;
    rules.push({
      group: "volatility", label: "ATR compressing",
      requirement: "ATR < prev ATR",
      actual: `${fmt(last.atr)} vs ${fmt(prev?.atr ?? null)}`, pass,
    });
  }

  // Setup / entry are informational — the trade only triggers if the setup
  // detector matches on this bar, which lives inside the engine. Surface the
  // required setup kind so the user sees what pattern we're hunting.
  if (scfg.setup?.kind) {
    rules.push({
      group: "setup", label: "Setup pattern",
      requirement: scfg.setup.kind.replace(/_/g, " "),
      actual: "detected in engine stats", pass: true,
    });
  }
  if (scfg.entry?.model?.kind) {
    rules.push({
      group: "entry", label: "Entry model",
      requirement: scfg.entry.model.kind,
      actual: "—", pass: true,
    });
  }
  if (scfg.management?.maxDailyTrades) {
    rules.push({
      group: "risk", label: "Max daily trades",
      requirement: `≤ ${scfg.management.maxDailyTrades}/day`,
      actual: "engine-enforced", pass: true,
    });
  }
  return rules;
}

// ---------- Live chart data ----------
export interface ChartCandleDTO { t: number; o: number; h: number; l: number; c: number; v: number }
export interface ChartSeriesPointDTO { t: number; v: number | null }
export interface ChartSeriesDTO {
  vwap: ChartSeriesPointDTO[];
  ema20: ChartSeriesPointDTO[];
  ema50: ChartSeriesPointDTO[];
  ema200: ChartSeriesPointDTO[];
  adx: ChartSeriesPointDTO[];
  atr: ChartSeriesPointDTO[];
}
export interface ChartMarkerDTO {
  time: number;
  kind: "setup" | "signal_long" | "signal_short" | "invalidated";
  label: string;
}
export interface ActiveTradeDTO {
  id: string;
  direction: string;
  qty: number;
  entry_price: number;
  fill_price: number | null;
  stop_price: number;
  target_price: number;
  entry_ts: string;
  status: string;
}
export interface PlanRuleDTO {
  group: string;
  label: string;
  requirement: string;
  actual: string;
  pass: boolean;
}
export interface RecentSetupDTO {
  ts: number;
  kind: string;
  direction: string;
  level: number | null;
}
export interface LiveChartDataDTO {
  runner_id: string;
  label: string;
  symbol: string;
  timeframe: string;         // display TF (may differ from runner TF)
  runnerTimeframe: string;   // strategy's native TF
  strategy_preset: string;
  candles: ChartCandleDTO[];
  series: ChartSeriesDTO;
  markers: ChartMarkerDTO[];
  activeTrade: ActiveTradeDTO | null;
  pendingSignal: {
    direction: string;
    entryPrice: number;
    stop: number;
    target: number;
    ts: number;
  } | null;
  lastPrice: number | null;
  fetchedAt: number;
  plan: {
    windowActive: boolean;
    nextOpenMinutes: number | null;
    rules: PlanRuleDTO[];
    passCount: number;
    failCount: number;
    blockingReasons: string[];
    recentSetups: RecentSetupDTO[];
    setupsDetected: number;
    signalsCreated: number;
    signalsInvalidated: number;
    lastBar: { ts: number; close: number; session: string } | null;
  };
}


const DISPLAY_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;

export const getLiveChartData = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({
    runner_id: z.string().uuid(),
    bars: z.number().int().min(50).max(500).default(200),
    timeframe: z.enum(DISPLAY_TIMEFRAMES).optional(),
  }).parse(raw))
  .handler(async ({ data }): Promise<LiveChartDataDTO> => {
    const s = await admin();
    const { data: r, error } = await s
      .from("live_runners")
      .select("id, label, source, symbol, timeframe, strategy_preset, lookback_days")
      .eq("id", data.runner_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) throw new Error("Runner not found");

    const [
      { loadRawCandles }, { enrichCandles }, { DEFAULT_CONFIG },
      { runStrategy }, { STRATEGY_PRESETS },
      { evalSessionFilter, evalTrendFilter, evalVolatilityFilter },
      { windowsForPreset, isWindowActive, minutesUntilOpen },
    ] = await Promise.all([
      import("@/lib/market-data/loader.server"),
      import("@/lib/market-data/enrich"),
      import("@/lib/market-data/types"),
      import("@/lib/strategy-engine/engine"),
      import("@/lib/strategy-engine/presets"),
      import("@/lib/strategy-engine/filters"),
      import("@/lib/session-windows"),
    ]);


    const scfg = STRATEGY_PRESETS[r.strategy_preset as keyof typeof STRATEGY_PRESETS];
    if (!scfg) throw new Error(`Unknown strategy preset ${r.strategy_preset}`);

    const toMs = Date.now();
    const fromMs = toMs - Math.max(2, Number(r.lookback_days)) * 24 * 60 * 60 * 1000;
    const { candles } = await loadRawCandles({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      source: r.source as any, symbol: r.symbol,
      timeframe: r.timeframe as never, fromMs, toMs,
    });

    const enriched = enrichCandles(candles, {
      ...DEFAULT_CONFIG, symbol: r.symbol, timeframe: r.timeframe as never,
    });
    const sres = runStrategy(enriched, scfg, { mode: "live", symbol: r.symbol });

    // Pick display bars — either the runner's native TF or a user-selected override.
    const displayTf = (data.timeframe ?? r.timeframe) as string;
    let displayEnriched = enriched;
    if (data.timeframe && data.timeframe !== r.timeframe) {
      const { candles: dCandles } = await loadRawCandles({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        source: r.source as any, symbol: r.symbol,
        timeframe: data.timeframe as never, fromMs, toMs,
      });
      displayEnriched = enrichCandles(dCandles, {
        ...DEFAULT_CONFIG, symbol: r.symbol, timeframe: data.timeframe as never,
      });
    }

    // Trim to last N bars for wire size.
    const window = displayEnriched.slice(-data.bars);
    const windowStart = window[0]?.ts ?? 0;
    const chartCandles: ChartCandleDTO[] = window.map((b) => ({
      t: Math.floor(b.ts / 1000), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume,
    }));
    const mkSeries = (pick: (b: typeof window[number]) => number | null): ChartSeriesPointDTO[] =>
      window.map((b) => ({ t: Math.floor(b.ts / 1000), v: pick(b) }));
    const series: ChartSeriesDTO = {
      vwap: mkSeries((b) => b.vwapDaily),
      ema20: mkSeries((b) => b.ema20),
      ema50: mkSeries((b) => b.ema50),
      ema200: mkSeries((b) => b.ema200),
      adx: mkSeries((b) => b.adx),
      atr: mkSeries((b) => b.atr),
    };


    const markers: ChartMarkerDTO[] = [];
    for (const sig of sres.signals) {
      if (sig.timestamp < windowStart) continue;
      const t = Math.floor(sig.timestamp / 1000);
      if (sig.direction === "long")
        markers.push({ time: t, kind: "signal_long", label: sig.type });
      else
        markers.push({ time: t, kind: "signal_short", label: sig.type });
    }
    for (const sig of sres.invalidated) {
      if (sig.timestamp < windowStart) continue;
      markers.push({ time: Math.floor(sig.timestamp / 1000), kind: "invalidated", label: "invalid" });
    }

    // Latest open/pending live trade for this runner.
    const { data: trades } = await s.from("live_trades")
      .select("id, direction, qty, entry_price, fill_price, stop_price, target_price, entry_ts, status")
      .eq("runner_id", r.id)
      .in("status", ["open", "pending"])
      .order("entry_ts", { ascending: false }).limit(1);
    const activeTrade = trades?.[0] as ActiveTradeDTO | undefined ?? null;

    // Pending strategy signal not yet filled.
    const invIds = new Set(sres.invalidated.map((x) => x.signalId));
    const filledIds = new Set(
      sres.events.filter((e) => e.name === "OnTradeFilled").map((e) => e.data.signalId as string),
    );
    const pendingSig = [...sres.signals].reverse().find(
      (sig) => sig.type !== "BUY" && sig.type !== "SELL"
        && !invIds.has(sig.signalId) && !filledIds.has(sig.signalId),
    );
    const pendingSignal = pendingSig ? {
      direction: pendingSig.direction, entryPrice: pendingSig.entryPrice,
      stop: pendingSig.stopLoss, target: pendingSig.takeProfit, ts: pendingSig.timestamp,
    } : null;

    // Try to fetch a fresh last price.
    let lastPrice: number | null = window[window.length - 1]?.close ?? null;
    try {
      const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
      lastPrice = await createSharkClient().getLastPrice(r.symbol);
    } catch { /* keep close */ }

    // Recent setup detections from strategy engine events.
    const setupEvents = sres.events.filter((e) => e.name === "OnSetupDetected");
    const recentSetups: RecentSetupDTO[] = setupEvents
      .slice(-20)
      .map((e) => ({
        ts: Number(e.ts),
        kind: String(e.data.kind ?? "setup"),
        direction: String(e.data.direction ?? "—"),
        level: e.data.level != null ? Number(e.data.level) : null,
      }));
    for (const su of recentSetups) {
      if (su.ts < windowStart) continue;
      markers.push({
        time: Math.floor(su.ts / 1000),
        kind: "setup",
        label: su.kind,
      });
    }

    // Build the rule table for the latest bar so the UI can show what's
    // currently blocking a trade.
    const lastBar = enriched[enriched.length - 1] ?? null;
    const prevBar = enriched[enriched.length - 2] ?? null;
    const rules: PlanRuleDTO[] = [];
    let blockingReasons: string[] = [];
    let windowActive = true;
    let nextOpenMinutes: number | null = null;
    if (lastBar) {
      const windows = windowsForPreset(r.strategy_preset);
      windowActive = windows.length === 0 || windows.some(isWindowActive);
      if (!windowActive && windows.length > 0) {
        const m = windows.reduce<number>(
          (acc, w) => Math.min(acc, minutesUntilOpen(w)),
          Number.POSITIVE_INFINITY,
        );
        nextOpenMinutes = Number.isFinite(m) ? m : null;
      }
      const idx = enriched.length - 1;
      const checks = [
        evalSessionFilter(lastBar, scfg.session),
        evalTrendFilter(lastBar, enriched, idx, scfg.trend),
        evalVolatilityFilter(lastBar, prevBar, scfg.volatility),
      ];
      for (const c of checks) {
        rules.push({
          group: "filter",
          label: c.label,
          requirement: c.label,
          actual: c.reason ?? (c.pass ? "ok" : "blocked"),
          pass: c.pass,
        });
      }
      blockingReasons = checks.filter((c) => !c.pass).map((c) => `${c.label}: ${c.reason ?? "blocked"}`);
    }

    return {
      runner_id: r.id, label: r.label, symbol: r.symbol,
      timeframe: displayTf, runnerTimeframe: r.timeframe,
      strategy_preset: r.strategy_preset,
      candles: chartCandles, series, markers, activeTrade, pendingSignal,
      lastPrice, fetchedAt: Date.now(),
      plan: {
        windowActive,
        nextOpenMinutes,
        rules,
        passCount: rules.filter((x) => x.pass).length,
        failCount: rules.filter((x) => !x.pass).length,
        blockingReasons,
        recentSetups,
        setupsDetected: sres.stats.setupsDetected,
        signalsCreated: sres.stats.signalsCreated,
        signalsInvalidated: sres.stats.signalsInvalidated,
        lastBar: lastBar
          ? { ts: lastBar.ts, close: lastBar.close, session: lastBar.session }
          : null,
      },
    };
  });


export const getLastPrice = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ symbol: z.string() }).parse(raw))
  .handler(async ({ data }): Promise<{ price: number; ts: number }> => {
    const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
    const price = await createSharkClient().getLastPrice(data.symbol);
    return { price, ts: Date.now() };
  });

export interface RunnerStatusDTO {
  runner_id: string;
  state: "error" | "trade_open" | "setup_ready" | "session_closed" | "blocked" | "scanning" | "stopped";
  detail: string | null;
  direction: string | null;
}

export const getRunnersStatusSummary = createServerFn({ method: "GET" })
  .handler(async (): Promise<RunnerStatusDTO[]> => {
    const s = await admin();
    const { data: runners, error } = await s.from("live_runners").select("*").order("label");
    if (error) throw new Error(error.message);

    const [
      { loadRawCandles }, { enrichCandles }, { DEFAULT_CONFIG },
      { runStrategy }, { STRATEGY_PRESETS },
      { evalSessionFilter, evalTrendFilter, evalVolatilityFilter },
      { windowsForPreset, isWindowActive },
    ] = await Promise.all([
      import("@/lib/market-data/loader.server"),
      import("@/lib/market-data/enrich"),
      import("@/lib/market-data/types"),
      import("@/lib/strategy-engine/engine"),
      import("@/lib/strategy-engine/presets"),
      import("@/lib/strategy-engine/filters"),
      import("@/lib/session-windows"),
    ]);

    const { data: openTrades } = await s.from("live_trades")
      .select("runner_id, direction, status")
      .in("status", ["open", "pending"]);
    const openByRunner = new Map<string, { direction: string; status: string }>();
    for (const t of openTrades ?? []) {
      if (!openByRunner.has(t.runner_id)) {
        openByRunner.set(t.runner_id, { direction: String(t.direction), status: String(t.status) });
      }
    }

    const results = await Promise.all((runners ?? []).map(async (r): Promise<RunnerStatusDTO> => {
      const rr = r as unknown as LiveRunnerDTO;
      if (rr.last_tick_error) {
        return { runner_id: rr.id, state: "error", detail: rr.last_tick_error, direction: null };
      }
      const open = openByRunner.get(rr.id);
      if (open) {
        return { runner_id: rr.id, state: "trade_open", detail: open.status, direction: open.direction };
      }
      if (!rr.running) {
        return { runner_id: rr.id, state: "stopped", detail: null, direction: null };
      }

      try {
        const scfg = STRATEGY_PRESETS[rr.strategy_preset as keyof typeof STRATEGY_PRESETS];
        if (!scfg) throw new Error(`Unknown preset ${rr.strategy_preset}`);

        const toMs = Date.now();
        const fromMs = toMs - Math.max(2, Number(rr.lookback_days)) * 24 * 60 * 60 * 1000;
        const { candles } = await loadRawCandles({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          source: rr.source as any, symbol: rr.symbol,
          timeframe: rr.timeframe as never, fromMs, toMs,
        });
        const enriched = enrichCandles(candles, {
          ...DEFAULT_CONFIG, symbol: rr.symbol, timeframe: rr.timeframe as never,
        });
        const sres = runStrategy(enriched, scfg, { mode: "live", symbol: rr.symbol });

        const windows = windowsForPreset(rr.strategy_preset);
        const windowActive = windows.length === 0 || windows.some(isWindowActive);
        if (!windowActive) {
          return { runner_id: rr.id, state: "session_closed", detail: "outside trading window", direction: null };
        }

        const invIds = new Set(sres.invalidated.map((x) => x.signalId));
        const filledIds = new Set(
          sres.events.filter((e) => e.name === "OnTradeFilled").map((e) => e.data.signalId as string),
        );
        const pending = [...sres.signals].reverse().find(
          (sig) => sig.type !== "BUY" && sig.type !== "SELL"
            && !invIds.has(sig.signalId) && !filledIds.has(sig.signalId),
        );
        if (pending) {
          return {
            runner_id: rr.id, state: "setup_ready",
            detail: `entry ${pending.entryPrice.toFixed(2)}`,
            direction: pending.direction,
          };
        }

        const lastBar = enriched[enriched.length - 1] ?? null;
        const prevBar = enriched[enriched.length - 2] ?? null;
        if (lastBar) {
          const idx = enriched.length - 1;
          const checks = [
            evalSessionFilter(lastBar, scfg.session),
            evalTrendFilter(lastBar, enriched, idx, scfg.trend),
            evalVolatilityFilter(lastBar, prevBar, scfg.volatility),
          ];
          const failing = checks.filter((c) => !c.pass);
          if (failing.length) {
            return {
              runner_id: rr.id, state: "blocked",
              detail: failing
                .map((c) => `${c.label}${c.reason ? ` (${c.reason})` : ""}`)
                .join(" · "),
              direction: null,
            };
          }
          // All gates pass and window is active — treat as Ready even if the
          // strategy hasn't produced a pending signal on the very last bar yet.
          // Matches the pipeline diagnostics "Ready" definition.
          return {
            runner_id: rr.id, state: "setup_ready",
            detail: `all gates pass · close ${lastBar.close.toFixed(2)}`,
            direction: null,
          };
        }
        return { runner_id: rr.id, state: "scanning", detail: null, direction: null };
      } catch (e) {
        return { runner_id: rr.id, state: "error", detail: e instanceof Error ? e.message : String(e), direction: null };
      }
    }));

    return results;
  });

// ---------- Top-10 curated selection (backtested robustness winners) ----------
// Hardcoded so the verification panel shows a stable, reviewable list.
// Ordered by robustness score from the backtest screenshots.
export interface TopRunnerSpec {
  label: string;
  source: "shark" | "yahoo";
  symbol: "BTCUSDT" | "XAUUSDT";
  timeframe: string;
  strategy_preset: string;
  exec_preset: string;
  risk_usd: number;
  lookback_days: number;
  leverage: number;
  robustness: number;
}

export const TOP_RUNNER_SELECTION: TopRunnerSpec[] = [
  { label: "BTC 1h London ORB (live)",   source: "shark", symbol: "BTCUSDT", timeframe: "1h",  strategy_preset: "london_orb",       exec_preset: "conservative_default", risk_usd: 20, lookback_days: 10, leverage: 150, robustness: 89 },
  { label: "BTC 5m VWAP (live)",         source: "shark", symbol: "BTCUSDT", timeframe: "5m",  strategy_preset: "vwap_mean_revert", exec_preset: "conservative_default", risk_usd: 20, lookback_days: 5,  leverage: 150, robustness: 87 },
  { label: "XAU 30m London ORB (live)",  source: "shark", symbol: "XAUUSDT", timeframe: "30m", strategy_preset: "london_orb",       exec_preset: "conservative_default", risk_usd: 20, lookback_days: 10, leverage: 75,  robustness: 85 },
  { label: "XAU 10m VWAP (live)",        source: "shark", symbol: "XAUUSDT", timeframe: "10m", strategy_preset: "vwap_mean_revert", exec_preset: "conservative_default", risk_usd: 20, lookback_days: 5,  leverage: 75,  robustness: 84 },
  { label: "BTC 15m VWAP (live)",        source: "shark", symbol: "BTCUSDT", timeframe: "15m", strategy_preset: "vwap_mean_revert", exec_preset: "conservative_default", risk_usd: 20, lookback_days: 5,  leverage: 150, robustness: 84 },
  { label: "BTC 45m London ORB (live)",  source: "shark", symbol: "BTCUSDT", timeframe: "45m", strategy_preset: "london_orb",       exec_preset: "conservative_default", risk_usd: 20, lookback_days: 10, leverage: 150, robustness: 82 },
  { label: "XAU 45m London ORB (live)",  source: "shark", symbol: "XAUUSDT", timeframe: "45m", strategy_preset: "london_orb",       exec_preset: "conservative_default", risk_usd: 20, lookback_days: 10, leverage: 75,  robustness: 79 },
  { label: "BTC 15m London ORB (live)",  source: "shark", symbol: "BTCUSDT", timeframe: "15m", strategy_preset: "london_orb",       exec_preset: "conservative_default", risk_usd: 20, lookback_days: 5,  leverage: 150, robustness: 77 },
  { label: "XAU 15m London ORB (live)",  source: "shark", symbol: "XAUUSDT", timeframe: "15m", strategy_preset: "london_orb",       exec_preset: "conservative_default", risk_usd: 20, lookback_days: 5,  leverage: 75,  robustness: 74 },
  { label: "BTC 30m London ORB (live)",  source: "shark", symbol: "BTCUSDT", timeframe: "30m", strategy_preset: "london_orb",       exec_preset: "conservative_default", risk_usd: 20, lookback_days: 10, leverage: 150, robustness: 73 },
];

export interface TopSelectionPreviewDTO {
  selection: TopRunnerSpec[];
  existing: Array<{
    id: string; label: string; symbol: string; timeframe: string;
    strategy_preset: string; running: boolean;
  }>;
}

export const previewTopSelection = createServerFn({ method: "GET" })
  .handler(async (): Promise<TopSelectionPreviewDTO> => {
    const s = await admin();
    const { data, error } = await s
      .from("live_runners")
      .select("id, label, symbol, timeframe, strategy_preset, running")
      .order("label");
    if (error) throw new Error(error.message);
    return {
      selection: TOP_RUNNER_SELECTION,
      existing: (data ?? []) as TopSelectionPreviewDTO["existing"],
    };
  });

export interface ReplaceReportDTO {
  deleted: Array<{ id: string; label: string; symbol: string; timeframe: string; strategy_preset: string }>;
  inserted: Array<{ id: string; label: string; symbol: string; timeframe: string; strategy_preset: string }>;
  deletedTrades: number;
  startRequested: boolean;
}

export const replaceLiveRunnersWithTopSelection = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ startImmediately: z.boolean().default(false) }).parse(raw))
  .handler(async ({ data }): Promise<ReplaceReportDTO> => {
    const s = await admin();

    // Snapshot existing runners so we can report exactly what got removed.
    const { data: existing, error: exErr } = await s
      .from("live_runners")
      .select("id, label, symbol, timeframe, strategy_preset");
    if (exErr) throw new Error(exErr.message);

    // Delete dependent live_trades first, then runners. CASCADE would handle
    // trades but we count them explicitly so the UI can show it.
    const { count: tradeCount } = await s
      .from("live_trades")
      .select("*", { count: "exact", head: true });
    if ((existing ?? []).length > 0) {
      const { error: dtErr } = await s.from("live_trades").delete().not("id", "is", null);
      if (dtErr) throw new Error(dtErr.message);
      const { error: drErr } = await s.from("live_runners").delete().not("id", "is", null);
      if (drErr) throw new Error(drErr.message);
    }

    // Insert the curated selection.
    const rows = TOP_RUNNER_SELECTION.map((r) => ({
      label: r.label, source: r.source, symbol: r.symbol,
      timeframe: r.timeframe, strategy_preset: r.strategy_preset,
      exec_preset: r.exec_preset, risk_usd: r.risk_usd,
      lookback_days: r.lookback_days, leverage: r.leverage,
      running: data.startImmediately,
      started_at: data.startImmediately ? new Date().toISOString() : null,
    }));
    const { data: inserted, error: inErr } = await s
      .from("live_runners")
      .insert(rows)
      .select("id, label, symbol, timeframe, strategy_preset");
    if (inErr) throw new Error(inErr.message);

    return {
      deleted: (existing ?? []) as ReplaceReportDTO["deleted"],
      inserted: (inserted ?? []) as ReplaceReportDTO["inserted"],
      deletedTrades: tradeCount ?? 0,
      startRequested: data.startImmediately,
    };
  });


// ---------- Live exchange orders (pending / executed / closed) ----------
export interface ExchangePendingOrder {
  clientOrderId: string;
  symbol: string;
  side: string;
  type: string;
  price: number | null;
  quantity: number | null;
  filledAmount: number | null;
  stopPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  reduceOnly: boolean | null;
  subType: string | null;
  createdAt: string | null;
}
export interface ExchangeOpenPosition {
  symbol: string;
  side: string;
  qty: number;
  entryPrice: number | null;
}
export interface ExchangeClosedTrade {
  id: string;
  clientOrderId: string | null;
  symbol: string;
  side: string;
  type: string;
  role: string | null;
  price: number | null;
  quantity: number | null;
  fee: number | null;
  feeInMarginAsset: number | null;
  realizedPnl: number | null;
  realizedPnlInMarginAsset: number | null;
  netPnl: number | null;
  netPnlInMarginAsset: number | null;
  marginAsset: string | null;
  positionId: string | null;
  time: string | null;
}
export interface ExchangeOrdersDTO {
  pending: ExchangePendingOrder[];
  executed: ExchangeOpenPosition[];
  closed: ExchangeClosedTrade[];
  fetchedAt: string;
  error: string | null;
}

export const listLiveExchangeOrders = createServerFn({ method: "GET" }).handler(
  async (): Promise<ExchangeOrdersDTO> => {
    const empty: ExchangeOrdersDTO = {
      pending: [], executed: [], closed: [],
      fetchedAt: new Date().toISOString(), error: null,
    };
    try {
      const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
      const client = createSharkClient();
      const s = await admin();
      // Symbols the user actually has runners on.
      const { data: runners } = await s.from("live_runners").select("symbol");
      const symbols = Array.from(new Set((runners ?? []).map((r) => r.symbol.toUpperCase())));
      if (symbols.length === 0) return empty;

      // 1) Open orders + open positions per symbol.
      const [ordersBySymbol, posBySymbol] = await Promise.all([
        Promise.all(symbols.map((sym) => client.getOpenOrders(sym).catch(() => []))),
        Promise.all(symbols.map((sym) => client.getOpenPositions(sym).catch(() => []))),
      ]);

      const pending: ExchangePendingOrder[] = [];
      for (const rows of ordersBySymbol) {
        for (const o of rows) {
          pending.push({
            clientOrderId: o.clientOrderId,
            symbol: o.symbol,
            side: o.side,
            type: o.type,
            price: o.price,
            quantity: o.quantity,
            filledAmount: o.filledAmount,
            stopPrice: o.stopPrice,
            stopLossPrice: o.stopLossPrice,
            takeProfitPrice: o.takeProfitPrice,
            reduceOnly: o.reduceOnly,
            subType: o.subType,
            createdAt: o.createdAt,
          });
        }
      }
      const executed: ExchangeOpenPosition[] = [];
      for (const rows of posBySymbol) {
        for (const p of rows) {
          executed.push({
            symbol: p.symbol,
            side: p.side,
            qty: p.qty,
            entryPrice: p.entryPrice,
          });
        }
      }

      // 2) Recent trade history (fills = executed + closed leg fills).
      //    Shark returns most-recent first; we take up to 100.
      const snapshot = await client.getAccountSnapshot();
      const historyRaw =
        (snapshot.tradeHistory as { data?: unknown[] } | null)?.data ??
        (Array.isArray(snapshot.tradeHistory) ? (snapshot.tradeHistory as unknown[]) : []);
      const closed: ExchangeClosedTrade[] = [];
      const symbolSet = new Set(symbols);
      const num = (v: unknown): number | null => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      for (const r of historyRaw as Record<string, unknown>[]) {
        const sym = String(r.symbol ?? r.contractName ?? "").toUpperCase();
        if (symbolSet.size > 0 && !symbolSet.has(sym)) continue;
        const fee = num(r.fee ?? r.takerFee ?? r.makerFee ?? r.commission);
        const feeInMarginAsset = num(r.feeInMarginAsset ?? r.commissionInMarginAsset);
        const realizedPnl = num(r.realizedProfit ?? r.realizedPnl ?? r.realisedPnl ?? r.pnl ?? r.profit);
        const realizedPnlInMarginAsset = num(
          r.realizedProfitInMarginAsset ?? r.realizedPnlInMarginAsset ?? r.realisedPnlInMarginAsset,
        );
        closed.push({
          id: String(r.id ?? r.tradeId ?? r.orderId ?? r.clientOrderId ?? Math.random()),
          clientOrderId:
            (r.clientOrderId as string | undefined) ??
            (r.orderId as string | undefined) ??
            null,
          symbol: sym,
          side: String(r.side ?? ""),
          type: String(r.type ?? r.orderType ?? ""),
          role: (r.role as string | undefined) ?? null,
          price: num(r.price ?? r.fillPrice ?? r.avgPrice),
          quantity: num(r.qty ?? r.quantity ?? r.filledAmount),
          fee,
          feeInMarginAsset,
          realizedPnl,
          realizedPnlInMarginAsset,
          netPnl: realizedPnl == null ? null : realizedPnl - Math.abs(fee ?? 0),
          netPnlInMarginAsset: realizedPnlInMarginAsset == null
            ? null
            : realizedPnlInMarginAsset - Math.abs(feeInMarginAsset ?? 0),
          marginAsset: (r.marginAsset as string | undefined) ?? null,
          positionId: (r.positionId as string | undefined) ?? null,
          time:
            (r.time as string | undefined) ??
            (r.createdAt as string | undefined) ??
            (r.updatedAt as string | undefined) ??
            null,
        });
      }
      closed.sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""));

      return {
        pending, executed,
        closed: closed.slice(0, 100),
        fetchedAt: new Date().toISOString(),
        error: null,
      };
    } catch (e) {
      return { ...empty, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

export const cancelExchangeOrder = createServerFn({ method: "POST" })
  .inputValidator((raw) => z.object({ clientOrderId: z.string().min(1) }).parse(raw))
  .handler(async ({ data }) => {
    const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
    const client = createSharkClient();
    const res = await client.cancelOrder(data.clientOrderId);
    return { ok: res.ok, status: res.status, body: res.body };
  });
