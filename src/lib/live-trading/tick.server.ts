// Runs one LIVE trading tick — places REAL orders on SharkExchange for any
// brand-new signal produced by the strategy engine, and reconciles previously
// opened live_trades against the exchange to detect SL/TP exits.
//
// Idempotency: each trade is keyed by runner_id + strategy signalId.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadRawCandles } from "@/lib/market-data/loader.server";
import { enrichCandles } from "@/lib/market-data/enrich";
import { DEFAULT_CONFIG, type Timeframe } from "@/lib/market-data/types";
import { runStrategy } from "@/lib/strategy-engine/engine";
import { runExecution } from "@/lib/execution-engine/engine";
import { STRATEGY_PRESETS } from "@/lib/strategy-engine/presets";
import { EXEC_PRESETS, withRiskUsd } from "@/lib/execution-engine/presets";
import { createSharkClient } from "@/lib/exchange/shark-client.server";
import type { KlineSourceId } from "@/lib/exchange/kline-source.server";

interface RunnerRow {
  id: string;
  label: string;
  source: string;
  symbol: string;
  timeframe: string;
  strategy_preset: string;
  exec_preset: string;
  risk_usd: number;
  lookback_days: number;
  leverage: number;
}

export interface LiveTickReport {
  ok: boolean;
  runners: number;
  results: Array<{
    runner_id: string;
    label: string;
    placed: number;
    reconciled: number;
    error?: string;
  }>;
}

