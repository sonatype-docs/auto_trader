import { type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, BookMarked, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { VolumeEntry, StrategyEntry } from "@/lib/handbook/registry";

export interface StrategySection {
  id: string;
  title: string;
  body: ReactNode;
}

export const HANDBOOK_SECTION_TITLES = [
  "Theory",
  "Market Logic",
  "Professional Rules",
  "AI Implementation Prompt",
  "Backtester Requirements",
  "Optimizer Variables",
  "Analytics",
  "Statistical Filters",
  "Professional Enhancements",
  "Common Mistakes",
  "Future Research",
] as const;

export function StrategyPage({
  volume,
  strategy,
  sections,
  liveBacktester,
  status,
}: {
  volume: VolumeEntry;
  strategy: StrategyEntry;
  sections: StrategySection[];
  liveBacktester?: ReactNode;
  status: "full" | "stub";
}) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-16 z-20 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
              <BookMarked className="w-4 h-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
                <Link to="/handbook" className="hover:text-foreground">Handbook</Link>
                <ChevronRight className="h-3 w-3" />
                <Link
                  to="/handbook/$volume"
                  params={{ volume: volume.slug }}
                  className="hover:text-foreground"
                >
                  Vol {volume.number} — {volume.title}
                </Link>
              </div>
              <div className="font-display text-sm font-semibold tracking-tight truncate">
                {strategy.title}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={status === "full" ? "default" : "outline"} className="uppercase text-[9px] tracking-widest">
              {status === "full" ? "Live" : "Coming soon"}
            </Badge>
            <Link to="/handbook">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 md:mr-2" />
                <span className="hidden sm:inline">All strategies</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6 grid gap-4 md:gap-6 lg:grid-cols-[220px_1fr]">
        {/* Section jump-nav */}
        <nav className="hidden lg:block sticky top-32 self-start">
          <div className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground mb-2">
            Sections
          </div>
          <ol className="space-y-1 text-sm">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="flex items-start gap-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="font-mono text-[10px] w-4 shrink-0 pt-0.5">{String(i + 1).padStart(2, "0")}</span>
                  <span>{s.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="space-y-6 min-w-0">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{strategy.subtitle}</p>
          </div>

          {liveBacktester && (
            <Card className="border-primary/40">
              <CardHeader>
                <CardTitle className="text-sm font-mono tracking-widest">Live Backtester</CardTitle>
              </CardHeader>
              <CardContent>{liveBacktester}</CardContent>
            </Card>
          )}

          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-40">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-mono tracking-widest flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">{String(i + 1).padStart(2, "0")}</span>
                    <span>{s.title}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-display prose-h3:text-sm prose-h3:tracking-widest prose-h3:uppercase prose-h3:text-muted-foreground prose-p:leading-relaxed prose-strong:text-foreground">
                  {s.body}
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

/** Default stub content shown for strategies not yet fully written. */
export function defaultStubSections(title: string): StrategySection[] {
  const placeholder = (what: string) => (
    <p className="text-sm text-muted-foreground italic">
      {what} for <strong>{title}</strong> will be written when this strategy is promoted from stub to full.
    </p>
  );
  return HANDBOOK_SECTION_TITLES.map((t, i) => ({
    id: `s${i + 1}-${t.toLowerCase().replace(/\s+/g, "-")}`,
    title: t,
    body: placeholder(t),
  }));
}
