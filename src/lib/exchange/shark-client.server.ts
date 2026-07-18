/**
 * SharkExchange REST client (server-only).
 * Docs: https://docs.sharkexchange.in/
 *
 * Auth: `api-key` header + `signature` header.
 * Signature = HMAC-SHA256(secret, dataToSign) hex.
 *   - GET:                dataToSign = querystring (must include `timestamp`)
 *   - POST/PATCH/PUT/DEL: dataToSign = JSON.stringify(body) with body.timestamp set,
 *                                     using JSON.stringify default separators
 *                                     (matches the SDK's `JSON.stringify(params)`).
 */

import { createHmac } from "node:crypto";

export interface PlaceOrderParams {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  type?: "market" | "limit";
  price?: number;
  reduceOnly?: boolean;
  marginAsset?: string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export interface OrderResult {
  exchangeOrderId: string;
  status: "filled" | "pending" | "rejected";
  filledPrice?: number;
  raw?: unknown;
}

export interface TestConnectionResult {
  ok: boolean;
  status: number;
  message: string;
  sample?: unknown;
}

export interface AccountSnapshot {
  futuresWallet: unknown;
  fundingWallet: unknown;
  openPositions: unknown;
  openOrders: unknown;
  tradeHistory: unknown;
  transactionHistory: unknown;
  errors: Record<string, string>;
}

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface OpenOrderRow {
  clientOrderId: string;
  symbol: string;
  side: string;
  type: string;
  status: string;
  price: number | null;
  quantity: number | null;
  filledAmount: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  /** For child SL/TP orders attached to a position: "STOP_LOSS" | "TAKE_PROFIT" | undefined. */
  subType: string | null;
  /** e.g. "ORDER_SL" / "ORDER_TP" / "ORDER". Helps identify SL/TP children. */
  linkType: string | null;
  /** True when the order is a reduce-only exit (SL/TP child). */
  reduceOnly: boolean | null;
  /** Stop trigger price for STOP_MARKET / STOP_LIMIT child orders. */
  stopPrice: number | null;
  createdAt: string | null;
  raw: unknown;
}

export interface EditOrderParams {
  clientOrderId: string;
  stopPrice?: number;
  price?: number;
  quantity?: number;
}

export interface OpenPositionRow {
  symbol: string;
  side: "LONG" | "SHORT" | string;
  qty: number;
  entryPrice: number | null;
  raw: unknown;
}

export interface FillRow {
  clientOrderId: string | null;
  symbol: string;
  side: string;
  qty: number;
  price: number;
  fee: number;
  realizedPnl: number;
  reduceOnly: boolean | null;
  timeMs: number;
  raw: unknown;
}

export interface ExchangeClient {
  placeOrder(p: PlaceOrderParams): Promise<OrderResult>;
  cancelOrder(clientOrderId: string, symbol?: string): Promise<{ ok: boolean; status: number; body: string }>;
  editOrder(p: EditOrderParams): Promise<{ ok: boolean; status: number; body: string; json: unknown }>;
  updateLeverage(symbol: string, leverage: number): Promise<{ ok: boolean; status: number; body: string; json: unknown }>;
  getOpenOrderIds(symbol?: string): Promise<string[]>;
  getOpenOrders(symbol?: string): Promise<OpenOrderRow[]>;
  getOpenPositions(symbol?: string): Promise<OpenPositionRow[]>;
  getFillForClientOrderId(clientOrderId: string): Promise<{ price: number; qty: number } | null>;
  getRecentFills(symbol?: string): Promise<FillRow[]>;
  testConnection(): Promise<TestConnectionResult>;
  getAccountSnapshot(): Promise<AccountSnapshot>;
  getKlines(
    symbol: string,
    interval?: string,
    limit?: number,
    opts?: { startTime?: number; endTime?: number },
  ): Promise<Kline[]>;
  getKlinesRange(
    symbol: string,
    interval: string,
    fromMs: number,
    toMs: number,
  ): Promise<Kline[]>;
  getLastPrice(symbol: string): Promise<number>;
}



const BASE_URL = "https://api.sharkexchange.in";

function sign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function inferMarginAsset(symbol: string): string {
  const s = symbol.toUpperCase();
  if (s.endsWith("USDT")) return "USDT";
  if (s.endsWith("INR")) return "INR";
  return "INR";
}

async function signedGet(
  apiKey: string,
  apiSecret: string,
  path: string,
  params: Record<string, string | number> = {},
): Promise<{ ok: boolean; status: number; body: string; json: unknown }> {
  const withTs = { ...params, timestamp: Date.now().toString() };
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(withTs).map(([k, v]) => [k, String(v)])),
  ).toString();
  const signature = sign(apiSecret, qs);
  const res = await fetch(`${BASE_URL}${path}?${qs}`, {
    method: "GET",
    headers: {
      "api-key": apiKey,
      signature,
      accept: "*/*",
    },
  });
  const body = await res.text();
  let json: unknown = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    /* keep body as text */
  }
  return { ok: res.ok, status: res.status, body, json };
}