export async function runLiveTradingTick(): Promise<LiveTickReport> {
  const { data: runners, error } = await supabaseAdmin
    .from("live_runners")
    .select("id, label, source, symbol, timeframe, strategy_preset, exec_preset, risk_usd, lookback_days, leverage")
    .eq("running", true);
  if (error) throw new Error(error.message);

  const { windowsForPreset, isWindowActive, minutesUntilOpen } = await import(
    "@/lib/session-windows"
  );

  const out: LiveTickReport["results"] = [];
  for (const r of (runners ?? []) as RunnerRow[]) {
    try {
      // Session-window guard: skip runners that are far outside their entry
      // window AND have no open orders to reconcile. Enter the window 5 min
      // early so the first bar of the session is not missed.
      const windows = windowsForPreset(r.strategy_preset);
      const inWindow =
        windows.length === 0 || // unknown preset → always tick
        windows.some((w) => isWindowActive(w) || minutesUntilOpen(w) <= 5);

      if (!inWindow) {
        const { count } = await supabaseAdmin
          .from("live_trades")
          .select("id", { count: "exact", head: true })
          .eq("runner_id", r.id)
          .in("status", ["open", "pending"]);
        if ((count ?? 0) === 0) {
          out.push({ runner_id: r.id, label: r.label, placed: 0, reconciled: 0 });
          await supabaseAdmin.from("live_runners")
            .update({ last_tick_at: new Date().toISOString(), last_tick_error: null })
            .eq("id", r.id);
          continue;
        }
        // Fall through — we still need to reconcile open orders even off-window.
      }

      const res = await tickOne(r);
      out.push({ runner_id: r.id, label: r.label, ...res });
      await supabaseAdmin.from("live_runners")
        .update({ last_tick_at: new Date().toISOString(), last_tick_error: null })
        .eq("id", r.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push({ runner_id: r.id, label: r.label, placed: 0, reconciled: 0, error: msg });
      await supabaseAdmin.from("live_runners")
        .update({ last_tick_at: new Date().toISOString(), last_tick_error: msg })
        .eq("id", r.id);
    }
  }
  return { ok: true, runners: out.length, results: out };
}

async function tickOne(r: RunnerRow): Promise<{ placed: number; reconciled: number }> {
  const scfg = STRATEGY_PRESETS[r.strategy_preset];
  if (!scfg) throw new Error(`Unknown strategy preset ${r.strategy_preset}`);
  const baseE = EXEC_PRESETS[r.exec_preset];
  if (!baseE) throw new Error(`Unknown exec preset ${r.exec_preset}`);
  const ecfg = withRiskUsd(baseE, Number(r.risk_usd));

  const client = createSharkClient();

  // 0) Sweep stale PENDING limits older than 15 min — prevents orphan queue buildup.
  const STALE_MS = 15 * 60 * 1000;
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const { data: stale } = await supabaseAdmin
    .from("live_trades")
    .select("id, client_order_id")
    .eq("runner_id", r.id)
    .eq("status", "pending")
    .lt("entry_ts", cutoff);
  for (const sp of stale ?? []) {
    if (sp.client_order_id) {
      await client.cancelOrder(sp.client_order_id).catch(() => undefined);
    }
    await supabaseAdmin.from("live_trades").update({
      status: "closed",
      exit_ts: new Date().toISOString(),
      exit_reason: "expired",
    }).eq("id", sp.id);
  }

  // 0.5) Promote QUEUED signals when the symbol is now free.
  // Queued rows carry full entry data; place them on the exchange in order.
  const QUEUE_MAX_AGE_MS = 15 * 60 * 1000;
  const { data: queuedRows } = await supabaseAdmin
    .from("live_trades")
    .select("id, direction, qty, entry_price, stop_price, target_price, entry_ts")
    .eq("runner_id", r.id)
    .eq("symbol", r.symbol)
    .eq("status", "queued")
    .order("entry_ts", { ascending: true });
  for (const q of queuedRows ?? []) {
    const ageMs = Date.now() - new Date(q.entry_ts as string).getTime();
    if (ageMs > QUEUE_MAX_AGE_MS) {
      await supabaseAdmin.from("live_trades").update({
        status: "closed",
        exit_ts: new Date().toISOString(),
        exit_reason: "expired_queue",
      }).eq("id", q.id);
      continue;
    }
    const { count: busyNow } = await supabaseAdmin
      .from("live_trades")
      .select("id", { count: "exact", head: true })
      .eq("symbol", r.symbol)
      .in("status", ["open", "pending"]);
    if ((busyNow ?? 0) > 0) break;
    try {
      try { await client.updateLeverage(r.symbol, r.leverage); } catch { /* ignore */ }
      const res = await client.placeOrder({
        symbol: r.symbol,
        side: q.direction === "long" ? "buy" : "sell",
        qty: Number(q.qty),
        type: "limit",
        price: Number(q.entry_price),
        // SL/TP are NOT attached at entry — engine manages exits based on age (30-min rule).
      });
      const filled = res.status === "filled";
      await supabaseAdmin.from("live_trades").update({
        client_order_id: res.exchangeOrderId || null,
        fill_price: res.filledPrice ?? null,
        status: filled ? "open" : "pending",
        fill_ts: filled ? new Date().toISOString() : null,
        raw_place: res.raw as never,
      }).eq("id", q.id);
      break; // symbol slot now taken — remaining queued rows wait
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin.from("live_trades").update({
        status: "error",
        error: msg.slice(0, 500),
      }).eq("id", q.id);
    }
  }

  // 1) Reconcile still-open live trades against the exchange.
  const reconciled = await reconcileOpen(r, client);


  // 2) Load fresh candles and run the strategy.
  const toMs = Date.now();
  const fromMs = toMs - Number(r.lookback_days) * 24 * 60 * 60 * 1000;
  const { candles } = await loadRawCandles({
    source: r.source as KlineSourceId,
    symbol: r.symbol,
    timeframe: r.timeframe as Timeframe,
    fromMs, toMs,
  });
  if (!candles.length) return { placed: 0, reconciled };

  const enriched = enrichCandles(candles, {
    ...DEFAULT_CONFIG,
    symbol: r.symbol,
    timeframe: r.timeframe as Timeframe,
  });
  const sres = runStrategy(enriched, scfg, { mode: "live", symbol: r.symbol });
  const eres = runExecution(enriched, sres.signals, ecfg, { symbol: r.symbol });

  // Only look at the newest "still-open" flushed trade — that's the current signal.
  const openFlush = eres.trades.find((t) => t.exitReason === "end_of_data");
  if (!openFlush) return { placed: 0, reconciled };

  // Dedup: skip if a live_trade already exists for this signalId.
  const { data: existing } = await supabaseAdmin
    .from("live_trades")
    .select("id")
    .eq("runner_id", r.id)
    .eq("dedup_key", openFlush.signalId)
    .maybeSingle();
  if (existing) return { placed: 0, reconciled };

  // NOTE: Symbol-level lock is applied AFTER qty is computed (see below), so
  // if the symbol is busy we can queue this signal locally with full entry data.


  // Cancel-and-replace: if a still-PENDING limit order exists for this runner
  // (parent not yet filled) with a different signalId, cancel it on the
  // exchange and mark the DB row cancelled before placing the new one.
  const { data: stalePendings } = await supabaseAdmin
    .from("live_trades")
    .select("id, client_order_id")
    .eq("runner_id", r.id)
    .eq("status", "pending");
  for (const sp of stalePendings ?? []) {
    if (sp.client_order_id) {
      await client.cancelOrder(sp.client_order_id).catch(() => undefined);
    }
    await supabaseAdmin
      .from("live_trades")
      .update({
        status: "closed",
        exit_ts: new Date().toISOString(),
        exit_reason: "cancelled_replaced",
      })
      .eq("id", sp.id);
  }


  // Contradictory-entry rule (LIVE, IMMEDIATE):
  // If a still-open live_trade exists for this runner on the same symbol
  // but the opposite direction, DON'T wait for a candle close.
  //  - If it's currently in profit → ignore the new signal.
  //  - If it's in loss → close it right now on the exchange (market,
  //    reduce-only), cancel its SL/TP children, mark the DB row closed,
  //    THEN place the reverse.
  const { data: openOpposite } = await supabaseAdmin
    .from("live_trades")
    .select("id, client_order_id, direction, qty, entry_price, stop_price, target_price, fill_ts, entry_ts, status")
    .eq("runner_id", r.id)
    .eq("symbol", r.symbol)
    .in("status", ["open", "pending"])
    .neq("direction", openFlush.direction)
    .maybeSingle();
  if (openOpposite) {
    let last = 0;
    try { last = await client.getLastPrice(r.symbol); } catch { /* keep 0 */ }
    if (last > 0) {
      const dir = openOpposite.direction === "long" ? 1 : -1;
      const uPnl = (last - Number(openOpposite.entry_price)) * dir * Number(openOpposite.qty);
      if (uPnl >= 0) {
        // In profit → ignore this contradictory signal entirely.
        return { placed: 0, reconciled };
      }
      // In loss → force-close now.
      // 1) Cancel any child SL/TP orders still open on this symbol.
      try {
        const childOrders = await client.getOpenOrders(r.symbol);
        for (const co of childOrders) {
          if (!co.clientOrderId) continue;
          if (openOpposite.client_order_id && co.clientOrderId === openOpposite.client_order_id) continue;
          if (co.reduceOnly === true || co.subType === "STOP_LOSS" || co.subType === "TAKE_PROFIT") {
            await client.cancelOrder(co.clientOrderId).catch(() => undefined);
          }
        }
      } catch { /* ignore */ }
      // 2) Reduce-only close in the opposite side. Use MARKET if <30m
      //    since fill (fee-free), else LIMIT reduce-only at last price.
      const closeSide: "buy" | "sell" = openOpposite.direction === "long" ? "sell" : "buy";
      let exitPrice = last;
      const exitPick = pickExitOrderType(
        openOpposite.fill_ts ?? openOpposite.entry_ts,
        last,
      );
      try {
        const closeRes = await client.placeOrder({
          symbol: r.symbol,
          side: closeSide,
          qty: Number(openOpposite.qty),
          type: exitPick.type,
          price: exitPick.type === "limit" ? exitPick.price : undefined,
          reduceOnly: true,
        });
        if (closeRes.filledPrice && closeRes.filledPrice > 0) exitPrice = closeRes.filledPrice;
      } catch {
        // If the reduce-only close fails, bail out — we won't place a
        // contradictory entry while the opposite exposure is still live.
        return { placed: 0, reconciled };
      }
      // 3) Also cancel the parent order id if still listed.
      if (openOpposite.client_order_id) {
        await client.cancelOrder(openOpposite.client_order_id).catch(() => undefined);
      }
      // 4) Update DB row.
      const grossPnl = uPnl;
      const stopDist = Math.abs(Number(openOpposite.entry_price) - Number(openOpposite.stop_price));
      const rr = stopDist > 0
        ? ((exitPrice - Number(openOpposite.entry_price)) * dir) / stopDist
        : 0;
      await supabaseAdmin.from("live_trades").update({
        status: "closed",
        exit_ts: new Date().toISOString(),
        exit_price: exitPrice,
        exit_reason: "reverse_on_loss",
        rr,
        gross_pnl: grossPnl,
        net_pnl: grossPnl,
        fees: 0,
      }).eq("id", openOpposite.id);
    } else {
      // No fresh price → don't guess. Skip this tick.
      return { placed: 0, reconciled };
    }
  }

  // 3) Size from stop distance so loss ≈ risk_usd on hit.
  const stopDist = Math.abs(openFlush.fillPrice - openFlush.stopPrice);
  if (stopDist <= 0) return { placed: 0, reconciled };
  const qty = Math.max(0.001, Number((Number(r.risk_usd) / stopDist).toFixed(3)));

  // 4) Best-effort leverage update — ignore errors.
  try { await client.updateLeverage(r.symbol, r.leverage); } catch { /* ignore */ }

  // 5) Place market order with attached SL/TP.
  let placedOk = 0;
  const insertBase = {
    runner_id: r.id,
    dedup_key: openFlush.signalId,
    symbol: r.symbol,
    timeframe: r.timeframe,
    strategy_preset: r.strategy_preset,
    direction: openFlush.direction,
    qty,
    entry_ts: new Date(openFlush.entryTime).toISOString(),
    entry_price: openFlush.fillPrice,
    stop_price: openFlush.stopPrice,
    target_price: openFlush.targetPrice,
  };

  // Symbol-level lock: only ONE live position per symbol across all runners.
  // If the symbol is busy, QUEUE this signal locally (not sent to exchange).
  // The queue-promote block at the top of tickOne will place it once the
  // current position closes, as long as it's still fresh (< 15 min old).
  const { count: symbolBusy } = await supabaseAdmin
    .from("live_trades")
    .select("id", { count: "exact", head: true })
    .eq("symbol", r.symbol)
    .in("status", ["open", "pending"]);
  if ((symbolBusy ?? 0) > 0) {
    await supabaseAdmin.from("live_trades").insert({
      ...insertBase,
      status: "queued",
    });
    return { placed: 0, reconciled };
  }
  try {
    const res = await client.placeOrder({
      symbol: r.symbol,
      side: openFlush.direction === "long" ? "buy" : "sell",
      qty,
      type: "limit",
      price: openFlush.fillPrice,
      // SL/TP are NOT attached at entry — engine manages exits based on age (30-min rule).
    });
    const filled = res.status === "filled";
    await supabaseAdmin.from("live_trades").insert({
      ...insertBase,
      client_order_id: res.exchangeOrderId || null,
      fill_price: res.filledPrice ?? null,
      status: filled ? "open" : "pending",
      fill_ts: filled ? new Date().toISOString() : null,
      raw_place: res.raw as never,
    });
    placedOk = 1;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabaseAdmin.from("live_trades").insert({
      ...insertBase,
      status: "error",
      error: msg.slice(0, 500),
    });
    throw e;
  }
  return { placed: placedOk, reconciled };
}

/** 30-minute exit-type rule (Shark Exchange zero-fee scalping offer):
 *  Closing trades within 30 minutes of entry fill are fee-free regardless
 *  of order type, so use MARKET (avoid slippage risk from unfilled limits).
 *  Beyond 30 minutes, taker fees apply — use LIMIT reduce-only at the level. */
function pickExitOrderType(
  fillTsIso: string | null | undefined,
  levelPrice: number,
): { type: "market" } | { type: "limit"; price: number } {
  const FREE_WINDOW_MS = 30 * 60 * 1000;
  const t = fillTsIso ? new Date(fillTsIso).getTime() : NaN;
  if (!Number.isFinite(t)) return { type: "limit", price: levelPrice };
  const ageMs = Date.now() - t;
  return ageMs < FREE_WINDOW_MS ? { type: "market" } : { type: "limit", price: levelPrice };
}

/** Reconcile each open/pending live_trade row against the exchange.
 *  Source of truth for "still open" = an actual open POSITION on the symbol
 *  whose side + qty covers this row. Parent order id alone is unreliable
 *  because SL/TP children have different clientOrderIds. */
async function reconcileOpen(
  r: RunnerRow,
  client: ReturnType<typeof createSharkClient>,
): Promise<number> {
  const { data: openRows } = await supabaseAdmin
    .from("live_trades")
    .select("id, status, client_order_id, exit_client_order_id, direction, qty, entry_price, stop_price, target_price, fill_ts, entry_ts")
    .eq("runner_id", r.id)
    .in("status", ["open", "pending"]);
  if (!openRows?.length) return 0;

  let openOrders: Awaited<ReturnType<typeof client.getOpenOrders>> = [];
  try {
    openOrders = await client.getOpenOrders(r.symbol);
  } catch {
    // API hiccup — don't guess anything this tick.
    return 0;
  }
  const openIds = new Set(openOrders.map((o) => o.clientOrderId));

  let positions: Awaited<ReturnType<typeof client.getOpenPositions>> = [];
  try {
    positions = await client.getOpenPositions(r.symbol);
  } catch {
    // Position endpoint failed — do NOT close anything without truth.
    return 0;
  }

  const netQtyByDir = (dir: "long" | "short") =>
    positions
      .filter((p) => {
        const s = p.side.toUpperCase();
        return dir === "long"
          ? s === "LONG" || s === "BUY"
          : s === "SHORT" || s === "SELL";
      })
      .reduce((a, p) => a + Math.abs(p.qty), 0);

  // Pull recent fills once so we can match real exit fills.
  let recentFills: Awaited<ReturnType<typeof client.getRecentFills>> = [];
  try { recentFills = await client.getRecentFills(r.symbol); } catch { /* keep [] */ }

  // Last price for breach detection (skip exits this tick if unavailable).
  let lastPrice = 0;
  try { lastPrice = await client.getLastPrice(r.symbol); } catch { /* keep 0 */ }

  const near = (a: number | null, b: number) => a != null && Math.abs(a - b) / b < 0.001;

  let n = 0;
  for (const row of openRows) {
    if (!row.client_order_id) continue;

    if (row.status === "pending") {
      // Parent limit still on the book → still pending.
      if (openIds.has(row.client_order_id)) continue;

      // Parent gone → filled or cancelled. Prefer real fill; else infer from position.
      const fill = await client.getFillForClientOrderId(row.client_order_id).catch(() => null);
      const posQty = netQtyByDir(row.direction as "long" | "short");
      if ((fill?.price && fill.price > 0 && (fill.qty ?? 0) > 0) || posQty >= Number(row.qty) * 0.999) {
        await supabaseAdmin.from("live_trades").update({
          status: "open",
          fill_price: fill?.price ?? Number(row.entry_price),
          entry_price: fill?.price ?? Number(row.entry_price),
          // Stamp the age-clock the first time we detect a fill.
          fill_ts: row.fill_ts ?? new Date().toISOString(),
        }).eq("id", row.id);
      } else {
        await supabaseAdmin.from("live_trades").update({
          status: "closed",
          exit_ts: new Date().toISOString(),
          exit_reason: "cancelled",
        }).eq("id", row.id);
      }
      n += 1;
      continue;
    }

    // OPEN (already filled). SL/TP are NOT attached at entry anymore — the
    // engine watches price and sends the exit itself, picking MARKET or LIMIT
    // by the 30-minute rule (market is fee-free under 30m).
    const posQty = netQtyByDir(row.direction as "long" | "short");

    // If the position is gone, try to match a real exit fill and close the row.
    if (posQty <= 0) {
      const closeSide = row.direction === "long" ? "SELL" : "BUY";
      const qtyTarget = Number(row.qty);
      const candidates = recentFills.filter((f) =>
        f.symbol.toUpperCase() === r.symbol.toUpperCase() &&
        f.side === closeSide &&
        (f.reduceOnly === true || f.reduceOnly === null) &&
        f.qty > 0 &&
        Math.abs(f.qty - qtyTarget) / qtyTarget < 0.1
      );
      if (candidates.length === 0) continue; // wait for fill to appear
      candidates.sort((a, b) => b.timeMs - a.timeMs);
      const exit = candidates[0];
      const dir = row.direction === "long" ? 1 : -1;
      const exitPrice = exit.price;
      const grossPnl = exit.realizedPnl !== 0
        ? exit.realizedPnl
        : (exitPrice - Number(row.entry_price)) * dir * Number(row.qty);
      const fees = Math.abs(exit.fee);
      const netPnl = grossPnl - fees;
      const stopDist = Math.abs(Number(row.entry_price) - Number(row.stop_price));
      const rr = stopDist > 0 ? ((exitPrice - Number(row.entry_price)) * dir) / stopDist : 0;
      const exitReason =
        near(exit.price, Number(row.stop_price)) ? "stop"
        : near(exit.price, Number(row.target_price)) ? "target"
        : "closed";
      await supabaseAdmin.from("live_trades").update({
        status: "closed",
        exit_ts: new Date(exit.timeMs || Date.now()).toISOString(),
        exit_price: exitPrice,
        exit_reason: exitReason,
        rr,
        gross_pnl: grossPnl,
        net_pnl: netPnl,
        fees,
      }).eq("id", row.id);
      n += 1;
      continue;
    }

    // Position still open. Check SL/TP breach against last price.
    if (lastPrice <= 0) continue;
    const dir = row.direction === "long" ? 1 : -1;
    const stopHit = row.direction === "long"
      ? lastPrice <= Number(row.stop_price)
      : lastPrice >= Number(row.stop_price);
    const targetHit = row.direction === "long"
      ? lastPrice >= Number(row.target_price)
      : lastPrice <= Number(row.target_price);
    if (!stopHit && !targetHit) continue;

    // If we already have a live reduce-only exit order on the book, don't double-send.
    const existingExit = openOrders.find((o) =>
      (o.reduceOnly === true || o.subType === "STOP_LOSS" || o.subType === "TAKE_PROFIT") &&
      o.clientOrderId &&
      (row.exit_client_order_id
        ? o.clientOrderId === row.exit_client_order_id
        : true)
    );
    if (existingExit) continue;

    const level = stopHit ? Number(row.stop_price) : Number(row.target_price);
    const closeSide: "buy" | "sell" = row.direction === "long" ? "sell" : "buy";
    const pick = pickExitOrderType(row.fill_ts ?? row.entry_ts, level);
    try {
      const exitRes = await client.placeOrder({
        symbol: r.symbol,
        side: closeSide,
        qty: Number(row.qty),
        type: pick.type,
        price: pick.type === "limit" ? pick.price : undefined,
        reduceOnly: true,
      });
      await supabaseAdmin.from("live_trades").update({
        exit_client_order_id: exitRes.exchangeOrderId || null,
      }).eq("id", row.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[live-tick][exit] placeOrder failed", { rowId: row.id, msg });
    }
    // Row itself is closed on the next tick when the fill appears in history.
    // dir is used above in the position-gone branch; silence unused warning.
    void dir;
  }
  return n;
}
