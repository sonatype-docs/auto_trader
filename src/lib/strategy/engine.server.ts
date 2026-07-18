import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createSharkClient, type Kline } from "@/lib/exchange/shark-client.server";
import { getKlineSource } from "@/lib/exchange/kline-source.server";
import { processSignal } from "@/lib/trading/engine.server";
import { computeEntry, entryConfigFromSettings } from "@/lib/strategy/entry-modes.server";



const IST_OFFSET_MIN = 330; // UTC+5:30

// (istDate helper removed — engine uses sessionDate for trading-day boundaries.)


// Return the "trading session date" (YYYY-MM-DD in IST) for `now`, where a
// session runs from sessionStartIst (e.g. 05:30) of day D until sessionStartIst
// of day D+1. So between 00:00 and 05:29 IST, the session date is the previous
// calendar day. Yesterday's pending setups are expired the moment this rolls.
function sessionDate(msUtc: number, sessionStartIst: string): string {
  const [hh, mm] = sessionStartIst.split(":").map((n) => parseInt(n, 10));
  const startMinOfDay = hh * 60 + (mm || 0);
  const ist = new Date(msUtc + IST_OFFSET_MIN * 60_000);
  const minOfDay = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (minOfDay < startMinOfDay) {
    ist.setUTCDate(ist.getUTCDate() - 1);
  }
  return ist.toISOString().slice(0, 10);
}

function istWeekday(istDateStr: string): number {
  const [y, m, d] = istDateStr.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sun … 6 Sat
}

// The 1h candle openTime (UTC ms) for the IST session-start hour on a given IST date.
// Default 05:30 IST → 00:00 UTC.
function sessionOpenUtcMs(istDateStr: string, sessionStartIst: string): number {
  const [hh, mm] = sessionStartIst.split(":").map((n) => parseInt(n, 10));
  const totalMin = hh * 60 + (mm || 0) - IST_OFFSET_MIN;
  // Normalize possibly negative minutes → previous UTC day
  const [y, m, d] = istDateStr.split("-").map((n) => parseInt(n, 10));
  const baseUtc = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const openMs = baseUtc + totalMin * 60_000;
  // Snap to hour open
  return Math.floor(openMs / 3_600_000) * 3_600_000;
}

interface StrategySettingsRow {
  enabled: boolean;
  symbol: string;
  sl_risk_usd: number;
  rr: number;
  session_start_ist: string;
  trail_enabled?: boolean;
  trail_activate_r?: number;
  trail_step_r?: number;
  skip_weekends?: boolean;
  skip_weekdays?: number[] | null;
  fee_usd_per_order?: number;
  zone_source?: "range" | "breakout" | null;
  data_source?: "shark" | "yahoo" | null;
  ai_grading_enabled?: boolean;
  ai_grading_model?: unknown;
  ai_risk_multipliers?: Record<string, number> | null;
  ai_min_grade?: string;
}



interface SessionRow {
  ist_date: string;
  symbol: string;
  zone_high: number;
  zone_low: number;
  fib_25: number;
  fib_75: number;
  break_side: "long" | "short" | null;
  break_detected_at: string | null;
  break_close_price: number | null;
}

interface SetupRow {
  id: string;
  ist_date: string;
  symbol: string;
  side: "long" | "short";
  entry_price: number;
  sl_price: number;
  tp_price: number;
  qty: number;
  status: "armed" | "triggered" | "closed" | "expired" | "cancelled";
  order_id: string | null;
  close_order_id: string | null;
  close_reason: string | null;
  pnl_usd: number | null;
  filled_at: string | null;
  closed_at: string | null;
  peak_r?: number;
  initial_sl_price?: number | null;
  exchange_order_id?: string | null;
  sl_child_order_id?: string | null;
  tp_child_order_id?: string | null;
  ai_grade?: string | null;
  ai_score?: number | null;
  ai_risk_mult?: number | null;
  updated_at?: string | null;
}

export interface StrategyTickResult {
  ok: boolean;
  reason?: string;
  ist_date?: string;
  session?: SessionRow | null;
  actions: string[];
}

async function log(severity: "info" | "warn" | "error", message: string, context?: Record<string, unknown>) {
  await supabaseAdmin.from("activity_log").insert({
    severity,
    message: `[strategy] ${message}`,
    context: (context as never) ?? null,
  });
}

/**
 * Append an audit event to the per-setup timeline. Fire-and-forget: any error
 * is logged to activity_log but never blocks the caller. Accepts a nullable
 * setupId so callers that don't have one (e.g. paper mode) become a no-op.
 */
