import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const SignalSchema = z.object({
  secret: z.string().min(1),
  alert_id: z.string().optional(),
  symbol: z.string().min(1).max(32),
  action: z.enum(["buy", "sell", "close"]),
  price: z.number().positive(),
  size_usd: z.number().positive().optional(),
  size_pct: z.number().min(0).max(100).optional(),
});

export const Route = createFileRoute("/api/public/webhook/tradingview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.TRADINGVIEW_WEBHOOK_SECRET;
        if (!expected) {
          return new Response("Webhook secret not configured", { status: 500 });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const parsed = SignalSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { ok: false, error: "invalid_payload", issues: parsed.error.issues },
            { status: 400 },
          );
        }

        if (parsed.data.secret !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { processSignal } = await import("@/lib/trading/engine.server");

        const { secret: _s, ...signal } = parsed.data;
        const alertId =
          signal.alert_id ?? `auto-${Date.now()}-${signal.symbol}-${signal.action}`;

        // Dedup by alert_id
        const { data: eventRow, error: insertErr } = await supabaseAdmin
          .from("webhook_events")
          .insert({
            alert_id: alertId,
            raw_payload: signal,
            status: "received",
          })
          .select()
          .single();

        if (insertErr) {
          if (insertErr.code === "23505") {
            return Response.json(
              { ok: true, duplicate: true, alert_id: alertId },
              { status: 200 },
            );
          }
          return Response.json(
            { ok: false, error: insertErr.message },
            { status: 500 },
          );
        }

        const result = await processSignal(
          { ...signal, alert_id: alertId },
          eventRow.id,
        );

        await supabaseAdmin
          .from("webhook_events")
          .update({ status: result.status, reason: result.reason ?? null })
          .eq("id", eventRow.id);

        return Response.json({ ok: true, ...result });
      },
    },
  },
});
