// Session-hour selector: "All" + 00–23 buttons. Emits the selected hour
// (0-23) or null for "All" (= use the currently-configured session start).
// Clicking an hour re-runs the backtest with session_start_ist = HH:00 so
// the entire Results / Research / Advanced Research view reflects a
// different session anchor with one click.

type Props = {
  value: number | null;
  onChange: (h: number | null) => void;
  loadingHour?: number | "all" | null;
  cachedHours?: Set<number | "all">;
  configuredSessionLabel?: string;
};

export function HourFilterBar({ value, onChange, loadingHour, cachedHours, configuredSessionLabel }: Props) {
  const btn = (active: boolean, extra = "") =>
    `h-9 min-w-[3rem] px-2 font-mono text-[11px] rounded border transition ${
      active
        ? "border-primary bg-primary/20 text-primary"
        : "border-border bg-background hover:border-primary/60 hover:bg-muted/60 text-muted-foreground"
    } ${extra}`;

  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="rounded border border-border bg-muted/20 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Session start hour (IST) — re-runs backtest &amp; updates Results / Research / Advanced Research
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">
          {value == null
            ? `Configured${configuredSessionLabel ? ` · ${configuredSessionLabel}` : ""}`
            : `Session ${String(value).padStart(2, "0")}:00 IST`}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          className={btn(value == null)}
          onClick={() => onChange(null)}
          disabled={loadingHour === "all"}
          title="Use the session start hour configured above"
        >
          <div className="leading-tight">All</div>
          <div className="text-[9px] leading-tight opacity-70">
            {loadingHour === "all" ? "…" : "cfg"}
          </div>
        </button>
        {hours.map((h) => {
          const active = value === h;
          const loading = loadingHour === h;
          const cached = cachedHours?.has(h);
          return (
            <button
              key={h}
              type="button"
              className={btn(active, loading ? "opacity-70 cursor-wait" : "")}
              onClick={() => onChange(h)}
              disabled={loading}
              title={`Re-run with session start ${String(h).padStart(2, "0")}:00 IST`}
            >
              <div className="leading-tight">{String(h).padStart(2, "0")}:00</div>
              <div className="text-[9px] leading-tight opacity-70">
                {loading ? "running…" : cached ? "cached" : "run"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
