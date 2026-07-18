// Universal Execution Engine — orchestrator.
// Consumes EnrichedCandle[] + StrategySignal[] + ExecutionConfig, walks bars
// strictly forward, simulates realistic fills, and emits Trade[] + events.
// Contains ZERO strategy logic. Contains ZERO indicator math.
import type { EnrichedCandle } from "@/lib/market-data/types";
import type { StrategySignal } from "@/lib/strategy-engine/types";
import { commissionFor } from "./commission";
import { evaluateBar, gapDirection, triggerHit } from "./fills";
import { canOpen, dayKey, initRiskState, noteBlock, recordClose } from "./risk";
import { sizeUnits } from "./sizing";
import { applySlippage, slippagePoints } from "./slippage";
import { spreadPoints } from "./spread";
import { currentR, maybeMoveToBreakEven, maybeTrail, type StopContext } from "./stops";
import type {
  EquityPoint, ExecEvent, ExecEventName, ExecRunOptions, ExecRunResult,
  ExecutionConfig, Order, PartialExit, Trade,
} from "./types";

interface OpenPosition {
  order: Order;
  ctx: StopContext;
  entryBarIndex: number;
  mae: number;    // adverse price extreme vs fill
  mfe: number;    // favourable price extreme vs fill
  partials: PartialExit[];
  fees: number;
  commission: number;
  slippage: number;
  spreadCost: number;
  legs: Array<{ price: number; sizePct: number; filled: boolean }>;
}

let orderSeq = 0;
let tradeSeq = 0;
const nextOrderId = (sig: string) => `ord_${sig}_${++orderSeq}`;
const nextTradeId = () => `trd_${Date.now()}_${++tradeSeq}`;

