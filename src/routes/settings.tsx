import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDashboard, updateSettings, getWebhookInfo, testExchangeConnection } from "@/lib/trading.functions";
import { getStrategyState, updateStrategySettings } from "@/lib/strategy.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";


export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "Settings — Shark Auto-Trader" },
      { name: "description", content: "Risk parameters and integration secrets." },
    ],
  }),
});

function SettingsPage() {
  const qc = useQueryClient();
  const getDash = useServerFn(getDashboard);
  const getInfo = useServerFn(getWebhookInfo);
  const update = useServerFn(updateSettings);
  const testConn = useServerFn(testExchangeConnection);

  const dashQ = useQuery({ queryKey: ["dashboard"], queryFn: () => getDash() });
  const infoQ = useQuery({ queryKey: ["webhook-info"], queryFn: () => getInfo() });
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [form, setForm] = useState({
    max_position_usd: 100,
    max_open_positions: 3,
    max_daily_loss_usd: 50,
    paper_starting_equity: 10000,
    allowed_symbols: "",
  });

  useEffect(() => {
    if (dashQ.data?.settings) {
      const s = dashQ.data.settings;
      setForm({
        max_position_usd: Number(s.max_position_usd),
        max_open_positions: Number(s.max_open_positions),
        max_daily_loss_usd: Number(s.max_daily_loss_usd),
        paper_starting_equity: Number(s.paper_starting_equity),
        allowed_symbols: (s.allowed_symbols ?? []).join(", "),
      });
    }
  }, [dashQ.data]);

  const mut = useMutation({
    mutationFn: () =>
      update({
        data: {
          max_position_usd: form.max_position_usd,
          max_open_positions: form.max_open_positions,
          max_daily_loss_usd: form.max_daily_loss_usd,
          paper_starting_equity: form.paper_starting_equity,
          allowed_symbols: form.allowed_symbols
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const testMut = useMutation({
    mutationFn: () => testConn(),
    onSuccess: (r) => setTestResult({ ok: r.ok, message: r.message }),
    onError: (e) => setTestResult({ ok: false, message: e.message }),
  });

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-4 md:px-6 h-14 flex items-center">
          <Link to="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
          </Link>
          <span className="ml-4 font-mono text-sm tracking-widest">SETTINGS</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Risk parameters</CardTitle>
            <CardDescription>Applied to every incoming signal before it's placed.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Max position size (USD)" value={form.max_position_usd} onChange={(v) => setForm({ ...form, max_position_usd: v })} />
            <Field label="Max open positions" value={form.max_open_positions} onChange={(v) => setForm({ ...form, max_open_positions: v })} />
            <Field label="Max daily loss (USD)" value={form.max_daily_loss_usd} onChange={(v) => setForm({ ...form, max_daily_loss_usd: v })} />
            <Field label="Paper starting equity (USD)" value={form.paper_starting_equity} onChange={(v) => setForm({ ...form, paper_starting_equity: v })} />
            <div className="md:col-span-2 space-y-2">
              <Label className="text-xs">Allowed symbols (comma-separated, empty = all)</Label>
              <Input value={form.allowed_symbols} onChange={(e) => setForm({ ...form, allowed_symbols: e.target.value })} placeholder="BTCUSDT, ETHUSDT" />
            </div>
            <div className="md:col-span-2">
              <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
                {mut.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <StrategySettingsCard />

        <Card>

          <CardHeader>
            <CardTitle>Integration status</CardTitle>
            <CardDescription>Secrets are stored server-side and never shown.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 font-mono text-sm">
            <StatusRow label="TradingView webhook secret" ok={!!infoQ.data?.hasSecret} />
            <StatusRow label="SharkExchange API key + secret" ok={!!infoQ.data?.hasExchangeKey} />
            <div className="pt-3 flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                disabled={testMut.isPending}
                onClick={() => {
                  setTestResult(null);
                  testMut.mutate();
                }}
              >
                {testMut.isPending ? "Testing…" : "Test SharkExchange connection"}
              </Button>
              {testResult && (
                <span
                  className={`flex items-center gap-1 text-xs ${testResult.ok ? "text-long" : "text-short"}`}
                >
                  {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {testResult.message}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground pt-2">
              Missing SharkExchange keys? Ask the assistant in chat to add them; live mode won't work until they're configured.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2">
      <span>{label}</span>
      {ok ? (
        <span className="flex items-center gap-1 text-long"><CheckCircle2 className="w-4 h-4" /> configured</span>
      ) : (
        <span className="flex items-center gap-1 text-short"><XCircle className="w-4 h-4" /> missing</span>
      )}
    </div>
  );
}

function StrategySettingsCard() {
  const qc = useQueryClient();
  const getState = useServerFn(getStrategyState);
  const updateStrat = useServerFn(updateStrategySettings);
  const q = useQuery({ queryKey: ["strategy-state"], queryFn: () => getState() });
  const [form, setForm] = useState({
    enabled: false,
    symbol: "XAUUSDT",
    sl_risk_usd: 25,
    rr: 2,
    session_start_ist: "05:30",
    entry_mode: "fib" as "fib" | "retest" | "market" | "adaptive",
    entry_depth_pct: 0.15,
    sl_depth_pct: 0.60,
    adaptive_strong_break_pct: 30,
    adaptive_shallow_depth: 0.10,
    adaptive_deep_depth: 0.35,
    retest_sl_r: 0.5,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  useEffect(() => {
    if (q.data?.settings) {
      const s = q.data.settings as Record<string, unknown>;
      setForm({
        enabled: !!s.enabled,
        symbol: String(s.symbol),
        sl_risk_usd: Number(s.sl_risk_usd),
        rr: Number(s.rr),
        session_start_ist: String(s.session_start_ist).slice(0, 5),
        entry_mode: (String(s.entry_mode ?? "fib") as typeof form.entry_mode),
        entry_depth_pct: Number(s.entry_depth_pct ?? 0.15),
        sl_depth_pct: Number(s.sl_depth_pct ?? 0.60),
        adaptive_strong_break_pct: Number(s.adaptive_strong_break_pct ?? 30),
        adaptive_shallow_depth: Number(s.adaptive_shallow_depth ?? 0.10),
        adaptive_deep_depth: Number(s.adaptive_deep_depth ?? 0.35),
        retest_sl_r: Number(s.retest_sl_r ?? 0.5),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const mut = useMutation({
    mutationFn: (patch: Partial<typeof form>) => updateStrat({ data: patch }),
    onSuccess: () => {
      toast.success("Strategy settings saved");
      qc.invalidateQueries({ queryKey: ["strategy-state"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const modeHelp: Record<typeof form.entry_mode, string> = {
    fib: "Pullback into the zone. Deeper = better price, more misses. Today's default.",
    retest: "Enter at the broken zone edge. Highest fill rate. SL is a fixed R below.",
    market: "Enter at market on the break candle close. 100% fill; worse average entry.",
    adaptive: "Auto-picks shallow vs deep entry from break strength.",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>XAUUSDT strategy engine</CardTitle>
        <CardDescription>
          IST session zone → 1H break → armed setup. Entry mechanics are tunable below.
          Runs on a 5-minute cron. Respects the kill switch.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2 flex items-center justify-between border-b border-border pb-3">
          <div>
            <Label className="text-xs">Engine enabled</Label>
            <p className="text-xs text-muted-foreground mt-1">
              {form.enabled ? "Engine will fire signals on the next tick." : "Engine is idle."}
            </p>
          </div>
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => {
              setForm({ ...form, enabled: v });
              mut.mutate({ enabled: v });
            }}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Symbol</Label>
          <Input
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Session start (IST, HH:MM)</Label>
          <Input
            value={form.session_start_ist}
            onChange={(e) => setForm({ ...form, session_start_ist: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">SL risk per trade (USD)</Label>
          <Input
            type="number"
            value={form.sl_risk_usd}
            onChange={(e) => setForm({ ...form, sl_risk_usd: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">R:R multiple (TP)</Label>
          <Input
            type="number"
            step="0.1"
            value={form.rr}
            onChange={(e) => setForm({ ...form, rr: Number(e.target.value) })}
          />
        </div>

        {/* Entry mechanics — new in Phase 1 */}
        <div className="md:col-span-2 border-t border-border pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-mono tracking-wide">ENTRY MECHANICS</Label>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "Hide advanced" : "Show advanced"}
            </button>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Mode</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(["fib", "retest", "market", "adaptive"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm({ ...form, entry_mode: m })}
                  className={`px-3 py-2 rounded border text-xs font-mono uppercase tracking-wide ${
                    form.entry_mode === m
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{modeHelp[form.entry_mode]}</p>
          </div>

          {(form.entry_mode === "fib" || form.entry_mode === "market") && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {form.entry_mode === "fib" && (
                <div className="space-y-2">
                  <Label className="text-xs">
                    Entry depth — {(form.entry_depth_pct * 100).toFixed(0)}% into zone
                  </Label>
                  <Input
                    type="range"
                    min={0}
                    max={0.5}
                    step={0.05}
                    value={form.entry_depth_pct}
                    onChange={(e) => setForm({ ...form, entry_depth_pct: Number(e.target.value) })}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    0% = zone edge (higher fill rate) · 50% = zone midpoint
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-xs">
                  SL depth — {(form.sl_depth_pct * 100).toFixed(0)}% into zone
                </Label>
                <Input
                  type="range"
                  min={Math.max(0.15, form.entry_depth_pct + 0.05)}
                  max={1}
                  step={0.05}
                  value={form.sl_depth_pct}
                  onChange={(e) => setForm({ ...form, sl_depth_pct: Number(e.target.value) })}
                />
                <p className="text-[10px] text-muted-foreground">
                  Risk per unit = {(Math.max(0, form.sl_depth_pct - form.entry_depth_pct) * 100).toFixed(0)}% of zone range
                </p>
              </div>
            </div>
          )}

          {form.entry_mode === "retest" && (
            <div className="space-y-2">
              <Label className="text-xs">Retest SL distance (R × range)</Label>
              <Input
                type="number"
                step="0.05"
                min={0.1}
                max={5}
                value={form.retest_sl_r}
                onChange={(e) => setForm({ ...form, retest_sl_r: Number(e.target.value) })}
              />
              <p className="text-[10px] text-muted-foreground">
                SL distance = this × zone range. 0.5 = tight retest, 1.0 = full zone range as risk.
              </p>
            </div>
          )}

          {form.entry_mode === "adaptive" && showAdvanced && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border border-border rounded p-3">
              <div className="space-y-1">
                <Label className="text-xs">Strong-break % (beyond zone)</Label>
                <Input
                  type="number"
                  step="1"
                  value={form.adaptive_strong_break_pct}
                  onChange={(e) => setForm({ ...form, adaptive_strong_break_pct: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Shallow depth (strong break)</Label>
                <Input
                  type="number"
                  step="0.05"
                  min={0}
                  max={0.5}
                  value={form.adaptive_shallow_depth}
                  onChange={(e) => setForm({ ...form, adaptive_shallow_depth: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Deep depth (weak break)</Label>
                <Input
                  type="number"
                  step="0.05"
                  min={0}
                  max={0.5}
                  value={form.adaptive_deep_depth}
                  onChange={(e) => setForm({ ...form, adaptive_deep_depth: Number(e.target.value) })}
                />
              </div>
            </div>
          )}
        </div>

        {/* AI Grading toggle — model is trained in Backtest → Advanced Research → AI Grading. */}
        <div className="md:col-span-2 border-t border-border pt-4 space-y-3">
          <Label className="text-xs font-mono tracking-wide">AI GRADING ENGINE</Label>
          <p className="text-[11px] text-muted-foreground">
            When enabled, the live engine scores each setup 0–100 using the trained model (A+++ → C) and scales risk
            per grade. Setups below the minimum grade are skipped. Train and push the model from the Backtest → Advanced
            Research → AI Grading tab.
          </p>
          {(() => {
            const s = (q.data?.settings ?? {}) as Record<string, unknown>;
            const aiEnabled = !!s.ai_grading_enabled;
            const hasModel = !!s.ai_grading_model;
            const modelTs = hasModel ? new Date(Number((s.ai_grading_model as { trained_at?: number })?.trained_at ?? 0)) : null;
            const minGrade = (s.ai_min_grade as string) ?? "B";
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex items-center justify-between rounded border border-border p-3">
                  <div>
                    <Label className="text-xs">Enable AI grading</Label>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {hasModel
                        ? `Model trained ${modelTs?.toLocaleString() ?? "—"}`
                        : "No model saved yet — train one from Backtest."}
                    </p>
                  </div>
                  <Switch
                    checked={aiEnabled}
                    disabled={!hasModel}
                    onCheckedChange={(v) => mut.mutate({ ai_grading_enabled: v } as never)}
                  />
                </div>
                <div className="space-y-2 rounded border border-border p-3">
                  <Label className="text-xs">Minimum grade to trade</Label>
                  <div className="grid grid-cols-6 gap-1">
                    {(["A+++", "A++", "A+", "A", "B", "C"] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => mut.mutate({ ai_min_grade: g } as never)}
                        className={`px-2 py-1 rounded border text-[11px] font-mono ${
                          minGrade === g
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>


        <div className="md:col-span-2">
          <Button
            onClick={() =>
              mut.mutate({
                symbol: form.symbol,
                sl_risk_usd: form.sl_risk_usd,
                rr: form.rr,
                session_start_ist: form.session_start_ist,
                entry_mode: form.entry_mode,
                entry_depth_pct: form.entry_depth_pct,
                sl_depth_pct: form.sl_depth_pct,
                adaptive_strong_break_pct: form.adaptive_strong_break_pct,
                adaptive_shallow_depth: form.adaptive_shallow_depth,
                adaptive_deep_depth: form.adaptive_deep_depth,
                retest_sl_r: form.retest_sl_r,
              })
            }
            disabled={mut.isPending}
          >
            {mut.isPending ? "Saving…" : "Save strategy settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

