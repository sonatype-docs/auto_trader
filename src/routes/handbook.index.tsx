import { createFileRoute, Link } from "@tanstack/react-router";
import { BookMarked, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HANDBOOK } from "@/lib/handbook/registry";

export const Route = createFileRoute("/handbook/")({
  component: HandbookIndex,
  head: () => ({
    meta: [
      { title: "The Complete XAU/USD Quantitative Research Handbook" },
      {
        name: "description",
        content:
          "Every major gold strategy used by banks, prop firms, CTAs and hedge funds — theory, rules, backtests, optimizers and analytics.",
      },
      { property: "og:title", content: "XAU/USD Quantitative Research Handbook" },
      {
        property: "og:description",
        content:
          "Six volumes: opening range, smart money concepts, trend, mean reversion, institutional filters, and quantitative research.",
      },
    ],
  }),
});

function HandbookIndex() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow">
            <BookMarked className="w-5 h-5" aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              The Complete XAU/USD Quantitative Research Handbook
            </h1>
            <p className="text-sm text-muted-foreground">
              Every major gold strategy used by banks, prop firms, CTAs and hedge funds.
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 md:px-6 py-6 space-y-6">
        <p className="text-sm max-w-3xl text-muted-foreground">
          Each strategy comes with theory, market logic, professional rules, an AI
          implementation prompt, backtester requirements, optimizer variables, analytics,
          statistical filters, professional enhancements, common mistakes and future
          research directions. Volumes are built one strategy at a time.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          {HANDBOOK.map((v) => {
            const full = v.strategies.filter((s) => s.status === "full").length;
            return (
              <Card key={v.slug} className="hover:border-primary/50 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-display">
                      <span className="text-muted-foreground font-mono text-xs mr-2">
                        Vol {v.number}
                      </span>
                      {v.title}
                    </CardTitle>
                    <Badge variant={full > 0 ? "default" : "outline"} className="text-[10px]">
                      {full}/{v.strategies.length} live
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">{v.intro}</p>
                  <ul className="space-y-1 text-sm">
                    {v.strategies.map((s) => (
                      <li key={s.slug}>
                        <Link
                          to="/handbook/$volume/$strategy"
                          params={{ volume: v.slug, strategy: s.slug }}
                          className="flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-muted/50"
                        >
                          <span className="truncate">{s.title}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {s.status === "full" ? (
                              <span className="text-[9px] uppercase font-mono tracking-widest text-primary">Live</span>
                            ) : (
                              <span className="text-[9px] uppercase font-mono tracking-widest text-muted-foreground">Soon</span>
                            )}
                            <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