export function runExecution(
  bars: EnrichedCandle[],
  signalsIn: StrategySignal[],
  cfg: ExecutionConfig,
  opts: ExecRunOptions,
): ExecRunResult {
  const events: ExecEvent[] = [];
  const emit = (name: ExecEventName, ts: number, data: ExecEvent["data"]) => {
    const e: ExecEvent = { name, ts, data };
    events.push(e); opts.onEvent?.(e);
  };

  const risk = initRiskState(cfg);
  const equityCurve: EquityPoint[] = [];
  const trades: Trade[] = [];
  const cancelled: Order[] = [];
  const openOrders: Order[] = [];
  const openPositions: OpenPosition[] = [];

  // Bucket signals by bar index for O(1) lookup.
  const tsIndex = new Map<number, number>();
  bars.forEach((b, i) => tsIndex.set(b.ts, i));
  const signalsAt: Record<number, StrategySignal[]> = {};
  let signalsIngested = 0;
  for (const s of signalsIn) {
    const i = tsIndex.get(s.timestamp);
    if (i == null) continue;
    (signalsAt[i] ??= []).push(s);
    signalsIngested++;
  }

  let ordersCreated = 0, ordersFilled = 0, ordersExpired = 0;
  let winners = 0, losers = 0, grossPnL = 0, netPnL = 0, totalFees = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const prev = i > 0 ? bars[i - 1] : null;

    // 1) Ingest any new signals produced by the strategy on this bar → create orders.
    const list = signalsAt[i] ?? [];
    for (const sig of list) {
      // Contradictory-entry rule: if an OPPOSITE-direction position is
      // already open on the same symbol, either ignore (if it's in profit)
      // or close it and take the reverse (if it's in loss). Applies to
      // every runner — paper and live share this engine.
      const opposingIdx = openPositions.findIndex(
        (p) => p.order.symbol === sig.symbol && p.ctx.direction !== sig.direction,
      );
      if (opposingIdx >= 0) {
        const opp = openPositions[opposingIdx];
        const uPnl = pnl(
          opp.ctx.direction,
          opp.ctx.fillPrice,
          bar.close,
          opp.order.remainingUnits,
          cfg.contractMultiplier,
        );
        if (uPnl >= 0) {
          emit("OnRiskBlock", bar.ts, { signalId: sig.signalId, reason: "contradictory_ignored_in_profit" });
          continue;
        }
        // In loss → close existing at market (bar close) then take reverse.
        closePosition(opp, bar, i, bar.close, "reverse_on_loss", cfg, risk, trades, emit);
        openPositions.splice(opposingIdx, 1);
        // Also cancel any still-pending orders for the opposite direction
        // on the same symbol so they can't fill against the new entry.
        for (let o = openOrders.length - 1; o >= 0; o--) {
          const po = openOrders[o];
          const pdir: "long" | "short" = po.side === "buy" ? "long" : "short";
          if (po.symbol === sig.symbol && pdir !== sig.direction) {
            po.status = "cancelled";
            cancelled.push(po);
            openOrders.splice(o, 1);
            emit("OnOrderCancelled", bar.ts, { orderId: po.orderId, reason: "reversed" });
          }
        }
      }

      const block = canOpen(risk, cfg, bar.ts);
      if (block) {
        noteBlock(risk, block);
        emit("OnRiskBlock", bar.ts, { signalId: sig.signalId, reason: block });
        continue;
      }
      const order = orderFromSignal(sig, cfg, bar, i);
      openOrders.push(order);
      ordersCreated++;
      emit("OnOrderCreated", bar.ts, {
        orderId: order.orderId, signalId: sig.signalId, side: order.side,
        kind: order.kind, trigger: order.triggerPrice, stop: order.stopPrice,
        target: order.targetPrice, units: order.units,
      });
    }

    // 2) Manage open positions BEFORE checking pending orders on this bar
    //    (any close frees capacity for the next entry).
    for (let p = openPositions.length - 1; p >= 0; p--) {
      const pos = openPositions[p];
      const dir = pos.ctx.direction;

      // Update running MAE/MFE for reporting only (does not influence
      // resolution ordering).
      pos.mae = dir === "long"
        ? Math.min(pos.mae, bar.low - pos.ctx.fillPrice)
        : Math.min(pos.mae, pos.ctx.fillPrice - bar.high);
      pos.mfe = dir === "long"
        ? Math.max(pos.mfe, bar.high - pos.ctx.fillPrice)
        : Math.max(pos.mfe, pos.ctx.fillPrice - bar.low);

      // === FIX: no same-bar trailing look-ahead ===
      // Resolve stop/target for THIS bar using the stop carried from the
      // PRIOR bar. Only after resolution do we update runner peaks + BE/trail
      // so they apply to the NEXT bar. Previously, trailing used this bar's
      // high/low to move the stop up *before* the stop check ran, which
      // rescued trades whose low actually dipped through SL first.

      // Gap-through handling on open (still uses stop from prior bar).
      let closedThisBar = false;
      if (cfg.respectGaps && prev) {
        const g = gapDirection(dir, pos.ctx.currentStop, pos.legs[0]?.price ?? pos.order.targetPrice, prev.close, bar.open);
        if (g === "gap_through_stop") {
          closePosition(pos, bar, i, bar.open, "gap_through_stop", cfg, risk, trades, emit);
          openPositions.splice(p, 1); closedThisBar = true;
        } else if (g === "gap_through_target") {
          closePosition(pos, bar, i, bar.open, "gap_through_target", cfg, risk, trades, emit);
          openPositions.splice(p, 1); closedThisBar = true;
        }
      }
      if (closedThisBar) continue;

      // Evaluate bar for stop/target — using stop as set at end of prior bar.
      const outcome = evaluateBar(dir, pos.ctx.currentStop, pos.legs, bar, cfg.intrabar);
      if (outcome.order === "stop_first") {
        const wasBE = pos.ctx.breakEvenApplied;
        closePosition(pos, bar, i, pos.ctx.currentStop, wasBE ? "break_even_stop" : "stop_loss", cfg, risk, trades, emit);
        openPositions.splice(p, 1); continue;
      }
      if (outcome.order === "target_first") {
        let remainingLegs = pos.legs.filter((l) => !l.filled).length;
        for (let li = 0; li < pos.legs.length; li++) {
          if (!outcome.tpLegs[li] || pos.legs[li].filled) continue;
          const leg = pos.legs[li];
          const legUnits = pos.order.units * (leg.sizePct / 100);
          const legPnl = pnl(dir, pos.ctx.fillPrice, leg.price, legUnits, cfg.contractMultiplier);
          const legCmm = commissionFor(cfg.commission, leg.price, legUnits);
          pos.commission += legCmm; pos.fees += legCmm;
          pos.partials.push({ ts: bar.ts, price: leg.price, units: legUnits, pnl: legPnl - legCmm, reason: `tp_${li + 1}` });
          leg.filled = true;
          remainingLegs--;
          emit("OnPartialTP", bar.ts, { orderId: pos.order.orderId, leg: li + 1, price: leg.price, units: legUnits, pnl: legPnl });
          if (remainingLegs === 0) {
            closePosition(pos, bar, i, leg.price, "take_profit_all", cfg, risk, trades, emit, /* alreadyPartial */ true);
            openPositions.splice(p, 1);
            break;
          }
        }
        continue;
      }

      // No stop / target hit this bar — NOW update runner peaks and apply
      // BE / trailing so they affect the NEXT bar's resolution.
      if (dir === "long") pos.ctx.runnerHigh = Math.max(pos.ctx.runnerHigh, bar.high);
      else pos.ctx.runnerLow = Math.min(pos.ctx.runnerLow, bar.low);
      const be = maybeMoveToBreakEven(pos.ctx, dir === "long" ? bar.high : bar.low, cfg.breakEvenAtR);
      if (be) emit("OnBreakEven", bar.ts, { orderId: pos.order.orderId, stop: pos.ctx.currentStop });
      const trailed = maybeTrail(pos.ctx, dir === "long" ? bar.high : bar.low, cfg.trailAfterR, cfg.trailStepR);
      if (trailed) emit("OnTrailingStop", bar.ts, { orderId: pos.order.orderId, stop: pos.ctx.currentStop });

      // Time-stop / max-holding.
      const held = i - pos.entryBarIndex;
      if (cfg.timeStopBars != null && held >= cfg.timeStopBars) {
        closePosition(pos, bar, i, bar.close, "time_stop", cfg, risk, trades, emit);
        openPositions.splice(p, 1); continue;
      }
      if (cfg.maxHoldingBars != null && held >= cfg.maxHoldingBars) {
        closePosition(pos, bar, i, bar.close, "max_holding", cfg, risk, trades, emit);
        openPositions.splice(p, 1); continue;
      }
    }


    // 3) Try to fill pending orders on THIS bar (after position management).
    for (let o = openOrders.length - 1; o >= 0; o--) {
      const ord = openOrders[o];
      // Expiry: bars or timestamp or TIF DAY / session end.
      const expiredByBars = ord.expiryBars != null && (i - (ord.metadata.createdBar as number)) >= ord.expiryBars;
      const expiredByTs = ord.expiryTs != null && bar.ts > ord.expiryTs;
      const expiredSession = cfg.cancelOnSessionEnd && prev && prev.session !== "off" && bar.session === "off";
      const expiredNextDay = cfg.cancelOnNextDay && prev && dayKey(bar.ts) !== dayKey(prev.ts);
      if (expiredByBars || expiredByTs || expiredSession || expiredNextDay) {
        ord.status = "expired"; cancelled.push(ord); openOrders.splice(o, 1);
        ordersExpired++;
        emit("OnOrderExpired", bar.ts, { orderId: ord.orderId, reason: expiredByBars ? "bars" : expiredByTs ? "ts" : expiredSession ? "session_end" : "next_day" });
        continue;
      }
      const hit = triggerHit(ord, bar);
      if (hit == null) {
        if (ord.kind === "market" || cfg.tif === "IOC" || cfg.tif === "FOK") {
          ord.status = "cancelled"; cancelled.push(ord); openOrders.splice(o, 1);
          emit("OnOrderCancelled", bar.ts, { orderId: ord.orderId, reason: "tif_" + cfg.tif });
        }
        continue;
      }
      // Fill: apply spread + slippage.
      const half = spreadPoints(cfg.spread, bar);
      const slip = slippagePoints(cfg.slippage, bar, ord.side);
      const rawFill = ord.kind === "market" ? bar.open : hit;
      const fillPrice = applySlippage(rawFill + (ord.side === "buy" ? half : -half), ord.side, slip);
      ord.status = "filled";
      ord.fillPrice = fillPrice;
      ord.filledTs = bar.ts;
      ord.fillDelayBars = i - (ord.metadata.createdBar as number);
      ordersFilled++;
      emit("OnOrderFilled", bar.ts, { orderId: ord.orderId, fillPrice, spreadPts: half, slippagePts: slip });

      // Open position.
      const dir: "long" | "short" = ord.side === "buy" ? "long" : "short";
      const cmm = commissionFor(cfg.commission, fillPrice, ord.units);
      const spreadCost = half * ord.units;
      const slipCost = slip * ord.units;
      const newPos: OpenPosition = {
        order: ord, entryBarIndex: i, mae: 0, mfe: 0, partials: [],
        fees: cmm + spreadCost + slipCost,
        commission: cmm, slippage: slipCost, spreadCost,
        legs: ord.targetLegs.map((l) => ({ ...l })),
        ctx: {
          direction: dir,
          fillPrice,
          initialStop: ord.stopPrice,
          currentStop: ord.stopPrice,
          runnerHigh: bar.high,
          runnerLow: bar.low,
          breakEvenApplied: false,
        },
      };
      openPositions.push(newPos);
      risk.openPositions++;
      openOrders.splice(o, 1);

      // === FIX: same-bar entry SL / TP resolution ===
      // The trigger bar can itself take out SL or TP after the fill. We can't
      // know intrabar sequence, so on ambiguity (both hit) we conservatively
      // assume SL first. Update MAE/MFE and emit a same_bar_* exit reason.
      const sameHitSl = dir === "long" ? bar.low <= newPos.ctx.currentStop : bar.high >= newPos.ctx.currentStop;
      const sameLegHits = newPos.legs.map((l) =>
        dir === "long" ? bar.high >= l.price : bar.low <= l.price,
      );
      const sameHitTp = sameLegHits.some(Boolean);
      if (sameHitSl || sameHitTp) {
        newPos.mae = dir === "long"
          ? Math.min(newPos.mae, bar.low - fillPrice)
          : Math.min(newPos.mae, fillPrice - bar.high);
        newPos.mfe = dir === "long"
          ? Math.max(newPos.mfe, bar.high - fillPrice)
          : Math.max(newPos.mfe, fillPrice - bar.low);
        const slFirst = sameHitSl && (!sameHitTp || cfg.intrabar === "conservative");
        if (slFirst) {
          closePosition(newPos, bar, i, newPos.ctx.currentStop, "same_bar_stop", cfg, risk, trades, emit);
          openPositions.pop();
          continue;
        }
        // Target first (optimistic) — fill legs and close if fully out.
        let remainingLegs = newPos.legs.filter((l) => !l.filled).length;
        for (let li = 0; li < newPos.legs.length; li++) {
          if (!sameLegHits[li] || newPos.legs[li].filled) continue;
          const leg = newPos.legs[li];
          const legUnits = newPos.order.units * (leg.sizePct / 100);
          const legPnl = pnl(dir, fillPrice, leg.price, legUnits, cfg.contractMultiplier);
          const legCmm = commissionFor(cfg.commission, leg.price, legUnits);
          newPos.commission += legCmm; newPos.fees += legCmm;
          newPos.partials.push({ ts: bar.ts, price: leg.price, units: legUnits, pnl: legPnl - legCmm, reason: `same_bar_tp_${li + 1}` });
          leg.filled = true;
          remainingLegs--;
          emit("OnPartialTP", bar.ts, { orderId: newPos.order.orderId, leg: li + 1, price: leg.price, units: legUnits, pnl: legPnl });
          if (remainingLegs === 0) {
            closePosition(newPos, bar, i, leg.price, "same_bar_target", cfg, risk, trades, emit, true);
            openPositions.pop();
            break;
          }
        }
      }
    }


    // 4) Mark-to-market equity checkpoint (using last close + running open PnL).
    let openPnl = 0;
    for (const pos of openPositions) {
      openPnl += pnl(pos.ctx.direction, pos.ctx.fillPrice, bar.close, pos.order.remainingUnits, cfg.contractMultiplier);
    }
    const equity = risk.equity + openPnl;
    const peak = Math.max(risk.peakEquity, equity);
    equityCurve.push({ ts: bar.ts, equity, drawdownPct: peak > 0 ? (peak - equity) / peak * 100 : 0 });
  }

  // 5) Flush any positions still open at end-of-data.
  const last = bars[bars.length - 1];
  if (last) {
    for (const pos of openPositions) {
      closePosition(pos, last, bars.length - 1, last.close, "end_of_data", cfg, risk, trades, emit);
    }
  }

  // Stats.
  for (const t of trades) {
    grossPnL += t.grossPnL; netPnL += t.netPnL; totalFees += t.fees;
    if (t.netPnL > 0) winners++; else if (t.netPnL < 0) losers++;
  }
  const maxDD = equityCurve.reduce((m, p) => Math.max(m, p.drawdownPct), 0);

  return {
    trades,
    openOrders,
    cancelledOrders: cancelled,
    events,
    equityCurve,
    stats: {
      signalsIn: signalsIngested,
      ordersCreated,
      ordersFilled,
      ordersCancelled: cancelled.filter((o) => o.status === "cancelled").length,
      ordersExpired,
      tradesClosed: trades.length,
      winners, losers,
      grossPnL, netPnL, totalFees,
      maxDrawdownPct: maxDD,
      finalEquity: risk.equity,
      riskBlocks: risk.blockedReasons,
    },
  };
}

