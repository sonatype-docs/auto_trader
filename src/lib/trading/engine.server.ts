import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createSharkClient } from "@/lib/exchange/shark-client.server";

export interface TradeSignal {
  alert_id?: string;
  symbol: string;
  action: "buy" | "sell" | "close";
  price: number;
  size_usd?: number;
  size_pct?: number;
}

export interface EngineResult {
  status: "executed" | "rejected" | "skipped";
  reason?: string;
  order_id?: string;
}

async function log(
  severity: "info" | "warn" | "error",
  message: string,
  context?: Record<string, unknown>,
) {
  await supabaseAdmin
    .from("activity_log")
    .insert({ severity, message, context: (context as never) ?? null });
}

export async function processSignal(
  signal: TradeSignal,
  webhookEventId: string,
): Promise<EngineResult> {
  const { data: settings, error: settingsErr } = await supabaseAdmin
    .from("settings")
    .select("*")
    .eq("id", true)
    .single();

  if (settingsErr || !settings) {
    await log("error", "Settings not found", { error: settingsErr?.message });
    return { status: "rejected", reason: "settings_missing" };
  }

  if (settings.kill_switch) {
    await log("warn", "Kill switch active — signal rejected", { signal });
    return { status: "rejected", reason: "kill_switch_active" };
  }

  if (
    settings.allowed_symbols.length > 0 &&
    !settings.allowed_symbols.includes(signal.symbol)
  ) {
    return { status: "rejected", reason: "symbol_not_allowed" };
  }

  // Compute position size in USD
  const sizeUsd = Math.min(
    signal.size_usd ??
      ((signal.size_pct ?? 100) / 100) * Number(settings.max_position_usd),
    Number(settings.max_position_usd),
  );
  if (sizeUsd <= 0) {
    return { status: "rejected", reason: "invalid_size" };
  }

  // Daily loss check
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { data: todaysTrades } = await supabaseAdmin
    .from("trades")
    .select("pnl_usd")
    .gte("closed_at", since.toISOString());
  const dailyPnl = (todaysTrades ?? []).reduce(
    (a, t) => a + Number(t.pnl_usd),
    0,
  );
  if (dailyPnl <= -Number(settings.max_daily_loss_usd)) {
    await log("warn", "Daily loss cap reached — signal rejected", { dailyPnl });
    return { status: "rejected", reason: "daily_loss_cap" };
  }

  // Open positions cap for opening trades
  const { count: openCount } = await supabaseAdmin
    .from("positions")
    .select("*", { count: "exact", head: true })
    .neq("qty", 0);

  const { data: existingPos } = await supabaseAdmin
    .from("positions")
    .select("*")
    .eq("symbol", signal.symbol)
    .maybeSingle();

  const isOpening = !existingPos || Number(existingPos.qty) === 0;
  if (
    isOpening &&
    (openCount ?? 0) >= settings.max_open_positions &&
    signal.action !== "close"
  ) {
    return { status: "rejected", reason: "max_open_positions" };
  }

  const qty = sizeUsd / signal.price;
  const side: "buy" | "sell" =
    signal.action === "close"
      ? existingPos && Number(existingPos.qty) > 0
        ? "sell"
        : "buy"
      : signal.action;

  // Insert order row
  const { data: orderRow, error: orderErr } = await supabaseAdmin
    .from("orders")
    .insert({
      webhook_event_id: webhookEventId,
      symbol: signal.symbol,
      side,
      order_type: "market",
      qty,
      price: signal.price,
      paper: settings.paper_mode,
      status: "pending",
    })
    .select()
    .single();

  if (orderErr || !orderRow) {
    await log("error", "Order insert failed", { error: orderErr?.message });
    return { status: "rejected", reason: "db_error" };
  }

  // Execute
  let filledPrice = signal.price;
  let exchangeOrderId: string | null = null;
  let execError: string | null = null;

  if (!settings.paper_mode) {
    try {
      const client = createSharkClient();
      const res = await client.placeOrder({
        symbol: signal.symbol,
        side,
        qty,
        type: "market",
      });
      exchangeOrderId = res.exchangeOrderId;
      filledPrice = res.filledPrice ?? signal.price;
    } catch (e) {
      execError = e instanceof Error ? e.message : String(e);
    }
  }

  const finalStatus = execError ? "rejected" : "filled";
  await supabaseAdmin
    .from("orders")
    .update({
      status: finalStatus,
      filled_price: filledPrice,
      exchange_order_id: exchangeOrderId,
      error: execError,
      filled_at: new Date().toISOString(),
    })
    .eq("id", orderRow.id);

  if (execError) {
    await log("error", "Exchange rejected order", {
      error: execError,
      symbol: signal.symbol,
    });
    return { status: "rejected", reason: execError, order_id: orderRow.id };
  }

  // Update position & realize trade if closing
  await updatePosition({
    symbol: signal.symbol,
    side,
    qty,
    price: filledPrice,
    paper: settings.paper_mode,
    existing: existingPos ?? null,
  });

  await log("info", `Order ${finalStatus}`, {
    symbol: signal.symbol,
    side,
    qty,
    price: filledPrice,
    paper: settings.paper_mode,
  });

  return { status: "executed", order_id: orderRow.id };
}

async function updatePosition(args: {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  paper: boolean;
  existing: {
    symbol: string;
    qty: number;
    avg_entry_price: number;
    opened_at: string;
  } | null;
}) {
  const { symbol, side, qty, price, paper, existing } = args;
  const signed = side === "buy" ? qty : -qty;
  const prevQty = existing ? Number(existing.qty) : 0;
  const prevAvg = existing ? Number(existing.avg_entry_price) : 0;
  const newQty = prevQty + signed;

  // Closing / reducing
  if (prevQty !== 0 && Math.sign(prevQty) !== Math.sign(signed)) {
    const closingQty = Math.min(Math.abs(signed), Math.abs(prevQty));
    const pnl =
      prevQty > 0
        ? (price - prevAvg) * closingQty
        : (prevAvg - price) * closingQty;
    await supabaseAdmin.from("trades").insert({
      symbol,
      side: prevQty > 0 ? "long" : "short",
      qty: closingQty,
      entry_price: prevAvg,
      exit_price: price,
      pnl_usd: pnl,
      paper,
      opened_at: existing?.opened_at ?? new Date().toISOString(),
    });
  }

  if (newQty === 0) {
    await supabaseAdmin.from("positions").delete().eq("symbol", symbol);
    return;
  }

  const newAvg =
    prevQty === 0 || Math.sign(prevQty) !== Math.sign(newQty)
      ? price
      : (prevAvg * Math.abs(prevQty) + price * Math.abs(signed)) /
        Math.abs(newQty);

  await supabaseAdmin.from("positions").upsert({
    symbol,
    qty: newQty,
    avg_entry_price: newAvg,
    paper,
    opened_at: existing?.opened_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}
