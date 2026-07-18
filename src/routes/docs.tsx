import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/docs")({
  component: Docs,
  head: () => ({
    meta: [{ title: "Webhook setup — Shark Auto-Trader" }],
  }),
});

function Docs() {
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/public/webhook/tradingview`
      : "https://<your-app>.lovable.app/api/public/webhook/tradingview";

  const sample = `{
  "secret": "<TRADINGVIEW_WEBHOOK_SECRET>",
  "alert_id": "{{timenow}}-{{ticker}}",
  "symbol": "{{ticker}}",
  "action": "buy",
  "price": {{close}},
  "size_usd": 50
}`;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-4 md:px-6 h-14 flex items-center">
          <Link to="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
          </Link>
          <span className="ml-4 font-mono text-sm tracking-widest">WEBHOOK SETUP</span>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-6">
        <Card>
          <CardHeader><CardTitle>1. Webhook URL</CardTitle></CardHeader>
          <CardContent>
            <code className="block bg-muted p-3 rounded font-mono text-xs break-all">{url}</code>
            <p className="text-xs text-muted-foreground mt-2">Paste this into TradingView's alert "Webhook URL" field.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>2. Alert message JSON</CardTitle></CardHeader>
          <CardContent>
            <pre className="bg-muted p-3 rounded font-mono text-xs overflow-x-auto">{sample}</pre>
            <p className="text-xs text-muted-foreground mt-2">
              Replace <code>&lt;TRADINGVIEW_WEBHOOK_SECRET&gt;</code> with the actual secret (ask the assistant to reveal or rotate it).
              Use <code>action: "sell"</code> to open short, <code>"close"</code> to flatten.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>3. Pine Script alert() call</CardTitle></CardHeader>
          <CardContent>
            <pre className="bg-muted p-3 rounded font-mono text-xs overflow-x-auto">{`if (longCondition)
    alert('{"secret":"...","symbol":"' + syminfo.ticker + '","action":"buy","price":' + str.tostring(close) + ',"size_usd":50}', alert.freq_once_per_bar_close)`}</pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>4. Test end-to-end</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Use the "Send test signal" panel on the dashboard first. Keep Paper Mode ON until you've verified the flow, then flip it off for live trading.
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