// ---------------- helpers ----------------

function pnl(dir: "long" | "short", entry: number, exit: number, units: number, mult: number): number {
  return (dir === "long" ? exit - entry : entry - exit) * units * mult;
}

function orderFromSignal(sig: StrategySignal, cfg: ExecutionConfig, bar: EnrichedCandle, barIndex: number): Order {
  const side: "buy" | "sell" = sig.direction === "long" ? "buy" : "sell";
  const kind: Order["kind"] =
    sig.entryType === "market" ? "market"
    : sig.entryType === "stop" ? "stop"
    : "limit";
  const units = sizeUnits(cfg.sizing, sig.entryPrice, sig.stopLoss, cfg.startingCapital, bar);
  const primaryTarget = sig.targetLegs[0]?.price ?? sig.takeProfit;
  const legs = (sig.targetLegs.length ? sig.targetLegs : [{ kind: "rr" as const, price: sig.takeProfit, sizePct: 100 }])
    .map((l) => ({ price: l.price, sizePct: l.sizePct, filled: false }));
  const goodTill = cfg.goodTillTs ?? sig.expiryTs;
  return {
    orderId: nextOrderId(sig.signalId),
    signalId: sig.signalId,
    strategyId: sig.strategyId,
    symbol: sig.symbol,
    side, kind,
    triggerPrice: sig.entryPrice,
    stopPrice: sig.stopLoss,
    targetPrice: primaryTarget,
    targetLegs: legs,
    units,
    remainingUnits: units,
    createdTs: bar.ts,
    expiryTs: goodTill ?? null,
    expiryBars: cfg.tif === "DAY" ? null : (sig.metadata.expiryBars as number | undefined) ?? null,
    status: "pending",
    fillPrice: null, filledTs: null, fillDelayBars: null,
    metadata: { createdBar: barIndex, tif: cfg.tif },
  };
}

