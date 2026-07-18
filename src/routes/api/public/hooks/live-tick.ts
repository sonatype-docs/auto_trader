// Cron endpoint — hit once per minute by pg_cron to run one LIVE trading tick.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/live-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const apikey = request.headers.get("apikey");
        if (expected && apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { runLiveTradingTick } = await import("@/lib/live-trading/tick.server");
        try {
          const result = await runLiveTradingTick();
          return Response.json(result);
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
      GET: async () => Response.json({ ok: true, hint: "POST to run a live tick" }),
    },
  },
});
