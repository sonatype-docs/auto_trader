import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const getDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = await admin();

  const [settingsRes, ordersRes, tradesRes, positionsRes, logsRes, eventsRes] =
    await Promise.all([
      supabase.from("settings").select("*").eq("id", true).single(),
      supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(25),
      supabase.from("trades").select("*").order("closed_at", { ascending: false }).limit(100),
      supabase.from("positions").select("*"),
      supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(30),
      supabase.from("webhook_events").select("*").order("received_at", { ascending: false }).limit(15),
    ]);

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const trades = tradesRes.data ?? [];
  const todaysPnl = trades
    .filter((t) => new Date(t.closed_at) >= dayStart)
    .reduce((a, t) => a + Number(t.pnl_usd), 0);
  const totalPnl = trades.reduce((a, t) => a + Number(t.pnl_usd), 0);
  const wins = trades.filter((t) => Number(t.pnl_usd) > 0).length;
  const winRate = trades.length ? (wins / trades.length) * 100 : 0;

  return {
    settings: settingsRes.data,
    orders: ordersRes.data ?? [],
    trades,
    positions: positionsRes.data ?? [],
    logs: logsRes.data ?? [],
    events: eventsRes.data ?? [],
    metrics: {
      equity: Number(settingsRes.data?.paper_starting_equity ?? 0) + totalPnl,
      totalPnl,
      todaysPnl,
      winRate,
      openPositions: (positionsRes.data ?? []).length,
      totalTrades: trades.length,
    },
  };
});

const SettingsSchema = z.object({
  kill_switch: z.boolean().optional(),
  paper_mode: z.boolean().optional(),
  max_position_usd: z.number().min(0).optional(),
  max_open_positions: z.number().int().min(0).max(50).optional(),
  max_daily_loss_usd: z.number().min(0).optional(),
  allowed_symbols: z.array(z.string().min(1).max(32)).optional(),
  paper_starting_equity: z.number().min(0).optional(),
});

export const updateSettings = createServerFn({ method: "POST" })
  .validator((input: unknown) => SettingsSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { data: row, error } = await supabase
      .from("settings")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", true)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getWebhookInfo = createServerFn({ method: "GET" }).handler(async () => {
  const hasSecret = !!process.env.TRADINGVIEW_WEBHOOK_SECRET;
  const hasExchangeKey =
    !!process.env.SHARKEXCHANGE_API_KEY && !!process.env.SHARKEXCHANGE_API_SECRET;
  return { hasSecret, hasExchangeKey };
});

export const sendTestSignal = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        symbol: z.string().min(1).max(32),
        action: z.enum(["buy", "sell", "close"]),
        price: z.number().positive(),
        size_usd: z.number().positive().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const supabase = await admin();
    const { processSignal } = await import("@/lib/trading/engine.server");
    const alertId = `test-${Date.now()}-${data.symbol}`;
    const { data: eventRow, error } = await supabase
      .from("webhook_events")
      .insert({
        alert_id: alertId,
        raw_payload: { ...data, source: "manual_test" },
        status: "received",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const result = await processSignal({ ...data, alert_id: alertId }, eventRow.id);
    await supabase
      .from("webhook_events")
      .update({ status: result.status, reason: result.reason ?? null })
      .eq("id", eventRow.id);
    return result;
  });

export const testExchangeConnection = createServerFn({ method: "POST" }).handler(async () => {
  const hasKey = !!process.env.SHARKEXCHANGE_API_KEY;
  const hasSecret = !!process.env.SHARKEXCHANGE_API_SECRET;
  if (!hasKey || !hasSecret) {
    return {
      ok: false as const,
      stage: "credentials" as const,
      message: `Missing ${!hasKey ? "SHARKEXCHANGE_API_KEY" : ""}${!hasKey && !hasSecret ? " and " : ""}${!hasSecret ? "SHARKEXCHANGE_API_SECRET" : ""}. Add them in Settings → Secrets.`,
    };
  }
  try {
    const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
    const client = createSharkClient();
    const result = await client.testConnection();
    return {
      ok: result.ok,
      stage: result.ok ? ("connected" as const) : ("request" as const),
      message: result.message,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false as const,
      stage: "request" as const,
      message: msg,
    };
  }
});

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export const getExchangeAccount = createServerFn({ method: "GET" }).handler(async () => {
  const hasKey = !!process.env.SHARKEXCHANGE_API_KEY;
  const hasSecret = !!process.env.SHARKEXCHANGE_API_SECRET;
  if (!hasKey || !hasSecret) {
    return { ok: false as const, message: "SharkExchange credentials missing.", snapshot: null };
  }
  try {
    const { createSharkClient } = await import("@/lib/exchange/shark-client.server");
    const snapshot = await createSharkClient().getAccountSnapshot();
    return {
      ok: true as const,
      message: "ok",
      snapshot: JSON.parse(JSON.stringify(snapshot)) as JsonValue,
    };
  } catch (e) {
    return {
      ok: false as const,
      message: e instanceof Error ? e.message : String(e),
      snapshot: null,
    };
  }
});

// ------------------------------------------------------------------
// Live market ticker (public — no API key required)
// SharkExchange: GET https://api.sharkexchange.in/v1/market/ticker24Hr/{pair}
// ------------------------------------------------------------------
const TickerInputSchema = z.object({
  symbol: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[A-Z0-9]+$/, "Symbol must be uppercase alphanumeric (e.g. XAUUSDT)"),
});

export const getMarketTicker = createServerFn({ method: "GET" })
  .validator((input: { symbol: string }) => TickerInputSchema.parse(input))
  .handler(async ({ data }) => {
    const url = `https://api.sharkexchange.in/v1/market/ticker24Hr/${encodeURIComponent(data.symbol)}`;
    const res = await fetch(url, {
      headers: { accept: "application/json" },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Ticker request failed [${res.status}]: ${text.slice(0, 300)}`);
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Ticker response was not JSON: ${text.slice(0, 300)}`);
    }
    // Response is shaped as { data: { ...binance-style fields... } }
    const t =
      (parsed as { data?: Record<string, unknown> } | null)?.data ??
      (parsed as Record<string, unknown>);
    const num = (v: unknown) =>
      v === undefined || v === null ? null : Number(v);
    return {
      symbol: (t?.s as string) ?? data.symbol,
      lastPrice: num(t?.c),
      priceChange: num(t?.p),
      priceChangePct: num(t?.P),
      weightedAvg: num(t?.w),
      open: num(t?.o),
      high: num(t?.h),
      low: num(t?.l),
      volume: num(t?.v),
      quoteVolume: num(t?.q),
      trades: num(t?.n),
      lastTradeQty: num(t?.Q),
      eventTime: (t?.E as number) ?? Date.now(),
      openTime: (t?.O as number) ?? null,
      closeTime: (t?.C as number) ?? null,
    };
  });