function closePosition(
  pos: OpenPosition,
  bar: EnrichedCandle,
  barIndex: number,
  rawExit: number,
  reason: string,
  cfg: ExecutionConfig,
  risk: ReturnType<typeof initRiskState>,
  trades: Trade[],
  emit: (n: ExecEventName, ts: number, d: ExecEvent["data"]) => void,
  alreadyPartial = false,
): void {
  const half = spreadPoints(cfg.spread, bar);
  const slip = slippagePoints(cfg.slippage, bar, pos.ctx.direction === "long" ? "sell" : "buy");
  const closeSide: "buy" | "sell" = pos.ctx.direction === "long" ? "sell" : "buy";
  const exit = applySlippage(rawExit + (closeSide === "buy" ? half : -half), closeSide, slip);
  const remaining = pos.order.units - pos.partials.reduce((s, p) => s + p.units, 0);
  const closeUnits = Math.max(0, remaining);
  const grossPnl = pnl(pos.ctx.direction, pos.ctx.fillPrice, exit, closeUnits, cfg.contractMultiplier)
    + pos.partials.reduce((s, p) => s + p.pnl, 0);
  const cmm = commissionFor(cfg.commission, exit, closeUnits);
  pos.commission += cmm; pos.spreadCost += half * closeUnits; pos.slippage += slip * closeUnits;
  pos.fees = pos.commission + pos.spreadCost + pos.slippage;
  const netPnl = grossPnl - cmm - half * closeUnits - slip * closeUnits;

  const risk_ = Math.abs(pos.ctx.fillPrice - pos.ctx.initialStop) * pos.order.units * cfg.contractMultiplier;
  const reward_ = Math.abs(pos.legs[0].price - pos.ctx.fillPrice) * pos.order.units * cfg.contractMultiplier;
  const rr = risk_ > 0 ? Math.abs(netPnl) / risk_ * (netPnl < 0 ? -1 : 1) : 0;

  const trade: Trade = {
    tradeId: nextTradeId(),
    signalId: pos.order.signalId,
    strategyId: pos.order.strategyId,
    symbol: pos.order.symbol,
    direction: pos.ctx.direction,
    entryType: pos.order.kind,
    entryTime: pos.order.filledTs ?? pos.order.createdTs,
    entryPrice: pos.order.triggerPrice,
    fillPrice: pos.ctx.fillPrice,
    stopPrice: pos.ctx.initialStop,
    targetPrice: pos.legs[0].price,
    exitPrice: exit,
    exitTime: bar.ts,
    exitReason: reason,
    risk: risk_, reward: reward_, rr,
    grossPnL: grossPnl, netPnL: netPnl,
    fees: pos.fees, commission: pos.commission, slippage: pos.slippage, spreadCost: pos.spreadCost,
    mae: pos.mae, mfe: pos.mfe,
    duration: bar.ts - (pos.order.filledTs ?? pos.order.createdTs),
    fillDelay: pos.order.fillDelayBars ?? 0,
    holdingTime: Math.max(0, barIndex - pos.entryBarIndex),
    partialExits: pos.partials,
    runnerProfit: alreadyPartial ? pos.partials[pos.partials.length - 1]?.pnl ?? 0 : 0,
    status: "closed",
    metadata: {
      currentR: currentR(pos.ctx, exit),
      breakEvenApplied: pos.ctx.breakEvenApplied,
      trailingApplied: pos.ctx.currentStop !== pos.ctx.initialStop,
    },
  };
  trades.push(trade);
  recordClose(risk, trade);
  emit("OnTradeClosed", bar.ts, {
    tradeId: trade.tradeId, signalId: trade.signalId, reason,
    netPnL: netPnl, rr, exit,
  });
}