async function logSetupEvent(
  setupId: string | null | undefined,
  event_type: string,
  fields?: {
    exchange_order_id?: string | null;
    leverage?: number | null;
    qty?: number | null;
    price?: number | null;
    reason?: string | null;
    payload?: Record<string, unknown> | null;
  },
): Promise<void> {
  if (!setupId) return;
  try {
    await supabaseAdmin.from("strategy_setup_events").insert({
      setup_id: setupId,
      event_type,
      exchange_order_id: fields?.exchange_order_id ?? null,
      leverage: fields?.leverage ?? null,
      qty: fields?.qty ?? null,
      price: fields?.price ?? null,
      reason: fields?.reason ?? null,
      payload: (fields?.payload as never) ?? null,
    });
  } catch (e) {
    await log("warn", "setup_event insert failed", {
      setup_id: setupId,
      event_type,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Convenience: emit a placement outcome (success / capped / failed) event
 * summarising a MarginRetryResult. Called at every place-order call site
 * after the setup id is known.
 */
async function emitPlacementOutcome(
  setupId: string | null | undefined,
  attempt: MarginRetryResult,
  requestedQty: number,
  price: number | null,
): Promise<void> {
  if (!setupId) return;
  const kind = attempt.res
    ? attempt.capped
      ? "placement_capped"
      : "placement_success"
    : "placement_failed";
  await logSetupEvent(setupId, kind, {
    exchange_order_id: attempt.res?.exchangeOrderId ?? null,
    leverage: attempt.leverage,
    qty: attempt.finalQty,
    price,
    reason: attempt.error,
    payload: {
      attempts: attempt.attempts,
      requested_qty: requestedQty,
      capped: attempt.capped,
    },
  });
}

// Detect "Insufficient margin" style rejections from SharkExchange so we can
// retry full planned qty after the exchange releases any locked margin.
function isInsufficientMarginError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const s = msg.toLowerCase();
  return s.includes("insufficient margin") || s.includes('"3018"') || s.includes("code:3018");
}

function isRecoverableCapacityError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const s = msg.toLowerCase();
  return isInsufficientMarginError(msg) || s.includes('"3070"') || s.includes("maximum position size");
}

function isMaximumPositionSizeError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const s = msg.toLowerCase();
  return s.includes('"3070"') || s.includes("maximum position size");
}

function roundExchangeQty(qty: number): number {
  return Math.round(qty * 1000) / 1000;
}

function roundExchangePrice(price: number): number {
  return Math.round(price * 100) / 100;
}

function sameExchangeNumber(a: number | null | undefined, b: number, decimals: 2 | 3): boolean {
  if (a == null || !Number.isFinite(Number(a)) || !Number.isFinite(b)) return false;
  const factor = decimals === 2 ? 100 : 1000;
  return Math.round(Number(a) * factor) === Math.round(b * factor);
}

function samePendingSetupOrder(order: { side: string; price: number | null; quantity: number | null }, setup: SetupRow): boolean {
  const expectedSide = setup.side === "long" ? "BUY" : "SELL";
  return (
    order.side.toUpperCase() === expectedSide &&
    sameExchangeNumber(order.price, setup.entry_price, 2) &&
    sameExchangeNumber(order.quantity, setup.qty, 3)
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findBreakCandle(klines: Kline[], session: SessionRow, breakClose: number): Kline | null {
  const breakMs = session.break_detected_at ? new Date(session.break_detected_at).getTime() : NaN;
  if (Number.isFinite(breakMs)) {
    return (
      klines.find((k) => k.closeTime === breakMs) ??
      klines.find((k) => k.openTime <= breakMs && k.closeTime >= breakMs) ??
      null
    );
  }
  return klines.find((k) => k.close === breakClose) ?? null;
}

function sameNullableNumber(a: number | null | undefined, b: number | null | undefined, precision = 4): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const factor = 10 ** precision;
  return Math.round(Number(a) * factor) === Math.round(Number(b) * factor);
}

type AiSetupDecision = {
  grade: string | null;
  score: number | null;
  riskMult: number | null;
  effectiveSlRiskUsd: number;
  skipped: boolean;
  minGrade?: string;
};

async function scoreLiveAiSetup(args: {
  settings: StrategySettingsRow;
  session: SessionRow;
  klines: Kline[];
  todayIst: string;
  side: "long" | "short";
  zoneHigh: number;
  zoneLow: number;
  breakClose: number;
}): Promise<AiSetupDecision> {
  const { settings: s, session, klines, todayIst, side, zoneHigh, zoneLow, breakClose } = args;
  const baseRisk = Number(s.sl_risk_usd);
  if (!s.ai_grading_enabled || !s.ai_grading_model) {
    return { grade: null, score: null, riskMult: null, effectiveSlRiskUsd: baseRisk, skipped: false };
  }

  try {
    const { scoreCandidate, DEFAULT_RISK_MULTIPLIERS, GRADE_RISK_USD, GRADE_ORDER } = await import("@/lib/research/grading");
    const bc = findBreakCandle(klines, session, breakClose);
    const bcRange = bc ? bc.high - bc.low : 0;
    const bcBody = bc ? Math.abs(bc.close - bc.open) : 0;
    const orRange = zoneHigh - zoneLow;
    const breakDistanceUsd = side === "long" ? breakClose - zoneHigh : zoneLow - breakClose;
    const breakHourIst = session.break_detected_at
      ? new Date(new Date(session.break_detected_at).getTime() + IST_OFFSET_MIN * 60_000).getUTCHours()
      : null;
    const istDate = new Date(`${todayIst}T00:00:00Z`);
    const candidate = {
      side,
      or_size_usd: orRange,
      break_distance_usd: breakDistanceUsd,
      break_distance_pct_or: orRange > 0 ? (breakDistanceUsd / orRange) * 100 : null,
      body_pct: bcRange > 0 ? (bcBody / bcRange) * 100 : null,
      upper_wick_pct: bc && bcRange > 0 ? ((bc.high - Math.max(bc.open, bc.close)) / bcRange) * 100 : null,
      lower_wick_pct: bc && bcRange > 0 ? ((Math.min(bc.open, bc.close) - bc.low) / bcRange) * 100 : null,
      break_hour_ist: breakHourIst,
      weekday: istDate.getUTCDay(),
      month: istDate.getUTCMonth() + 1,
      quarter: Math.floor(istDate.getUTCMonth() / 3) + 1,
    };
    const graded = scoreCandidate(candidate as never, s.ai_grading_model as Parameters<typeof scoreCandidate>[1]);
    // Absolute per-grade SL$ table is the source of truth.
    // A user-supplied override (settings.ai_risk_multipliers, when values look
    // like absolute USD amounts, i.e. any value > 5) is treated as an override map.
    const overrideMap = (s.ai_risk_multipliers && typeof s.ai_risk_multipliers === "object"
      ? (s.ai_risk_multipliers as Record<string, number>)
      : null);
    const overrideRaw = overrideMap ? Number(overrideMap[graded.grade]) : NaN;
    const overrideIsAbsolute = Number.isFinite(overrideRaw) && overrideRaw > 5;
    const effectiveSlRiskUsd = overrideIsAbsolute
      ? overrideRaw
      : Number(GRADE_RISK_USD[graded.grade] ?? 0);
    const mult = baseRisk > 0 ? effectiveSlRiskUsd / baseRisk : 0;
    const minGradeCandidate = String(s.ai_min_grade ?? "B");
    const minGrade = (GRADE_ORDER as readonly string[]).includes(minGradeCandidate) ? minGradeCandidate : "B";
    const gradeRank = (GRADE_ORDER as readonly string[]).indexOf(graded.grade);
    const minRank = (GRADE_ORDER as readonly string[]).indexOf(minGrade);
    // Reference DEFAULT_RISK_MULTIPLIERS so lint/tree-shake keeps the import
    // (kept for backward compatibility with older settings payloads).
    void DEFAULT_RISK_MULTIPLIERS;
    return {
      grade: graded.grade,
      score: graded.score,
      riskMult: mult,
      effectiveSlRiskUsd,
      skipped: gradeRank > minRank || effectiveSlRiskUsd <= 0,
      minGrade,
    };
  } catch (e) {
    await log("warn", "ai_grade failed — proceeding with base risk", { error: (e as Error).message });
    return { grade: null, score: null, riskMult: null, effectiveSlRiskUsd: baseRisk, skipped: false };
  }
}

interface MarginRetryResult {
  res: Awaited<ReturnType<ReturnType<typeof createSharkClient>["placeOrder"]>> | null;
  finalQty: number;
  error: string | null;
  attempts: number;
  capped: boolean;
  leverage: number | null;
}


// Place a Shark order at the exact exchange-supported planned size. We do NOT
// shrink/cap qty here: the strategy's qty is derived from the configured SL
// risk and current AI multiplier, so reducing it silently changes planned risk.
// On margin/capacity errors we only retry the same full exchange-rounded qty to
// handle brief margin-release delays after cancel/replace.
async function placeOrderWithMarginRetry(
  client: ReturnType<typeof createSharkClient>,
  params: {
    symbol: string;
    side: "buy" | "sell";
    qty: number;
    type: "market" | "limit";
    price: number;
    stopLossPrice: number;
    takeProfitPrice: number;
  },
  opts: { minQty?: number; maxAttempts?: number; fullQtyAttempts?: number; retryDelayMs?: number } = {},
): Promise<MarginRetryResult> {
  const minQty = opts.minQty ?? 0.001;
  const retryDelayMs = opts.retryDelayMs ?? 1500;
  const fullQtyAttempts = opts.fullQtyAttempts ?? 8;
  const maxAttempts = opts.maxAttempts ?? fullQtyAttempts;
  const qty = roundExchangeQty(params.qty);
  let attempts = 0;
  let lastError: string | null = null;
  // Exchange caps leverage at 75x — use it as the standard/max for margin relief.
  const marginLevSteps = [75];
  // Lower leverage reduces effective notional cap -> use on "max position size".
  const capLevSteps = [50, 25, 10];
  let marginStepIdx = 0;
  let capStepIdx = 0;
  let currentLeverage: number | null = null;
  while (attempts < maxAttempts && qty >= minQty) {
    attempts += 1;
    try {
      const res = await client.placeOrder({ ...params, qty });
      if (res.status === "rejected") {
        lastError = "exchange rejected";
        break;
      }
      return { res, finalQty: qty, error: null, attempts, capped: false, leverage: currentLeverage };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastError = msg;
      if (!isRecoverableCapacityError(msg)) break;

      let adjusted = false;
      if (isMaximumPositionSizeError(msg) && capStepIdx < capLevSteps.length) {
        const leverage = capLevSteps[capStepIdx++];
        try {
          const levRes = await client.updateLeverage(params.symbol, leverage);
          await log(levRes.ok ? "info" : "warn", "place: lowered leverage after max-position-size rejection", {
            symbol: params.symbol, leverage, status: levRes.status, body: levRes.body.slice(0, 300),
          });
          if (levRes.ok) currentLeverage = leverage;
          adjusted = true;
        } catch (levError) {
          await log("warn", "place: leverage adjustment failed", {
            symbol: params.symbol, leverage,
            error: levError instanceof Error ? levError.message : String(levError),
          });
        }
      } else if (isInsufficientMarginError(msg) && marginStepIdx < marginLevSteps.length) {
        const leverage = marginLevSteps[marginStepIdx++];
        try {
          const levRes = await client.updateLeverage(params.symbol, leverage);
          await log(levRes.ok ? "info" : "warn", "place: raised leverage after insufficient-margin rejection", {
            symbol: params.symbol, leverage, status: levRes.status, body: levRes.body.slice(0, 300),
          });
          if (levRes.ok) currentLeverage = leverage;
          adjusted = true;
        } catch (levError) {
          await log("warn", "place: leverage adjustment failed", {
            symbol: params.symbol, leverage,
            error: levError instanceof Error ? levError.message : String(levError),
          });
        }
      }

      if (attempts < maxAttempts) {
        await log("warn", "place: retrying full AI-sized qty after exchange capacity/margin rejection", {
          symbol: params.symbol, side: params.side, qty, attempt: attempts, adjusted, error: msg,
        });
        await wait(adjusted ? 400 : retryDelayMs);
        continue;
      }
      await log("warn", "place: full AI-sized qty rejected after leverage escalation", {
        symbol: params.symbol, side: params.side, planned_qty: qty, error: msg,
      });
      break;
    }
  }

  // Final safety net: leverage escalation was exhausted but user requires an
  // order on the book. Try progressively smaller qty so a pending order lands.
  // This intentionally deviates from the AI-planned SL risk — logged as capped.
  if (isRecoverableCapacityError(lastError)) {
    const cappedSteps = [0.75, 0.5, 0.33, 0.2];
    for (const frac of cappedSteps) {
      const cappedQty = roundExchangeQty(qty * frac);
      if (cappedQty < minQty) continue;
      attempts += 1;
      try {
        const res = await client.placeOrder({ ...params, qty: cappedQty });
        if (res.status === "rejected") {
          lastError = "exchange rejected";
          continue;
        }
        await log("warn", "place: capped-qty fallback placed after leverage escalation exhausted", {
          symbol: params.symbol, side: params.side, planned_qty: qty, capped_qty: cappedQty, fraction: frac,
        });
        return { res, finalQty: cappedQty, error: null, attempts, capped: true, leverage: currentLeverage };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lastError = msg;
        if (!isRecoverableCapacityError(msg)) break;
      }
    }
  }
  return { res: null, finalQty: qty, error: lastError ?? "place_failed", attempts, capped: false, leverage: currentLeverage };
}

function placementFields(
  attempt: MarginRetryResult,
  requestedQty: number,
): {
  placement_status: string;
  placement_leverage: number | null;
  placement_error: string | null;
  placement_capped: boolean;
  requested_qty: number;
  placement_attempts: number;
  placement_at: string;
} {
  return {
    placement_status: attempt.res ? (attempt.capped ? "placed_capped" : "placed") : "failed",
    placement_leverage: attempt.leverage,
    placement_error: attempt.error,
    placement_capped: attempt.capped,
    requested_qty: requestedQty,
    placement_attempts: attempt.attempts,
    placement_at: new Date().toISOString(),
  };
}







export async function runStrategyTick(): Promise<StrategyTickResult> {
  const actions: string[] = [];

  const { data: settings } = await supabaseAdmin
    .from("strategy_settings")
    .select("*")
    .eq("id", true)
    .single();
  const s = settings as StrategySettingsRow | null;
  if (!s) return { ok: false, reason: "settings_missing", actions };
  if (!s.enabled) return { ok: true, reason: "disabled", actions };

  const { data: globalSettings } = await supabaseAdmin
    .from("settings")
    .select("kill_switch, paper_mode")
    .eq("id", true)
    .single();
  if (globalSettings?.kill_switch) return { ok: true, reason: "kill_switch", actions };

  const client = createSharkClient();

  // Historical candles for zone/break detection. Order routing still uses Shark.
  const dataSourceId = (s.data_source ?? "shark") === "yahoo" ? "yahoo" : "shark";
  let klines: Kline[];
  try {
    if (dataSourceId === "yahoo") {
      const source = await getKlineSource("yahoo");
      klines = await source.getKlines(s.symbol, "1h", 96);
    } else {
      klines = await client.getKlines(s.symbol, "1h", 96);
    }
  } catch (e) {
    await log("error", "klines fetch failed", { error: (e as Error).message, source: dataSourceId });
    return { ok: false, reason: "klines_failed", actions };
  }
  if (klines.length === 0) return { ok: false, reason: "no_klines", actions };


  const now = Date.now();
  const todayIst = sessionDate(now, s.session_start_ist);

  // Expire leftover armed setups from previous IST session days. Runs first so
  // stale orders are cancelled the moment the new session date rolls (≈05:30 IST).
  // For live setups with a pending LIMIT on the exchange, cancel it there too.
  const { data: staleSetupsRaw } = await supabaseAdmin
    .from("strategy_setups")
    .select("id, exchange_order_id, symbol")
    .lt("ist_date", todayIst)
    .eq("status", "armed");
  const staleSetups = (staleSetupsRaw ?? []) as Array<{ id: string; exchange_order_id: string | null; symbol: string }>;
  if (staleSetups.length > 0) {
    if (!globalSettings?.paper_mode) {
      for (const st of staleSetups) {
        if (!st.exchange_order_id) continue;
        try {
          await client.cancelOrder(st.exchange_order_id, st.symbol);
        } catch (e) {
          await log("warn", "cancel prior-day pending failed", {
            setup_id: st.id,
            exchange_order_id: st.exchange_order_id,
            error: (e as Error).message,
          });
        }
      }
    }
    await supabaseAdmin
      .from("strategy_setups")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .in("id", staleSetups.map((s) => s.id));
    actions.push(`expired_prev_day=${staleSetups.length}`);
  }

  // Per-weekday skip list (0=Sun..6=Sat). Falls back to legacy skip_weekends
  // (Sunday only) when the array is empty and the legacy flag is on.
  const skipWeekdays = Array.isArray(s.skip_weekdays) ? s.skip_weekdays.map((n) => Number(n)) : [];
  const wdToday = istWeekday(todayIst);
  if (skipWeekdays.includes(wdToday)) {
    return { ok: true, reason: `weekday_skip_${wdToday}`, ist_date: todayIst, actions };
  }
  if (skipWeekdays.length === 0 && s.skip_weekends && wdToday === 0) {
    return { ok: true, reason: "sunday_skip", ist_date: todayIst, actions };
  }


  const sessionOpen = sessionOpenUtcMs(todayIst, s.session_start_ist);
  const sessionCandle = klines.find((k) => k.openTime === sessionOpen);
  if (!sessionCandle) {
    return { ok: true, reason: "session_candle_not_yet_available", ist_date: todayIst, actions };
  }
  // Need it to be closed
  if (sessionCandle.closeTime > now) {
    return { ok: true, reason: "session_candle_forming", ist_date: todayIst, actions };
  }

  // Upsert session zone
  const zone_high = sessionCandle.high;
  const zone_low = sessionCandle.low;
  const range = zone_high - zone_low;
  const fib_25 = zone_high - range * 0.25;
  const fib_75 = zone_high - range * 0.75;

  const { data: existingSessionRaw } = await supabaseAdmin
    .from("strategy_sessions")
    .select("*")
    .eq("ist_date", todayIst)
    .maybeSingle();
  let session = existingSessionRaw as SessionRow | null;

  if (!session) {
    const { data: inserted } = await supabaseAdmin
      .from("strategy_sessions")
      .insert({
        ist_date: todayIst,
        symbol: s.symbol,
        zone_high,
        zone_low,
        fib_25,
        fib_75,
      })
      .select()
      .single();
    session = inserted as SessionRow;
    actions.push(`session_created zone=${zone_low}-${zone_high}`);
  }

  // Detect break: scan 1h closed candles AFTER session candle
  if (!session.break_side) {
    const later = klines.filter(
      (k) => k.openTime > sessionCandle.openTime && k.closeTime <= now,
    );
    for (const k of later) {
      if (k.close > zone_high) {
        session.break_side = "long";
        session.break_close_price = k.close;
        session.break_detected_at = new Date(k.closeTime).toISOString();
        break;
      }
      if (k.close < zone_low) {
        session.break_side = "short";
        session.break_close_price = k.close;
        session.break_detected_at = new Date(k.closeTime).toISOString();
        break;
      }
    }
    if (session.break_side) {
      await supabaseAdmin
        .from("strategy_sessions")
        .update({
          break_side: session.break_side,
          break_close_price: session.break_close_price,
          break_detected_at: session.break_detected_at,
          updated_at: new Date().toISOString(),
        })
        .eq("ist_date", todayIst);
      actions.push(`break=${session.break_side} @${session.break_close_price}`);
    }
  }

  // Arm setup if break happened and no ACTIVE setup exists for that side today.
  // Only an explicit "rearm_with_ai" cancellation is eligible for immediate
  // reuse. Capacity/margin failures and manual cancels must not re-arm on every
  // tick, otherwise the bot can keep churning exchange orders.
  if (session.break_side) {
    const { data: existingSetupRows } = await supabaseAdmin
      .from("strategy_setups")
      .select("*")
      .eq("ist_date", todayIst)
      .eq("side", session.break_side)
      .in("status", ["armed", "triggered", "cancelled"])
      .order("updated_at", { ascending: false })
      .limit(20);

    const existingSetups = (existingSetupRows ?? []) as SetupRow[];
    const activeSetup = existingSetups.find((row) => row.status === "armed" || row.status === "triggered") ?? null;
    const rearmSetup = existingSetups.find((row) => row.status === "cancelled" && row.close_reason === "rearm_with_ai") ?? null;
    const blockingCancelledSetup = existingSetups.find((row) => row.status === "cancelled" && row.close_reason !== "rearm_with_ai") ?? null;
    const existingSetup = activeSetup ?? rearmSetup ?? blockingCancelledSetup;

    const eligibleForArm = !existingSetup || existingSetup.status === "cancelled" && existingSetup.close_reason === "rearm_with_ai";

    if (eligibleForArm) {
      const side = session.break_side;
      const cfg = entryConfigFromSettings(s as unknown as Record<string, unknown>);
      const breakClose = Number(session.break_close_price ?? (side === "long" ? zone_high : zone_low));
      // Fib zone source: "breakout" swaps the OR high/low for the breakout candle's high/low.
      let entryZoneHigh = zone_high;
      let entryZoneLow = zone_low;
      if ((s.zone_source ?? "range") === "breakout" && session.break_detected_at) {
        const breakCloseMs = new Date(session.break_detected_at).getTime();
        const breakBar = klines.find((k) => k.closeTime === breakCloseMs) ?? klines.find((k) => k.openTime === breakCloseMs - 3_600_000);
        if (breakBar) {
          entryZoneHigh = breakBar.high;
          entryZoneLow = breakBar.low;
        }
      }
      const { entry, sl, market } = computeEntry(side, entryZoneHigh, entryZoneLow, breakClose, cfg);
      const risk = Math.abs(entry - sl);
      const tp = side === "long" ? entry + risk * s.rr : entry - risk * s.rr;


      // ---- AI Grading gate + risk scaling (post-hoc model) ----
      const aiDecision = await scoreLiveAiSetup({
        settings: s,
        session,
        klines,
        todayIst,
        side,
        zoneHigh: zone_high,
        zoneLow: zone_low,
        breakClose,
      });
      if (aiDecision.skipped) {
        await log("info", "ai_grade skip", {
          side,
          grade: aiDecision.grade,
          score: aiDecision.score,
          minGrade: aiDecision.minGrade,
          mult: aiDecision.riskMult,
        });
        actions.push(`ai_skip ${side} grade=${aiDecision.grade} score=${aiDecision.score} < min=${aiDecision.minGrade}`);
        return { ok: true, ist_date: todayIst, actions, session };
      }
      if (aiDecision.grade) {
        actions.push(`ai_grade ${side} grade=${aiDecision.grade} score=${aiDecision.score} mult=${aiDecision.riskMult}x risk=$${aiDecision.effectiveSlRiskUsd.toFixed(2)}`);
      }


      const requestedQty = risk > 0 ? aiDecision.effectiveSlRiskUsd / risk : 0;
      if (requestedQty > 0) {

        // Place a pending LIMIT (or MARKET when entry_mode='market') on the exchange.
        let exchangeOrderId: string | null = null;
        let placeError: string | null = null;
        let finalQty = requestedQty;
        let liveAttempt: MarginRetryResult | null = null;
        if (!globalSettings?.paper_mode) {
          const attempt = await placeOrderWithMarginRetry(client, {
            symbol: s.symbol,
            side: side === "long" ? "buy" : "sell",
            qty: requestedQty,
            type: market ? "market" : "limit",
            price: entry,
            stopLossPrice: sl,
            takeProfitPrice: tp,
          });
          liveAttempt = attempt;
          if (attempt.res) {
            exchangeOrderId = attempt.res.exchangeOrderId || null;
            finalQty = attempt.finalQty;
            await log("info", "arm: shark placeOrder response", {
              side, entry, qty: finalQty, requestedQty, capped: attempt.capped,
              attempts: attempt.attempts, mode: cfg.mode, market,
              parsed: { exchangeOrderId: attempt.res.exchangeOrderId, status: attempt.res.status, filledPrice: attempt.res.filledPrice },
              raw: attempt.res.raw,
            });
          } else {
            placeError = attempt.error;
          }
        }
        const setupPayload = {
          ist_date: todayIst,
          symbol: s.symbol,
          side,
          entry_price: entry,
          sl_price: sl,
          initial_sl_price: sl,
          tp_price: tp,
          qty: finalQty,
          status: placeError ? ("cancelled" as const) : ("armed" as const),
          close_reason: placeError ? (isRecoverableCapacityError(placeError) ? "rearm_with_ai" : "manual") : null,
          closed_at: placeError ? new Date().toISOString() : null,
          exchange_order_id: placeError ? null : exchangeOrderId,
          ai_grade: aiDecision.grade,
          ai_score: aiDecision.score,
          ai_risk_mult: aiDecision.riskMult,
          updated_at: new Date().toISOString(),
          ...(liveAttempt ? placementFields(liveAttempt, requestedQty) : {}),
        };
        let armedSetupId: string | null = existingSetup?.id ?? null;
        if (existingSetup) {
          await supabaseAdmin
            .from("strategy_setups")
            .update(setupPayload)
            .eq("id", existingSetup.id);
        } else {
          const { data: inserted } = await supabaseAdmin
            .from("strategy_setups")
            .insert(setupPayload)
            .select("id")
            .single();
          armedSetupId = (inserted?.id as string | undefined) ?? null;
        }

        if (liveAttempt) {
          await emitPlacementOutcome(armedSetupId, liveAttempt, requestedQty, entry);
        }

        if (placeError) {
          await log(isRecoverableCapacityError(placeError) ? "warn" : "error", "arm: full AI-sized exchange order failed; no smaller wrong-risk order placed", { side, entry, sl, tp, qty: finalQty, requestedQty, mode: cfg.mode, error: placeError });
          actions.push(`arm_blocked ${side} full_qty=${finalQty.toFixed(4)} err=${placeError}`);
        } else {
          actions.push(
            `${existingSetup ? "re-armed" : "armed"} ${side} mode=${cfg.mode} entry=${entry.toFixed(2)} sl=${sl.toFixed(2)} tp=${tp.toFixed(2)} qty=${finalQty.toFixed(4)}` +
              (exchangeOrderId ? ` pending=${exchangeOrderId}` : " (paper/no-id)"),
          );
        }
      }
    } else if (
      existingSetup.status === "armed" &&
      !existingSetup.exchange_order_id &&
      !globalSettings?.paper_mode
    ) {
      await log("warn", "watchdog: armed setup missing exchange order id; auto-replacing", {
        setup_id: existingSetup.id,
        side: existingSetup.side,
        qty: existingSetup.qty,
      });
      const wdSide: "buy" | "sell" = existingSetup.side === "long" ? "buy" : "sell";
      await logSetupEvent(existingSetup.id, "watchdog_rearm", {
        qty: existingSetup.qty,
        price: existingSetup.entry_price,
        reason: "armed_setup_missing_exchange_order_id",
      });
      const wdAttempt = await placeOrderWithMarginRetry(client, {
        symbol: existingSetup.symbol,
        side: wdSide,
        qty: existingSetup.qty,
        type: "limit",
        price: existingSetup.entry_price,
        stopLossPrice: existingSetup.sl_price,
        takeProfitPrice: existingSetup.tp_price,
      });
      await emitPlacementOutcome(existingSetup.id, wdAttempt, existingSetup.qty, existingSetup.entry_price);
      if (wdAttempt.res) {
        await supabaseAdmin
          .from("strategy_setups")
          .update({
            exchange_order_id: wdAttempt.res.exchangeOrderId || null,
            qty: wdAttempt.finalQty,
            updated_at: new Date().toISOString(),
            ...placementFields(wdAttempt, existingSetup.qty),
          })
          .eq("id", existingSetup.id);
        actions.push(`watchdog_replaced ${existingSetup.side} qty=${wdAttempt.finalQty.toFixed(4)} pending=${wdAttempt.res.exchangeOrderId ?? "?"}`);
      } else {
        await supabaseAdmin
          .from("strategy_setups")
          .update({
            status: "cancelled",
            close_reason: isRecoverableCapacityError(wdAttempt.error) ? "rearm_with_ai" : "manual",
            closed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...placementFields(wdAttempt, existingSetup.qty),
          })
          .eq("id", existingSetup.id);
        actions.push(`watchdog_replace_failed ${existingSetup.side} err=${wdAttempt.error ?? "unknown"}`);
      }


    } else if (

      existingSetup.status === "armed" &&
      existingSetup.exchange_order_id &&
      !globalSettings?.paper_mode
    ) {
      // Re-price a still-pending order when strategy settings changed (e.g.
      // entry_depth_pct / sl_depth_pct / rr / sl_risk_usd). Shark has no
      // amend endpoint, so cancel + place a new order.
      const side = existingSetup.side as "long" | "short";
      const cfg = entryConfigFromSettings(s as unknown as Record<string, unknown>);
      const breakClose = Number(session.break_close_price ?? (side === "long" ? zone_high : zone_low));
      let zh = zone_high;
      let zl = zone_low;
      if ((s.zone_source ?? "range") === "breakout" && session.break_detected_at) {
        const bt = new Date(session.break_detected_at).getTime();
        const bb = klines.find((k) => k.closeTime === bt) ?? klines.find((k) => k.openTime === bt - 3_600_000);
        if (bb) { zh = bb.high; zl = bb.low; }
      }
      const { entry, sl, market } = computeEntry(side, zh, zl, breakClose, cfg);
      const risk = Math.abs(entry - sl);
      const tp = side === "long" ? entry + risk * s.rr : entry - risk * s.rr;

      const aiDecision = await scoreLiveAiSetup({
        settings: s,
        session,
        klines,
        todayIst,
        side,
        zoneHigh: zone_high,
        zoneLow: zone_low,
        breakClose,
      });
      if (aiDecision.skipped) {
        await log("warn", "reprice: current AI grade is below minimum; live order kept for manual action", {
          setup_id: existingSetup.id,
          exchange_order_id: existingSetup.exchange_order_id,
          grade: aiDecision.grade,
          score: aiDecision.score,
          minGrade: aiDecision.minGrade,
          mult: aiDecision.riskMult,
        });
        actions.push(`reprice_ai_skip ${side} grade=${aiDecision.grade}; manual cancel required`);
      } else {
        const qty = risk > 0 ? aiDecision.effectiveSlRiskUsd / risk : 0;
        const exchangeEntry = roundExchangePrice(entry);
        const exchangeSl = roundExchangePrice(sl);
        const exchangeTp = roundExchangePrice(tp);
        const exchangeQty = roundExchangeQty(qty);

        const tol = 1e-6;
        // Compare planned qty against the previously-REQUESTED qty (not the
        // filled qty). When placement got capped by leverage/margin the stored
        // qty is smaller than the plan; using it here caused an infinite
        // cancel+replace loop every tick because "changed" always fired.
        const prevRequestedQty = Number(
          (existingSetup as unknown as { requested_qty?: number | null }).requested_qty ??
            existingSetup.qty,
        );
        const changed =
          qty > 0 &&
          (Math.abs(exchangeEntry - roundExchangePrice(Number(existingSetup.entry_price))) > tol ||
            Math.abs(exchangeSl - roundExchangePrice(Number(existingSetup.sl_price))) > tol ||
            Math.abs(exchangeTp - roundExchangePrice(Number(existingSetup.tp_price))) > tol ||
            Math.abs(exchangeQty - roundExchangeQty(prevRequestedQty)) > tol ||
            (s.ai_grading_enabled && (
              existingSetup.ai_grade !== aiDecision.grade ||
              !sameNullableNumber(existingSetup.ai_score, aiDecision.score, 0) ||
              !sameNullableNumber(existingSetup.ai_risk_mult, aiDecision.riskMult, 4)
            )));

        // Hard cap on cancel+replace cycles per setup — belt-and-suspenders
        // in case a future "changed" condition regresses into a loop.
        const maxRepriceAttempts = Number(
          (s as unknown as { max_reprice_attempts?: number }).max_reprice_attempts ?? 5,
        );
        const priorReprices = Number(
          (existingSetup as unknown as { reprice_count?: number | null }).reprice_count ?? 0,
        );
        const overLimit = changed && priorReprices >= maxRepriceAttempts;
        if (overLimit) {
          await log("warn", "auto-reprice: attempt limit reached — leaving live order in place", {
            setup_id: existingSetup.id,
            exchange_order_id: existingSetup.exchange_order_id,
            reprice_count: priorReprices,
            max_reprice_attempts: maxRepriceAttempts,
          });
          actions.push(`auto_reprice_limit_reached ${side} count=${priorReprices}/${maxRepriceAttempts}`);
        }

        if (changed && !overLimit) {
          // Auto cancel + replace so the live order always reflects the
          // current AI grade / multiplier / risk-based qty. Previously we
          // logged "manual reprice required" which left stale qty on the
          // exchange (e.g. base-risk qty after AI upgraded the grade to A++).
          const oldOid = existingSetup.exchange_order_id;
          try {
            const cancel = await client.cancelOrder(oldOid, s.symbol);
            if (!cancel.ok) {
              await log("warn", "auto-reprice: cancel rejected, keeping live order", {
                setup_id: existingSetup.id,
                exchange_order_id: oldOid,
                status: cancel.status,
                body: cancel.body.slice(0, 300),
              });
              actions.push(`auto_reprice_cancel_failed ${side} [${cancel.status}]`);
            } else {
              await logSetupEvent(existingSetup.id, "reprice_cancel", {
                exchange_order_id: oldOid,
                reason: "auto_reprice_settings_changed",
              });
              await supabaseAdmin
                .from("strategy_setups")
                .update({ exchange_order_id: null, updated_at: new Date().toISOString() })
                .eq("id", existingSetup.id);


              const attempt = await placeOrderWithMarginRetry(client, {
                symbol: s.symbol,
                side: side === "long" ? "buy" : "sell",
                qty,
                type: market ? "market" : "limit",
                price: entry,
                stopLossPrice: sl,
                takeProfitPrice: tp,
              });
              await emitPlacementOutcome(existingSetup.id, attempt, qty, entry);


              if (!attempt.res) {
                await supabaseAdmin
                  .from("strategy_setups")
                  .update({
                    status: "cancelled",
                    close_reason: isRecoverableCapacityError(attempt.error) ? "rearm_with_ai" : "manual",
                    closed_at: new Date().toISOString(),
                    exchange_order_id: null,
                    entry_price: entry,
                    sl_price: sl,
                    initial_sl_price: sl,
                    tp_price: tp,
                    qty: exchangeQty,
                    reprice_count: priorReprices + 1,
                    ai_grade: aiDecision.grade,
                    ai_score: aiDecision.score,
                    ai_risk_mult: aiDecision.riskMult,
                    updated_at: new Date().toISOString(),
                    ...placementFields(attempt, qty),
                  })
                  .eq("id", existingSetup.id);
                await log("error", "auto-reprice: full AI-sized replace failed; old order cancelled and no smaller wrong-risk order placed", {
                  setup_id: existingSetup.id,
                  error: attempt.error,
                  planned_qty: exchangeQty,
                  planned_risk_usd: risk * exchangeQty,
                });
                actions.push(`auto_reprice_replace_failed ${side}`);
              } else {
                await supabaseAdmin
                  .from("strategy_setups")
                  .update({
                    entry_price: entry,
                    sl_price: sl,
                    initial_sl_price: sl,
                    tp_price: tp,
                    qty: attempt.finalQty,
                    reprice_count: priorReprices + 1,
                    status: "armed",
                    exchange_order_id: attempt.res.exchangeOrderId || null,
                    close_reason: null,
                    closed_at: null,
                    ai_grade: aiDecision.grade,
                    ai_score: aiDecision.score,
                    ai_risk_mult: aiDecision.riskMult,
                    updated_at: new Date().toISOString(),
                    ...placementFields(attempt, qty),
                  })
                  .eq("id", existingSetup.id);

                await log("info", "auto-reprice: replaced live order", {
                  setup_id: existingSetup.id,
                  old_exchange_order_id: oldOid,
                  new_exchange_order_id: attempt.res.exchangeOrderId,
                  entry, sl, tp, qty: attempt.finalQty,
                  ai_grade: aiDecision.grade,
                  ai_score: aiDecision.score,
                  ai_risk_mult: aiDecision.riskMult,
                });
                actions.push(
                  `auto_reprice ${side} grade=${aiDecision.grade ?? "AI_OFF"} entry=${entry.toFixed(2)} sl=${sl.toFixed(2)} tp=${tp.toFixed(2)} qty=${attempt.finalQty}`,
                );
              }
            }
          } catch (e) {
            await log("warn", "auto-reprice: cancel failed", {
              setup_id: existingSetup.id,
              exchange_order_id: oldOid,
              error: (e as Error).message,
            });
            actions.push(`auto_reprice_cancel_failed ${side}`);
          }
        }
      }
    }
  }


  // Current price for triggers / TP-SL monitoring
  let lastPrice: number | null = null;
  try {
    lastPrice = await client.getLastPrice(s.symbol);
  } catch {
    lastPrice = klines[klines.length - 1]?.close ?? null;
  }
  const currentBar = klines[klines.length - 1];

  // Detect fills on armed setups.
  //  - Live (has exchange_order_id): poll Shark open-orders once; if the id is no
  //    longer open, look up its trade in trade-history and mark the setup triggered.
  //  - Paper (no exchange_order_id): keep local barLow/barHigh trigger detection.
  const { data: armedRows } = await supabaseAdmin
    .from("strategy_setups")
    .select("*")
    .eq("ist_date", todayIst)
    .eq("status", "armed");
  const armed = (armedRows ?? []) as SetupRow[];
  const liveArmed = armed.filter((a) => a.exchange_order_id);
  const paperArmed = globalSettings?.paper_mode ? armed.filter((a) => !a.exchange_order_id) : [];

  if (liveArmed.length > 0 && !globalSettings?.paper_mode) {
    let openOrders: Awaited<ReturnType<typeof client.getOpenOrders>> | null = null;
    let openIds: Set<string> | null = null;
    try {
      openOrders = await client.getOpenOrders(s.symbol);
      openIds = new Set(openOrders.map((o) => o.clientOrderId).filter((id) => id.length > 0));
    } catch (e) {
      await log("warn", "open-orders fetch failed", { error: (e as Error).message });
    }
    if (openIds) {
      for (const setup of liveArmed) {
        const oid = setup.exchange_order_id!;
        if (openIds.has(oid)) continue; // still pending on exchange

        const matchingOpen = openOrders?.find((order) => samePendingSetupOrder(order, setup));
        if (matchingOpen?.clientOrderId) {
          await supabaseAdmin
            .from("strategy_setups")
            .update({ exchange_order_id: matchingOpen.clientOrderId, updated_at: new Date().toISOString() })
            .eq("id", setup.id);
          await log("warn", "armed order id changed on exchange; relinked pending order", {
            setup_id: setup.id,
            old_exchange_order_id: oid,
            new_exchange_order_id: matchingOpen.clientOrderId,
          });
          actions.push(`relinked_pending ${setup.side} pending=${matchingOpen.clientOrderId}`);
          continue;
        }

        // No longer open → look up fill
        let fill: { price: number; qty: number } | null = null;
        try {
          fill = await client.getFillForClientOrderId(oid);
        } catch (e) {
          await log("warn", "trade-history lookup failed", { setup_id: setup.id, error: (e as Error).message });
        }
        if (!fill?.price) {
          // Watchdog auto-replace: an armed setup has no live pending order and
          // no fill on record. Re-place the same setup at its stored entry/SL/TP
          // and qty so the book always has a working order for the active plan.
          await log("warn", "watchdog: armed order missing on exchange without fill; auto-replacing", {
            setup_id: setup.id,
            missing_exchange_order_id: oid,
            qty: setup.qty,
            entry: setup.entry_price,
          });
          const wdSide: "buy" | "sell" = setup.side === "long" ? "buy" : "sell";
          await logSetupEvent(setup.id, "watchdog_rearm", {
            exchange_order_id: oid,
            qty: setup.qty,
            price: setup.entry_price,
            reason: "pending_order_missing_on_exchange",
          });
          const wdAttempt = await placeOrderWithMarginRetry(client, {
            symbol: setup.symbol,
            side: wdSide,
            qty: setup.qty,
            type: "limit",
            price: setup.entry_price,
            stopLossPrice: setup.sl_price,
            takeProfitPrice: setup.tp_price,
          });
          await emitPlacementOutcome(setup.id, wdAttempt, setup.qty, setup.entry_price);

          if (wdAttempt.res) {
            await supabaseAdmin
              .from("strategy_setups")
              .update({
                exchange_order_id: wdAttempt.res.exchangeOrderId || null,
                qty: wdAttempt.finalQty,
                updated_at: new Date().toISOString(),
                ...placementFields(wdAttempt, setup.qty),
              })
              .eq("id", setup.id);
            await log("info", "watchdog: re-placed missing pending order", {
              setup_id: setup.id,
              new_exchange_order_id: wdAttempt.res.exchangeOrderId,
              qty: wdAttempt.finalQty,
              capped: wdAttempt.capped,
              attempts: wdAttempt.attempts,
            });
            actions.push(`watchdog_replaced ${setup.side} qty=${wdAttempt.finalQty.toFixed(4)} pending=${wdAttempt.res.exchangeOrderId ?? "?"}`);
          } else {
            // Placement genuinely failed (even after leverage + capped fallback).
            // Mark as cancelled + rearm-eligible so the next tick tries again.
            await supabaseAdmin
              .from("strategy_setups")
              .update({
                status: "cancelled",
                close_reason: isRecoverableCapacityError(wdAttempt.error) ? "rearm_with_ai" : "manual",
                closed_at: new Date().toISOString(),
                exchange_order_id: null,
                updated_at: new Date().toISOString(),
                ...placementFields(wdAttempt, setup.qty),
              })
              .eq("id", setup.id);

            await log("error", "watchdog: re-place failed; setup marked for rearm on next tick", {
              setup_id: setup.id,
              error: wdAttempt.error,
            });
            actions.push(`watchdog_replace_failed ${setup.side} err=${wdAttempt.error ?? "unknown"}`);
          }
          continue;
        }

        const fillPrice = fill.price;
        // Record an orders row for accounting + update position
        const webhookEventId = await ensureStrategyEvent(setup, "entry");
        const { data: orderRow } = await supabaseAdmin
          .from("orders")
          .insert({
            webhook_event_id: webhookEventId,
            symbol: setup.symbol,
            side: setup.side === "long" ? "buy" : "sell",
            order_type: "limit",
            qty: setup.qty,
            price: setup.entry_price,
            filled_price: fillPrice,
            exchange_order_id: oid,
            paper: false,
            status: "filled",
            filled_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        await supabaseAdmin
          .from("strategy_setups")
          .update({
            status: "triggered",
            order_id: orderRow?.id ?? null,
            filled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", setup.id);
        await logSetupEvent(setup.id, "filled", {
          exchange_order_id: oid,
          qty: setup.qty,
          price: fillPrice,
        });
        actions.push(`fill ${setup.side} @${fillPrice.toFixed(2)}`);
      }
    }
  }


  for (const setup of paperArmed) {
    const barLow = currentBar?.low ?? lastPrice ?? setup.entry_price;
    const barHigh = currentBar?.high ?? lastPrice ?? setup.entry_price;
    const trigger =
      setup.side === "long"
        ? barLow <= setup.entry_price
        : barHigh >= setup.entry_price;
    if (!trigger) continue;
    const result = await processSignal(
      {
        symbol: setup.symbol,
        action: setup.side === "long" ? "buy" : "sell",
        price: setup.entry_price,
        size_usd: setup.qty * setup.entry_price,
        alert_id: `strategy-${setup.id}-entry`,
      },
      await ensureStrategyEvent(setup, "entry"),
    );
    await supabaseAdmin
      .from("strategy_setups")
      .update({
        status: result.status === "executed" ? "triggered" : "cancelled",
        order_id: result.order_id ?? null,
        filled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", setup.id);
    actions.push(`trigger ${setup.side} → ${result.status}`);
  }

  // Monitor triggered setups for TP / SL
  const { data: triggered } = await supabaseAdmin
    .from("strategy_setups")
    .select("*")
    .eq("status", "triggered");
  const trailEnabled = !!s.trail_enabled;
  const trailActivateR = Math.max(0.1, Number(s.trail_activate_r ?? 2));
  const trailStepR = Math.max(0.1, Number(s.trail_step_r ?? 1));
  for (const setup of (triggered ?? []) as SetupRow[]) {
    if (lastPrice == null) break;
    const initialSl = Number(setup.initial_sl_price ?? setup.sl_price);
    const risk = Math.abs(setup.entry_price - initialSl);
    const isLive = !!setup.exchange_order_id && !globalSettings?.paper_mode;

    // Update peak-R using both the current bar's favorable extreme AND lastPrice.
    const favBar =
      setup.side === "long"
        ? Math.max(currentBar?.high ?? lastPrice, lastPrice)
        : Math.min(currentBar?.low ?? lastPrice, lastPrice);
    const curR = risk > 0 ? ((favBar - setup.entry_price) * (setup.side === "long" ? 1 : -1)) / risk : 0;
    const peakR = Math.max(Number(setup.peak_r ?? 0), curR);

    // Compute the trailed SL, if trailing is armed.
    let dynSl = Number(setup.sl_price);
    if (trailEnabled && peakR >= trailActivateR && risk > 0) {
      const steps = Math.floor((peakR - trailActivateR) / trailStepR);
      const slR = steps * trailStepR;
      const newSl =
        setup.side === "long" ? setup.entry_price + slR * risk : setup.entry_price - slR * risk;
      if (setup.side === "long" ? newSl > dynSl : newSl < dynSl) dynSl = newSl;
    }

    // Discover the exchange-side child SL order id if we don't have it yet (live only).
    // Once known, trailing can PATCH stopPrice so the exchange enforces the new SL even
    // if our tick loop stops running.
    let slChildId = setup.sl_child_order_id ?? null;
    if (isLive && !slChildId) {
      try {
        const openRows = await client.getOpenOrders(setup.symbol);
        const exitSide = setup.side === "long" ? "SELL" : "BUY";
        const candidates = openRows.filter((o) => {
          const type = (o.type || "").toUpperCase();
          const side = (o.side || "").toUpperCase();
          const sub = (o.subType || "").toUpperCase();
          const link = (o.linkType || "").toUpperCase();
          const looksStop = type.startsWith("STOP") || sub.includes("STOP_LOSS") || link.includes("SL");
          const looksTp = sub.includes("TAKE_PROFIT") || link.includes("TP");
          return looksStop && !looksTp && side === exitSide;
        });
        // Prefer the one whose stopPrice/price is closest to our current sl_price.
        const target = Number(setup.sl_price);
        candidates.sort((a, b) => {
          const ap = Math.abs((a.stopPrice ?? a.price ?? 0) - target);
          const bp = Math.abs((b.stopPrice ?? b.price ?? 0) - target);
          return ap - bp;
        });
        const match = candidates[0];
        if (match) {
          slChildId = match.clientOrderId;
          await supabaseAdmin
            .from("strategy_setups")
            .update({ sl_child_order_id: slChildId, updated_at: new Date().toISOString() })
            .eq("id", setup.id);
          await log("info", "trail: discovered exchange SL child order", {
            setup_id: setup.id, sl_child_order_id: slChildId, sl_price: setup.sl_price,
          });
        }
      } catch (e) {
        await log("warn", "trail: sl child discovery failed", {
          setup_id: setup.id, error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Discover the exchange-side child TP order id (live only) so the UI can edit TP via API.
    let tpChildId = setup.tp_child_order_id ?? null;
    if (isLive && !tpChildId) {
      try {
        const openRows = await client.getOpenOrders(setup.symbol);
        const exitSide = setup.side === "long" ? "SELL" : "BUY";
        const candidates = openRows.filter((o) => {
          const type = (o.type || "").toUpperCase();
          const side = (o.side || "").toUpperCase();
          const sub = (o.subType || "").toUpperCase();
          const link = (o.linkType || "").toUpperCase();
          const looksTp = sub.includes("TAKE_PROFIT") || link.includes("TP") || type.includes("TAKE_PROFIT");
          const looksSl = sub.includes("STOP_LOSS") || link.includes("SL");
          return looksTp && !looksSl && side === exitSide;
        });
        const target = Number(setup.tp_price);
        candidates.sort((a, b) => {
          const ap = Math.abs((a.price ?? a.stopPrice ?? 0) - target);
          const bp = Math.abs((b.price ?? b.stopPrice ?? 0) - target);
          return ap - bp;
        });
        const match = candidates[0];
        if (match) {
          tpChildId = match.clientOrderId;
          await supabaseAdmin
            .from("strategy_setups")
            .update({ tp_child_order_id: tpChildId, updated_at: new Date().toISOString() })
            .eq("id", setup.id);
          await log("info", "trail: discovered exchange TP child order", {
            setup_id: setup.id, tp_child_order_id: tpChildId, tp_price: setup.tp_price,
          });
        }
      } catch (e) {
        await log("warn", "trail: tp child discovery failed", {
          setup_id: setup.id, error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Persist trailing progress if it advanced or peak changed.
    const slChanged = dynSl !== Number(setup.sl_price);
    if (peakR > Number(setup.peak_r ?? 0) || slChanged) {
      await supabaseAdmin
        .from("strategy_setups")
        .update({
          peak_r: peakR,
          sl_price: dynSl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", setup.id);
      if (slChanged) {
        actions.push(`trail ${setup.side} peak=${peakR.toFixed(2)}R sl→${dynSl.toFixed(2)}`);

        // Push the trailed SL to the exchange so it is enforced there.
        if (isLive && slChildId) {
          try {
            const editRes = await client.editOrder({ clientOrderId: slChildId, stopPrice: dynSl });
            if (editRes.ok) {
              await log("info", "trail: exchange SL updated", {
                setup_id: setup.id, sl_child_order_id: slChildId, new_stop: dynSl,
              });
              actions.push(`trail_exchange_sl ok ${slChildId}→${dynSl.toFixed(2)}`);
            } else {
              await log("warn", "trail: exchange SL edit rejected", {
                setup_id: setup.id, sl_child_order_id: slChildId, new_stop: dynSl,
                status: editRes.status, body: editRes.body.slice(0, 300),
              });
              actions.push(`trail_exchange_sl fail [${editRes.status}]`);
              // If the exchange says the order is gone (e.g. cancelled/replaced), clear id so we re-discover next tick.
              if (editRes.status === 404 || /not.?found|does not exist/i.test(editRes.body)) {
                await supabaseAdmin
                  .from("strategy_setups")
                  .update({ sl_child_order_id: null, updated_at: new Date().toISOString() })
                  .eq("id", setup.id);
              }
            }
          } catch (e) {
            await log("warn", "trail: exchange SL edit threw", {
              setup_id: setup.id, sl_child_order_id: slChildId, new_stop: dynSl,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }
    }


    const hitTp =
      setup.side === "long" ? lastPrice >= setup.tp_price : lastPrice <= setup.tp_price;
    const hitSl =
      setup.side === "long" ? lastPrice <= dynSl : lastPrice >= dynSl;
    if (!hitTp && !hitSl) continue;
    const reason: "tp" | "sl" = hitTp ? "tp" : "sl";
    const result = await processSignal(
      {
        symbol: setup.symbol,
        action: "close",
        price: lastPrice,
        alert_id: `strategy-${setup.id}-close-${reason}`,
      },
      await ensureStrategyEvent(setup, `close_${reason}`),
    );
    const grossPnl =
      setup.side === "long"
        ? (lastPrice - setup.entry_price) * setup.qty
        : (setup.entry_price - lastPrice) * setup.qty;
    const feePerOrder = Math.max(0, Number(s.fee_usd_per_order ?? 0));
    const pnl = grossPnl - 2 * feePerOrder;
    await supabaseAdmin
      .from("strategy_setups")
      .update({
        status: "closed",
        close_reason: reason,
        close_order_id: result.order_id ?? null,
        pnl_usd: pnl,
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", setup.id);
    await logSetupEvent(setup.id, reason === "tp" ? "tp_hit" : "sl_hit", {
      qty: setup.qty,
      price: lastPrice,
      reason: `pnl=${pnl.toFixed(2)}`,
      payload: { gross_pnl: grossPnl, fee: 2 * feePerOrder },
    });
    await logSetupEvent(setup.id, "closed", { price: lastPrice, reason });
    actions.push(`close ${setup.side} @${lastPrice} reason=${reason} pnl=${pnl.toFixed(2)} (fee=$${(2 * feePerOrder).toFixed(2)})`);

    // Auto-retrain the AI grading model so this new trade is folded into the
    // learned expectancy on the next armed setup. Debounced: skip if we
    // retrained within the last 5 minutes. Fire-and-forget (never blocks the
    // tick or fails the close).
    const sx = s as unknown as { ai_auto_retrain?: boolean; ai_last_retrain_at?: string | null };
    if (sx.ai_auto_retrain !== false) {
      const lastMs = sx.ai_last_retrain_at ? new Date(sx.ai_last_retrain_at).getTime() : 0;
      if (Date.now() - lastMs > 5 * 60_000) {
        // mark first so concurrent ticks don't stampede
        await supabaseAdmin
          .from("strategy_settings")
          .update({ ai_last_retrain_at: new Date().toISOString() } as never)
          .eq("id", true);
        void (async () => {
          try {
            const { retrainGradingCore } = await import("@/lib/strategy.functions");
            const r = await retrainGradingCore({});
            await log("info", "AI grading model retrained", { sample_size: r.sample_size, days: r.days });
          } catch (e) {
            await log("warn", "AI grading auto-retrain failed", { error: (e as Error).message });
          }
        })();
      }
    }
  }


  // (Prior-day armed setups are expired at the top of the tick.)



  return { ok: true, ist_date: todayIst, session, actions };
}

async function ensureStrategyEvent(
  setup: SetupRow,
  kind: string,
): Promise<string> {
  const alertId = `strategy-${setup.id}-${kind}-${Date.now()}`;
  const { data } = await supabaseAdmin
    .from("webhook_events")
    .insert({
      alert_id: alertId,
      status: "received",
      raw_payload: { source: "strategy", setup_id: setup.id, kind } as never,
    })
    .select("id")
    .single();
  return (data?.id as string) ?? "";
}

/**
 * Force-reprice every armed setup for today that still has a pending exchange
 * order, using current strategy settings. Bypasses the "changed" tolerance
 * check in the tick — cancels the pending order and places a fresh one with
 * the latest entry/SL/TP/qty. Returns per-setup action strings.
 */
export async function repriceArmedSetupsNow(): Promise<{
  ok: boolean;
  reason?: string;
  actions: string[];
}> {
  const actions: string[] = [];

  const { data: settings } = await supabaseAdmin
    .from("strategy_settings")
    .select("*")
    .eq("id", true)
    .single();
  const s = settings as StrategySettingsRow | null;
  if (!s) return { ok: false, reason: "settings_missing", actions };

  const { data: globalSettings } = await supabaseAdmin
    .from("settings")
    .select("kill_switch, paper_mode")
    .eq("id", true)
    .single();
  if (globalSettings?.paper_mode) return { ok: true, reason: "paper_mode", actions };

  const todayIst = sessionDate(Date.now(), s.session_start_ist);

  const { data: sessionRow } = await supabaseAdmin
    .from("strategy_sessions")
    .select("*")
    .eq("ist_date", todayIst)
    .maybeSingle();
  const session = sessionRow as SessionRow | null;
  if (!session) return { ok: true, reason: "no_session_today", actions };

  const { data: armedRows } = await supabaseAdmin
    .from("strategy_setups")
    .select("*")
    .eq("ist_date", todayIst)
    .eq("status", "armed");
  const armed = ((armedRows ?? []) as SetupRow[]).filter((a) => a.exchange_order_id);
  if (armed.length === 0) return { ok: true, reason: "no_pending_armed", actions };

  const cfg = entryConfigFromSettings(s as unknown as Record<string, unknown>);
  const client = createSharkClient();

  // Preload klines if breakout zone source is on so we can locate the break bar.
  let repriceKlines: Kline[] | null = null;
  if (session.break_detected_at) {
    try {
      const src = (s.data_source ?? "shark") === "yahoo" ? await getKlineSource("yahoo") : null;
      repriceKlines = src ? await src.getKlines(s.symbol, "1h", 96) : await client.getKlines(s.symbol, "1h", 96);
    } catch {
      repriceKlines = null;
    }
  }

  for (const setup of armed) {
    const side = setup.side;
    const oldOid = setup.exchange_order_id!;
    const breakClose = Number(
      session.break_close_price ?? (side === "long" ? session.zone_high : session.zone_low),
    );
    let rzh = session.zone_high;
    let rzl = session.zone_low;
    if (repriceKlines && session.break_detected_at) {
      const bt = new Date(session.break_detected_at).getTime();
      const bb = repriceKlines.find((k) => k.closeTime === bt) ?? repriceKlines.find((k) => k.openTime === bt - 3_600_000);
      if (bb) { rzh = bb.high; rzl = bb.low; }
    }
    const { entry, sl, market } = computeEntry(
      side,
      rzh,
      rzl,
      breakClose,
      cfg,
    );

    const risk = Math.abs(entry - sl);
    const tp = side === "long" ? entry + risk * s.rr : entry - risk * s.rr;
    const todayIst = sessionDate(Date.now(), s.session_start_ist);
    const aiDecision = await scoreLiveAiSetup({
      settings: s,
      session,
      klines: repriceKlines ?? [],
      todayIst,
      side,
      zoneHigh: session.zone_high,
      zoneLow: session.zone_low,
      breakClose,
    });
    if (aiDecision.skipped) {
      try {
        await client.cancelOrder(oldOid, s.symbol);
      } catch (e) {
        await log("warn", "reprice_now: AI skip cancel failed", {
          setup_id: setup.id,
          exchange_order_id: oldOid,
          error: (e as Error).message,
        });
        actions.push(`reprice_now_ai_skip_cancel_failed ${side}`);
        continue;
      }
      await supabaseAdmin
        .from("strategy_setups")
        .update({
          status: "cancelled",
          close_reason: "rearm_with_ai",
          closed_at: new Date().toISOString(),
          exchange_order_id: null,
          ai_grade: aiDecision.grade,
          ai_score: aiDecision.score,
          ai_risk_mult: aiDecision.riskMult,
          updated_at: new Date().toISOString(),
        })
        .eq("id", setup.id);
      actions.push(`reprice_now_ai_skip_cancelled ${side} grade=${aiDecision.grade}`);
      continue;
    }
    const requestedQty = risk > 0 ? aiDecision.effectiveSlRiskUsd / risk : 0;
    if (requestedQty <= 0) {
      actions.push(`reprice_now_skip ${side} qty=0`);
      continue;
    }

    // Skip when nothing meaningful changed (avoids churning the exchange).
    const priceEps = Math.max(0.01, Math.abs(entry) * 0.0001);
    const qtyEps = Math.max(1e-6, requestedQty * 0.001);
    const unchanged =
      Math.abs(Number(setup.entry_price) - entry) < priceEps &&
      Math.abs(Number(setup.sl_price) - sl) < priceEps &&
      Math.abs(Number(setup.tp_price) - tp) < priceEps &&
      Math.abs(Number((setup as unknown as { requested_qty?: number | null }).requested_qty ?? setup.qty) - requestedQty) < qtyEps &&
      (!s.ai_grading_enabled || (
        setup.ai_grade === aiDecision.grade &&
        sameNullableNumber(setup.ai_score, aiDecision.score, 0) &&
        sameNullableNumber(setup.ai_risk_mult, aiDecision.riskMult, 4)
      ));
    if (unchanged) {
      actions.push(`reprice_now_noop ${side}`);
      continue;
    }

    // Hard cap on cancel+replace cycles per setup — prevents infinite
    // reprice loops even if a change condition keeps flipping tick to tick.
    const maxRepriceAttempts = Number(
      (s as unknown as { max_reprice_attempts?: number }).max_reprice_attempts ?? 5,
    );
    const priorReprices = Number(
      (setup as unknown as { reprice_count?: number | null }).reprice_count ?? 0,
    );
    if (priorReprices >= maxRepriceAttempts) {
      await log("warn", "reprice_now: attempt limit reached — leaving live order in place", {
        setup_id: setup.id,
        exchange_order_id: oldOid,
        reprice_count: priorReprices,
        max_reprice_attempts: maxRepriceAttempts,
      });
      actions.push(`reprice_now_limit_reached ${side} count=${priorReprices}/${maxRepriceAttempts}`);
      continue;
    }


    // 1) Cancel the still-pending exchange order.
    try {
      const cancel = await client.cancelOrder(oldOid, s.symbol);
      if (!cancel.ok) {
        await log("warn", "reprice_now: cancel rejected, skipping replace", {
          setup_id: setup.id,
          exchange_order_id: oldOid,
          status: cancel.status,
          body: cancel.body.slice(0, 300),
        });
        actions.push(`reprice_now_cancel_failed ${side} [${cancel.status}]`);
        continue;
      }
    } catch (e) {
      // If cancel fails the order may have already filled — bail on this setup.
      await log("warn", "reprice_now: cancel failed, skipping replace", {
        setup_id: setup.id,
        exchange_order_id: oldOid,
        error: (e as Error).message,
      });
      actions.push(`reprice_now_cancel_failed ${side}`);
      continue;
    }

    // Detach the stale id right away so a concurrent tick doesn't reuse it.
    await logSetupEvent(setup.id, "reprice_cancel", {
      exchange_order_id: oldOid,
      reason: "reprice_now",
    });
    await supabaseAdmin
      .from("strategy_setups")
      .update({ exchange_order_id: null, updated_at: new Date().toISOString() })
      .eq("id", setup.id);

    // 2) Place a new order with the current entry / SL / TP / qty.
    const attempt = await placeOrderWithMarginRetry(client, {
      symbol: s.symbol,
      side: side === "long" ? "buy" : "sell",
      qty: requestedQty,
      type: market ? "market" : "limit",
      price: entry,
      stopLossPrice: sl,
      takeProfitPrice: tp,
    });
    await emitPlacementOutcome(setup.id, attempt, requestedQty, entry);


    if (!attempt.res) {
      await supabaseAdmin
        .from("strategy_setups")
        .update({
          status: "cancelled",
          close_reason: isRecoverableCapacityError(attempt.error) ? "rearm_with_ai" : "manual",
          closed_at: new Date().toISOString(),
          exchange_order_id: null,
          entry_price: entry,
          sl_price: sl,
          initial_sl_price: sl,
          tp_price: tp,
          qty: roundExchangeQty(requestedQty),
          reprice_count: priorReprices + 1,
          ai_grade: aiDecision.grade,
          ai_score: aiDecision.score,
          ai_risk_mult: aiDecision.riskMult,
          updated_at: new Date().toISOString(),
          ...placementFields(attempt, requestedQty),
        })
        .eq("id", setup.id);
      await log("error", "reprice_now: full AI-sized replace failed; old order cancelled and no smaller wrong-risk order placed", {
        setup_id: setup.id,
        error: attempt.error,
        planned_qty: roundExchangeQty(requestedQty),
        planned_risk_usd: risk * roundExchangeQty(requestedQty),
      });
      actions.push(`reprice_now_replace_failed ${side}`);
      continue;
    }

    await supabaseAdmin
      .from("strategy_setups")
      .update({
        entry_price: entry,
        sl_price: sl,
        initial_sl_price: sl,
        tp_price: tp,
        qty: attempt.finalQty,
        reprice_count: priorReprices + 1,
        status: "armed",
        exchange_order_id: attempt.res.exchangeOrderId || null,
        close_reason: null,
        closed_at: null,
        ai_grade: aiDecision.grade,
        ai_score: aiDecision.score,
        ai_risk_mult: aiDecision.riskMult,
        updated_at: new Date().toISOString(),
        ...placementFields(attempt, requestedQty),
      })
      .eq("id", setup.id);


    await log("info", "reprice_now: replaced live order", {
      setup_id: setup.id,
      old_exchange_order_id: oldOid,
      new_exchange_order_id: attempt.res.exchangeOrderId,
      entry, sl, tp, qty: attempt.finalQty,
      ai_grade: aiDecision.grade,
      ai_score: aiDecision.score,
      ai_risk_mult: aiDecision.riskMult,
      mode: cfg.mode, market,
    });
    actions.push(
      `reprice_now ${side} grade=${aiDecision.grade ?? "AI_OFF"} entry=${entry.toFixed(2)} sl=${sl.toFixed(2)} tp=${tp.toFixed(2)} qty=${attempt.finalQty}`,
    );
  }

  return { ok: true, actions };
}

