import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, CalendarDays, CalendarRange } from "lucide-react";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Shark" },
      { name: "description", content: "Daily, weekly, and monthly performance reports." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReportsPage,
});

const cards = [
  { title: "Daily Report", desc: "Yesterday's trades, PnL, best & worst.", icon: CalendarDays },
  { title: "Weekly Report", desc: "Rolling 7-day performance summary.", icon: CalendarRange },
  { title: "Monthly Report", desc: "Month-to-date PnL, calendar heatmap, top setups.", icon: FileText },
];

function ReportsPage() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">Printable performance summaries. Live data coming next.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.title} className="card-hover">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <c.icon className="h-4 w-4 text-primary" />
                {c.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{c.desc}</p>
              <div className="mt-4 grid h-32 place-items-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                Report coming soon
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
