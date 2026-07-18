import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Beaker } from "lucide-react";
import type { StrategyMetrics } from "@/lib/backtest-snapshots";

export function StrategyPageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-14 z-20 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
              <Beaker className="w-4 h-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="font-display text-sm font-semibold tracking-tight">{title}</div>
              <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/backtest/compare">
              <Button variant="outline" size="sm">Compare all</Button>
            </Link>
            <Link to="/backtest">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 md:mr-2" />
                <span className="hidden sm:inline">Fib Zone Lab</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-4 md:space-y-6">
        {children}
      </main>
    </div>
  );
}

export function MetricsGrid({ m }: { m: StrategyMetrics }) {
  const cell = (label: string, value: string, tone?: "pos" | "neg") => (
    <div className="rounded-md border border-border/60 p-3">
      <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-mono font-semibold ${
          tone === "pos" ? "text-emerald-500" : tone === "neg" ? "text-red-500" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
  return (
    <div className="grid gap-2 md:grid-cols-4 lg:grid-cols-8">
      {cell("Net P&L", `$${m.netPnl.toFixed(0)}`, m.netPnl >= 0 ? "pos" : "neg")}
      {cell("Trades", String(m.trades))}
      {cell("Wins", String(m.wins), "pos")}
      {cell("Losses", String(m.losses), "neg")}
      {cell("Win rate", `${m.winRatePct.toFixed(1)}%`)}
      {cell("Profit factor", isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : "∞")}
      {cell("Avg R", m.avgR.toFixed(2))}
      {cell("Max DD", `$${m.maxDd.toFixed(0)}`, "neg")}
    </div>
  );
}

export function ResultCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono tracking-widest">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