async function signedJson(
  apiKey: string,
  apiSecret: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; status: number; body: string; json: unknown }> {
  const withTs = { ...params, timestamp: Date.now().toString() };
  const dataToSign = JSON.stringify(withTs);
  const signature = sign(apiSecret, dataToSign);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      signature,
    },
    body: dataToSign,
  });
  const body = await res.text();
  let json: unknown = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    /* keep body as text */
  }
  return { ok: res.ok, status: res.status, body, json };
}

function requireCreds(): { apiKey: string; apiSecret: string } {
  const apiKey = process.env.SHARKEXCHANGE_API_KEY?.trim();
  const apiSecret = process.env.SHARKEXCHANGE_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    throw new Error(
      "SharkExchange API credentials are not configured. Add SHARKEXCHANGE_API_KEY and SHARKEXCHANGE_API_SECRET.",
    );
  }
  return { apiKey, apiSecret };
}


export function createSharkClient(): ExchangeClient {
  async function fetchOpenOrders(symbol?: string): Promise<OpenOrderRow[]> {
    const { apiKey, apiSecret } = requireCreds();
    const params: Record<string, string | number> = { sortOrder: "desc", pageSize: "100" };
    if (symbol) params.symbol = symbol.toUpperCase();
    const res = await signedGet(apiKey, apiSecret, "/v1/order/open-orders", params);
    if (!res.ok) throw new Error(`open-orders failed [${res.status}]: ${res.body.slice(0, 200)}`);
    const rows =
      (res.json as { data?: unknown[] } | null)?.data ??
      (Array.isArray(res.json) ? (res.json as unknown[]) : []);
    const out: OpenOrderRow[] = [];
    for (const r of rows) {
      const o = r as Record<string, unknown>;
      const id =
        (o.clientOrderId as string | undefined) ??
        (o.orderId as string | undefined) ??
        (o.id !== undefined ? String(o.id) : undefined) ??
        "";
      const num = (v: unknown): number | null => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      out.push({
        clientOrderId: id,
        symbol: String(o.symbol ?? ""),
        side: String(o.side ?? ""),
        type: String(o.type ?? ""),
        status: String(o.status ?? o.orderStatus ?? "OPEN"),
        price: num(o.price ?? o.limitPrice),
        quantity: num(o.quantity ?? o.orderAmount ?? o.qty),
        filledAmount: num(o.filledAmount),
        stopLossPrice: num(o.stopLossPrice ?? o.slPrice),
        takeProfitPrice: num(o.takeProfitPrice ?? o.tpPrice),
        subType: (o.subType as string | undefined) ?? null,
        linkType: (o.linkType as string | undefined) ?? null,
        reduceOnly: typeof o.reduceOnly === "boolean" ? (o.reduceOnly as boolean) : null,
        stopPrice: num(o.stopPrice ?? o.triggerPrice),
        createdAt: (o.time as string | undefined) ?? (o.createdAt as string | undefined) ?? null,
        raw: o,
      });
    }
    return out;
  }
  return {
    async placeOrder(p) {
      const { apiKey, apiSecret } = requireCreds();
      const type = (p.type ?? "market").toUpperCase() as "MARKET" | "LIMIT";
      const symU = p.symbol.toUpperCase();
      // Per-symbol price precision. Shark error 3007 = "Price precision should be less than 2"
      // means for BTCUSDT max 1 decimal is allowed. XAUUSDT accepts 2 decimals.
      const priceDp = symU.startsWith("BTC") || symU.startsWith("ETH") ? 1 : 2;
      const priceFactor = Math.pow(10, priceDp);
      const roundPrice = (v: number) => Math.round(v * priceFactor) / priceFactor;
      // Match Shark's own UI payload: round qty 3dp; do NOT send marginAsset.
      const qtyRounded = Math.round(p.qty * 1000) / 1000;
      const body: Record<string, unknown> = {
        placeType: "ORDER_FORM",
        quantity: qtyRounded,
        side: p.side.toUpperCase(),
        symbol: symU,
        reduceOnly: p.reduceOnly ?? false,
        type,
      };
      if (type === "LIMIT") {
        if (!p.price || p.price <= 0) {
          throw new Error("LIMIT orders require a positive price.");
        }
        body.price = roundPrice(p.price);
      }
      if (p.stopLossPrice && p.stopLossPrice > 0) {
        body.stopLossPrice = roundPrice(p.stopLossPrice);
      }
      if (p.takeProfitPrice && p.takeProfitPrice > 0) {
        body.takeProfitPrice = roundPrice(p.takeProfitPrice);
      }
      // marginAsset intentionally omitted — Shark's UI doesn't send it and sending it triggers 3029.

      const res = await signedJson(apiKey, apiSecret, "POST", "/v1/order/place-order", body);
      if (!res.ok) {
        // Detailed error log — includes HTTP status, full request body, and full response body.
        const detail = `SharkExchange placeOrder failed [${res.status}] body=${JSON.stringify(body)} resp=${res.body}`;
        console.error("[SharkExchange][placeOrder]", {
          status: res.status,
          symbol: symU,
          side: body.side,
          type,
          qty: qtyRounded,
          price: body.price,
          stopLossPrice: body.stopLossPrice,
          takeProfitPrice: body.takeProfitPrice,
          priceDp,
          resp: res.body,
        });
        throw new Error(detail);
      }
      const data = (res.json ?? {}) as {
        clientOrderId?: string;
        price?: number;
        filledAmount?: number;
        orderAmount?: number;
      };
      const filled = (data.filledAmount ?? 0) > 0;
      return {
        exchangeOrderId: data.clientOrderId ?? "",
        status: filled ? "filled" : "pending",
        filledPrice: data.price,
        raw: data,
      };
    },

    async cancelOrder(clientOrderId, _symbol) {
      const { apiKey, apiSecret } = requireCreds();
      // Shark uses DELETE /v1/order/delete-order with only clientOrderId.
      // Sending `symbol` triggers 400 "property symbol should not exist".
      const body: Record<string, unknown> = { clientOrderId };
      const res = await signedJson(apiKey, apiSecret, "DELETE", "/v1/order/delete-order", body);
      return { ok: res.ok, status: res.status, body: res.body };
    },

    async editOrder({ clientOrderId, stopPrice, price, quantity }) {
      const { apiKey, apiSecret } = requireCreds();
      const body: Record<string, unknown> = { clientOrderId };
      if (stopPrice !== undefined && stopPrice > 0) {
        body.stopPrice = Math.round(stopPrice * 100) / 100;
      }
      if (price !== undefined && price > 0) {
        body.price = Math.round(price * 100) / 100;
      }
      if (quantity !== undefined && quantity > 0) {
        body.quantity = Math.round(quantity * 1000) / 1000;
      }
      const res = await signedJson(apiKey, apiSecret, "PATCH", "/v1/order/edit-order", body);
      return { ok: res.ok, status: res.status, body: res.body, json: res.json };
    },

    async updateLeverage(symbol, leverage) {
      const { apiKey, apiSecret } = requireCreds();
      const lev = Math.max(1, Math.min(200, Math.floor(leverage)));
      const body = {
        contractName: symbol.toUpperCase(),
        leverage: lev,
      };
      const res = await signedJson(apiKey, apiSecret, "POST", "/v1/exchange/update/leverage", body);
      return { ok: res.ok, status: res.status, body: res.body, json: res.json };
    },


    async getOpenOrderIds(symbol) {
      const rows = await fetchOpenOrders(symbol);
      return rows.map((r) => r.clientOrderId).filter((s) => s.length > 0);
    },

    async getOpenOrders(symbol) {
      return fetchOpenOrders(symbol);
    },

    async getOpenPositions(symbol) {
      const { apiKey, apiSecret } = requireCreds();
      const params: Record<string, string | number> = { sortOrder: "desc", pageSize: "100" };
      if (symbol) params.symbol = symbol.toUpperCase();
      const res = await signedGet(apiKey, apiSecret, "/v1/positions/OPEN", params);
      if (!res.ok) return [];
      const rows =
        (res.json as { data?: unknown[] } | null)?.data ??
        (Array.isArray(res.json) ? (res.json as unknown[]) : []);
      const out: OpenPositionRow[] = [];
      const num = (v: unknown): number | null => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      for (const r of rows) {
        const o = r as Record<string, unknown>;
        const qty = num(o.positionAmt ?? o.quantity ?? o.qty ?? o.size);
        if (qty == null || qty === 0) continue;
        out.push({
          symbol: String(o.symbol ?? o.contractName ?? ""),
          side: String(o.side ?? o.positionSide ?? (qty > 0 ? "LONG" : "SHORT")).toUpperCase(),
          qty: Math.abs(qty),
          entryPrice: num(o.entryPrice ?? o.avgEntryPrice ?? o.avgPrice),
          raw: o,
        });
      }
      return out;
    },

    async getFillForClientOrderId(clientOrderId) {
      const { apiKey, apiSecret } = requireCreds();
      const res = await signedGet(apiKey, apiSecret, "/v1/user-data/trade-history", {
        sortOrder: "desc",
        pageSize: "200",
      });
      if (!res.ok) return null;
      const rows =
        (res.json as { data?: unknown[] } | null)?.data ??
        (Array.isArray(res.json) ? (res.json as unknown[]) : []);
      for (const r of rows) {
        const o = r as Record<string, unknown>;
        const id =
          (o.clientOrderId as string | undefined) ??
          (o.orderId as string | undefined);
        if (id === clientOrderId) {
          const price = Number(o.price ?? o.fillPrice ?? o.avgPrice);
          const qty = Number(o.qty ?? o.quantity ?? o.filledAmount ?? 0);
          if (Number.isFinite(price) && price > 0) return { price, qty };
        }
      }
      return null;
    },

    async getRecentFills(symbol) {
      const { apiKey, apiSecret } = requireCreds();
      const params: Record<string, string | number> = { sortOrder: "desc", pageSize: "200" };
      if (symbol) params.symbol = symbol.toUpperCase();
      const res = await signedGet(apiKey, apiSecret, "/v1/user-data/trade-history", params);
      if (!res.ok) return [];
      const rows =
        (res.json as { data?: unknown[] } | null)?.data ??
        (Array.isArray(res.json) ? (res.json as unknown[]) : []);
      const num = (v: unknown): number => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      const out: FillRow[] = [];
      for (const r of rows) {
        const o = r as Record<string, unknown>;
        const price = num(o.price ?? o.fillPrice ?? o.avgPrice);
        if (!(price > 0)) continue;
        const timeRaw = o.time ?? o.createdAt ?? o.updatedAt ?? o.timestamp;
        const timeMs =
          typeof timeRaw === "number"
            ? timeRaw
            : timeRaw
              ? Date.parse(String(timeRaw))
              : 0;
        out.push({
          clientOrderId:
            (o.clientOrderId as string | undefined) ??
            (o.orderId as string | undefined) ??
            null,
          symbol: String(o.symbol ?? ""),
          side: String(o.side ?? "").toUpperCase(),
          qty: num(o.qty ?? o.quantity ?? o.filledAmount ?? o.orderAmount),
          price,
          fee: num(o.fee ?? o.commission ?? o.tradeFee),
          realizedPnl: num(o.realizedProfit ?? o.realizedPnl ?? o.realisedPnl ?? o.pnl),
          reduceOnly:
            typeof o.reduceOnly === "boolean" ? (o.reduceOnly as boolean) : null,
          timeMs: Number.isFinite(timeMs) ? timeMs : 0,
          raw: o,
        });
      }
      return out;
    },

    async testConnection() {
      const { apiKey, apiSecret } = requireCreds();
      // Matches the Python example in SharkExchange docs and rules out
      // any URLSearchParams encoding differences.
      const res = await signedGet(apiKey, apiSecret, "/v1/user-data/trade-history", {});
      if (res.ok) {
        const rows = Array.isArray(res.json)
          ? res.json.length
          : Array.isArray((res.json as { data?: unknown[] } | null)?.data)
            ? (res.json as { data: unknown[] }).data.length
            : 0;
        return {
          ok: true,
          status: res.status,
          message: `Authenticated with SharkExchange. Trade-history probe returned ${rows} row(s).`,
          sample: res.json,
        };
      }
      return {
        ok: false,
        status: res.status,
        message: `SharkExchange rejected the request [${res.status}]: ${res.body.slice(0, 300)}`,
      };
    },

    async getAccountSnapshot() {
      const { apiKey, apiSecret } = requireCreds();
      const endpoints: Array<{ key: keyof AccountSnapshot; path: string; params: Record<string, string> }> = [
        { key: "futuresWallet", path: "/v1/wallet/futures-wallet/details", params: {} },
        { key: "fundingWallet", path: "/v1/wallet/funding-wallet/details", params: {} },
        { key: "openPositions", path: "/v1/positions/OPEN", params: { sortOrder: "desc", pageSize: "50" } },
        { key: "openOrders", path: "/v1/order/open-orders", params: { sortOrder: "desc", pageSize: "50" } },
        { key: "tradeHistory", path: "/v1/user-data/trade-history", params: { sortOrder: "desc", pageSize: "200" } },
        { key: "transactionHistory", path: "/v1/user-data/transaction-history", params: { sortOrder: "desc", pageSize: "200" } },
      ];
      const snap: AccountSnapshot = {
        futuresWallet: null,
        fundingWallet: null,
        openPositions: null,
        openOrders: null,
        tradeHistory: null,
        transactionHistory: null,
        errors: {},
      };
      await Promise.all(
        endpoints.map(async ({ key, path, params }) => {
          try {
            const res = await signedGet(apiKey, apiSecret, path, params);
            if (res.ok) {
              (snap as unknown as Record<string, unknown>)[key] = res.json ?? res.body;
            } else {
              snap.errors[key] = `[${res.status}] ${res.body.slice(0, 200)}`;
            }
          } catch (e) {
            snap.errors[key] = e instanceof Error ? e.message : String(e);
          }
        }),
      );
      return snap;
    },

    async getKlines(symbol, interval = "1h", limit = 100, opts) {
      const url = `${BASE_URL}/v1/market/klines`;
      const body: Record<string, unknown> = {
        pair: symbol.toUpperCase(),
        interval,
        limit: Math.min(Math.max(1, limit), 1500),
      };
      if (opts?.startTime) body.startTime = opts.startTime;
      if (opts?.endTime) body.endTime = opts.endTime;
      const res = await fetch(url, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Klines failed [${res.status}]: ${text.slice(0, 300)}`);
      }
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { throw new Error(`Klines not JSON: ${text.slice(0, 200)}`); }
      const rows =
        (parsed as { data?: unknown[] } | null)?.data ??
        (parsed as unknown[]);
      if (!Array.isArray(rows)) throw new Error(`Klines: unexpected shape`);
      const toNum = (v: unknown) => Number(v);
      return rows.map((r) => {
        if (Array.isArray(r)) {
          return {
            openTime: Number(r[0]),
            open: toNum(r[1]),
            high: toNum(r[2]),
            low: toNum(r[3]),
            close: toNum(r[4]),
            volume: toNum(r[5]),
            closeTime: Number(r[6] ?? r[0]),
          } as Kline;
        }
        const o = r as Record<string, unknown>;
        return {
          openTime: Number(o.openTime ?? o.startTime ?? o.t ?? o.open_time ?? 0),
          open: toNum(o.open ?? o.o),
          high: toNum(o.high ?? o.h),
          low: toNum(o.low ?? o.l),
          close: toNum(o.close ?? o.c),
          volume: toNum(o.volume ?? o.v ?? 0),
          closeTime: Number(o.closeTime ?? o.endTime ?? o.T ?? o.close_time ?? 0),
        } as Kline;
      });
    },

    async getKlinesRange(symbol, interval, fromMs, toMs) {
      // SharkExchange returns at most 1500 bars per call and, when startTime is far
      // in the past, silently returns only the most-recent bars anchored to endTime.
      // So we must page BACKWARD by walking endTime toward fromMs.
      const intervalMs =
        interval === "1m" ? 60_000 :
        interval === "5m" ? 5 * 60_000 :
        interval === "15m" ? 15 * 60_000 :
        interval === "30m" ? 30 * 60_000 :
        interval === "1h" ? 3_600_000 :
        interval === "4h" ? 4 * 3_600_000 :
        interval === "1d" ? 86_400_000 : 3_600_000;
      const PAGE = 1500;
      const out: Kline[] = [];
      const seen = new Set<number>();
      let endCursor = toMs;
      let guard = 0;
      while (endCursor > fromMs && guard < 50) {
        guard++;
        const startWindow = Math.max(fromMs, endCursor - PAGE * intervalMs);
        const chunk = await this.getKlines(symbol, interval, PAGE, {
          startTime: startWindow,
          endTime: endCursor,
        });
        if (chunk.length === 0) break;
        let earliest = Infinity;
        let added = 0;
        for (const k of chunk) {
          if (k.openTime < fromMs || k.openTime > toMs) continue;
          if (!seen.has(k.openTime)) {
            seen.add(k.openTime);
            out.push(k);
            added++;
          }
          if (k.openTime < earliest) earliest = k.openTime;
        }
        if (added === 0 || earliest === Infinity) break;
        const nextEnd = earliest - 1;
        if (nextEnd >= endCursor) break; // no backward progress
        endCursor = nextEnd;
      }
      out.sort((a, b) => a.openTime - b.openTime);
      return out;
    },

    async getLastPrice(symbol) {
      const url = `${BASE_URL}/v1/market/ticker24Hr/${encodeURIComponent(symbol.toUpperCase())}`;
      const res = await fetch(url, { headers: { accept: "application/json" } });
      const text = await res.text();
      if (!res.ok) throw new Error(`Ticker failed [${res.status}]: ${text.slice(0, 200)}`);
      const parsed = JSON.parse(text) as { data?: Record<string, unknown> };
      const t = parsed?.data ?? (JSON.parse(text) as Record<string, unknown>);
      const price = Number((t as Record<string, unknown>)?.c);
      if (!Number.isFinite(price)) throw new Error("No last price in ticker");
      return price;
    },
  };
}


