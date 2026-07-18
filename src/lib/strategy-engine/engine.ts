// The Universal Strategy Engine — orchestrator.
// Consumes EnrichedCandle[] + StrategyConfig, walks bars strictly forward
// (no future data), emits signals + events. No execution logic.
import type { EnrichedCandle } from "@/lib/market-data/types";
import { evalConfirmation } from "./confirmation";
import { evalSessionFilter, evalTrendFilter, evalVolatilityFilter, type FilterResult } from "./filters";
import { planEntry, planStop, planTargets, type PendingEntry } from "./planners";
import { detectSetup } from "./setups";
import { scoreStrength } from "./strength";
import type {
  EngineEvent, EngineRunOptions, EngineRunResult, StrategyConfig,
  StrategySignal, SignalDirection, SignalType,
} from "./types";

interface PendingSignal {
  signal: StrategySignal;
  entry: PendingEntry;
  detectedAt: number; // bar index
}

export function runStrategy(
  bars: EnrichedCandle[],
  cfg: StrategyConfig,
  opts: EngineRunOptions,
): EngineRunResult {
  const events: EngineEvent[] = [];
  const emit = (name: EngineEvent["name"], ts: number, data: Record<string, string | number | boolean | null>) => {
    const e: EngineEvent = { name, ts, data };
    events.push(e); opts.onEvent?.(e);
  };
  const signals: StrategySignal[] = [];
  const invalidated: StrategySignal[] = [];
  const filterRejects: Record<string, number> = {};
  let setupsDetected = 0;
  const pendingByDir: Record<SignalDirection, PendingSignal | null> = { long: null, short: null };
  const dailyCounts = new Map<string, number>();

  // ── PDH/PDL sweep state machine ──
  // Once a sweep of PDH (short) or PDL (long) is detected, we arm that side.
  // Up to `maxAttemptsPerSweep` filled entries are allowed on the same armed
  // event; a new sweep on the same side resets it.
  interface ArmedSweep { level: number; sweepExtreme: number; sweepTs: number; attempts: number }
  const armedByDir: Record<SignalDirection, ArmedSweep | null> = { long: null, short: null };
  const isPdhPdl = cfg.setup.kind === "pdh_pdl_sweep";
  const maxAttempts = cfg.management?.maxAttemptsPerSweep ?? 3;

  const bump = (r: FilterResult) => {
    if (!r.pass) filterRejects[r.label] = (filterRejects[r.label] ?? 0) + 1;
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    emit("OnNewCandle", bar.ts, { i, close: bar.close, session: bar.session });

    // 1) Invalidate stale pending signals first.
    for (const dir of ["long", "short"] as const) {
      const p = pendingByDir[dir];
      if (!p) continue;
      const reasons: string[] = [];
      if (p.entry.expiryBarIndex !== null && i > p.entry.expiryBarIndex) reasons.push("limit_never_filled");
      if (cfg.invalidation?.maxDelayBars && i - p.detectedAt > cfg.invalidation.maxDelayBars) reasons.push("max_delay");
      if (cfg.invalidation?.invalidateOnSessionEnd && bars[p.detectedAt].session !== bar.session) reasons.push("session_end");
      if (cfg.invalidation?.invalidateOnStructureFlip) {
        const at = bars[p.detectedAt].structure;
        if (at && bar.structure && at !== bar.structure) reasons.push("structure_flip");
      }
      if (cfg.invalidation?.invalidateOnNews && bar.isNews) reasons.push("news");
      // Fill check: for limit orders — price traded through level.
      const filled = p.entry.type === "market"
        ? true
        : p.entry.type === "limit"
          ? (dir === "long" ? bar.low <= p.entry.price : bar.high >= p.entry.price)
          : (dir === "long" ? bar.high >= p.entry.price : bar.low <= p.entry.price);
      if (filled) {
        emit("OnTradeFilled", bar.ts, { signalId: p.signal.signalId, price: p.entry.price });
        pendingByDir[dir] = null;
        continue;
      }
      if (reasons.length) {
        const inv: StrategySignal = { ...p.signal, invalidationReason: reasons.join(",") };
        invalidated.push(inv);
        emit("OnSignalInvalidated", bar.ts, { signalId: inv.signalId, reasons: reasons.join(",") });
        pendingByDir[dir] = null;
      }
    }

    // 2) Filter pipeline in order.
    const passed: string[] = [];
    const failed: string[] = [];
    const s = evalSessionFilter(bar, cfg.session); bump(s);
    (s.pass ? passed : failed).push(s.label);
    const t = evalTrendFilter(bar, bars, i, cfg.trend); bump(t);
    (t.pass ? passed : failed).push(t.label);
    const v = evalVolatilityFilter(bar, bars[i - 1] ?? null, cfg.volatility); bump(v);
    (v.pass ? passed : failed).push(v.label);
    if (!s.pass || !t.pass || !v.pass) continue;

    // 3) Daily / weekly caps.
    const dayKey = new Date(bar.ts).toISOString().slice(0, 10);
    if (cfg.management?.maxDailyTrades && (dailyCounts.get(dayKey) ?? 0) >= cfg.management.maxDailyTrades) {
      filterRejects["management.daily_cap"] = (filterRejects["management.daily_cap"] ?? 0) + 1;
      continue;
    }

    // 4) Setup detection.
    let trig = detectSetup(bars, i, cfg.setup);

    if (isPdhPdl) {
      const prev = bars[i - 1];
      // Arm on prev-bar wick beyond PDH/PDL (fresh sweep resets attempts).
      if (prev && prev.prevDayLow != null && prev.low < prev.prevDayLow) {
        if (!armedByDir.long || armedByDir.long.sweepTs !== prev.ts) {
          armedByDir.long = { level: prev.prevDayLow, sweepExtreme: prev.low, sweepTs: prev.ts, attempts: 0 };
        }
      }
      if (prev && prev.prevDayHigh != null && prev.high > prev.prevDayHigh) {
        if (!armedByDir.short || armedByDir.short.sweepTs !== prev.ts) {
          armedByDir.short = { level: prev.prevDayHigh, sweepExtreme: prev.high, sweepTs: prev.ts, attempts: 0 };
        }
      }
      // Emit trigger on green/red trigger candle while armed.
      trig = null;
      const green = bar.close > bar.open;
      const red = bar.close < bar.open;
      if (armedByDir.long && green && !pendingByDir.long && armedByDir.long.attempts < maxAttempts) {
        trig = {
          kind: "pdh_pdl_sweep", direction: "long",
          level: bar.high,
          swingHigh: bar.swingHigh, swingLow: bar.swingLow,
          meta: { session: bar.session, atr: bar.atr, structure: bar.structure,
                  sweepExtreme: armedByDir.long.sweepExtreme, sweepLevel: armedByDir.long.level,
                  attempt: armedByDir.long.attempts + 1 },
        };
      } else if (armedByDir.short && red && !pendingByDir.short && armedByDir.short.attempts < maxAttempts) {
        trig = {
          kind: "pdh_pdl_sweep", direction: "short",
          level: bar.low,
          swingHigh: bar.swingHigh, swingLow: bar.swingLow,
          meta: { session: bar.session, atr: bar.atr, structure: bar.structure,
                  sweepExtreme: armedByDir.short.sweepExtreme, sweepLevel: armedByDir.short.level,
                  attempt: armedByDir.short.attempts + 1 },
        };
      }
    }

    if (!trig) continue;
    if (cfg.direction && cfg.direction !== "both" && cfg.direction !== trig.direction) continue;
    setupsDetected++;
    emit("OnSetupDetected", bar.ts, { kind: trig.kind, direction: trig.direction, level: trig.level });

    // 5) Confirmation.
    const conf = evalConfirmation(bars, i, trig.direction, trig.level, cfg.confirmation);
    passed.push(...conf.passed.map((p) => `conf.${p}`));
    failed.push(...conf.failed.map((p) => `conf.${p}`));
    if (!conf.pass) {
      for (const f of conf.failed) filterRejects[`conf.${f}`] = (filterRejects[`conf.${f}`] ?? 0) + 1;
      continue;
    }

    // 6) Plan entry / stop / targets.
    const entry = planEntry(bar, trig.direction, trig.level, cfg.entry, i);
    const sweepExtreme = typeof trig.meta.sweepExtreme === "number" ? trig.meta.sweepExtreme : undefined;
    const stop = planStop(bar, trig.direction, entry.price, cfg.stop, { sweepExtreme });
    const legs = planTargets(bar, trig.direction, entry.price, stop, cfg.targets);
    const rDist = Math.abs(entry.price - stop);
    if (rDist <= 0 || !Number.isFinite(rDist)) continue;
    const units = cfg.risk.riskPerTradeUsd / rDist;
    const primary = legs[0];
    const reward = primary ? Math.abs(primary.price - entry.price) * units * primary.sizePct / 100 : 0;
    const strength = scoreStrength(bars, i, trig.direction, cfg);

    const signalType: SignalType = entry.type === "market"
      ? (trig.direction === "long" ? "BUY" : "SELL")
      : entry.type === "limit"
        ? (trig.direction === "long" ? "BUY_LIMIT" : "SELL_LIMIT")
        : (trig.direction === "long" ? "BUY_STOP" : "SELL_STOP");

    const signal: StrategySignal = {
      signalId: `${cfg.strategyId}-${bar.ts}-${trig.direction}`,
      strategyId: cfg.strategyId,
      strategyName: cfg.strategyName,
      timestamp: bar.ts,
      symbol: opts.symbol,
      direction: trig.direction,
      type: signalType,
      entryType: cfg.entry.model.kind,
      entryPrice: entry.price,
      stopLoss: stop,
      takeProfit: primary?.price ?? entry.price,
      targetLegs: legs,
      risk: cfg.risk.riskPerTradeUsd,
      reward,
      rr: rDist > 0 && primary ? Math.abs(primary.price - entry.price) / rDist : 0,
      units,
      signalStrength: strength.score,
      strengthComponents: strength.components,
      setupType: trig.kind,
      confirmationType: conf.passed,
      filtersPassed: passed,
      filtersFailed: failed,
      expiryTs: entry.expiryBarIndex !== null && bars[entry.expiryBarIndex]
        ? bars[entry.expiryBarIndex].ts
        : null,
      metadata: { ...trig.meta, mode: opts.mode },
    };
    signals.push(signal);
    dailyCounts.set(dayKey, (dailyCounts.get(dayKey) ?? 0) + 1);
    emit("OnSignalCreated", bar.ts, { signalId: signal.signalId, type: signal.type, direction: signal.direction, strength: signal.signalStrength });

    // PDH/PDL: each placed entry counts as one attempt. Disarm at cap.
    if (isPdhPdl && armedByDir[trig.direction]) {
      armedByDir[trig.direction]!.attempts += 1;
      if (armedByDir[trig.direction]!.attempts >= maxAttempts) armedByDir[trig.direction] = null;
    }

    // Market orders are considered filled immediately; others become pending.
    if (entry.type === "market") {
      emit("OnTradeFilled", bar.ts, { signalId: signal.signalId, price: entry.price });
    } else {
      pendingByDir[trig.direction] = { signal, entry, detectedAt: i };
    }
  }

  return {
    signals, invalidated, events,
    stats: {
      barsProcessed: bars.length,
      setupsDetected,
      signalsCreated: signals.length,
      signalsInvalidated: invalidated.length,
      filterRejects,
    },
  };
}
