import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/strategy-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const apikey = request.headers.get("apikey");
        if (expected && apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { runStrategyTick } = await import("@/lib/strategy/engine.server");
        try {
          const result = await runStrategyTick();
          return Response.json(result);
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
      GET: async () => Response.json({ ok: true, hint: "POST to run a tick" }),
    },
  },
});
