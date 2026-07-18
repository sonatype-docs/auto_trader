import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, BookMarked } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { findVolume } from "@/lib/handbook/registry";

export const Route = createFileRoute("/handbook/$volume/")({
  component: VolumeIndex,
  loader: ({ params }) => {
    const v = findVolume(params.volume);
    if (!v) throw notFound();
    return { volume: v };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `Vol ${loaderData.volume.number} — ${loaderData.volume.title} · Handbook` },
          { name: "description", content: loaderData.volume.intro },
        ]
      : [{ title: "Volume — Handbook" }],
  }),
});

function VolumeIndex() {
  const { volume } = Route.useLoaderData();
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-3 md:px-6 py-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
              <BookMarked className="w-4 h-4" aria-hidden />
            </div>
            <div>
              <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">
                Volume {volume.number}
              </div>
              <h1 className="font-display text-xl font-semibold tracking-tight">{volume.title}</h1>
            </div>
          </div>
          <Link to="/handbook">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" /> All volumes
            </Button>
          </Link>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-3 md:px-6 py-6 space-y-6">
        <p className="text-sm text-muted-foreground max-w-3xl">{volume.intro}</p>
        <div className="grid gap-3 md:grid-cols-2">
          {volume.strategies.map((s: (typeof volume)["strategies"][number]) => (
            <Card key={s.slug} className="hover:border-primary/50 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-display">{s.title}</CardTitle>
                  <Badge
                    variant={s.status === "full" ? "default" : "outline"}
                    className="text-[9px] uppercase tracking-widest"
                  >
                    {s.status === "full" ? "Live" : "Coming soon"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3">{s.subtitle}</p>
                <Link
                  to="/handbook/$volume/$strategy"
                  params={{ volume: volume.slug, strategy: s.slug }}
                >
                  <Button size="sm" variant="outline">
                    Open <ArrowRight className="w-3 h-3 ml-2" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
